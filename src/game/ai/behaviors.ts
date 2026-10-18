import type { NoiseFunction2D } from 'simplex-noise';
import { PLAYER, PREDATOR, PREY, type Stage } from '../../config/tuning';
import { DEG, clamp } from '../../engine/math';
import type { Fish, School } from '../entities/Fish';
import { accelerate, type MoveBounds } from '../entities/Player';
import { isThreat, playerCanEat } from '../systems/FoodChain';
import type { PredatorState } from './PredatorBrain';
import type { SpatialHash } from './SpatialHash';

export interface PlayerView {
  x: number;
  y: number;
  vx: number;
  vy: number;
  len: number;
  stage: Stage;
  /** Current top speed including boosts. */
  maxSpeed: number;
  /** Whether the player is in play (not dead / respawning). */
  alive: boolean;
}

export interface AiContext {
  dt: number;
  time: number;
  player: PlayerView;
  bounds: MoveBounds;
  hash: SpatialHash<Fish>;
  noise: NoiseFunction2D;
  detectRadius: number;
  chaseSpeed: number;
  /** Level feature multiplier on predator detection (kelp cover, darkness). */
  detectMul: number;
  /** Seconds the player has been hidden; chasers give up after `HIDE_GIVE_UP`. */
  hiddenTime: number;
  /** Scales `HIDE_GIVE_UP` (storm kelp: hunters search longer). */
  searchMul?: number;
  /** Water current drift at a point, or null when the level has none. */
  flow: ((x: number, y: number, out: { x: number; y: number }) => { x: number; y: number }) | null;
  onPredatorState?: (fish: Fish, from: PredatorState, to: PredatorState) => void;
}

/** A chasing predator loses track of a hidden player after this many seconds. */
export const HIDE_GIVE_UP = 0.6;

const COS_HALF_CONE = Math.cos(((PREDATOR.viewConeDeg / 2) * DEG));
const tmpDesired = { x: 0, y: 0 };

export function steer(f: Fish, dvx: number, dvy: number, accel: number, dt: number): void {
  tmpDesired.x = dvx;
  tmpDesired.y = dvy;
  accelerate(f.vel, tmpDesired, accel, dt);
}

/** Keeps fish in their depth band and inside the level; returns an extra desired velocity. */
function containment(f: Fish, c: AiContext, out: { x: number; y: number }): void {
  out.x = 0;
  out.y = 0;
  const b = c.bounds;
  const floor = b.floorAt(f.x) + f.radius + 0.4;
  const ceil = b.surfaceY - f.radius - 0.6;
  const lo = Math.max(floor, f.bandMin);
  const hi = Math.min(ceil, f.bandMax);
  if (f.y < lo) out.y += (lo - f.y) * 1.2;
  else if (f.y > hi) out.y -= (f.y - hi) * 1.2;
  if (f.y < floor + 0.8) out.y += 2.5;
  if (f.y > ceil - 0.8) out.y -= 2.5;
  if (!f.leaving) {
    const edge = 5 + f.len;
    if (f.x < b.minX + edge) out.x += (b.minX + edge - f.x) * 0.8;
    else if (f.x > b.maxX - edge) out.x -= (f.x - (b.maxX - edge)) * 0.8;
  }
}

function hardLimits(f: Fish, c: AiContext): void {
  const b = c.bounds;
  const floor = b.floorAt(f.x) + f.radius + 0.25;
  const ceil = b.surfaceY - f.radius * 0.6 - 0.3;
  if (f.y < floor) {
    f.y = floor;
    if (f.vel.y < 0) f.vel.y *= -0.3;
  } else if (f.y > ceil) {
    f.y = ceil;
    if (f.vel.y > 0) f.vel.y *= -0.3;
  }
}

const contain = { x: 0, y: 0 };

function wanderVelocity(f: Fish, c: AiContext, speed: number, out: { x: number; y: number }): void {
  const n = c.noise(f.wanderSeed, c.time * 0.11);
  f.wanderAngle += n * c.dt * 1.4;
  // Mostly horizontal swimming: pull the heading back toward left/right.
  const s = Math.sin(f.wanderAngle);
  const cth = Math.cos(f.wanderAngle);
  f.wanderAngle -= s * Math.abs(s) * c.dt * 0.8 * Math.sign(cth || 1);
  const b = c.bounds;
  const edge = 6 + f.len;
  if (!f.leaving) {
    if (f.x < b.minX + edge && Math.cos(f.wanderAngle) < 0) f.wanderAngle = Math.PI - f.wanderAngle;
    if (f.x > b.maxX - edge && Math.cos(f.wanderAngle) > 0) f.wanderAngle = Math.PI - f.wanderAngle;
  }
  out.x = Math.cos(f.wanderAngle) * speed;
  out.y = Math.sin(f.wanderAngle) * speed * 0.4;
}

const desired = { x: 0, y: 0 };

export function updatePrey(f: Fish, c: AiContext): void {
  const dt = c.dt;
  const p = c.player;
  const dx = f.x - p.x;
  const dy = f.y - p.y;
  const dist = Math.hypot(dx, dy) || 1e-3;
  const edible = playerCanEat(p.stage, f.tier);
  const reach = (PREY.fleeRadius + p.len * 0.8 + f.len * 0.4) * (f.golden ? 1.5 : 1);
  f.tired = Math.max(0, f.tired - dt);
  if (p.alive && edible && dist < reach && f.panic <= 0 && f.tired <= 0) {
    // Only react when the player is coming closer or already very near.
    const closing = -(dx * p.vx + dy * p.vy) / dist;
    if (closing > 1 || dist < reach * 0.55) {
      f.panic = PREY.panicTime * (0.8 + ((f.uid * 0.37) % 0.4));
      if (f.school) f.school.panic = Math.max(f.school.panic, 1.2);
    }
  }
  if (f.panic > 0) {
    f.panic -= dt;
    if (f.panic <= 0) f.tired = PREY.tiredTime;
  }
  const cruise = f.def.speed.cruise * f.speedMul;
  const school = f.school;
  if (f.panic > 0 && dist < reach * 2) {
    const flee = p.maxSpeed * PREY.fleeSpeedOfPlayer * (f.tier === 1 ? 0.95 : 1) * Math.min(f.speedMul, 1.1);
    const ax = dx / dist;
    const ay = dy / dist;
    const jink = Math.sin(c.time * 3.3 + f.wanderSeed) * 0.45;
    desired.x = (ax - ay * jink) * flee;
    desired.y = (ay + ax * jink) * flee * 0.85;
    f.wanderAngle = Math.atan2(desired.y, desired.x);
  } else if (school) {
    schoolVelocity(f, school, c, cruise, desired);
  } else {
    wanderVelocity(f, c, cruise * (f.tired > 0 ? 0.7 : 1), desired);
  }
  if (school && f.panic > 0) separation(f, c, 3.5, desired);
  containment(f, c, contain);
  f.jawTarget = 0;
  f.alert = Math.max(0, f.alert - dt * 3);
  steer(f, desired.x + contain.x, desired.y + contain.y, f.panic > 0 ? 18 : 7, dt);
  f.integrate(dt);
  hardLimits(f, c);
}

function separation(f: Fish, c: AiContext, strength: number, out: { x: number; y: number }): void {
  const r = f.len * 1.25;
  c.hash.query(f.x, f.y, r, (o, d2) => {
    if (o === f || d2 < 1e-6 || o.tier !== f.tier) return;
    const d = Math.sqrt(d2);
    const push = (r - d) / r;
    out.x += ((f.x - o.x) / d) * push * strength;
    out.y += ((f.y - o.y) / d) * push * strength;
  });
}

function schoolVelocity(f: Fish, s: School, c: AiContext, cruise: number, out: { x: number; y: number }): void {
  let cx = 0;
  let cy = 0;
  let vx = 0;
  let vy = 0;
  let n = 0;
  for (const m of s.members) {
    if (!m.alive) continue;
    cx += m.x;
    cy += m.y;
    vx += m.vel.x;
    vy += m.vel.y;
    n++;
  }
  cx /= n || 1;
  cy /= n || 1;
  vx /= n || 1;
  vy /= n || 1;
  const hx = Math.cos(s.heading) * cruise;
  const hy = Math.sin(s.heading) * cruise * 0.35;
  out.x = hx * 0.7 + vx * 0.3 + (cx - f.x) * 0.5;
  out.y = hy * 0.7 + vy * 0.3 + (cy - f.y) * 0.5;
  separation(f, c, 2.4, out);
  // A little individual drift keeps the school alive-looking.
  const t = c.time * 0.7 + f.wanderSeed;
  out.x += Math.sin(t) * 0.35;
  out.y += Math.cos(t * 1.3) * 0.25;
}

/** Steers the school's shared heading; called once per school per step. */
export function updateSchool(s: School, c: AiContext): void {
  s.members = s.members.filter((m) => m.alive);
  if (s.members.length === 0) return;
  s.panic = Math.max(0, s.panic - c.dt);
  let cx = 0;
  let cy = 0;
  for (const m of s.members) {
    cx += m.x;
    cy += m.y;
  }
  cx /= s.members.length;
  cy /= s.members.length;
  const n = c.noise(s.id * 7.1, c.time * 0.08);
  s.heading += n * c.dt * 1.1;
  const sn = Math.sin(s.heading);
  s.heading -= sn * Math.abs(sn) * c.dt * 0.9 * Math.sign(Math.cos(s.heading) || 1);
  const b = c.bounds;
  const lead = s.members[0];
  const band = (lead.bandMin + lead.bandMax) / 2;
  if (!lead.leaving) {
    if (cx < b.minX + 10 && Math.cos(s.heading) < 0) s.heading = Math.PI - s.heading;
    if (cx > b.maxX - 10 && Math.cos(s.heading) > 0) s.heading = Math.PI - s.heading;
  }
  if (cy < lead.bandMin && Math.sin(s.heading) < 0) s.heading = -s.heading;
  if (cy > lead.bandMax && Math.sin(s.heading) > 0) s.heading = -s.heading;
  s.goalX = cx;
  s.goalY = band;
}

export function updatePredator(f: Fish, c: AiContext): void {
  const brain = f.brain!;
  const dt = c.dt;
  const p = c.player;
  const dx = p.x - f.x;
  const dy = p.y - f.y;
  const dist = Math.hypot(dx, dy) || 1e-3;
  const sp = f.speed;
  const hx = sp > 0.3 ? f.vel.x / sp : f.facing;
  const hy = sp > 0.3 ? f.vel.y / sp : 0;
  const inView = (hx * dx + hy * dy) / dist >= COS_HALF_CONE;
  const canEat = p.alive && isThreat(p.stage, f.tier);
  const stageScale = 1 + (p.stage - 1) * PREDATOR.detectPerStage;
  const detect = (c.detectRadius * (f.def.detectMul ?? 1) * stageScale + f.len * PREDATOR.detectPerLength) * c.detectMul;
  const prev = brain.state;
  if (c.hiddenTime > HIDE_GIVE_UP * (c.searchMul ?? 1) && (brain.state === 'chase' || brain.state === 'alert')) brain.enter('giveUp');
  else brain.update(dt, { dist, inViewCone: inView, canEatPlayer: canEat, detectRadius: detect, maxChase: PREDATOR.maxChase });
  if (brain.state !== prev) c.onPredatorState?.(f, prev, brain.state);

  const cruise = f.def.speed.cruise;
  const heavy = f.tier >= 4;
  let accel = heavy ? 9 : 12;
  switch (brain.state) {
    case 'wander':
      wanderVelocity(f, c, cruise, desired);
      f.alert = Math.max(0, f.alert - dt * 2);
      f.jawTarget = 0;
      break;
    case 'alert': {
      // Stop and stare: slow down while turning toward the player.
      desired.x = (dx / dist) * cruise * 0.35;
      desired.y = (dy / dist) * cruise * 0.2;
      f.alert = Math.min(1, f.alert + dt * 6);
      f.jawTarget = 0.3;
      if (Math.abs(dx) > 0.3) f.facing = dx > 0 ? 1 : -1;
      accel = 14;
      break;
    }
    case 'chase': {
      // Ramp up over the first moments so a player who reacts to the alert can turn and escape.
      const r0 = PREDATOR.chaseRampStart;
      const ramp = Math.min(1, r0 + ((1 - r0) * brain.timer) / PREDATOR.chaseRampTime);
      const heft = heavy ? PREDATOR.heavyChaseMul : 1;
      const speed = PLAYER.speedByStage[p.stage - 1] * c.chaseSpeed * ramp * heft;
      const lead = clamp(dist / speed, 0, PREDATOR.leadMax);
      const tx = p.x + p.vx * lead - f.x;
      const ty = p.y + p.vy * lead - f.y;
      const td = Math.hypot(tx, ty) || 1e-3;
      desired.x = (tx / td) * speed;
      desired.y = (ty / td) * speed;
      f.alert = 1;
      f.jawTarget = dist < f.len * 0.9 + 1.2 ? 1 : 0.35;
      accel = heavy ? PREDATOR.heavyChaseAccel : 20;
      break;
    }
    case 'giveUp': {
      wanderVelocity(f, c, cruise * 0.9, desired);
      desired.x -= (dx / dist) * cruise * 0.6;
      desired.y -= (dy / dist) * cruise * 0.3;
      f.alert = Math.max(0, f.alert - dt * 1.5);
      f.jawTarget = 0;
      break;
    }
  }
  containment(f, c, contain);
  steer(f, desired.x + contain.x, desired.y + contain.y, accel, dt);
  f.integrate(dt);
  hardLimits(f, c);
}

const flowTmp = { x: 0, y: 0 };

/** A fish that the player has outgrown flees like prey; threats hunt. Currents carry everyone. */
export function updateFish(f: Fish, c: AiContext): void {
  think(f, c);
  if (c.flow && f.sucked <= 0) {
    c.flow(f.x, f.y, flowTmp);
    if (flowTmp.x !== 0 || flowTmp.y !== 0) {
      f.x += flowTmp.x * c.dt;
      f.y += flowTmp.y * c.dt;
      hardLimits(f, c);
    }
  }
}

function think(f: Fish, c: AiContext): void {
  if (f.sucked > 0) {
    f.sucked -= c.dt;
    f.panic = Math.max(f.panic, 0.5);
    f.integrate(c.dt);
    hardLimits(f, c);
    return;
  }
  if (f.stunned > 0) {
    f.stunned -= c.dt;
    f.jawTarget = 0;
    f.alert = Math.max(0, f.alert - c.dt * 4);
    steer(f, 0, -0.5, 6, c.dt);
    f.integrate(c.dt);
    hardLimits(f, c);
    return;
  }
  const threat = f.brain !== null && !f.golden && isThreat(c.player.stage, f.tier);
  if (threat) {
    if (f.mode !== 'predator') {
      f.mode = 'predator';
      f.brain!.enter('wander');
    }
    updatePredator(f, c);
  } else {
    if (f.mode !== 'prey') {
      f.mode = 'prey';
      if (f.brain && f.brain.state !== 'wander') {
        const from = f.brain.state;
        f.brain.enter('wander');
        c.onPredatorState?.(f, from, 'wander');
      }
    }
    updatePrey(f, c);
  }
}
