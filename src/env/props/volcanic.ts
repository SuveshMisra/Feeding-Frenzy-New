import { BufferGeometry, CylinderGeometry, Float32BufferAttribute } from 'three';
import { createNoise2D } from 'simplex-noise';
import { Rng } from '../../engine/rng';
import { lerp, smoothstep, TAU } from '../../engine/math';
import { mergeParts, paint } from './shapes';

export interface Basalt {
  geo: BufferGeometry;
  /** Height of the tallest column (unit scale). */
  top: number;
  /** Footprint radius (unit scale). Columns shorten roughly linearly towards it. */
  radius: number;
}

/**
 * Columnar basalt: tightly packed hexagonal pillars whose heights step up and down
 * like a giant's causeway. Roughly 3 across at unit scale.
 */
export function basaltGeometry(seed: number): Basalt {
  const rng = new Rng(seed);
  const noise = createNoise2D(() => rng.next());
  const parts: BufferGeometry[] = [];
  const r = 0.36;
  const rings = rng.int(2, 3);
  const peak = rng.range(2.2, 4.2);
  let top = 0;
  for (let q = -rings; q <= rings; q++) {
    for (let s = -rings; s <= rings; s++) {
      if (Math.abs(q + s) > rings) continue;
      const x = 1.5 * r * q;
      const z = Math.sqrt(3) * r * (s + q / 2);
      const d = Math.hypot(x, z) / (rings * r * 1.7);
      if (d > 1.05 || rng.chance(0.08)) continue;
      const h = Math.max(0.35, peak * (1 - d * 0.75) * (0.7 + 0.45 * (noise(x * 0.9, z * 0.9) * 0.5 + 0.5)) + rng.range(-0.35, 0.35));
      top = Math.max(top, h);
      const col = new CylinderGeometry(r * 0.96, r, h, 6, 1, false);
      col.deleteAttribute('uv');
      const shade = rng.range(0.7, 1.05);
      paint(col, (_px, py, _pz, c) => {
        const t = (py + h / 2) / h;
        // Pale crust on the flat tops, darker cracks where the columns meet the ground.
        c.setScalar(shade * (py > h / 2 - 0.01 ? 1.35 : lerp(0.45, 1, smoothstep(0, 0.6, t))));
      });
      col.translate(x, h / 2 - 0.2, z);
      parts.push(col);
    }
  }
  return { geo: mergeParts(parts), top, radius: rings * r * 1.7 * 1.05 + r };
}

/**
 * Branching cracks of glowing lava as flat ribbons that hug the terrain. Built in
 * world space; `centres` are the crack origins and `ground` samples the seabed.
 * Vertex colours are brightest along the centre line.
 */
export function lavaCrackGeometry(centres: { x: number; z: number }[], ground: (x: number, z: number) => number, seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const hot = [1.0, 0.17, 0.015];
  const lift = 0.05;

  const ribbon = (pts: { x: number; z: number }[], w0: number, w1: number): void => {
    const start = pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[Math.min(pts.length - 1, i + 1)];
      const o = pts[Math.max(0, i - 1)];
      let tx = q.x - o.x;
      let tz = q.z - o.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const w = lerp(w0, w1, i / (pts.length - 1)) * (0.7 + rng.next() * 0.6);
      for (const side of [-1, 0, 1]) {
        const x = p.x - tz * w * side;
        const z = p.z + tx * w * side;
        pos.push(x, ground(x, z) + lift, z);
        const s = side === 0 ? 1 : 0.3;
        col.push(hot[0] * s, hot[1] * s, hot[2] * s);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = start + i * 3;
      const b = a + 3;
      idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
    }
  };

  const walk = (x: number, z: number, angle: number, steps: number, width: number, depth: number): void => {
    const pts = [{ x, z }];
    let a = angle;
    for (let i = 0; i < steps; i++) {
      a += rng.range(-0.55, 0.55);
      const len = rng.range(0.35, 0.7);
      x += Math.cos(a) * len;
      z += Math.sin(a) * len * 0.8;
      pts.push({ x, z });
      if (depth < 2 && i > 1 && rng.chance(0.18)) walk(x, z, a + rng.sign() * rng.range(0.6, 1.2), Math.floor(steps * 0.5), width * 0.6, depth + 1);
    }
    ribbon(pts, width, width * 0.25);
  };

  for (const c of centres) {
    const arms = rng.int(2, 4);
    const a0 = rng.range(0, TAU);
    for (let k = 0; k < arms; k++) walk(c.x, c.z, a0 + (k / arms) * TAU + rng.range(-0.3, 0.3), rng.int(5, 10), rng.range(0.12, 0.22), 0);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  const normals = new Float32Array(pos.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geo.setIndex(idx);
  return geo;
}
