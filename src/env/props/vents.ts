import { BufferGeometry, Color, CylinderGeometry, Vector3 } from 'three';
import { createNoise3D } from 'simplex-noise';
import { Rng } from '../../engine/rng';
import { lerp, smoothstep } from '../../engine/math';
import { mergeParts, paint } from './shapes';

export interface Chimney {
  geo: BufferGeometry;
  /** Mouth position relative to the base. */
  top: Vector3;
}

/**
 * Hydrothermal chimney: stacked, lumpy mineral segments with a sulfur crust. `tall`
 * builds a black smoker spire of 10-14 segments that tapers slowly.
 */
export function chimneyGeometry(seed: number, tall = false): Chimney {
  const rng = new Rng(seed);
  const noise = createNoise3D(() => rng.next());
  const parts: BufferGeometry[] = [];
  let y = -0.4;
  let r = tall ? rng.range(1.5, 2) : rng.range(0.9, 1.3);
  let x = 0;
  let z = 0;
  const segs = tall ? rng.int(10, 14) : rng.int(4, 6);
  const taper: [number, number] = tall ? [0.86, 0.95] : [0.7, 0.88];
  const crust = new Color('#c9a24a');
  const rock = new Color('#1b1a1d');
  for (let k = 0; k < segs; k++) {
    const h = rng.range(0.8, 1.4);
    const rTop = Math.max(0.35, r * rng.range(taper[0], taper[1]));
    const c = new CylinderGeometry(rTop, r * 1.05, h, 10, 3, false);
    const pos = c.getAttribute('position');
    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = 1 + noise(v.x * 2.2 + k, v.y * 2.2, v.z * 2.2) * 0.22;
      pos.setXYZ(i, v.x * n, v.y, v.z * n);
    }
    c.computeVertexNormals();
    c.translate(x, y + h / 2, z);
    parts.push(c);
    y += h * 0.9;
    r = rTop;
    x += rng.range(-0.15, 0.15) * (tall ? 1.6 : 1);
    z += rng.range(-0.1, 0.1);
  }
  const top = new Vector3(x, y, z);
  const geo = mergeParts(parts);
  paint(geo, (px, py, pz, c) => {
    c.copy(rock).lerp(crust, smoothstep(top.y - 1.6, top.y, py) * 0.85 + noise(px * 4, py * 4, pz * 4) * 0.12);
    c.multiplyScalar(lerp(0.6, 1.2, smoothstep(-0.4, top.y, py)));
  });
  return { geo, top };
}
