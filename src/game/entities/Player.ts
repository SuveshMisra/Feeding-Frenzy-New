import { SPECIES, type SpeciesDef } from '../../config/species';
import type { AbilityKind } from '../../config/progression';
import { BOOST, PLAYER, PUFF_ABILITY, RESPAWN_SHIELD_S, HAZARD, SUCTION, type Stage } from '../../config/tuning';
import { clamp, damp, dampAngle, smoothstep } from '../../engine/math';

export const FACING_TILT = 0.36;

export interface MoveBounds {
  minX: number;
  maxX: number;
  surfaceY: number;
  floorAt: (x: number) => number;
}

/** Desired velocity toward a world-space target, slowing down inside `slowRadius`. */
export function seekVelocity(
  px: number,
  py: number,
  tx: number,
  ty: number,
  maxSpeed: number,
  slowRadius: number,
  out: { x: number; y: number },
): { x: number; y: number } {
  const dx = tx - px;
  const dy = ty - py;
  const d = Math.hypot(dx, dy);
  if (d < 0.08) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const s = maxSpeed * Math.min(1, d / slowRadius);
  out.x = (dx / d) * s;
  out.y = (dy / d) * s;
  return out;
}

/** Moves velocity toward the desired velocity with a bounded acceleration. */
export function accelerate(
  v: { x: number; y: number },
  desired: { x: number; y: number },
  accel: number,
  dt: number,
): void {
  const dx = desired.x - v.x;
  const dy = desired.y - v.y;
  const d = Math.hypot(dx, dy);
  const step = accel * dt;
  if (d <= step) {
    v.x = desired.x;
    v.y = desired.y;
  } else {
    v.x += (dx / d) * step;
    v.y += (dy / d) * step;
  }
}

/**
 * Knockback velocity for a fish at (fx, fy) caught by a puff at (px, py): straight away
 * from the puffer at `knock` speed, or null when it is outside `reach`.
 */
export function puffKnock(px: number, py: number, fx: number, fy: number, reach: number, knock: number): { x: number; y: number } | null {
  const dx = fx - px;
  const dy = fy - py;
  const d = Math.hypot(dx, dy);
  if (d > reach) return null;
  if (d < 1e-3) return { x: knock, y: 0 };
  return { x: (dx / d) * knock, y: (dy / d) * knock };
}

/** Base cooldown of each hero ability, before shop upgrades. */
export function abilityCooldownFor(ability: AbilityKind): number {
  if (ability === 'suction') return SUCTION.cooldown;
  if (ability === 'puff') return PUFF_ABILITY.cooldown;
  return BOOST.cooldown;
}

export interface PlayerOptions {
  def?: SpeciesDef;
  ability?: AbilityKind;
  /** Shop upgrade: multiplies swim speed. */
  speedMul?: number;
  /** Shop upgrade: multiplies the ability cooldown. */
  cooldownMul?: number;
}

export class Player {
  readonly def: SpeciesDef;
  readonly ability: AbilityKind;
  readonly speedMul: number;
  readonly cooldownMul: number;
  x = 0;
  y = 0;
  z = 0.35;
  alert = 0;
  prevX = 0;
  prevY = 0;
  readonly vel = { x: 0, y: 0 };
  facing: 1 | -1 = 1;
  yaw = -FACING_TILT;
  pitch = 0;
  roll = 0;
  stage: Stage = 1;
  len: number = PLAYER.lengthByStage[0];
  private lenVel = 0;
  lenTarget: number = PLAYER.lengthByStage[0];
  /** Swallow bulge: above 0 fattens the body and shortens it, below 0 stretches it thin. */
  squash = 0;
  private squashVel = 0;
  /** Seconds the jaw keeps slamming shut after a bite. */
  private jawSnap = 0;

  alive = true;
  visible = true;
  shield = 0;
  /** The current shield came from a pickup (shown on the HUD), not a respawn. */
  shieldIsPickup = false;
  stun = 0;
  speedBoost = 0;
  /** Seconds left in the current dash, including its fade. */
  boostTime = 0;
  /** Seconds until the ability (dash or suction) can fire again. */
  boostCooldown = 0;
  /** Seconds left in Gulp's suction vortex. */
  suckTime = 0;
  /** Seconds left puffed up (Spike). */
  puffTime = 0;
  invincible = false;
  jaw = 0;
  jawTarget = 0;
  phase = 0;
  flash = 0;
  hurtFlash = 0;
  /** Water current carrying the player, set by the world each step. */
  readonly drift = { x: 0, y: 0 };
  /** Shading for the renderer: below 0 darkens (hidden in cover), above 0 tints gold. */
  tint = 0;
  private readonly desired = { x: 0, y: 0 };
  private boostDirX = 1;
  private boostDirY = 0;

  constructor(opts: PlayerOptions = {}) {
    this.def = opts.def ?? SPECIES.hero;
    this.ability = opts.ability ?? 'dash';
    this.speedMul = opts.speedMul ?? 1;
    this.cooldownMul = opts.cooldownMul ?? 1;
  }

  /** Top speed without the dash (the speed pickup and the shop upgrade still count). */
  get cruiseSpeed(): number {
    const base = PLAYER.speedByStage[this.stage - 1] * this.speedMul;
    return this.speedBoost > 0 ? base * HAZARD.speedBoost.factor : base;
  }

  get maxSpeed(): number {
    const suck = this.suckTime > 0 ? SUCTION.speedMul : 1;
    const puff = this.puffTime > 0 ? PUFF_ABILITY.speedMul : 1;
    return this.cruiseSpeed * (1 + (BOOST.speedMul - 1) * this.boostLevel) * suck * puff;
  }

  /** Full cooldown of the ability after upgrades, for the HUD ring. */
  get abilityCooldown(): number {
    return abilityCooldownFor(this.ability) * this.cooldownMul;
  }

  /** True while the ability's effect is running. */
  get abilityActive(): boolean {
    if (this.ability === 'suction') return this.suckTime > 0;
    if (this.ability === 'puff') return this.puffTime > 0;
    return this.boostTime > 0;
  }

  /** 0..1 how puffed up Spike looks: swells fast, shrinks over the last moment. */
  get puffLevel(): number {
    if (this.puffTime <= 0) return 0;
    return Math.min(1, (PUFF_ABILITY.duration - this.puffTime) / 0.12) * smoothstep(0, 0.3, this.puffTime);
  }

  /** Puffs up. Returns false while it recharges, or when stunned or dead. */
  puff(): boolean {
    if (this.ability !== 'puff' || !this.alive || this.stun > 0 || this.boostCooldown > 0) return false;
    this.puffTime = PUFF_ABILITY.duration;
    this.boostCooldown = this.abilityCooldown;
    return true;
  }

  /** Reach of the suction cone in world units. */
  get suckReach(): number {
    return SUCTION.reachBase + SUCTION.reachPerLen * this.len;
  }

  /** Starts the suction vortex. Returns false while it recharges, or when stunned or dead. */
  suck(): boolean {
    if (this.ability !== 'suction' || !this.alive || this.stun > 0 || this.boostCooldown > 0) return false;
    this.suckTime = SUCTION.duration;
    this.boostCooldown = this.abilityCooldown;
    return true;
  }

  /** 0..1 strength of the dash: full while it lasts, then easing out over its fade. */
  get boostLevel(): number {
    return this.boostTime > 0 ? smoothstep(0, BOOST.fade, this.boostTime) : 0;
  }

  /**
   * Fires the dash toward (dirX, dirY), or along the current motion / facing when no
   * direction is given. Returns false while it recharges, or when stunned or dead.
   */
  boost(dirX = 0, dirY = 0): boolean {
    if (this.ability !== 'dash' || !this.alive || this.stun > 0 || this.boostCooldown > 0) return false;
    let d = Math.hypot(dirX, dirY);
    if (d < 1e-3) {
      dirX = this.vel.x;
      dirY = this.vel.y;
      d = Math.hypot(dirX, dirY);
      if (d < 0.5) {
        const a = this.headingAngle;
        dirX = Math.cos(a);
        dirY = Math.sin(a);
        d = 1;
      }
    }
    this.boostDirX = dirX / d;
    this.boostDirY = dirY / d;
    this.boostTime = BOOST.duration + BOOST.fade;
    this.boostCooldown = this.abilityCooldown;
    const s = this.maxSpeed;
    this.vel.x = this.boostDirX * s;
    this.vel.y = this.boostDirY * s;
    if (Math.abs(this.boostDirX) > 0.15) this.facing = this.boostDirX > 0 ? 1 : -1;
    return true;
  }

  /** Body half-height used when something bites the player. */
  get radius(): number {
    return this.len * 0.2;
  }

  get mouthRadius(): number {
    return this.len * 0.2 + 0.12;
  }

  get mouthX(): number {
    return this.x + Math.cos(this.headingAngle) * this.len * 0.38;
  }

  get mouthY(): number {
    return this.y + Math.sin(this.headingAngle) * this.len * 0.38;
  }

  /** Direction the nose points in the gameplay plane. */
  get headingAngle(): number {
    return this.facing > 0 ? this.pitch : Math.PI - this.pitch;
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.y);
  }

  get protected(): boolean {
    return this.invincible || this.shield > 0 || this.puffTime > 0 || !this.alive;
  }

  setStage(stage: Stage, animate = true): void {
    this.stage = stage;
    this.lenTarget = PLAYER.lengthByStage[stage - 1];
    if (!animate) {
      this.len = this.lenTarget;
      this.lenVel = 0;
    }
  }

  spawn(x: number, y: number, shield = RESPAWN_SHIELD_S): void {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.vel.x = this.vel.y = 0;
    this.alive = true;
    this.visible = true;
    this.shield = shield;
    this.shieldIsPickup = false;
    this.stun = 0;
    this.jaw = 0;
    this.squash = this.squashVel = 0;
    this.boostTime = 0;
    this.boostCooldown = 0;
    this.suckTime = 0;
    this.puffTime = 0;
  }

  /**
   * One fixed simulation step. `target` is a world point to swim toward (mouse),
   * `dir` a direction with magnitude (keys / joystick); pass null for neither.
   */
  update(
    dt: number,
    target: { x: number; y: number } | null,
    dir: { x: number; y: number; mag: number } | null,
    bounds: MoveBounds,
  ): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.shield = Math.max(0, this.shield - dt);
    if (this.shield <= 0) this.shieldIsPickup = false;
    this.speedBoost = Math.max(0, this.speedBoost - dt);
    this.boostTime = Math.max(0, this.boostTime - dt);
    this.boostCooldown = Math.max(0, this.boostCooldown - dt);
    this.suckTime = Math.max(0, this.suckTime - dt);
    this.puffTime = Math.max(0, this.puffTime - dt);
    this.flash = Math.max(0, this.flash - dt * 3);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2);

    // Elastic size spring for growth.
    const k = 90;
    const c = 9;
    this.lenVel += ((this.lenTarget - this.len) * k - this.lenVel * c) * dt;
    this.len += this.lenVel * dt;
    // Underdamped, so a gulp bulges, overshoots into a stretch and wobbles back.
    this.squashVel += (-this.squash * 300 - this.squashVel * 15) * dt;
    this.squash += this.squashVel * dt;
    this.jawSnap = Math.max(0, this.jawSnap - dt);

    if (!this.alive) return;

    if (this.stun > 0) {
      this.boostTime = 0;
      this.suckTime = 0;
    }
    const max = this.maxSpeed;
    const boosting = this.boostTime > 0;
    const d = this.desired;
    d.x = 0;
    d.y = 0;
    if (this.stun > 0) {
      this.stun -= dt;
    } else if (target) {
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (!boosting) {
        seekVelocity(this.x, this.y, target.x, target.y, max, PLAYER.slowRadius * (0.6 + this.len * 0.35), d);
        if (Math.abs(dx) > this.len * 0.3) this.facing = dx > 0 ? 1 : -1;
      } else if (dist > this.len + 1.5) {
        // A dash doesn't ease in near the cursor like normal steering does.
        d.x = (dx / dist) * max;
        d.y = (dy / dist) * max;
      } else {
        d.x = this.boostDirX * max;
        d.y = this.boostDirY * max;
      }
    } else if (dir && dir.mag > 0) {
      const m = boosting ? 1 : dir.mag;
      d.x = dir.x * m * max;
      d.y = dir.y * m * max;
    } else if (boosting) {
      d.x = this.boostDirX * max;
      d.y = this.boostDirY * max;
    }
    const idle = d.x === 0 && d.y === 0;
    const accel = this.stun > 0 ? 6 : PLAYER.accel * (idle ? 0.45 : 1) * (1 + (BOOST.accelMul - 1) * this.boostLevel);
    accelerate(this.vel, d, accel, dt);

    this.x += (this.vel.x + this.drift.x) * dt;
    this.y += (this.vel.y + this.drift.y) * dt;

    if (!target || boosting) {
      if (this.vel.x > 0.5) this.facing = 1;
      else if (this.vel.x < -0.5) this.facing = -1;
    }
    if (boosting) {
      const s = this.speed;
      if (s > 1) {
        this.boostDirX = this.vel.x / s;
        this.boostDirY = this.vel.y / s;
      }
    }

    // Keep inside the level: side walls, seabed and just below the surface.
    const margin = this.len * 0.5;
    if (this.x < bounds.minX + margin) {
      this.x = bounds.minX + margin;
      if (this.vel.x < 0) this.vel.x = 0;
    } else if (this.x > bounds.maxX - margin) {
      this.x = bounds.maxX - margin;
      if (this.vel.x > 0) this.vel.x = 0;
    }
    const floor = bounds.floorAt(this.x) + this.radius + 0.35;
    const ceil = bounds.surfaceY - this.radius - 0.5;
    if (this.y < floor) {
      this.y = floor;
      if (this.vel.y < 0) this.vel.y = 0;
    } else if (this.y > ceil) {
      this.y = ceil;
      if (this.vel.y > 0) this.vel.y = 0;
    }

    this.animate(dt);
  }

  private animate(dt: number): void {
    const yawTarget = this.facing > 0 ? -FACING_TILT : -Math.PI + FACING_TILT;
    const prevYaw = this.yaw;
    this.yaw = dampAngle(this.yaw, yawTarget, 11, dt);
    // Keep the turn going through the camera-facing side instead of the back.
    if (this.yaw > 0.2) this.yaw -= Math.PI * 2;
    const turnRate = (this.yaw - prevYaw) / Math.max(dt, 1e-4);
    const spd = this.speed;
    const pitchTarget = clamp(Math.atan2(this.vel.y, Math.abs(this.vel.x) + 2.5), -0.6, 0.6);
    this.pitch = damp(this.pitch, pitchTarget, 7, dt);
    this.roll = damp(this.roll, clamp(turnRate * 0.05, -0.45, 0.45), 6, dt);
    const norm = Math.min(1.4, spd / this.maxSpeed);
    this.phase = (this.phase + dt * Math.PI * 2 * (1.1 + norm * 2.4 + this.boostLevel * 1.6)) % (Math.PI * 20);
    this.jaw = damp(this.jaw, this.jawTarget, this.jawTarget > this.jaw ? 22 : this.jawSnap > 0 ? 34 : 9, dt);
  }

  /** A bite lands: the jaw slams shut and the body bulges with the swallow. `meal` is 0..1. */
  chomp(meal: number): void {
    this.jaw = 1;
    this.jawTarget = 0;
    this.jawSnap = 0.12;
    this.squashVel += 1.6 + 2.6 * meal;
  }

  /** Swim amplitude multiplier for the shader. */
  get swimAmp(): number {
    return 0.55 + Math.min(1, this.speed / this.maxSpeed) * 0.75 + (this.stun > 0 ? 0.8 : 0) + this.boostLevel * 0.35;
  }
}
