/** Small seeded PRNG (mulberry32) so procedural scenery is repeatable per level. */
export class Rng {
  private s: number;

  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }

  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Inclusive integer range. */
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1 - 1e-9));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  sign(): 1 | -1 {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }

  weighted<T>(items: readonly { w: number; v: T }[]): T {
    let total = 0;
    for (const it of items) total += Math.max(0, it.w);
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, it.w);
      if (r <= 0) return it.v;
    }
    return items[items.length - 1].v;
  }

  /** Roughly normal distribution around 0 with the given spread. */
  gauss(spread = 1): number {
    return ((this.next() + this.next() + this.next()) / 3 - 0.5) * 2 * spread;
  }

  fork(): Rng {
    return new Rng(Math.floor(this.next() * 4294967296));
  }
}

export const rng = new Rng((Date.now() ^ 0x9e3779b9) >>> 0);
