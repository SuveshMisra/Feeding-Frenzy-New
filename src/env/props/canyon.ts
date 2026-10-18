import { BoxGeometry, BufferGeometry, Vector3 } from 'three';
import { createNoise3D } from 'simplex-noise';
import { Rng } from '../../engine/rng';
import { lerp, smoothstep } from '../../engine/math';
import { mergeParts, paint } from './shapes';

export interface Cliff {
  geo: BufferGeometry;
  /** Height of the flat top terrace (unit scale). */
  top: number;
  /** Half-width of the top terrace. */
  topRadius: number;
}

/** Shades of the sediment bands, bottom to top. */
const STRATA = [0.62, 0.95, 0.78, 1.1, 0.7, 1.0, 0.85, 1.05];

/**
 * A chunk of layered canyon wall: lumpy sediment slabs stacked with ledges and
 * overhangs. About 4 wide, 1.8 deep and 3-6 tall at unit scale.
 */
export function cliffGeometry(seed: number): Cliff {
  const rng = new Rng(seed);
  const noise = createNoise3D(() => rng.next());
  const parts: BufferGeometry[] = [];
  const layers = rng.int(4, 7);
  let y = -0.3;
  let w = rng.range(3.4, 4.6);
  let d = rng.range(1.6, 2.3);
  let ox = 0;
  const v = new Vector3();
  for (let k = 0; k < layers; k++) {
    const h = rng.range(0.55, 1.15);
    const slab = new BoxGeometry(w, h, d, 10, 2, 5);
    const pos = slab.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = noise(v.x * 0.7 + k * 3.1, v.y * 1.4, v.z * 0.7);
      const n2 = noise(v.x * 2.4, v.y * 2.4 + k, v.z * 2.4) * 0.35;
      v.x *= 1 + (n + n2) * 0.08;
      v.z *= 1 + (n - n2) * 0.16;
      v.y += noise(v.x * 1.1, k * 5.3, v.z * 1.1) * h * 0.12;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    slab.deleteAttribute('uv');
    slab.computeVertexNormals();
    const shade = STRATA[k % STRATA.length];
    paint(slab, (px, py, pz, c) => {
      const t = (py + h / 2) / h;
      // Darker grooves where one band meets the next, plus streaky weathering.
      c.setScalar(shade * lerp(0.62, 1.05, smoothstep(0, 0.35, t)) * (0.9 + noise(px * 3, py * 9, pz * 3) * 0.12));
    });
    slab.translate(ox, y + h / 2, rng.range(-0.12, 0.12));
    parts.push(slab);
    y += h * 0.95;
    ox += rng.range(-0.3, 0.3);
    w *= rng.range(0.78, 1.02);
    d *= rng.range(0.84, 1.03);
  }
  return { geo: mergeParts(parts), top: y, topRadius: w * 0.4 };
}
