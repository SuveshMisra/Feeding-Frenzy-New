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
import { lerp, smoothstep, TAU } from '../engine/math';
import { mergeParts, paint } from './props/shapes';
import type { EnvLayer } from './Environment';

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

interface Creature extends Rig {
  x0: number;
  y: number;
  z: number;
  speed: number;
  bob: number;
  phase: number;
  /** Roll towards the camera so wings and shells don't sit edge-on. */
  bank: number;
}

/** Where each kind swims: depth band (z), height as a share of the water, speed, size. */
const HABITS: Record<CreatureKind, { z: [number, number]; y: [number, number]; speed: [number, number]; scale: [number, number]; bank: number }> = {
  turtle: { z: [-18, -10], y: [0.35, 0.8], speed: [1.1, 1.6], scale: [1.1, 1.5], bank: 0.35 },
  manta: { z: [-32, -18], y: [0.4, 0.85], speed: [1.3, 1.9], scale: [2.2, 3], bank: 0.75 },
  whale: { z: [-58, -42], y: [0.45, 0.75], speed: [1.4, 1.9], scale: [1, 1.3], bank: 0.1 },
  seal: { z: [-18, -8], y: [0.68, 0.9], speed: [2.6, 3.6], scale: [1, 1.25], bank: 0.2 },
};

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

/** Big animals cruising across the level behind the play area, purely for show. */
export function buildWildlife(biome: BiomeDef, level: LevelDef): EnvLayer | null {
  const defs = biome.wildlife;
  if (!defs || defs.length === 0) return null;
  const rng = new Rng(level.seed + 515);
  const mat = patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: DoubleSide }), {
    caustics: biome.caustics > 0,
  });
  const group = new Group();
  group.name = 'wildlife';
  const H = level.world.height;
  const W = level.world.width + 60;
  const left = -W / 2;
  const creatures: Creature[] = [];
  for (const d of defs) {
    const habit = HABITS[d.kind];
    for (let i = 0; i < d.count; i++) {
      const rig = BUILD[d.kind](mat);
      rig.root.scale.setScalar(rng.range(habit.scale[0], habit.scale[1]));
      const speed = rng.range(habit.speed[0], habit.speed[1]) * rng.sign();
      const c: Creature = {
        ...rig,
        x0: left + ((i + rng.range(0.1, 0.9)) / d.count) * W,
        y: H * rng.range(habit.y[0], habit.y[1]),
        z: rng.range(habit.z[0], habit.z[1]),
        speed,
        bob: rng.range(0.4, 1),
        phase: rng.range(0, TAU),
        bank: habit.bank,
      };
      const holder = new Group();
      holder.add(c.root);
      // Euler XYZ applies the x roll after the y turn, so the same roll faces the camera both ways.
      holder.rotation.set(c.bank, speed > 0 ? 0 : Math.PI, 0);
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
        const x = left + (((c.x0 + c.speed * u.time - left) % W) + W) % W;
        const t = u.time * c.freq * TAU + c.phase;
        holder.position.set(x, c.y + Math.sin(u.time * 0.23 + c.phase) * c.bob, c.z);
        c.root.rotation.set(0, 0, Math.cos(u.time * 0.23 + c.phase) * c.bob * 0.06);
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
