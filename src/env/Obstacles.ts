import { Box3, Matrix4, Vector3, type InstancedMesh } from 'three';
import { clamp } from '../engine/math';

/**
 * A coarse map of what the background animals must not swim through: the seabed and
 * everything standing on it, and whatever hangs down from the surface (ice, brinicles).
 */
export class ObstacleMap {
  private readonly nx: number;
  private readonly nz: number;
  /** Highest solid point per cell, seabed included. */
  private readonly top: Float32Array;
  /** Lowest point of anything hanging from the surface per cell (Infinity where none). */
  private readonly low: Float32Array;

  constructor(
    private readonly x0: number,
    x1: number,
    private readonly z0: number,
    z1: number,
    ground: (x: number, z: number) => number,
    /** Height of the surface or ceiling things hang from; null when there is none. */
    private readonly surface: number | null,
    private readonly cell = 1,
  ) {
    this.nx = Math.ceil((x1 - x0) / cell) + 1;
    this.nz = Math.ceil((z1 - z0) / cell) + 1;
    this.top = new Float32Array(this.nx * this.nz);
    this.low = new Float32Array(this.nx * this.nz).fill(Infinity);
    for (let k = 0; k < this.nz; k++) {
      for (let i = 0; i < this.nx; i++) this.top[k * this.nx + i] = ground(x0 + i * cell, z0 + k * cell);
    }
  }

  /**
   * Adds every instance of a prop mesh by its vertices, so a tower's spreading tables don't
   * block the open water between them. Instances that reach the surface without touching the
   * seabed hang from it.
   */
  addInstances(mesh: InstancedMesh): void {
    const geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const pos = geo.attributes.position;
    const m = new Matrix4();
    const b = new Box3();
    const v = new Vector3();
    for (let n = 0; n < mesh.count; n++) {
      mesh.getMatrixAt(n, m);
      b.copy(geo.boundingBox!).applyMatrix4(m);
      const hangs = this.surface !== null && b.max.y > this.surface - 1.5 && b.min.y > this.at((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2) + 1;
      for (let p = 0; p < pos.count; p++) {
        v.fromBufferAttribute(pos, p).applyMatrix4(m);
        const i = Math.round((v.x - this.x0) / this.cell);
        const k = Math.round((v.z - this.z0) / this.cell);
        if (i < 0 || i >= this.nx || k < 0 || k >= this.nz) continue;
        const j = k * this.nx + i;
        if (hangs) this.low[j] = Math.min(this.low[j], v.y);
        else this.top[j] = Math.max(this.top[j], v.y);
      }
    }
  }

  private at(x: number, z: number): number {
    const i = clamp(Math.round((x - this.x0) / this.cell), 0, this.nx - 1);
    const k = clamp(Math.round((z - this.z0) / this.cell), 0, this.nz - 1);
    return this.top[k * this.nx + i];
  }

  /** Highest solid point within the box of half extents (rx, rz) around (x, z). */
  floor(x: number, z: number, rx: number, rz: number): number {
    const { i0, i1, k0, k1 } = this.span(x, z, rx, rz);
    let h = -Infinity;
    for (let k = k0; k <= k1; k++) {
      for (let j = k * this.nx + i0, end = k * this.nx + i1; j <= end; j++) if (this.top[j] > h) h = this.top[j];
    }
    return h;
  }

  /** Lowest hanging point within the box of half extents (rx, rz) around (x, z), or Infinity. */
  ceiling(x: number, z: number, rx: number, rz: number): number {
    const { i0, i1, k0, k1 } = this.span(x, z, rx, rz);
    let h = Infinity;
    for (let k = k0; k <= k1; k++) {
      for (let j = k * this.nx + i0, end = k * this.nx + i1; j <= end; j++) if (this.low[j] < h) h = this.low[j];
    }
    return h;
  }

  private span(x: number, z: number, rx: number, rz: number): { i0: number; i1: number; k0: number; k1: number } {
    return {
      i0: Math.max(0, Math.floor((x - rx - this.x0) / this.cell)),
      i1: Math.min(this.nx - 1, Math.ceil((x + rx - this.x0) / this.cell)),
      k0: Math.max(0, Math.floor((z - rz - this.z0) / this.cell)),
      k1: Math.min(this.nz - 1, Math.ceil((z + rz - this.z0) / this.cell)),
    };
  }
}

/**
 * Heights for a looping swim path: `cruise` where the way is clear, rising over `floor` and
 * dipping under `ceiling` (one sample per step, wrapping around). Climbs and dives start early
 * so they slope by at most `slope` per step. Where the two clash, the path goes over.
 */
export function swimHeights(cruise: number, floor: ArrayLike<number>, ceiling: ArrayLike<number>, slope: number): Float32Array {
  const n = floor.length;
  const out = new Float32Array(n);
  const reach = Math.ceil(30 / slope);
  for (let i = 0; i < n; i++) {
    let up = -Infinity;
    let down = Infinity;
    for (let d = -Math.min(reach, n - 1); d <= Math.min(reach, n - 1); d++) {
      const j = (((i + d) % n) + n) % n;
      const ramp = Math.abs(d) * slope;
      up = Math.max(up, floor[j] - ramp);
      down = Math.min(down, ceiling[j] + ramp);
    }
    out[i] = Math.max(up, Math.min(cruise, down));
  }
  return out;
}
