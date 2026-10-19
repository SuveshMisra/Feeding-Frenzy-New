import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector2,
  type Object3D,
} from 'three';
import type { BiomeDef, CreatureKind, LevelDef } from '../config/levels';
import { patchMaterial } from '../engine/materialPatches';
import { Rng } from '../engine/rng';
import { clamp, lerp, smoothstep, TAU } from '../engine/math';
import { mergeParts, paint } from './props/shapes';
import type { EnvLayer } from './Environment';
import { swimHeights, type ObstacleMap } from './Obstacles';

/** A hinged part: rotates about one local axis around `base`. */
interface Joint {
  obj: Object3D;
  axis: 'x' | 'y' | 'z';
  base: number;
  amp: number;
  /** Phase offset in cycles. */
  lag: number;
}

interface Rig {
  root: Group;
  joints: Joint[];
  /** Flaps per second. */
  freq: number;
}

/**
 * A closed swim loop sampled every `step`: out along one leg weaving between props, a U-turn
 * short of the level's end wall, back along a leg further out and another U-turn.
 */
interface Loop {
  x: Float32Array;
  z: Float32Array;
  /** Heading when swum forwards: 0 faces +x, PI/2 faces away from the camera. */
  yaw: Float32Array;
  heights: Float32Array;
  step: number;
  length: number;
}

interface Creature extends Rig {
  /** Start distance along the loop. */
  s0: number;
  /** Negative swims the loop backwards. */
  speed: number;
  bob: number;
  phase: number;
  /** Roll towards the camera so wings and shells don't sit edge-on. */
  bank: number;
  loop: Loop;
}

interface Habit {
  z: [number, number];
  y: [number, number];
  speed: [number, number];
  scale: [number, number];
  bank: number;
  /** Half extents at scale 1 (length, depth, height), banked and flapping. */
  body: [number, number, number];
}

/** Where each kind swims: depth band (z), height as a share of the water, speed, size. */
const HABITS: Record<CreatureKind, Habit> = {
  turtle: { z: [-18, -10], y: [0.35, 0.8], speed: [1.1, 1.6], scale: [1.1, 1.5], bank: 0.35, body: [1.9, 1.6, 0.9] },
  manta: { z: [-32, -18], y: [0.4, 0.85], speed: [1.3, 1.9], scale: [1.7, 2.3], bank: 0.75, body: [1.4, 1.8, 1.9] },
  whale: { z: [-58, -42], y: [0.45, 0.75], speed: [1.4, 1.9], scale: [1, 1.3], bank: 0.1, body: [7, 3.2, 1.7] },
  seal: { z: [-18, -8], y: [0.68, 0.9], speed: [2.6, 3.6], scale: [1, 1.25], bank: 0.2, body: [1.3, 0.5, 0.4] },
};

/** Turn depths tried per animal; the loop needing the least climbing over props wins. */
const LANES = 6;
/** Spacing of loop samples along the path. */
const SAMPLE = 1;
/** Depth spacing of the grid legs weave across, drifting at most one row per unit forward. */
const WEAVE = 0.25;
/** Cost of drifting a row, in height away from the cruise, so legs only weave to dodge things. */
const SWERVE = 0.3;
/** How far, and how many times, the turns pull in from the end walls when blocked. */
const REACH_STEP = 4;
const REACH_TRIES = 4;
/** Steepest climb or dive, in height per unit travelled. */
const CLIMB = 0.3;
const MAX_PITCH = 0.35;

function lathe(profile: [number, number][], segs: number): BufferGeometry {
  // Profile is (x along the body, radius); lathe spins around y, then y is turned to x.
  const g = new LatheGeometry(
    profile.map(([x, r]) => new Vector2(Math.max(r, 0.001), x)),
    segs,
  );
  g.rotateZ(-Math.PI / 2);
  return g;
}

/** Paints countershading: dark back, pale belly, with soft noise-free blending. */
function countershade(geo: BufferGeometry, back: Color, belly: Color, mid = 0): BufferGeometry {
  return paint(geo, (_x, y, _z, c) => c.copy(belly).lerp(back, smoothstep(mid - 0.25, mid + 0.2, y)));
}

function flipper(len: number, width: number, thick: number, color: Color, sweep: number): BufferGeometry {
  const g = new SphereGeometry(1, 12, 6);
  g.scale(width, thick, len);
  g.translate(0, 0, len * 0.92);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    pos.setX(i, pos.getX(i) - (z / len) ** 2 * sweep);
  }
  g.computeVertexNormals();
  return paint(g, (_x, _y, _z, c) => c.copy(color));
}

function mesh(geo: BufferGeometry, mat: MeshStandardMaterial): Mesh {
  geo.deleteAttribute('uv');
  const m = new Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

/** A hinge group at `at` holding a mirrored copy for the far side (`side` = -1). */
function hinge(parent: Object3D, child: Mesh, x: number, y: number, z: number, side: 1 | -1): Group {
  const g = new Group();
  g.position.set(x, y, z * side);
  if (side < 0) child.scale.z = -1;
  g.add(child);
  parent.add(g);
  return g;
}

function turtle(mat: MeshStandardMaterial): Rig {
  const root = new Group();
  const shell = new SphereGeometry(1, 22, 12);
  shell.scale(1.25, 0.42, 0.95);
  const dark = new Color('#4a3a20');
  const light = new Color('#9a7a42');
  paint(shell, (x, y, z, c) => {
    // Scutes: a soft hexagonal-ish pattern of light plates with dark seams.
    const s = Math.abs(Math.sin(x * 3.4) * Math.sin(z * 3.8 + x * 1.2));
    c.copy(dark).lerp(light, smoothstep(0.15, 0.6, s));
    if (y < 0) c.set('#d8c890').multiplyScalar(0.85);
  });
  const head = new SphereGeometry(0.3, 12, 8);
  head.scale(1.35, 0.9, 0.9);
  head.translate(1.45, 0.05, 0);
  paint(head, (_x, y, _z, c) => c.set(y > 0.05 ? '#6f6c48' : '#b8b486'));
  root.add(mesh(mergeParts([shell, head]), mat));
  const skin = new Color('#77744c');
  const joints: Joint[] = [];
  for (const side of [1, -1] as const) {
    const front = hinge(root, mesh(flipper(0.95, 0.26, 0.05, skin, 0.7), mat), 0.65, 0, 0.7, side);
    front.rotation.y = side * -0.25;
    joints.push({ obj: front, axis: 'x', base: 0, amp: side * 0.65, lag: 0 });
    const rear = hinge(root, mesh(flipper(0.38, 0.16, 0.04, skin, 0.2), mat), -0.9, 0, 0.55, side);
    rear.rotation.y = side * 0.6;
    joints.push({ obj: rear, axis: 'x', base: 0, amp: side * 0.25, lag: 0.25 });
  }
  return { root, joints, freq: 0.45 };
}

function manta(mat: MeshStandardMaterial): Rig {
  const root = new Group();
  const back = new Color('#1c242e');
  const belly = new Color('#d8dde2');
  const body = new SphereGeometry(1, 16, 10);
  body.scale(0.95, 0.18, 0.42);
  countershade(body, back, belly);
  const horns: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const h = new SphereGeometry(1, 8, 5);
    h.scale(0.38, 0.06, 0.08);
    h.translate(0.95, -0.02, side * 0.32);
    paint(h, (_x, _y, _z, c) => c.copy(back));
    horns.push(h);
  }
  const tail = new CylinderGeometry(0.01, 0.04, 1.8, 4);
  tail.rotateZ(Math.PI / 2);
  tail.translate(-1.7, 0, 0);
  paint(tail, (_x, _y, _z, c) => c.copy(back));
  root.add(mesh(mergeParts([body, ...horns, tail]), mat));

  // A swept, tapering wing in the xz plane from the body edge (z = 0) out to the tip.
  const wing = (): BufferGeometry => {
    const nu = 10;
    const nv = 4;
    const span = 2.1;
    const pos: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const lead = lerp(0.75, -0.55, Math.pow(u, 0.75));
      const trail = lerp(-0.7, -0.75, u);
      for (let j = 0; j <= nv; j++) {
        const v = j / nv;
        const x = lerp(lead, trail, v);
        const y = Math.sin(v * Math.PI) * 0.12 * (1 - u) - u * u * 0.15;
        pos.push(x, y, u * span);
      }
    }
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = i * (nv + 1) + j;
        const b = a + nv + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return paint(g, (_x, _y, z, c) => c.copy(back).lerp(belly, smoothstep(1.6, 2.1, z) * 0.25));
  };
  const joints: Joint[] = [];
  for (const side of [1, -1] as const) {
    const w = hinge(root, mesh(wing(), mat), 0, 0, 0.36, side);
    joints.push({ obj: w, axis: 'x', base: 0, amp: side * 0.42, lag: 0 });
  }
  return { root, joints, freq: 0.22 };
}

function whale(mat: MeshStandardMaterial): Rig {
  const root = new Group();
  const back = new Color('#27313c');
  const belly = new Color('#8f9aa4');
  const body = lathe(
    [
      [6.2, 0.05],
      [5.6, 0.9],
      [4.2, 1.45],
      [2, 1.7],
      [-0.5, 1.6],
      [-3, 1.15],
      [-5, 0.55],
      [-6.4, 0.25],
    ],
    18,
  );
  body.scale(1, 0.9, 1);
  countershade(body, back, belly, -0.4);
  root.add(mesh(body, mat));
  const fin = new Color('#3a4550');
  const joints: Joint[] = [];
  for (const side of [1, -1] as const) {
    const pec = hinge(root, mesh(flipper(2.4, 0.4, 0.08, fin, 1.2), mat), 2.6, -0.8, 1.2, side);
    pec.rotation.x = side * 0.5;
    joints.push({ obj: pec, axis: 'x', base: side * 0.5, amp: side * 0.12, lag: 0.3 });
  }
  const tail = new Group();
  tail.position.set(-6.2, 0, 0);
  root.add(tail);
  const fluke = new SphereGeometry(1, 14, 6);
  fluke.scale(0.55, 0.08, 1.9);
  const fp = fluke.getAttribute('position');
  for (let i = 0; i < fp.count; i++) fp.setX(i, fp.getX(i) + Math.abs(fp.getZ(i)) * 0.35 - 0.6);
  fluke.computeVertexNormals();
  paint(fluke, (_x, _y, _z, c) => c.copy(back));
  tail.add(mesh(fluke, mat));
  joints.push({ obj: tail, axis: 'z', base: 0, amp: 0.32, lag: 0 });
  joints.push({ obj: root, axis: 'z', base: 0, amp: 0.04, lag: 0.5 });
  return { root, joints, freq: 0.16 };
}

function seal(mat: MeshStandardMaterial): Rig {
  const root = new Group();
  const back = new Color('#4c4a46');
  const belly = new Color('#a8a296');
  const body = lathe(
    [
      [1.25, 0.04],
      [1.15, 0.2],
      [0.9, 0.24],
      [0.7, 0.2],
      [0.3, 0.32],
      [-0.3, 0.3],
      [-0.8, 0.16],
      [-1.05, 0.06],
    ],
    14,
  );
  paint(body, (x, y, z, c) => {
    c.copy(belly).lerp(back, smoothstep(-0.12, 0.1, y));
    if (Math.sin(x * 11) * Math.sin(z * 13 + x * 5) > 0.75 && y > 0) c.multiplyScalar(0.6);
  });
  root.add(mesh(body, mat));
  const skin = new Color('#3e3c38');
  const joints: Joint[] = [];
  for (const side of [1, -1] as const) {
    const fore = hinge(root, mesh(flipper(0.3, 0.12, 0.03, skin, 0.25), mat), 0.45, -0.18, 0.22, side);
    fore.rotation.y = side * -0.5;
    joints.push({ obj: fore, axis: 'x', base: 0, amp: side * 0.2, lag: 0.2 });
  }
  const hind = new Group();
  hind.position.set(-1, 0, 0);
  root.add(hind);
  for (const side of [1, -1] as const) {
    const f = hinge(hind, mesh(flipper(0.32, 0.14, 0.03, skin, 0), mat), 0, 0, 0.04, side);
    f.rotation.y = side * (Math.PI - 0.35);
  }
  joints.push({ obj: hind, axis: 'y', base: 0, amp: 0.45, lag: 0 });
  joints.push({ obj: root, axis: 'y', base: 0, amp: 0.06, lag: 0.5 });
  return { root, joints, freq: 0.9 };
}

const BUILD: Record<CreatureKind, (mat: MeshStandardMaterial) => Rig> = { turtle, manta, whale, seal };

/**
 * The cheapest route across columns `c0`..`c1` of a grid of `rows` depths (indexed
 * col * rows + row), from row `from` to row `to`, drifting at most one row per column.
 */
function weave(cost: Float32Array, rows: number, c0: number, c1: number, from: number, to: number): Int32Array {
  const cols = c1 - c0 + 1;
  const acc = new Float32Array(cols * rows).fill(Infinity);
  const prev = new Int8Array(cols * rows);
  acc[from] = cost[c0 * rows + from];
  for (let i = 1; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      let best = Infinity;
      let move = 0;
      for (let d = -1; d <= 1; d++) {
        if (j + d < 0 || j + d >= rows) continue;
        const v = acc[(i - 1) * rows + j + d] + (d === 0 ? 0 : SWERVE);
        if (v < best) {
          best = v;
          move = d;
        }
      }
      acc[i * rows + j] = best + cost[(c0 + i) * rows + j];
      prev[i * rows + j] = move;
    }
  }
  const path = new Int32Array(cols);
  for (let i = cols - 1, j = to; i >= 0; i--) {
    path[i] = j;
    j += prev[i * rows + j];
  }
  return path;
}

/** Rounds the corners off a weave, leaving its ends where they were. */
function smoothed(z: Float32Array, radius: number): Float32Array {
  const n = z.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let d = -radius; d <= radius; d++) sum += z[clamp(i + d, 0, n - 1)];
    out[i] = lerp(z[i], sum / (2 * radius + 1), Math.min(1, Math.min(i, n - 1 - i) / radius));
  }
  return out;
}

/**
 * Joins two legs between `xa` and `xb` (depths `near` swum forwards, `far` swum back) with
 * U-turns of radius `r`, resampled evenly along its length, without heights.
 */
function loopShape(xa: number, xb: number, near: Float32Array, far: Float32Array, r: number): Loop {
  const cols = near.length;
  const dx = (xb - xa) / (cols - 1);
  const px: number[] = [];
  const pz: number[] = [];
  const turn = (cx: number, from: number, to: number, side: number): void => {
    const m = Math.ceil((Math.PI * r) / 0.25);
    for (let k = 1; k < m; k++) {
      const a = (k / m) * Math.PI;
      px.push(cx + side * Math.sin(a) * r);
      pz.push(lerp(from, to, (1 - Math.cos(a)) / 2));
    }
  };
  for (let i = 0; i < cols; i++) px.push(xa + i * dx), pz.push(near[i]);
  turn(xb, near[cols - 1], far[cols - 1], 1);
  for (let i = cols - 1; i >= 0; i--) px.push(xa + i * dx), pz.push(far[i]);
  turn(xa, far[0], near[0], -1);

  const m = px.length;
  const at = new Float32Array(m + 1);
  for (let k = 0; k < m; k++) at[k + 1] = at[k] + Math.hypot(px[(k + 1) % m] - px[k], pz[(k + 1) % m] - pz[k]);
  const length = at[m];
  const n = Math.max(8, Math.round(length / SAMPLE));
  const step = length / n;
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  for (let i = 0, k = 0; i < n; i++) {
    const d = i * step;
    while (at[k + 1] < d) k++;
    const f = (d - at[k]) / Math.max(1e-6, at[k + 1] - at[k]);
    x[i] = lerp(px[k], px[(k + 1) % m], f);
    z[i] = lerp(pz[k], pz[(k + 1) % m], f);
  }
  const yaw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n;
    const b = (i + 1) % n;
    yaw[i] = Math.atan2(-(z[b] - z[a]), x[b] - x[a]);
  }
  return { x, z, yaw, heights: new Float32Array(n), step, length };
}

/**
 * Picks the loop in the habit's depth band that needs the least climbing, with heights that
 * carry an animal of scale `s` over everything under it, under anything hanging and below `top`.
 * Turns come in from `reach` where props wedged between the end walls and the surface block it.
 */
function planLoop(habit: Habit, s: number, cruise: number, margin: number, reach: number, map: ObstacleMap, top: number, rng: Rng): Loop {
  const [len, depth, half] = habit.body;
  const r = clamp(len * s * 1.6, 3, 8);
  // Pitching into a climb drops the tail.
  const clear = (half + len * Math.sin(MAX_PITCH)) * s + margin;

  // What swimming through each point of the band costs, in height away from the cruise, on unit
  // columns out to where the nose comes about at `reach`.
  const zLo = habit.z[0];
  const rows = Math.floor((habit.z[1] - zLo) / WEAVE) + 1;
  const cols = 2 * Math.max(1, Math.floor(reach - r - len * s)) + 1;
  const x0 = -(cols - 1) / 2;
  const grid = new Float32Array(cols * rows);
  for (let i = 0; i < cols; i++) {
    const x = x0 + i;
    for (let j = 0; j < rows; j++) {
      const z = zLo + j * WEAVE;
      const lo = map.floor(x, z, len * s, depth * s) + clear;
      const hi = Math.min(map.ceiling(x, z, len * s, depth * s), top) - clear;
      grid[i * rows + j] = Math.abs(Math.max(lo, Math.min(cruise, hi)) - cruise) + Math.max(0, lo - hi) * 50;
    }
  }
  const apart = Math.min(rows - 1, Math.round((2 * r) / WEAVE));
  const lanes = Array.from({ length: LANES }, (_, k) => Math.round(lerp(apart, rows - 1, (k + rng.range(0.2, 0.8)) / LANES)));

  let best: Loop | null = null;
  let bestCost = Infinity;
  let bestClash = Infinity;
  for (let inset = 0, before = Infinity; inset <= REACH_TRIES * REACH_STEP; inset += REACH_STEP) {
    // Stop once clear, or once pulling in stops helping.
    if (inset > 0 && (bestClash === 0 || bestClash >= before)) break;
    before = bestClash;
    const c0 = Math.min(inset, (cols - 3) / 2);
    const c1 = cols - 1 - c0;
    const leg = (row: number): Float32Array => smoothed(Float32Array.from(weave(grid, rows, c0, c1, row, row), (j) => zLo + j * WEAVE), 6);
    for (const near of lanes) {
      const loop = loopShape(x0 + c0, x0 + c1, leg(near), leg(near - apart), r);
      const n = loop.x.length;
      const floor = new Float32Array(n);
      const ceiling = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const c = Math.abs(Math.cos(loop.yaw[i]));
        const si = Math.abs(Math.sin(loop.yaw[i]));
        const rx = (c * len + si * depth) * s;
        const rz = (si * len + c * depth) * s;
        floor[i] = map.floor(loop.x[i], loop.z[i], rx, rz) + clear;
        ceiling[i] = Math.min(map.ceiling(loop.x[i], loop.z[i], rx, rz), top) - clear;
      }
      const heights = swimHeights(cruise, floor, ceiling, CLIMB * loop.step);
      let cost = 0;
      let clash = 0;
      for (let i = 0; i < n; i++) {
        cost += Math.abs(heights[i] - cruise);
        clash += Math.max(0, heights[i] - ceiling[i]);
      }
      // Breaking the surface or scraping a hanging prop is far worse than a long climb.
      cost += clash * 50;
      if (clash < bestClash || (clash === bestClash && cost < bestCost)) {
        loop.heights.set(heights);
        best = loop;
        bestCost = cost;
        bestClash = clash;
      }
    }
  }
  return best!;
}

/** Big animals cruising across the level behind the play area, purely for show. */
export function buildWildlife(biome: BiomeDef, level: LevelDef, map: ObstacleMap): EnvLayer | null {
  const defs = biome.wildlife;
  if (!defs || defs.length === 0) return null;
  const rng = new Rng(level.seed + 515);
  const mat = patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: DoubleSide }), {
    caustics: biome.caustics > 0,
  });
  const group = new Group();
  group.name = 'wildlife';
  const H = level.world.height;
  // Turning where the terrain's end walls start to rise.
  const reach = level.world.width / 2 + 2;
  const top = biome.surface === 'none' ? Infinity : H - 0.3;
  const creatures: Creature[] = [];
  for (const d of defs) {
    const habit = HABITS[d.kind];
    for (let i = 0; i < d.count; i++) {
      const rig = BUILD[d.kind](mat);
      const s = rng.range(habit.scale[0], habit.scale[1]);
      rig.root.scale.setScalar(s);
      const speed = rng.range(habit.speed[0], habit.speed[1]) * rng.sign();
      const bob = rng.range(0.4, 1);
      const loop = planLoop(habit, s, H * rng.range(habit.y[0], habit.y[1]), bob + 0.5, reach, map, top, rng);
      const c: Creature = {
        ...rig,
        s0: ((i + rng.range(0.1, 0.9)) / d.count) * loop.length,
        speed,
        bob,
        phase: rng.range(0, TAU),
        bank: habit.bank,
        loop,
      };
      const holder = new Group();
      holder.add(c.root);
      // Roll about the body's own axis after the turn.
      holder.rotation.order = 'YXZ';
      c.root.userData.holder = holder;
      group.add(holder);
      creatures.push(c);
    }
  }
  return {
    object: group,
    update: (u) => {
      for (const c of creatures) {
        const holder = c.root.userData.holder as Group;
        const p = c.loop;
        const n = p.x.length;
        const along = (((c.s0 + c.speed * u.time) % p.length) + p.length) % p.length;
        const f = along / p.step;
        const i0 = Math.floor(f) % n;
        const i1 = (i0 + 1) % n;
        const k = f - Math.floor(f);
        const h0 = p.heights[i0];
        const h1 = p.heights[i1];
        const t = u.time * c.freq * TAU + c.phase;
        holder.position.set(
          lerp(p.x[i0], p.x[i1], k),
          lerp(h0, h1, k) + Math.sin(u.time * 0.23 + c.phase) * c.bob,
          lerp(p.z[i0], p.z[i1], k),
        );
        let turn = p.yaw[i1] - p.yaw[i0];
        turn -= TAU * Math.round(turn / TAU);
        const yaw = p.yaw[i0] + turn * k + (c.speed < 0 ? Math.PI : 0);
        // Rolled to face the camera on both legs, level mid-turn.
        holder.rotation.set(c.bank * Math.cos(yaw), yaw, 0);
        // Nose up into a climb, whichever way it swims.
        const pitch = clamp(Math.atan(((h1 - h0) / p.step) * Math.sign(c.speed)), -MAX_PITCH, MAX_PITCH);
        c.root.rotation.set(0, 0, pitch + Math.cos(u.time * 0.23 + c.phase) * c.bob * 0.06);
        for (const j of c.joints) {
          const v = j.base + Math.sin(t - j.lag * TAU) * j.amp;
          if (j.obj === c.root) c.root.rotation[j.axis] += v;
          else j.obj.rotation[j.axis] = v;
        }
      }
    },
    dispose: () => {
      group.traverse((o) => (o as Mesh).geometry?.dispose());
      mat.dispose();
    },
  };
}
