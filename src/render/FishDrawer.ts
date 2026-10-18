import { Euler, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import { isHero, type SpeciesDef, type SpeciesId } from '../config/species';
import { easeOutBack, lerp } from '../engine/math';
import type { FishFactory, FishPool } from '../art/fish/FishFactory';

export interface DrawableFish {
  readonly def: SpeciesDef;
  x: number;
  y: number;
  z: number;
  prevX: number;
  prevY: number;
  yaw: number;
  pitch: number;
  roll: number;
  len: number;
  phase: number;
  readonly swimAmp: number;
  jaw: number;
  alert: number;
  flash: number;
  /** Above 0 tints gold, below 0 darkens. */
  tint?: number;
}

const CAPACITY_BY_TIER = [0, 160, 72, 48, 12];

/** Draws fish entities through one instanced pool per species. */
export class FishDrawer {
  private readonly pools = new Map<SpeciesId, FishPool>();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler(0, 0, 0, 'YZX');
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  constructor(
    private readonly factory: FishFactory,
    private readonly parent: Object3D,
    private readonly shadows: boolean,
  ) {}

  pool(id: SpeciesId, capacity?: number): FishPool {
    let pool = this.pools.get(id);
    if (!pool) {
      const def = this.factory.asset(id).def;
      pool = this.factory.pool(id, capacity ?? (isHero(def) ? 2 : CAPACITY_BY_TIER[def.tier]), this.shadows);
      pool.addTo(this.parent);
      this.pools.set(id, pool);
    }
    return pool;
  }

  prepare(ids: Iterable<SpeciesId>): void {
    for (const id of ids) this.pool(id);
  }

  begin(): void {
    for (const p of this.pools.values()) p.begin();
  }

  draw(f: DrawableFish, alpha: number, appear = 1, scaleMul = 1): void {
    const pool = this.pool(f.def.id);
    this.p.set(lerp(f.prevX, f.x, alpha), lerp(f.prevY, f.y, alpha), f.z);
    this.e.set(f.roll, f.yaw, f.pitch, 'YZX');
    this.q.setFromEuler(this.e);
    const a = appear >= 1 ? 1 : Math.max(0.001, easeOutBack(appear));
    this.s.setScalar(f.len * a * scaleMul);
    this.m.compose(this.p, this.q, this.s);
    pool.push(this.m, f.phase, f.swimAmp, f.jaw, f.alert, f.flash, f.tint ?? 0);
  }

  end(): void {
    for (const p of this.pools.values()) p.end();
  }

  dispose(): void {
    for (const p of this.pools.values()) p.dispose();
    this.pools.clear();
  }
}
