import type { Rng } from '../engine/rng';

export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** State-variable filter (Simper's trapezoidal form); the cutoff may change every sample. */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  /** Band-pass output, 0 dB at the centre frequency. */
  bp = 0;
  lp = 0;
  hp = 0;

  private cutoff = -1;
  private q = -1;
  private k = 1;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;

  constructor(private readonly sampleRate: number) {}

  tick(x: number, cutoff: number, q: number): void {
    // Coefficients need a tan(); recompute only when the cutoff moves by more than 0.1%.
    if (q !== this.q || Math.abs(cutoff - this.cutoff) > this.cutoff * 0.001) {
      this.cutoff = cutoff;
      this.q = q;
      const g = Math.tan((Math.PI * Math.min(cutoff, this.sampleRate * 0.45)) / this.sampleRate);
      this.k = 1 / q;
      this.a1 = 1 / (1 + g * (g + this.k));
      this.a2 = g * this.a1;
      this.a3 = g * this.a2;
    }
    const { k, a1, a2, a3 } = this;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.bp = v1 * k;
    this.lp = v2;
    this.hp = x - k * v1 - v2;
  }
}

/** Soft-clips, normalizes to `peak` and fades the last few milliseconds to avoid a click. */
export function finish(out: Float32Array, sampleRate: number, peak: number, drive: number): Float32Array {
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.tanh(out[i] * drive);
    max = Math.max(max, Math.abs(out[i]));
  }
  const gain = max > 0 ? peak / max : 0;
  const fade = Math.min(out.length, Math.floor(sampleRate * 0.012));
  for (let i = 0; i < out.length; i++) {
    const tail = i >= out.length - fade ? (out.length - i) / fade : 1;
    out[i] *= gain * tail;
  }
  return out;
}

/** Drops trailing near-silence so buffers end soon after the sound does. */
export function trim(out: Float32Array, sampleRate: number, floor = 3e-4): Float32Array {
  let end = out.length;
  while (end > 1 && Math.abs(out[end - 1]) < floor) end--;
  end = Math.min(out.length, end + Math.floor(sampleRate * 0.01));
  return end < out.length ? out.slice(0, end) : out;
}

export function mixIn(out: Float32Array, src: Float32Array, sampleRate: number, at: number, gain: number): void {
  const s0 = Math.floor(at * sampleRate);
  for (let i = 0; i < src.length && s0 + i < out.length; i++) out[s0 + i] += src[i] * gain;
}

export interface ToneOpts {
  at?: number;
  f: number;
  /** Frequency the tone glides to, approaching it with time constant `glide`. */
  to?: number;
  glide?: number;
  attack?: number;
  /** Seconds held at full level after the attack. */
  hold?: number;
  /** Exponential decay time constant after the hold. */
  decay: number;
  amp?: number;
  /** [rate Hz, depth as a fraction of the frequency] */
  vibrato?: [number, number];
  /** [rate Hz, depth 0..1] */
  tremolo?: [number, number];
}

/** A sine with an attack/hold/exponential-decay envelope and an optional glide. */
export function addTone(out: Float32Array, sr: number, o: ToneOpts): void {
  const s0 = Math.floor((o.at ?? 0) * sr);
  const attack = Math.max(1e-4, o.attack ?? 0.002);
  const hold = o.hold ?? 0;
  const amp = o.amp ?? 1;
  const glide = o.glide ?? 0.05;
  // Envelope and glide advance by constant per-sample factors instead of an exp() each sample.
  const attackN = attack * sr;
  const sustainN = (attack + hold) * sr;
  const kEnv = Math.exp(-1 / (o.decay * sr));
  const kGlide = Math.exp(-1 / (glide * sr));
  const base = o.to ?? o.f;
  let dif = o.to === undefined ? 0 : o.f - o.to;
  const w = (2 * Math.PI) / sr;
  const vib = o.vibrato;
  const trem = o.tremolo;
  let env = 1;
  let ph = 0;
  for (let i = 0; s0 + i < out.length; i++) {
    let e: number;
    if (i < attackN) e = i / attackN;
    else if (i < sustainN) e = 1;
    else {
      env *= kEnv;
      if (env < 3e-4) break;
      e = env;
    }
    let f = base + dif;
    dif *= kGlide;
    if (vib) f *= 1 + vib[1] * Math.sin(w * vib[0] * i);
    if (f >= sr * 0.48) continue;
    ph += w * f;
    if (trem) e *= 1 - trem[1] * (0.5 + 0.5 * Math.sin(w * trem[0] * i));
    out[s0 + i] += Math.sin(ph) * e * amp;
  }
}

export interface NoiseOpts {
  at?: number;
  length: number;
  attack?: number;
  /** Exponential decay time constant after the attack; omitted holds until the end. */
  decay?: number;
  type?: 'lp' | 'bp' | 'hp';
  f: number;
  to?: number;
  glide?: number;
  q?: number;
  amp?: number;
}

/** Filtered white noise; the filter can glide like a tone. Fades over the final 15% of `length`. */
export function addNoise(out: Float32Array, sr: number, rng: Rng, o: NoiseOpts): void {
  const s0 = Math.floor((o.at ?? 0) * sr);
  const n = Math.floor(o.length * sr);
  const attack = Math.max(1e-4, o.attack ?? 0.002);
  const q = o.q ?? 0.8;
  const amp = o.amp ?? 1;
  const glide = o.glide ?? 0.1;
  const filt = new Svf(sr);
  const type = o.type ?? 'lp';
  const attackN = attack * sr;
  const kEnv = o.decay ? Math.exp(-1 / (o.decay * sr)) : 1;
  const kGlide = Math.exp(-1 / (glide * sr));
  const base = o.to ?? o.f;
  let dif = o.to === undefined ? 0 : o.f - o.to;
  let decay = 1;
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    const k = i / n;
    let env: number;
    if (i < attackN) env = i / attackN;
    else {
      decay *= kEnv;
      if (decay < 3e-4) break;
      env = decay;
    }
    if (k > 0.85) env *= (1 - k) / 0.15;
    filt.tick(rng.next() * 2 - 1, base + dif, q);
    dif *= kGlide;
    const y = type === 'lp' ? filt.lp : type === 'bp' ? filt.bp : filt.hp;
    out[s0 + i] += y * env * amp;
  }
}

/**
 * One air bubble ringing at its Minnaert frequency: a damped sine whose pitch rises as the
 * bubble nears the surface (van den Doel's model).
 */
export function addBubble(out: Float32Array, sr: number, at: number, f0: number, amp: number, rise = 0.1): void {
  const s0 = Math.floor(at * sr);
  const d = 0.13 * f0 + 0.0072 * Math.pow(f0, 1.5);
  const k = Math.exp(-d / sr);
  const attackN = 0.0006 * sr;
  let env = 1;
  let ph = 0;
  for (let i = 0; s0 + i < out.length; i++) {
    env *= k;
    if (env < 1e-3) break;
    ph += (2 * Math.PI * f0 * (1 + (rise * d * i) / sr)) / sr;
    out[s0 + i] += Math.sin(ph) * env * Math.min(1, i / attackN) * amp;
  }
}

export interface BubbleCloud {
  at: number;
  spread: number;
  count: number;
  f: [number, number];
  amp: number;
  rise?: number;
  /** Bias of the timing distribution: >1 crowds bubbles at the start. */
  bunch?: number;
}

export function addBubbles(out: Float32Array, sr: number, rng: Rng, o: BubbleCloud): void {
  for (let i = 0; i < o.count; i++) {
    const at = o.at + Math.pow(rng.next(), o.bunch ?? 1) * o.spread;
    // Big bubbles are rarer, so frequencies lean high.
    const f = o.f[0] * Math.pow(o.f[1] / o.f[0], Math.pow(rng.next(), 0.7));
    addBubble(out, sr, at, f, o.amp * rng.range(0.4, 1), o.rise ?? rng.range(0.06, 0.16));
  }
}

/** Ratio to the fundamental, relative amplitude and decay time constant (s). */
export interface Mode {
  r: number;
  a: number;
  d: number;
}

/** A struck resonator as a sum of decaying sine modes, e.g. a marimba bar or a bell. */
export function addModes(out: Float32Array, sr: number, at: number, f: number, modes: Mode[], amp: number, attack = 0.0015): void {
  const s0 = Math.floor(at * sr);
  const attackN = Math.max(1, attack * sr);
  for (const m of modes) {
    if (f * m.r > sr * 0.45) continue;
    // Each mode is a decaying phasor rotated per sample: four multiplies, no trig in the loop.
    const w = (2 * Math.PI * f * m.r) / sr;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const k = Math.exp(-1 / (m.d * sr));
    const a = amp * m.a;
    const n = Math.min(out.length - s0, Math.ceil(m.d * sr * 8.1));
    let re = 1;
    let im = 0;
    for (let i = 0; i < n; i++) {
      out[s0 + i] += im * a * (i < attackN ? i / attackN : 1);
      const nr = (re * cw - im * sw) * k;
      im = (re * sw + im * cw) * k;
      re = nr;
    }
  }
}

export interface PluckOpts {
  at?: number;
  f: number;
  /** Seconds for the fundamental to fall 60 dB. */
  decay: number;
  /** 0 = dull (heavy loop damping) .. 1 = bright. */
  bright: number;
  amp?: number;
  /** Pluck position along the string, 0..0.5; near the end sounds thinner. */
  pick?: number;
}

/** Karplus-Strong plucked string with an allpass for exact tuning. */
export function addPluck(out: Float32Array, sr: number, rng: Rng, o: PluckOpts): void {
  const s0 = Math.floor((o.at ?? 0) * sr);
  const period = sr / o.f;
  const s = 0.5 * (1 - Math.min(1, Math.max(0, o.bright)));
  let len = Math.floor(period - s - 0.1);
  let frac = period - s - len;
  if (frac < 0.1) {
    len--;
    frac++;
  }
  len = Math.max(2, len);
  const c = (1 - frac) / (1 + frac);
  const g = Math.pow(10, -3 / (o.decay * o.f));
  const buf = new Float32Array(len);
  // Excitation: noise softened to taste, with a comb notch for the pick position.
  const pre = new Svf(sr);
  const exc = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    pre.tick(rng.next() * 2 - 1, 1200 + 9000 * o.bright, 0.7);
    exc[i] = pre.lp;
  }
  const pd = Math.floor(len * (o.pick ?? 0.13));
  let mean = 0;
  for (let i = 0; i < len; i++) {
    buf[i] = exc[i] - (i >= pd ? exc[i - pd] : 0) * 0.9;
    mean += buf[i];
  }
  mean /= len;
  for (let i = 0; i < len; i++) buf[i] -= mean;
  const amp = o.amp ?? 1;
  const n = Math.floor(o.decay * 1.1 * sr);
  let idx = 0;
  let prev = 0;
  let apX = 0;
  let apY = 0;
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    const x = buf[idx];
    const lp = (1 - s) * x + s * prev;
    prev = x;
    const ap = c * lp + apX - c * apY;
    apX = lp;
    apY = ap;
    buf[idx] = ap * g;
    idx = idx + 1 === len ? 0 : idx + 1;
    out[s0 + i] += x * amp;
  }
}

/** Phase-modulation tone: carrier ratio 1, modulator `ratio`, modulation index decaying from `index` to `floor`. */
export function addFm(
  out: Float32Array,
  sr: number,
  o: { at?: number; f: number; ratio: number; index: number; floor: number; indexDecay: number; attack?: number; decay: number; amp?: number },
): void {
  const s0 = Math.floor((o.at ?? 0) * sr);
  const attack = o.attack ?? 0.002;
  const attackN = Math.max(1, attack * sr);
  const kEnv = Math.exp(-1 / (o.decay * sr));
  const kIdx = Math.exp(-1 / (o.indexDecay * sr));
  const dc = (2 * Math.PI * o.f) / sr;
  const dm = dc * o.ratio;
  const amp = o.amp ?? 1;
  let env = 1;
  let idx = o.index - o.floor;
  for (let i = 0; s0 + i < out.length; i++) {
    let e: number;
    if (i < attackN) e = i / attackN;
    else {
      env *= kEnv;
      if (env < 3e-4) break;
      e = env;
    }
    out[s0 + i] += Math.sin(dc * i + (o.floor + idx) * Math.sin(dm * i)) * e * amp;
    idx *= kIdx;
  }
}

/** Stereo-free convolution reverb impulse: decaying, gently darkening noise. */
export function reverbImpulse(sr: number, seconds: number, rng: Rng, damp = 0.3): [Float32Array, Float32Array] {
  const len = Math.floor(sr * seconds);
  const chans: [Float32Array, Float32Array] = [new Float32Array(len), new Float32Array(len)];
  for (const d of chans) {
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      // Highs die faster than lows, like water and rock absorbing them.
      const a = Math.max(0.04, 0.9 - k * (0.9 - damp * 0.3));
      lp += (rng.next() * 2 - 1 - lp) * a;
      d[i] = lp * Math.pow(1 - k, 2.6) * (i < sr * 0.004 ? i / (sr * 0.004) : 1);
    }
  }
  return chans;
}
