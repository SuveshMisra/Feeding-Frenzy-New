import type { QualitySetting } from './Save';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  level: QualityLevel;
  maxDpr: number;
  /** Renders above the screen's pixel ratio (up to maxDpr) for supersampled edges. */
  supersample: number;
  shadows: boolean;
  shadowMapSize: number;
  /** MeshPhysicalMaterial (clearcoat, iridescence) for fish. */
  physical: boolean;
  detailNormals: boolean;
  /** Painted fish texture resolution multiplier. */
  fishTexScale: number;
  dof: boolean;
  /** Screen-space ambient occlusion (costs an extra normals render of the scene). */
  ao: boolean;
  aoResolution: number;
  smaa: boolean;
  smaaQuality: 'medium' | 'ultra';
  bloom: boolean;
  underwater: boolean;
  propDensity: number;
  terrainDetail: number;
  particles: number;
  snow: number;
  causticsSize: number;
  causticsInterval: number;
  shafts: boolean;
}

export const PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    level: 'low',
    maxDpr: 1,
    supersample: 1,
    shadows: false,
    shadowMapSize: 512,
    physical: false,
    detailNormals: false,
    fishTexScale: 1,
    dof: false,
    ao: false,
    aoResolution: 0.5,
    smaa: false,
    smaaQuality: 'medium',
    bloom: true,
    underwater: false,
    propDensity: 0.45,
    terrainDetail: 0.55,
    particles: 0.5,
    snow: 0.4,
    causticsSize: 256,
    causticsInterval: 2,
    shafts: false,
  },
  medium: {
    level: 'medium',
    maxDpr: 1.5,
    supersample: 1,
    shadows: true,
    shadowMapSize: 1024,
    physical: true,
    detailNormals: true,
    fishTexScale: 1,
    dof: false,
    ao: false,
    aoResolution: 0.5,
    smaa: true,
    smaaQuality: 'medium',
    bloom: true,
    underwater: true,
    propDensity: 0.75,
    terrainDetail: 0.8,
    particles: 0.8,
    snow: 0.7,
    causticsSize: 512,
    causticsInterval: 1,
    shafts: true,
  },
  high: {
    level: 'high',
    maxDpr: 2,
    supersample: 1,
    shadows: true,
    shadowMapSize: 2048,
    physical: true,
    detailNormals: true,
    fishTexScale: 2,
    dof: true,
    ao: true,
    aoResolution: 0.5,
    smaa: true,
    smaaQuality: 'medium',
    bloom: true,
    underwater: true,
    propDensity: 1,
    terrainDetail: 1,
    particles: 1,
    snow: 1,
    causticsSize: 512,
    causticsInterval: 1,
    shafts: true,
  },
  ultra: {
    level: 'ultra',
    maxDpr: 3,
    supersample: 1.5,
    shadows: true,
    shadowMapSize: 4096,
    physical: true,
    detailNormals: true,
    fishTexScale: 2,
    dof: true,
    ao: true,
    aoResolution: 1,
    smaa: true,
    smaaQuality: 'ultra',
    bloom: true,
    underwater: true,
    propDensity: 1.3,
    terrainDetail: 1.3,
    particles: 1.3,
    snow: 1.4,
    causticsSize: 1024,
    causticsInterval: 1,
    shafts: true,
  },
};

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 1);
}

/** Starting level for the 'auto' setting. */
export function detectDefault(): QualityLevel {
  if (typeof navigator === 'undefined') return 'high';
  const cores = navigator.hardwareConcurrency ?? 4;
  if (isTouchDevice()) return cores >= 8 ? 'medium' : 'low';
  return cores <= 2 ? 'medium' : 'high';
}

export function resolveQuality(setting: QualitySetting): QualityLevel {
  return setting === 'auto' ? detectDefault() : setting;
}

export function lowerLevel(level: QualityLevel): QualityLevel | null {
  return level === 'ultra' ? 'high' : level === 'high' ? 'medium' : level === 'medium' ? 'low' : null;
}

/**
 * Watches frame times while playing on 'auto'. When the average stays above the budget
 * for a few seconds it asks for a cheaper preset (never upgrades on its own).
 */
export class AdaptiveQuality {
  enabled = false;
  private acc = 0;
  private frames = 0;
  private slowTime = 0;
  private cooldown = 4;

  constructor(
    private readonly onDowngrade: () => void,
    private readonly budgetMs = 20,
  ) {}

  reset(): void {
    this.acc = 0;
    this.frames = 0;
    this.slowTime = 0;
    this.cooldown = 4;
  }

  sample(realDt: number): void {
    if (!this.enabled) return;
    if (this.cooldown > 0) {
      this.cooldown -= realDt;
      return;
    }
    // Ignore hitches from tab switches.
    if (realDt > 0.2) return;
    this.acc += realDt;
    this.frames++;
    if (this.acc < 0.5) return;
    const avgMs = (this.acc / this.frames) * 1000;
    if (avgMs > this.budgetMs) this.slowTime += this.acc;
    else this.slowTime = Math.max(0, this.slowTime - this.acc * 0.5);
    this.acc = 0;
    this.frames = 0;
    if (this.slowTime > 3) {
      this.slowTime = 0;
      this.cooldown = 6;
      this.onDowngrade();
    }
  }
}
