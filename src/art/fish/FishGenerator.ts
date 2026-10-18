import {
  BufferGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { isHero, type FinDef, type SpeciesDef } from '../../config/species';
import { clamp, clamp01, lerp, smoothstep } from '../../engine/math';

export type FinKind = 'caudal' | 'dorsal' | 'dorsal2' | 'anal';

export interface FinPoly {
  kind: FinKind;
  /** Closed outline used for geometry and painting. */
  outline: Vector2[];
  /** Ray start/end pairs for painting. */
  rays: [Vector2, Vector2][];
  root: Vector2;
  tip: Vector2;
}

export interface PairedFin {
  kind: 'pectoral' | 'pelvic';
  /** Local outline: a runs backward (negative), b across the fin. */
  outline: Vector2[];
  len: number;
  width: number;
  anchor: Vector3;
  drop: number;
  outward: number;
}

export interface Swatch {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface FishLayout {
  def: SpeciesDef;
  noseX: number;
  tailTipX: number;
  bodyEndX: number;
  bodyLen: number;
  H: number;
  xAt(tn: number): number;
  tnAt(x: number): number;
  upper(tn: number): number;
  lower(tn: number): number;
  center(tn: number): number;
  halfWidth(tn: number): number;
  eye: { x: number; y: number; r: number; z: number };
  jaw: { hingeX: number; hingeY: number; tipX: number; tipY: number; maxAngle: number };
  fins: FinPoly[];
  paired: PairedFin[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Half body height at the widest point (unit-length fish). */
  radius: number;
  tex: { width: number; height: number; bodyH: number; stripH: number };
  swatch: { fin: Swatch; white: Swatch; glow: Swatch; dark: Swatch };
  lure?: { points: Vector3[]; bulb: Vector3; bulbR: number };
  fangs: { x: number; y: number; z: number; len: number; up: boolean }[];
  barbel?: { x: number; y: number; len: number };
}

const NOSE_X = 0.5;
const TAIL_TIP_X = -0.5;

/** `texScale` multiplies the painted texture resolution (1: 512 wide, 1024 for big fish). */
export function buildLayout(def: SpeciesDef, texScale = 1): FishLayout {
  const b = def.body;
  const H = b.height;
  const bodyEndX = TAIL_TIP_X + def.tail.size;
  const bodyLen = NOSE_X - bodyEndX;
  const hump = clamp(b.hump, 0.15, 0.7);
  const humpLow = clamp(hump + 0.04, 0.15, 0.8);
  // Capped at 1: a higher exponent makes the head concave and the snout a thin needle.
  const frontExp = Math.min(1, lerp(1.45, 0.42, clamp01((b.bluntness - 0.4) / 0.95)));

  const env = (tn: number, hp: number): number => {
    tn = clamp01(tn);
    if (tn <= hp) return Math.pow(Math.sin((tn / hp) * Math.PI * 0.5), frontExp);
    const u = (tn - hp) / (1 - hp);
    return b.peduncle + (1 - b.peduncle) * Math.pow(Math.cos(u * Math.PI * 0.5), 1.35);
  };
  const rawUpper = (tn: number): number => env(tn, hump) * H * 0.5;
  const rawLower = (tn: number): number => env(tn, humpLow) * H * 0.5 * b.belly;
  const rawCenter = (tn: number): number => b.snout * H * (1 - smoothstep(0, 0.45, tn));

  let yMax = -Infinity;
  let yMin = Infinity;
  for (let i = 0; i <= 64; i++) {
    const tn = i / 64;
    yMax = Math.max(yMax, rawCenter(tn) + rawUpper(tn));
    yMin = Math.min(yMin, rawCenter(tn) - rawLower(tn));
  }
  const yShift = -(yMax + yMin) * 0.5;

  const xAt = (tn: number): number => NOSE_X - tn * bodyLen;
  const tnAt = (x: number): number => clamp01((NOSE_X - x) / bodyLen);
  const upper = rawUpper;
  const lower = rawLower;
  const center = (tn: number): number => rawCenter(tn) + yShift;
  // A hammerhead's cephalofoil: the head flares out sideways into a flat blade.
  const hammer = def.special?.includes('hammer') ? 1 : 0;
  // The tail stalk is flattened side to side so the body blends into the flat tail fin
  // instead of ending in a round stub.
  const halfWidth = (tn: number): number =>
    Math.pow(env(tn, hump), 0.85) * H * 0.5 * b.width * (1 - 0.7 * smoothstep(0.78, 1, tn)) +
    hammer * H * 0.62 * Math.exp(-(((tn - 0.06) / 0.05) ** 2));

  // Eye: kept inside the head outline, or it sits on a thin snout like a bead.
  const et = def.eye.t;
  const eyeX = xAt(et);
  const localH = upper(et) + lower(et);
  const eyeR = Math.min(def.eye.size * H * 0.5, Math.min(upper(et), lower(et)) * 0.8);
  const eyeY = clamp(center(et) + def.eye.y * localH, center(et) - lower(et) + eyeR * 1.2, center(et) + upper(et) - eyeR * 1.2);
  const rel = (eyeY - center(et)) / (eyeY > center(et) ? upper(et) : lower(et));
  const zSurf = halfWidth(et) * Math.sqrt(Math.max(0.05, 1 - rel * rel));
  const eye = { x: eyeX, y: eyeY, r: eyeR, z: Math.max(0.002, zSurf - eyeR * 0.3) };

  // Jaw
  const mouthLen = (def.mouth ?? 0.13) * 1.0;
  const hingeX = NOSE_X - mouthLen;
  const hingeTn = tnAt(hingeX);
  const tipY = center(0.01) - lower(0.02) * 0.4;
  const hingeY = center(hingeTn) - lower(hingeTn) * 0.28;
  const jaw = { hingeX, hingeY, tipX: NOSE_X, tipY, maxAngle: def.id === 'gulp' ? 0.78 : def.id === 'greatWhite' ? 0.7 : isHero(def) ? 0.62 : 0.55 };

  const layout: FishLayout = {
    def,
    noseX: NOSE_X,
    tailTipX: TAIL_TIP_X,
    bodyEndX,
    bodyLen,
    H,
    xAt,
    tnAt,
    upper,
    lower,
    center,
    halfWidth,
    eye,
    jaw,
    fins: [],
    paired: [],
    bounds: { minX: TAIL_TIP_X, maxX: NOSE_X, minY: 0, maxY: 0 },
    radius: Math.max(upper(hump), lower(humpLow)),
    tex: { width: 512, height: 256, bodyH: 224, stripH: 32 },
    swatch: {
      fin: { u0: 0, v0: 0, u1: 0, v1: 0 },
      white: { u0: 0, v0: 0, u1: 0, v1: 0 },
      glow: { u0: 0, v0: 0, u1: 0, v1: 0 },
      dark: { u0: 0, v0: 0, u1: 0, v1: 0 },
    },
    fangs: [],
  };

  const sharkish = def.tail.shape === 'shark';
  layout.fins.push(caudalFin(layout));
  if (def.dorsal) layout.fins.push(medianFin(layout, def.dorsal, 'dorsal', true, sharkish));
  if (def.dorsal2) layout.fins.push(medianFin(layout, def.dorsal2, 'dorsal2', true, sharkish));
  if (def.anal) layout.fins.push(medianFin(layout, def.anal, 'anal', false, sharkish));

  // Paired fins
  const pt = def.pectoral.t ?? clamp(def.eye.t + 0.14, 0.1, 0.5);
  const pLen = def.pectoral.size * 0.62;
  layout.paired.push({
    kind: 'pectoral',
    outline: paddleOutline(pLen, pLen * (sharkish ? 0.42 : 0.55), def.special?.includes('spines') ?? false),
    len: pLen,
    width: pLen * (sharkish ? 0.42 : 0.55),
    anchor: new Vector3(xAt(pt), center(pt) - lower(pt) * (sharkish ? 0.55 : 0.3), halfWidth(pt) * 0.78),
    drop: sharkish ? 0.55 : 0.12,
    outward: sharkish ? 0.35 : 0.28,
  });
  if (def.pelvic) {
    const vt = clamp(pt + 0.1, 0.1, 0.7);
    const vLen = def.pelvic.size * 0.6;
    layout.paired.push({
      kind: 'pelvic',
      outline: paddleOutline(vLen, vLen * 0.45, false),
      len: vLen,
      width: vLen * 0.45,
      anchor: new Vector3(xAt(vt), center(vt) - lower(vt) * 0.9, halfWidth(vt) * 0.3),
      drop: 0.75,
      outward: 0.22,
    });
  }

  // Specials
  const sp = def.special ?? [];
  if (sp.includes('fangs')) {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const x = lerp(hingeX + mouthLen * 0.15, NOSE_X - 0.01, u);
      const my = lerp(hingeY, tipY, (x - hingeX) / (NOSE_X - hingeX));
      const tn = tnAt(x);
      // On the lip surface: deeper inside the body they are never seen.
      const rel = (my - center(tn)) / (my > center(tn) ? upper(tn) : lower(tn));
      const z = halfWidth(tn) * Math.sqrt(Math.max(0.05, 1 - rel * rel)) * 0.95;
      const len = H * (0.08 + 0.13 * Math.sin(u * Math.PI)) * (def.id === 'anglerfish' ? 1.3 : def.id === 'viperfish' ? 1.8 : def.id === 'greatWhite' ? 0.9 : 1);
      layout.fangs.push({ x, y: my + len * 0.25, z, len, up: false });
      layout.fangs.push({ x: x - 0.01, y: my - len * 0.25, z, len: len * 0.8, up: true });
    }
  }
  if (sp.includes('lure')) {
    const baseTn = 0.12;
    const bx = xAt(baseTn);
    const by = center(baseTn) + upper(baseTn) * 0.95;
    const pts = [
      new Vector3(bx, by, 0),
      new Vector3(bx + 0.05, by + H * 0.35, 0),
      new Vector3(NOSE_X + 0.04, by + H * 0.42, 0),
      new Vector3(NOSE_X + 0.1, by + H * 0.22, 0),
    ];
    layout.lure = { points: pts, bulb: pts[3].clone(), bulbR: H * 0.07 };
  }
  if (sp.includes('barbel')) {
    layout.barbel = { x: xAt(0.06), y: center(0.06) - lower(0.06) * 0.9, len: H * 0.3 };
  }

  // Bounds for the side projection (body + median fins).
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i <= 64; i++) {
    const tn = i / 64;
    maxY = Math.max(maxY, center(tn) + upper(tn));
    minY = Math.min(minY, center(tn) - lower(tn));
  }
  for (const f of layout.fins) {
    for (const p of f.outline) {
      maxY = Math.max(maxY, p.y);
      minY = Math.min(minY, p.y);
    }
  }
  if (layout.lure) {
    for (const p of layout.lure.points) maxY = Math.max(maxY, p.y + layout.lure.bulbR);
  }
  let maxX = NOSE_X;
  if (layout.lure) maxX = Math.max(maxX, layout.lure.bulb.x + layout.lure.bulbR);
  const pad = 0.01;
  layout.bounds = { minX: TAIL_TIP_X - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };

  const big = def.tier >= 4 || isHero(def);
  const W = (big ? 1024 : 512) * texScale;
  const dx = layout.bounds.maxX - layout.bounds.minX;
  const dy = layout.bounds.maxY - layout.bounds.minY;
  const bodyH = clamp(Math.round((W * dy) / dx), 48, 1024 * texScale);
  const stripH = Math.max(24, Math.round(W * 0.05));
  layout.tex = { width: W, height: bodyH + stripH, bodyH, stripH };
  const sf = stripH / (bodyH + stripH);
  layout.swatch = {
    fin: { u0: 0.02, v0: sf * 0.12, u1: 0.46, v1: sf * 0.88 },
    white: { u0: 0.52, v0: sf * 0.2, u1: 0.64, v1: sf * 0.8 },
    glow: { u0: 0.7, v0: sf * 0.2, u1: 0.82, v1: sf * 0.8 },
    dark: { u0: 0.88, v0: sf * 0.2, u1: 0.98, v1: sf * 0.8 },
  };
  return layout;
}

function paddleOutline(len: number, w: number, spiky: boolean): Vector2[] {
  const pts: Vector2[] = [];
  if (spiky) {
    const rays = 9;
    pts.push(new Vector2(0, w * 0.2));
    for (let i = 0; i <= rays; i++) {
      const t = i / rays;
      const ang = lerp(0.9, -0.9, t);
      const r = len * (i % 2 === 0 ? 1 : 0.72);
      pts.push(new Vector2(-Math.cos(ang) * r, Math.sin(ang) * r * 0.8));
    }
    pts.push(new Vector2(0, -w * 0.2));
    return pts;
  }
  const s = new Shape();
  s.moveTo(0, w * 0.28);
  s.quadraticCurveTo(-len * 0.45, w * 0.62, -len, w * 0.12);
  s.quadraticCurveTo(-len * 1.02, -w * 0.18, -len * 0.82, -w * 0.32);
  s.quadraticCurveTo(-len * 0.4, -w * 0.42, 0, -w * 0.22);
  s.closePath();
  return s.getPoints(6);
}

function medianFin(L: FishLayout, fin: FinDef, kind: FinKind, top: boolean, sharkish: boolean): FinPoly {
  const n = fin.spiky ? Math.max(8, Math.round((fin.end - fin.start) * 30)) : 10;
  const baseLen = (fin.end - fin.start) * L.bodyLen;
  const height = fin.height * L.H;
  const sweep = (fin.sweep ?? 0.25) * baseLen;
  const sign = top ? 1 : -1;
  const endH = sharkish || (fin.sweep ?? 0) >= 0.5 ? 0.08 : 0.45;
  const base: Vector2[] = [];
  const edge: Vector2[] = [];
  const rays: [Vector2, Vector2][] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const tn = lerp(fin.start, fin.end, u);
    const surfaceY = L.center(tn) + sign * (top ? L.upper(tn) : L.lower(tn));
    const inside = L.center(tn) + sign * (top ? L.upper(tn) : L.lower(tn)) * 0.8;
    const rise = Math.sin(Math.min(1, u / 0.3) * Math.PI * 0.5);
    let h = rise * (1 - (1 - endH) * smoothstep(0.3, 1, u));
    if (fin.spiky) h *= i % 2 === 0 ? 1 : 0.6;
    const bx = L.xAt(tn);
    const ex = bx - sweep * (0.25 + 0.75 * h);
    base.push(new Vector2(bx, inside));
    const e = new Vector2(ex, surfaceY + sign * Math.max(0.004, h * height));
    edge.push(e);
    rays.push([new Vector2(bx, surfaceY), e]);
  }
  const outline = [...base, ...edge.slice().reverse()];
  if (!top) outline.reverse();
  const mid = Math.floor(n * 0.3);
  return { kind, outline, rays, root: base[mid].clone(), tip: edge[mid].clone() };
}

function caudalFin(L: FishLayout): FinPoly {
  const def = L.def;
  const size = def.tail.size;
  const x0 = L.bodyEndX + 0.04;
  const yc = L.center(1);
  const ph = Math.max((L.upper(1) + L.lower(1)) * 0.5 * 1.15, L.H * 0.04);
  const spread = def.tail.spread * L.H * 0.5;
  const tip = TAIL_TIP_X;
  const s = new Shape();
  switch (def.tail.shape) {
    case 'forked':
      s.moveTo(x0, yc + ph);
      s.quadraticCurveTo(tip + size * 0.35, yc + spread * 0.55, tip, yc + spread);
      s.quadraticCurveTo(tip + size * 0.3, yc + spread * 0.4, tip + size * 0.55, yc);
      s.quadraticCurveTo(tip + size * 0.3, yc - spread * 0.4, tip, yc - spread);
      s.quadraticCurveTo(tip + size * 0.35, yc - spread * 0.55, x0, yc - ph);
      break;
    case 'lunate':
      s.moveTo(x0, yc + ph);
      s.quadraticCurveTo(tip + size * 0.5, yc + spread * 0.7, tip, yc + spread);
      s.quadraticCurveTo(tip + size * 0.42, yc + spread * 0.25, tip + size * 0.34, yc);
      s.quadraticCurveTo(tip + size * 0.42, yc - spread * 0.25, tip, yc - spread);
      s.quadraticCurveTo(tip + size * 0.5, yc - spread * 0.7, x0, yc - ph);
      break;
    case 'round':
      s.moveTo(x0, yc + ph);
      s.bezierCurveTo(tip + size * 0.35, yc + spread * 1.05, tip - size * 0.05, yc + spread * 0.6, tip, yc);
      s.bezierCurveTo(tip - size * 0.05, yc - spread * 0.6, tip + size * 0.35, yc - spread * 1.05, x0, yc - ph);
      break;
    case 'truncate':
      s.moveTo(x0, yc + ph);
      s.quadraticCurveTo(tip + size * 0.45, yc + spread * 0.8, tip + size * 0.04, yc + spread);
      s.quadraticCurveTo(tip + size * 0.12, yc, tip + size * 0.04, yc - spread);
      s.quadraticCurveTo(tip + size * 0.45, yc - spread * 0.8, x0, yc - ph);
      break;
    case 'shark':
      s.moveTo(x0, yc + ph);
      s.quadraticCurveTo(tip + size * 0.55, yc + spread * 0.55, tip, yc + spread * 1.05);
      s.quadraticCurveTo(tip + size * 0.2, yc + spread * 0.5, tip + size * 0.42, yc + spread * 0.02);
      s.quadraticCurveTo(tip + size * 0.38, yc - spread * 0.25, tip + size * 0.52, yc - spread * 0.62);
      s.quadraticCurveTo(tip + size * 0.72, yc - spread * 0.3, x0, yc - ph);
      break;
  }
  s.closePath();
  const outline = s.getPoints(8);
  const root = new Vector2(x0 - 0.01, yc);
  const rays: [Vector2, Vector2][] = [];
  for (const p of outline) {
    if (p.x < x0 - size * 0.25) rays.push([root.clone(), p.clone()]);
  }
  return { kind: 'caudal', outline, rays, root, tip: new Vector2(tip, yc) };
}

function uvOf(L: FishLayout, x: number, y: number, out: number[]): void {
  const { minX, maxX, minY, maxY } = L.bounds;
  const sf = L.tex.stripH / L.tex.height;
  out.push((x - minX) / (maxX - minX), sf + ((y - minY) / (maxY - minY)) * (1 - sf));
}

function swatchUv(sw: { u0: number; v0: number; u1: number; v1: number }, a: number, b: number): [number, number] {
  return [lerp(sw.u0, sw.u1, clamp01(a)), lerp(sw.v0, sw.v1, clamp01(b))];
}

/**
 * x: signed rotation weight (lower jaw opens down, upper jaw lifts a little).
 * y: which side of the mouth line the vertex is on (sign) times the jaw weight, so the
 * mouth interior only darkens across the mouth line and never along the jaw boundary.
 */
function jawFor(L: FishLayout, x: number, y: number): [number, number] {
  const { hingeX, hingeY, tipX, tipY } = L.jaw;
  const my = x <= hingeX ? hingeY : lerp(hingeY, tipY, clamp01((x - hingeX) / (tipX - hingeX)));
  const side = y < my ? 1 : -1;
  if (x <= hingeX) return [0, side * 1e-4];
  const w = Math.pow(smoothstep(hingeX, tipX, x), 0.6);
  return [side > 0 ? w : -0.3 * w, side * Math.max(w, 1e-4)];
}

function withAttributes(geo: BufferGeometry, uv: number[], jaw: number[], flap?: number[]): BufferGeometry {
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.setAttribute('aJaw', new Float32BufferAttribute(jaw, 2));
  if (flap) geo.setAttribute('aFlap', new Float32BufferAttribute(flap, 1));
  return geo;
}

/** Projected UVs for any piece that should pick up the painted side view. */
function projectPiece(L: FishLayout, geo: BufferGeometry, jawFollow: boolean): BufferGeometry {
  const pos = geo.getAttribute('position');
  const uv: number[] = [];
  const jaw: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    uvOf(L, x, y, uv);
    const j = jawFollow ? jawFor(L, x, y) : [0, 0];
    jaw.push(j[0], j[1]);
  }
  return withAttributes(geo, uv, jaw);
}

function swatchPiece(geo: BufferGeometry, sw: Swatch, jawValue: [number, number] = [0, 0]): BufferGeometry {
  const count = geo.getAttribute('position').count;
  const uv: number[] = [];
  const jaw: number[] = [];
  const src = geo.getAttribute('uv');
  for (let i = 0; i < count; i++) {
    const [u, v] = swatchUv(sw, src ? src.getX(i) : 0.5, src ? src.getY(i) : 0.5);
    uv.push(u, v);
    jaw.push(jawValue[0], jawValue[1]);
  }
  return withAttributes(geo, uv, jaw);
}

export function buildBodyGeometry(L: FishLayout): BufferGeometry {
  const NR = 38;
  const NS = 22;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < NR; i++) {
    const tn = 0.5 - 0.5 * Math.cos((Math.PI * i) / (NR - 1));
    const x = L.xAt(tn);
    const up = L.upper(tn);
    const lo = L.lower(tn);
    const c = L.center(tn);
    const hw = L.halfWidth(tn);
    for (let j = 0; j < NS; j++) {
      const phi = (j / NS) * Math.PI * 2;
      const cy = Math.cos(phi);
      const sz = Math.sin(phi);
      const y = c + (cy >= 0 ? up : lo) * cy;
      const z = hw * sz * (1 + 0.1 * (1 - cy * cy));
      pos.push(x, y, z);
    }
  }
  const cap = NR * NS;
  pos.push(L.xAt(1) - 0.006, L.center(1), 0);
  for (let i = 0; i < NR - 1; i++) {
    for (let j = 0; j < NS; j++) {
      const a = i * NS + j;
      const b = i * NS + ((j + 1) % NS);
      const c = (i + 1) * NS + j;
      const d = (i + 1) * NS + ((j + 1) % NS);
      idx.push(a, c, b, b, c, d);
    }
  }
  const last = (NR - 1) * NS;
  for (let j = 0; j < NS; j++) idx.push(last + j, cap, last + ((j + 1) % NS));

  const body = new BufferGeometry();
  body.setAttribute('position', new Float32BufferAttribute(pos, 3));
  body.setIndex(idx);
  body.computeVertexNormals();
  projectPiece(L, body, true);

  const pieces: BufferGeometry[] = [body];
  for (const side of [1, -1]) {
    const eye = new SphereGeometry(L.eye.r, 16, 12);
    eye.applyMatrix4(new Matrix4().makeScale(1, 1, 0.72));
    eye.applyMatrix4(new Matrix4().makeTranslation(L.eye.x, L.eye.y, side * L.eye.z));
    pieces.push(projectPiece(L, eye, false));
  }
  for (const f of L.fangs) {
    for (const side of [1, -1]) {
      const cone = new ConeGeometry(f.len * 0.22, f.len, 5, 1);
      cone.applyMatrix4(new Matrix4().makeRotationZ(f.up ? 0 : Math.PI));
      cone.applyMatrix4(new Matrix4().makeTranslation(f.x, f.y, side * f.z));
      const j = jawFor(L, f.x, f.up ? L.jaw.hingeY - 1 : L.jaw.hingeY + 1);
      pieces.push(swatchPiece(cone, L.swatch.white, [j[0], j[1]]));
    }
  }
  if (L.lure) {
    const curve = new CatmullRomCurve3(L.lure.points);
    const stalk = new TubeGeometry(curve, 14, L.H * 0.018, 5, false);
    pieces.push(swatchPiece(stalk, L.swatch.dark));
    const bulb = new SphereGeometry(L.lure.bulbR, 12, 10);
    bulb.applyMatrix4(new Matrix4().makeTranslation(L.lure.bulb.x, L.lure.bulb.y, L.lure.bulb.z));
    pieces.push(swatchPiece(bulb, L.swatch.glow));
  }
  if (L.barbel) {
    const cone = new ConeGeometry(L.H * 0.02, L.barbel.len, 4, 1);
    cone.applyMatrix4(new Matrix4().makeRotationZ(Math.PI * 0.92));
    cone.applyMatrix4(new Matrix4().makeTranslation(L.barbel.x, L.barbel.y - L.barbel.len * 0.4, 0));
    pieces.push(swatchPiece(cone, L.swatch.fin, jawFor(L, L.barbel.x, L.jaw.hingeY - 1)));
  }
  const merged = mergeGeometries(pieces.map((g) => stripTo(g, ['position', 'normal', 'uv', 'aJaw'])), false)!;
  for (const p of pieces) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

export function buildFinGeometry(L: FishLayout): BufferGeometry {
  const pieces: BufferGeometry[] = [];
  for (const f of L.fins) {
    const shape = new Shape(f.outline);
    const geo = new ShapeGeometry(shape, 4);
    const pos = geo.getAttribute('position');
    const uv: number[] = [];
    const jaw: number[] = [];
    const flap: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      uvOf(L, pos.getX(i), pos.getY(i), uv);
      jaw.push(0, 0);
      flap.push(0);
    }
    pieces.push(withAttributes(geo, uv, jaw, flap));
  }
  for (const p of L.paired) {
    for (const side of [1, -1] as const) {
      const geo = new ShapeGeometry(new Shape(p.outline), 3);
      const pos = geo.getAttribute('position');
      const uv: number[] = [];
      const jaw: number[] = [];
      const flap: number[] = [];
      for (let i = 0; i < pos.count; i++) {
        const a = pos.getX(i);
        const bb = pos.getY(i);
        const back = -a;
        const x = p.anchor.x + a * (1 - p.drop * 0.25);
        const y = p.anchor.y + bb * 0.75 - back * p.drop;
        const z = side * (p.anchor.z + back * p.outward + bb * 0.12);
        pos.setXYZ(i, x, y, z);
        const [u, v] = swatchUv(L.swatch.fin, back / p.len, bb / p.width + 0.5);
        uv.push(u, v);
        jaw.push(0, 0);
        flap.push(clamp01(back / p.len));
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      pieces.push(withAttributes(geo, uv, jaw, flap));
    }
  }
  const merged = mergeGeometries(
    pieces.map((g) => stripTo(g, ['position', 'normal', 'uv', 'aJaw', 'aFlap'])),
    false,
  )!;
  for (const p of pieces) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

function stripTo(geo: BufferGeometry, keep: string[]): BufferGeometry {
  for (const name of Object.keys(geo.attributes)) {
    if (!keep.includes(name)) geo.deleteAttribute(name);
  }
  if (!geo.index) {
    const count = geo.getAttribute('position').count;
    const index: number[] = [];
    for (let i = 0; i < count; i++) index.push(i);
    geo.setIndex(index);
  }
  return geo;
}
