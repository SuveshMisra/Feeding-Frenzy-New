import { describe, expect, it } from 'vitest';
import { Growth } from '../src/game/systems/Growth';
import { FISH_PER_STAGE } from '../src/config/tuning';

describe('Growth', () => {
  it('uses 50 fish per stage by default', () => {
    expect(FISH_PER_STAGE).toBe(50);
    expect(new Growth().perStage).toBe(50);
  });

  it('grows at 20 and 40 fish and completes the level at 60', () => {
    const g = new Growth(20);
    const results: string[] = [];
    for (let i = 1; i <= 60; i++) {
      const r = g.add(1);
      if (r !== 'none') results.push(`${i}:${r}`);
    }
    expect(results).toEqual(['20:grew', '40:grew', '60:complete']);
    expect(g.stage).toBe(3);
    expect(g.complete).toBe(true);
    expect(g.totalProgress).toBe(1);
    expect(g.eaten).toBe(60);
  });

  it('reports progress within the stage and across the level', () => {
    const g = new Growth(20);
    for (let i = 0; i < 10; i++) g.add();
    expect(g.stageProgress).toBeCloseTo(0.5);
    expect(g.totalProgress).toBeCloseTo(10 / 60);
    for (let i = 0; i < 15; i++) g.add();
    expect(g.stage).toBe(2);
    expect(g.points).toBe(5);
    expect(g.totalProgress).toBeCloseTo(25 / 60);
  });

  it('ignores eating after the level is complete', () => {
    const g = new Growth(2);
    for (let i = 0; i < 6; i++) g.add();
    expect(g.complete).toBe(true);
    expect(g.add()).toBe('none');
    expect(g.stage).toBe(3);
  });

  it('carries surplus points into the next stage', () => {
    const g = new Growth(20);
    for (let i = 0; i < 19; i++) g.add();
    expect(g.add(3)).toBe('grew');
    expect(g.points).toBe(2);
  });
});
