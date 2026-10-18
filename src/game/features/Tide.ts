import type { Fish } from '../entities/Fish';
import { FeatureBase } from './FeatureBase';
import { tideSurface } from './helpers';
import { Seabirds } from './Seabirds';
import type { FeatureHud } from './types';

export const TIDE = {
  period: 45,
  /** Low water as a share of the full height. */
  low: 0.7,
  /** Counts as low tide (for the challenge) below this share of the way down. */
  lowShare: 0.6,
  /** Seabirds dive at the player while the tide is low. */
  birds: false,
};

/** Mangrove Lagoon: the water level rises and falls, squeezing everyone together. */
export class TideFeature extends FeatureBase {
  private readonly cfg = this.opts(TIDE);
  private level = 1;
  private falling = true;
  private birds: Seabirds | null = null;

  /** 0 at high water, 1 at low water. */
  private get ebb(): number {
    return 1 - this.level;
  }

  build(): void {
    if (this.cfg.birds) this.birds = new Seabirds(this.world, this.group, this.rng);
  }

  update(dt: number): void {
    super.update(dt);
    const w = this.world;
    const H = w.level.world.height;
    const y = tideSurface(this.time, this.cfg.period, H, this.cfg.low);
    const prev = this.level;
    this.level = (y - H * this.cfg.low) / (H * (1 - this.cfg.low));
    w.setSurfaceY(y);
    const falling = this.level < prev;
    if (falling !== this.falling && this.time > 1 && w.mode === 'play') {
      w.events.emit('feature', { kind: falling ? 'tideHigh' : 'tideLow', x: w.player.x, y });
    }
    this.falling = falling;
    this.birds?.update(dt, this.ebb >= this.cfg.lowShare, this.playing);
  }

  onEat(_f: Fish): void {
    if (this.ebb >= this.cfg.lowShare) this.world.stat('lowTideEat');
  }

  render(): void {
    this.birds?.render(this.time);
  }

  hud(): FeatureHud | null {
    if (this.world.mode !== 'play') return null;
    if (this.birds?.warning) return { label: 'Seabird diving!', tone: 'tide', alarm: true };
    return { label: this.falling ? 'Tide falling' : 'Tide rising', value: this.level, tone: 'tide', alarm: this.ebb >= this.cfg.lowShare };
  }

  dispose(): void {
    this.birds?.dispose();
    super.dispose();
  }
}
