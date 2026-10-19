import {
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import type { QualityPreset } from '../app/Quality';
import { patchMaterial, type StoneOptions } from '../engine/materialPatches';
import { Rng } from '../engine/rng';
import { clamp, lerp, TAU } from '../engine/math';
import { getSharedTextures } from '../art/textures';
import type { Environment } from './Environment';
import {
  anemoneGeometry,
  brainCoralGeometry,
  branchCoralGeometry,
  fanGeometry,
  grassTuftGeometry,
  kelpGeometry,
  rockGeometry,
  shardGeometry,
  spongeGeometry,
  strandGeometry,
  type CoralStyle,
  type PlantColors,
} from './props/shapes';
import {
  anchorGeometry,
  barrelGeometry,
  buoyGeometry,
  cannonballPileGeometry,
  cannonGeometry,
  chainLinkGeometry,
  crateGeometry,
  hangingClothGeometry,
  rowboatGeometry,
  shipwreckGeometry,
  standingMastGeometry,
} from './props/wreck';
import { algaeCurtainGeometry, brinicleGeometry, icebergGeometry } from './props/ice';
import { chimneyGeometry } from './props/vents';
import { leafGeometry, mangroveGeometry } from './props/mangrove';
import { cliffGeometry } from './props/canyon';
import { archGeometry, blockGeometry, columnGeometry, statueHeadGeometry, stepsGeometry } from './props/ruins';
import { cavePillarGeometry, crystalClusterGeometry, mushroomGeometry } from './props/crystal';
import { basaltGeometry, lavaCrackGeometry } from './props/volcanic';
import { coralTowerGeometry, seaWhipGeometry, type LocalPerch } from './props/reef';
import { tubeWormGeometry, whaleSkeletonGeometry } from './props/abyss';
import { buildAmbientSchools, buildBubbleColumns, buildEmbers, buildLavaFalls, buildPlumes, buildShafts, type LavaFall } from './Layers';
import { buildWildlife } from './Wildlife';
import { ObstacleMap } from './Obstacles';

/** Props an animal can brush through (plants, glows, flat cracks), so they don't block its path. */
const SOFT_PROPS = /^(kelp|seagrass|sea-whips|sea-fans|anemones|glow-threads|siphonophores|ice-algae|leaves|lava-cracks|vent-glow|tube-worms)/;

/** Depth bands (z ranges) relative to the gameplay plane at z = 0. */
const BANDS = {
  front: [2.8, 8.5],
  mid: [-11, -1.6],
  back: [-34, -11],
  floor: [-1.4, 1.2],
} as const;
type Band = keyof typeof BANDS;
type Weights = Partial<Record<Band, number>>;

interface Spot {
  x: number;
  z: number;
  band: Band;
}

interface Placement {
  x: number;
  y: number;
  z: number;
  s: number;
  ry: number;
  sx?: number;
  sy?: number;
  sz?: number;
  tx?: number;
  tz?: number;
  color?: Color;
}

/** Top of a rock outcrop that other props can grow on. */
interface Perch {
  x: number;
  y: number;
  z: number;
  r: number;
}

/** A glowing spot that one of the environment's point lights can sit on. */
interface GlowPoint {
  p: Vector3;
  color: Color;
  power: number;
  distance: number;
  /** Share of the intensity that flickers. */
  flicker: number;
}

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpP = new Vector3();
const tmpS = new Vector3();

/** Populates an environment with the props, particles and light layers of its biome. */
export class BiomeBuilder {
  private readonly rng: Rng;
  private readonly meshes: InstancedMesh[] = [];
  private readonly perches: Perch[] = [];
  private readonly glowPoints: GlowPoint[] = [];
  private readonly ventBases: { x: number; z: number; s: number }[] = [];
  private readonly bubbleSources: Vector3[] = [];
  private readonly lavaFalls: LavaFall[] = [];
  /** Footprints (centre and half extents) that scattered props must not land in. */
  private readonly clearings: { x: number; z: number; rx: number; rz: number }[] = [];
  private readonly xMin: number;
  private readonly xMax: number;
  private readonly caustics: boolean;

  constructor(
    private readonly env: Environment,
    private readonly quality: QualityPreset,
  ) {
    this.rng = new Rng(env.level.seed + 777);
    this.xMin = -env.level.world.width / 2 - 26;
    this.xMax = env.level.world.width / 2 + 26;
    this.caustics = env.biome.caustics > 0;
  }

  build(): void {
    const b = this.env.biome;
    const P = b.props;
    const detail = this.quality.level === 'low' ? 2 : this.quality.level === 'ultra' ? 4 : 3;
    // Set pieces go down first and keep their footprint clear so they stay readable.
    if (P.skeletons) this.skeletons(P.skeletons);
    if (P.basalt) this.basalt(P.basalt, P.lavaFalls ?? 0);
    if (P.rocks) this.rocks(P.rocks, detail);
    // Structures first: their tops become perches for the life that follows.
    if (P.towers) this.towers(P.towers);
    if (P.pillars) this.pillars(P.pillars);
    if (P.cliffs) this.cliffs(P.cliffs);
    if (P.ruins) this.ruins(P.ruins);
    if (P.mangrove) this.mangroves(P.mangrove);
    if (P.crystals) this.crystals(P.crystals);
    if (P.coral) this.corals(P.coral);
    if (P.brain) this.brains(P.brain);
    if (P.fans) this.fans(P.fans);
    if (P.sponges) this.sponges(P.sponges);
    if (P.anemones) this.anemones(P.anemones);
    if (P.kelp) this.kelp(P.kelp);
    if (P.seagrass) this.seagrass(P.seagrass);
    if (P.whips) this.whips(P.whips);
    if (P.wreck) this.wreck();
    if (P.icebergs) this.ice(P.icebergs, P.brinicles ?? 0);
    if (P.curtains) this.curtains(P.curtains);
    if (P.vents || P.tallVents) this.vents(P.vents, P.tallVents ?? 0);
    if (P.tubeWorms) this.tubeWorms(P.tubeWorms);
    if (P.strands) this.strands(P.strands);
    if (P.glowThreads) this.glowThreads(P.glowThreads);
    if (P.bubbles) this.bubbles(P.bubbles);

    const level = this.env.level;
    const add = (l: ReturnType<typeof buildShafts>): void => {
      if (l) this.env.addLayer(l);
    };
    if (this.quality.shafts) add(buildShafts(b, level, b.shafts));
    add(buildAmbientSchools(b, level, Math.max(1, Math.round(b.ambientSchools * (this.quality.propDensity < 0.6 ? 0.5 : 1)))));
    if (b.embers) add(buildEmbers(level, Math.round(b.embers * this.quality.particles), level.seed));
    if (b.wildlife?.length) add(buildWildlife(b, level, this.obstacles()));
    const top = b.surface === 'none' ? level.world.height + 4 : level.world.height - 0.2;
    add(buildBubbleColumns(this.bubbleSources, Math.round(36 * this.quality.particles), top, level.seed));
    add(buildLavaFalls(this.lavaFalls, level.seed));
    if (this.glowPoints.length) this.followLights();

    const meshes = this.meshes;
    this.env.addLayer({
      dispose: () => {
        for (const m of meshes) m.dispose();
      },
    });
  }

  // --- helpers ---------------------------------------------------------------

  private n(count: number): number {
    return Math.max(0, Math.round(count * this.quality.propDensity));
  }

  private spots(count: number, weights: Weights, cluster = 0, spread = 3): Spot[] {
    const rng = this.rng;
    const items = (Object.entries(weights) as [Band, number][]).map(([v, w]) => ({ v, w }));
    const out: Spot[] = [];
    let band: Band = 'mid';
    let cx = 0;
    let cz = 0;
    let left = 0;
    for (let i = 0; i < count; i++) {
      if (cluster > 1) {
        if (left <= 0) {
          band = rng.weighted(items);
          cx = rng.range(this.xMin, this.xMax);
          cz = rng.range(BANDS[band][0], BANDS[band][1]);
          left = rng.int(Math.ceil(cluster * 0.5), Math.ceil(cluster * 1.5));
        }
        left--;
        const [z0, z1] = BANDS[band];
        out.push({ x: cx + rng.gauss(spread), z: clamp(cz + rng.gauss(spread * 0.6), z0, z1), band });
      } else {
        band = rng.weighted(items);
        out.push({ x: rng.range(this.xMin, this.xMax), z: rng.range(BANDS[band][0], BANDS[band][1]), band });
      }
    }
    if (this.clearings.length === 0) return out;
    return out.filter((s) => !this.clearings.some((c) => Math.abs(s.x - c.x) < c.rx && Math.abs(s.z - c.z) < c.rz));
  }

  private ground(x: number, z: number): number {
    return this.env.terrain.height(x, z);
  }

  /** The seabed and every solid prop placed so far, for the wildlife to steer around. */
  private obstacles(): ObstacleMap {
    const level = this.env.level;
    const halfW = level.world.width / 2 + 45;
    const surface = this.env.biome.surface === 'none' ? null : level.world.height;
    const map = new ObstacleMap(-halfW, halfW, -66, 4, (x, z) => this.ground(x, z), surface);
    for (const m of this.meshes) if (!SOFT_PROPS.test(m.name)) map.addInstances(m);
    return map;
  }

  /** Moves a share of the placements onto rock outcrops so life grows up the reef. */
  private settle(items: Placement[], share: number): Placement[] {
    if (this.perches.length === 0) return items;
    for (const it of items) {
      if (!this.rng.chance(share)) continue;
      const p = this.rng.pick(this.perches);
      const a = this.rng.range(0, TAU);
      const d = Math.sqrt(this.rng.next()) * p.r;
      it.x = p.x + Math.cos(a) * d;
      it.z = p.z + Math.sin(a) * d * 0.7;
      it.y = p.y - (d / p.r) * p.r * 0.35 - it.s * 0.08;
      it.s *= p.z < -11 ? 1.3 : 1;
    }
    return items;
  }

  /** The instance transform of a placement (same as `add` uses). */
  private matrix(p: Placement): Matrix4 {
    tmpE.set(p.tx ?? 0, p.ry, p.tz ?? 0);
    tmpQ.setFromEuler(tmpE);
    return new Matrix4().compose(new Vector3(p.x, p.y, p.z), tmpQ, new Vector3(p.s * (p.sx ?? 1), p.s * (p.sy ?? 1), p.s * (p.sz ?? 1)));
  }

  /** Adds a placed structure's local perches. */
  private addPerches(local: LocalPerch[], p: Placement): void {
    const m = this.matrix(p);
    for (const lp of local) {
      const w = new Vector3(lp.x, lp.y, lp.z).applyMatrix4(m);
      this.perches.push({ x: w.x, y: w.y, z: w.z, r: lp.r * p.s });
    }
  }

  private add(geo: BufferGeometry, mat: Material, items: Placement[], name: string, shadow = false): InstancedMesh | null {
    if (items.length === 0) {
      geo.dispose();
      return null;
    }
    const mesh = new InstancedMesh(geo, mat, items.length);
    items.forEach((it, i) => {
      tmpE.set(it.tx ?? 0, it.ry, it.tz ?? 0);
      tmpQ.setFromEuler(tmpE);
      tmpP.set(it.x, it.y, it.z);
      tmpS.set(it.s * (it.sx ?? 1), it.s * (it.sy ?? 1), it.s * (it.sz ?? 1));
      tmpM.compose(tmpP, tmpQ, tmpS);
      mesh.setMatrixAt(i, tmpM);
      if (it.color) mesh.setColorAt(i, it.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = shadow && this.quality.shadows;
    mesh.receiveShadow = this.quality.shadows;
    mesh.name = name;
    this.meshes.push(mesh);
    this.env.group.add(mesh);
    return mesh;
  }

  /** Splits placements between geometry variants and instances each group. */
  private addVariants(geos: BufferGeometry[], mat: Material, items: Placement[], name: string, shadow = false): void {
    const groups: Placement[][] = geos.map(() => []);
    items.forEach((it, i) => groups[i % geos.length].push(it));
    geos.forEach((g, i) => this.add(g, mat, groups[i], `${name}-${i}`, shadow));
  }

  private scaleFor(band: Band, small: number, big: number): number {
    const r = this.rng;
    switch (band) {
      case 'back':
        return r.range(big * 0.9, big * 1.8);
      case 'front':
        return r.range(small * 0.9, big * 0.75);
      case 'floor':
        return r.range(small * 0.45, small * 0.8);
      default:
        return r.range(small, big);
    }
  }

  private tint(hex: string, jitter = 0.12): Color {
    const c = new Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h + this.rng.range(-0.02, 0.02), hsl.s, clamp(hsl.l * this.rng.range(1 - jitter, 1 + jitter), 0, 1));
    return c;
  }

  private grey(lo: number, hi: number): Color {
    return new Color().setScalar(this.rng.range(lo, hi));
  }

  private material(
    opts: ConstructorParameters<typeof MeshStandardMaterial>[0],
    patch: Parameters<typeof patchMaterial>[1] = {},
  ): MeshStandardMaterial {
    return patchMaterial(new MeshStandardMaterial({ vertexColors: true, ...opts }), {
      caustics: this.caustics,
      fade: true,
      ...patch,
    });
  }

  private get abyss(): boolean {
    return this.env.biome.plankton;
  }

  /** Stone detail for rocky props; algae only where there's daylight and nothing frozen. */
  private get stone(): StoneOptions {
    const b = this.env.biome;
    if (b.surface !== 'water' || this.abyss || b.props.basalt) return {};
    const lush = b.props.kelp > 50 || b.props.wreck || b.props.mangrove;
    const algae = new Color(b.palette.plant).lerp(new Color('#5a5a1e'), 0.45).multiplyScalar(0.7);
    return { algae, algaeAmount: lush ? 0.85 : 0.7 };
  }

  // --- props -------------------------------------------------------------------

  private rocks(count: number, detail: number): void {
    const b = this.env.biome;
    const pal = b.palette;
    const top =
      b.surface === 'ice'
        ? { top: new Color('#f4fbff'), topAmount: 0.85 }
        : this.abyss || b.surface === 'rock' || b.props.basalt
          ? { top: new Color(pal.rockDark), topAmount: 0.2 }
          : b.props.kelp > 50 || b.props.wreck || b.props.mangrove
            ? { top: new Color(pal.plant), topAmount: 0.5 }
            : { top: new Color(b.sand.light), topAmount: 0.55 };
    const colors = { base: new Color(pal.rock), dark: new Color(pal.rockDark), ...top };
    const seed = this.env.level.seed;
    const geos = [rockGeometry(seed + 1, colors, detail), rockGeometry(seed + 2, colors, detail), rockGeometry(seed + 3, colors, detail)];
    const mat = this.material({ roughness: 0.85 }, { stone: this.stone });
    const rng = this.rng;
    const total = this.n(count);
    const items: Placement[] = [];
    const tilt = (): number => rng.range(-0.08, 0.08);

    // Outcrops: big boulders whose tops become perches for coral, sponges and anemones.
    const outcrops = this.spots(Math.round(total * 0.3), { mid: 4, back: 2.5, front: 0.4 }, 2, 5);
    for (const s of outcrops) {
      const sc = (s.band === 'back' ? rng.range(2.6, 4.4) : rng.range(1.8, 3.2)) * (s.band === 'front' ? 0.6 : 1);
      const sy = rng.range(1, 1.7);
      const y = this.ground(s.x, s.z) - sc * 0.15;
      items.push({ x: s.x, z: s.z, y, s: sc, sy, ry: rng.range(0, TAU), tx: tilt(), tz: tilt(), color: this.grey(0.82, 1.1) });
      this.perches.push({ x: s.x, z: s.z, y: y + sc * sy * 0.7, r: sc * 0.75 });
    }
    // Spires rise into mid-water behind the play area.
    const spires = this.spots(Math.round(total * 0.12), { back: 3, mid: 1 });
    for (const s of spires) {
      const sc = rng.range(1.8, 3.2);
      const sy = rng.range(2.6, 4.6);
      const z = Math.min(s.z, -6);
      const y = this.ground(s.x, z) - sc * 0.2;
      items.push({ x: s.x, z, y, s: sc, sy, ry: rng.range(0, TAU), tx: tilt(), tz: tilt(), color: this.grey(0.75, 1) });
      this.perches.push({ x: s.x, z, y: y + sc * sy * 0.7, r: sc * 0.45 });
    }
    // Boulders and pebbles.
    const rest = total - outcrops.length - spires.length;
    for (const s of this.spots(rest, { mid: 3, front: 1, floor: 1.2, back: 1 }, 3, 2.5)) {
      const sc = s.band === 'floor' ? rng.range(0.3, 0.65) : this.scaleFor(s.band, 0.5, 1.6);
      items.push({
        x: s.x,
        z: s.z,
        y: this.ground(s.x, s.z) - sc * 0.12,
        s: sc,
        ry: rng.range(0, TAU),
        tx: tilt() * 1.5,
        tz: tilt() * 1.5,
        color: this.grey(0.82, 1.12),
      });
    }
    this.addVariants(geos, mat, items, 'rocks', true);
  }

  private towers(count: number): void {
    const pal = this.env.biome.palette;
    const seed = this.env.level.seed;
    const rng = this.rng;
    const variants = [coralTowerGeometry(seed + 200), coralTowerGeometry(seed + 201), coralTowerGeometry(seed + 202)];
    const mat = this.material({ map: getSharedTextures().grain, roughness: 0.8 }, { translucency: 0.12 });
    const groups: Placement[][] = variants.map(() => []);
    const muted = new Color('#c9a88a');
    this.spots(this.n(count), { mid: 3, back: 4 }).forEach((s, i) => {
      // Keep the big ones well behind the play plane.
      const z = s.band === 'mid' ? Math.min(s.z, -4.5) : s.z;
      const v = i % variants.length;
      const p: Placement = {
        x: s.x,
        z,
        y: this.ground(s.x, z) - 0.2,
        s: s.band === 'back' ? rng.range(1.3, 2) : rng.range(0.8, 1.15),
        ry: rng.range(0, TAU),
        color: this.tint(rng.pick(pal.coral)).lerp(muted, 0.35),
      };
      groups[v].push(p);
      this.addPerches(variants[v].perches, p);
    });
    variants.forEach((v, i) => this.add(v.geo, mat, groups[i], `coral-towers-${i}`, true));
  }

  private whips(count: number): void {
    const pal = this.env.biome.palette;
    const seed = this.env.level.seed;
    const geos = [seaWhipGeometry(seed + 210), seaWhipGeometry(seed + 211), seaWhipGeometry(seed + 212)];
    const mat = this.material({ roughness: 0.55 }, { translucency: 0.3, sway: { freq: 0.9, amount: 0.5, height: 4.5 } });
    const items = this.spots(this.n(count), { front: 2.4, mid: 2, back: 0.6 }, 3, 2.5).map((s) => ({
      x: s.x,
      z: s.z,
      y: this.ground(s.x, s.z) - 0.05,
      s: s.band === 'front' ? this.rng.range(1.2, 2) : this.scaleFor(s.band, 0.8, 1.3),
      ry: this.rng.range(0, TAU),
      color: this.tint(this.rng.pick(pal.coral), 0.15),
    }));
    this.addVariants(geos, mat, this.settle(items, 0.12), 'sea-whips');
  }

  private skeletons(count: number): void {
    const rng = this.rng;
    const W = this.env.level.world.width;
    const geo = whaleSkeletonGeometry(this.env.level.seed + 220);
    const mat = this.material({ roughness: 0.75 }, { rim: { color: new Color('#7fb8ff'), power: 2.6, strength: 0.35 } });
    const items: Placement[] = [];
    for (let i = 0; i < count; i++) {
      const back = i % 2 === 1;
      const x = lerp(-W * 0.35, W * 0.35, (i + rng.range(0.3, 0.7)) / count);
      const z = back ? rng.range(-26, -18) : rng.range(-8, -6.5);
      const s = back ? rng.range(1.2, 1.5) : rng.range(0.75, 0.9);
      items.push({
        x,
        z,
        y: this.ground(x, z) - 0.25 * s,
        s,
        ry: rng.range(-0.25, 0.25) + (rng.chance(0.5) ? Math.PI : 0),
        tz: rng.range(-0.04, 0.04),
        color: this.tint('#d8d0bc', 0.08),
      });
      this.clearings.push({ x, z, rx: 10 * s, rz: 3.2 * s });
    }
    this.add(geo, mat, items, 'whale-skeletons', true);
  }

  private tubeWorms(count: number): void {
    const rng = this.rng;
    const seed = this.env.level.seed;
    const geos = [tubeWormGeometry(seed + 230), tubeWormGeometry(seed + 231)];
    const mat = this.material({ roughness: 0.55 }, { translucency: 0.15, sway: { freq: 1.1, amount: 0.08, height: 1.8 } });
    const items: Placement[] = [];
    for (let i = 0; i < this.n(count); i++) {
      let x: number;
      let z: number;
      const vent = this.ventBases.length && rng.chance(0.75) ? rng.pick(this.ventBases) : null;
      if (vent) {
        const a = rng.range(0, TAU);
        const d = rng.range(1.4, 3.2) * vent.s;
        x = vent.x + Math.cos(a) * d;
        z = Math.min(vent.z + Math.sin(a) * d * 0.6, -1.8);
      } else {
        const s = this.spots(1, { mid: 3, floor: 1, back: 1 })[0];
        x = s.x;
        z = s.z;
      }
      items.push({ x, z, y: this.ground(x, z) - 0.05, s: rng.range(0.7, 1.3) * (z < -11 ? 1.4 : 1), ry: rng.range(0, TAU), color: this.grey(0.85, 1) });
    }
    this.addVariants(geos, mat, items, 'tube-worms', true);
  }

  private strands(count: number): void {
    const pal = this.env.biome.palette;
    const seed = this.env.level.seed;
    const H = this.env.level.world.height;
    const rng = this.rng;
    const geos = [6, 9, 12].map((len, i) => strandGeometry(seed + 240 + i, { strands: 1, spread: 0, length: [len * 0.8, len], bead: [0.06, 0.11], gap: 0.32, float: true }));
    const mat = this.material({ roughness: 0.4 }, { glow: 1.8, translucency: 0.3, sway: { freq: 0.35, amount: 0.9, height: -11 } });
    const items = this.spots(this.n(count), { mid: 3, back: 3, front: 0.4 }).map((s) => ({
      x: s.x,
      z: s.z,
      y: H * rng.range(0.55, 1.05),
      s: this.scaleFor(s.band, 0.8, 1.2),
      ry: rng.range(0, TAU),
      tz: rng.range(-0.25, 0.25),
      color: this.tint(rng.pick(pal.coral), 0.1),
    }));
    this.addVariants(geos, mat, items, 'siphonophores');
  }

  private glowThreads(count: number): void {
    const pal = this.env.biome.palette;
    const seed = this.env.level.seed;
    const H = this.env.level.world.height;
    const rng = this.rng;
    const geos = [0, 1, 2].map((i) => strandGeometry(seed + 250 + i, { strands: 12, spread: 1.8, length: [1.2, 5], bead: [0.025, 0.05], gap: 0.3, up: 2.5 }));
    const mat = this.material({ roughness: 0.4 }, { glow: 2.2, sway: { freq: 0.3, amount: 0.22, height: -5 } });
    const colors = ['#6ff7e8', '#8ffff0', pal.plantTip];
    // The ceiling sags out of reach beyond z = -22.
    const items = this.spots(this.n(count), { mid: 3, back: 2, front: 0.5 }).map((s) => ({
      x: s.x,
      z: Math.max(s.z, -21),
      y: H + 0.9,
      s: this.scaleFor(s.band, 0.8, 1.3),
      ry: rng.range(0, TAU),
      color: this.tint(rng.pick(colors), 0.08),
    }));
    this.addVariants(geos, mat, items, 'glow-threads');
  }

  private pillars(count: number): void {
    const seed = this.env.level.seed;
    const pal = this.env.biome.palette;
    const H = this.env.level.world.height;
    const rng = this.rng;
    const variants = [cavePillarGeometry(seed + 260), cavePillarGeometry(seed + 261), cavePillarGeometry(seed + 262)];
    const mat = this.material({ roughness: 0.6 }, { stone: { scale: 0.3, relief: 0.9 } });
    const groups: Placement[][] = variants.map(() => []);
    const pale = new Color('#6a6488');
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const front = i % 8 === 7;
      const back = !front && rng.chance(0.45);
      const x = this.xMin + ((i + rng.range(0.2, 0.8)) / n) * (this.xMax - this.xMin);
      const z = front ? rng.range(5, 8) : back ? rng.range(-22, -12) : rng.range(-10, -3.5);
      const s = back ? rng.range(1.2, 1.7) : front ? rng.range(0.8, 1) : rng.range(0.8, 1.15);
      const g = this.ground(x, z);
      // Reach well into the ceiling so its lumps never leave a gap.
      const span = H + 3 - g + 0.3;
      groups[i % variants.length].push({ x, z, y: g - 0.3, s, sy: span / s, ry: rng.range(0, TAU), color: this.tint(pal.rock, 0.12).lerp(pale, 0.3) });
      this.perches.push({ x, z, y: g + 0.35, r: 1.5 * s });
    }
    variants.forEach((v, i) => this.add(v, mat, groups[i], `cave-pillars-${i}`, true));
  }

  private bubbles(count: number): void {
    for (const s of this.spots(this.n(count), { mid: 3, front: 0.6, back: 1.5 })) {
      this.bubbleSources.push(new Vector3(s.x, this.ground(s.x, s.z), s.z));
    }
  }

  private curtains(count: number): void {
    const seed = this.env.level.seed;
    const H = this.env.level.world.height;
    const base = new Color('#5f5a22');
    const tip = new Color('#c9b552');
    const geos = [algaeCurtainGeometry(seed + 280, base, tip), algaeCurtainGeometry(seed + 281, base, tip)];
    const mat = this.material({ side: DoubleSide, roughness: 0.8 }, { translucency: 0.5, sway: { freq: 0.55, amount: 0.6, height: -4.5 } });
    const items = this.spots(this.n(count), { mid: 3, back: 3, front: 0.6 }, 3, 4).map((s) => ({
      x: s.x,
      z: s.z,
      y: H + 0.05,
      s: this.scaleFor(s.band, 0.8, 1.4),
      ry: this.rng.range(-0.5, 0.5),
      color: this.grey(0.8, 1.1),
    }));
    this.addVariants(geos, mat, items, 'ice-algae');
  }

  private corals(count: number): void {
    const pal = this.env.biome.palette;
    const seed = this.env.level.seed;
    const styles: CoralStyle[] = ['staghorn', 'bush', 'finger', 'staghorn'];
    const geos = styles.map((s, i) => branchCoralGeometry(seed + 20 + i, s));
    const mat = this.material({ map: getSharedTextures().grain, roughness: 0.7 }, { translucency: 0.22 });
    const items = this.spots(this.n(count), { mid: 5, back: 1.5, front: 1.3, floor: 0.35 }, 6, 2.6).map((s) => {
      const sc = this.scaleFor(s.band, 0.75, 1.6);
      return {
        x: s.x,
        z: s.z,
        y: this.ground(s.x, s.z) - 0.05,
        s: sc,
        ry: this.rng.range(0, TAU),
        color: this.tint(this.rng.pick(pal.coral)),
      };
    });
    this.addVariants(geos, mat, this.settle(items, 0.4), 'coral', true);
  }

  private brains(count: number): void {
    const pal = this.env.biome.palette;
    const geo = brainCoralGeometry(this.env.level.seed + 30);
    const mat = this.material({ map: getSharedTextures().grain, roughness: 0.8 }, { translucency: 0.15 });
    const muted = new Color('#d9c79a');
    const items = this.spots(this.n(count), { mid: 4, front: 1, floor: 0.8, back: 1 }, 3).map((s) => {
      const sc = s.band === 'floor' ? this.rng.range(0.35, 0.6) : this.scaleFor(s.band, 0.5, 1.25);
      return {
        x: s.x,
        z: s.z,
        y: this.ground(s.x, s.z) - 0.05 * sc,
        s: sc,
        sy: this.rng.range(0.8, 1.15),
        ry: this.rng.range(0, TAU),
        color: this.tint(this.rng.pick(pal.coral)).lerp(muted, 0.45),
      };
    });
    this.add(geo, mat, this.settle(items, 0.3), 'brain-coral', true);
  }

  private fans(count: number): void {
    const pal = this.env.biome.palette;
    const geo = fanGeometry(this.env.level.seed + 40);
    const mat = this.material(
      { map: getSharedTextures().fan, alphaTest: 0.45, side: DoubleSide, roughness: 0.8 },
      { translucency: 0.35, sway: { freq: 0.8, amount: 0.12, height: 1.7 } },
    );
    const items = this.spots(this.n(count), { mid: 4, back: 2, front: 0.8 }, 3).map((s) => ({
      x: s.x,
      z: s.z,
      y: this.ground(s.x, s.z) - 0.08,
      s: this.scaleFor(s.band, 0.8, 1.7),
      ry: this.rng.range(-0.6, 0.6),
      color: this.tint(this.rng.pick(pal.coral), 0.18),
    }));
    this.add(geo, mat, this.settle(items, 0.35), 'sea-fans');
  }

  private sponges(count: number): void {
    const pal = this.env.biome.palette;
    const seed = this.env.level.seed;
    const geos = [spongeGeometry(seed + 50), spongeGeometry(seed + 51)];
    const glow = this.abyss;
    const mat = this.material(
      {
        map: getSharedTextures().grain,
        roughness: 0.85,
        emissive: glow ? new Color(pal.plantTip) : new Color('#000000'),
        emissiveIntensity: glow ? 0.35 : 0,
      },
      { translucency: 0.2 },
    );
    const items = this.spots(this.n(count), { mid: 4, front: 1, floor: 0.5, back: 1.2 }, 2).map((s) => ({
      x: s.x,
      z: s.z,
      y: this.ground(s.x, s.z) - 0.02,
      s: this.scaleFor(s.band, 0.7, 1.5),
      ry: this.rng.range(0, TAU),
      color: this.tint(this.rng.pick(pal.coral)),
    }));
    this.addVariants(geos, mat, this.settle(items, 0.35), 'sponges', true);
  }

  private anemones(count: number): void {
    const pal = this.env.biome.palette;
    const geo = anemoneGeometry(this.env.level.seed + 60);
    const glow = this.abyss || this.env.biome.surface === 'ice' || this.env.biome.surface === 'rock';
    const mat = this.material(
      {
        roughness: 0.6,
        emissive: glow ? new Color(pal.coral[0]) : new Color('#000000'),
        emissiveIntensity: this.abyss ? 0.55 : glow ? 0.12 : 0,
      },
      { translucency: 0.3, sway: { freq: 1.3, amount: 0.14, height: 1 } },
    );
    const items = this.spots(this.n(count), { mid: 3, floor: 1.4, front: 1 }, 2).map((s) => ({
      x: s.x,
      z: s.z,
      y: this.ground(s.x, s.z) - 0.04,
      s: s.band === 'floor' ? this.rng.range(0.5, 0.8) : this.scaleFor(s.band, 0.55, 1.15),
      ry: this.rng.range(0, TAU),
      color: this.tint(this.rng.pick(pal.coral), 0.15),
    }));
    this.add(geo, mat, this.settle(items, 0.3), 'anemones');
  }

  private plantColors(): PlantColors {
    const pal = this.env.biome.palette;
    const base = new Color(pal.plant);
    return { stem: base.clone().multiplyScalar(0.65), base, tip: new Color(pal.plantTip) };
  }

  private kelp(count: number): void {
    const seed = this.env.level.seed;
    const colors = this.plantColors();
    const H = this.env.level.world.height;
    const geos = [kelpGeometry(seed + 70, H * 0.42, colors), kelpGeometry(seed + 71, H * 0.62, colors), kelpGeometry(seed + 72, H * 0.8, colors)];
    const mat = this.material(
      { side: DoubleSide, roughness: 0.7 },
      { translucency: 0.55, sway: { freq: 0.5, amount: 1.1, height: H * 0.6 } },
    );
    const items = this.spots(this.n(count), { mid: 4, back: 4.5, front: 1.1 }, 5, 3).map((s) => ({
      x: s.x,
      z: s.z,
      y: this.ground(s.x, s.z) - 0.2,
      s: this.rng.range(0.75, 1.2) * (s.band === 'front' ? 0.85 : 1),
      ry: this.rng.range(0, TAU),
      color: this.grey(0.8, 1.15),
    }));
    this.addVariants(geos, mat, this.settle(items, 0.15), 'kelp');
  }

  private seagrass(blades: number): void {
    const seed = this.env.level.seed;
    const colors = this.plantColors();
    const geos = [grassTuftGeometry(seed + 80, 6, colors), grassTuftGeometry(seed + 81, 7, colors)];
    const mat = this.material(
      { side: DoubleSide, roughness: 0.85 },
      { translucency: 0.4, sway: { freq: 1.5, amount: 0.2, height: 1 } },
    );
    const items = this.spots(this.n(Math.round(blades / 6)), { mid: 4, floor: 2, front: 1.6, back: 1 }, 26, 3.2).map((s) => ({
      x: s.x,
      z: s.z,
      y: this.ground(s.x, s.z),
      s: s.band === 'back' ? this.rng.range(1.4, 2.4) : this.rng.range(0.75, 1.45),
      ry: this.rng.range(0, TAU),
      color: this.grey(0.75, 1.15),
    }));
    this.addVariants(geos, mat, items, 'seagrass');
  }

  private wreck(): void {
    const tex = getSharedTextures();
    const mat = this.material({ map: tex.wood, roughness: 0.92, side: DoubleSide }, {});
    const W = this.env.level.world.width;
    const main = { x: -W * 0.12, z: -10 };
    const far = { x: W * 0.3, z: -30 };
    const items: Placement[] = [
      { ...main, y: this.ground(main.x, main.z) + 2, s: 1, ry: 0.18, tx: 0.32, tz: -0.07, color: this.grey(0.9, 1) },
      { ...far, y: this.ground(far.x, far.z) + 1.0, s: 0.85, ry: Math.PI - 0.5, tx: -0.45, tz: 0.12, color: this.grey(0.75, 0.85) },
    ];
    this.add(shipwreckGeometry(this.env.level.seed + 90), mat, items, 'shipwreck', true);

    const debris = this.spots(this.n(22), { mid: 3, floor: 1, front: 0.6 }, 4);
    const barrels: Placement[] = [];
    const crates: Placement[] = [];
    debris.forEach((s, i) => {
      const lying = this.rng.chance(0.6);
      const sc = this.rng.range(0.7, 1.15) * (s.band === 'floor' ? 0.75 : 1);
      const p: Placement = {
        x: s.x,
        z: s.z,
        y: this.ground(s.x, s.z) + (lying ? 0.28 : 0.35) * sc,
        s: sc,
        ry: this.rng.range(0, TAU),
        tx: lying && i % 2 === 0 ? Math.PI / 2 : this.rng.range(-0.2, 0.2),
        tz: this.rng.range(-0.25, 0.25),
        color: this.grey(0.7, 1),
      };
      (i % 2 === 0 ? barrels : crates).push(p);
    });
    this.add(barrelGeometry(), mat, barrels, 'barrels', true);
    this.add(crateGeometry(), mat, crates, 'crates', true);
    for (const off of [-6, 1.5, 7]) {
      const x = main.x + off;
      this.bubbleSources.push(new Vector3(x, this.ground(x, main.z) + 3, main.z + 1.5));
    }
    this.masts(mat);
    this.moorings();
    this.cannons(mat);
  }

  /** Lone masts standing out of the silt, one hung with a torn sail and one with a net. */
  private masts(wood: Material): void {
    const seed = this.env.level.seed;
    const W = this.env.level.world.width;
    const rng = this.rng;
    const sailMat = this.material({ side: DoubleSide, roughness: 0.95 }, { translucency: 0.35, sway: { freq: 0.45, amount: 0.55, height: -5 } });
    const netMat = this.material(
      { map: getSharedTextures().net, alphaTest: 0.4, side: DoubleSide, roughness: 0.9 },
      { sway: { freq: 0.5, amount: 0.4, height: -4 } },
    );
    const spots = [
      { x: W * 0.2, z: -6.5, s: 1 },
      { x: -W * 0.34, z: -19, s: 1.3 },
    ];
    spots.forEach((m, i) => {
      const mast = standingMastGeometry(seed + 300 + i);
      const p: Placement = {
        x: m.x,
        z: m.z,
        y: this.ground(m.x, m.z) - 0.2,
        s: m.s,
        ry: rng.range(-0.5, 0.5),
        tx: rng.range(-0.08, 0.08),
        tz: rng.range(-0.16, 0.16),
        color: this.grey(0.75, 0.95),
      };
      this.add(mast.geo, wood, [p], `mast-${i}`, true);
      const mtx = this.matrix(p);
      const hangFrom = (y: number): Placement => {
        const at = new Vector3(0, y - 0.1, 0.14).applyMatrix4(mtx);
        return { x: at.x, y: at.y, z: at.z, s: p.s, ry: p.ry, tx: p.tx, tz: p.tz };
      };
      const [low, high] = mast.yards;
      const sail = hangingClothGeometry(seed + 310 + i, low.half * 1.85, rng.range(4.5, 6), 0.45);
      this.add(sail, sailMat, [{ ...hangFrom(low.y), color: this.tint('#b9ae8e', 0.1) }], `sail-${i}`);
      const net = hangingClothGeometry(seed + 320 + i, high.half * 1.8, rng.range(3, 4.5), 0.25);
      this.add(net, netMat, [{ ...hangFrom(high.y), color: this.tint('#7a6a48', 0.1) }], `net-${i}`);
    });
  }

  /** Anchors on the seabed, each chained up to a buoy floating at the surface. */
  private moorings(): void {
    const W = this.env.level.world.width;
    const H = this.env.level.world.height;
    const rng = this.rng;
    const iron = this.material({ roughness: 0.6, metalness: 0.3 }, {});
    const anchor = anchorGeometry();
    const links: Placement[] = [];
    const anchors: Placement[] = [];
    const buoys: Placement[] = [];
    const xAxis = new Vector3(1, 0, 0);
    const roll = new Quaternion().setFromAxisAngle(xAxis, Math.PI / 2);
    const q = new Quaternion();
    const e = new Euler();
    for (const c of [
      { x: -W * 0.3, z: -4.5 },
      { x: W * 0.05, z: -8 },
      { x: W * 0.38, z: -5 },
      { x: -W * 0.05, z: -24 },
    ]) {
      const x = c.x + rng.range(-5, 5);
      const ap: Placement = {
        x,
        z: c.z,
        y: this.ground(x, c.z) + 0.15,
        s: 1,
        ry: rng.range(0, TAU),
        tz: rng.sign() * rng.range(1.2, 1.4),
        color: this.tint('#6a5446', 0.12),
      };
      anchors.push(ap);
      const ring = anchor.ring.clone().applyMatrix4(this.matrix(ap));
      const buoy = new Vector3(x + rng.range(-5, 5), H - 0.35, c.z + rng.range(-1, 1));
      buoys.push({ x: buoy.x, y: buoy.y, z: buoy.z, s: 1, ry: rng.range(0, TAU), color: this.grey(0.8, 1) });
      const top = buoy.clone().setY(buoy.y - 0.85);
      // Slack chain, pushed sideways by the current.
      const bow = rng.range(1.5, 3) * rng.sign();
      const mid = (t: number): Vector3 => top.clone().lerp(ring, t).add(new Vector3(Math.sin(t * Math.PI) * bow, 0, 0));
      const curve = new CatmullRomCurve3([top, mid(0.33), mid(0.66), ring]);
      const count = Math.floor(curve.getLength() / 0.36);
      for (let k = 0; k <= count; k++) {
        const t = k / count;
        const p = curve.getPointAt(t);
        q.setFromUnitVectors(xAxis, curve.getTangentAt(t));
        if (k % 2) q.multiply(roll);
        e.setFromQuaternion(q);
        links.push({ x: p.x, y: p.y, z: p.z, s: 1, tx: e.x, ry: e.y, tz: e.z, color: this.tint('#5a4c44', 0.12) });
      }
    }
    this.add(chainLinkGeometry(), iron, links, 'chains', true);
    this.add(anchor.geo, iron, anchors, 'anchors', true);
    this.add(buoyGeometry(), this.material({ roughness: 0.55 }, {}), buoys, 'buoys');
  }

  /** Rowing boats, cannons and cannonball piles scattered across the seabed. */
  private cannons(wood: Material): void {
    const seed = this.env.level.seed;
    const rng = this.rng;
    const iron = this.material({ roughness: 0.65, metalness: 0.25 }, { stone: { relief: 0.4 } });
    const boats = this.spots(this.n(3), { mid: 3, back: 1 }).map((s) => {
      const z = Math.min(s.z, -3.5);
      const capsized = rng.chance(0.5);
      return {
        x: s.x,
        z,
        y: this.ground(s.x, z) + (capsized ? 0.55 : 0.35),
        s: this.scaleFor(s.band, 0.9, 1.1),
        ry: rng.range(0, TAU),
        tx: capsized ? Math.PI * rng.range(0.85, 0.95) : rng.range(0.4, 0.9) * rng.sign(),
        tz: rng.range(-0.15, 0.15),
        color: this.grey(0.7, 0.95),
      };
    });
    this.add(rowboatGeometry(seed + 330), wood, boats, 'rowboats', true);
    const rust = (): Color => this.tint('#5a4a40', 0.15);
    const guns = this.spots(this.n(9), { mid: 3, floor: 1.2, front: 0.5 }, 2, 3).map((s) => {
      const sc = s.band === 'floor' ? rng.range(0.7, 0.85) : rng.range(0.85, 1.1);
      return { x: s.x, z: s.z, y: this.ground(s.x, s.z) + 0.2 * sc, s: sc, ry: rng.range(0, TAU), tx: rng.range(-0.3, 0.3), tz: rng.range(-0.06, 0.15), color: rust() };
    });
    this.add(cannonGeometry(), iron, guns, 'cannons', true);
    const piles = this.spots(this.n(6), { mid: 3, floor: 1 }).map((s) => ({ x: s.x, z: s.z, y: this.ground(s.x, s.z) - 0.06, s: rng.range(0.9, 1.2), ry: rng.range(0, TAU), color: rust() }));
    this.add(cannonballPileGeometry(seed + 340), iron, piles, 'cannonballs', true);
  }

  private ice(count: number, brinicles: number): void {
    const seed = this.env.level.seed;
    const H = this.env.level.world.height;
    const bergMat = this.material(
      { color: '#9fd6f5', roughness: 0.18, metalness: 0.02, emissive: new Color('#0f4a78'), emissiveIntensity: 0.55 },
      { translucency: 0.45, rim: { color: new Color('#e2fbff'), power: 2.2, strength: 0.9 } },
    );
    const bergs: Placement[] = [];
    const n = Math.max(3, this.n(count));
    for (let i = 0; i < n; i++) {
      const front = i % 6 === 5;
      const x = this.xMin + ((i + this.rng.range(0.1, 0.9)) / n) * (this.xMax - this.xMin);
      const z = front ? this.rng.range(6, 9) : this.rng.range(-34, -7);
      bergs.push({
        x,
        z,
        y: H + 0.4,
        s: 1,
        sx: this.rng.range(4, 9) * (front ? 0.45 : 1),
        sy: this.rng.range(5, 11) * (front ? 0.35 : 1),
        sz: this.rng.range(3, 6) * (front ? 0.6 : 1),
        ry: this.rng.range(0, TAU),
        color: this.grey(0.85, 1.05),
      });
    }
    this.addVariants([icebergGeometry(seed + 100), icebergGeometry(seed + 101)], bergMat, bergs, 'icebergs');

    const mat = this.material(
      { color: '#cdeeff', roughness: 0.22, metalness: 0.02, flatShading: true, emissive: new Color('#0d3350'), emissiveIntensity: 0.4 },
      { translucency: 0.3, rim: { color: new Color('#c4f6ff'), power: 2.4, strength: 0.6 } },
    );

    const shards = this.spots(this.n(46), { mid: 3, back: 2, front: 0.8, floor: 0.4 }, 5).map((s) => {
      const sc = s.band === 'floor' ? this.rng.range(0.3, 0.5) : this.scaleFor(s.band, 0.5, 1.4);
      return {
        x: s.x,
        z: s.z,
        y: this.ground(s.x, s.z) - 0.1 * sc,
        s: sc,
        ry: this.rng.range(0, TAU),
        tx: this.rng.range(-0.35, 0.35),
        tz: this.rng.range(-0.35, 0.35),
        color: this.grey(0.85, 1.1),
      };
    });
    this.addVariants([shardGeometry(seed + 110), shardGeometry(seed + 111), shardGeometry(seed + 112)], mat, shards, 'ice-shards', true);

    const icicles = this.spots(this.n(brinicles), { mid: 3, back: 3, front: 0.3 }).map((s) => ({
      x: s.x,
      z: s.band === 'mid' ? Math.min(s.z, -2.5) : s.z,
      y: H + 0.15,
      s: s.band === 'front' ? this.rng.range(0.4, 0.6) : s.band === 'back' ? this.rng.range(1.3, 2.2) : this.rng.range(0.7, 1.3),
      ry: this.rng.range(0, TAU),
      color: this.grey(0.9, 1.1),
    }));
    this.addVariants([brinicleGeometry(seed + 270), brinicleGeometry(seed + 271), brinicleGeometry(seed + 272)], mat, icicles, 'brinicles');
  }

  private vents(count: number, tall: number): void {
    const seed = this.env.level.seed;
    const chimneys = [chimneyGeometry(seed + 120), chimneyGeometry(seed + 121), chimneyGeometry(seed + 122)];
    const spires = tall ? [chimneyGeometry(seed + 125, true), chimneyGeometry(seed + 126, true)] : [];
    const mat = this.material({ roughness: 0.9 }, { stone: { relief: 1.3 } });
    const groups: Placement[][] = chimneys.map(() => []);
    const spireGroups: Placement[][] = spires.map(() => []);
    const mouths: { p: Vector3; s: number; lit: boolean }[] = [];
    const W = this.env.level.world.width;
    const mouthOf = (top: Vector3, p: Placement): Vector3 => {
      tmpE.set(0, p.ry, 0);
      return top.clone().applyEuler(tmpE).multiplyScalar(p.s).add(new Vector3(p.x, p.y, p.z));
    };
    for (let i = 0; i < count; i++) {
      const back = i % 3 === 2;
      const x = -W / 2 + ((i + this.rng.range(0.25, 0.75)) / count) * W;
      const z = back ? this.rng.range(-22, -14) : this.rng.range(-8, -3.5);
      const s = this.rng.range(1.1, 1.7) * (back ? 1.4 : 1);
      const v = i % chimneys.length;
      const p: Placement = { x, z, y: this.ground(x, z) - 0.2, s, ry: this.rng.range(0, TAU), color: this.grey(0.85, 1.1) };
      groups[v].push(p);
      this.ventBases.push({ x, z, s });
      mouths.push({ p: mouthOf(chimneys[v].top, p), s: 0.55, lit: true });
    }
    // Black smoker spires towering over the back of the field.
    for (let i = 0; i < tall; i++) {
      const x = -W / 2 + ((i + this.rng.range(0.2, 0.8)) / tall) * W;
      const z = this.rng.range(-28, -15);
      const s = this.rng.range(1.2, 1.7);
      const v = i % spires.length;
      const p: Placement = { x, z, y: this.ground(x, z) - 0.3, s, ry: this.rng.range(0, TAU), color: this.grey(0.8, 1) };
      spireGroups[v].push(p);
      mouths.push({ p: mouthOf(spires[v].top, p), s: 0.45 * s, lit: false });
    }
    chimneys.forEach((c, i) => this.add(c.geo, mat, groups[i], `vent-${i}`, true));
    spires.forEach((c, i) => this.add(c.geo, mat, spireGroups[i], `vent-spire-${i}`, true));

    // Glowing mouths and rising plumes.
    const capMat = new MeshBasicMaterial({ color: new Color('#ffb04d').multiplyScalar(3.2), toneMapped: false });
    const caps = mouths.map((m) => ({ x: m.p.x, y: m.p.y + 0.05, z: m.p.z, s: m.s, sy: 0.35, ry: 0 }));
    this.add(new SphereGeometry(1, 14, 8), capMat, caps, 'vent-glow');
    const plumes = buildPlumes(
      mouths.map((m) => m.p),
      Math.round(90 * this.quality.particles),
      seed,
    );
    this.env.addLayer(plumes);
    const orange = new Color('#ff9a3c');
    for (const m of mouths) {
      if (m.lit) this.glowPoints.push({ p: new Vector3(m.p.x, m.p.y + 1.2, m.p.z + 1.5), color: orange, power: 38, distance: 18, flicker: 0.15 });
    }
  }

  /** The environment's few glow lights follow the glowing spots nearest to the camera. */
  private followLights(): void {
    const pts = this.glowPoints;
    const lights = this.env.glowLights;
    const order = pts.map((_, i) => i);
    this.env.addLayer({
      update: (u) => {
        const cx = u.camera.position.x;
        order.sort((a, b) => Math.abs(pts[a].p.x - cx) - Math.abs(pts[b].p.x - cx));
        lights.forEach((l, k) => {
          const g = pts[order[k]];
          if (!g) {
            l.intensity = 0;
            return;
          }
          l.visible = true;
          l.color.copy(g.color);
          l.distance = g.distance;
          l.position.copy(g.p);
          l.intensity = g.power * (1 - g.flicker + g.flicker * Math.sin(u.time * 7 + k * 2.1) * Math.sin(u.time * 3.3 + k));
        });
      },
      dispose: () => undefined,
    });
  }

  private mangroves(count: number): void {
    const seed = this.env.level.seed;
    const pal = this.env.biome.palette;
    const H = this.env.level.world.height;
    const rng = this.rng;
    const geos = [mangroveGeometry(seed + 130, H), mangroveGeometry(seed + 131, H), mangroveGeometry(seed + 132, H)];
    const mat = this.material({ map: getSharedTextures().grain, roughness: 0.95 }, {});
    const trees: Placement[] = [];
    for (const s of this.spots(this.n(count), { mid: 3, back: 4, front: 0.35 }, 2, 7)) {
      // Keep roots out of the camera's face and off the play plane.
      const z = s.band === 'front' ? Math.max(s.z, 5.5) : s.band === 'mid' ? Math.min(s.z, -3) : s.z;
      const sc = rng.range(0.8, 1.2) * (s.band === 'back' ? 1.5 : s.band === 'front' ? 0.6 : 1);
      const span = H - this.ground(s.x, z);
      trees.push({ x: s.x, z, y: H + 0.3, s: sc, sy: span / (H * sc), ry: rng.range(0, TAU), color: this.tint('#6b5644', 0.15) });
    }
    this.addVariants(geos, mat, trees, 'mangroves', true);

    // Leaves float on the surface, mostly over the trees.
    const leafMat = this.material({ side: DoubleSide, roughness: 0.8 }, { translucency: 0.6 });
    const leaves: Placement[] = [];
    const total = this.n(count * 7);
    for (let i = 0; i < total; i++) {
      const t = trees.length && rng.chance(0.65) ? rng.pick(trees) : null;
      const x = t ? t.x + rng.gauss(3) : rng.range(this.xMin, this.xMax);
      const z = t ? t.z + rng.gauss(2) : rng.range(-40, 9);
      leaves.push({
        x,
        z,
        y: H - 0.05 - rng.next() * 0.05,
        s: rng.range(0.45, 1.15),
        ry: rng.range(0, TAU),
        color: this.tint(rng.chance(0.25) ? pal.plantTip : pal.plant, 0.2),
      });
    }
    this.add(leafGeometry(seed + 135), leafMat, leaves, 'leaves');
  }

  private cliffs(count: number): void {
    const seed = this.env.level.seed;
    const rng = this.rng;
    const variants = [cliffGeometry(seed + 140), cliffGeometry(seed + 141), cliffGeometry(seed + 142)];
    const mat = this.material({ roughness: 0.88 }, { stone: { ...this.stone, scale: 0.25 } });
    const groups: Placement[][] = variants.map(() => []);
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const back = rng.chance(0.6);
      const x = rng.range(this.xMin, this.xMax);
      const z = back ? rng.range(-30, -13) : rng.range(-10, -3.5);
      const s = back ? rng.range(1.6, 2.8) : rng.range(0.6, 1.05);
      const sy = rng.range(0.8, 1.4);
      const v = i % variants.length;
      const y = this.ground(x, z) - 0.4 * s;
      groups[v].push({ x, z, y, s, sy, ry: rng.range(-0.3, 0.3) + (rng.chance(0.5) ? Math.PI : 0), color: this.tint(this.env.biome.palette.rock, 0.12) });
      this.perches.push({ x, z, y: y + variants[v].top * s * sy, r: variants[v].topRadius * s });
    }
    variants.forEach((c, i) => this.add(c.geo, mat, groups[i], `cliffs-${i}`, true));
  }

  private ruins(count: number): void {
    const seed = this.env.level.seed;
    const rng = this.rng;
    const pal = this.env.biome.palette;
    const mat = this.material({ roughness: 0.85 }, { stone: { ...this.stone, relief: 0.7 } });
    const stone = (): Color => this.tint(pal.rock, 0.1);
    const n = this.n(count);

    // Colonnades: rows of columns, some standing whole, some snapped.
    const whole = columnGeometry(seed + 150, false);
    const broken = [columnGeometry(seed + 151, true), columnGeometry(seed + 152, true)];
    const wholeItems: Placement[] = [];
    const brokenItems: Placement[][] = [[], []];
    const rows = Math.max(2, Math.round(n / 7));
    for (let r = 0; r < rows; r++) {
      const back = r % 2 === 1;
      const z = back ? rng.range(-24, -14) : rng.range(-9, -4.5);
      const x0 = rng.range(this.xMin + 10, this.xMax - 30);
      const cols = rng.int(4, 7);
      const gap = rng.range(2.6, 3.3) * (back ? 1.35 : 1);
      const s = back ? rng.range(1.25, 1.55) : rng.range(0.85, 1.05);
      for (let k = 0; k < cols; k++) {
        const x = x0 + k * gap;
        const p: Placement = { x, z, y: this.ground(x, z) - 0.15, s, ry: rng.range(-0.1, 0.1), tz: rng.chance(0.25) ? rng.range(-0.1, 0.1) : 0, color: stone() };
        if (rng.chance(0.4)) brokenItems[k % 2].push(p);
        else {
          wholeItems.push(p);
          this.perches.push({ x, z, y: p.y + whole.height * s, r: 0.45 * s });
        }
      }
    }
    // Fallen and snapped columns scattered around.
    for (const sp of this.spots(Math.round(n * 0.35), { mid: 3, back: 2, front: 0.3 }, 2, 4)) {
      const lying = rng.chance(0.45);
      const s = this.scaleFor(sp.band, 0.7, 1.15);
      brokenItems[rng.int(0, 1)].push({
        x: sp.x,
        z: sp.z,
        y: this.ground(sp.x, sp.z) + (lying ? 0.38 * s : -0.15),
        s,
        ry: rng.range(0, TAU),
        tz: lying ? (Math.PI / 2) * rng.sign() : rng.range(-0.15, 0.15),
        color: stone(),
      });
    }
    this.add(whole.geo, mat, wholeItems, 'columns', true);
    broken.forEach((b, i) => this.add(b.geo, mat, brokenItems[i], `broken-columns-${i}`, true));

    const arches = this.spots(Math.max(2, Math.round(n * 0.12)), { mid: 2, back: 3 }).map((sp) => {
      const z = Math.min(sp.z, -4);
      return { x: sp.x, z, y: this.ground(sp.x, z) - 0.2, s: sp.band === 'back' ? rng.range(1.3, 1.8) : rng.range(0.9, 1.15), ry: rng.range(-0.35, 0.35), tz: rng.range(-0.05, 0.05), color: stone() };
    });
    this.add(archGeometry(seed + 155), mat, arches, 'arches', true);

    // A couple of giant heads, half sunk in the silt and gazing toward the camera.
    const W = this.env.level.world.width;
    const heads: Placement[] = [
      { x: -W * 0.22, z: -8.5, s: 2.3, ry: 0.35, tz: 0.32, tx: -0.12, y: 0, color: stone() },
      { x: W * 0.28, z: -24, s: 4.2, ry: -0.5, tz: -0.25, tx: 0.1, y: 0, color: stone() },
      { x: W * 0.02, z: -34, s: 5, ry: 0.15, tz: 0.12, tx: -0.05, y: 0, color: stone() },
    ];
    for (const hd of heads) hd.y = this.ground(hd.x, hd.z) + hd.s * 0.45;
    this.add(statueHeadGeometry(seed + 156), mat, heads, 'statue-heads', true);

    const steps = this.spots(Math.max(2, Math.round(n * 0.1)), { mid: 2, back: 3 }).map((sp) => {
      const z = Math.min(sp.z, -5);
      const s = sp.band === 'back' ? rng.range(1.2, 1.7) : rng.range(0.8, 1.1);
      const y = this.ground(sp.x, z) - 0.2;
      this.perches.push({ x: sp.x, z, y: y + 1.6 * s, r: 1 * s });
      return { x: sp.x, z, y, s, ry: rng.range(-0.4, 0.4), color: stone() };
    });
    this.add(stepsGeometry(seed + 157), mat, steps, 'steps', true);

    const blocks = this.spots(Math.round(n * 1.2), { mid: 3, floor: 1, front: 0.5, back: 1 }, 4, 2.5).map((sp) => {
      const s = sp.band === 'floor' ? rng.range(0.4, 0.7) : this.scaleFor(sp.band, 0.6, 1.2);
      return { x: sp.x, z: sp.z, y: this.ground(sp.x, sp.z) + 0.15 * s, s, ry: rng.range(0, TAU), tx: rng.range(-0.25, 0.25), tz: rng.range(-0.25, 0.25), color: stone() };
    });
    this.addVariants([blockGeometry(seed + 158), blockGeometry(seed + 159)], mat, blocks, 'blocks', true);
  }

  private crystals(count: number): void {
    const seed = this.env.level.seed;
    const pal = this.env.biome.palette;
    const H = this.env.level.world.height;
    const rng = this.rng;
    const mat = this.material(
      { roughness: 0.18, metalness: 0.05, flatShading: true },
      { glow: 1.7, translucency: 0.25, rim: { color: new Color('#e9fbff'), power: 2.4, strength: 0.4 } },
    );
    const items: Placement[] = this.spots(this.n(count), { mid: 4, back: 2.5, front: 0.5, floor: 0.9 }, 3, 3).map((s) => {
      const sc = s.band === 'floor' ? rng.range(0.3, 0.55) : this.scaleFor(s.band, 0.6, 1.5);
      return { x: s.x, z: s.z, y: this.ground(s.x, s.z) - 0.1 * sc, s: sc, ry: rng.range(0, TAU), tx: rng.range(-0.2, 0.2), tz: rng.range(-0.2, 0.2), color: this.tint(rng.pick(pal.coral), 0.08) };
    });
    this.settle(items, 0.15);
    // Crystals hanging from the cave ceiling.
    const hanging = this.n(Math.round(count * 0.35));
    for (let i = 0; i < hanging; i++) {
      const back = rng.chance(0.6);
      const sc = back ? rng.range(1, 1.8) : rng.range(0.45, 0.8);
      items.push({ x: rng.range(this.xMin, this.xMax), z: back ? rng.range(-26, -8) : rng.range(-7, -2.5), y: H + 1.2, s: sc, ry: rng.range(0, TAU), tx: Math.PI + rng.range(-0.2, 0.2), color: this.tint(rng.pick(pal.coral), 0.08) });
    }
    this.addVariants([crystalClusterGeometry(seed + 160), crystalClusterGeometry(seed + 161), crystalClusterGeometry(seed + 162)], mat, items, 'crystals');
    for (const it of items) {
      if (it.s < 0.9 || it.z < -12 || it.z > 2 || !it.color) continue;
      const up = it.tx !== undefined && Math.abs(it.tx) > 1 ? -1 : 1;
      this.glowPoints.push({ p: new Vector3(it.x, it.y + up * 1.6 * it.s, it.z + 1.2), color: it.color.clone(), power: 26, distance: 14, flicker: 0.08 });
    }

    const mushMat = this.material({ roughness: 0.6 }, { glow: 1.5, translucency: 0.3 });
    const glowCols = [pal.plantTip, pal.coral[0], '#7dffb0'];
    const mush = this.spots(this.n(Math.round(count * 0.9)), { mid: 3, floor: 1.5, front: 0.8, back: 1 }, 3, 2).map((s) => ({
      x: s.x,
      z: s.z,
      y: this.ground(s.x, s.z) - 0.03,
      s: s.band === 'floor' ? rng.range(0.5, 0.8) : this.scaleFor(s.band, 0.7, 1.5),
      ry: rng.range(0, TAU),
      color: this.tint(rng.pick(glowCols), 0.1),
    }));
    this.addVariants([mushroomGeometry(seed + 170), mushroomGeometry(seed + 171)], mushMat, this.settle(mush, 0.35), 'mushrooms');
  }

  private basalt(count: number, falls: number): void {
    const seed = this.env.level.seed;
    const rng = this.rng;
    const variants = [basaltGeometry(seed + 180), basaltGeometry(seed + 181), basaltGeometry(seed + 182)];
    const mat = this.material({ roughness: 0.75 }, { stone: { relief: 1.2 } });
    const groups: Placement[][] = variants.map(() => []);

    // Lava falls: a towering stack of columns with lava pouring off the top and
    // spreading into cracks at its foot. Placed first so the view of them stays clear.
    const pools: { x: number; z: number }[] = [];
    const W = this.env.level.world.width;
    for (let i = 0; i < falls; i++) {
      const x = lerp(-W * 0.3, W * 0.3, falls === 1 ? 0.5 : i / (falls - 1)) + rng.range(-8, 8);
      const z = rng.range(-26, -20);
      const g = this.ground(x, z);
      const s = rng.range(2, 2.4);
      const sy = rng.range(2.6, 3.2);
      const v = i % variants.length;
      const color = (): Color => this.tint('#3a3432', 0.1);
      groups[v].push({ x, z, y: g - 0.1, s, sy, ry: rng.range(0, TAU), color: color() });
      groups[(v + 1) % 3].push({ x: x - 2 * s, z: z - 0.8, y: g - 0.1, s: s * 0.85, sy: sy * 0.7, ry: rng.range(0, TAU), color: color() });
      groups[(v + 2) % 3].push({ x: x + 1.9 * s, z: z - 0.5, y: g - 0.1, s: s * 0.8, sy: sy * 0.55, ry: rng.range(0, TAU), color: color() });
      const radius = variants[v].radius * s;
      const foot = this.ground(x, z + radius * 1.5) - 0.15;
      this.lavaFalls.push({ x, z, radius, top: g + (variants[v].top - 0.2) * s * sy - 0.4, bottom: foot, width: rng.range(1.1, 1.7) });
      pools.push({ x, z: z + radius * 1.4 });
      const near = z + radius * 1.5 + 8;
      const far = z - radius * 0.5;
      this.clearings.push({ x, z: (near + far) / 2, rx: 3.5, rz: (near - far) / 2 });
    }

    this.spots(this.n(count), { mid: 3, back: 3, front: 0.4 }, 2, 6).forEach((s, i) => {
      const sc = this.scaleFor(s.band, 0.7, 1.4) * (s.band === 'back' ? 1.3 : 1);
      groups[i % variants.length].push({ x: s.x, z: s.z, y: this.ground(s.x, s.z) - 0.1, s: sc, sy: rng.range(0.8, 1.3), ry: rng.range(0, TAU), color: this.tint('#4a4240', 0.18) });
    });
    variants.forEach((v, i) => this.add(v.geo, mat, groups[i], `basalt-${i}`, true));

    // Glowing lava cracks across the seabed, including right under the play plane.
    const centres = this.spots(this.n(Math.round(count * 0.8)), { mid: 3, floor: 2.5, back: 2 }).map((s) => ({ x: s.x, z: s.z }));
    centres.push(...pools);
    const lavaMat = this.material(
      { roughness: 0.5, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 },
      { glow: 1.5 },
    );
    this.add(lavaCrackGeometry(centres, (x, z) => this.ground(x, z), seed + 190), lavaMat, [{ x: 0, y: 0, z: 0, s: 1, ry: 0 }], 'lava-cracks');
    const lava = new Color('#ff5a1f');
    for (const c of centres) {
      if (c.z < -12) continue;
      this.glowPoints.push({ p: new Vector3(c.x, this.ground(c.x, c.z) + 1.4, c.z + 1), color: lava, power: 30, distance: 15, flicker: 0.25 });
    }
  }
}
