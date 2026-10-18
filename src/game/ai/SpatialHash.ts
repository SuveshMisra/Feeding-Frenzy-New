export interface Positioned {
  x: number;
  y: number;
}

/** Uniform grid for neighbour queries; rebuilt every step. */
export class SpatialHash<T extends Positioned> {
  private readonly cells = new Map<number, T[]>();
  private readonly pool: T[][] = [];

  constructor(readonly cellSize = 2.5) {}

  private key(cx: number, cy: number): number {
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  clear(): void {
    for (const list of this.cells.values()) {
      list.length = 0;
      this.pool.push(list);
    }
    this.cells.clear();
  }

  insert(item: T): void {
    const k = this.key(Math.floor(item.x / this.cellSize), Math.floor(item.y / this.cellSize));
    let list = this.cells.get(k);
    if (!list) {
      list = this.pool.pop() ?? [];
      this.cells.set(k, list);
    }
    list.push(item);
  }

  /** Calls `fn` for every item within `radius` of (x, y). */
  query(x: number, y: number, radius: number, fn: (item: T, distSq: number) => void): void {
    const cs = this.cellSize;
    const x0 = Math.floor((x - radius) / cs);
    const x1 = Math.floor((x + radius) / cs);
    const y0 = Math.floor((y - radius) / cs);
    const y1 = Math.floor((y + radius) / cs);
    const r2 = radius * radius;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (const item of list) {
          const dx = item.x - x;
          const dy = item.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) fn(item, d2);
        }
      }
    }
  }
}
