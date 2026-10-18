import { LIVES } from '../../config/tuning';

export class Lives {
  count: number;
  deaths = 0;

  constructor(
    readonly start = LIVES.start,
    readonly max = LIVES.max,
  ) {
    this.count = start;
  }

  get gameOver(): boolean {
    return this.count <= 0;
  }

  /** Removes a life. Returns true when that was the last one. */
  lose(): boolean {
    if (this.count <= 0) return true;
    this.count--;
    this.deaths++;
    return this.count <= 0;
  }

  /** Adds a life. Returns false when already at the cap (caller can award points instead). */
  gain(): boolean {
    if (this.count >= this.max) return false;
    this.count++;
    return true;
  }

  reset(): void {
    this.count = this.start;
    this.deaths = 0;
  }
}
