import { describe, expect, it } from 'vitest';
import { BIOMES, CHAPTERS, LEVELS, chapterAll, chapterBoss, chapterLevels, chapterOf, deepMerge, resolveBiome } from '../src/config/levels';
import { HEROES, heroesFor } from '../src/config/progression';
import { SPECIES, isHero } from '../src/config/species';
import type { Tier } from '../src/config/tuning';

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

describe('Levels', () => {
  it('has twenty-two levels indexed in order with unique ids and seeds', () => {
    expect(LEVELS).toHaveLength(22);
    LEVELS.forEach((l, i) => expect(l.index).toBe(i));
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
    expect(new Set(LEVELS.map((l) => l.seed)).size).toBe(LEVELS.length);
  });

  it('splits the levels into two chapters of ten, each ending on a boss', () => {
    expect(CHAPTERS.map((c) => c.from)).toEqual([0, 11]);
    for (const c of CHAPTERS) {
      const list = chapterLevels(c.id);
      expect(list, c.name).toHaveLength(10);
      expect(list[0].index).toBe(c.from);
      for (const l of list) expect(chapterOf(l.index), l.id).toBe(c.id);
      const all = chapterAll(c.id);
      const boss = chapterBoss(c.id);
      expect(boss, c.name).toBeDefined();
      expect(all[all.length - 1], c.name).toBe(boss);
      expect(chapterOf(boss!.index)).toBe(c.id);
      expect(boss!.feature, boss!.id).toBeUndefined();
      expect(boss!.greatWhite, boss!.id).toBeUndefined();
    }
    expect(LEVELS.filter((l) => l.boss).map((l) => l.id)).toEqual(['abyssKing', 'kraken']);
  });

  it('gives each boss a few phases of weak-point hits', () => {
    for (const l of LEVELS) {
      if (!l.boss) continue;
      expect(l.boss.phases, l.id).toBeGreaterThanOrEqual(2);
      expect(l.boss.hitsPerPhase, l.id).toBeGreaterThanOrEqual(2);
      expect(l.boss.name.length, l.id).toBeGreaterThan(3);
    }
  });

  it('only fills rosters with prey of the matching tier', () => {
    for (const l of LEVELS) {
      for (const tier of [1, 2, 3, 4] as Tier[]) {
        const ids = l.roster[tier];
        expect(ids.length, `${l.id} tier ${tier}`).toBeGreaterThan(0);
        for (const id of ids) {
          const def = SPECIES[id];
          expect(def, `${l.id}: ${id}`).toBeDefined();
          expect(def.tier, `${l.id}: ${id}`).toBe(tier);
          expect(isHero(def), `${l.id}: ${id}`).toBe(false);
        }
      }
    }
  });

  it('uses a biome definition for every level and spaces the star thresholds', () => {
    for (const l of LEVELS) {
      expect(BIOMES[l.biome], l.id).toBeDefined();
      const ratio = l.stars[1] / l.stars[0];
      expect(ratio, l.id).toBeGreaterThan(1.3);
      expect(ratio, l.id).toBeLessThan(1.5);
    }
  });

  it('chases harder through the later levels of each chapter', () => {
    for (const c of CHAPTERS) {
      const list = chapterLevels(c.id);
      for (let i = 6; i < list.length; i++) {
        expect(list[i].difficulty.chaseSpeed, list[i].id).toBeGreaterThanOrEqual(list[i - 1].difficulty.chaseSpeed);
      }
    }
  });

  it('makes every Ocean II remix harder than its original', () => {
    const v1 = chapterLevels(1);
    chapterLevels(2).forEach((l, i) => {
      const o = v1[i];
      expect(l.biome, l.id).toBe(o.biome);
      expect(l.feature, l.id).toBe(o.feature);
      expect(l.featureOpts, l.id).toBeDefined();
      expect(l.difficulty.chaseSpeed, l.id).toBeGreaterThan(o.difficulty.chaseSpeed);
      expect(l.difficulty.detectRadius, l.id).toBeGreaterThan(o.difficulty.detectRadius);
      expect(sum(l.difficulty.predators), l.id).toBeGreaterThan(sum(o.difficulty.predators));
      expect(l.fishPerStage, l.id).toBeGreaterThanOrEqual(o.fishPerStage);
    });
  });

  it('gives each remix its own palette while keeping the biome look', () => {
    const v1 = chapterLevels(1);
    chapterLevels(2).forEach((l, i) => {
      const b = resolveBiome(l);
      const o = resolveBiome(v1[i]);
      expect(b, l.id).not.toBe(o);
      expect(b.fog.top, l.id).not.toBe(o.fog.top);
      expect(b.terrain, l.id).toBe(o.terrain);
      expect(resolveBiome(l)).toBe(b);
    });
    expect(resolveBiome(v1[0])).toEqual(BIOMES[v1[0].biome]);
  });

  it('offers Gulp from level 5 and Spike from Ocean II once unlocked', () => {
    expect(LEVELS[HEROES.gulp.unlockAfter].id).toBe('abyss');
    expect(LEVELS[HEROES.spike.unlockAfter].id).toBe('volcanic');
    expect(LEVELS[HEROES.spike.minLevel].id).toBe('reef2');
    for (let i = 0; i < LEVELS.length; i++) {
      const all = heroesFor(i, ['finn', 'gulp', 'spike']);
      expect(all.includes('gulp')).toBe(i >= 4);
      expect(all.includes('spike')).toBe(i >= 11);
      expect(all.length).toBe(i >= 11 ? 3 : i >= 4 ? 2 : 1);
      expect(heroesFor(i, ['finn', 'gulp'])).not.toContain('spike');
    }
  });
});

describe('deepMerge', () => {
  it('merges nested objects and replaces arrays and scalars', () => {
    const base = { a: 1, nested: { x: 1, y: 2 }, list: [1, 2, 3] };
    const out = deepMerge(base, { nested: { y: 5 }, list: [9] });
    expect(out).toEqual({ a: 1, nested: { x: 1, y: 5 }, list: [9] });
    expect(base.nested.y).toBe(2);
  });

  it('returns the base untouched without overrides', () => {
    const base = { a: 1 };
    expect(deepMerge(base, undefined)).toBe(base);
    expect(deepMerge(base, { a: undefined })).toEqual({ a: 1 });
  });
});
