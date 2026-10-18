import { BufferGeometry, IcosahedronGeometry, Vector3 } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createNoise3D } from 'simplex-noise';
import { Rng } from '../../engine/rng';
import { lerp, smoothstep } from '../../engine/math';
import { paint } from './shapes';

/**
 * Underside of an iceberg hanging from the ice ceiling: flat on top (y = 0),
 * fluted and jagged below, ending in icicle points. Unit radius, depth ~1.
 */
export function icebergGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const noise = createNoise3D(() => rng.next());
  const ico = new IcosahedronGeometry(1, 4);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const geo = mergeVertices(ico, 1e-4);
  ico.dispose();
  const pos = geo.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const below = v.y < 0;
    // Vertical flutes carved by meltwater, plus chunky facets.
    const flute = Math.abs(noise(v.x * 3.2, v.y * 0.7, v.z * 3.2));
    let r = 1 + noise(v.x * 1.2, v.y * 1.2, v.z * 1.2) * 0.22 + flute * 0.16;
    if (below) {
      const spike = Math.max(0, noise(v.x * 3.5 + 11, 0, v.z * 3.5));
      r += spike * spike * 0.9 * smoothstep(-0.2, -0.9, v.y);
    }
    v.multiplyScalar(r);
    v.y = below ? v.y : v.y * 0.06;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return paint(geo, (_x, y, _z, c) => {
    c.setRGB(1, 1, 1).multiplyScalar(lerp(0.62, 1.05, smoothstep(-1.4, 0.05, y)));
  });
}
