import type { BiomeId, MusicMood } from '../config/levels';
import { Rng } from '../engine/rng';
import { compose, noteAt, type Layer, type Song } from './composer';
import { midiHz, reverbImpulse } from './dsp';
import { isDrum, type InstrumentId, type PitchedId } from './instruments';
import type { NoteCache } from './notes';
import { STYLES, type MusicStyle, type PadType } from './styles';

export interface MusicTrack {
  mood: MusicMood;
  biome: BiomeId;
  seed: number;
}

/** Title: gentle, no drums. Play: layers follow the run. Outro: settles under a results screen. */
export type MusicScene = 'title' | 'play' | 'outro';

const LOOKAHEAD = 0.3;
const LAYERS: Layer[] = ['bass', 'arp', 'lead', 'counter', 'perc1', 'perc2', 'perc3'];
const LEVEL: Record<Layer | 'sparkle', number> = { bass: 0.5, arp: 0.3, lead: 0.4, counter: 0.28, perc1: 0.7, perc2: 0.3, perc3: 0.6, sparkle: 0.16 };
/** Plucked strings fade faster than mallets, so they sit a little higher to hold a line. */
const INST_GAIN: Partial<Record<InstrumentId, number>> = { nylon: 1.45, koto: 1.45, harp: 1.25 };
const PAN: Record<Layer | 'sparkle', number> = { bass: 0, arp: -0.32, lead: 0.12, counter: 0.36, perc1: 0.22, perc2: -0.12, perc3: 0.3, sparkle: -0.5 };
const SEND: Record<Layer | 'sparkle', number> = { bass: 0.12, arp: 0.55, lead: 0.45, counter: 0.55, perc1: 0.3, perc2: 0.28, perc3: 0.28, sparkle: 0.8 };
const PAD_PEAK: Record<PadType, number> = { soft: 0.05, warm: 0.03, glass: 0.042, choir: 0.07, drone: 0.026 };

interface Voice {
  layer: Layer | 'sparkle';
  gain: GainNode;
}

/**
 * Plays a composed song per level (see composer.ts) on sampled instruments, with real-time pads.
 * Layers enter as the player grows, a sparkle layer joins during a frenzy, and a danger
 * ostinato fades in while predators hunt.
 */
export class MusicDirector {
  private ctx: BaseAudioContext | null = null;
  private notes!: NoteCache;
  private fadeDry!: GainNode;
  private fadeWet!: GainNode;
  private reverb!: ConvolverNode;
  private wet!: GainNode;
  private echo!: DelayNode;
  private padFilter!: BiquadFilterNode;
  private padBus!: GainNode;
  private dangerBus!: GainNode;
  private dangerFilter!: BiquadFilterNode;
  private stingBus!: GainNode;
  private readonly layers = new Map<Layer | 'sparkle', Voice>();
  private readonly targets = new Map<Layer | 'sparkle', number>();

  private track: MusicTrack | null = null;
  private pending: MusicTrack | null = null;
  private switchAt = 0;
  private song: Song | null = null;
  private style: MusicStyle = STYLES.reef;
  private scene: MusicScene = 'title';
  private nextTime = 0;
  private step = 0;
  private stage = 1;
  private frenzy = 0;
  private danger = 0;
  private dangerTarget = 0;
  private voices = 0;
  private take = 0;
  private readonly rng = new Rng(77);

  init(ctx: BaseAudioContext, out: AudioNode, notes: NoteCache): void {
    this.ctx = ctx;
    this.notes = notes;
    this.fadeDry = ctx.createGain();
    this.fadeWet = ctx.createGain();
    this.fadeDry.gain.value = 0;
    this.fadeWet.gain.value = 0;
    this.fadeDry.connect(out);
    this.reverb = ctx.createConvolver();
    this.wet = ctx.createGain();
    this.fadeWet.connect(this.reverb).connect(this.wet).connect(out);
    this.setSpace(3, 0.5);

    this.echo = ctx.createDelay(1.5);
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 2400;
    this.echo.connect(echoTone).connect(fb).connect(this.echo);
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.5;
    echoTone.connect(echoOut);
    echoOut.connect(this.fadeDry);
    echoOut.connect(this.fadeWet);

    for (const id of [...LAYERS, 'sparkle'] as const) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      pan.pan.value = PAN[id];
      const send = ctx.createGain();
      send.gain.value = SEND[id];
      gain.connect(pan);
      pan.connect(this.fadeDry);
      pan.connect(send).connect(this.fadeWet);
      if (id === 'lead' || id === 'counter') {
        const e = ctx.createGain();
        e.gain.value = 0.28;
        pan.connect(e).connect(this.echo);
      }
      this.layers.set(id, { layer: id, gain });
    }

    // Pads: shared low-pass with a slow sweep, plus two short modulated delays for width.
    this.padBus = ctx.createGain();
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.Q.value = 0.7;
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.045;
    const sweepAmt = ctx.createGain();
    sweepAmt.gain.value = 260;
    sweep.connect(sweepAmt).connect(this.padFilter.frequency);
    sweep.start();
    this.padBus.connect(this.padFilter);
    const padOut = ctx.createGain();
    padOut.gain.value = 0.8;
    this.padFilter.connect(padOut);
    for (const [delay, rate, side] of [
      [0.013, 0.27, -0.7],
      [0.019, 0.21, 0.7],
    ]) {
      const d = ctx.createDelay(0.05);
      d.delayTime.value = delay;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const amt = ctx.createGain();
      amt.gain.value = 0.0035;
      lfo.connect(amt).connect(d.delayTime);
      lfo.start();
      const p = ctx.createStereoPanner();
      p.pan.value = side;
      const g = ctx.createGain();
      g.gain.value = 0.55;
      this.padFilter.connect(d).connect(g).connect(p).connect(padOut);
    }
    padOut.connect(this.fadeDry);
    const padSend = ctx.createGain();
    padSend.gain.value = 0.7;
    padOut.connect(padSend).connect(this.fadeWet);

    this.dangerFilter = ctx.createBiquadFilter();
    this.dangerFilter.type = 'lowpass';
    this.dangerFilter.frequency.value = 400;
    this.dangerFilter.Q.value = 3;
    this.dangerBus = ctx.createGain();
    this.dangerBus.gain.value = 0;
    this.dangerFilter.connect(this.dangerBus);
    this.dangerBus.connect(this.fadeDry);
    const dSend = ctx.createGain();
    dSend.gain.value = 0.3;
    this.dangerBus.connect(dSend).connect(this.fadeWet);

    // Stingers skip the song fade so they still sound while a track changes.
    this.stingBus = ctx.createGain();
    this.stingBus.gain.value = 0.55;
    this.stingBus.connect(out);
    const sSend = ctx.createGain();
    sSend.gain.value = 0.5;
    this.stingBus.connect(sSend).connect(this.reverb);

    const p = this.pending;
    this.pending = null;
    if (p) this.play(p, this.scene);
  }

  get root(): number {
    return this.track?.mood.root ?? 60;
  }

  get chime(): PitchedId {
    return this.style.chime;
  }

  play(track: MusicTrack, scene: MusicScene): void {
    this.scene = scene;
    const ctx = this.ctx;
    if (!ctx) {
      this.pending = track;
      return;
    }
    const cur = this.pending ?? this.track;
    if (cur && cur.mood === track.mood && cur.seed === track.seed) return;
    const now = ctx.currentTime;
    this.pending = track;
    this.switchAt = this.song ? now + 0.9 : now;
    for (const g of [this.fadeDry.gain, this.fadeWet.gain]) {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.85);
    }
  }

  setScene(scene: MusicScene): void {
    this.scene = scene;
  }

  setStage(stage: number): void {
    this.stage = stage;
  }

  /** 0..1, from the frenzy multiplier. */
  setFrenzy(v: number): void {
    this.frenzy = v;
  }

  setDanger(v: number): void {
    this.dangerTarget = Math.max(0, Math.min(1, v));
  }

  /** MIDI note for a combo climbing the song's scale (pentatonic where the scale has seven notes). */
  ladder(index: number): number {
    const m = this.track?.mood;
    if (!m) return 72 + [0, 2, 4, 7, 9][index % 5] + 12 * Math.floor(index / 5);
    const degs = m.scale.length === 7 ? [0, 1, 2, 4, 5].map((i) => m.scale[i]) : m.scale;
    const i = Math.min(index, degs.length * 2);
    return m.root + 12 + degs[i % degs.length] + 12 * Math.floor(i / degs.length);
  }

  stinger(kind: 'win' | 'lose' | 'grow' | 'phase'): void {
    const ctx = this.ctx;
    const m = this.track?.mood;
    if (!ctx || !m) return;
    const t0 = this.nextBeat(kind === 'grow' || kind === 'phase' ? 2 : 4);
    const n = m.scale.length;
    const st = this.style;
    const note = (d: number): number => noteAt(m, d);
    if (kind === 'win') {
      [0, 2, 4, n, n + 2, n + 4].forEach((d, i) => this.hit(st.chime, note(d) + 12, t0 + i * 0.09, 0.7, this.stingBus));
      for (const d of [n, n + 2, n + 4]) this.hit(st.lead, note(d), t0 + 0.6, 0.6, this.stingBus);
      this.hit(st.bass, note(0) - 24, t0 + 0.6, 0.8, this.stingBus, 2.5);
    } else if (kind === 'lose') {
      [4, 3, 1, 0].forEach((d, i) => this.hit(st.lead, note(d), t0 + i * 0.26, 0.7, this.stingBus));
      this.hit(st.bass, note(0) - 24, t0 + 1.04, 0.9, this.stingBus, 2.5);
    } else if (kind === 'phase') {
      // Two low accents, then the lead climbs: the fight steps up.
      for (const at of [0, 0.22]) this.hit(st.bass, note(0) - 24, t0 + at, 0.9, this.stingBus, 1.2);
      [0, 1, 2, 4].forEach((d, i) => this.hit(st.lead, note(d), t0 + 0.5 + i * 0.11, 0.6, this.stingBus));
    } else {
      [0, 2, 4, n].forEach((d, i) => this.hit(st.chime, note(d) + 12, t0 + i * 0.07, 0.5, this.stingBus));
    }
  }

  update(dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.pending && ctx.currentTime >= this.switchAt) this.load(this.pending);
    if (!this.song || ctx.state !== 'running') return;
    this.danger += (this.dangerTarget - this.danger) * Math.min(1, dt * (this.dangerTarget > this.danger ? 2.5 : 0.8));
    this.mixLayers();
    this.notes.pump(2);
    const now = ctx.currentTime;
    if (this.nextTime < now - 1) this.nextTime = now + 0.05;
    this.advance(now + LOOKAHEAD);
  }

  /** Schedules every step that starts before `until`; offline renders call this once. */
  advance(until: number): void {
    const song = this.song;
    if (!song) return;
    const sixteenth = this.sixteenth;
    while (this.nextTime < until) {
      this.schedule(song, this.step, this.nextTime, sixteenth);
      this.step = (this.step + 1) % song.steps;
      this.nextTime += sixteenth;
    }
  }

  /** Loads a track immediately (offline renders use this to skip the crossfade). */
  load(track: MusicTrack): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    this.pending = null;
    this.track = track;
    this.style = STYLES[track.biome];
    this.song = compose(track.mood, this.style, track.seed);
    this.step = 0;
    this.nextTime = now + 0.4;
    this.setSpace(this.style.space[0], this.style.space[1]);
    this.echo.delayTime.setValueAtTime((60 / track.mood.tempo) * 0.75, now);
    this.padFilter.frequency.setValueAtTime(520 + track.mood.brightness * 1500, now);
    for (const g of [this.fadeDry.gain, this.fadeWet.gain]) {
      g.cancelScheduledValues(now);
      g.setValueAtTime(0, now);
      g.linearRampToValueAtTime(1, now + 2.5);
    }
    this.targets.clear();
    this.mixLayers(true);
    const seen = new Set<string>();
    const want = (inst: InstrumentId, midi: number): void => {
      const k = `${inst}:${midi}`;
      if (seen.has(k)) return;
      seen.add(k);
      this.notes.want(inst, midi);
    };
    // The first bars first, so the opening never waits on a render.
    for (const evs of this.song.byStep) for (const e of evs) want(e.inst, e.midi);
    const root = noteAt(track.mood, 0);
    want('pluckBass', this.dangerRoot);
    want('pluckBass', this.dangerRoot + 1);
    want('kick', 60);
    for (let i = 0; i < 11; i++) want(this.style.chime, this.ladder(i));
    want(this.style.bass, root - 24);
    const n = track.mood.scale.length;
    for (const d of [0, 1, 2, 3, 4, n, n + 2, n + 4]) {
      want(this.style.chime, noteAt(track.mood, d) + 12);
      want(this.style.lead, noteAt(track.mood, d));
    }
    this.notes.retain(seen);
  }

  private get sixteenth(): number {
    return 60 / (this.track?.mood.tempo ?? 80) / 4;
  }

  private get dangerRoot(): number {
    let r = this.root - 12;
    while (r > 50) r -= 12;
    return r;
  }

  private setSpace(seconds: number, wet: number): void {
    const ctx = this.ctx!;
    const [l, r] = reverbImpulse(ctx.sampleRate, seconds, new Rng(Math.round(seconds * 1000)));
    const buf = ctx.createBuffer(2, l.length, ctx.sampleRate);
    buf.getChannelData(0).set(l);
    buf.getChannelData(1).set(r);
    this.reverb.buffer = buf;
    this.wet.gain.setValueAtTime(wet * 0.9, ctx.currentTime);
  }

  /** Beat-quantized start time for stingers (`grid` in sixteenths). */
  private nextBeat(grid: number): number {
    const ctx = this.ctx!;
    const now = ctx.currentTime + 0.03;
    if (!this.song) return now;
    let t = this.nextTime;
    let s = this.step;
    while (s % grid !== 0 || t < now) {
      t += this.sixteenth;
      s++;
    }
    return t;
  }

  private layerTargets(): Record<Layer | 'sparkle', number> {
    const d = this.danger;
    if (this.scene === 'title') return { bass: 0.7, arp: 0.8, lead: 0.85, counter: 0.6, perc1: 0, perc2: 0, perc3: 0, sparkle: 0 };
    if (this.scene === 'outro') return { bass: 0.5, arp: 0.7, lead: 0.4, counter: 0.4, perc1: 0, perc2: 0, perc3: 0, sparkle: 0 };
    const s = this.stage;
    const f = this.frenzy;
    return {
      bass: 1,
      arp: (1 + f * 0.15) * (1 - d * 0.3),
      lead: 1 - d * 0.55,
      counter: s >= 2 ? 1 - d * 0.5 : 0,
      perc1: 1,
      perc2: s >= 2 || f > 0.5 ? 1 : 0,
      perc3: s >= 3 || f > 0.5 ? 1 : 0,
      sparkle: f,
    };
  }

  private mixLayers(force = false): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const t = this.layerTargets();
    for (const [id, v] of this.layers) {
      const target = t[id] * LEVEL[id];
      const prev = this.targets.get(id);
      if (!force && prev !== undefined && Math.abs(prev - target) < 0.01) continue;
      this.targets.set(id, target);
      v.gain.gain.setTargetAtTime(target, now, target > (prev ?? 0) ? 0.9 : 1.4);
    }
    this.dangerBus.gain.setTargetAtTime(this.danger * 0.2, now, 0.1);
    this.dangerFilter.frequency.setTargetAtTime(300 + this.danger * 1600, now, 0.2);
  }

  private audible(id: Layer | 'sparkle'): boolean {
    return (this.targets.get(id) ?? 0) > 0.005 || this.layers.get(id)!.gain.gain.value > 0.005;
  }

  private schedule(song: Song, step: number, t: number, sixteenth: number): void {
    const swing = step % 4 >= 2 ? this.style.swing * sixteenth : 0;
    const at = t + swing;
    const chord = song.chords.find((c) => c.step === step);
    if (chord) for (let i = 0; i < chord.tones.length; i++) this.pad(chord.tones[i], t, chord.steps * sixteenth, i === 0);

    for (const e of song.byStep[step]) {
      if (!this.audible(e.layer)) continue;
      const dest = this.layers.get(e.layer)!.gain;
      const human = (this.rng.next() - 0.5) * 0.008;
      const dur = isDrum(e.inst) ? undefined : Math.max(0.3, e.dur * sixteenth * (e.layer === 'bass' ? 0.95 : 1.6));
      this.hit(e.inst, e.midi, at + human, e.vel, dest, dur);
      if (e.layer === 'arp' && this.frenzy > 0.05 && step % 2 === 0) this.hit(this.style.chime, e.midi + 12, at, e.vel * 0.8, this.layers.get('sparkle')!.gain, 0.6);
    }

    if (this.danger > 0.02 && this.scene === 'play') {
      const root = this.dangerRoot;
      if (step % 2 === 0) this.hit('pluckBass', root + (step % 8 === 6 ? 1 : 0), t, step % 4 === 0 ? 0.8 : 0.55, this.dangerFilter, sixteenth * 1.6);
      if (step % 16 === 0 || step % 16 === 3) this.hit('kick', 60, t, step % 16 === 0 ? 0.9 : 0.55, this.dangerBus);
      if (step % 16 === 12 && this.danger > 0.5) this.hit('pluckBass', root + 13, t, 0.5, this.dangerFilter, sixteenth * 3);
    }
  }

  private hit(inst: InstrumentId, midi: number, t: number, vel: number, dest: AudioNode, dur?: number): void {
    if (this.voices > 72) return;
    const ctx = this.ctx!;
    const take = isDrum(inst) ? this.take++ % this.notes.takes(inst) : 0;
    const src = ctx.createBufferSource();
    src.buffer = this.notes.get(inst, midi, take);
    const g = ctx.createGain();
    const level = vel * (INST_GAIN[inst] ?? 1);
    g.gain.value = level;
    src.connect(g).connect(dest);
    src.start(t);
    if (dur !== undefined && dur < src.buffer.duration) {
      g.gain.setValueAtTime(level, t + dur);
      g.gain.setTargetAtTime(0, t + dur, 0.07);
      src.stop(t + dur + 0.45);
    }
    this.voices++;
    src.onended = () => {
      this.voices--;
      g.disconnect();
    };
  }

  private pad(note: number, t: number, dur: number, lowest: boolean): void {
    const ctx = this.ctx!;
    const type = this.style.pad;
    const peak = PAD_PEAK[type] * (this.scene === 'title' ? 0.9 : 1);
    const g = ctx.createGain();
    const attack = Math.min(dur * 0.35, 2.2);
    const end = t + dur * 1.12;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, end);
    g.connect(this.padBus);
    const f = midiHz(note);
    const extra: AudioNode[] = [];
    let live = 0;
    const osc = (wave: OscillatorType, freq: number, detune: number, level: number, dest: AudioNode = g): void => {
      const o = ctx.createOscillator();
      o.type = wave;
      o.frequency.value = freq;
      o.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(dest);
      o.start(t);
      o.stop(end + 0.05);
      live++;
      o.onended = () => {
        og.disconnect();
        if (--live > 0) return;
        for (const x of extra) x.disconnect();
        g.disconnect();
      };
    };
    switch (type) {
      case 'soft':
        osc('triangle', f, -6, 1);
        osc('triangle', f, 6, 1);
        if (lowest) osc('sine', f / 2, 0, 0.6);
        break;
      case 'warm':
        osc('sawtooth', f, -9, 1);
        osc('sawtooth', f, 0, 0.8);
        osc('sawtooth', f, 8, 1);
        break;
      case 'glass':
        osc('sine', f, -3, 1);
        osc('triangle', f, 4, 0.5);
        osc('sine', f * 2, 2, 0.22);
        break;
      case 'choir': {
        // Two saws through "oo" and "ah" formant bands.
        const formants = ctx.createGain();
        extra.push(formants);
        for (const [fc, q, lvl] of [
          [420, 5, 1],
          [850, 7, 0.55],
          [2500, 9, 0.18],
        ]) {
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = fc;
          bp.Q.value = q;
          const lg = ctx.createGain();
          lg.gain.value = lvl;
          formants.connect(bp).connect(lg).connect(g);
        }
        osc('sawtooth', f, -7, 1, formants);
        osc('sawtooth', f, 7, 1, formants);
        break;
      }
      case 'drone':
        osc('sawtooth', f / 2, -5, 1);
        osc('sawtooth', f / 2, 5, 1);
        osc('triangle', f, 0, 1.2);
        break;
    }
  }
}
