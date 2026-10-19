import { Rng } from '../engine/rng';
import { addBubble, addBubbles, addModes, addNoise, addTone, finish, mixIn, trim } from './dsp';
import { renderNote, type InstrumentId } from './instruments';
import { CRUNCH_BIG, CRUNCH_MID, CRUNCH_SMALL, synthCrunch, synthSlurp, synthWhoosh, type CrunchPreset } from './synth';

export interface SoundDef {
  /** Distinct takes; play() never repeats the previous one back to back. */
  takes: number;
  /** Mix level applied when played. */
  gain: number;
  /** World sounds pass through the underwater filter and biome reverb; UI sounds stay dry. */
  bus: 'world' | 'ui';
  /** Built in C; shifted into the music's key when played. */
  tonal?: boolean;
  /** Minimum seconds between two plays. */
  gap?: number;
  build: (sr: number, rng: Rng) => Float32Array;
}

const buf = (sr: number, seconds: number): Float32Array => new Float32Array(Math.ceil(seconds * sr));
const done = (out: Float32Array, sr: number, drive = 1.2): Float32Array => trim(finish(out, sr, 0.9, drive), sr);

/** Mixes one instrument note into `out` at time `at`. */
function note(out: Float32Array, sr: number, rng: Rng, inst: InstrumentId, midi: number, at: number, gain: number): void {
  mixIn(out, renderNote(inst, midi, sr, rng.int(1, 1e9)), sr, at, gain);
}

/** A sequence of notes, `gap` seconds apart. */
function run(out: Float32Array, sr: number, rng: Rng, inst: InstrumentId, midis: number[], at: number, gap: number, gain: number, fall = 0): void {
  midis.forEach((m, i) => note(out, sr, rng, inst, m, at + i * gap, gain * (1 - fall * (i / Math.max(1, midis.length - 1)))));
}

/** Short dispersive "pew": high frequencies arrive first, like ice or a taut cable cracking. */
function chirp(out: Float32Array, sr: number, at: number, from: number, to: number, amp: number, decay = 0.05): void {
  addTone(out, sr, { at, f: from, to, glide: 0.012, attack: 0.0004, decay, amp });
}

interface ChompOpts {
  crunch: CrunchPreset;
  /** Teeth snapping together: centre frequency and level. */
  clack: [number, number];
  /** Low punch under the bite, Hz from -> to. */
  thump: [number, number];
  /** The swallow: start time, Hz from -> to. */
  gulp: [number, number, number];
  bubbles: number;
  length: number;
}

/** A bite with weight: teeth clack, crunch, a low thump, then a wet gulp and a few bubbles. */
function chomp(sr: number, rng: Rng, o: ChompOpts): Float32Array {
  const out = buf(sr, o.length);
  const [clackF, clackAmp] = o.clack;
  addModes(out, sr, 0, clackF * rng.range(0.92, 1.08), [{ r: 1, a: 1, d: 0.004 }, { r: 2.3, a: 0.5, d: 0.0025 }, { r: 3.9, a: 0.3, d: 0.0015 }], clackAmp, 0.0003);
  addNoise(out, sr, rng, { length: 0.008, type: 'hp', f: 2800, decay: 0.0018, amp: clackAmp * 0.6 });
  mixIn(out, synthCrunch(o.crunch, sr, rng.int(1, 1e9)), sr, 0.004, 0.85);
  addTone(out, sr, { f: o.thump[0], to: o.thump[1], glide: 0.025, attack: 0.001, decay: 0.055, amp: 0.85 });
  const [at, from, to] = o.gulp;
  const g = rng.range(0.94, 1.06);
  addTone(out, sr, { at, f: from * g, to: to * g, glide: 0.035, attack: 0.004, decay: 0.06, amp: 0.6 });
  addNoise(out, sr, rng, { at, length: 0.08, f: 750, to: 260, glide: 0.03, attack: 0.003, decay: 0.03, amp: 0.35 });
  addBubbles(out, sr, rng, { at: at + 0.02, spread: 0.16, count: o.bubbles, f: [500, 1400], amp: 0.2, bunch: 1.4 });
  return done(out, sr, 1.5);
}

export const SOUND_DEFS = {
  eat: {
    takes: 5,
    gain: 0.85,
    bus: 'world',
    gap: 0.03,
    build: (sr, rng) => chomp(sr, rng, { crunch: CRUNCH_SMALL, clack: [3200, 0.55], thump: [240, 95], gulp: [0.055, 430, 170], bubbles: 2, length: 0.35 }),
  },
  eatMid: {
    takes: 4,
    gain: 0.92,
    bus: 'world',
    gap: 0.03,
    build: (sr, rng) => chomp(sr, rng, { crunch: CRUNCH_MID, clack: [2600, 0.65], thump: [170, 62], gulp: [0.085, 310, 115], bubbles: 3, length: 0.45 }),
  },
  eatBig: {
    takes: 4,
    gain: 1,
    bus: 'world',
    build: (sr, rng) => chomp(sr, rng, { crunch: CRUNCH_BIG, clack: [2100, 0.75], thump: [120, 44], gulp: [0.13, 220, 80], bubbles: 5, length: 0.6 }),
  },
  boost: {
    takes: 3,
    gain: 0.57,
    bus: 'world',
    gap: 0.2,
    build: (sr, rng) => {
      const out = synthWhoosh(sr, rng.int(1, 1e9));
      addBubbles(out, sr, rng, { at: 0.05, spread: 0.35, count: 6, f: [500, 1400], amp: 0.25 });
      return done(out, sr, 1);
    },
  },
  slurp: { takes: 2, gain: 0.66, bus: 'world', build: (sr, rng) => synthSlurp(sr, rng.int(1, 1e9)) },

  bubble: {
    takes: 8,
    gain: 0.5,
    bus: 'world',
    gap: 0.05,
    build: (sr, rng) => {
      const out = buf(sr, 0.25);
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) addBubble(out, sr, i * rng.range(0.03, 0.07), rng.range(550, 1500), rng.range(0.6, 1), rng.range(0.08, 0.2));
      return done(out, sr, 1);
    },
  },
  grow: {
    takes: 1,
    gain: 0.77,
    bus: 'world',
    tonal: true,
    build: (sr, rng) => {
      const out = buf(sr, 2);
      addTone(out, sr, { f: 70, to: 140, glide: 0.25, attack: 0.02, decay: 0.3, amp: 0.7 });
      run(out, sr, rng, 'harp', [60, 64, 67, 72, 76, 79, 84], 0.02, 0.04, 0.55);
      note(out, sr, rng, 'glock', 84, 0.32, 0.5);
      note(out, sr, rng, 'glock', 91, 0.32, 0.3);
      addBubbles(out, sr, rng, { at: 0, spread: 0.6, count: 16, f: [350, 1400], amp: 0.22, bunch: 0.8 });
      return done(out, sr, 1.1);
    },
  },
  complete: {
    takes: 1,
    gain: 0.9,
    bus: 'world',
    tonal: true,
    build: (sr, rng) => {
      const out = buf(sr, 3);
      addTone(out, sr, { f: 110, to: 55, glide: 0.08, attack: 0.002, decay: 0.35, amp: 0.6 });
      run(out, sr, rng, 'harp', [60, 64, 67, 72, 76, 79, 84, 88], 0, 0.045, 0.5);
      for (const m of [72, 76, 79, 84]) note(out, sr, rng, 'glock', m, 0.4, 0.32);
      note(out, sr, rng, 'kalimba', 60, 0.4, 0.5);
      addBubbles(out, sr, rng, { at: 0.05, spread: 0.9, count: 24, f: [300, 1500], amp: 0.18 });
      return done(out, sr, 1.1);
    },
  },
  frenzy: {
    takes: 1,
    gain: 0.58,
    bus: 'world',
    tonal: true,
    build: (sr, rng) => {
      const out = buf(sr, 1.3);
      addNoise(out, sr, rng, { length: 0.45, type: 'bp', f: 400, to: 3200, glide: 0.25, q: 1.4, attack: 0.25, decay: 0.08, amp: 0.6 });
      run(out, sr, rng, 'glock', [72, 74, 76, 79, 81, 84], 0.08, 0.035, 0.5);
      note(out, sr, rng, 'glock', 88, 0.3, 0.35);
      return done(out, sr);
    },
  },
  death: {
    takes: 2,
    gain: 0.95,
    bus: 'world',
    build: (sr, rng) => {
      const out = buf(sr, 1.4);
      mixIn(out, synthCrunch(CRUNCH_BIG, sr, rng.int(1, 1e9)), sr, 0, 0.9);
      addTone(out, sr, { f: 140, to: 38, glide: 0.08, attack: 0.002, decay: 0.28, amp: 0.9 });
      addNoise(out, sr, rng, { at: 0.02, length: 0.7, f: 600, to: 150, glide: 0.2, amp: 0.5, decay: 0.2 });
      addBubbles(out, sr, rng, { at: 0.08, spread: 0.8, count: 20, f: [140, 600], amp: 0.35, bunch: 1.6 });
      return done(out, sr, 1.4);
    },
  },
  alert: {
    takes: 2,
    gain: 0.44,
    bus: 'world',
    tonal: true,
    gap: 0.12,
    build: (sr, rng) => {
      const out = buf(sr, 1);
      note(out, sr, rng, 'pluckBass', 40, 0, 0.9);
      note(out, sr, rng, 'pluckBass', 41, 0.15, 1);
      note(out, sr, rng, 'koto', 77, 0.15, 0.15);
      return done(out, sr, 1.3);
    },
  },
  sting: {
    takes: 2,
    gain: 0.87,
    bus: 'world',
    build: (sr, rng) => {
      const out = buf(sr, 0.5);
      const n = Math.floor(0.32 * sr);
      // Electric buzz: odd harmonics of a 110 Hz hum, chopped at 55 Hz.
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.09);
        const chop = Math.sin(2 * Math.PI * 55 * t) > -0.2 ? 1 : 0.25;
        let s = 0;
        for (let h = 1; h <= 9; h += 2) s += Math.sin(2 * Math.PI * 110 * h * t) / h;
        out[i] += s * env * chop * 0.5;
      }
      addNoise(out, sr, rng, { length: 0.25, type: 'bp', f: 3200, q: 2.5, amp: 0.9, decay: 0.05 });
      for (let i = 0; i < 12; i++) addNoise(out, sr, rng, { at: rng.range(0, 0.22), length: 0.002, type: 'hp', f: 4000, amp: rng.range(0.5, 1.2) });
      return done(out, sr, 1.6);
    },
  },
  explosion: {
    takes: 2,
    gain: 0.87,
    bus: 'world',
    build: (sr, rng) => {
      const out = buf(sr, 2.2);
      addTone(out, sr, { f: 75, to: 28, glide: 0.25, attack: 0.003, decay: 0.6, amp: 1 });
      addNoise(out, sr, rng, { length: 1.6, f: 380, to: 90, glide: 0.35, q: 0.9, amp: 1.2, decay: 0.4 });
      addNoise(out, sr, rng, { length: 0.04, type: 'bp', f: 1500, q: 0.8, amp: 0.6, decay: 0.01 });
      addBubbles(out, sr, rng, { at: 0.05, spread: 1.4, count: 40, f: [110, 500], amp: 0.3, bunch: 1.8 });
      return done(out, sr, 1.7);
    },
  },
  pickup: {
    takes: 1,
    gain: 0.47,
    bus: 'ui',
    tonal: true,
    build: (sr, rng) => {
      const out = buf(sr, 1.2);
      note(out, sr, rng, 'kalimba', 72, 0, 0.8);
      note(out, sr, rng, 'kalimba', 79, 0.07, 0.7);
      addBubble(out, sr, 0, 900, 0.3, 0.2);
      return done(out, sr, 1);
    },
  },
  pearl: {
    takes: 1,
    gain: 0.52,
    bus: 'world',
    tonal: true,
    build: (sr, rng) => {
      const out = buf(sr, 1.8);
      note(out, sr, rng, 'kalimba', 72, 0, 0.6);
      run(out, sr, rng, 'glock', [84, 88, 91, 96], 0.02, 0.05, 0.45);
      return done(out, sr, 1);
    },
  },
  life: {
    takes: 1,
    gain: 0.66,
    bus: 'world',
    tonal: true,
    build: (sr, rng) => {
      const out = buf(sr, 2);
      run(out, sr, rng, 'harp', [60, 64, 67, 72], 0, 0.09, 0.7);
      note(out, sr, rng, 'glock', 84, 0.27, 0.45);
      note(out, sr, rng, 'glock', 88, 0.36, 0.35);
      return done(out, sr, 1);
    },
  },
  bonus: {
    takes: 1,
    gain: 0.46,
    bus: 'world',
    tonal: true,
    build: (sr, rng) => {
      const out = buf(sr, 1.2);
      note(out, sr, rng, 'marimba', 79, 0, 0.8);
      note(out, sr, rng, 'marimba', 84, 0.065, 0.9);
      note(out, sr, rng, 'glock', 91, 0.065, 0.25);
      return done(out, sr, 1);
    },
  },
  block: {
    takes: 2,
    gain: 0.65,
    bus: 'world',
    gap: 0.1,
    build: (sr, rng) => {
      const out = buf(sr, 0.8);
      addModes(out, sr, 0, rng.range(1900, 2100), [{ r: 1, a: 1, d: 0.18 }, { r: 2.32, a: 0.5, d: 0.1 }, { r: 4.25, a: 0.25, d: 0.05 }], 0.5, 0.0005);
      addTone(out, sr, { f: 220, to: 120, glide: 0.03, attack: 0.001, decay: 0.07, amp: 0.8 });
      addNoise(out, sr, rng, { length: 0.04, type: 'bp', f: 2500, q: 1, amp: 0.5, decay: 0.01 });
      return done(out, sr, 1.2);
    },
  },
  respawn: {
    takes: 1,
    gain: 0.5,
    bus: 'world',
    tonal: true,
    build: (sr, rng) => {
      const out = buf(sr, 1.8);
      addNoise(out, sr, rng, { length: 0.55, type: 'bp', f: 300, to: 2400, glide: 0.4, q: 1.2, attack: 0.5, amp: 0.4 });
      run(out, sr, rng, 'kalimba', [60, 67, 72, 79], 0.45, 0.06, 0.6);
      addBubbles(out, sr, rng, { at: 0.1, spread: 0.7, count: 14, f: [400, 1400], amp: 0.2 });
      return done(out, sr, 1);
    },
  },
  gameOver: {
    takes: 1,
    gain: 0.85,
    bus: 'world',
    tonal: true,
    build: (sr, rng) => {
      const out = buf(sr, 3.5);
      run(out, sr, rng, 'harp', [67, 63, 60, 55], 0, 0.22, 0.7);
      note(out, sr, rng, 'bell', 48, 0.88, 0.5);
      addTone(out, sr, { at: 0.88, f: 65.4, attack: 0.05, decay: 0.8, amp: 0.4 });
      return done(out, sr, 1);
    },
  },
  click: {
    takes: 3,
    gain: 0.45,
    bus: 'ui',
    build: (sr, rng) => {
      const out = buf(sr, 0.1);
      addModes(out, sr, 0, rng.range(1150, 1250), [{ r: 1, a: 1, d: 0.016 }, { r: 2.6, a: 0.3, d: 0.008 }], 1, 0.0004);
      addNoise(out, sr, rng, { length: 0.003, type: 'bp', f: 3000, amp: 0.4 });
      return done(out, sr, 1);
    },
  },
  hover: {
    takes: 3,
    gain: 0.16,
    bus: 'ui',
    gap: 0.04,
    build: (sr, rng) => {
      const out = buf(sr, 0.06);
      addModes(out, sr, 0, rng.range(2300, 2500), [{ r: 1, a: 1, d: 0.009 }], 1, 0.0006);
      return done(out, sr, 1);
    },
  },
  tally: {
    takes: 3,
    gain: 0.18,
    bus: 'ui',
    gap: 0.045,
    build: (sr, rng) => {
      const out = buf(sr, 0.08);
      addModes(out, sr, 0, rng.range(2900, 3100), [{ r: 1, a: 1, d: 0.012 }, { r: 2.4, a: 0.3, d: 0.006 }], 1, 0.0004);
      return done(out, sr, 1);
    },
  },
  star: {
    takes: 1,
    gain: 0.44,
    bus: 'ui',
    tonal: true,
    gap: 0.05,
    build: (sr, rng) => {
      const out = buf(sr, 2);
      note(out, sr, rng, 'glock', 84, 0, 0.8);
      note(out, sr, rng, 'kalimba', 72, 0, 0.5);
      addNoise(out, sr, rng, { length: 0.35, type: 'hp', f: 6000, attack: 0.01, decay: 0.12, amp: 0.15 });
      return done(out, sr, 1);
    },
  },
  open: {
    takes: 2,
    gain: 0.22,
    bus: 'ui',
    gap: 0.08,
    build: (sr, rng) => {
      const out = buf(sr, 0.4);
      addNoise(out, sr, rng, { length: 0.35, type: 'bp', f: 500, to: 2200, glide: 0.12, q: 1.1, attack: 0.06, decay: 0.08 });
      addBubble(out, sr, 0.05, rng.range(800, 1100), 0.25, 0.15);
      return done(out, sr, 1);
    },
  },
  back: {
    takes: 2,
    gain: 0.25,
    bus: 'ui',
    gap: 0.08,
    build: (sr, rng) => {
      const out = buf(sr, 0.4);
      addNoise(out, sr, rng, { length: 0.3, type: 'bp', f: 2000, to: 450, glide: 0.1, q: 1.1, attack: 0.04, decay: 0.08 });
      return done(out, sr, 1);
    },
  },
  swoosh: {
    takes: 3,
    gain: 0.45,
    bus: 'world',
    build: (sr, rng) => {
      const out = buf(sr, 0.6);
      addNoise(out, sr, rng, { length: 0.5, type: 'bp', f: 350, to: 1600, glide: 0.08, q: 1, attack: 0.07, decay: 0.12 });
      addNoise(out, sr, rng, { length: 0.4, f: 220, amp: 0.6, attack: 0.05, decay: 0.12 });
      addBubbles(out, sr, rng, { at: 0.05, spread: 0.25, count: 3, f: [600, 1300], amp: 0.2 });
      return done(out, sr, 1.1);
    },
  },
  coin: {
    takes: 2,
    gain: 0.4,
    bus: 'ui',
    tonal: true,
    gap: 0.06,
    build: (sr) => {
      const out = buf(sr, 0.8);
      const ting = (at: number, f: number): void => addModes(out, sr, at, f, [{ r: 1, a: 1, d: 0.22 }, { r: 2.0, a: 0.3, d: 0.15 }, { r: 4.0, a: 0.12, d: 0.06 }, { r: 5.43, a: 0.08, d: 0.04 }], 0.6, 0.0004);
      ting(0, 987.8);
      ting(0.065, 1318.5);
      return done(out, sr, 1);
    },
  },
  unlock: {
    takes: 1,
    gain: 0.8,
    bus: 'ui',
    tonal: true,
    build: (sr, rng) => {
      const out = buf(sr, 3.5);
      run(out, sr, rng, 'harp', [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84], 0, 0.035, 0.45);
      for (const m of [72, 76, 79, 84]) note(out, sr, rng, 'glock', m, 0.42, 0.3);
      note(out, sr, rng, 'bell', 48, 0.42, 0.35);
      return done(out, sr, 1);
    },
  },
  geyserWarn: {
    takes: 2,
    gain: 0.6,
    bus: 'world',
    build: (sr, rng) => {
      const out = buf(sr, 1.4);
      addNoise(out, sr, rng, { length: 1.2, f: 110, to: 260, glide: 0.6, attack: 0.5, amp: 1.2 });
      addTone(out, sr, { f: 48, attack: 0.4, hold: 0.5, decay: 0.2, amp: 0.4, tremolo: [9, 0.6] });
      addBubbles(out, sr, rng, { at: 0.3, spread: 0.9, count: 10, f: [150, 400], amp: 0.3, bunch: 0.6 });
      return done(out, sr, 1.3);
    },
  },
  geyser: {
    takes: 2,
    gain: 0.8,
    bus: 'world',
    gap: 0.3,
    build: (sr, rng) => {
      const out = buf(sr, 1.8);
      addNoise(out, sr, rng, { length: 1.5, f: 300, to: 900, glide: 0.3, attack: 0.04, decay: 0.5, amp: 1 });
      addNoise(out, sr, rng, { length: 1.2, type: 'bp', f: 2200, q: 0.8, attack: 0.08, decay: 0.35, amp: 0.4 });
      addBubbles(out, sr, rng, { at: 0, spread: 1.2, count: 45, f: [200, 1000], amp: 0.28, bunch: 1.4 });
      return done(out, sr, 1.5);
    },
  },
  puff: {
    takes: 2,
    gain: 0.43,
    bus: 'world',
    gap: 0.25,
    build: (sr, rng) => {
      const out = buf(sr, 0.6);
      addTone(out, sr, { f: 130, to: 430, glide: 0.09, attack: 0.01, hold: 0.06, decay: 0.12, amp: 1, vibrato: [28, 0.04] });
      addTone(out, sr, { f: 260, to: 860, glide: 0.09, attack: 0.01, hold: 0.04, decay: 0.08, amp: 0.25 });
      addNoise(out, sr, rng, { at: 0.08, length: 0.05, type: 'bp', f: 900, q: 3, amp: 0.3, decay: 0.015 });
      return done(out, sr, 1.3);
    },
  },
  eelLunge: {
    takes: 2,
    gain: 0.65,
    bus: 'world',
    build: (sr, rng) => {
      const out = buf(sr, 0.6);
      addNoise(out, sr, rng, { length: 0.25, type: 'bp', f: 300, to: 2800, glide: 0.05, q: 1.2, attack: 0.03, decay: 0.08 });
      addModes(out, sr, 0.12, 820, [{ r: 1, a: 1, d: 0.04 }, { r: 2.3, a: 0.4, d: 0.02 }], 0.7, 0.0005);
      addTone(out, sr, { at: 0.12, f: 180, to: 90, glide: 0.02, decay: 0.06, amp: 0.6 });
      addBubbles(out, sr, rng, { at: 0.14, spread: 0.2, count: 5, f: [600, 1400], amp: 0.2 });
      return done(out, sr, 1.3);
    },
  },
  crack: {
    takes: 3,
    gain: 0.48,
    bus: 'world',
    gap: 0.2,
    build: (sr, rng) => {
      const out = buf(sr, 0.5);
      const n = rng.int(3, 5);
      for (let i = 0; i < n; i++) chirp(out, sr, i === 0 ? 0 : rng.range(0.01, 0.2), rng.range(3500, 6000), rng.range(500, 900), rng.range(0.4, 1), rng.range(0.03, 0.07));
      for (let i = 0; i < 10; i++) addNoise(out, sr, rng, { at: rng.range(0, 0.15), length: 0.003, type: 'hp', f: 3000, amp: rng.range(0.4, 1) });
      return done(out, sr, 1.4);
    },
  },
  shatter: {
    takes: 3,
    gain: 0.47,
    bus: 'world',
    gap: 0.12,
    build: (sr, rng) => {
      const out = buf(sr, 1.2);
      addNoise(out, sr, rng, { length: 0.4, type: 'hp', f: 2500, amp: 0.8, decay: 0.08 });
      addTone(out, sr, { f: 160, to: 80, glide: 0.03, decay: 0.08, amp: 0.6 });
      for (let i = 0; i < 26; i++) {
        const f = rng.range(1800, 7000);
        addModes(out, sr, Math.pow(rng.next(), 1.6) * 0.45, f, [{ r: 1, a: 1, d: rng.range(0.03, 0.15) }, { r: 2.76, a: 0.3, d: 0.03 }], rng.range(0.1, 0.35), 0.0003);
      }
      return done(out, sr, 1.3);
    },
  },
  chime: {
    takes: 2,
    gain: 0.37,
    bus: 'world',
    tonal: true,
    build: (sr, rng) => {
      const out = buf(sr, 3);
      const m = rng.pick([84, 88, 91]);
      note(out, sr, rng, 'glock', m, 0, 0.8);
      addModes(out, sr, 0, 440 * Math.pow(2, (m - 69) / 12) * 1.003, [{ r: 1, a: 1, d: 1.4 }], 0.25, 0.01);
      return done(out, sr, 1);
    },
  },
  dim: {
    takes: 1,
    gain: 0.55,
    bus: 'world',
    tonal: true,
    build: (sr, rng) => {
      const out = buf(sr, 1.8);
      addTone(out, sr, { f: 392, to: 196, glide: 0.4, attack: 0.04, decay: 0.5, amp: 0.6 });
      addTone(out, sr, { f: 587, to: 293, glide: 0.4, attack: 0.04, decay: 0.4, amp: 0.3 });
      addNoise(out, sr, rng, { length: 1, f: 900, to: 200, glide: 0.4, attack: 0.1, decay: 0.4, amp: 0.3 });
      return done(out, sr, 1);
    },
  },
  tide: {
    takes: 2,
    gain: 0.6,
    bus: 'world',
    build: (sr, rng) => {
      const out = buf(sr, 2.4);
      addNoise(out, sr, rng, { length: 2.2, f: 200, to: 750, glide: 0.8, attack: 0.8, decay: 0.7, amp: 1 });
      addNoise(out, sr, rng, { length: 2, type: 'bp', f: 1200, q: 0.7, attack: 0.9, decay: 0.5, amp: 0.3 });
      addBubbles(out, sr, rng, { at: 0.5, spread: 1.2, count: 10, f: [300, 900], amp: 0.2 });
      return done(out, sr, 1.1);
    },
  },
  charge: {
    takes: 1,
    gain: 0.44,
    bus: 'world',
    build: (sr, rng) => {
      const out = buf(sr, 1.3);
      addTone(out, sr, { f: 110, to: 330, glide: 0.45, attack: 0.6, hold: 0.3, decay: 0.12, amp: 0.7, tremolo: [12, 0.5] });
      addTone(out, sr, { f: 220, to: 660, glide: 0.45, attack: 0.6, hold: 0.3, decay: 0.12, amp: 0.25 });
      addNoise(out, sr, rng, { length: 1.1, type: 'bp', f: 300, to: 2400, glide: 0.5, q: 3, attack: 0.9, amp: 0.3 });
      return done(out, sr, 1.2);
    },
  },
  beam: {
    takes: 1,
    gain: 0.53,
    bus: 'world',
    gap: 0.5,
    build: (sr, rng) => {
      const out = buf(sr, 2.2);
      for (const [h, a] of [
        [1, 0.7],
        [2, 0.4],
        [3, 0.22],
        [5, 0.1],
      ]) {
        addTone(out, sr, { f: 82 * h, attack: 0.03, hold: 1.4, decay: 0.25, amp: a, vibrato: [6, 0.006] });
      }
      addNoise(out, sr, rng, { length: 1.8, type: 'bp', f: 700, q: 2, attack: 0.05, amp: 0.25 });
      return done(out, sr, 1.5);
    },
  },
  heatWarn: {
    takes: 2,
    gain: 0.7,
    bus: 'world',
    build: (sr, rng) => {
      const out = buf(sr, 2);
      addNoise(out, sr, rng, { length: 1.8, f: 90, to: 170, glide: 0.8, attack: 0.5, amp: 1.4 });
      addNoise(out, sr, rng, { length: 1.6, type: 'hp', f: 4000, attack: 0.6, decay: 0.5, amp: 0.25 });
      addTone(out, sr, { f: 40, attack: 0.4, hold: 0.8, decay: 0.3, amp: 0.5 });
      return done(out, sr, 1.4);
    },
  },
  golden: {
    takes: 1,
    gain: 0.55,
    bus: 'world',
    tonal: true,
    build: (sr, rng) => {
      const out = buf(sr, 1.8);
      run(out, sr, rng, 'glock', [84, 88, 91, 96], 0, 0.035, 0.5);
      note(out, sr, rng, 'kalimba', 72, 0, 0.6);
      note(out, sr, rng, 'kalimba', 79, 0.14, 0.5);
      return done(out, sr, 1);
    },
  },
  challenge: {
    takes: 1,
    gain: 0.58,
    bus: 'ui',
    tonal: true,
    build: (sr, rng) => {
      const out = buf(sr, 2);
      run(out, sr, rng, 'marimba', [72, 76, 79], 0, 0.08, 0.7);
      for (const m of [84, 88]) note(out, sr, rng, 'glock', m, 0.24, 0.3);
      return done(out, sr, 1);
    },
  },
  bird: {
    takes: 2,
    gain: 0.39,
    bus: 'world',
    gap: 0.3,
    build: (sr, rng) => {
      // A gull above the surface: two muffled "kee-ow" cries.
      const out = buf(sr, 0.9);
      for (const at of [0, 0.28]) {
        addTone(out, sr, { at, f: rng.range(1900, 2100), to: 1100, glide: 0.09, attack: 0.02, hold: 0.06, decay: 0.07, amp: 0.8, vibrato: [32, 0.02] });
        addTone(out, sr, { at, f: 4000, to: 2200, glide: 0.09, attack: 0.02, hold: 0.04, decay: 0.05, amp: 0.15 });
      }
      return done(out, sr, 1.2);
    },
  },
  splash: {
    takes: 3,
    gain: 0.75,
    bus: 'world',
    build: (sr, rng) => {
      const out = buf(sr, 1.2);
      addNoise(out, sr, rng, { length: 0.6, type: 'bp', f: 900, to: 350, glide: 0.1, q: 0.6, attack: 0.004, decay: 0.15, amp: 1 });
      addNoise(out, sr, rng, { length: 0.2, type: 'hp', f: 2500, attack: 0.002, decay: 0.05, amp: 0.4 });
      addBubbles(out, sr, rng, { at: 0.02, spread: 0.7, count: 35, f: [300, 1600], amp: 0.3, bunch: 1.8 });
      return done(out, sr, 1.3);
    },
  },
  currentShift: {
    takes: 2,
    gain: 0.6,
    bus: 'world',
    build: (sr, rng) => {
      const out = buf(sr, 1.8);
      addNoise(out, sr, rng, { length: 1.6, type: 'bp', f: 200, to: 900, glide: 0.5, q: 0.9, attack: 0.5, decay: 0.5, amp: 0.9 });
      addNoise(out, sr, rng, { length: 1.5, f: 120, attack: 0.4, decay: 0.6, amp: 0.7 });
      return done(out, sr, 1.1);
    },
  },
  lavaBomb: {
    takes: 3,
    gain: 0.8,
    bus: 'world',
    gap: 0.15,
    build: (sr, rng) => {
      const out = buf(sr, 1.4);
      addTone(out, sr, { f: 100, to: 38, glide: 0.06, attack: 0.002, decay: 0.3, amp: 1 });
      addNoise(out, sr, rng, { length: 0.4, f: 450, to: 150, glide: 0.1, amp: 0.8, decay: 0.12 });
      addNoise(out, sr, rng, { at: 0.03, length: 1.1, type: 'hp', f: 5000, attack: 0.05, decay: 0.45, amp: 0.25 });
      addBubbles(out, sr, rng, { at: 0.03, spread: 0.8, count: 18, f: [200, 900], amp: 0.25, bunch: 1.5 });
      return done(out, sr, 1.5);
    },
  },
  lavaWhistle: {
    takes: 2,
    gain: 0.28,
    bus: 'world',
    gap: 0.2,
    build: (sr, rng) => {
      const out = buf(sr, 0.9);
      addTone(out, sr, { f: rng.range(1400, 1600), to: 450, glide: 0.35, attack: 0.05, hold: 0.35, decay: 0.12, amp: 0.6 });
      addNoise(out, sr, rng, { length: 0.6, type: 'bp', f: 1500, to: 500, glide: 0.35, q: 4, attack: 0.05, amp: 0.4 });
      return done(out, sr, 1);
    },
  },
  lureSnap: {
    takes: 2,
    gain: 0.65,
    bus: 'world',
    build: (sr, rng) => {
      const out = buf(sr, 0.5);
      addModes(out, sr, 0, rng.range(560, 640), [{ r: 1, a: 1, d: 0.05 }, { r: 2.4, a: 0.4, d: 0.025 }], 0.8, 0.0004);
      addNoise(out, sr, rng, { length: 0.03, type: 'bp', f: 1100, amp: 0.7, decay: 0.008 });
      addTone(out, sr, { f: 150, to: 70, glide: 0.03, decay: 0.08, amp: 0.7 });
      return done(out, sr, 1.4);
    },
  },
  giantWarn: {
    takes: 1,
    gain: 0.8,
    bus: 'world',
    tonal: true,
    build: (sr, rng) => {
      const out = buf(sr, 3);
      // A semitone see-saw in the bass that keeps speeding up: something big is coming.
      const times = [0, 0.5, 0.9, 1.22, 1.48, 1.68, 1.84, 1.97, 2.08, 2.18];
      times.forEach((at, i) => note(out, sr, rng, 'pluckBass', i % 2 ? 37 : 36, at, 0.55 + 0.45 * (i / (times.length - 1))));
      addTone(out, sr, { f: 32.7, attack: 1.6, hold: 0.5, decay: 0.4, amp: 0.45 });
      addNoise(out, sr, rng, { length: 2.4, f: 120, to: 320, glide: 1.6, attack: 1.8, decay: 0.3, amp: 0.5 });
      return done(out, sr, 1.3);
    },
  },
  giantBite: {
    takes: 2,
    gain: 0.95,
    bus: 'world',
    gap: 0.2,
    build: (sr, rng) => {
      const out = buf(sr, 1.6);
      mixIn(out, synthCrunch(CRUNCH_BIG, sr, rng.int(1, 1e9)), sr, 0, 1);
      addTone(out, sr, { f: 95, to: 30, glide: 0.1, attack: 0.002, decay: 0.35, amp: 1 });
      addNoise(out, sr, rng, { length: 0.5, f: 500, to: 120, glide: 0.15, amp: 0.7, decay: 0.15 });
      addBubbles(out, sr, rng, { at: 0.05, spread: 0.9, count: 26, f: [120, 500], amp: 0.3, bunch: 1.6 });
      return done(out, sr, 1.5);
    },
  },
  bossRoar: {
    takes: 2,
    gain: 0.95,
    bus: 'world',
    gap: 0.8,
    build: (sr, rng) => {
      // A huge throat: detuned low partials with a slow growl, swelling and falling away.
      const out = buf(sr, 2.6);
      const f = rng.range(52, 60);
      for (const [h, a] of [
        [1, 0.9],
        [1.5, 0.45],
        [2, 0.5],
        [3.02, 0.25],
        [4.1, 0.12],
      ]) {
        addTone(out, sr, { f: f * h * 1.25, to: f * h * 0.8, glide: 0.9, attack: 0.25, hold: 0.7, decay: 0.45, amp: a, vibrato: [5.5, 0.03], tremolo: [23, 0.55] });
      }
      addNoise(out, sr, rng, { length: 1.9, type: 'bp', f: 420, to: 180, glide: 0.8, q: 1.2, attack: 0.3, decay: 0.5, amp: 0.7 });
      addNoise(out, sr, rng, { length: 1.6, f: 90, attack: 0.4, decay: 0.6, amp: 0.8 });
      addBubbles(out, sr, rng, { at: 0.2, spread: 1.6, count: 30, f: [120, 600], amp: 0.25, bunch: 1.4 });
      return done(out, sr, 1.6);
    },
  },
  bossWarn: {
    takes: 2,
    gain: 0.62,
    bus: 'world',
    gap: 0.3,
    build: (sr, rng) => {
      // A rising, rattling rumble: it's winding up.
      const out = buf(sr, 1.4);
      addTone(out, sr, { f: 55, to: 110, glide: 0.5, attack: 0.7, hold: 0.25, decay: 0.12, amp: 0.8, tremolo: [16, 0.6] });
      addTone(out, sr, { f: 110, to: 220, glide: 0.5, attack: 0.7, hold: 0.25, decay: 0.1, amp: 0.3, tremolo: [16, 0.6] });
      addNoise(out, sr, rng, { length: 1.1, type: 'bp', f: 200, to: 1400, glide: 0.45, q: 2.2, attack: 0.85, amp: 0.45 });
      return done(out, sr, 1.3);
    },
  },
  bossLunge: {
    takes: 2,
    gain: 0.85,
    bus: 'world',
    gap: 0.2,
    build: (sr, rng) => {
      const out = synthWhoosh(sr, rng.int(1, 1e9));
      addTone(out, sr, { f: 90, to: 45, glide: 0.2, attack: 0.01, decay: 0.3, amp: 0.8 });
      addNoise(out, sr, rng, { length: 0.6, f: 300, to: 900, glide: 0.2, attack: 0.05, decay: 0.2, amp: 0.6 });
      return done(out, sr, 1.3);
    },
  },
  bossCrash: {
    takes: 3,
    gain: 1,
    bus: 'world',
    gap: 0.15,
    build: (sr, rng) => {
      // Rock giving way: a deep boom, crumbling stones, then a long settling rumble.
      const out = buf(sr, 2.2);
      addTone(out, sr, { f: 70, to: 28, glide: 0.12, attack: 0.002, decay: 0.55, amp: 1 });
      addNoise(out, sr, rng, { length: 0.5, f: 700, to: 140, glide: 0.12, amp: 0.9, decay: 0.12 });
      for (let i = 0; i < 22; i++) {
        addModes(out, sr, 0.04 + Math.pow(rng.next(), 1.5) * 0.9, rng.range(250, 1100), [{ r: 1, a: 1, d: rng.range(0.02, 0.06) }, { r: 2.4, a: 0.4, d: 0.015 }], rng.range(0.1, 0.3), 0.0005);
      }
      addNoise(out, sr, rng, { at: 0.1, length: 1.8, f: 110, attack: 0.1, decay: 0.7, amp: 0.7 });
      addBubbles(out, sr, rng, { at: 0.05, spread: 1, count: 30, f: [150, 700], amp: 0.25, bunch: 1.6 });
      return done(out, sr, 1.6);
    },
  },
  bossStun: {
    takes: 1,
    gain: 0.6,
    bus: 'world',
    tonal: true,
    build: (sr, rng) => {
      // Dazed: a woozy falling wobble and a twinkle of stars.
      const out = buf(sr, 1.8);
      addTone(out, sr, { f: 392, to: 196, glide: 0.5, attack: 0.02, hold: 0.4, decay: 0.3, amp: 0.55, vibrato: [7, 0.06] });
      addTone(out, sr, { f: 294, to: 147, glide: 0.5, attack: 0.02, hold: 0.4, decay: 0.3, amp: 0.3, vibrato: [7.5, 0.06] });
      run(out, sr, rng, 'glock', [96, 91, 96, 91], 0.15, 0.13, 0.35, 0.5);
      return done(out, sr, 1);
    },
  },
  bossHit: {
    takes: 3,
    gain: 0.95,
    bus: 'world',
    gap: 0.1,
    build: (sr, rng) => {
      // Armour cracking: a sharp splintering crack over a heavy crunch and thump.
      const out = buf(sr, 1.3);
      for (let i = 0; i < 5; i++) chirp(out, sr, i === 0 ? 0 : rng.range(0.005, 0.08), rng.range(4000, 7000), rng.range(400, 800), rng.range(0.5, 1), rng.range(0.03, 0.06));
      for (let i = 0; i < 14; i++) addNoise(out, sr, rng, { at: rng.range(0, 0.1), length: 0.004, type: 'hp', f: 2500, amp: rng.range(0.5, 1) });
      mixIn(out, synthCrunch(CRUNCH_BIG, sr, rng.int(1, 1e9)), sr, 0.01, 0.9);
      addTone(out, sr, { f: 110, to: 36, glide: 0.07, attack: 0.002, decay: 0.3, amp: 1 });
      addBubbles(out, sr, rng, { at: 0.05, spread: 0.6, count: 16, f: [200, 900], amp: 0.25, bunch: 1.5 });
      return done(out, sr, 1.6);
    },
  },
  bossPhase: {
    takes: 1,
    gain: 0.85,
    bus: 'world',
    tonal: true,
    build: (sr, rng) => {
      // Stinger: two heavy minor hits and a rising swell.
      const out = buf(sr, 3);
      for (const at of [0, 0.32]) {
        note(out, sr, rng, 'pluckBass', 36, at, 1);
        addTone(out, sr, { at, f: 65, to: 40, glide: 0.1, attack: 0.002, decay: 0.4, amp: 0.8 });
        addNoise(out, sr, rng, { at, length: 0.3, f: 500, to: 150, glide: 0.08, amp: 0.5, decay: 0.08 });
      }
      run(out, sr, rng, 'harp', [48, 51, 55, 60, 63, 67], 0.64, 0.05, 0.5);
      addNoise(out, sr, rng, { at: 0.6, length: 1.4, type: 'bp', f: 300, to: 2400, glide: 0.6, q: 1.2, attack: 1.1, decay: 0.2, amp: 0.4 });
      return done(out, sr, 1.3);
    },
  },
  bossDefeat: {
    takes: 1,
    gain: 1,
    bus: 'world',
    build: (sr, rng) => {
      // The last roar breaks into a groan and a huge collapse.
      const out = buf(sr, 3.6);
      for (const [h, a] of [
        [1, 0.9],
        [2, 0.45],
        [3, 0.25],
      ]) {
        addTone(out, sr, { f: 70 * h, to: 30 * h, glide: 1.2, attack: 0.05, hold: 0.6, decay: 0.8, amp: a, vibrato: [4, 0.05], tremolo: [18, 0.5] });
      }
      addTone(out, sr, { at: 0.5, f: 60, to: 24, glide: 0.2, attack: 0.002, decay: 1, amp: 1 });
      addNoise(out, sr, rng, { at: 0.5, length: 2.4, f: 400, to: 80, glide: 0.8, amp: 0.8, decay: 0.8 });
      addBubbles(out, sr, rng, { at: 0.4, spread: 2.2, count: 70, f: [100, 900], amp: 0.3, bunch: 1.4 });
      return done(out, sr, 1.5);
    },
  },
  bossInk: {
    takes: 1,
    gain: 0.75,
    bus: 'world',
    build: (sr, rng) => {
      // A wet blast of ink: a falling sweep, a low "fwoomp" and a cloud of bubbles.
      const out = buf(sr, 1.8);
      addNoise(out, sr, rng, { length: 0.9, type: 'bp', f: 1800, to: 250, glide: 0.25, q: 0.8, attack: 0.01, decay: 0.3, amp: 1 });
      addTone(out, sr, { f: 140, to: 50, glide: 0.15, attack: 0.005, decay: 0.3, amp: 0.8 });
      addBubbles(out, sr, rng, { at: 0.03, spread: 1.2, count: 50, f: [150, 800], amp: 0.3, bunch: 1.6 });
      return done(out, sr, 1.3);
    },
  },
  baitBall: {
    takes: 1,
    gain: 0.7,
    bus: 'world',
    tonal: true,
    build: (sr, rng) => {
      // A shimmering swirl: fizzing bubbles under a bright rising run.
      const out = buf(sr, 2.2);
      addNoise(out, sr, rng, { length: 1.6, type: 'bp', f: 2600, to: 5200, glide: 1.2, q: 1.4, attack: 0.5, decay: 0.6, amp: 0.35 });
      addBubbles(out, sr, rng, { at: 0, spread: 1.6, count: 60, f: [600, 2200], amp: 0.22, bunch: 1.2 });
      run(out, sr, rng, 'glock', [79, 83, 86, 91, 95], 0.1, 0.09, 0.45, 0.06);
      run(out, sr, rng, 'kalimba', [67, 71, 74], 0.14, 0.12, 0.5);
      return done(out, sr, 1.1);
    },
  },
  whaleWarn: {
    takes: 1,
    gain: 0.8,
    bus: 'world',
    build: (sr, rng) => {
      // Something huge stirs below: a rising rumble through a dense curtain of bubbles.
      const out = buf(sr, 2.4);
      addTone(out, sr, { f: 38, to: 70, glide: 2, attack: 1.4, hold: 0.5, decay: 0.3, amp: 0.9, tremolo: [9, 0.4] });
      addNoise(out, sr, rng, { length: 2.1, f: 160, to: 420, glide: 1.8, attack: 1.2, decay: 0.4, amp: 0.6 });
      addBubbles(out, sr, rng, { at: 0.1, spread: 2, count: 90, f: [140, 900], amp: 0.28, bunch: 1.1 });
      return done(out, sr, 1.3);
    },
  },
  whaleLunge: {
    takes: 1,
    gain: 0.95,
    bus: 'world',
    tonal: true,
    build: (sr, rng) => {
      // A huge rush of water and a low whale moan that bends up and falls away.
      const out = synthWhoosh(sr, rng.int(1, 1e9));
      const moan = buf(sr, 2.8);
      for (const [h, a] of [
        [1, 0.8],
        [2, 0.35],
        [3, 0.15],
      ]) {
        addTone(moan, sr, { at: 0.15, f: 180 * h, to: 320 * h, glide: 0.7, attack: 0.25, hold: 0.5, decay: 0.9, amp: a, vibrato: [5, 0.02] });
      }
      addNoise(moan, sr, rng, { length: 1.2, f: 260, to: 120, glide: 0.8, attack: 0.02, decay: 0.5, amp: 0.8 });
      addTone(moan, sr, { f: 60, to: 30, glide: 0.5, attack: 0.01, decay: 0.6, amp: 0.9 });
      mixIn(moan, out, sr, 0, 0.9);
      return done(moan, sr, 1.3);
    },
  },
  riptide: {
    takes: 1,
    gain: 0.8,
    bus: 'world',
    build: (sr, rng) => {
      // Storm water: a roaring sweep that swells, churns and settles into a rumble.
      const out = buf(sr, 3.4);
      addNoise(out, sr, rng, { length: 3, type: 'bp', f: 300, to: 1100, glide: 1.4, q: 0.7, attack: 0.9, decay: 1.2, amp: 0.9 });
      addNoise(out, sr, rng, { length: 3, f: 120, attack: 0.6, decay: 1.4, amp: 0.8 });
      addTone(out, sr, { f: 42, to: 34, glide: 2, attack: 0.8, hold: 0.8, decay: 1.2, amp: 0.7, tremolo: [6, 0.5] });
      addBubbles(out, sr, rng, { at: 0.3, spread: 2.4, count: 50, f: [200, 1200], amp: 0.2, bunch: 1.3 });
      return done(out, sr, 1.3);
    },
  },
  dangerUp: {
    takes: 1,
    gain: 0.8,
    bus: 'ui',
    tonal: true,
    build: (sr, rng) => {
      // The stakes go up: two taiko hits, a climbing semitone alarm in the bass and a bell on top.
      const out = buf(sr, 2.2);
      note(out, sr, rng, 'taiko', 40, 0, 0.9);
      note(out, sr, rng, 'taiko', 40, 0.22, 1);
      run(out, sr, rng, 'pluckBass', [36, 37, 39, 40], 0, 0.11, 0.7);
      note(out, sr, rng, 'bell', 76, 0.44, 0.45);
      note(out, sr, rng, 'bell', 77, 0.44, 0.3);
      addNoise(out, sr, rng, { length: 0.9, type: 'bp', f: 500, to: 1600, glide: 0.5, q: 0.8, attack: 0.3, decay: 0.4, amp: 0.25 });
      return done(out, sr, 1.2);
    },
  },
} satisfies Record<string, SoundDef>;

export type SoundName = keyof typeof SOUND_DEFS;

/** Renders every take of a sound. */
export function buildSound(name: SoundName, sr: number): Float32Array[] {
  const def: SoundDef = SOUND_DEFS[name];
  return Array.from({ length: def.takes }, (_, i) => def.build(sr, new Rng(1009 + i * 7919 + name.length * 31)));
}
