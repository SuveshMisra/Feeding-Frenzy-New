import type { SpeciesId } from './species';

export type HeroId = 'finn' | 'gulp' | 'spike';
export type AbilityKind = 'dash' | 'suction' | 'puff';
export type UpgradeKind = 'speed' | 'cooldown' | 'shield' | 'life';

export interface HeroDef {
  id: HeroId;
  species: SpeciesId;
  name: string;
  ability: AbilityKind;
  abilityName: string;
  blurb: string;
  /** Level index whose first clear unlocks this hero (-1: always available). */
  unlockAfter: number;
  /** First level index the hero can be picked for. */
  minLevel: number;
}

export const HEROES: Record<HeroId, HeroDef> = {
  finn: {
    id: 'finn',
    species: 'hero',
    name: 'Finn',
    ability: 'dash',
    abilityName: 'Boost',
    blurb: 'Quick dash to snatch prey or dodge a bite.',
    unlockAfter: -1,
    minLevel: 0,
  },
  gulp: {
    id: 'gulp',
    species: 'gulp',
    name: 'Gulp',
    ability: 'suction',
    abilityName: 'Suck',
    blurb: 'Inhales every small fish in front of it. Whole schools at once!',
    unlockAfter: 4,
    minLevel: 4,
  },
  spike: {
    id: 'spike',
    species: 'spike',
    name: 'Spike',
    ability: 'puff',
    abilityName: 'Puff',
    blurb: 'Swells into a spiny ball that bounces predators away and stuns them.',
    unlockAfter: 9,
    minLevel: 10,
  },
};

export const HERO_IDS = Object.keys(HEROES) as HeroId[];

export function isHeroId(v: unknown): v is HeroId {
  return typeof v === 'string' && v in HEROES;
}

/** Heroes the player may pick for a level, given what they've unlocked. Test mode offers every hero everywhere. */
export function heroesFor(levelIndex: number, unlocked: readonly HeroId[], testMode = false): HeroId[] {
  return HERO_IDS.filter((id) => testMode || (unlocked.includes(id) && levelIndex >= HEROES[id].minLevel));
}

export const UPGRADE_STEP = 0.05;
export const UPGRADE_COSTS = [60, 90, 130, 180, 240, 310] as const;
export const UPGRADE_MAX = UPGRADE_COSTS.length;
/** Each shield tier lengthens shields (pickups and the respawn bubble) by this share. */
export const SHIELD_STEP = 0.2;

/** Price of every tier, per upgrade. The table length is the number of tiers. */
export const UPGRADE_COST_TABLE: Record<UpgradeKind, readonly number[]> = {
  speed: UPGRADE_COSTS,
  cooldown: UPGRADE_COSTS,
  shield: [80, 120, 170, 230, 300],
  life: [350, 700],
};

export function upgradeMax(kind: UpgradeKind): number {
  return UPGRADE_COST_TABLE[kind].length;
}

export interface UpgradeDef {
  kind: UpgradeKind;
  name: string;
  describe(level: number): string;
}

export const UPGRADES: Record<UpgradeKind, UpgradeDef> = {
  speed: { kind: 'speed', name: 'Swim speed', describe: (l) => `+${Math.round(l * UPGRADE_STEP * 100)}% speed` },
  cooldown: { kind: 'cooldown', name: 'Ability recharge', describe: (l) => `-${Math.round(l * UPGRADE_STEP * 100)}% cooldown` },
  shield: { kind: 'shield', name: 'Shield duration', describe: (l) => `+${Math.round(l * SHIELD_STEP * 100)}% shield time` },
  life: { kind: 'life', name: 'Extra life', describe: (l) => `+${l} starting ${l === 1 ? 'life' : 'lives'}` },
};

/** Cost of the next tier, or null when maxed. */
export function upgradeCost(level: number, kind: UpgradeKind = 'speed'): number | null {
  const table = UPGRADE_COST_TABLE[kind];
  return level >= table.length ? null : table[Math.max(0, level)];
}

function tiers(kind: UpgradeKind, level: number): number {
  return Math.min(upgradeMax(kind), Math.max(0, Math.floor(level)));
}

export function speedMul(level: number): number {
  return 1 + tiers('speed', level) * UPGRADE_STEP;
}

export function cooldownMul(level: number): number {
  return 1 - tiers('cooldown', level) * UPGRADE_STEP;
}

export function shieldMul(level: number): number {
  return 1 + tiers('shield', level) * SHIELD_STEP;
}

export function bonusLives(level: number): number {
  return tiers('life', level);
}

export const COINS = { base: 20, perStar: 15, scorePer: 250, firstClear: 50 };

/** Coins awarded for clearing a level. */
export function coinsFor(score: number, stars: number, firstClear: boolean): number {
  return COINS.base + COINS.perStar * stars + Math.floor(Math.max(0, score) / COINS.scorePer) + (firstClear ? COINS.firstClear : 0);
}
