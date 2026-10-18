import { BufferGeometry, CircleGeometry, Vector3 } from 'three';
import { createNoise2D } from 'simplex-noise';
import { Rng } from '../../engine/rng';
import { lerp, smoothstep, TAU } from '../../engine/math';
import { mergeParts, paint, tube } from './shapes';

/**
 * A mangrove root tangle seen from below the waterline. The origin is at the surface;
 * a stubby trunk fans out into arching prop roots that plunge to `depth` below it.
 */
export function mangroveGeometry(seed: number, depth: number): BufferGeometry {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const trunk = depth * rng.range(0.1, 0.16);
  parts.push(...tube([new Vector3(0, 0.6, 0), new Vector3(rng.range(-0.15, 0.15), -trunk * 0.5, 0), new Vector3(rng.range(-0.2, 0.2), -trunk, rng.range(-0.1, 0.1))], 0.5, 0.36, 10, [0.8, 0.62]));

  const roots = rng.int(8, 12);
  for (let k = 0; k < roots; k++) {
    const a = (k / roots) * TAU + rng.range(-0.25, 0.25);
    const dx = Math.cos(a);
    const dz = Math.sin(a) * 0.75;
    const reach = rng.range(1.6, 3.6);
    const y0 = -trunk * rng.range(0.25, 1);
    const end = -depth - 0.4;
    const pts: Vector3[] = [];
    const steps = 10;
    const wob = rng.range(0, TAU);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Arches out sideways first, then drops almost straight into the mud.
      const r = 0.25 + reach * Math.pow(Math.sin((t * Math.PI) / 2), 0.55);
      const y = lerp(y0, end, Math.pow(t, 1.35));
      const w = Math.sin(t * 7 + wob) * 0.08;
      pts.push(new Vector3(dx * r + w, y, dz * r + w * 0.6));
    }
    parts.push(...tube(pts, rng.range(0.12, 0.19), 0.07, 6, [0.72, 0.42]));
    // Some roots fork near the bottom.
    if (rng.chance(0.4)) {
      const f = pts[6].clone();
      const fa = a + rng.sign() * rng.range(0.4, 0.8);
      const fork = [f, f.clone().add(new Vector3(Math.cos(fa) * 0.6, -depth * 0.12, Math.sin(fa) * 0.45)), new Vector3(f.x + Math.cos(fa) * 0.9, end, f.z + Math.sin(fa) * 0.7)];
      parts.push(...tube(fork, 0.08, 0.05, 5, [0.55, 0.42]));
    }
  }
  // Thin aerial roots dangling partway down.
  const dangling = rng.int(4, 8);
  for (let k = 0; k < dangling; k++) {
    const x = rng.range(-1.4, 1.4);
    const z = rng.range(-0.9, 0.9);
    const len = depth * rng.range(0.2, 0.55);
    const pts = [0, 0.33, 0.66, 1].map((t) => new Vector3(x + Math.sin(t * 4 + k) * 0.12, -trunk * 0.6 - len * t, z));
    parts.push(...tube(pts, 0.045, 0.018, 4, [0.7, 0.9]));
  }
  for (const p of parts) p.deleteAttribute('uv');
  return mergeParts(parts);
}

/** A floating leaf, flat in the xz plane, with a darker midrib. */
export function leafGeometry(seed: number): BufferGeometry {
  const geo = new CircleGeometry(0.5, 12);
  geo.rotateX(Math.PI / 2);
  const rng = new Rng(seed);
  const noise = createNoise2D(() => rng.next());
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // Pointed oval with a slight curl.
    const taper = 1 - smoothstep(0.1, 0.5, Math.abs(x)) * 0.35;
    pos.setXYZ(i, x * 1.15, Math.abs(z) * 0.18 + noise(x * 3, z * 3) * 0.02, z * 0.52 * taper);
  }
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  return paint(geo, (x, _y, z, c) => c.setScalar(lerp(0.65, 1.08, smoothstep(0, 0.08, Math.abs(z))) * lerp(1, 0.85, Math.abs(x) * 1.6)));
}
