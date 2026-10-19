import { describe, expect, it } from 'vitest';
import { createNoise2D } from 'simplex-noise';
import { LEVELS } from '../src/config/levels';
import { SPECIES } from '../src/config/species';
import { PLAYER, PREDATOR, SPAWN, type Stage } from '../src/config/tuning';
import { Rng } from '../src/engine/rng';
import { SpatialHash } from '../src/game/ai/SpatialHash';
import { updateFish, type AiContext } from '../src/game/ai/behaviors';
import { Fish } from '../src/game/entities/Fish';
import { Spawner, type SpawnContext } from '../src/game/systems/Spawner';
import { isThreat } from '../src/game/systems/FoodChain';

const DT = 1 / 60;

function context(stage: Stage, px: number, py: number): AiContext {
  const rng = new Rng(3);
  return {
    dt: DT,
    time: 0,
    player: { x: px, y: py, vx: 0, vy: 0, len: 1, stage, maxSpeed: 8, alive: true },
    bounds: { minX: -200, maxX: 200, surfaceY: 40, floorAt: () => 0 },
    hash: new SpatialHash<Fish>(2.5),
    noise: createNoise2D(() => rng.next()),
    detectRadius: 7,
    chaseSpeed: 0.85,
    detectMul: 1,
    hiddenTime: 0,
    flow: null,
  };
}

function step(f: Fish, c: AiContext, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) {
    c.time += DT;
    c.hash.clear();
    c.hash.insert(f);
    updateFish(f, c);
  }
}

function fishAt(id: keyof typeof SPECIES, x: number, y: number, vx: number): Fish {
  const f = new Fish(SPECIES[id], 1);
  f.place(x, y, vx, 0);
  f.bandMin = 2;
  f.bandMax = 38;
  return f;
}

describe('SpatialHash', () => {
  it('returns only items inside the query radius', () => {
    const hash = new SpatialHash<{ x: number; y: number }>(2.5);
    const near = { x: 1, y: 1 };
    const edge = { x: 3.9, y: 0 };
    const far = { x: 9, y: 9 };
    for (const p of [near, edge, far]) hash.insert(p);
    const found: { x: number; y: number }[] = [];
    hash.query(0, 0, 4, (item, d2) => {
      expect(d2).toBeCloseTo(item.x * item.x + item.y * item.y);
      found.push(item);
    });
    expect(found).toContain(near);
    expect(found).toContain(edge);
    expect(found).not.toContain(far);
  });
});

describe('Fish movement', () => {
  it('remembers only the last step as its previous position, so rendering interpolates one step', () => {
    const c = context(1, 60, 20);
    const f = fishAt('butterflyfish', 0, 20, 2);
    step(f, c, 2);
    expect(Math.hypot(f.x - f.prevX, f.y - f.prevY)).toBeCloseTo(f.speed * DT, 5);
  });
});

describe('Predator behaviour', () => {
  it('notices a small player in view, hesitates, then chases', () => {
    const c = context(1, 5, 20);
    const shark = fishAt('butterflyfish', 0, 20, 2);
    step(shark, c, 0.1);
    expect(shark.brain!.state).toBe('alert');
    expect(shark.alert).toBeGreaterThan(0);
    step(shark, c, PREDATOR.reactionTime);
    expect(shark.brain!.state).toBe('chase');
    const before = Math.hypot(shark.x - c.player.x, shark.y - c.player.y);
    step(shark, c, 0.5);
    expect(Math.hypot(shark.x - c.player.x, shark.y - c.player.y)).toBeLessThan(before);
  });

  it('gives up once the player gets beyond the lose radius', () => {
    const c = context(1, 5, 20);
    const f = fishAt('butterflyfish', 0, 20, 2);
    step(f, c, 0.6);
    expect(f.brain!.state).toBe('chase');
    c.player.x = f.x + 40;
    step(f, c, 0.1);
    expect(f.brain!.state).toBe('giveUp');
    step(f, c, PREDATOR.cooldown + 0.1);
    expect(f.brain!.state).toBe('wander');
  });

  it('ignores a player it cannot see who is outside the close radius', () => {
    const c = context(1, -5.5, 20);
    const f = fishAt('butterflyfish', 0, 20, 3);
    step(f, c, 0.05);
    expect(f.brain!.state).toBe('wander');
  });

  /** Chases a player kept 9 units ahead (inside the lose radius) and returns the chaser's speed. */
  function chaseSpeedAfter(id: keyof typeof SPECIES, seconds: number, startVx = 0): number {
    const c = context(1, 9, 20);
    const f = fishAt(id, 0, 20, startVx);
    f.mode = 'predator';
    f.brain!.enter('chase');
    for (let t = 0; t < seconds; t += DT) {
      c.player.x = f.x + 9;
      c.time += DT;
      c.hash.clear();
      c.hash.insert(f);
      updateFish(f, c);
    }
    expect(f.brain!.state).toBe('chase');
    return Math.hypot(f.vel.x, f.vel.y);
  }

  it('chases at the level chase speed, which stays below the player top speed', () => {
    const full = PLAYER.speedByStage[0] * context(1, 0, 0).chaseSpeed;
    const speed = chaseSpeedAfter('butterflyfish', 2.5);
    expect(speed).toBeCloseTo(full, 1);
    expect(speed).toBeLessThan(PLAYER.speedByStage[0]);
  });

  it('eases into a chase so a player reacting to the alert can turn away', () => {
    const full = PLAYER.speedByStage[0] * context(1, 0, 0).chaseSpeed;
    expect(chaseSpeedAfter('butterflyfish', 0.15, full)).toBeLessThan(full * 0.85);
    expect(chaseSpeedAfter('butterflyfish', 1.2, full)).toBeCloseTo(full, 1);
  });

  it('lets tier-4 giants fall behind smaller hunters', () => {
    const full = PLAYER.speedByStage[0] * context(1, 0, 0).chaseSpeed;
    expect(SPECIES.barracuda.tier).toBe(4);
    expect(chaseSpeedAfter('barracuda', 2.5)).toBeCloseTo(full * PREDATOR.heavyChaseMul, 1);
  });

  it('flees instead of hunting once the player has outgrown it', () => {
    const c = context(2, -3, 20);
    c.player.vx = 6;
    const f = fishAt('butterflyfish', 0, 20, 0);
    step(f, c, 0.5);
    expect(f.mode).toBe('prey');
    expect(f.brain!.hunting).toBe(false);
    expect(f.x).toBeGreaterThan(0.5);
  });
});

describe('Spawner', () => {
  const level = LEVELS[0];
  const world = { minX: -level.world.width / 2, maxX: level.world.width / 2, surfaceY: level.world.height, floorAt: () => 0 };

  function ctx(stage: Stage): SpawnContext {
    return {
      stage,
      playerX: 0,
      playerY: 12,
      view: { x0: -18, x1: 18, y0: 2, y1: 22 },
      detectRadius: level.difficulty.detectRadius,
      hasPlayer: true,
    };
  }

  it('fills the level with food and a few threats', () => {
    const s = new Spawner(level, world, 11);
    s.populate(ctx(1));
    const { edible, threats } = s.counts(1);
    expect(edible).toBeGreaterThanOrEqual(SPAWN.edibleByStage[0][0]);
    expect(threats).toBe(s.threatTarget(1));
  });

  it('turns the whole roster into food at the apex stage', () => {
    const s = new Spawner(level, world, 3);
    const c = ctx(4);
    s.populate(c);
    for (let t = 0; t < 20; t += DT) s.update(DT, c);
    expect(s.threatTarget(4)).toBe(0);
    expect(s.counts(4).threats).toBe(0);
    expect(s.fish.some((f) => f.alive && f.tier === 4)).toBe(true);
  });

  it('never spawns a threat inside the safety distance', () => {
    for (let seed = 1; seed < 25; seed++) {
      const s = new Spawner(level, world, seed);
      const c = ctx(1);
      s.populate(c);
      for (const f of s.fish) {
        if (!isThreat(1, f.tier)) continue;
        const d = Math.hypot(f.x - c.playerX, f.y - c.playerY);
        expect(d).toBeGreaterThanOrEqual(c.detectRadius * SPAWN.threatSafeMultiplier);
      }
    }
  });

  it('spaces out new threats so escaping a chase buys a breather', () => {
    const s = new Spawner(level, world, 7);
    const c = ctx(1);
    s.populate(c);
    for (const f of s.fish) if (isThreat(1, f.tier)) f.alive = false;
    for (let t = 0; t < 1.5; t += DT) s.update(DT, c);
    expect(s.counts(1).threats).toBe(1);
    for (let t = 0; t < SPAWN.threatGap[1] + 0.5; t += DT) s.update(DT, c);
    expect(s.counts(1).threats).toBe(2);
  });

  it('despawns fish that drift far outside the view unless they are hunting', () => {
    const s = new Spawner(level, world, 5);
    const c = ctx(1);
    s.populate(c);
    const far = s.fish[0];
    far.x = c.view.x1 + SPAWN.despawnMargin + 5;
    const hunter = s.fish.find((f) => f.brain && isThreat(1, f.tier))!;
    hunter.x = c.view.x0 - SPAWN.despawnMargin - 5;
    hunter.brain!.enter('chase');
    s.update(DT, c);
    expect(s.fish).not.toContain(far);
    expect(s.fish).toContain(hunter);
  });
});
