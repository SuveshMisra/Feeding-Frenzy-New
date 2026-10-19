import { SPECIES, type SpeciesId } from '../../config/species';
import type { LevelDef } from '../../config/levels';
import { SPAWN, STAGE_COUNT, type Stage, type Tier } from '../../config/tuning';
import { clamp } from '../../engine/math';
import { Rng } from '../../engine/rng';
import { Fish, type School } from '../entities/Fish';
import { edibleTierWeights, isThreat, threatTierWeights } from './FoodChain';
import type { ViewRect } from '../../render/CameraRig';

export interface SpawnWorld {
  minX: number;
  maxX: number;
  surfaceY: number;
  floorAt(x: number): number;
}

export interface SpawnContext {
  stage: Stage;
  playerX: number;
  playerY: number;
  view: ViewRect;
  detectRadius: number;
  /** When false (title screen) threats are spawned but the player is ignored. */
  hasPlayer: boolean;
}

let schoolId = 1;

/** Rare golden fish: at most one at a time, every `interval` seconds while playing. */
export const GOLDEN = { first: [25, 45] as const, interval: [40, 70] as const, speedMul: 1.4, coins: 25 };

/** Keeps edible fish and threats around the camera at the level's target counts. */
export class Spawner {
  readonly fish: Fish[] = [];
  readonly schools: School[] = [];
  private timer = 0;
  private threatGap = 0;
  private edibleTarget = 14;
  private lastStage: Stage = 1;
  private goldenTimer: number;
  private readonly rng: Rng;
  /** Threats kept around on top of the level's count (endless danger). */
  extraThreats = 0;
  onSpawn: ((f: Fish) => void) | null = null;
  onRemove: ((f: Fish) => void) | null = null;

  constructor(
    private readonly level: LevelDef,
    private readonly world: SpawnWorld,
    seed = level.seed,
  ) {
    this.rng = new Rng(seed * 7 + 3);
    this.rollTarget(1);
    this.goldenTimer = this.rng.range(GOLDEN.first[0], GOLDEN.first[1]);
  }

  private rollTarget(stage: Stage): void {
    const [lo, hi] = SPAWN.edibleByStage[stage - 1];
    this.edibleTarget = this.rng.int(lo, hi);
    this.lastStage = stage;
  }

  threatTarget(stage: Stage): number {
    return (this.level.difficulty.predators[stage - 1] ?? 0) + this.extraThreats;
  }

  counts(stage: Stage): { edible: number; threats: number } {
    let edible = 0;
    let threats = 0;
    for (const f of this.fish) {
      if (!f.alive) continue;
      if (isThreat(stage, f.tier)) threats++;
      else edible++;
    }
    return { edible, threats };
  }

  /** Fills the area around the camera at level start. */
  populate(ctx: SpawnContext): void {
    const { edible, threats } = this.counts(ctx.stage);
    let need = this.edibleTarget - edible;
    let guard = 0;
    while (need > 0 && guard++ < 120) need -= this.spawnEdible(ctx, true);
    let t = this.threatTarget(ctx.stage) - threats;
    guard = 0;
    while (t > 0 && guard++ < 20) {
      if (this.spawnThreat(ctx, true)) t--;
    }
  }

  update(dt: number, ctx: SpawnContext): void {
    if (ctx.stage !== this.lastStage) {
      const apex = ctx.stage === STAGE_COUNT && ctx.stage > this.lastStage;
      this.rollTarget(ctx.stage);
      if (apex && ctx.hasPlayer) this.spawnApexWave(ctx);
    }
    this.despawn(ctx);
    if (ctx.hasPlayer) {
      this.goldenTimer -= dt;
      if (this.goldenTimer <= 0) {
        const swimming = this.fish.some((f) => f.alive && f.golden);
        this.goldenTimer = swimming ? 5 : this.spawnGolden(ctx) ? this.rng.range(GOLDEN.interval[0], GOLDEN.interval[1]) : 3;
      }
    }
    this.threatGap -= dt;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = SPAWN.interval;
    const { edible, threats } = this.counts(ctx.stage);
    if (edible < this.edibleTarget) {
      const added = this.spawnEdible(ctx, false);
      if (edible + added < this.edibleTarget * SPAWN.refillBelow) this.spawnEdible(ctx, false);
    } else if (threats < this.threatTarget(ctx.stage) && this.threatGap <= 0 && this.spawnThreat(ctx, false)) {
      const [lo, hi] = SPAWN.threatGap;
      this.threatGap = this.rng.range(lo, hi) * Math.max(0.4, 1 - this.level.index * SPAWN.threatGapLevelCut);
    }
  }

  private pickSpecies(tier: Tier): SpeciesId | null {
    const list = this.level.roster[tier];
    if (!list || list.length === 0) return null;
    return this.rng.pick(list);
  }

  private bandFor(id: SpeciesId): [number, number] {
    const d = SPECIES[id].depth;
    const h = this.world.surfaceY;
    return [Math.max(1.2, d[0] * h), Math.min(h - 1.2, d[1] * h)];
  }

  /** Returns how many fish were spawned. */
  private spawnEdible(ctx: SpawnContext, initial: boolean): number {
    const tier = this.rng.weighted(edibleTierWeights(ctx.stage));
    const id = this.pickSpecies(tier) ?? this.pickSpecies(1);
    if (!id) return 0;
    const def = SPECIES[id];
    const spot = this.spawnSpot(ctx, id, initial, false);
    if (!spot) return 0;
    if (def.behavior === 'school') {
      const [lo, hi] = SPAWN.schoolSizeByStage[ctx.stage - 1];
      const n = this.rng.int(lo, hi);
      const school: School = {
        id: schoolId++,
        members: [],
        goalX: spot.x,
        goalY: spot.y,
        heading: spot.dir > 0 ? 0 : Math.PI,
        panic: 0,
      };
      const [bMin, bMax] = this.bandFor(id);
      for (let i = 0; i < n; i++) {
        const f = new Fish(def, this.rng.range(0.9, 1.12));
        const ox = this.rng.gauss(1.6);
        const oy = this.rng.gauss(1.1);
        const y = clamp(spot.y + oy, bMin, bMax);
        f.place(spot.x + ox, y, spot.dir * def.speed.cruise, 0);
        f.bandMin = bMin;
        f.bandMax = bMax;
        f.z = this.rng.range(-0.6, 0.4);
        f.school = school;
        f.appear = initial ? 1 : 0;
        school.members.push(f);
        this.add(f);
      }
      this.schools.push(school);
      return n;
    }
    this.spawnSingle(id, spot, initial);
    return 1;
  }

  private spawnThreat(ctx: SpawnContext, initial: boolean): boolean {
    const weights = threatTierWeights(ctx.stage).filter((w) => (this.level.roster[w.v]?.length ?? 0) > 0);
    if (weights.length === 0) return false;
    const tier = this.rng.weighted(weights);
    const id = this.pickSpecies(tier);
    if (!id) return false;
    const spot = this.spawnSpot(ctx, id, initial, true);
    if (!spot) return false;
    this.spawnSingle(id, spot, initial);
    return true;
  }

  /**
   * Reaching the apex sends in the big fish at once: the leftover fry would otherwise fill the
   * edible target and the wide apex view rarely lets them despawn.
   */
  private spawnApexWave(ctx: SpawnContext): void {
    for (let i = 0; i < SPAWN.apexWave; i++) {
      const id = this.pickSpecies(i % 2 === 0 ? 4 : 3) ?? this.pickSpecies(3);
      if (!id) return;
      const spot = this.spawnSpot(ctx, id, false, false);
      if (spot) this.spawnSingle(id, spot, false);
    }
  }

  /** A golden version of the biggest fish the player can eat right now. */
  private spawnGolden(ctx: SpawnContext): boolean {
    const id = this.pickSpecies(ctx.stage) ?? this.pickSpecies(1);
    if (!id) return false;
    const spot = this.spawnSpot(ctx, id, false, false);
    if (!spot) return false;
    this.spawnSingle(id, spot, false, (f) => {
      f.golden = true;
      f.tint = 1;
      f.speedMul = GOLDEN.speedMul;
    });
    return true;
  }

  /** One extra fish at a set point (kept inside the world and the species' depth band). */
  spawnNear(id: SpeciesId, x: number, y: number, dir: 1 | -1, appear = 0): Fish {
    const [bMin, bMax] = this.bandFor(id);
    const W = this.level.world.width;
    const f = this.spawnSingle(id, { x: clamp(x, -W / 2 + 2, W / 2 - 2), y: clamp(y, bMin, bMax), dir }, false);
    f.appear = appear;
    return f;
  }

  /**
   * A whole school of `id` around (x, y) that keeps to a band `band` tall around that depth
   * (a boss's swarm, a bait ball). Returns the school.
   */
  spawnSchool(id: SpeciesId, x: number, y: number, n: number, dir: 1 | -1, spread = 1.6, band = 6, appear = 0): School {
    const def = SPECIES[id];
    const W = this.level.world.width;
    const cx = clamp(x, -W / 2 + 3, W / 2 - 3);
    const floor = this.world.floorAt(cx) + 1;
    const top = this.world.surfaceY - 1.2;
    const cy = clamp(y, floor, top);
    const bMin = clamp(cy - band / 2, floor, top);
    const bMax = clamp(cy + band / 2, bMin + 0.5, top);
    const school: School = { id: schoolId++, members: [], goalX: cx, goalY: cy, heading: dir > 0 ? 0 : Math.PI, panic: 0 };
    for (let i = 0; i < n; i++) {
      const f = new Fish(def, this.rng.range(0.9, 1.12));
      f.place(cx + this.rng.gauss(spread), clamp(cy + this.rng.gauss(spread * 0.7), bMin, bMax), dir * def.speed.cruise, 0);
      f.bandMin = bMin;
      f.bandMax = bMax;
      f.z = this.rng.range(-0.6, 0.4);
      f.school = school;
      f.appear = appear;
      school.members.push(f);
      this.add(f);
    }
    this.schools.push(school);
    return school;
  }

  private spawnSingle(id: SpeciesId, spot: { x: number; y: number; dir: 1 | -1 }, initial: boolean, setup?: (f: Fish) => void): Fish {
    const def = SPECIES[id];
    const f = new Fish(def, this.rng.range(0.92, 1.08));
    setup?.(f);
    const [bMin, bMax] = this.bandFor(id);
    f.place(spot.x, spot.y, spot.dir * def.speed.cruise, 0);
    f.bandMin = bMin;
    f.bandMax = bMax;
    f.z = def.tier >= 4 ? -0.9 - this.rng.next() * 0.4 : this.rng.range(-0.7, 0.3);
    f.appear = initial ? 1 : 0;
    this.add(f);
    return f;
  }

  private add(f: Fish): void {
    this.fish.push(f);
    this.onSpawn?.(f);
  }

  /**
   * Picks a point just outside the camera view (or anywhere around it for the initial fill)
   * inside the species' depth band. Threats keep a safe distance from the player.
   */
  private spawnSpot(
    ctx: SpawnContext,
    id: SpeciesId,
    initial: boolean,
    threat: boolean,
  ): { x: number; y: number; dir: 1 | -1 } | null {
    const def = SPECIES[id];
    const v = ctx.view;
    const w = this.world;
    const [bMin, bMax] = this.bandFor(id);
    const safe = ctx.detectRadius * SPAWN.threatSafeMultiplier + def.length * 0.5;
    for (let attempt = 0; attempt < 12; attempt++) {
      let x: number;
      let dir: 1 | -1;
      const margin = SPAWN.spawnMargin + def.length * 0.6;
      if (initial && !threat) {
        const span = (v.x1 - v.x0) * 0.5 + 6;
        x = (v.x0 + v.x1) / 2 + this.rng.range(-span, span);
        dir = this.rng.sign();
      } else {
        const side = this.rng.sign();
        x = side < 0 ? v.x0 - margin - this.rng.range(0, 4) : v.x1 + margin + this.rng.range(0, 4);
        if (initial) x += side * this.rng.range(2, 10);
        dir = side < 0 ? 1 : -1;
      }
      if (x < w.minX + 2 || x > w.maxX - 2) {
        // Mirror to the other side when the view is against a wall.
        x = (v.x0 + v.x1) - x;
        dir = dir > 0 ? -1 : 1;
        if (x < w.minX + 2 || x > w.maxX - 2) continue;
      }
      const floor = w.floorAt(x) + 1;
      let lo = Math.max(bMin, floor);
      let hi = Math.max(lo + 0.5, bMax);
      // Prefer depths the player can currently see, so food keeps crossing the screen.
      const vlo = Math.max(lo, v.y0 + 1);
      const vhi = Math.min(hi, v.y1 - 1);
      if (vhi - vlo > 1 && (!threat || this.rng.chance(0.6))) {
        lo = vlo;
        hi = vhi;
      }
      const y = this.rng.range(lo, hi);
      if (ctx.hasPlayer) {
        const d = Math.hypot(x - ctx.playerX, y - ctx.playerY);
        if (threat && d < safe) continue;
        if (!threat && d < 3) continue;
      }
      return { x, y, dir };
    }
    return null;
  }

  private despawn(ctx: SpawnContext): void {
    const v = ctx.view;
    const m = SPAWN.despawnMargin;
    for (let i = this.fish.length - 1; i >= 0; i--) {
      const f = this.fish[i];
      let remove = !f.alive;
      if (!remove) {
        const out = f.x < v.x0 - m || f.x > v.x1 + m || f.y < v.y0 - m * 0.6 || f.y > v.y1 + m * 0.6;
        const hunting = f.brain?.hunting ?? false;
        remove = out && !hunting;
      }
      if (remove) {
        this.fish.splice(i, 1);
        f.alive = false;
        this.onRemove?.(f);
      }
    }
    for (let i = this.schools.length - 1; i >= 0; i--) {
      const s = this.schools[i];
      s.members = s.members.filter((m2) => m2.alive);
      if (s.members.length === 0) this.schools.splice(i, 1);
    }
  }

  clear(): void {
    for (const f of this.fish) {
      f.alive = false;
      this.onRemove?.(f);
    }
    this.fish.length = 0;
    this.schools.length = 0;
  }
}
