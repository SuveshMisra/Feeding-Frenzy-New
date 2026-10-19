import { BufferGeometry, Color, IcosahedronGeometry, LatheGeometry, PlaneGeometry, Vector2, Vector3 } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createNoise3D } from 'simplex-noise';
import { Rng } from '../../engine/rng';
import { clamp01, lerp, smoothstep, TAU } from '../../engine/math';
import { mergeParts, paint, sway } from './shapes';

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

/**
 * A brinicle: a knobbly icicle hanging from the ice sheet (y = 0 down to about -6),
 * with a few smaller icicles clustered around its root.
 */
export function brinicleGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const noise = createNoise3D(() => rng.next());
  const parts: BufferGeometry[] = [];
  const icicle = (x: number, z: number, len: number, r0: number): void => {
    const prof: Vector2[] = [new Vector2(0.005, -len)];
    const steps = Math.max(6, Math.round(len * 2.2));
    for (let i = steps - 1; i >= 0; i--) {
      const t = i / steps;
      const knob = 1 + Math.sin(t * len * 4.5 + x * 7) * 0.12;
      prof.push(new Vector2(r0 * Math.pow(1 - t, 0.85) * knob + 0.01, -t * len));
    }
    prof.push(new Vector2(r0 * 1.15, 0.5));
    const g = new LatheGeometry(prof, 7);
    const pos = g.getAttribute('position');
    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = 1 + noise(v.x * 2 + x, v.y * 0.9, v.z * 2 + z) * 0.25;
      const drift = noise(0, v.y * 0.25, x * 3) * 0.12 * -v.y;
      pos.setXYZ(i, v.x * n + x + drift, v.y, v.z * n + z);
    }
    g.computeVertexNormals();
    g.deleteAttribute('uv');
    paint(g, (_x, y, _z, c) => c.setScalar(lerp(0.8, 1.08, smoothstep(-len, 0.2, y))));
    parts.push(g);
  };
  const len = rng.range(4, 6.5);
  icicle(0, 0, len, rng.range(0.38, 0.5));
  const extra = rng.int(3, 6);
  for (let k = 0; k < extra; k++) {
    const a = rng.range(0, TAU);
    const d = rng.range(0.45, 1.1);
    icicle(Math.cos(a) * d, Math.sin(a) * d, len * rng.range(0.2, 0.55), rng.range(0.14, 0.26));
  }
  return mergeParts(parts);
}

/**
 * A curtain of ice algae: ribbons hanging from the underside of the ice (y = 0 down),
 * spread along x. Sways with a negative height.
 */
export function algaeCurtainGeometry(seed: number, base: Color, tip: Color): BufferGeometry {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const n = rng.int(6, 10);
  for (let k = 0; k < n; k++) {
    const w = rng.range(0.22, 0.45);
    const len = rng.range(1.4, 4.6);
    const b = new PlaneGeometry(w, len + 0.5, 1, 10);
    b.translate(0, -(len - 0.5) / 2, 0);
    const pos = b.getAttribute('position');
    const ph = rng.range(0, TAU);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = clamp01(-y / len);
      pos.setX(i, pos.getX(i) * (1 - t * 0.6) + Math.sin(y * 1.6 + ph) * 0.12 * t);
      pos.setZ(i, Math.sin(y * 2.3 + ph) * 0.08);
    }
    b.computeVertexNormals();
    b.deleteAttribute('uv');
    paint(b, (_x, y, _z, c) => c.copy(base).lerp(tip, smoothstep(0.1, 1, -y / len)).multiplyScalar(lerp(0.75, 1.05, clamp01(-y / len))));
    sway(b, () => [ph, 1]);
    b.rotateY(rng.range(-0.6, 0.6));
    b.translate(rng.range(-1.4, 1.4), 0, rng.range(-0.5, 0.5));
    parts.push(b);
  }
  return mergeParts(parts);
}
