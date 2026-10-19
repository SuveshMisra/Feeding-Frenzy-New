import { BufferGeometry, CylinderGeometry, LatheGeometry, SphereGeometry, Vector2, Vector3 } from 'three';
import { createNoise3D } from 'simplex-noise';
import { Rng } from '../../engine/rng';
import { clamp01, lerp, smoothstep, TAU } from '../../engine/math';
import { mergeParts, paint, sway, tube } from './shapes';

export interface LocalPerch {
  x: number;
  y: number;
  z: number;
  r: number;
}

export interface CoralTower {
  geo: BufferGeometry;
  /** Flat tops (plates and crown) in local space, for other props to grow on. */
  perches: LocalPerch[];
}

/**
 * A coral bommie: a lumpy, leaning limestone column with tiers of table coral jutting
 * out of its sides. The column is painted dark and the plates bright, so the instance
 * tint shows mostly on the plates. Roughly 6.5-9.5 tall at unit scale.
 */
export function coralTowerGeometry(seed: number): CoralTower {
  const rng = new Rng(seed);
  const noise = createNoise3D(() => rng.next());
  const parts: BufferGeometry[] = [];
  const perches: LocalPerch[] = [];
  const height = rng.range(6.5, 9.5);
  const r0 = rng.range(1.3, 1.7);
  const lean = rng.range(-0.8, 0.8);
  const leanAt = (y: number): number => lean * (y / height) ** 2;
  const radiusAt = (y: number): number => lerp(r0, r0 * 0.42, Math.pow(clamp01(y / height), 0.8));

  const prof: Vector2[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = -0.3 + t * (height + 0.3);
    prof.push(new Vector2(radiusAt(y) * (1 + Math.sin(t * 9 + seed) * 0.08), y));
  }
  prof.push(new Vector2(radiusAt(height) * 0.6, height + 0.18), new Vector2(0.01, height + 0.26));
  const col = new LatheGeometry(prof, 16);
  const pos = col.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise(v.x * 0.9, v.y * 0.45, v.z * 0.9) * 0.24 + noise(v.x * 2.6, v.y * 2.6, v.z * 2.6) * 0.08;
    pos.setXYZ(i, v.x * (1 + n) + leanAt(v.y), v.y, v.z * (1 + n));
  }
  col.computeVertexNormals();
  paint(col, (x, y, z, c) => c.setScalar(lerp(0.4, 0.66, smoothstep(-0.3, height, y)) * (0.85 + noise(x * 3, y * 3, z * 3) * 0.18)));
  parts.push(col);

  // Table corals: flat tops, tapering undersides, scalloped rims.
  const plates = rng.int(2, 4);
  const a0 = rng.range(0, TAU);
  for (let k = 0; k < plates; k++) {
    const y = height * lerp(0.36, 0.92, plates === 1 ? 1 : k / (plates - 1)) + rng.range(-0.3, 0.3);
    const a = a0 + k * rng.range(1.8, 2.6);
    const pr = rng.range(1.1, 1.8) * (1 - 0.2 * (k / plates));
    const d = radiusAt(y) * 0.55 + pr * 0.72;
    const plate = new CylinderGeometry(pr, pr * 0.22, 0.24, 22, 2, false);
    const pp = plate.getAttribute('position');
    for (let i = 0; i < pp.count; i++) {
      v.fromBufferAttribute(pp, i);
      const rr = Math.hypot(v.x, v.z);
      const ang = Math.atan2(v.z, v.x);
      const scallop = 1 + Math.sin(ang * 7 + k) * 0.05 + noise(Math.cos(ang) * 1.5, Math.sin(ang) * 1.5, k * 3) * 0.12;
      const dish = (rr / pr) ** 2 * 0.16;
      pp.setXYZ(i, v.x * scallop, v.y + dish, v.z * scallop);
    }
    plate.computeVertexNormals();
    paint(plate, (_x, py, _z, c) => c.setScalar(py > 0.05 ? rng.range(1.02, 1.12) : 0.62));
    plate.rotateZ(rng.range(-0.1, 0.1));
    plate.rotateX(rng.range(-0.1, 0.1));
    const px = leanAt(y) + Math.cos(a) * d;
    const pz = Math.sin(a) * d;
    plate.translate(px, y, pz);
    parts.push(plate);
    perches.push({ x: px, y: y + 0.16, z: pz, r: pr * 0.7 });
  }

  // Encrusting knobs of brighter coral up the column.
  const knobs = rng.int(8, 14);
  for (let k = 0; k < knobs; k++) {
    const y = rng.range(0.4, height * 0.95);
    const a = rng.range(0, TAU);
    const r = radiusAt(y) * 0.95;
    const kr = rng.range(0.16, 0.36);
    const knob = new SphereGeometry(kr, 8, 6);
    knob.scale(1, 0.65, 1);
    paint(knob, (_x, ky, _z, c) => c.setScalar(lerp(0.75, 1.08, smoothstep(-kr, kr, ky))));
    knob.translate(leanAt(y) + Math.cos(a) * r, y, Math.sin(a) * r);
    parts.push(knob);
  }
  perches.push({ x: leanAt(height), y: height + 0.15, z: 0, r: radiusAt(height) * 1.1 });
  return { geo: mergeParts(parts), perches };
}

/**
 * A clump of sea whips: long, thin, gently curving gorgonian rods, some forked. Painted
 * dark at the base and bright towards the tips; sways from the base. 2-4.6 tall.
 */
export function seaWhipGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const n = rng.int(5, 9);
  const addWhip = (start: Vector3, dir: Vector3, len: number, r0: number, phase: number): Vector3[] => {
    const pts: Vector3[] = [];
    const bend = new Vector3(rng.range(-0.5, 0.5), 0, rng.range(-0.3, 0.3));
    const segs = 8;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      pts.push(start.clone().addScaledVector(dir, len * t).addScaledVector(bend, t * t * len * 0.35));
    }
    for (const seg of tube(pts, r0, r0 * 0.3, 5, [0.5, 1.15])) {
      seg.deleteAttribute('uv');
      parts.push(sway(seg, () => [phase, 1]));
    }
    return pts;
  };
  for (let k = 0; k < n; k++) {
    const a = rng.range(0, TAU);
    const tilt = rng.range(0.05, 0.4);
    const dir = new Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
    const len = rng.range(2, 4.6);
    const phase = rng.range(0, TAU);
    const start = new Vector3(rng.range(-0.25, 0.25), -0.05, rng.range(-0.25, 0.25));
    const pts = addWhip(start, dir, len, rng.range(0.045, 0.065), phase);
    if (rng.chance(0.45)) {
      const from = pts[rng.int(3, 5)];
      const d2 = dir.clone().applyAxisAngle(new Vector3(0, 1, 0), rng.range(0, TAU)).lerp(new Vector3(rng.sign() * 0.5, 1, 0), 0.4).normalize();
      addWhip(from, d2, len * rng.range(0.35, 0.55), 0.035, phase + 0.4);
    }
  }
  const foot = new SphereGeometry(0.22, 8, 5);
  foot.scale(1.2, 0.5, 1.2);
  foot.deleteAttribute('uv');
  paint(foot, (_x, _y, _z, c) => c.setScalar(0.4));
  parts.push(sway(foot, () => [0, 0]));
  return mergeParts(parts);
}
