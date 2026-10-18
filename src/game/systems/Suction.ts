import { SUCTION } from '../../config/tuning';
import { DEG, lerp } from '../../engine/math';
import { accelerate } from '../entities/Player';

export interface SuctionCone {
  /** Mouth position. */
  x: number;
  y: number;
  /** Unit direction the mouth faces. */
  dirX: number;
  dirY: number;
  reach: number;
  cosHalf: number;
}

const COS_HALF = Math.cos(SUCTION.halfAngleDeg * DEG);

export function makeCone(x: number, y: number, heading: number, reach: number, out: SuctionCone): SuctionCone {
  out.x = x;
  out.y = y;
  out.dirX = Math.cos(heading);
  out.dirY = Math.sin(heading);
  out.reach = reach;
  out.cosHalf = COS_HALF;
  return out;
}

/**
 * 0..1 pull strength at a point: 1 at the mouth, fading toward the cone's reach,
 * 0 outside the cone. Points right at the lips count even if slightly off-axis.
 */
export function suctionStrength(c: SuctionCone, x: number, y: number, radius = 0): number {
  const dx = x - c.x;
  const dy = y - c.y;
  const d = Math.hypot(dx, dy);
  if (d > c.reach + radius) return 0;
  if (d < 0.6 + radius) return 1;
  const along = dx * c.dirX + dy * c.dirY;
  // Widen the cone by the fish's radius so big prey near the edge still gets caught.
  const cos = (along + radius) / d;
  if (along <= 0 || cos < c.cosHalf) return 0;
  return 1 - Math.max(0, d - radius) / (c.reach + radius);
}

export interface Pullable {
  x: number;
  y: number;
  readonly vel: { x: number; y: number };
}

const tmp = { x: 0, y: 0 };

/** Drags a body toward the mouth. Returns the strength applied (0 when outside the cone). */
export function pullToward(c: SuctionCone, f: Pullable, dt: number, radius = 0): number {
  const s = suctionStrength(c, f.x, f.y, radius);
  if (s <= 0) return 0;
  const dx = c.x - f.x;
  const dy = c.y - f.y;
  const d = Math.hypot(dx, dy) || 1e-3;
  // Don't overshoot the mouth in a single step.
  const speed = Math.min(SUCTION.maxPullSpeed * (0.45 + 0.55 * s), (d / dt) * 0.85);
  tmp.x = (dx / d) * speed;
  tmp.y = (dy / d) * speed;
  accelerate(f.vel, tmp, lerp(SUCTION.pullFar, SUCTION.pullNear, s), dt);
  return s;
}
