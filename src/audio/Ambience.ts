import type { BiomeId } from '../config/levels';
import { Rng } from '../engine/rng';
import { Svf, addBubble, addBubbles, addModes, addNoise, addTone, finish, trim } from './dsp';
import { renderNote } from './instruments';

type AmbientSound = 'creak' | 'groan' | 'clank' | 'iceSing' | 'whale' | 'rumble' | 'drip' | 'toll' | 'hiss' | 'lap' | 'pebbles' | 'bubbles' | 'sway' | 'glint';

interface AmbientEvent {
  sound: AmbientSound;
  /** Seconds between plays. */
  every: [number, number];
  volume: number;
}

interface AmbienceDef {
  /** Low-pass cutoff of the water bed in Hz, and its level. */
  bed: [number, number];
  /** Snapping-shrimp crackle level, for warm shallow water. */
  crackle: number;
  events: AmbientEvent[];
  /** Reverb tail (s) and wet level for world sounds in this biome. */
  space: [number, number];
}

export const AMBIENCE: Record<BiomeId, AmbienceDef> = {
  reef: { bed: [380, 0.13], crackle: 0.35, space: [1.8, 0.16], events: [{ sound: 'bubbles', every: [3, 7], volume: 0.5 }] },
  kelp: {
    bed: [340, 0.15],
    crackle: 0.12,
    space: [2.2, 0.2],
    events: [
      { sound: 'creak', every: [5, 11], volume: 0.35 },
      { sound: 'sway', every: [6, 12], volume: 0.4 },
      { sound: 'bubbles', every: [4, 9], volume: 0.4 },
    ],
  },
  wreck: {
    bed: [300, 0.16],
    crackle: 0,
    space: [2.8, 0.26],
    events: [
      { sound: 'groan', every: [8, 16], volume: 0.5 },
      { sound: 'clank', every: [10, 22], volume: 0.3 },
      { sound: 'creak', every: [7, 14], volume: 0.3 },
      { sound: 'bubbles', every: [5, 10], volume: 0.4 },
    ],
  },
  ice: {
    bed: [420, 0.12],
    crackle: 0,
    space: [2.6, 0.24],
    events: [
      { sound: 'iceSing', every: [5, 11], volume: 0.3 },
      { sound: 'whale', every: [22, 40], volume: 0.3 },
      { sound: 'bubbles', every: [6, 12], volume: 0.3 },
    ],
  },
  abyss: {
    bed: [180, 0.2],
    crackle: 0,
    space: [3.6, 0.3],
    events: [
      { sound: 'rumble', every: [9, 16], volume: 0.5 },
      { sound: 'whale', every: [16, 30], volume: 0.35 },
      { sound: 'bubbles', every: [10, 18], volume: 0.25 },
    ],
  },
  mangrove: {
    bed: [420, 0.12],
    crackle: 0.28,
    space: [1.6, 0.15],
    events: [
      { sound: 'lap', every: [3, 6], volume: 0.45 },
      { sound: 'creak', every: [10, 18], volume: 0.25 },
      { sound: 'bubbles', every: [4, 8], volume: 0.4 },
    ],
  },
  canyon: {
    bed: [380, 0.14],
    crackle: 0.28,
    space: [2.4, 0.22],
    events: [
      { sound: 'pebbles', every: [6, 13], volume: 0.4 },
      { sound: 'bubbles', every: [4, 9], volume: 0.4 },
      { sound: 'rumble', every: [18, 30], volume: 0.25 },
    ],
  },
  ruins: {
    bed: [320, 0.14],
    crackle: 0,
    space: [3, 0.26],
    events: [
      { sound: 'toll', every: [16, 30], volume: 0.25 },
      { sound: 'pebbles', every: [10, 20], volume: 0.25 },
      { sound: 'bubbles', every: [5, 10], volume: 0.35 },
      { sound: 'sway', every: [9, 15], volume: 0.3 },
    ],
  },
  crystal: {
    bed: [300, 0.13],
    crackle: 0,
    space: [4, 0.32],
    events: [
      { sound: 'drip', every: [2, 5], volume: 0.4 },
      { sound: 'glint', every: [6, 12], volume: 0.2 },
      { sound: 'bubbles', every: [8, 14], volume: 0.25 },
    ],
  },
  volcanic: {
    bed: [210, 0.18],
    crackle: 0,
    space: [3.2, 0.28],
    events: [
      { sound: 'rumble', every: [6, 11], volume: 0.55 },
      { sound: 'hiss', every: [5, 10], volume: 0.4 },
      { sound: 'bubbles', every: [3, 7], volume: 0.35 },
    ],
  },
};

const TONAL = new Set<AmbientSound>(['toll', 'glint']);

function buildAmbient(sound: AmbientSound, sr: number, rng: Rng): Float32Array {
  const out = new Float32Array(Math.ceil(4 * sr));
  switch (sound) {
    case 'creak': {
      // Stick-slip friction: a pulse train ringing a narrow wooden resonance.
      const n = Math.floor(rng.range(0.7, 1.3) * sr);
      const res = new Svf(sr);
      const f0 = rng.range(300, 450);
      let phase = 0;
      for (let i = 0; i < n; i++) {
        const k = i / n;
        const rate = 22 + 26 * Math.sin(Math.PI * k) + rng.range(-3, 3);
        phase += rate / sr;
        let x = 0;
        if (phase >= 1) {
          phase -= 1;
          x = rng.range(0.6, 1);
        }
        res.tick(x, f0 * (1 + 0.15 * k), 18);
        out[i] = res.bp * Math.sin(Math.PI * k);
      }
      break;
    }
    case 'groan': {
      const f = rng.range(55, 70);
      for (const [r, a] of [
        [1, 1],
        [2.31, 0.4],
        [3.7, 0.2],
      ]) {
        addTone(out, sr, { f: f * r, to: f * r * 0.85, glide: 1.5, attack: 0.6, hold: 0.9, decay: 0.6, amp: a, vibrato: [0.7, 0.012] });
      }
      addNoise(out, sr, rng, { length: 2.4, type: 'bp', f: 320, q: 8, attack: 0.6, decay: 0.8, amp: 0.4 });
      break;
    }
    case 'clank':
      addModes(out, sr, 0, rng.range(190, 240), [{ r: 1, a: 1, d: 1.3 }, { r: 2.43, a: 0.5, d: 0.8 }, { r: 3.9, a: 0.3, d: 0.5 }, { r: 5.2, a: 0.15, d: 0.3 }], 0.7, 0.002);
      addNoise(out, sr, rng, { length: 0.06, f: 500, amp: 0.6, decay: 0.02 });
      break;
    case 'iceSing':
      for (let i = 0, at = 0; i < rng.int(2, 4); i++, at += rng.range(0.12, 0.3)) {
        addTone(out, sr, { at, f: rng.range(2200, 3200), to: rng.range(300, 450), glide: 0.04, attack: 0.001, decay: rng.range(0.12, 0.25), amp: rng.range(0.5, 1) });
      }
      break;
    case 'whale': {
      const f = rng.range(130, 170);
      for (const [r, a] of [
        [1, 1],
        [2, 0.35],
        [3, 0.12],
      ]) {
        addTone(out, sr, { f: f * r, to: f * r * 1.55, glide: 0.7, attack: 0.6, hold: 1.1, decay: 0.7, amp: a, vibrato: [3.5, 0.012] });
      }
      break;
    }
    case 'rumble':
      addNoise(out, sr, rng, { length: 3.2, f: 50, to: 120, glide: 1, attack: 1, decay: 1.2, amp: 1.5 });
      addTone(out, sr, { f: 34, attack: 1, hold: 0.5, decay: 0.8, amp: 0.4 });
      break;
    case 'drip':
      addBubble(out, sr, 0, rng.range(1100, 1800), 1, 0.35);
      addBubble(out, sr, 0.11, rng.range(1100, 1800), 0.25, 0.35);
      break;
    case 'toll':
      return renderNote('bell', 50, sr, rng.int(1, 1e9));
    case 'hiss':
      addNoise(out, sr, rng, { length: 1.6, type: 'hp', f: 3500, attack: 0.3, decay: 0.5, amp: 0.6 });
      addBubbles(out, sr, rng, { at: 0.1, spread: 1.2, count: 9, f: [150, 400], amp: 0.5 });
      break;
    case 'lap':
      addNoise(out, sr, rng, { length: 0.7, f: 250, to: 650, glide: 0.2, attack: 0.15, decay: 0.25, amp: 1 });
      addBubbles(out, sr, rng, { at: 0.1, spread: 0.4, count: 4, f: [700, 1500], amp: 0.3 });
      break;
    case 'pebbles':
      for (let i = 0; i < rng.int(5, 9); i++) {
        const at = rng.range(0, 0.5);
        addModes(out, sr, at, rng.range(1500, 3500), [{ r: 1, a: 1, d: rng.range(0.01, 0.03) }], rng.range(0.3, 1), 0.0003);
        addTone(out, sr, { at, f: 220, to: 120, glide: 0.01, decay: 0.03, amp: 0.3 });
      }
      break;
    case 'bubbles':
      addBubbles(out, sr, rng, { at: 0, spread: rng.range(0.5, 1.3), count: rng.int(5, 12), f: [300, 1300], amp: 0.8 });
      break;
    case 'sway':
      addNoise(out, sr, rng, { length: 1.4, type: 'bp', f: 200, to: 520, glide: 0.5, q: 0.9, attack: 0.5, decay: 0.4, amp: 0.8 });
      break;
    case 'glint':
      return renderNote('glock', rng.pick([96, 100, 103]), sr, rng.int(1, 1e9));
  }
  return trim(finish(out, sr, 0.9, 1.1), sr);
}

/** A seamless 3 s loop of snapping-shrimp clicks. */
function crackleLoop(sr: number, rng: Rng): Float32Array {
  const n = Math.floor(3 * sr);
  const raw = new Float32Array(n);
  for (let c = 0; c < 900; c++) {
    const i = rng.int(0, n - 1);
    const amp = Math.pow(rng.next(), 3) * rng.sign();
    for (let k = 0; k < 12; k++) raw[(i + k) % n] += amp * Math.exp(-k / 3) * (rng.next() * 2 - 1);
  }
  // Filter two laps and keep the second so the loop point carries the filter state.
  const f = new Svf(sr);
  const out = new Float32Array(n);
  for (let lap = 0; lap < 2; lap++) {
    for (let i = 0; i < n; i++) {
      f.tick(raw[i], 3800, 0.9);
      if (lap) out[i] = f.bp;
    }
  }
  let max = 0;
  for (const v of out) max = Math.max(max, Math.abs(v));
  for (let i = 0; i < n; i++) out[i] *= 0.9 / (max || 1);
  return out;
}

function brownNoise(sr: number, seconds: number, rng: Rng): Float32Array {
  const n = Math.floor(sr * seconds);
  const d = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (rng.next() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  // Crossfade the ends so the loop has no seam.
  const fade = Math.floor(sr * 0.25);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] = d[i] * k + d[n - fade + i] * (1 - k);
  }
  return d.slice(0, n - fade);
}

/** Underwater room tone per biome: a breathing water bed, shrimp crackle and occasional distant events. */
export class Ambience {
  private ctx: BaseAudioContext | null = null;
  private out!: GainNode;
  private bedFilter!: BiquadFilterNode;
  private bed!: GainNode;
  private crackle!: GainNode;
  private def: AmbienceDef | null = null;
  private level = 1;
  private timers: number[] = [];
  private readonly buffers = new Map<AmbientSound, AudioBuffer[]>();
  private readonly rng = new Rng(4242);
  keyShift = 0;

  init(ctx: BaseAudioContext, out: AudioNode): void {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(out);
    const mk = (samples: Float32Array): AudioBuffer => {
      const b = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      b.getChannelData(0).set(samples);
      return b;
    };
    const noise = ctx.createBufferSource();
    noise.buffer = mk(brownNoise(ctx.sampleRate, 8, new Rng(9)));
    noise.loop = true;
    this.bedFilter = ctx.createBiquadFilter();
    this.bedFilter.type = 'lowpass';
    this.bedFilter.frequency.value = 380;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 140;
    lfo.connect(lfoAmt).connect(this.bedFilter.frequency);
    this.bed = ctx.createGain();
    this.bed.gain.value = 0;
    noise.connect(this.bedFilter).connect(this.bed).connect(this.out);
    noise.start();
    lfo.start();

    const shrimp = ctx.createBufferSource();
    shrimp.buffer = mk(crackleLoop(ctx.sampleRate, new Rng(31)));
    shrimp.loop = true;
    this.crackle = ctx.createGain();
    this.crackle.gain.value = 0;
    const cPan = ctx.createStereoPanner();
    cPan.pan.value = 0.25;
    shrimp.connect(cPan).connect(this.crackle).connect(this.out);
    shrimp.start();
    if (this.def) this.apply();
  }

  /** Switches the soundscape; `level` scales everything (the title screen sits lower). */
  set(biome: BiomeId, level = 1): void {
    const def = AMBIENCE[biome];
    if (def === this.def && level === this.level) return;
    if (def !== this.def) this.timers = def.events.map((e) => this.rng.range(1, e.every[1]));
    this.def = def;
    this.level = level;
    this.apply();
  }

  private apply(): void {
    const ctx = this.ctx;
    const def = this.def;
    if (!ctx || !def) return;
    const now = ctx.currentTime;
    this.bedFilter.frequency.setTargetAtTime(def.bed[0], now, 1);
    this.bed.gain.setTargetAtTime(def.bed[1] * this.level, now, 1);
    this.crackle.gain.setTargetAtTime(def.crackle * this.level, now, 1);
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const def = this.def;
    if (!ctx || !def || ctx.state !== 'running') return;
    def.events.forEach((e, i) => {
      this.timers[i] -= dt;
      if (this.timers[i] > 0) return;
      this.timers[i] = this.rng.range(e.every[0], e.every[1]);
      this.fire(e);
    });
  }

  private fire(e: AmbientEvent): void {
    const ctx = this.ctx!;
    let takes = this.buffers.get(e.sound);
    if (!takes) {
      takes = [0, 1, 2].map((i) => {
        const s = buildAmbient(e.sound, ctx.sampleRate, new Rng(500 + i * 7919 + e.sound.length));
        const b = ctx.createBuffer(1, s.length, ctx.sampleRate);
        b.getChannelData(0).set(s);
        return b;
      });
      this.buffers.set(e.sound, takes);
    }
    const src = ctx.createBufferSource();
    src.buffer = this.rng.pick(takes);
    src.playbackRate.value = (TONAL.has(e.sound) ? Math.pow(2, this.keyShift / 12) : 1) * this.rng.range(0.92, 1.08);
    const g = ctx.createGain();
    g.gain.value = e.volume * this.level * this.rng.range(0.6, 1);
    const p = ctx.createStereoPanner();
    p.pan.value = this.rng.range(-0.8, 0.8);
    src.connect(p).connect(g).connect(this.out);
    src.onended = () => g.disconnect();
    src.start();
  }
}
