export type UpdateFn = (dt: number) => void;
/** alpha: interpolation factor between the last two simulation steps. */
export type RenderFn = (alpha: number, scaledDt: number, realDt: number) => void;

/**
 * Fixed 60 Hz simulation with an accumulator, rendering at display rate.
 * `timeScale` slows the simulation (and scaled render time) for slow-motion moments.
 */
export class Loop {
  readonly step = 1 / 60;
  timeScale = 1;
  simulate = true;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;

  constructor(
    private readonly update: UpdateFn,
    private readonly render: RenderFn,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    // Some embedded browsers hand rAF a timestamp that runs ahead of the wall clock.
    const now = performance.now();
    let frame = (now - this.last) / 1000;
    this.last = now;
    if (!(frame > 0)) frame = 0;
    if (frame > 0.25) frame = 0.25;

    const scaled = frame * this.timeScale;
    if (this.simulate) {
      this.acc += scaled;
      let steps = 0;
      while (this.acc >= this.step && steps < 8) {
        this.update(this.step);
        this.acc -= this.step;
        steps++;
      }
      if (steps >= 8) this.acc = 0;
    } else {
      this.acc = 0;
    }
    this.render(this.simulate ? this.acc / this.step : 1, this.simulate ? scaled : 0, frame);
  };
}
