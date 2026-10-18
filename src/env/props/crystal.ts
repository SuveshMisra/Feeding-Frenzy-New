import { BufferGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, Quaternion, SphereGeometry, Vector3 } from 'three';
import { Rng } from '../../engine/rng';
import { lerp, smoothstep, TAU } from '../../engine/math';
import { mergeParts, paint } from './shapes';

const UP = new Vector3(0, 1, 0);
const tmpQ = new Quaternion();

/**
 * A cluster of hexagonal crystals with pointed tips, fanning out of a dark rock
 * base. Vertex shade runs from dark at the base to bright at the tips, so a glow
 * material lights up the tips. Roughly 2-3 tall at unit scale.
 */
export function crystalClusterGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const base = new IcosahedronGeometry(0.55, 1);
  base.scale(1.2, 0.45, 1);
  paint(base, (_x, _y, _z, c) => c.setScalar(0.18));
  parts.push(base);
  const count = rng.int(5, 9);
  const dir = new Vector3();
  for (let k = 0; k < count; k++) {
    const main = k === 0;
    const r = rng.range(0.1, 0.24) * (main ? 1.5 : 1);
    const len = rng.range(0.7, 1.8) * (main ? 1.55 : 1);
    const prism = new CylinderGeometry(r, r * 1.08, len, 6, 1, true);
    prism.translate(0, len / 2, 0);
    paint(prism, (_x, y, _z, c) => c.setScalar(lerp(0.32, 0.95, smoothstep(0, len, y))));
    const tipH = r * rng.range(1.8, 2.6);
    const tip = new ConeGeometry(r, tipH, 6, 1, true);
    tip.translate(0, len + tipH / 2, 0);
    paint(tip, (_x, y, _z, c) => c.setScalar(lerp(1, 1.35, smoothstep(len, len + tipH, y))));
    const a = rng.range(0, TAU);
    const tilt = main ? rng.range(0, 0.2) : rng.range(0.3, 0.85);
    dir.set(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
    tmpQ.setFromUnitVectors(UP, dir);
    for (const g of [prism, tip]) {
      g.rotateY(rng.range(0, 1));
      g.applyQuaternion(tmpQ);
      g.translate(Math.cos(a) * 0.18 * (main ? 0 : 1), -0.05, Math.sin(a) * 0.18 * (main ? 0 : 1));
      g.deleteAttribute('uv');
      parts.push(g);
    }
  }
  base.deleteAttribute('uv');
  return mergeParts(parts);
}

/**
 * A clump of glowing cave mushrooms. Stems and gills are painted dark so only the
 * caps glow. About 1 tall at unit scale.
 */
export function mushroomGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const n = rng.int(3, 6);
  for (let k = 0; k < n; k++) {
    const main = k === 0;
    const h = rng.range(0.35, 0.9) * (main ? 1.3 : 1);
    const rc = rng.range(0.16, 0.32) * (main ? 1.35 : 1);
    const a = rng.range(0, TAU);
    const off = main ? 0 : rng.range(0.18, 0.45);
    const lean = rng.range(-0.25, 0.25);
    const stem = new CylinderGeometry(rc * 0.22, rc * 0.32, h, 7, 3, true);
    stem.translate(0, h / 2, 0);
    paint(stem, (_x, y, _z, c) => c.setScalar(lerp(0.12, 0.28, y / h)));
    const cap = new SphereGeometry(rc, 14, 6, 0, TAU, 0, Math.PI / 2);
    cap.scale(1, 0.55, 1);
    paint(cap, (x, y, z, c) => c.setScalar(lerp(0.95, 1.3, y / (rc * 0.55)) * (1 - 0.15 * Math.sin(Math.atan2(z, x) * 9) ** 2)));
    cap.translate(0, h, 0);
    const gills = new CircleGeometry(rc * 0.98, 14);
    gills.rotateX(Math.PI / 2);
    paint(gills, (_x, _y, _z, c) => c.setScalar(0.22));
    gills.translate(0, h + 0.01, 0);
    for (const g of [stem, cap, gills]) {
      g.rotateZ(lean);
      g.translate(Math.cos(a) * off, -0.02, Math.sin(a) * off);
      g.deleteAttribute('uv');
      parts.push(g);
    }
  }
  return mergeParts(parts);
}
