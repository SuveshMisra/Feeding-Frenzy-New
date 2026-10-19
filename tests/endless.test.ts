import { describe, expect, it } from 'vitest';
import { ENDLESS_FISH_PER_STAGE, ENDLESS_UNLOCK, LEVELS, endlessBases, endlessLevel, levelEvents } from '../src/config/levels';
import { endlessCoinsFor, endlessHeroes, heroesFor } from '../src/config/progression';
import { ENDLESS, dangerLevel, dangerProgress, endlessTuning } from '../src/game/systems/Endless';
import { Growth } from '../src/game/systems/Growth';
import { Scoring } from '../src/game/systems/Scoring';
import { TIER_POINTS } from '../src/config/tuning';

describe('danger level', () => {
  it('starts at 1 and climbs one level every step', () => {
    expect(dangerLevel(0)).toBe(1);
    expect(dangerLevel(ENDLESS.step - 0.01)).toBe(1);
    expect(dangerLevel(ENDLESS.step)).toBe(2);
    expect(dangerLevel(ENDLESS.step * 2 + 1)).toBe(3);
    expect(dangerLevel(-5)).toBe(1);
  });

  it('reports progress toward the next level', () => {
    expect(dangerProgress(0)).toBe(0);
    expect(dangerProgress(ENDLESS.step / 2)).toBeCloseTo(0.5);
    expect(dangerProgress(ENDLESS.step * 3 + ENDLESS.step / 4)).toBeCloseTo(0.25);
  });
});

describe('endless escalation', () => {
  const curve = Array.from({ length: 30 }, (_, i) => endlessTuning(i + 1));

  it('leaves the level as it is at danger 1, without the great white', () => {
    const t = curve[0];
    expect(t.extraPredators).toBe(0);
    expect(t.chaseMul).toBe(1);
    expect(t.eventRate).toBe(1);
    expect(t.greatWhite).toBe(false);
  });

  it('brings the great white in from danger 2', () => {
    expect(curve.map((t) => t.greatWhite)).toEqual(curve.map((_, i) => i + 1 >= ENDLESS.greatWhiteFrom));
  });

  it('never gets easier and stays within its caps', () => {
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].extraPredators).toBeGreaterThanOrEqual(curve[i - 1].extraPredators);
      expect(curve[i].chaseMul).toBeGreaterThanOrEqual(curve[i - 1].chaseMul);
      expect(curve[i].eventRate).toBeGreaterThanOrEqual(curve[i - 1].eventRate);
    }
    const last = curve[curve.length - 1];
    expect(last.extraPredators).toBe(ENDLESS.predatorsMax);
    expect(last.chaseMul).toBe(ENDLESS.chaseMax);
    expect(last.eventRate).toBe(ENDLESS.eventsMax);
  });

  it('is actually harder a few levels in', () => {
    const t = endlessTuning(5);
    expect(t.extraPredators).toBeGreaterThan(0);
    expect(t.chaseMul).toBeGreaterThan(1);
    expect(t.eventRate).toBeGreaterThan(1);
  });

  it('multiplies points by 1 + 0.25 per danger level', () => {
    for (const d of [1, 2, 4, 10]) expect(endlessTuning(d).pointsMul).toBeCloseTo(1 + 0.25 * d);
  });
});

describe('endless growth', () => {
  it('never completes: the meter stays full at the last stage', () => {
    const g = new Growth(ENDLESS_FISH_PER_STAGE, true);
    const results = new Set<string>();
    for (let i = 0; i < ENDLESS_FISH_PER_STAGE * 10; i++) results.add(g.add(1));
    expect(results.has('complete')).toBe(false);
    expect(results.has('grew')).toBe(true);
    expect(g.complete).toBe(false);
    expect(g.stage).toBe(3);
    expect(g.full).toBe(true);
    expect(g.points).toBe(ENDLESS_FISH_PER_STAGE);
  });

  it('a normal meter still completes', () => {
    const g = new Growth(10);
    let last = 'none';
    for (let i = 0; i < 30; i++) last = g.add(1);
    expect(last).toBe('complete');
    expect(g.full).toBe(true);
  });
});

describe('endless scoring', () => {
  it('scales bites by the points multiplier', () => {
    const s = new Scoring();
    s.pointsMul = 1.5;
    expect(s.eat(2).points).toBe(Math.round(TIER_POINTS[2] * 1.5));
  });
});

describe('endlessLevel', () => {
  const bases = endlessBases();

  it('offers every Ocean I biome once, no bosses', () => {
    expect(bases.length).toBe(10);
    expect(new Set(bases.map((b) => b.biome)).size).toBe(bases.length);
    expect(bases.every((b) => b.chapter === 1 && !b.boss)).toBe(true);
  });

  it('keeps the biome level\u2019s fish, music and twist', () => {
    for (const base of bases) {
      const lv = endlessLevel(base);
      expect(lv.id).toBe(`endless-${base.biome}`);
      expect(lv.endless).toBe(true);
      expect(lv.fishPerStage).toBe(ENDLESS_FISH_PER_STAGE);
      expect(lv.roster).toBe(base.roster);
      expect(lv.music).toBe(base.music);
      expect(lv.feature).toBe(base.feature);
      expect(lv.index).toBe(base.index);
      expect(lv.challenges).toEqual([]);
      expect(lv.greatWhite).toBeDefined();
      expect([...(levelEvents(lv)?.pool ?? [])].sort()).toEqual(['baitBall', 'riptide', 'whale']);
      expect(endlessLevel(base)).toBe(lv);
    }
  });

  it('never clashes with a campaign level id', () => {
    const ids = new Set(LEVELS.map((l) => l.id));
    for (const base of bases) expect(ids.has(endlessLevel(base).id)).toBe(false);
  });

  it('is unlocked by a real level', () => {
    expect(LEVELS.some((l) => l.id === ENDLESS_UNLOCK && l.boss)).toBe(true);
  });
});

describe('endless rewards and fish', () => {
  it('pays coins from the score only', () => {
    expect(endlessCoinsFor(0)).toBe(0);
    expect(endlessCoinsFor(-100)).toBe(0);
    expect(endlessCoinsFor(10000)).toBeGreaterThan(endlessCoinsFor(5000));
  });

  it('allows every unlocked fish, whatever its campaign start level', () => {
    const unlocked = ['finn', 'spike'] as const;
    expect(endlessHeroes(unlocked)).toEqual(['finn', 'spike']);
    expect(heroesFor(0, unlocked)).toEqual(['finn']);
    expect(endlessHeroes(['finn'], true).length).toBeGreaterThan(1);
  });
});
