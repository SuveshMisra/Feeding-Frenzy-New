import { COMBO, LEVEL_BONUS, TIER_POINTS, type Tier } from '../../config/tuning';

export interface EatScore {
  points: number;
  multiplier: number;
  combo: number;
  /** 1 when this eat reached Frenzy, 2 when it reached Double Frenzy, else 0. */
  frenzy: 0 | 1 | 2;
  /** Points were doubled by a golden frenzy. */
  gold: boolean;
}

/** A golden fish doubles every bite's points for this long, on top of the combo multiplier. */
export const GOLD_FRENZY = { duration: 6, mul: 2 };

export interface LevelBonus {
  time: number;
  noDeath: number;
  total: number;
}

export function multiplierFor(combo: number): number {
  if (combo >= COMBO.doubleFrenzyAt) return 3;
  if (combo >= COMBO.frenzyAt) return 2;
  return 1;
}

export function computeLevelBonus(seconds: number, deaths: number): LevelBonus {
  const time = Math.max(0, Math.round(LEVEL_BONUS.timePar - seconds)) * LEVEL_BONUS.perSecondUnderPar;
  const noDeath = deaths === 0 ? LEVEL_BONUS.noDeath : 0;
  return { time, noDeath, total: time + noDeath };
}

export function starsFor(score: number, thresholds: [number, number]): 1 | 2 | 3 {
  if (score >= thresholds[1]) return 3;
  if (score >= thresholds[0]) return 2;
  return 1;
}

export class Scoring {
  score = 0;
  combo = 0;
  comboTimer = 0;
  maxCombo = 0;
  fishEaten = 0;
  pearls = 0;
  /** Seconds left in a golden frenzy. */
  goldTime = 0;
  /** Scales every bite and bonus (endless danger). */
  pointsMul = 1;

  get multiplier(): number {
    return multiplierFor(this.combo);
  }

  startGoldFrenzy(): void {
    this.goldTime = GOLD_FRENZY.duration;
  }

  /** Remaining combo window, 0..1. */
  get comboFraction(): number {
    return this.combo > 0 ? Math.max(0, this.comboTimer / COMBO.window) : 0;
  }

  update(dt: number): void {
    this.goldTime = Math.max(0, this.goldTime - dt);
    if (this.combo === 0) return;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) {
      this.combo = 0;
      this.comboTimer = 0;
    }
  }

  eat(tier: Tier): EatScore {
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = COMBO.window;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.fishEaten++;
    const multiplier = multiplierFor(this.combo);
    const gold = this.goldTime > 0;
    const points = Math.round(TIER_POINTS[tier] * multiplier * (gold ? GOLD_FRENZY.mul : 1) * this.pointsMul);
    this.score += points;
    const frenzy: 0 | 1 | 2 =
      this.combo === COMBO.doubleFrenzyAt ? 2 : this.combo === COMBO.frenzyAt ? 1 : 0;
    return { points, multiplier, combo: this.combo, frenzy, gold };
  }

  add(points: number): void {
    this.score += points;
  }

  breakCombo(): void {
    this.combo = 0;
    this.comboTimer = 0;
  }
}
