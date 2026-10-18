import type { Fish } from '../entities/Fish';
import type { FishDrawer } from '../../render/FishDrawer';

/** Each level's signature mechanic. */
export type FeatureId = 'puffer' | 'kelpHide' | 'eels' | 'icicles' | 'darkness' | 'tide' | 'currents' | 'guardians' | 'crystals' | 'heat';

export type FeatureTone = 'hidden' | 'light' | 'tide' | 'heat' | 'current';

/** Optional HUD readout under the growth bar. Without `value` it is drawn as a chip. */
export interface FeatureHud {
  label: string;
  value?: number;
  tone: FeatureTone;
  /** Pulses the meter (low light, heat almost full). */
  alarm?: boolean;
}

export interface FlowVec {
  x: number;
  y: number;
}

export interface LevelFeature {
  readonly id: FeatureId;
  build(): void;
  /** Fixed step, called after the player moves and before fish AI. */
  update(dt: number): void;
  render(alpha: number, dt: number): void;
  dispose(): void;
  hud(): FeatureHud | null;
  /** Water current at a point, added to fish and player motion. */
  flowAt?(x: number, y: number, out: FlowVec): FlowVec;
  /** Called when the player eats a fish, before it is removed. */
  onEat?(f: Fish): void;
  setViewport?(heightPx: number, fovDeg: number, dpr: number): void;
  /** True when biting this (edible) fish should hurt the player instead. */
  stings?(f: Fish): boolean;
  /** Draws feature-owned fish; called inside the world's fish pass. */
  drawFish?(drawer: FishDrawer, alpha: number): void;
}
