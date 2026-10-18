import type { SpeciesDef } from '../../config/species';
import type { Tier } from '../../config/tuning';
import { clamp, damp, dampAngle } from '../../engine/math';
import { PredatorBrain } from '../ai/PredatorBrain';
import { FACING_TILT } from './Player';

let nextUid = 1;

export interface School {
  id: number;
  members: Fish[];
  /** Point the school drifts toward. */
  goalX: number;
  goalY: number;
  heading: number;
  panic: number;
}

export type FishMode = 'prey' | 'predator';

export class Fish {
  readonly uid = nextUid++;
  readonly tier: Tier;
  len: number;
  /** Half body height (collision radius). */
  readonly radius: number;
  x = 0;
  y = 0;
  z = 0;
  prevX = 0;
  prevY = 0;
  readonly vel = { x: 0, y: 0 };
  facing: 1 | -1 = 1;
  yaw = -FACING_TILT;
  pitch = 0;
  roll = 0;
  phase = Math.random() * Math.PI * 20;
  jaw = 0;
  jawTarget = 0;
  alert = 0;
  flash = 0;
  mode: FishMode = 'prey';
  readonly brain: PredatorBrain | null;
  school: School | null = null;
  /** Preferred depth band in world units. */
  bandMin = 0;
  bandMax = 10;
  wanderSeed = Math.random() * 1000;
  wanderAngle = 0;
  panic = 0;
  tired = 0;
  alive = true;
  /** 0..1 fade/scale-in after spawning. */
  appear = 0;
  /** Set when the fish should swim off and be removed. */
  leaving = false;
  stunned = 0;
  /** Seconds the fish stays helpless in a suction vortex (its AI doesn't steer). */
  sucked = 0;
  /** Cooldown so a threat cannot bite twice in a row (e.g. against a shield). */
  biteCooldown = 0;
  /** Set by the world when it is visible, for alert UI. */
  onScreen = false;
  /** Rare golden fish: worth coins and a points frenzy. */
  golden = false;
  /** Multiplies cruise and flee speed. */
  speedMul = 1;
  /** Extra render scale (an inflated pufferfish). */
  scaleMul = 1;
  /** Shading for the renderer: above 0 tints gold, below 0 darkens. */
  tint = 0;
  /** Inflated and spiny: stings instead of being eaten. */
  spiky = false;

  constructor(readonly def: SpeciesDef, sizeMul = 1) {
    this.tier = def.tier;
    this.len = def.length * sizeMul;
    this.radius = this.len * def.body.height * 0.5;
    this.brain = def.tier >= 2 ? new PredatorBrain() : null;
  }

  get mouthRadius(): number {
    return this.len * Math.max(0.1, this.def.body.height * 0.4) + 0.1;
  }

  get headingAngle(): number {
    return this.facing > 0 ? this.pitch : Math.PI - this.pitch;
  }

  get mouthX(): number {
    return this.x + Math.cos(this.headingAngle) * this.len * 0.4;
  }

  get mouthY(): number {
    return this.y + Math.sin(this.headingAngle) * this.len * 0.4;
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.y);
  }

  place(x: number, y: number, vx: number, vy: number): void {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.vel.x = vx;
    this.vel.y = vy;
    this.facing = vx >= 0 ? 1 : -1;
    this.yaw = this.facing > 0 ? -FACING_TILT : -Math.PI + FACING_TILT;
    this.wanderAngle = Math.atan2(vy, vx);
  }

  /** Integrates velocity and updates the visual orientation. */
  integrate(dt: number): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.x += this.vel.x * dt;
    this.y += this.vel.y * dt;
    const spd = this.speed;
    if (this.vel.x > 0.25) this.facing = 1;
    else if (this.vel.x < -0.25) this.facing = -1;
    const yawTarget = this.facing > 0 ? -FACING_TILT : -Math.PI + FACING_TILT;
    const prevYaw = this.yaw;
    this.yaw = dampAngle(this.yaw, yawTarget, this.tier >= 4 ? 4 : 7, dt);
    const turnRate = (this.yaw - prevYaw) / Math.max(dt, 1e-4);
    this.pitch = damp(this.pitch, clamp(Math.atan2(this.vel.y, Math.abs(this.vel.x) + 1.2), -0.55, 0.55), 5, dt);
    this.roll = damp(this.roll, clamp(turnRate * 0.06, -0.4, 0.4), 5, dt);
    const burst = Math.max(1, this.def.speed.burst);
    const norm = Math.min(1.3, spd / burst);
    this.phase = (this.phase + dt * Math.PI * 2 * this.def.swim.freq * (0.45 + norm * 1.1)) % (Math.PI * 20);
    this.jaw = damp(this.jaw, this.jawTarget, this.jawTarget > this.jaw ? 16 : 6, dt);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.appear = Math.min(1, this.appear + dt * 1.6);
    this.biteCooldown = Math.max(0, this.biteCooldown - dt);
  }

  get swimAmp(): number {
    const burst = Math.max(1, this.def.speed.burst);
    return 0.5 + Math.min(1, this.speed / burst) * 0.9;
  }
}
