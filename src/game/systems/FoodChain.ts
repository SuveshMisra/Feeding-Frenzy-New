import type { Stage, Tier } from '../../config/tuning';

/** The player can eat any fish whose tier is at or below its stage. Tier 4 is never edible. */
export function playerCanEat(stage: Stage, tier: Tier): boolean {
  return tier < 4 && tier <= stage;
}

/** How big a mouthful a fish is for the player, from 1 (its own size class) down to 0.25 (tiny fry). */
export function mealSize(stage: Stage, tier: Tier): number {
  const gap = stage - tier;
  return gap <= 0 ? 1 : gap === 1 ? 0.5 : 0.25;
}

/** Anything bigger than the player's current stage is a threat. */
export function isThreat(stage: Stage, tier: Tier): boolean {
  return !playerCanEat(stage, tier);
}

/** Circle overlap test used for bites. */
export function circlesTouch(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const r = ar + br;
  return dx * dx + dy * dy < r * r;
}

/** Tiers the spawner should favour for edible fish at a given stage (weights sum to 1). */
export function edibleTierWeights(stage: Stage): { w: number; v: Tier }[] {
  switch (stage) {
    case 1:
      return [{ w: 1, v: 1 }];
    case 2:
      return [
        { w: 0.4, v: 2 },
        { w: 0.6, v: 1 },
      ];
    case 3:
      return [
        { w: 0.64, v: 3 },
        { w: 0.14, v: 2 },
        { w: 0.22, v: 1 },
      ];
  }
}

/** Tiers used for threats at a given stage. */
export function threatTierWeights(stage: Stage): { w: number; v: Tier }[] {
  switch (stage) {
    case 1:
      return [
        { w: 0.45, v: 2 },
        { w: 0.33, v: 3 },
        { w: 0.22, v: 4 },
      ];
    case 2:
      return [
        { w: 0.6, v: 3 },
        { w: 0.4, v: 4 },
      ];
    case 3:
      return [{ w: 1, v: 4 }];
  }
}
