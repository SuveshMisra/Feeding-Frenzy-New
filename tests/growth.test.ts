import { describe, expect, it } from 'vitest';
import { Growth } from '../src/game/systems/Growth';
import { FISH_PER_STAGE, PRE_APEX_STAGE_COUNT, STAGE_COUNT } from '../src/config/tuning';

describe('Growth', () => {
  it('uses 50 fish per stage by default', () => {
    expect(FISH_PER_STAGE).toBe(50);
    expect(new Growth().perStage).toBe(50);
  });

  it('has an apex stage after the three regular ones', () => {
    expect(STAGE_COUNT).toBe(4);
    expect(PRE_APEX_STAGE_COUNT).toBe(3);
    expect(new Growth().stages).toBe(4);
  });

  it('grows at 20, 40 and 60 fish and completes the level at 80', () => {
    const g = new Growth(20);
    const results: string[] = [];
    for (let i = 1; i <= 80; i++) {
      const r = g.add(1);
      if (r !== 'none') results.push(`${i}:${r}`);
    }
    expect(results).toEqual(['20:grew', '40:grew', '60:grew', '80:complete']);
    expect(g.stage).toBe(4);
    expect(g.complete).toBe(true);
    expect(g.totalProgress).toBe(1);
    expect(g.eaten).toBe(80);
  });

  it('can stop short of the apex', () => {
    const g = new Growth(20, false, 3);
    const results: string[] = [];
    for (let i = 1; i <= 60; i++) {
      const r = g.add(1);
      if (r !== 'none') results.push(`${i}:${r}`);
    }
    expect(results).toEqual(['20:grew', '40:grew', '60:complete']);
    expect(g.stage).toBe(3);
    expect(g.full).toBe(true);
  });

  it('reports progress within the stage and across the level', () => {
    const g = new Growth(20);
    for (let i = 0; i < 10; i++) g.add();
    expect(g.stageProgress).toBeCloseTo(0.5);
    expect(g.totalProgress).toBeCloseTo(10 / 80);
    for (let i = 0; i < 15; i++) g.add();
    expect(g.stage).toBe(2);
    expect(g.points).toBe(5);
    expect(g.totalProgress).toBeCloseTo(25 / 80);
  });

  it('ignores eating after the level is complete', () => {
    const g = new Growth(2);
    for (let i = 0; i < 8; i++) g.add();
    expect(g.complete).toBe(true);
    expect(g.add()).toBe('none');
    expect(g.stage).toBe(4);
  });

  it('fills up to its own last stage', () => {
    const g = new Growth(20, false, 3);
    g.fillUp();
    expect(g.stage).toBe(3);
    expect(g.complete).toBe(true);
  });

  it('carries surplus points into the next stage', () => {
    const g = new Growth(20);
    for (let i = 0; i < 19; i++) g.add();
    expect(g.add(3)).toBe('grew');
    expect(g.points).toBe(2);
  });
});
