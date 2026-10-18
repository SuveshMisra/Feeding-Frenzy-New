import { clamp, smoothstep } from '../../engine/math';
import type { FlowVec } from './types';

/** A horizontal current: water inside the box drifts along x at `speed` toward `dir`. */
export interface CurrentBand {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  dir: 1 | -1;
  speed: number;
}

/** Soft edge width of a current band, in world units (vertical, horizontal). */
export const BAND_EDGE = { y: 1.4, x: 5 };

/** Strength 0..1 of a band at a point: full inside, fading out over the soft edges. */
export function bandWeight(b: CurrentBand, x: number, y: number): number {
  const wy = smoothstep(b.y0 - BAND_EDGE.y, b.y0 + BAND_EDGE.y * 0.5, y) * (1 - smoothstep(b.y1 - BAND_EDGE.y * 0.5, b.y1 + BAND_EDGE.y, y));
  if (wy <= 0) return 0;
  const wx = smoothstep(b.x0 - BAND_EDGE.x, b.x0 + BAND_EDGE.x, x) * (1 - smoothstep(b.x1 - BAND_EDGE.x, b.x1 + BAND_EDGE.x, x));
  return wy * wx;
}

/** Sum of every band's drift at (x, y). */
export function bandFlow(bands: readonly CurrentBand[], x: number, y: number, out: FlowVec): FlowVec {
  out.x = 0;
  out.y = 0;
  for (const b of bands) {
    const w = bandWeight(b, x, y);
    if (w > 0) out.x += b.dir * b.speed * w;
  }
  return out;
}

/** Water level for a tide that starts high, drops to `lowFrac` of `height` and comes back each `period`. */
export function tideSurface(t: number, period: number, height: number, lowFrac: number): number {
  const k = 0.5 - 0.5 * Math.cos((t / period) * Math.PI * 2);
  return height * (1 - (1 - lowFrac) * k);
}

/**
 * A layer of hot water `thickness` tall that rises from `floor` until it has passed
 * `surface`, `rise` seconds after it starts. Null before it starts and after it is gone.
 */
export function heatBand(t: number, rise: number, floor: number, surface: number, thickness: number): { y0: number; y1: number } | null {
  if (t < 0 || t > rise) return null;
  const k = t / rise;
  const top = floor + (surface - floor + thickness) * k;
  return { y0: Math.max(floor, top - thickness), y1: Math.min(surface, top) };
}

/** True when a circle (px, py, pr) touches a beam from (ox, oy) at `angle`, `length` long and `halfWidth` wide. */
export function beamHits(ox: number, oy: number, angle: number, length: number, halfWidth: number, px: number, py: number, pr: number): boolean {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const rx = px - ox;
  const ry = py - oy;
  const along = clamp(rx * dx + ry * dy, 0, length);
  const cx = ox + dx * along;
  const cy = oy + dy * along;
  // The beam widens a little toward its end, like a lighthouse cone.
  const w = halfWidth * (0.6 + 0.4 * (along / Math.max(1e-3, length)));
  return Math.hypot(px - cx, py - cy) <= w + pr;
}

/** Index of the span containing x, or -1. */
export function spanAt(spans: readonly { x0: number; x1: number }[], x: number): number {
  for (let i = 0; i < spans.length; i++) if (x >= spans[i].x0 && x <= spans[i].x1) return i;
  return -1;
}

/** Visible radius in the dark for a light level 0..1. */
export function lightRadius(light: number, min: number, max: number): number {
  return min + (max - min) * clamp(light, 0, 1);
}

/**
 * `n` positions spread evenly across a level of width `w` with some jitter. A position
 * within `avoid.gap` of `avoid.x` (the player's start) is pushed to its right.
 */
export function spreadSlots(n: number, w: number, margin: number, rand: () => number, avoid?: { x: number; gap: number }): number[] {
  const slot = (w - margin * 2) / n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let x = -w / 2 + margin + slot * (i + 0.5) + (rand() - 0.5) * slot * 0.5;
    if (avoid && Math.abs(x - avoid.x) < avoid.gap) x = avoid.x + avoid.gap;
    out.push(x);
  }
  return out;
}

/** Indices of the `n` candidates nearest to `x` (closest first) within `reach`: who joins a chain reaction. */
export function chainPicks(xs: readonly number[], x: number, n: number, reach: number): number[] {
  return xs
    .map((cx, i) => ({ i, d: Math.abs(cx - x) }))
    .filter((c) => c.d <= reach)
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.max(0, n))
    .map((c) => c.i);
}
