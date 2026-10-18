import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Float32BufferAttribute,
  TubeGeometry,
  Vector3,
} from 'three';
import { createNoise2D } from 'simplex-noise';
import { Rng } from '../../engine/rng';
import { lerp, smoothstep } from '../../engine/math';
import { mergeParts, paint } from './shapes';

const L = 26;
const B = 3.3;
const D = 3.8;

function hullWidth(u: number): number {
  if (u < 0.12) return B * lerp(0.8, 0.96, u / 0.12);
  if (u < 0.55) return B;
  const t = (u - 0.55) / 0.45;
  return B * Math.pow(Math.max(0, 1 - t * t), 0.55) + 0.06;
}

function hullDepth(u: number): number {
  if (u < 0.08) return D * lerp(0.82, 1, u / 0.08);
  return D * lerp(1, 0.5, smoothstep(0.72, 1, u));
}

function sheer(u: number): number {
  return 0.55 * Math.pow(2 * u - 1, 2) + Math.max(0, u - 0.86) * 4;
}

function sectionPoint(u: number, v: number, inset = 1): Vector3 {
  const th = (v - 0.5) * Math.PI;
  return new Vector3(
    u * L - L / 2,
    sheer(u) - hullDepth(u) * inset * Math.pow(Math.cos(th), 0.55),
    Math.sin(th) * hullWidth(u) * inset,
  );
}

/** Planked hull shell with jagged holes torn in the side facing the camera. */
function hullShell(rng: Rng): BufferGeometry {
  const nu = 56;
  const nv = 20;
  const noise = createNoise2D(() => rng.next());
  const pos: number[] = [];
  const uv: number[] = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const p = sectionPoint(i / nu, j / nv);
      pos.push(p.x, p.y, p.z);
      uv.push(((i / nu) * L) / 5, (j / nv) * 3.2);
    }
  }
  const holes = [
    { u0: 0.3, u1: 0.46, v0: 0.58, v1: 0.93 },
    { u0: 0.7, u1: 0.77, v0: 0.66, v1: 0.86 },
  ];
  const index: number[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const u = (i + 0.5) / nu;
      const v = (j + 0.5) / nv;
      const torn = holes.some((h) => {
        const n = noise(u * 30, v * 12) * 0.035;
        return u > h.u0 + n && u < h.u1 - n && v > h.v0 + n * 1.5 && v < h.v1 - n;
      });
      if (torn) continue;
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 1;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** Builds the full wreck (hull, ribs, beams, mast, cabin) as one geometry. */
export function shipwreckGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const shell = hullShell(rng);
  paint(shell, (x, y, _z, c) => {
    const keel = smoothstep(-D * 1.05, -D * 0.35, y);
    const ends = 1 - smoothstep(L * 0.38, L * 0.5, Math.abs(x)) * 0.2;
    c.setScalar(lerp(0.45, 1, keel) * ends);
  });
  parts.push(shell);

  // Ribs, visible through the holes and poking out where the hull has broken off.
  for (let k = 0; k < 9; k++) {
    const u = 0.26 + k * 0.03;
    const extra = k % 3 === 1 ? 0.2 : 0.06;
    const pts: Vector3[] = [];
    for (let s = 0; s <= 10; s++) {
      const v = lerp(-extra, 1 + extra * 0.4, s / 10);
      const p = sectionPoint(u, Math.min(Math.max(v, 0), 1), 0.95);
      if (v < 0) p.y += -v * 3.5;
      if (v > 1) p.y += (v - 1) * 3.5;
      pts.push(p);
    }
    const tube = new TubeGeometry(new CatmullRomCurve3(pts), 18, 0.11, 5, false);
    paint(tube, (_x, y, _z, c) => c.setScalar(lerp(0.4, 0.8, smoothstep(-D, 0, y))));
    parts.push(tube);
  }

  // Deck beams across the hull, some missing.
  for (let k = 0; k < 12; k++) {
    if (rng.chance(0.3)) continue;
    const u = 0.14 + k * 0.058;
    const w = hullWidth(u) * 2 * 0.96;
    const beam = new BoxGeometry(0.34, 0.24, w);
    const y = sheer(u) - 0.35;
    beam.rotateX(rng.range(-0.06, 0.06));
    beam.translate(u * L - L / 2, y, 0);
    paint(beam, (_x, _y, _z, c) => c.setScalar(0.9));
    parts.push(beam);
  }

  // Bow deck planks.
  const deck = new BoxGeometry(L * 0.22, 0.14, B * 1.7);
  deck.translate(L * 0.19, sheer(0.72) - 0.3, 0);
  paint(deck, (_x, _y, _z, c) => c.setScalar(0.85));
  parts.push(deck);

  // Stern cabin.
  const cabin = new BoxGeometry(4.6, 2.3, B * 1.6);
  cabin.translate(-L / 2 + 3.2, sheer(0.1) + 0.8, 0);
  paint(cabin, (_x, y, _z, c) => c.setScalar(lerp(0.6, 1, smoothstep(-0.5, 2, y))));
  parts.push(cabin);

  // Broken main mast with a yard.
  const mastH = 12;
  const mast = new CylinderGeometry(0.2, 0.3, mastH, 8, 4);
  mast.translate(0, mastH / 2, 0);
  const yard = new CylinderGeometry(0.1, 0.13, 7, 6);
  yard.rotateZ(Math.PI / 2);
  yard.rotateY(0.5);
  yard.translate(0, mastH * 0.72, 0);
  for (const m of [mast, yard]) {
    paint(m, (_x, y, _z, c) => c.setScalar(lerp(0.55, 0.95, y / mastH)));
    m.rotateZ(-0.42);
    m.rotateX(0.2);
    m.translate(L * 0.08, sheer(0.58) - 1.5, 0);
    parts.push(m);
  }

  return mergeParts(parts);
}

/** Barrel with iron bands; roughly 1 unit tall. */
export function barrelGeometry(): BufferGeometry {
  const geo = new CylinderGeometry(0.42, 0.42, 1, 14, 8);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const bulge = 1 + Math.cos(y * Math.PI) * 0.12;
    pos.setX(i, pos.getX(i) * bulge);
    pos.setZ(i, pos.getZ(i) * bulge);
  }
  geo.computeVertexNormals();
  return paint(geo, (_x, y, _z, c) => {
    const band = Math.abs(Math.abs(y) - 0.32) < 0.05 || Math.abs(y) > 0.47;
    c.setScalar(band ? 0.3 : 1);
  });
}

export function crateGeometry(): BufferGeometry {
  const geo = new BoxGeometry(1, 1, 1, 1, 1, 1);
  return paint(geo, (_x, y, _z, c) => c.setScalar(lerp(0.65, 1, y + 0.5)));
}

export const WRECK_LENGTH = L;
export const WRECK_DEPTH = D;
