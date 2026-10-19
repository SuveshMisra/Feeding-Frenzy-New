import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import { BOSS, BossBase, BossHealth } from '../src/game/bosses/BossBase';
import type { World } from '../src/game/World';

describe('BossHealth', () => {
  it('drains one phase at a time and reports phase changes and defeat', () => {
    const hp = new BossHealth(3);
    expect(hp.left).toBe(1);
    expect(hp.damage(1 / 3)).toBe('hit');
    expect(hp.damage(1 / 3)).toBe('hit');
    expect(hp.segment(0)).toBeCloseTo(1 / 3);
    expect(hp.segment(1)).toBe(1);
    expect(hp.damage(1 / 3)).toBe('phase');
    expect(hp.phase).toBe(1);
    expect(hp.segment(0)).toBe(0);
    expect(hp.left).toBeCloseTo(2 / 3);
    expect(hp.damage(1)).toBe('phase');
    expect(hp.damage(1)).toBe('defeated');
    expect(hp.defeated).toBe(true);
    expect(hp.left).toBe(0);
    expect(hp.damage(1)).toBe('none');
  });

  it('ignores zero damage', () => {
    const hp = new BossHealth(2);
    expect(hp.damage(0)).toBe('none');
    expect(hp.dealt).toBe(0);
  });
});

class TestBoss extends BossBase {
  get danger(): number {
    return 0;
  }
  threatAt(): number {
    return 0;
  }
  stun(): void {
    this.enter('stunned');
  }
  bite(amount: number) {
    return this.wound(amount, 0, 0, 'Bite');
  }
}

function fakeWorld() {
  const log = { points: 0, stats: [] as string[], events: [] as string[], defeated: 0 };
  const world = {
    mode: 'play',
    started: true,
    phase: 'play',
    level: { seed: 1 },
    scene: new Group(),
    award: (n: number) => (log.points += n),
    stat: (k: string) => log.stats.push(k),
    events: { emit: (_: string, e: { kind: string }) => log.events.push(e.kind) },
    bossDefeated: () => log.defeated++,
  };
  return { world: world as unknown as World, log };
}

describe('BossBase', () => {
  it('only takes damage while its weak point is exposed', () => {
    const { world, log } = fakeWorld();
    const boss = new TestBoss(world, { kind: 'angler', name: 'Test', phases: 2, hitsPerPhase: 2 });
    boss.state = 'attack';
    expect(boss.bite(0.5)).toBe('none');
    expect(log.points).toBe(0);
    boss.stun();
    expect(boss.bite(0.5)).toBe('hit');
    expect(boss.state).toBe('hurt');
    expect(log.points).toBe(BOSS.phaseHitPoints * 0.5);
    expect(boss.bite(0.5)).toBe('none');
  });

  it('scores phases and the defeat, then hands over to the world', () => {
    const { world, log } = fakeWorld();
    const boss = new TestBoss(world, { kind: 'angler', name: 'Test', phases: 2, hitsPerPhase: 1 });
    boss.stun();
    expect(boss.bite(1)).toBe('phase');
    expect(boss.state).toBe('phaseUp');
    boss.stun();
    expect(boss.bite(1)).toBe('defeated');
    expect(boss.state).toBe('defeated');
    expect(log.defeated).toBe(1);
    expect(log.points).toBe(BOSS.phaseHitPoints * 2 + BOSS.phasePoints + BOSS.defeatPoints);
    expect(log.events).toEqual(['bossHit', 'bossPhase', 'bossHit', 'bossDefeat']);
    expect(log.stats.filter((s) => s === 'bossHit')).toHaveLength(2);
  });

  it('does not take damage before the fight starts', () => {
    const { world } = fakeWorld();
    (world as unknown as { started: boolean }).started = false;
    const boss = new TestBoss(world, { kind: 'kraken', name: 'Test', phases: 1, hitsPerPhase: 1 });
    boss.stun();
    expect(boss.bite(1)).toBe('none');
  });
});
