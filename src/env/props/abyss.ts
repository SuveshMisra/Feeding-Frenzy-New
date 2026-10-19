import { BufferGeometry, Color, CylinderGeometry, IcosahedronGeometry, SphereGeometry, Vector3 } from 'three';
import { createNoise3D } from 'simplex-noise';
import { Rng } from '../../engine/rng';
import { lerp, smoothstep } from '../../engine/math';
import { mergeParts, paint, sway, tube } from './shapes';

/**
 * A whale fall: a long skeleton lying on the seabed, nose towards +x. A row of
 * vertebrae, a cage of ribs arching up and over, a long flat skull and the two bowed
 * jaw bones. About 19 long at unit scale.
 */
export function whaleSkeletonGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const noise = createNoise3D(() => rng.next());
  const parts: BufferGeometry[] = [];
  const spine = (t: number): Vector3 => new Vector3(lerp(-8, 6, t), 0.5 + Math.sin(t * 3 + 0.5) * 0.25, Math.sin(t * 2.2) * 0.4);

  const vertebrae = 30;
  for (let i = 0; i < vertebrae; i++) {
    const t = i / (vertebrae - 1);
    const p = spine(t);
    const r = lerp(0.1, 0.4, smoothstep(0, 0.7, t));
    const body = new CylinderGeometry(r, r, r * 1.1, 8);
    body.rotateZ(Math.PI / 2);
    body.translate(p.x, p.y, p.z);
    parts.push(body);
    const spike = new CylinderGeometry(r * 0.12, r * 0.3, r * 1.8, 4);
    spike.translate(0, r * 0.9, 0);
    spike.rotateZ(0.35);
    spike.translate(p.x, p.y + r * 0.4, p.z);
    parts.push(spike);
    const wing = new CylinderGeometry(r * 0.1, r * 0.25, r * 3.2, 4);
    wing.rotateX(Math.PI / 2);
    wing.translate(p.x, p.y, p.z);
    parts.push(wing);
  }

  // Ribs over the chest. Some have snapped, some have collapsed flat.
  const ribs = 11;
  for (let k = 0; k < ribs; k++) {
    const t = lerp(0.52, 0.9, k / (ribs - 1));
    const p = spine(t);
    const R = lerp(1.2, 2.1, Math.sin((Math.PI * (k + 1)) / (ribs + 1)));
    for (const side of [-1, 1]) {
      if (rng.chance(0.08)) continue;
      const broken = rng.chance(0.22);
      const flat = !broken && rng.chance(0.18);
      const phiMax = broken ? rng.range(0.9, 1.5) : rng.range(2.1, 2.45);
      const pts: Vector3[] = [];
      for (let s = 0; s <= 8; s++) {
        const phi = (s / 8) * phiMax;
        pts.push(
          new Vector3(
            p.x - phi * 0.28,
            p.y + R * (1 - Math.cos(phi)) * (flat ? 0.18 : 0.9),
            p.z + side * (0.3 + R * Math.sin(phi) * (flat ? 1.3 : 0.92)),
          ),
        );
      }
      parts.push(...tube(pts, 0.1, 0.05, 5));
    }
  }

  // Skull: a long, flattened wedge with a rostrum, slightly sunk into the silt.
  const head = spine(1);
  const skull = new SphereGeometry(1, 18, 10);
  skull.scale(2.4, 0.7, 1.25);
  skull.translate(head.x + 2.1, head.y + 0.2, head.z);
  parts.push(skull);
  const rostrum = new CylinderGeometry(0.18, 0.75, 3.4, 8);
  rostrum.scale(1, 1, 0.55);
  rostrum.rotateZ(-Math.PI / 2);
  rostrum.translate(head.x + 5.6, head.y + 0.05, head.z);
  parts.push(rostrum);
  for (const side of [-1, 1]) {
    const pts: Vector3[] = [];
    for (let s = 0; s <= 8; s++) {
      const t = s / 8;
      pts.push(new Vector3(head.x + 0.6 + t * 6.6, 0.25 + Math.sin(t * Math.PI) * 0.15, head.z + side * (0.9 + Math.sin(t * Math.PI) * 0.9 - t * 0.6)));
    }
    parts.push(...tube(pts, 0.2, 0.09, 6));
  }

  for (const p of parts) p.deleteAttribute('uv');
  const geo = mergeParts(parts);
  paint(geo, (x, y, z, c) => c.setScalar(lerp(0.5, 1, smoothstep(0, 2.2, y)) * (0.86 + noise(x * 0.8, y * 0.8, z * 0.8) * 0.16)));
  return geo;
}

const TUBE_WHITE = new Color('#ece6d8');
const PLUME_RED = new Color('#d81f2c');

/**
 * Giant tube worms: a clump of white chitin tubes with blood-red plumes on top. Painted
 * in absolute colours, so tint the instances near white. About 1.8 tall.
 */
export function tubeWormGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const n = rng.int(10, 18);
  for (let k = 0; k < n; k++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * 0.6;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const h = rng.range(0.5, 1.8) * (1 - d * 0.5);
    const r = rng.range(0.045, 0.08);
    const lean = new Vector3(x, 0, z).multiplyScalar(0.35);
    const pts: Vector3[] = [];
    for (let s = 0; s <= 3; s++) {
      const t = s / 3;
      pts.push(new Vector3(x + lean.x * t * h, t * h, z + lean.z * t * h));
    }
    for (const seg of tube(pts, r, r * 0.85, 6, [0.7, 1])) {
      paint(seg, (_x, y, _z, c) => c.copy(TUBE_WHITE).multiplyScalar(lerp(0.6, 1, y / h)));
      parts.push(seg);
    }
    const top = pts[3];
    const plume = new IcosahedronGeometry(r * 2.1, 1);
    plume.scale(1, 1.7, 1);
    paint(plume, (_x, py, _z, c) => c.copy(PLUME_RED).multiplyScalar(lerp(0.75, 1.15, smoothstep(-r * 2, r * 3, py))));
    plume.translate(top.x, top.y + r * 2.2, top.z);
    parts.push(plume);
  }
  const mound = new SphereGeometry(0.75, 10, 6);
  mound.scale(1, 0.35, 1);
  paint(mound, (_x, _y, _z, c) => c.setRGB(0.12, 0.11, 0.11));
  parts.push(mound);
  for (const p of parts) p.deleteAttribute('uv');
  const geo = mergeParts(parts);
  return sway(geo, (x, y, z) => [x * 3 + z * 2, smoothstep(0.3, 1.8, y)]);
}
