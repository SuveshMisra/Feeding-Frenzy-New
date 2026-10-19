import { describe, expect, it } from 'vitest';
import {
  circlesTouch,
  edibleTierWeights,
  isThreat,
  mealSize,
  playerCanEat,
  threatTierWeights,
} from '../src/game/systems/FoodChain';
import { Lives } from '../src/game/systems/Lives';
import type { Stage, Tier } from '../src/config/tuning';

describe('food chain', () => {
  it('lets the player eat fish at or below its stage', () => {
    expect(playerCanEat(1, 1)).toBe(true);
    expect(playerCanEat(1, 2)).toBe(false);
    expect(playerCanEat(2, 2)).toBe(true);
    expect(playerCanEat(3, 3)).toBe(true);
    expect(playerCanEat(3, 1)).toBe(true);
  });

  it('never lets the player eat tier 4', () => {
    for (const s of [1, 2, 3] as Stage[]) expect(playerCanEat(s, 4)).toBe(false);
  });

  it('treats every non-edible fish as a threat', () => {
    for (const s of [1, 2, 3] as Stage[]) {
      for (const t of [1, 2, 3, 4] as Tier[]) expect(isThreat(s, t)).toBe(!playerCanEat(s, t));
    }
  });

  it('only spawns edible tiers as food and threat tiers as threats', () => {
    for (const s of [1, 2, 3] as Stage[]) {
      for (const { v } of edibleTierWeights(s)) expect(playerCanEat(s, v)).toBe(true);
      for (const { v } of threatTierWeights(s)) expect(isThreat(s, v)).toBe(true);
      const sum = (a: { w: number }[]): number => a.reduce((t, x) => t + x.w, 0);
      expect(sum(edibleTierWeights(s))).toBeCloseTo(1);
      expect(sum(threatTierWeights(s))).toBeCloseTo(1);
    }
  });

  it('rates a fish of the player\'s own size class as a full meal and smaller fry as snacks', () => {
    expect(mealSize(1, 1)).toBe(1);
    expect(mealSize(2, 2)).toBe(1);
    expect(mealSize(3, 3)).toBe(1);
    expect(mealSize(2, 1)).toBe(0.5);
    expect(mealSize(3, 2)).toBe(0.5);
    expect(mealSize(3, 1)).toBe(0.25);
  });

  it('detects touching circles', () => {
    expect(circlesTouch(0, 0, 1, 1.5, 0, 1)).toBe(true);
    expect(circlesTouch(0, 0, 1, 2.5, 0, 1)).toBe(false);
  });
});

describe('lives', () => {
  it('starts with 3 lives and ends the run on the last one', () => {
    const l = new Lives();
    expect(l.count).toBe(3);
    expect(l.lose()).toBe(false);
    expect(l.lose()).toBe(false);
    expect(l.lose()).toBe(true);
    expect(l.gameOver).toBe(true);
    expect(l.deaths).toBe(3);
  });

  it('caps extra lives', () => {
    const l = new Lives(3, 5);
    expect(l.gain()).toBe(true);
    expect(l.gain()).toBe(true);
    expect(l.gain()).toBe(false);
    expect(l.count).toBe(5);
  });

  it('resets for a retry', () => {
    const l = new Lives();
    l.lose();
    l.reset();
    expect(l.count).toBe(3);
    expect(l.deaths).toBe(0);
  });
});
