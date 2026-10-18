import { describe, expect, it } from 'vitest';
import { CRUNCH_BIG, CRUNCH_SMALL, synthCrunch, synthWhoosh } from '../src/audio/synth';

const SR = 48000;
const peak = (s: Float32Array) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const energy = (s: Float32Array, from: number, to: number) => {
  let e = 0;
  for (let i = Math.floor(from * SR); i < Math.min(s.length, Math.floor(to * SR)); i++) e += s[i] * s[i];
  return e;
};

describe('Synthesized sounds', () => {
  it('builds finite, normalized sounds that end without a click', () => {
    const sounds = [synthCrunch(CRUNCH_SMALL, SR, 101), synthCrunch(CRUNCH_BIG, SR, 101), synthWhoosh(SR, 101)];
    for (const s of sounds) {
      expect(s.every(Number.isFinite)).toBe(true);
      expect(peak(s)).toBeCloseTo(0.9, 5);
      expect(Math.abs(s[s.length - 1])).toBeLessThan(0.01);
    }
    expect(sounds[0].length).toBe(Math.ceil(CRUNCH_SMALL.length * SR));
    expect(sounds[1].length).toBe(Math.ceil(CRUNCH_BIG.length * SR));
  });

  it('repeats a take for the same seed and varies between seeds', () => {
    const a = synthCrunch(CRUNCH_SMALL, SR, 7);
    expect(synthCrunch(CRUNCH_SMALL, SR, 7)).toEqual(a);
    expect(synthCrunch(CRUNCH_SMALL, SR, 8)).not.toEqual(a);
  });

  it('front-loads a small crunch and gives a big one a second bite', () => {
    const small = synthCrunch(CRUNCH_SMALL, SR, 3);
    expect(energy(small, 0, 0.1)).toBeGreaterThan(energy(small, 0.1, 0.2) * 4);
    const big = synthCrunch(CRUNCH_BIG, SR, 3);
    const gap = energy(big, 0.13, 0.155);
    expect(energy(big, 0.16, 0.185)).toBeGreaterThan(gap);
  });
});
