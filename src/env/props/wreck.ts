import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
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

export interface Mast {
  geo: BufferGeometry;
  /** Yards (spars along local x) a sail or net hangs from: height and half-length. */
  yards: { y: number; half: number }[];
}

/**
 * A lone mast standing up out of the silt, snapped at the top: two yards, a crow's
 * nest and a few slack stays running down to the seabed. About 15 tall.
 */
export function standingMastGeometry(seed: number): Mast {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const h = rng.range(13, 16);
  const mast = new CylinderGeometry(0.2, 0.32, h, 8, 6);
  mast.translate(0, h / 2 - 1, 0);
  const mp = mast.getAttribute('position');
  for (let i = 0; i < mp.count; i++) {
    if (mp.getY(i) > h - 1.2) mp.setY(i, mp.getY(i) - rng.range(0, 0.6));
  }
  mast.computeVertexNormals();
  paint(mast, (_x, y, _z, c) => c.setScalar(lerp(0.5, 0.95, smoothstep(-1, h, y))));
  parts.push(mast);

  const yards = [
    { y: h * 0.56, half: rng.range(3, 3.8) },
    { y: h * 0.84, half: rng.range(2.2, 2.8) },
  ];
  for (const yd of yards) {
    const yard = new CylinderGeometry(0.09, 0.13, yd.half * 2, 6);
    yard.rotateZ(Math.PI / 2 + rng.range(-0.08, 0.08));
    yard.translate(0, yd.y, 0);
    paint(yard, (_x, _y, _z, c) => c.setScalar(0.8));
    parts.push(yard);
  }

  const nestY = h * 0.72;
  const nest = new CylinderGeometry(0.75, 0.6, 0.55, 12, 1, true);
  nest.translate(0, nestY, 0);
  const floor = new CylinderGeometry(0.62, 0.62, 0.08, 12);
  floor.translate(0, nestY - 0.25, 0);
  for (const g of [nest, floor]) {
    paint(g, (_x, _y, _z, c) => c.setScalar(0.7));
    parts.push(g);
  }

  // Slack stays from the masthead down to the seabed.
  const stays = rng.int(2, 3);
  for (let k = 0; k < stays; k++) {
    const side = k % 2 ? 1 : -1;
    const top = new Vector3(0, h * rng.range(0.78, 0.9), 0);
    const foot = new Vector3(side * rng.range(5, 8), -0.4, rng.range(-1.5, 1.5));
    const mid = top.clone().lerp(foot, 0.5);
    mid.y -= rng.range(0.6, 1.4);
    const rope = new TubeGeometry(new CatmullRomCurve3([top, mid, foot]), 16, 0.035, 4, false);
    paint(rope, (_x, _y, _z, c) => c.setScalar(0.45));
    parts.push(rope);
  }
  return { geo: mergeParts(parts), yards };
}

/**
 * A torn sail or net hanging from a yard: width along x, from y = 0 down to -drop,
 * billowing towards +z, with ragged holes and a shredded hem.
 */
export function hangingClothGeometry(seed: number, width: number, drop: number, ragged: number): BufferGeometry {
  const rng = new Rng(seed);
  const noise = createNoise2D(() => rng.next());
  const nu = 14;
  const nv = 12;
  const pos: number[] = [];
  const uv: number[] = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      const sag = Math.sin(u * Math.PI) * 0.35 * v;
      pos.push((u - 0.5) * width * (1 - v * 0.12), -v * drop * (1 - sag * 0.4), Math.sin(u * Math.PI) * v * drop * 0.16 + noise(u * 4, v * 4) * 0.12);
      uv.push(u * width * 0.5, v * drop * 0.5);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const u = (i + 0.5) / nu;
      const v = (j + 0.5) / nv;
      const tear = noise(u * 5 + 3, v * 6) * 0.5 + 0.5;
      if (v > 0.15 && tear < ragged * v) continue;
      if (v > 1 - ragged * 0.6 * (0.5 + 0.5 * Math.sin(u * 23 + seed))) continue;
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
  paint(geo, (x, y, _z, c) => c.setScalar(lerp(0.95, 0.6, -y / drop) * (0.85 + noise(x * 0.7, y * 0.7) * 0.2)));
  const p = geo.getAttribute('position');
  const swayData = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) swayData[i * 2] = seed + p.getX(i) * 0.4;
  for (let i = 0; i < p.count; i++) swayData[i * 2 + 1] = 1;
  geo.setAttribute('aSway', new Float32BufferAttribute(swayData, 2));
  return geo;
}

/** One oval chain link, long axis along x. */
export function chainLinkGeometry(): BufferGeometry {
  const link = new TorusGeometry(0.15, 0.045, 5, 10);
  link.scale(1.55, 1, 1);
  link.deleteAttribute('uv');
  return paint(link, (_x, y, _z, c) => c.setScalar(lerp(0.7, 1, y / 0.2 + 0.5)));
}

/** A mooring buoy in red and white bands, with a lifting ring. Radius 0.75. */
export function buoyGeometry(): BufferGeometry {
  const red = new Color('#c4362a');
  const white = new Color('#ece6da');
  const ball = new SphereGeometry(0.75, 18, 12);
  paint(ball, (_x, y, _z, c) => c.copy(Math.abs(y) < 0.2 ? white : red).multiplyScalar(lerp(0.65, 1, smoothstep(-0.75, 0.5, y))));
  const ring = new TorusGeometry(0.2, 0.05, 5, 10);
  ring.translate(0, -0.85, 0);
  paint(ring, (_x, _y, _z, c) => c.setRGB(0.25, 0.22, 0.2));
  for (const g of [ball, ring]) g.deleteAttribute('uv');
  return mergeParts([ball, ring]);
}

/** Admiralty anchor lying along local x; returns where the chain shackles on. */
export function anchorGeometry(): { geo: BufferGeometry; ring: Vector3 } {
  const parts: BufferGeometry[] = [];
  const shank = new CylinderGeometry(0.1, 0.13, 2.6, 7);
  shank.translate(0, 1.3, 0);
  parts.push(shank);
  const arm = new TubeGeometry(
    new CatmullRomCurve3([new Vector3(-1.1, 0.6, 0), new Vector3(-0.6, 0.1, 0), new Vector3(0, -0.05, 0), new Vector3(0.6, 0.1, 0), new Vector3(1.1, 0.6, 0)]),
    16,
    0.1,
    6,
    false,
  );
  parts.push(arm);
  for (const side of [-1, 1]) {
    const fluke = new ConeGeometry(0.28, 0.6, 4);
    fluke.scale(1, 1, 0.35);
    fluke.rotateZ(-side * 0.65);
    fluke.translate(side * 1.2, 0.78, 0);
    parts.push(fluke);
  }
  const stock = new CylinderGeometry(0.07, 0.07, 2.2, 6);
  stock.rotateX(Math.PI / 2);
  stock.translate(0, 2.35, 0);
  parts.push(stock);
  const ring = new TorusGeometry(0.22, 0.05, 5, 10);
  ring.translate(0, 2.8, 0);
  parts.push(ring);
  for (const p of parts) p.deleteAttribute('uv');
  const geo = mergeParts(parts);
  paint(geo, (_x, y, _z, c) => c.setScalar(lerp(0.6, 0.95, smoothstep(-0.2, 2.8, y))));
  return { geo, ring: new Vector3(0, 3, 0) };
}

/** A small open rowing boat with thwarts, about 4.6 long along x. */
export function rowboatGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const hull = new SphereGeometry(1, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  hull.scale(2.3, 0.75, 0.85);
  const hp = hull.getAttribute('position');
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i);
    const bow = smoothstep(0.3, 2.3, x);
    hp.setZ(i, hp.getZ(i) * (1 - bow * 0.75));
    hp.setY(i, hp.getY(i) + bow * bow * 0.25);
  }
  hull.computeVertexNormals();
  paint(hull, (_x, y, _z, c) => c.setScalar(lerp(0.5, 0.95, smoothstep(-0.75, 0, y))));
  parts.push(hull);
  for (const x of [-0.8, 0.5]) {
    const seat = new BoxGeometry(0.32, 0.07, 1.5 * (1 - smoothstep(0.3, 2.3, x) * 0.6));
    seat.translate(x, -0.18, 0);
    paint(seat, (_x, _y, _z, c) => c.setScalar(0.8));
    parts.push(seat);
  }
  const rim: Vector3[] = [];
  for (let s = 0; s <= 24; s++) {
    const a = (s / 24) * Math.PI * 2;
    const x = Math.cos(a) * 2.3;
    const bow = smoothstep(0.3, 2.3, x);
    rim.push(new Vector3(x, bow * bow * 0.25, Math.sin(a) * 0.85 * (1 - bow * 0.75)));
  }
  const gunwale = new TubeGeometry(new CatmullRomCurve3(rim, true), 48, 0.06, 4, true);
  paint(gunwale, (_x, _y, _z, c) => c.setScalar(0.7));
  parts.push(gunwale);
  if (rng.chance(0.6)) {
    const oar = new CylinderGeometry(0.04, 0.04, 3.2, 5);
    oar.rotateZ(Math.PI / 2 - 0.15);
    oar.rotateY(rng.range(-0.4, 0.4));
    oar.translate(0, -0.1, 0.3);
    paint(oar, (_x, _y, _z, c) => c.setScalar(0.85));
    parts.push(oar);
  }
  return mergeParts(parts);
}

/** A cast-iron cannon barrel lying along local x, about 2.3 long. */
export function cannonGeometry(): BufferGeometry {
  const prof = [
    new Vector2(0.001, -0.2),
    new Vector2(0.12, -0.18),
    new Vector2(0.14, -0.08),
    new Vector2(0.3, 0),
    new Vector2(0.34, 0.08),
    new Vector2(0.31, 0.4),
    new Vector2(0.27, 1.3),
    new Vector2(0.24, 1.9),
    new Vector2(0.29, 2.0),
    new Vector2(0.27, 2.1),
    new Vector2(0.13, 2.1),
    new Vector2(0.13, 1.6),
  ];
  const geo = new LatheGeometry(prof, 14);
  geo.rotateZ(-Math.PI / 2);
  geo.translate(-1, 0, 0);
  geo.deleteAttribute('uv');
  return paint(geo, (x, _y, _z, c) => c.setScalar(x > 0.85 && x < 1.15 ? 0.5 : 0.85));
}

/** A small pyramid of cannonballs. */
export function cannonballPileGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const r = 0.17;
  const layers = rng.int(2, 3);
  for (let l = 0; l < layers; l++) {
    const n = layers - l;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (rng.chance(0.12)) continue;
        const b = new SphereGeometry(r, 8, 6);
        b.translate((i - (n - 1) / 2) * r * 2, r + l * r * 1.45, (j - (n - 1) / 2) * r * 2);
        b.deleteAttribute('uv');
        paint(b, (_x, _y, _z, c) => c.setScalar(rng.range(0.7, 0.95)));
        parts.push(b);
      }
    }
  }
  return mergeParts(parts);
}
