import { describe, expect, it } from 'vitest';
import { BOOST, HAZARD, PLAYER, SUCTION } from '../src/config/tuning';
import { Player, accelerate, seekVelocity, type MoveBounds } from '../src/game/entities/Player';

const bounds: MoveBounds = { minX: -50, maxX: 50, surfaceY: 30, floorAt: () => 0 };
const DT = 1 / 60;

function run(
  p: Player,
  seconds: number,
  target: { x: number; y: number } | null,
  dir: { x: number; y: number; mag: number } | null,
): void {
  for (let t = 0; t < seconds; t += DT) p.update(DT, target, dir, bounds);
}

function spawned(): Player {
  const p = new Player();
  p.setStage(1, false);
  p.spawn(0, 10, 0);
  return p;
}

describe('Player steering helpers', () => {
  it('seeks at full speed when far and slows inside the slow radius', () => {
    const out = { x: 0, y: 0 };
    seekVelocity(0, 0, 100, 0, 10, 4, out);
    expect(out.x).toBeCloseTo(10);
    expect(out.y).toBeCloseTo(0);
    seekVelocity(0, 0, 2, 0, 10, 4, out);
    expect(out.x).toBeCloseTo(5);
    seekVelocity(0, 0, 0.01, 0, 10, 4, out);
    expect(out.x).toBe(0);
  });

  it('accelerates in bounded steps and lands exactly on the target velocity', () => {
    const v = { x: 0, y: 0 };
    accelerate(v, { x: 10, y: 0 }, 30, 0.1);
    expect(v.x).toBeCloseTo(3);
    accelerate(v, { x: 3.5, y: 0 }, 30, 0.1);
    expect(v.x).toBeCloseTo(3.5);
  });
});

describe('Player movement', () => {
  it('swims toward the pointer and turns to face it', () => {
    const p = spawned();
    run(p, 1, { x: -20, y: 10 }, null);
    expect(p.x).toBeLessThan(-3);
    expect(p.facing).toBe(-1);
  });

  it('follows keys and the joystick with analog magnitude', () => {
    const full = spawned();
    run(full, 1, null, { x: 1, y: 0, mag: 1 });
    const half = spawned();
    run(half, 1, null, { x: 1, y: 0, mag: 0.5 });
    expect(full.x).toBeGreaterThan(half.x * 1.5);
    expect(full.facing).toBe(1);
    expect(full.speed).toBeLessThanOrEqual(full.maxSpeed + 1e-6);
  });

  it('stays between the seabed, the surface and the side walls', () => {
    const p = spawned();
    run(p, 4, null, { x: 0, y: 1, mag: 1 });
    expect(p.y).toBeLessThanOrEqual(bounds.surfaceY - p.radius - 0.5 + 1e-6);
    run(p, 8, null, { x: 0, y: -1, mag: 1 });
    expect(p.y).toBeGreaterThanOrEqual(p.radius + 0.35 - 1e-6);
    run(p, 15, null, { x: 1, y: 0, mag: 1 });
    expect(p.x).toBeLessThanOrEqual(bounds.maxX - p.len * 0.5 + 1e-6);
  });

  it('cannot steer while stunned', () => {
    const p = spawned();
    p.stun = 1;
    run(p, 0.5, null, { x: 1, y: 0, mag: 1 });
    expect(Math.abs(p.x)).toBeLessThan(0.05);
  });

  it('grows with an elastic spring when the stage changes', () => {
    const p = spawned();
    const small = p.len;
    p.setStage(2);
    run(p, 2, null, null);
    expect(p.len).toBeGreaterThan(small);
    expect(p.len).toBeCloseTo(PLAYER.lengthByStage[1], 2);
  });

  it('gets faster with a speed boost', () => {
    const p = spawned();
    const base = p.maxSpeed;
    p.speedBoost = HAZARD.speedBoost.duration;
    expect(p.maxSpeed).toBeCloseTo(base * HAZARD.speedBoost.factor);
  });

  it('is protected while the respawn shield lasts', () => {
    const p = new Player();
    p.spawn(0, 10, 2.5);
    expect(p.protected).toBe(true);
    run(p, 2.6, null, null);
    expect(p.protected).toBe(false);
  });
});

describe('Player boost', () => {
  it('dashes toward the aim well past top speed, then eases back to cruising', () => {
    const p = spawned();
    const cruise = p.maxSpeed;
    const aim = { x: 40, y: 10 };
    expect(p.boost(aim.x - p.x, aim.y - p.y)).toBe(true);
    run(p, 0.2, aim, null);
    expect(p.speed).toBeGreaterThan(cruise * 1.8);
    expect(p.vel.x).toBeGreaterThan(0);
    run(p, BOOST.duration + BOOST.fade, aim, null);
    expect(p.boostLevel).toBe(0);
    run(p, 0.5, aim, null);
    expect(p.speed).toBeLessThanOrEqual(cruise + 1e-6);
  });

  it('has a cooldown that starts the moment it fires', () => {
    const p = spawned();
    expect(p.boost(1, 0)).toBe(true);
    expect(p.boost(1, 0)).toBe(false);
    run(p, BOOST.cooldown - 0.1, null, null);
    expect(p.boost(1, 0)).toBe(false);
    run(p, 0.15, null, null);
    expect(p.boost(1, 0)).toBe(true);
  });

  it('dashes along the current heading when there is no aim', () => {
    const p = spawned();
    p.facing = -1;
    expect(p.boost()).toBe(true);
    expect(p.vel.x).toBeLessThan(-p.cruiseSpeed);
    run(p, 0.3, null, null);
    expect(p.x).toBeLessThan(-3);
  });

  it('is cut short by a sting and never fires while stunned', () => {
    const p = spawned();
    p.boost(1, 0);
    p.stun = 1;
    run(p, 0.05, null, null);
    expect(p.boostLevel).toBe(0);

    const q = spawned();
    q.stun = 1;
    expect(q.boost(1, 0)).toBe(false);
    expect(q.boostCooldown).toBe(0);
  });

  it('keeps pickups and the AI on cruise speed, and resets on respawn', () => {
    const p = spawned();
    p.speedBoost = HAZARD.speedBoost.duration;
    const cruise = p.cruiseSpeed;
    p.boost(1, 0);
    expect(p.cruiseSpeed).toBe(cruise);
    expect(p.maxSpeed).toBeCloseTo(cruise * BOOST.speedMul);
    p.spawn(0, 10, 0);
    expect(p.boostCooldown).toBe(0);
    expect(p.boostLevel).toBe(0);
  });
});

describe('Player upgrades and abilities', () => {
  it('swims faster with the speed upgrade', () => {
    const base = spawned();
    const fast = new Player({ speedMul: 1.3 });
    fast.setStage(1, false);
    fast.spawn(0, 10, 0);
    expect(fast.cruiseSpeed).toBeCloseTo(base.cruiseSpeed * 1.3);
    run(base, 1, null, { x: 1, y: 0, mag: 1 });
    run(fast, 1, null, { x: 1, y: 0, mag: 1 });
    expect(fast.x).toBeGreaterThan(base.x * 1.2);
  });

  it('recharges faster with the cooldown upgrade', () => {
    const p = new Player({ cooldownMul: 0.7 });
    p.spawn(0, 10, 0);
    expect(p.boost(1, 0)).toBe(true);
    expect(p.boostCooldown).toBeCloseTo(BOOST.cooldown * 0.7);
    run(p, BOOST.cooldown * 0.7 + 0.05, null, null);
    expect(p.boost(1, 0)).toBe(true);
  });

  it('gives Gulp a suction vortex instead of a dash', () => {
    const p = new Player({ ability: 'suction', cooldownMul: 0.8 });
    p.spawn(0, 10, 0);
    const cruise = p.maxSpeed;
    expect(p.boost(1, 0)).toBe(false);
    expect(p.suck()).toBe(true);
    expect(p.abilityActive).toBe(true);
    expect(p.maxSpeed).toBeCloseTo(cruise * SUCTION.speedMul);
    expect(p.boostCooldown).toBeCloseTo(SUCTION.cooldown * 0.8);
    expect(p.suck()).toBe(false);
    run(p, SUCTION.duration + 0.05, null, null);
    expect(p.abilityActive).toBe(false);
    expect(p.maxSpeed).toBeCloseTo(cruise);
  });

  it('cancels suction when stunned', () => {
    const p = new Player({ ability: 'suction' });
    p.spawn(0, 10, 0);
    p.suck();
    p.stun = 1;
    run(p, 0.05, null, null);
    expect(p.suckTime).toBe(0);
  });
});
