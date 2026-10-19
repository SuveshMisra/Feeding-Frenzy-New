/** Endless mode: the danger level climbs on a clock and the ocean gets meaner with it. */
export const ENDLESS = {
  /** Seconds of survival per danger level. */
  step: 45,
  /** Points multiplier gained per danger level. */
  pointsPer: 0.25,
  /** The great white starts patrolling at this danger level. */
  greatWhiteFrom: 2,
  /** Extra predators kept around the player per danger level above 1, and the most it adds. */
  predatorsPer: 0.5,
  predatorsMax: 4,
  /** Chase speed multiplier gained per danger level above 1, and its cap. */
  chasePer: 0.04,
  chaseMax: 1.35,
  /** How much faster mid-run events come due per danger level above 1, and the cap. */
  eventsPer: 0.2,
  eventsMax: 2.6,
};

export interface EndlessTuning {
  extraPredators: number;
  chaseMul: number;
  eventRate: number;
  greatWhite: boolean;
  pointsMul: number;
}

/** Danger level after `time` seconds of survival: 1 at the start, +1 every `ENDLESS.step`. */
export function dangerLevel(time: number): number {
  return 1 + Math.floor(Math.max(0, time) / ENDLESS.step);
}

/** 0..1 progress toward the next danger level. */
export function dangerProgress(time: number): number {
  return (Math.max(0, time) % ENDLESS.step) / ENDLESS.step;
}

export function endlessTuning(danger: number): EndlessTuning {
  const n = Math.max(0, danger - 1);
  return {
    extraPredators: Math.min(ENDLESS.predatorsMax, Math.floor(n * ENDLESS.predatorsPer)),
    chaseMul: Math.min(ENDLESS.chaseMax, 1 + n * ENDLESS.chasePer),
    eventRate: Math.min(ENDLESS.eventsMax, 1 + n * ENDLESS.eventsPer),
    greatWhite: danger >= ENDLESS.greatWhiteFrom,
    pointsMul: 1 + ENDLESS.pointsPer * danger,
  };
}
