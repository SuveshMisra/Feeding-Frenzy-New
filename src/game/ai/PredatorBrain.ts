import { PREDATOR } from '../../config/tuning';

export type PredatorState = 'wander' | 'alert' | 'chase' | 'giveUp';

export interface PredatorSense {
  /** Distance to the player. */
  dist: number;
  /** Player is inside the predator's forward view cone. */
  inViewCone: boolean;
  /** The predator is bigger than the player and the player is vulnerable. */
  canEatPlayer: boolean;
  detectRadius: number;
  maxChase: number;
}

export interface PredatorConfig {
  reactionTime: number;
  loseMultiplier: number;
  cooldown: number;
  closeFraction: number;
}

/**
 * Wander -> Alert -> Chase -> GiveUp -> Wander.
 * Detection happens inside detectRadius; a chase only ends beyond loseRadius
 * (detectRadius * loseMultiplier), so small movements don't flicker the state.
 */
export class PredatorBrain {
  state: PredatorState = 'wander';
  timer = 0;

  constructor(private readonly cfg: PredatorConfig = PREDATOR) {}

  get hunting(): boolean {
    return this.state === 'alert' || this.state === 'chase';
  }

  /** Returns true when the state changed this step. */
  update(dt: number, s: PredatorSense): boolean {
    this.timer += dt;
    const prev = this.state;
    const loseRadius = s.detectRadius * this.cfg.loseMultiplier;
    switch (this.state) {
      case 'wander':
        if (
          s.canEatPlayer &&
          s.dist < s.detectRadius &&
          (s.inViewCone || s.dist < s.detectRadius * this.cfg.closeFraction)
        ) {
          this.enter('alert');
        }
        break;
      case 'alert':
        if (!s.canEatPlayer || s.dist > loseRadius) this.enter('wander');
        else if (this.timer >= this.cfg.reactionTime) this.enter('chase');
        break;
      case 'chase':
        if (!s.canEatPlayer || s.dist > loseRadius || this.timer >= s.maxChase) this.enter('giveUp');
        break;
      case 'giveUp':
        if (this.timer >= this.cfg.cooldown) this.enter('wander');
        break;
    }
    return this.state !== prev;
  }

  enter(state: PredatorState): void {
    this.state = state;
    this.timer = 0;
  }
}
