import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  LatheGeometry,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createNoise3D } from 'simplex-noise';
import { Rng } from '../../engine/rng';
import { clamp01, lerp, smoothstep, TAU } from '../../engine/math';

type Painter = (x: number, y: number, z: number, c: Color, i: number) => void;

const UP = new Vector3(0, 1, 0);
const tmpQ = new Quaternion();

/** Writes a per-vertex colour attribute (starts from white). */
export function paint(geo: BufferGeometry, fn: Painter): BufferGeometry {
  const pos = geo.getAttribute('position');
  const data = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    c.setRGB(1, 1, 1);
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), c, i);
    data[i * 3] = c.r;
    data[i * 3 + 1] = c.g;
    data[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(data, 3));
  return geo;
}

/** Writes the `aSway` attribute (phase, strength) read by the sway shader. */
export function sway(
  geo: BufferGeometry,
  fn: (x: number, y: number, z: number, i: number) => readonly [number, number],
): BufferGeometry {
  const pos = geo.getAttribute('position');
  const data = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const s = fn(pos.getX(i), pos.getY(i), pos.getZ(i), i);
    data[i * 2] = s[0];
    data[i * 2 + 1] = s[1];
  }
  geo.setAttribute('aSway', new Float32BufferAttribute(data, 2));
  return geo;
}

/** Merges parts, keeping only the attributes every part has. */
export function mergeParts(parts: BufferGeometry[]): BufferGeometry {
  const names = Object.keys(parts[0].attributes).filter((n) => parts.every((p) => p.getAttribute(n)));
  const indexed = parts.every((p) => p.index !== null);
  const cleaned = parts.map((p) => {
    const g = indexed || !p.index ? p : p.toNonIndexed();
    for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
    return g;
  });
  const out = mergeGeometries(cleaned, false);
  if (!out) throw new Error('mergeParts: incompatible geometry attributes');
  for (const g of cleaned) g.dispose();
  for (const p of parts) p.dispose();
  return out;
}

/**
 * A tapering tube through `points`, built from cylinder segments. The grey shade
 * is painted from `shade[0]` at the start to `shade[1]` at the end.
 */
export function tube(points: Vector3[], r0: number, r1: number, radial: number, shade: readonly [number, number] = [1, 1]): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const n = points.length - 1;
  const dir = new Vector3();
  for (let i = 0; i < n; i++) {
    const a = points[i];
    dir.subVectors(points[i + 1], a);
    const len = dir.length();
    if (len < 1e-5) continue;
    dir.divideScalar(len);
    const seg = new CylinderGeometry(lerp(r0, r1, (i + 1) / n), lerp(r0, r1, i / n), len * 1.04, radial, 1, true);
    seg.translate(0, len / 2, 0);
    const s0 = lerp(shade[0], shade[1], i / n);
    const s1 = lerp(shade[0], shade[1], (i + 1) / n);
    paint(seg, (_x, y, _z, c) => c.setScalar(lerp(s0, s1, clamp01(y / len))));
    seg.applyQuaternion(tmpQ.setFromUnitVectors(UP, dir));
    seg.translate(a.x, a.y, a.z);
    parts.push(seg);
  }
  return parts;
}

function mixInto(c: Color, target: Color, t: number): void {
  c.r = lerp(c.r, target.r, t);
  c.g = lerp(c.g, target.g, t);
  c.b = lerp(c.b, target.b, t);
}

// --- Rocks -----------------------------------------------------------------

export interface RockColors {
  base: Color;
  dark: Color;
  /** Sediment / algae / frost that settles on upward faces. */
  top: Color;
  topAmount: number;
}

export function rockGeometry(seed: number, colors: RockColors, detail = 3): BufferGeometry {
  const rng = new Rng(seed);
  const noise = createNoise3D(() => rng.next());
  const ico = new IcosahedronGeometry(1, detail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const geo = mergeVertices(ico, 1e-4);
  ico.dispose();
  const pos = geo.getAttribute('position');
  const v = new Vector3();
  const sx = rng.range(1, 1.45);
  const sy = rng.range(0.55, 0.9);
  const sz = rng.range(0.8, 1.15);
  const strata = rng.range(4, 7);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d =
      noise(v.x * 0.9, v.y * 0.9, v.z * 0.9) * 0.3 +
      noise(v.x * 2.3 + 7, v.y * 2.3, v.z * 2.3) * 0.12 +
      noise(v.x * 5.5, v.y * 5.5 + 3, v.z * 5.5) * 0.04;
    v.multiplyScalar(1 + d);
    v.set(v.x * sx, v.y * sy, v.z * sz);
    // Soft terraces read as layered sedimentary rock.
    v.y = lerp(v.y, Math.round(v.y * strata) / strata, 0.28);
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.2;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const nrm = geo.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) + pos.getZ(i) * 0.6) * 0.8;
    uv[i * 2 + 1] = pos.getY(i) * 0.8;
  }
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return paint(geo, (x, y, z, c, i) => {
    c.copy(colors.dark).lerp(colors.base, smoothstep(-0.25, 0.45, y) * 0.85 + noise(x * 3, y * 3, z * 3) * 0.12);
    const up = clamp01(nrm.getY(i));
    mixInto(c, colors.top, smoothstep(0.5, 0.92, up) * colors.topAmount * (0.75 + noise(x * 2, z * 2, 5) * 0.4));
    c.multiplyScalar(lerp(0.55, 1, smoothstep(-0.2, 0.3, y)));
  });
}

// --- Branching coral ---------------------------------------------------------

export type CoralStyle = 'staghorn' | 'bush' | 'finger';

const CORAL_STYLES: Record<
  CoralStyle,
  { depth: number; len: number; r: number; spread: number; kids: [number, number]; upBias: number; taper: number; lenK: number; trunks: [number, number] }
> = {
  staghorn: { depth: 3, len: 0.55, r: 0.085, spread: 0.62, kids: [2, 3], upBias: 0.22, taper: 0.72, lenK: 0.8, trunks: [1, 2] },
  bush: { depth: 3, len: 0.3, r: 0.07, spread: 0.85, kids: [2, 3], upBias: 0.1, taper: 0.74, lenK: 0.84, trunks: [2, 3] },
  finger: { depth: 1, len: 0.45, r: 0.12, spread: 0.42, kids: [3, 5], upBias: 0.45, taper: 0.9, lenK: 1.15, trunks: [1, 1] },
};

/** Recursive branches with rounded, paler polyp tips. Height is roughly 1.2-1.8. */
export function branchCoralGeometry(seed: number, style: CoralStyle): BufferGeometry {
  const rng = new Rng(seed);
  const cfg = CORAL_STYLES[style];
  const parts: BufferGeometry[] = [];
  const axis = new Vector3();
  const tip = new Color(1.25, 1.2, 1.15);

  const grow = (start: Vector3, dir: Vector3, len: number, r: number, depth: number): void => {
    const rTop = r * cfg.taper;
    const seg = new CylinderGeometry(rTop, r, len, 6, 1, true);
    seg.translate(0, len / 2, 0);
    const l0 = (cfg.depth - depth) / (cfg.depth + 1);
    const l1 = (cfg.depth - depth + 1) / (cfg.depth + 1);
    paint(seg, (_x, y, _z, c) => c.setScalar(lerp(0.5, 1, lerp(l0, l1, y / len))));
    seg.applyQuaternion(tmpQ.setFromUnitVectors(UP, dir));
    seg.translate(start.x, start.y, start.z);
    parts.push(seg);
    const end = start.clone().addScaledVector(dir, len);
    if (depth <= 0) {
      const cap = new SphereGeometry(rTop * 1.25, 6, 4);
      paint(cap, (_x, y, _z, c) => {
        c.setScalar(1);
        mixInto(c, tip, smoothstep(-0.5, 1, y / (rTop * 1.25)));
      });
      cap.translate(end.x, end.y, end.z);
      parts.push(cap);
      return;
    }
    const kids = rng.int(cfg.kids[0], cfg.kids[1]);
    const base = rng.range(0, TAU);
    for (let k = 0; k < kids; k++) {
      const around = base + (k / kids) * TAU + rng.range(-0.4, 0.4);
      axis.set(Math.cos(around), 0, Math.sin(around)).cross(dir);
      if (axis.lengthSq() < 1e-4) axis.set(1, 0, 0);
      axis.normalize();
      const d2 = dir.clone().applyAxisAngle(axis, cfg.spread * rng.range(0.6, 1.2));
      d2.lerp(UP, cfg.upBias).normalize();
      grow(end, d2, len * cfg.lenK * rng.range(0.85, 1.15), rTop, depth - 1);
    }
  };

  const trunks = rng.int(cfg.trunks[0], cfg.trunks[1]);
  for (let t = 0; t < trunks; t++) {
    const d = new Vector3(rng.range(-0.35, 0.35), 1, rng.range(-0.35, 0.35)).normalize();
    grow(new Vector3(rng.range(-0.15, 0.15), -0.08, rng.range(-0.15, 0.15)), d, cfg.len, cfg.r, cfg.depth);
  }
  return mergeParts(parts);
}

// --- Brain coral -------------------------------------------------------------

export function brainCoralGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const noise = createNoise3D(() => rng.next());
  const geo = new SphereGeometry(1, 56, 28, 0, TAU, 0, Math.PI * 0.6);
  const pos = geo.getAttribute('position');
  const v = new Vector3();
  const ridge = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const w = noise(v.x * 1.3, v.y * 1.3, v.z * 1.3) * 1.4;
    const r = Math.abs(Math.sin(noise(v.x * 1.7 + w, v.y * 1.7, v.z * 1.7 - w) * 7));
    ridge[i] = r;
    const lump = 1 + noise(v.x * 0.8, v.y * 0.8 + 9, v.z * 0.8) * 0.12;
    v.multiplyScalar(lump * (1 + r * 0.05));
    v.y = v.y * 0.72 - 0.12;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return paint(geo, (_x, y, _z, c, i) => {
    c.setScalar(lerp(0.5, 1.05, smoothstep(0.1, 0.9, ridge[i])) * lerp(0.6, 1, smoothstep(-0.15, 0.35, y)));
  });
}

// --- Sea fan ----------------------------------------------------------------

/** Cupped lattice plane; pair with the alpha-tested fan texture. Height 1.7. */
export function fanGeometry(seed: number): BufferGeometry {
  const w = 2;
  const h = 1.7;
  const geo = new PlaneGeometry(w, h, 8, 6);
  geo.translate(0, h / 2 - 0.05, 0);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, x * x * 0.2 + Math.sin(y * 2 + seed) * 0.06);
  }
  geo.computeVertexNormals();
  paint(geo, (_x, y, _z, c) => c.setScalar(lerp(0.65, 1.1, y / h)));
  return sway(geo, (x, y) => [x * 0.8 + seed, clamp01(y / h)]);
}

// --- Tube sponges -------------------------------------------------------------

export function spongeGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const n = rng.int(3, 5);
  const shade = [0.55, 0.85, 1.0, 1.12, 0.4, 0.18];
  for (let k = 0; k < n; k++) {
    const r = rng.range(0.13, 0.24);
    const hgt = rng.range(0.5, 1.35) * (k === 0 ? 1.2 : 1);
    const pts = [
      new Vector2(r * 0.9, -0.1),
      new Vector2(r, hgt * 0.5),
      new Vector2(r * 1.14, hgt),
      new Vector2(r * 0.96, hgt + 0.035),
      new Vector2(r * 0.74, hgt - 0.02),
      new Vector2(r * 0.64, hgt * 0.35),
    ];
    const tube = new LatheGeometry(pts, 12);
    paint(tube, (_x, _y, _z, c, i) => c.setScalar(shade[i % pts.length]));
    tube.rotateX(rng.range(-0.22, 0.22));
    tube.rotateZ(rng.range(-0.22, 0.22));
    const a = (k / n) * TAU + rng.range(-0.3, 0.3);
    const off = k === 0 ? 0 : rng.range(0.18, 0.3);
    tube.translate(Math.cos(a) * off, 0, Math.sin(a) * off);
    parts.push(tube);
  }
  return mergeParts(parts);
}

// --- Anemone ------------------------------------------------------------------

export function anemoneGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const base = new CylinderGeometry(0.3, 0.4, 0.36, 12, 1, false);
  base.translate(0, 0.1, 0);
  paint(base, (_x, y, _z, c) => c.setScalar(lerp(0.45, 0.75, y / 0.28 + 0.5)));
  sway(base, () => [0, 0]);
  parts.push(base);
  const n = 34;
  const dir = new Vector3();
  for (let k = 0; k < n; k++) {
    const inner = k >= n * 0.62;
    const a = (k / n) * TAU * (inner ? 2.6 : 1.6) + rng.range(-0.12, 0.12);
    const rr = inner ? 0.13 : 0.26;
    const len = rng.range(0.45, 0.75) * (inner ? 0.8 : 1);
    const t = new CylinderGeometry(0.014, 0.045, len, 4, 4, true);
    t.translate(0, len / 2, 0);
    paint(t, (_x, y, _z, c) => c.setScalar(lerp(0.7, 1.4, y / len)));
    sway(t, (_x, y) => [a * 2 + k * 0.3, clamp01(y / len)]);
    const out = inner ? 0.45 : 1.0;
    dir.set(Math.cos(a) * out, 1, Math.sin(a) * out).normalize();
    t.applyQuaternion(tmpQ.setFromUnitVectors(UP, dir));
    t.translate(Math.cos(a) * rr, 0.26, Math.sin(a) * rr);
    parts.push(t);
  }
  return mergeParts(parts);
}

// --- Kelp -----------------------------------------------------------------------

export interface PlantColors {
  stem: Color;
  base: Color;
  tip: Color;
}

/** A tall kelp plant with alternating ruffled blades and gas bladders. */
export function kelpGeometry(seed: number, height: number, colors: PlantColors): BufferGeometry {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const ph = rng.range(0, TAU);
  const bend = (y: number): number => Math.sin(y * 0.2 + ph) * 0.55 * (y / height);

  const stem = new CylinderGeometry(0.05, 0.1, height, 5, 24, true);
  stem.translate(0, height / 2, 0);
  const sp = stem.getAttribute('position');
  for (let i = 0; i < sp.count; i++) sp.setX(i, sp.getX(i) + bend(sp.getY(i)));
  stem.computeVertexNormals();
  paint(stem, (_x, y, _z, c) => c.copy(colors.stem).multiplyScalar(lerp(0.7, 1.1, y / height)));
  parts.push(stem);

  const count = Math.floor(height / 0.7);
  for (let k = 0; k < count; k++) {
    const y0 = 0.7 + (k / count) * (height - 0.9);
    const side = k % 2 ? 1 : -1;
    const len = rng.range(1.3, 2.3) * (1 - 0.35 * (k / count));
    const wid = rng.range(0.24, 0.36);
    const blade = new PlaneGeometry(wid, len, 1, 6);
    blade.translate(0, len / 2, 0);
    const bp = blade.getAttribute('position');
    for (let i = 0; i < bp.count; i++) {
      const v = bp.getY(i) / len;
      bp.setX(i, bp.getX(i) * Math.sin(Math.PI * (v * 0.88 + 0.12)));
      bp.setZ(i, Math.sin(v * 9 + k + bp.getX(i) * 20) * 0.05);
    }
    paint(blade, (_x, y, _z, c) => c.copy(colors.base).lerp(colors.tip, smoothstep(0.1, 1, y / len)));
    blade.rotateZ(-side * rng.range(0.4, 0.8));
    blade.rotateY(rng.range(-0.7, 0.7) + (side > 0 ? 0 : Math.PI));
    blade.translate(bend(y0), y0, 0);
    parts.push(blade);
    const bladder = new SphereGeometry(0.075, 5, 3);
    paint(bladder, (_x, _y, _z, c) => c.copy(colors.tip).multiplyScalar(0.9));
    bladder.translate(bend(y0) + side * 0.07, y0 + 0.02, 0);
    parts.push(bladder);
  }
  for (const p of parts) p.deleteAttribute('uv');
  const geo = mergeParts(parts);
  return sway(geo, () => [ph, 1]);
}

/** A tuft of curved, tapering seagrass blades. */
export function grassTuftGeometry(seed: number, blades: number, colors: PlantColors): BufferGeometry {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  for (let k = 0; k < blades; k++) {
    const h = rng.range(0.45, 1.05);
    const w = rng.range(0.04, 0.07);
    const b = new PlaneGeometry(w, h, 1, 4);
    b.translate(0, h / 2, 0);
    const bend = rng.range(0.08, 0.3);
    const pos = b.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const v = pos.getY(i) / h;
      pos.setX(i, pos.getX(i) * (1 - v * 0.85));
      pos.setZ(i, v * v * bend);
    }
    b.computeVertexNormals();
    paint(b, (_x, y, _z, c) => c.copy(colors.base).lerp(colors.tip, smoothstep(0.15, 1, y / h)).multiplyScalar(lerp(0.55, 1.05, y / h)));
    const phase = rng.range(0, TAU);
    sway(b, (_x, y) => [phase, clamp01(y / h)]);
    b.rotateY(rng.range(0, TAU));
    b.translate(rng.range(-0.14, 0.14), -0.03, rng.range(-0.14, 0.14));
    parts.push(b);
  }
  for (const p of parts) p.deleteAttribute('uv');
  return mergeParts(parts);
}

/** Faceted crystal chunk (ice shards, glassy rocks). */
export function shardGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const geo = new IcosahedronGeometry(1, 0);
  const pos = geo.getAttribute('position');
  const v = new Vector3();
  const sx = rng.range(0.5, 0.9);
  const sy = rng.range(1.2, 2.2);
  const sz = rng.range(0.5, 0.9);
  // Displace unique corners consistently (the geometry is non-indexed).
  const offsets = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let o = offsets.get(key);
    if (o === undefined) {
      o = rng.range(0.75, 1.2);
      offsets.set(key, o);
    }
    v.multiplyScalar(o);
    v.set(v.x * sx, Math.max(v.y * sy, -0.3), v.z * sz);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  return paint(geo, (_x, y, _z, c) => c.setScalar(lerp(0.7, 1.1, smoothstep(-0.3, 1.5, y))));
}
