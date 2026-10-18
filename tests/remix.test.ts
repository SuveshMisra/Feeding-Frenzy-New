import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { LEVELS, chapterLevels, type LevelDef } from '../src/config/levels';
import { PUFF_ABILITY } from '../src/config/tuning';
import { Player, abilityCooldownFor, puffKnock } from '../src/game/entities/Player';
import { FeatureBase } from '../src/game/features/FeatureBase';
import { CRYSTAL } from '../src/game/features/Crystals';
import { CURRENT, currentTurn } from '../src/game/features/Currents';
import { DARK } from '../src/game/features/Darkness';
import { GUARD, nearestPartner } from '../src/game/features/Guardians';
import { HEAT, heatPulses } from '../src/game/features/HeatWaves';
import { chainPicks } from '../src/game/features/helpers';
import { ICE } from '../src/game/features/Icicles';
import { KELP, surgeHalfWidth, surgePhase } from '../src/game/features/KelpHide';
import { EEL } from '../src/game/features/MorayEels';
import { PUFF, lionfishFacing } from '../src/game/features/Pufferfish';
import { diveY } from '../src/game/features/Seabirds';
import { TIDE } from '../src/game/features/Tide';
import type { FeatureId } from '../src/game/features/types';
import type { World } from '../src/game/World';
import { mineSwing } from '../src/game/hazards/Hazards';

const DEFAULTS: Record<FeatureId, object> = {
  puffer: PUFF,
  kelpHide: KELP,
  eels: EEL,
  icicles: ICE,
  darkness: DARK,
  tide: TIDE,
  currents: CURRENT,
  guardians: GUARD,
  crystals: CRYSTAL,
  heat: HEAT,
};

class Probe extends FeatureBase {
  readonly cfg = this.opts({ a: 1, b: false, c: [1, 2] as readonly number[] });
}

function probe(featureOpts?: LevelDef['featureOpts']): Probe {
  const world = { level: { seed: 1, featureOpts }, scene: new Scene() } as unknown as World;
  return new Probe(world, 'puffer');
}

describe('Feature options', () => {
  it('merges level overrides over the defaults', () => {
    expect(probe().cfg).toEqual({ a: 1, b: false, c: [1, 2] });
    expect(probe({ b: true, c: [5, 6] }).cfg).toEqual({ a: 1, b: true, c: [5, 6] });
  });

  it('only overrides tuning that exists, with a value of the same type', () => {
    for (const l of LEVELS) {
      if (!l.featureOpts || !l.feature) continue;
      const defaults = DEFAULTS[l.feature] as Record<string, unknown>;
      for (const [k, v] of Object.entries(l.featureOpts)) {
        expect(k in defaults, `${l.id}.${k}`).toBe(true);
        expect(Array.isArray(v), `${l.id}.${k}`).toBe(Array.isArray(defaults[k]));
        expect(typeof v, `${l.id}.${k}`).toBe(typeof defaults[k]);
      }
    }
  });

  it('turns every twist on in Ocean II only', () => {
    for (const l of chapterLevels(1)) expect(l.featureOpts, l.id).toBeUndefined();
    for (const l of chapterLevels(2)) expect(Object.keys(l.featureOpts ?? {}).length, l.id).toBeGreaterThan(0);
  });
});

describe('Ocean II twists', () => {
  it('swings drifting mines no further than 80% of the chain', () => {
    let max = 0;
    for (let t = 0; t < 200; t += 0.25) max = Math.max(max, Math.abs(mineSwing(t, 3, 3, 10)));
    expect(max).toBeGreaterThan(2);
    expect(max).toBeLessThanOrEqual(3 + 1e-9);
    for (let t = 0; t < 200; t += 0.25) expect(Math.abs(mineSwing(t, 1, 5, 2))).toBeLessThanOrEqual(1.6 + 1e-9);
    expect(mineSwing(10, 1, 0, 10)).toBeCloseTo(0);
  });

  it('picks the nearest neighbours in reach for chain reactions', () => {
    const xs = [0, 5, -3, 20, 8];
    expect(chainPicks(xs, 0, 2, 10)).toEqual([0, 2]);
    expect(chainPicks(xs, 0, 9, 10)).toEqual([0, 2, 1, 4]);
    expect(chainPicks(xs, 100, 3, 10)).toEqual([]);
    expect(chainPicks(xs, 0, 0, 10)).toEqual([]);
  });

  it('pairs a guardian with its nearest awake partner', () => {
    expect(nearestPartner([null, 10, -30, 50], 0, 40)).toBe(1);
    expect(nearestPartner([null, 60], 0, 40)).toBe(-1);
    expect(nearestPartner([], 0, 40)).toBe(-1);
  });

  it('fades currents out, flips them halfway and brings them back', () => {
    expect(currentTurn(0, 2)).toEqual({ strength: 1, flipped: false });
    expect(currentTurn(1, 2).strength).toBeCloseTo(0);
    expect(currentTurn(0.9, 2).flipped).toBe(false);
    expect(currentTurn(1.1, 2).flipped).toBe(true);
    expect(currentTurn(5, 2)).toEqual({ strength: 1, flipped: true });
  });

  it('staggers double heat waves by the pulse gap', () => {
    const [a, b] = heatPulses(1, 2, 1.8, 6, 0, 20, 4);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    const later = heatPulses(3, 2, 1.8, 6, 0, 20, 4);
    expect(later[0]!.y1).toBeGreaterThan(later[1]!.y1);
    expect(heatPulses(1, 1, 1.8, 6, 0, 20, 4)).toHaveLength(1);
  });

  it('dives seabirds faster as they fall', () => {
    expect(diveY(0, 1, 30, 10)).toBe(30);
    expect(diveY(1, 1, 30, 10)).toBe(10);
    expect(diveY(2, 1, 30, 10)).toBe(10);
    const first = 30 - diveY(0.5, 1, 30, 10);
    const second = diveY(0.5, 1, 30, 10) - 10;
    expect(second).toBeGreaterThan(first);
  });

  it('narrows storm kelp at the ends of each surge', () => {
    expect(surgePhase(0, 9)).toBeCloseTo(0);
    expect(surgePhase(9 / 4, 9)).toBeCloseTo(1);
    expect(surgeHalfWidth(4, 0, 0.6)).toBe(4);
    expect(surgeHalfWidth(4, 1, 0.6)).toBeCloseTo(2.4);
    expect(surgeHalfWidth(4, -1, 0.6)).toBeCloseTo(2.4);
  });

  it('only lets a lionfish sting from the front', () => {
    expect(lionfishFacing(0, 0, 0, 3, 0)).toBe(true);
    expect(lionfishFacing(0, 0, 0, -3, 0)).toBe(false);
    expect(lionfishFacing(0, 0, 0, 0, 3)).toBe(false);
    expect(lionfishFacing(Math.PI, 0, 0, -3, 0.5)).toBe(true);
  });
});

describe('Spike puff', () => {
  const bounds = { minX: -50, maxX: 50, surfaceY: 30, floorAt: () => 0 };

  it('swells, protects and slows Spike while puffed, then recharges', () => {
    const p = new Player({ ability: 'puff' });
    p.spawn(0, 10, 0);
    const cruise = p.maxSpeed;
    expect(p.protected).toBe(false);
    expect(p.boost(1, 0)).toBe(false);
    expect(p.puff()).toBe(true);
    expect(p.puff()).toBe(false);
    expect(p.abilityActive).toBe(true);
    expect(p.protected).toBe(true);
    expect(p.maxSpeed).toBeCloseTo(cruise * PUFF_ABILITY.speedMul);
    expect(p.boostCooldown).toBeCloseTo(PUFF_ABILITY.cooldown);
    for (let t = 0; t < 0.5; t += 1 / 60) p.update(1 / 60, null, null, bounds);
    expect(p.puffLevel).toBeCloseTo(1);
    for (let t = 0; t < PUFF_ABILITY.duration; t += 1 / 60) p.update(1 / 60, null, null, bounds);
    expect(p.puffLevel).toBe(0);
    expect(p.protected).toBe(false);
    p.spawn(0, 10, 0);
    expect(p.puffTime).toBe(0);
  });

  it('only puffs for Spike, and never while stunned', () => {
    expect(new Player().puff()).toBe(false);
    const p = new Player({ ability: 'puff' });
    p.spawn(0, 10, 0);
    p.stun = 1;
    expect(p.puff()).toBe(false);
    expect(abilityCooldownFor('puff')).toBe(PUFF_ABILITY.cooldown);
  });

  it('knocks fish straight away from Spike within reach', () => {
    const k = puffKnock(0, 0, 3, 4, 6, 10)!;
    expect(k.x).toBeCloseTo(6);
    expect(k.y).toBeCloseTo(8);
    expect(puffKnock(0, 0, 10, 0, 6, 10)).toBeNull();
    expect(puffKnock(1, 1, 1, 1, 6, 10)).toEqual({ x: 10, y: 0 });
  });
});
