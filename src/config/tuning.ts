export const GAME_TITLE = 'Fin Frenzy';

export type Tier = 1 | 2 | 3 | 4;
export type Stage = 1 | 2 | 3 | 4;

/** Every fish eaten is one growth point; this many points fill one stage. */
export const FISH_PER_STAGE = 50;
/** The last stage is the apex: every fish in the roster is food and filling it clears the level. */
export const STAGE_COUNT = 4;
/** Endless runs and boss fights stop short of the apex, so there is always something to fear. */
export const PRE_APEX_STAGE_COUNT = 3;

export const LIVES = { start: 3, max: 5 };
export const RESPAWN_SHIELD_S = 2.5;

export const COMBO = {
  window: 1.5,
  frenzyAt: 5,
  doubleFrenzyAt: 10,
};

export const TIER_POINTS: Record<Tier, number> = { 1: 10, 2: 25, 3: 50, 4: 100 };

export const PLAYER = {
  lengthByStage: [1.15, 2.3, 3.9, 8] as const,
  speedByStage: [8, 9.4, 10.8, 12] as const,
  accel: 36,
  /** Mouse-follow slows down inside this radius (scaled by stage length). */
  slowRadius: 1.8,
  stunTime: 1.0,
};

/** Left-click dash. The cooldown starts the moment the boost fires. */
export const BOOST = {
  cooldown: 5,
  /** Seconds at full boost speed before it eases back to normal over `fade` seconds. */
  duration: 0.4,
  fade: 0.35,
  speedMul: 2.2,
  accelMul: 5,
};

/** Spike's ability: swells into a spiny ball that knocks back and stuns nearby predators. */
export const PUFF_ABILITY = {
  duration: 1.6,
  cooldown: 9,
  /** Predators within this distance (plus their size) are knocked away and stunned. */
  radius: 4.5,
  knock: 9,
  stun: 1.2,
  /** Spike swims slower while puffed. */
  speedMul: 0.7,
  /** Extra size when fully puffed. */
  swell: 0.55,
};

/** Gulp's ability: a short vortex that pulls edible fish in a cone ahead into the mouth. */
export const SUCTION = {
  cooldown: 6,
  duration: 1.2,
  /** Gulp swims slower while inhaling. */
  speedMul: 0.6,
  /** Cone reach = reachBase + reachPerLen * body length. */
  reachBase: 2.5,
  reachPerLen: 3,
  halfAngleDeg: 35,
  /** Inward acceleration at the mouth and at the cone's far edge. */
  pullNear: 60,
  pullFar: 18,
  /** Cap on the inward speed of a fish caught in the vortex. */
  maxPullSpeed: 16,
};

export const CAMERA = {
  fov: 40,
  viewHeightByStage: [14, 19.5, 26, 30] as const,
  followLambda: 3.4,
  lookAhead: 0.32,
  marginBottom: 1.2,
  marginTop: 2.6,
};

export const PREDATOR = {
  reactionTime: 0.35,
  /** loseRadius = detectRadius * loseMultiplier */
  loseMultiplier: 1.6,
  /** Detect radius grows by this fraction per player stage, since the view widens as you grow. */
  detectPerStage: 0.12,
  /** Bigger fish see a little farther: detect radius gains this much per unit of body length. */
  detectPerLength: 0.15,
  /** How far ahead (seconds) a chaser aims at the player's predicted position. */
  leadMax: 0.4,
  /** Tier-4 giants are lumbering: a slower chase and wider turns, so you can outrun or dodge them. */
  heavyChaseMul: 0.85,
  heavyChaseAccel: 11,
  maxChase: 4,
  /** Chase speed starts at this fraction and reaches full speed after chaseRampTime seconds. */
  chaseRampStart: 0.6,
  chaseRampTime: 0.8,
  cooldown: 2,
  viewConeDeg: 240,
  /** Inside detectRadius * closeFraction a predator notices you even from behind. */
  closeFraction: 0.4,
};

export const PREY = {
  fleeRadius: 4,
  panicTime: 1.5,
  tiredTime: 1.8,
  fleeSpeedOfPlayer: 0.68,
};

export const SPAWN = {
  edibleByStage: [
    [60, 68],
    [50, 58],
    [43, 50],
    [34, 40],
  ] as const,
  /** Tier-1 school size by player stage: smaller schools once they're just snacks. */
  schoolSizeByStage: [
    [11, 17],
    [8, 13],
    [5, 9],
    [4, 7],
  ] as const,
  /** Big fish sent in the moment the player reaches the apex stage. */
  apexWave: 6,
  threatSafeMultiplier: 1.5,
  despawnMargin: 14,
  spawnMargin: 3,
  interval: 0.25,
  /** Below this fraction of the edible target, each spawn tick adds two groups to catch up. */
  refillBelow: 0.7,
  /** Seconds between new threats arriving, so escaping a chase buys a breather. */
  threatGap: [3, 6] as const,
  /** Each level shortens the threat gap by this fraction. */
  threatGapLevelCut: 0.06,
};

export const HAZARD = {
  stingStun: 1.0,
  jellyCooldown: 1.5,
  mineBlastRadius: 4.5,
  pearlPoints: 500,
  blackPearlChance: 0.15,
  pearlRegrow: 15,
  gemPoints: 200,
  speedBoost: { duration: 5, factor: 1.4 },
  shieldDuration: 5,
  pickupInterval: [22, 38] as const,
  geyser: {
    /** Seconds between eruptions (random per geyser). */
    period: [7, 10] as const,
    warn: 1.7,
    erupt: 2.1,
    /** Column height as a share of the water depth above the vent. */
    reach: [0.6, 0.85] as const,
    halfWidth: 0.9,
    stun: 1.1,
    knock: 9,
  },
};

export const LEVEL_BONUS = {
  noDeath: 1000,
  timePar: 240,
  perSecondUnderPar: 10,
};
