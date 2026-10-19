import { Rng } from '../engine/rng';
import { Svf, finish } from './dsp';

export interface CrunchPreset {
  /** Total length in seconds. */
  length: number;
  /** Jaw snap: a sine falling from `from` to `to` Hz that dies away with time constant `decay`. */
  thump: { from: number; to: number; decay: number; level: number };
  /** Each bite is a cluster of noise grains starting at `at` and spreading over `spread` seconds. */
  bites: { at: number; grains: [number, number]; spread: number; level: number }[];
  grainLength: [number, number];
  /** Centre frequencies (Hz) the grains are band-passed around. */
  band: [number, number];
  /** Tiny brittle clicks scattered through the bites. */
  crackle: { count: [number, number]; band: [number, number]; level: number };
  /** Low, wet squelch under the crunch. */
  body: { cutoff: number; decay: number; level: number };
  /** Soft-clip drive before peak normalizing; more drive packs more loudness under the same peak. */
  drive: number;
}

export const CRUNCH_SMALL: CrunchPreset = {
  length: 0.2,
  thump: { from: 320, to: 120, decay: 0.014, level: 0.5 },
  bites: [{ at: 0, grains: [5, 8], spread: 0.09, level: 1 }],
  grainLength: [0.003, 0.012],
  band: [1300, 4200],
  crackle: { count: [6, 10], band: [3200, 7000], level: 0.55 },
  body: { cutoff: 900, decay: 0.035, level: 0.35 },
  drive: 2.4,
};

export const CRUNCH_MID: CrunchPreset = {
  length: 0.28,
  thump: { from: 260, to: 85, decay: 0.022, level: 0.7 },
  bites: [
    { at: 0, grains: [7, 10], spread: 0.1, level: 1 },
    { at: 0.11, grains: [3, 5], spread: 0.07, level: 0.55 },
  ],
  grainLength: [0.003, 0.016],
  band: [900, 3400],
  crackle: { count: [7, 12], band: [2600, 6200], level: 0.5 },
  body: { cutoff: 700, decay: 0.05, level: 0.42 },
  drive: 2.1,
};

export const CRUNCH_BIG: CrunchPreset = {
  length: 0.4,
  thump: { from: 200, to: 62, decay: 0.035, level: 0.85 },
  bites: [
    { at: 0, grains: [8, 11], spread: 0.11, level: 1 },
    { at: 0.16, grains: [5, 8], spread: 0.12, level: 0.7 },
  ],
  grainLength: [0.004, 0.02],
  band: [650, 2800],
  crackle: { count: [8, 14], band: [2200, 5500], level: 0.45 },
  body: { cutoff: 520, decay: 0.08, level: 0.5 },
  drive: 1.8,
};

/** A bite: jaw snap, clusters of band-passed noise grains, crackles and a wet body. */
export function synthCrunch(p: CrunchPreset, sampleRate: number, seed: number): Float32Array {
  const rng = new Rng(seed);
  const n = Math.ceil(p.length * sampleRate);
  const out = new Float32Array(n);

  const th = p.thump;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t / th.decay);
    if (env < 1e-4) break;
    const f = th.to + (th.from - th.to) * Math.exp(-t / (th.decay * 0.6));
    phase += (2 * Math.PI * f) / sampleRate;
    out[i] += Math.sin(phase) * env * Math.min(1, t / 0.0015) * th.level;
  }

  const body = new Svf(sampleRate);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    body.tick(rng.next() * 2 - 1, p.body.cutoff, 0.8);
    out[i] += body.lp * Math.min(1, t / 0.004) * Math.exp(-t / p.body.decay) * p.body.level * 2.5;
  }

  const grain = (start: number, length: number, centre: number, q: number, amp: number): void => {
    const filt = new Svf(sampleRate);
    const s0 = Math.floor(start * sampleRate);
    const m = Math.max(1, Math.floor(length * sampleRate));
    const attack = sampleRate * 0.0005;
    for (let i = 0; i < m && s0 + i < n; i++) {
      filt.tick(rng.next() * 2 - 1, centre, q);
      out[s0 + i] += filt.bp * Math.min(1, i / attack) * Math.exp((-i / m) * 4.5) * amp;
    }
  };

  for (const bite of p.bites) {
    const count = rng.int(bite.grains[0], bite.grains[1]);
    for (let g = 0; g < count; g++) {
      // Grains bunch up at the start of a bite, like the first crack followed by smaller breaks.
      const offset = g === 0 ? 0 : Math.pow(rng.next(), 1.5) * bite.spread;
      const fall = 1 - (0.5 * offset) / bite.spread;
      const amp = bite.level * (g === 0 ? 1 : rng.range(0.35, 0.95)) * fall * 2.4;
      grain(bite.at + offset, rng.range(p.grainLength[0], p.grainLength[1]), rng.range(p.band[0], p.band[1]), rng.range(0.7, 1.8), amp);
    }
    const crackles = rng.int(p.crackle.count[0], p.crackle.count[1]);
    for (let c = 0; c < Math.ceil(crackles / p.bites.length); c++) {
      const offset = rng.next() * bite.spread * 1.2;
      grain(bite.at + offset, rng.range(0.0004, 0.0012), rng.range(p.crackle.band[0], p.crackle.band[1]), 1.2, p.crackle.level * bite.level * 3);
    }
  }
  return finish(out, sampleRate, 0.9, p.drive);
}

/**
 * A long inhale: noise band-passed through a falling sweep with a swirling wobble,
 * a low rush underneath, and a wet "gulp" at the end.
 */
export function synthSlurp(sampleRate: number, seed: number): Float32Array {
  const rng = new Rng(seed);
  const length = 1.35;
  const n = Math.ceil(length * sampleRate);
  const out = new Float32Array(n);
  const sweep = new Svf(sampleRate);
  const rush = new Svf(sampleRate);
  const swirl = rng.range(11, 15);
  const inhale = 1.12;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    if (t > inhale + 0.05) break;
    const k = Math.min(1, t / inhale);
    const env = Math.min(1, t / 0.08) * (1 - Math.pow(k, 6)) * (0.7 + 0.3 * k);
    const wob = 1 + 0.28 * Math.sin(2 * Math.PI * swirl * t + Math.sin(t * 7) * 1.5);
    const cutoff = (2600 * Math.pow(1 - k, 1.4) + 380) * wob;
    const x = rng.next() * 2 - 1;
    sweep.tick(x, cutoff, 2.2);
    rush.tick(x, 220, 0.7);
    out[i] = (sweep.bp * 1.3 + rush.lp * 0.9) * env;
  }
  // Gulp: a falling, quickly damped sine with a little noise bite.
  const g0 = Math.floor((inhale - 0.04) * sampleRate);
  let ph = 0;
  for (let i = 0; g0 + i < n; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, t / 0.003) * Math.exp(-t / 0.055);
    if (env < 1e-4) break;
    const f = 110 + 260 * Math.exp(-t / 0.03);
    ph += (2 * Math.PI * f) / sampleRate;
    out[g0 + i] += (Math.sin(ph) * 1.1 + (rng.next() * 2 - 1) * 0.15 * Math.exp(-t / 0.01)) * env;
  }
  return finish(out, sampleRate, 0.9, 1.6);
}

/** A watery dash: band-passed noise sweeping up and back down, a low rush and a few bubbles. */
export function synthWhoosh(sampleRate: number, seed: number): Float32Array {
  const rng = new Rng(seed);
  const n = Math.ceil(0.5 * sampleRate);
  const out = new Float32Array(n);
  const sweep = new Svf(sampleRate);
  const rush = new Svf(sampleRate);
  const peakAt = 0.07;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const rising = t < peakAt;
    const env = rising ? t / peakAt : Math.exp(-(t - peakAt) / 0.13);
    const cutoff = rising ? 500 + 1700 * (t / peakAt) : 450 + 1750 * Math.exp(-(t - peakAt) / 0.12);
    const x = rng.next() * 2 - 1;
    sweep.tick(x, cutoff, 1.1);
    rush.tick(x, 180, 0.7);
    out[i] = (sweep.bp + rush.lp * 1.2) * env;
  }
  const bubbles = rng.int(4, 7);
  for (let b = 0; b < bubbles; b++) {
    const s0 = Math.floor(rng.range(0.04, 0.32) * sampleRate);
    const m = Math.floor(rng.range(0.012, 0.03) * sampleRate);
    const f0 = rng.range(600, 1300);
    const amp = rng.range(0.25, 0.5);
    let ph = 0;
    for (let i = 0; i < m && s0 + i < n; i++) {
      const u = i / m;
      ph += (2 * Math.PI * f0 * (1 + u * 1.2)) / sampleRate;
      out[s0 + i] += Math.sin(ph) * Math.sin(Math.PI * u) * amp;
    }
  }
  return finish(out, sampleRate, 0.9, 1.2);
}
