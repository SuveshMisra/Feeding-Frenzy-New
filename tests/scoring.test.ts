import { describe, expect, it } from 'vitest';
import { Scoring, computeLevelBonus, multiplierFor, starsFor } from '../src/game/systems/Scoring';
import { COMBO, LEVEL_BONUS, TIER_POINTS } from '../src/config/tuning';

describe('Scoring', () => {
  it('awards points by tier', () => {
    const s = new Scoring();
    expect(s.eat(1).points).toBe(TIER_POINTS[1]);
    s.update(COMBO.window + 0.1);
    expect(s.eat(2).points).toBe(TIER_POINTS[2]);
    s.update(COMBO.window + 0.1);
    expect(s.eat(3).points).toBe(TIER_POINTS[3]);
    expect(TIER_POINTS).toMatchObject({ 1: 10, 2: 25, 3: 50 });
  });

  it('reaches Frenzy x2 at 5 in a row and Double Frenzy x3 at 10', () => {
    const s = new Scoring();
    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(s.eat(1));
      s.update(COMBO.window * 0.9);
    }
    expect(results.map((r) => r.multiplier)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 2, 3]);
    expect(results[4].frenzy).toBe(1);
    expect(results[9].frenzy).toBe(2);
    expect(s.maxCombo).toBe(10);
  });

  it('resets the combo when the gap exceeds the 1.5 s window', () => {
    const s = new Scoring();
    for (let i = 0; i < 4; i++) s.eat(1);
    expect(s.combo).toBe(4);
    s.update(COMBO.window + 0.01);
    expect(s.combo).toBe(0);
    expect(s.eat(1).combo).toBe(1);
  });

  it('keeps the combo alive just inside the window', () => {
    const s = new Scoring();
    s.eat(1);
    s.update(COMBO.window - 0.01);
    expect(s.eat(1).combo).toBe(2);
  });

  it('computes multipliers from combo counts', () => {
    expect(multiplierFor(0)).toBe(1);
    expect(multiplierFor(COMBO.frenzyAt)).toBe(2);
    expect(multiplierFor(COMBO.doubleFrenzyAt + 5)).toBe(3);
  });

  it('gives time and no-death bonuses', () => {
    const b = computeLevelBonus(LEVEL_BONUS.timePar - 60, 0);
    expect(b.time).toBe(60 * LEVEL_BONUS.perSecondUnderPar);
    expect(b.noDeath).toBe(LEVEL_BONUS.noDeath);
    expect(computeLevelBonus(LEVEL_BONUS.timePar + 30, 2)).toEqual({ time: 0, noDeath: 0, total: 0 });
  });

  it('rates 1 to 3 stars from score thresholds', () => {
    expect(starsFor(100, [3000, 4600])).toBe(1);
    expect(starsFor(3000, [3000, 4600])).toBe(2);
    expect(starsFor(9000, [3000, 4600])).toBe(3);
  });
});
