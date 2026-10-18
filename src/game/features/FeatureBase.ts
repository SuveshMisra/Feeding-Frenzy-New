import { Group } from 'three';
import { Rng } from '../../engine/rng';
import type { World } from '../World';
import type { FeatureHud, FeatureId, LevelFeature } from './types';

/** Shared plumbing for level features: a scene group, a seeded rng and disposal. */
export abstract class FeatureBase implements LevelFeature {
  readonly group = new Group();
  protected readonly rng: Rng;
  protected readonly disposables: { dispose(): void }[] = [];
  protected time = 0;

  constructor(
    protected readonly world: World,
    readonly id: FeatureId,
  ) {
    this.rng = new Rng(world.level.seed + 913);
    world.scene.add(this.group);
  }

  /** The player is in control and the level is running. */
  protected get playing(): boolean {
    const w = this.world;
    return w.mode === 'play' && w.started && w.phase === 'play';
  }

  /**
   * Hazards hold off: during the level intro, so nothing fires the moment control starts,
   * and behind the menus, which should stay calm.
   */
  protected get dormant(): boolean {
    return this.world.mode !== 'play' || !this.world.started;
  }

  /** Close enough to the camera to be worth animating effects and sounds for. */
  protected near(x: number, extra = 0.8): boolean {
    const r = this.world.rig;
    return Math.abs(x - r.center.x) < r.viewW * extra;
  }

  /** The feature's tuning with the level's `featureOpts` merged over it. */
  protected opts<T extends object>(defaults: T): T {
    return { ...defaults, ...(this.world.level.featureOpts ?? {}) } as T;
  }

  protected get startX(): number {
    return -this.world.level.world.width / 2 + 14;
  }

  protected track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  build(): void {}

  update(dt: number): void {
    this.time += dt;
  }

  render(_alpha: number, _dt: number): void {}

  hud(): FeatureHud | null {
    return null;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
