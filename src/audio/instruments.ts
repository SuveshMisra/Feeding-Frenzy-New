import { Rng } from '../engine/rng';
import { addBubble, addFm, addModes, addNoise, addPluck, addTone, midiHz, trim, type Mode } from './dsp';

export type PitchedId = 'marimba' | 'kalimba' | 'glock' | 'steelpan' | 'bell' | 'ep' | 'harp' | 'koto' | 'nylon' | 'pluckBass' | 'subBass';
export type DrumId =
  | 'kick'
  | 'shaker'
  | 'rim'
  | 'woodblock'
  | 'congaLow'
  | 'congaHigh'
  | 'taiko'
  | 'doum'
  | 'tek'
  | 'glassTap'
  | 'brush'
  | 'swell'
  | 'drop';
export type InstrumentId = PitchedId | DrumId;

const DRUMS = new Set<string>(['kick', 'shaker', 'rim', 'woodblock', 'congaLow', 'congaHigh', 'taiko', 'doum', 'tek', 'glassTap', 'brush', 'swell', 'drop']);
export const isDrum = (id: InstrumentId): id is DrumId => DRUMS.has(id);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Ring time of the fundamental in seconds for a given pitch; low notes ring longer. */
const ring = (f: number, base: number, ref: number, k: number, lo: number, hi: number): number => clamp(base * Math.pow(ref / f, k), lo, hi);

/**
 * Loudness (dB RMS over the first quarter second) each instrument is matched to, so arrangements
 * balance before any mix gain. Peak normalizing instead would let a pluck's sharp attack make
 * its body far quieter than a mallet's.
 */
const BODY_DB: Record<InstrumentId, number> = {
  marimba: -8,
  kalimba: -8,
  glock: -10.5,
  steelpan: -8.5,
  bell: -9.5,
  ep: -8.5,
  harp: -9,
  koto: -9.5,
  nylon: -9,
  pluckBass: -8,
  subBass: -7.5,
  kick: -9,
  shaker: -18,
  rim: -16,
  woodblock: -15,
  congaLow: -12,
  congaHigh: -13,
  taiko: -7.5,
  doum: -8.5,
  tek: -16.5,
  glassTap: -16,
  brush: -19,
  swell: -16,
  drop: -15,
};

/** Matches BODY_DB, then rounds off anything above 0.6 so attacks stay under 0.95. */
function level(out: Float32Array, sr: number, id: InstrumentId): Float32Array {
  const n = id === 'swell' ? out.length : Math.min(out.length, Math.floor(sr * 0.25));
  let e = 0;
  for (let i = 0; i < n; i++) e += out[i] * out[i];
  const rms = Math.sqrt(e / Math.max(1, n));
  const gain = rms > 0 ? Math.pow(10, BODY_DB[id] / 20) / rms : 0;
  for (let i = 0; i < out.length; i++) {
    const x = out[i] * gain;
    const a = Math.abs(x);
    out[i] = a <= 0.6 ? x : Math.sign(x) * (0.6 + 0.35 * Math.tanh((a - 0.6) / 0.35));
  }
  const fade = Math.min(out.length, Math.max(Math.floor(sr * 0.012), Math.floor(out.length * 0.15)));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= Math.pow(i / fade, 2);
  return out;
}

/** Longest rendered note; scored notes are cut far shorter, so only stingers hear the full tail. */
const MAX_NOTE = 3.5;

function pitched(id: PitchedId, f: number, sr: number, rng: Rng): Float32Array {
  const len = (s: number): Float32Array => new Float32Array(Math.ceil(Math.min(s, MAX_NOTE) * sr));
  switch (id) {
    case 'marimba': {
      const d = ring(f, 0.5, 440, 0.55, 0.16, 1.6);
      const out = len(d * 7);
      const modes: Mode[] = [
        { r: 1, a: 1, d },
        { r: 3.93, a: 0.3, d: d * 0.22 },
        { r: 9.3, a: 0.06, d: d * 0.06 },
      ];
      addModes(out, sr, 0, f, modes, 1, 0.001);
      addNoise(out, sr, rng, { length: 0.006, type: 'bp', f: 2600, q: 1.2, amp: 0.4, decay: 0.0015 });
      return out;
    }
    case 'kalimba': {
      const d = ring(f, 1.2, 440, 0.35, 0.35, 2.6);
      const out = len(d * 6);
      addModes(
        out,
        sr,
        0,
        f,
        [
          { r: 1, a: 1, d },
          { r: 1.0035, a: 0.22, d },
          { r: 6.05, a: 0.2, d: 0.08 },
          { r: 14.8, a: 0.06, d: 0.025 },
        ],
        1,
        0.0008,
      );
      addNoise(out, sr, rng, { length: 0.004, type: 'hp', f: 3500, amp: 0.25, decay: 0.001 });
      return out;
    }
    case 'glock': {
      const d = ring(f, 1.8, 880, 0.4, 0.5, 3);
      const out = len(d * 6);
      addModes(
        out,
        sr,
        0,
        f,
        [
          { r: 1, a: 1, d },
          { r: 2.76, a: 0.32, d: d * 0.45 },
          { r: 5.4, a: 0.14, d: d * 0.22 },
          { r: 8.93, a: 0.05, d: d * 0.1 },
        ],
        1,
        0.0006,
      );
      addNoise(out, sr, rng, { length: 0.003, type: 'bp', f: 6500, q: 1.5, amp: 0.3, decay: 0.0008 });
      return out;
    }
    case 'steelpan': {
      const d = ring(f, 0.8, 440, 0.3, 0.3, 1.5);
      const out = len(d * 6);
      addModes(
        out,
        sr,
        0,
        f,
        [
          { r: 1, a: 1, d },
          { r: 2, a: 0.65, d: d * 0.7 },
          { r: 3, a: 0.28, d: d * 0.4 },
          { r: 4.02, a: 0.12, d: d * 0.25 },
        ],
        1,
        0.003,
      );
      // The pan's dent rings slightly sharp at the strike, then settles.
      addTone(out, sr, { f: f * 1.025, to: f, glide: 0.02, attack: 0.002, decay: 0.05, amp: 0.4 });
      return out;
    }
    case 'bell': {
      const d = ring(f, 3, 220, 0.4, 1.2, 5);
      const out = len(d * 4.5);
      addModes(
        out,
        sr,
        0,
        f,
        [
          { r: 0.5, a: 0.45, d: d * 1.5 },
          { r: 1, a: 1, d },
          { r: 1.183, a: 0.55, d: d * 0.8 },
          { r: 1.506, a: 0.32, d: d * 0.6 },
          { r: 2, a: 0.38, d: d * 0.5 },
          { r: 2.514, a: 0.18, d: d * 0.35 },
          { r: 3.011, a: 0.1, d: d * 0.25 },
        ],
        1,
        0.001,
      );
      addNoise(out, sr, rng, { length: 0.01, type: 'bp', f: 3000, q: 1, amp: 0.2, decay: 0.003 });
      return out;
    }
    case 'ep': {
      const d = ring(f, 1.3, 440, 0.4, 0.5, 2.6);
      const out = len(d * 5);
      addFm(out, sr, { f, ratio: 1, index: 1.6, floor: 0.2, indexDecay: 0.22, attack: 0.002, decay: d });
      // Tine "ding" on the attack.
      addFm(out, sr, { f, ratio: 14, index: 0.5, floor: 0, indexDecay: 0.02, attack: 0.001, decay: 0.05, amp: 0.25 });
      return out;
    }
    case 'harp': {
      const d = ring(f, 2.4, 220, 0.35, 0.7, 3.6);
      const out = len(d * 1.1);
      addPluck(out, sr, rng, { f, decay: d, bright: 0.72, pick: 0.14 });
      return out;
    }
    case 'koto': {
      const d = ring(f, 1.5, 220, 0.3, 0.5, 2.2);
      const out = len(d * 1.1);
      addPluck(out, sr, rng, { f, decay: d, bright: 0.9, pick: 0.08 });
      return out;
    }
    case 'nylon': {
      const d = ring(f, 2, 220, 0.3, 0.6, 2.8);
      const out = len(d * 1.1);
      addPluck(out, sr, rng, { f, decay: d, bright: 0.45, pick: 0.18 });
      return out;
    }
    case 'pluckBass': {
      const out = len(1.8);
      addPluck(out, sr, rng, { f, decay: 1.5, bright: 0.3, pick: 0.2 });
      addTone(out, sr, { f, attack: 0.004, decay: 0.45, amp: 0.45 });
      return out;
    }
    case 'subBass': {
      const out = len(2.2);
      addTone(out, sr, { f, attack: 0.012, decay: 0.7, amp: 1 });
      // Upper harmonics keep the line audible on small speakers that can't reproduce the fundamental.
      addTone(out, sr, { f: f * 2, attack: 0.008, decay: 0.35, amp: 0.42 });
      addTone(out, sr, { f: f * 3, attack: 0.006, decay: 0.15, amp: 0.14 });
      return out;
    }
  }
}

function drum(id: DrumId, sr: number, rng: Rng): Float32Array {
  const len = (s: number): Float32Array => new Float32Array(Math.ceil(s * sr));
  const v = (): number => rng.range(0.97, 1.03);
  switch (id) {
    case 'kick': {
      const out = len(0.6);
      addTone(out, sr, { f: 150 * v(), to: 46, glide: 0.035, attack: 0.001, decay: 0.2 });
      addNoise(out, sr, rng, { length: 0.012, f: 1100, amp: 0.35, decay: 0.003 });
      return out;
    }
    case 'shaker': {
      const out = len(0.12);
      addNoise(out, sr, rng, { length: 0.11, type: 'bp', f: 7500 * v(), q: 1.3, attack: 0.014, decay: 0.028 });
      return out;
    }
    case 'rim': {
      const out = len(0.12);
      addModes(out, sr, 0, 1650 * v(), [{ r: 1, a: 1, d: 0.022 }, { r: 2.43, a: 0.4, d: 0.012 }], 1, 0.0005);
      addNoise(out, sr, rng, { length: 0.006, type: 'bp', f: 3200, q: 1, amp: 0.5, decay: 0.0015 });
      return out;
    }
    case 'woodblock': {
      const out = len(0.25);
      addModes(out, sr, 0, 780 * v(), [{ r: 1, a: 1, d: 0.05 }, { r: 2.68, a: 0.28, d: 0.025 }], 1, 0.0005);
      addNoise(out, sr, rng, { length: 0.005, type: 'bp', f: 2500, q: 1, amp: 0.4, decay: 0.0012 });
      return out;
    }
    case 'congaLow':
    case 'congaHigh': {
      const f = (id === 'congaLow' ? 190 : 290) * v();
      const out = len(0.45);
      addTone(out, sr, { f: f * 1.25, to: f, glide: 0.018, attack: 0.001, decay: id === 'congaLow' ? 0.16 : 0.11 });
      addTone(out, sr, { f: f * 1.59, attack: 0.001, decay: 0.05, amp: 0.3 });
      addTone(out, sr, { f: f * 2.14, attack: 0.001, decay: 0.03, amp: 0.15 });
      addNoise(out, sr, rng, { length: 0.02, type: 'bp', f: 1600, q: 0.9, amp: 0.45, decay: 0.005 });
      return out;
    }
    case 'taiko': {
      const out = len(1.2);
      addTone(out, sr, { f: 105 * v(), to: 56, glide: 0.06, attack: 0.002, decay: 0.45 });
      addTone(out, sr, { f: 168, to: 92, glide: 0.05, attack: 0.002, decay: 0.12, amp: 0.3 });
      addNoise(out, sr, rng, { length: 0.5, f: 420, to: 160, glide: 0.1, amp: 0.9, decay: 0.12 });
      return out;
    }
    case 'doum': {
      const out = len(0.7);
      addTone(out, sr, { f: 92 * v(), to: 68, glide: 0.04, attack: 0.002, decay: 0.3 });
      addNoise(out, sr, rng, { length: 0.2, f: 300, amp: 0.5, decay: 0.05 });
      return out;
    }
    case 'tek': {
      const out = len(0.12);
      addNoise(out, sr, rng, { length: 0.03, type: 'bp', f: 2600 * v(), q: 1.4, amp: 1, decay: 0.008 });
      addTone(out, sr, { f: 620, attack: 0.0005, decay: 0.025, amp: 0.4 });
      return out;
    }
    case 'glassTap': {
      const out = len(0.6);
      const f = 2093 * v();
      addModes(out, sr, 0, f, [{ r: 1, a: 1, d: 0.22 }, { r: 2.76, a: 0.3, d: 0.08 }], 1, 0.0004);
      return out;
    }
    case 'brush': {
      const out = len(0.25);
      addNoise(out, sr, rng, { length: 0.24, type: 'bp', f: 3800 * v(), q: 0.7, attack: 0.035, decay: 0.07 });
      return out;
    }
    case 'swell': {
      // A reversed-cymbal style rise into the next section.
      const out = len(1.9);
      addNoise(out, sr, rng, { length: 1.85, type: 'bp', f: 500, to: 7000, glide: 1.6, q: 0.6, attack: 1.7, amp: 1 });
      return out;
    }
    case 'drop': {
      // A single wet bubble "bloop" used as percussion.
      const out = len(0.2);
      addBubble(out, sr, 0, 520 * v(), 1, 0.22);
      return out;
    }
  }
}

/** Renders one note (or drum take) as mono samples. Pure and deterministic per seed. */
export function renderNote(id: InstrumentId, midi: number, sr: number, seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = isDrum(id) ? drum(id, sr, rng) : pitched(id, midiHz(midi), sr, rng);
  return trim(level(out, sr, id), sr);
}
