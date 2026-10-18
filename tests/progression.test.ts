import { describe, expect, it } from 'vitest';
import { UPGRADES, UPGRADE_MAX, bonusLives, coinsFor, cooldownMul, heroesFor, shieldMul, speedMul, upgradeCost, upgradeMax } from '../src/config/progression';

describe('Progression', () => {
  it('awards coins from stars, score and a first-clear bonus', () => {
    expect(coinsFor(0, 1, false)).toBe(35);
    expect(coinsFor(6000, 2, false)).toBe(20 + 30 + 24);
    expect(coinsFor(6000, 2, true)).toBe(20 + 30 + 24 + 50);
    expect(coinsFor(-100, 1, false)).toBe(35);
  });

  it('prices upgrade tiers and stops at the cap', () => {
    expect(upgradeCost(0)).toBe(60);
    expect(upgradeCost(5)).toBe(310);
    expect(upgradeCost(UPGRADE_MAX)).toBeNull();
  });

  it('caps both upgrades at 30%', () => {
    expect(speedMul(0)).toBe(1);
    expect(speedMul(3)).toBeCloseTo(1.15);
    expect(speedMul(99)).toBeCloseTo(1.3);
    expect(cooldownMul(6)).toBeCloseTo(0.7);
    expect(cooldownMul(-2)).toBe(1);
  });

  it('prices shield and life tiers on their own tables', () => {
    expect(upgradeMax('shield')).toBe(5);
    expect(upgradeMax('life')).toBe(2);
    expect(upgradeCost(0, 'shield')).toBe(80);
    expect(upgradeCost(4, 'shield')).toBe(300);
    expect(upgradeCost(5, 'shield')).toBeNull();
    expect(upgradeCost(0, 'life')).toBe(350);
    expect(upgradeCost(1, 'life')).toBe(700);
    expect(upgradeCost(2, 'life')).toBeNull();
    expect(upgradeCost(0, 'cooldown')).toBe(60);
  });

  it('scales shields by 20% a tier and adds lives up to the cap', () => {
    expect(shieldMul(0)).toBe(1);
    expect(shieldMul(2)).toBeCloseTo(1.4);
    expect(shieldMul(9)).toBeCloseTo(2);
    expect(bonusLives(0)).toBe(0);
    expect(bonusLives(1)).toBe(1);
    expect(bonusLives(7)).toBe(2);
    expect(UPGRADES.life.describe(1)).toBe('+1 starting life');
    expect(UPGRADES.shield.describe(3)).toBe('+60% shield time');
  });

  it('offers Gulp only from level 5 once unlocked', () => {
    expect(heroesFor(4, ['finn'])).toEqual(['finn']);
    expect(heroesFor(3, ['finn', 'gulp'])).toEqual(['finn']);
    expect(heroesFor(4, ['finn', 'gulp'])).toEqual(['finn', 'gulp']);
    expect(heroesFor(9, ['finn', 'gulp'])).toEqual(['finn', 'gulp']);
  });
});
