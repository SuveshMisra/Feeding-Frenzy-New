import { describe, expect, it } from 'vitest';
import { makeCone, pullToward, suctionStrength, type SuctionCone } from '../src/game/systems/Suction';

const cone = (): SuctionCone => makeCone(0, 0, 0, 8, { x: 0, y: 0, dirX: 1, dirY: 0, reach: 1, cosHalf: 1 });

describe('Suction cone', () => {
  it('is strongest at the mouth and fades toward its reach', () => {
    const c = cone();
    expect(suctionStrength(c, 0.2, 0)).toBe(1);
    const near = suctionStrength(c, 2, 0);
    const far = suctionStrength(c, 7, 0);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(suctionStrength(c, 9, 0)).toBe(0);
  });

  it('only reaches fish in front of the mouth', () => {
    const c = cone();
    expect(suctionStrength(c, -4, 0)).toBe(0);
    expect(suctionStrength(c, 4, 0.5)).toBeGreaterThan(0);
    expect(suctionStrength(c, 3, 4)).toBe(0);
  });

  it('follows the mouth heading', () => {
    const left = makeCone(0, 0, Math.PI, 8, cone());
    expect(suctionStrength(left, -4, 0)).toBeGreaterThan(0);
    expect(suctionStrength(left, 4, 0)).toBe(0);
  });

  it('drags a fish into the mouth without overshooting', () => {
    const c = cone();
    const f = { x: 6, y: 1, vel: { x: 2, y: 0 } };
    const dt = 1 / 60;
    let reached = false;
    for (let i = 0; i < 120 && !reached; i++) {
      pullToward(c, f, dt);
      f.x += f.vel.x * dt;
      f.y += f.vel.y * dt;
      reached = Math.hypot(f.x, f.y) < 0.5;
    }
    expect(reached).toBe(true);
    expect(f.x).toBeGreaterThan(-0.5);
  });

  it('leaves fish outside the cone alone', () => {
    const c = cone();
    const f = { x: -3, y: 0, vel: { x: -1, y: 0 } };
    expect(pullToward(c, f, 1 / 60)).toBe(0);
    expect(f.vel.x).toBe(-1);
  });
});
