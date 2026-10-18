import { BoxGeometry, BufferGeometry, CylinderGeometry, SphereGeometry, Vector3 } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createNoise3D, type NoiseFunction3D } from 'simplex-noise';
import { Rng } from '../../engine/rng';
import { clamp01, lerp, smoothstep, TAU } from '../../engine/math';
import { mergeParts, paint } from './shapes';

/** Chips the corners of a box-like part and roughens its faces. */
function weather(geo: BufferGeometry, noise: NoiseFunction3D, amount: number): BufferGeometry {
  const pos = geo.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise(v.x * 1.7, v.y * 1.7, v.z * 1.7);
    const chip = Math.max(0, noise(v.x * 0.9 + 4, v.y * 0.9, v.z * 0.9)) * amount * 2.2;
    v.multiplyScalar(1 + n * amount - chip * 0.5);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  return geo;
}

/** Stone with darker crevices and moss creeping over the upper parts. */
function stonePaint(geo: BufferGeometry, noise: NoiseFunction3D, top: number): BufferGeometry {
  return paint(geo, (x, y, z, c) => {
    const n = noise(x * 2.6, y * 2.6, z * 2.6);
    c.setScalar(0.82 + n * 0.14);
    const moss = smoothstep(0.15, 0.6, noise(x * 0.8 + 9, y * 0.5, z * 0.8)) * smoothstep(top * 0.35, top, y);
    c.r *= lerp(1, 0.72, moss);
    c.b *= lerp(1, 0.68, moss);
    c.multiplyScalar(lerp(0.62, 1, smoothstep(-0.2, top * 0.3, y)));
  });
}

export interface Column {
  geo: BufferGeometry;
  height: number;
}

/** A fluted column on a plinth, either whole with a capital or snapped off. */
export function columnGeometry(seed: number, broken: boolean): Column {
  const rng = new Rng(seed);
  const noise = createNoise3D(() => rng.next());
  const r = 0.42;
  const h = broken ? rng.range(1.6, 3.4) : rng.range(4.2, 5.4);
  const parts: BufferGeometry[] = [];
  const plinth = weather(new BoxGeometry(1.25, 0.38, 1.25, 3, 1, 3), noise, 0.05);
  plinth.translate(0, 0.19, 0);
  parts.push(plinth);

  const shaft = new CylinderGeometry(r * 0.9, r, h, 24, 10, false);
  const pos = shaft.getAttribute('position');
  const v = new Vector3();
  const breakAt = h / 2 - rng.range(0.1, 0.4);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const rr = Math.hypot(v.x, v.z);
    const flute = rr > 0.05 ? 1 - 0.07 * (0.5 + 0.5 * Math.cos(a * 16)) : 1;
    const erode = 1 + noise(v.x * 2, v.y * 1.5, v.z * 2) * 0.05;
    v.x *= flute * erode;
    v.z *= flute * erode;
    // A snapped column ends in a jagged break.
    if (broken && v.y > breakAt) v.y = breakAt + (h / 2 - breakAt) * 0.3 - Math.abs(noise(v.x * 2.5, 3, v.z * 2.5)) * 0.9;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  shaft.deleteAttribute('uv');
  shaft.computeVertexNormals();
  shaft.translate(0, 0.38 + h / 2, 0);
  parts.push(shaft);

  let top = 0.38 + h;
  if (!broken) {
    const echinus = new CylinderGeometry(r * 1.35, r * 0.92, 0.28, 24, 1, false);
    echinus.deleteAttribute('uv');
    echinus.translate(0, top + 0.14, 0);
    const abacus = weather(new BoxGeometry(1.2, 0.3, 1.2, 3, 1, 3), noise, 0.05);
    abacus.translate(0, top + 0.43, 0);
    parts.push(echinus, abacus);
    top += 0.58;
  }
  for (const p of parts) if (p.getAttribute('uv')) p.deleteAttribute('uv');
  const geo = mergeParts(parts);
  return { geo: stonePaint(geo, noise, top), height: top };
}

/** Two square piers carrying a round arch of wedge stones, a few of them missing. */
export function archGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const noise = createNoise3D(() => rng.next());
  const parts: BufferGeometry[] = [];
  const span = 1.7;
  const pier = 3.6;
  for (const side of [-1, 1]) {
    const p = weather(new BoxGeometry(0.8, pier, 0.85, 2, 6, 2), noise, 0.05);
    p.translate(side * span, pier / 2, 0);
    parts.push(p);
  }
  const stones = 9;
  const rArch = span;
  let missing = 0;
  for (let k = 0; k < stones; k++) {
    const t = (k + 0.5) / stones;
    if (k > 0 && k < stones - 1 && missing < 2 && rng.chance(0.18)) {
      missing++;
      continue;
    }
    const a = Math.PI * (1 - t);
    const stone = weather(new BoxGeometry(0.62, 0.8, 0.8, 2, 2, 2), noise, 0.06);
    stone.rotateZ(a - Math.PI / 2);
    stone.translate(Math.cos(a) * (rArch + 0.0), pier + Math.sin(a) * (rArch + 0.0), 0);
    parts.push(stone);
  }
  return stonePaint(mergeParts(parts), noise, pier + span);
}

/**
 * A giant weathered stone head: long face, heavy brow, deep eye sockets, a broad
 * nose and pursed lips. Faces +z, about 2.2 tall at unit scale.
 */
export function statueHeadGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const noise = createNoise3D(() => rng.next());
  const sphere = new SphereGeometry(1, 56, 40);
  sphere.deleteAttribute('uv');
  sphere.deleteAttribute('normal');
  const geo = mergeVertices(sphere, 1e-4);
  sphere.dispose();
  const pos = geo.getAttribute('position');
  const v = new Vector3();
  const relief = new Float32Array(pos.count);
  const g = (dx: number, dy: number, s: number): number => Math.exp(-(dx * dx + dy * dy) / (2 * s * s));
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const front = smoothstep(0.25, 0.85, v.z);
    const brow = 0.11 * Math.exp(-((v.y - 0.3) ** 2) / 0.005) * smoothstep(0.62, 0.15, Math.abs(v.x));
    const sockets = -0.14 * (g(v.x - 0.3, v.y - 0.14, 0.12) + g(v.x + 0.3, v.y - 0.14, 0.12));
    const nose = 0.3 * Math.exp(-(v.x * v.x) / (2 * 0.09 * 0.09)) * smoothstep(0.24, 0.0, v.y) * smoothstep(-0.44, -0.2, v.y) * (1 + smoothstep(-0.1, -0.35, v.y) * 0.5);
    const nostrils = 0.06 * (g(v.x - 0.12, v.y + 0.38, 0.06) + g(v.x + 0.12, v.y + 0.38, 0.06));
    const lips = 0.08 * Math.exp(-(v.x * v.x) / 0.07) * (Math.exp(-((v.y + 0.53) ** 2) / 0.002) + Math.exp(-((v.y + 0.64) ** 2) / 0.002));
    const chin = 0.07 * g(v.x, v.y + 0.82, 0.18);
    const d = front * (brow + sockets + nose + nostrils + lips + chin);
    relief[i] = d;
    const weathering = noise(v.x * 3, v.y * 3, v.z * 3) * 0.025 + noise(v.x * 9, v.y * 9, v.z * 9) * 0.008;
    v.multiplyScalar(1 + d + weathering);
    // Long, flat-sided face with a squared-off crown and a flat back.
    v.set(v.x * 0.72 * (1 - smoothstep(0.3, 1, v.y) * 0.08), v.y * 1.12, v.z * (v.z < 0 ? 0.7 : 0.88));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return paint(geo, (x, y, z, c, i) => {
    const r = relief[i];
    c.setScalar(0.85 + noise(x * 2.2, y * 2.2, z * 2.2) * 0.12);
    // Crevices (sockets, nostrils, lip line) read darker.
    c.multiplyScalar(lerp(1, 0.5, clamp01(-r * 6)));
    const moss = smoothstep(0.2, 0.7, noise(x * 1.1 + 5, y * 0.8, z * 1.1)) * smoothstep(0.2, 1.1, y);
    c.r *= lerp(1, 0.7, moss);
    c.b *= lerp(1, 0.66, moss);
  });
}

/** Three or four worn stone steps (a temple platform). About 6 wide. */
export function stepsGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const noise = createNoise3D(() => rng.next());
  const parts: BufferGeometry[] = [];
  const n = rng.int(3, 4);
  let w = rng.range(5.5, 6.5);
  let d = rng.range(3, 3.8);
  for (let k = 0; k < n; k++) {
    const h = 0.48;
    const step = weather(new BoxGeometry(w, h, d, 6, 1, 4), noise, 0.035);
    step.translate(rng.range(-0.08, 0.08), k * h + h / 2 - 0.12, 0);
    parts.push(step);
    w -= rng.range(1.0, 1.4);
    d -= rng.range(0.55, 0.8);
  }
  return stonePaint(mergeParts(parts), noise, n * 0.48);
}

/** A fallen, chipped masonry block. */
export function blockGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const noise = createNoise3D(() => rng.next());
  const geo = weather(new BoxGeometry(rng.range(0.9, 1.3), rng.range(0.5, 0.7), rng.range(0.7, 0.9), 3, 2, 3), noise, 0.08);
  geo.rotateY(rng.range(0, TAU));
  return stonePaint(geo, noise, 0.4);
}
