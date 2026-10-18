import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  PointLight,
  Vector3,
  type Mesh,
  type Object3D,
  type PerspectiveCamera,
  type Points,
  type ShaderMaterial,
} from 'three';
import type { BiomeDef, LevelDef } from '../config/levels';
import { resolveBiome } from '../config/levels';
import { shared } from '../engine/materialPatches';
import type { QualityPreset } from '../app/Quality';
import { TerrainShape, buildTerrainMesh } from './Terrain';
import { buildBackdrop, buildCaveCeiling, buildMarineSnow, buildWaterSurface } from './Sky';
import { BiomeBuilder } from './BiomeBuilder';

export interface EnvUpdate {
  time: number;
  dt: number;
  camera: PerspectiveCamera;
  playerX: number;
  playerY: number;
  /** False in attract mode or while the player is hidden (no see-through window). */
  hasPlayer: boolean;
  viewW: number;
  viewH: number;
}

/** A piece of scenery with optional per-frame animation. */
export interface EnvLayer {
  object?: Object3D;
  update?(u: EnvUpdate): void;
  dispose(): void;
}

const SUN_DIR = new Vector3(-0.32, 1, 0.42).normalize();

/** Everything that makes a biome: lights, fog, terrain, sky, particles and props. */
export class Environment {
  readonly group = new Group();
  readonly biome: BiomeDef;
  readonly terrain: TerrainShape;
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly playerLight: PointLight;
  /** Pool of lights for glowing things (lures, vents) near the camera. */
  readonly glowLights: PointLight[] = [];
  private readonly backdrop: Mesh;
  private readonly snow: Points;
  private readonly layers: EnvLayer[] = [];
  private readonly surface: Object3D | null;
  private shadowSpan = 0;

  constructor(
    readonly level: LevelDef,
    quality: QualityPreset,
  ) {
    const biome = (this.biome = resolveBiome(level));
    this.applyFog();
    this.terrain = new TerrainShape(level, biome);

    this.sun = new DirectionalLight(biome.sun.color, biome.sun.intensity);
    this.sun.castShadow = quality.shadows;
    if (quality.shadows) {
      this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.04;
      this.sun.shadow.radius = 4;
      this.sun.shadow.camera.near = 1;
      this.sun.shadow.camera.far = 160;
    }
    this.group.add(this.sun, this.sun.target);
    this.hemi = new HemisphereLight(biome.hemi.sky, biome.hemi.ground, biome.hemi.intensity);
    this.group.add(this.hemi);
    this.playerLight = new PointLight('#bfe8ff', biome.playerLight * 6, 16, 1.6);
    this.playerLight.visible = biome.playerLight > 0;
    this.group.add(this.playerLight);
    for (let i = 0; i < 3; i++) {
      const l = new PointLight('#ffd27a', 0, 12, 1.8);
      l.visible = biome.plankton || biome.props.vents > 0 || (biome.props.crystals ?? 0) > 0 || (biome.props.basalt ?? 0) > 0;
      this.glowLights.push(l);
      this.group.add(l);
    }

    this.backdrop = buildBackdrop(biome);
    this.group.add(this.backdrop);
    this.group.add(buildTerrainMesh(this.terrain, biome, quality.terrainDetail, level));
    const surface = biome.surface === 'rock' ? buildCaveCeiling(biome, level, quality.terrainDetail) : buildWaterSurface(biome, level);
    if (surface) this.group.add(surface);
    this.surface = surface ?? null;
    this.snow = buildMarineSnow(biome, Math.round(biome.snow.count * quality.snow), level.seed);
    this.group.add(this.snow);
    new BiomeBuilder(this, quality).build();
  }

  applyFog(): void {
    const b = this.biome;
    shared.uFogTop.value.set(b.fog.top);
    shared.uFogMid.value.set(b.fog.mid);
    shared.uFogBottom.value.set(b.fog.bottom);
    shared.uFogDensity.value = b.fog.density;
    shared.uSurfaceY.value = this.level.world.height;
    shared.uDeepLight.value = b.deepLight;
    shared.uCausticsStrength.value = b.caustics;
    shared.uCausticsColor.value.set(b.causticsColor);
    shared.uSunColor.value.set(b.sun.color);
    shared.uFogDarken.value = 1;
  }

  /** Moves the water surface (tides). Fog, light falloff and caustics follow it. */
  setSurfaceY(y: number): void {
    shared.uSurfaceY.value = y;
    if (this.surface) this.surface.position.y = y - this.level.world.height;
  }

  addLayer(layer: EnvLayer): void {
    this.layers.push(layer);
    if (layer.object) this.group.add(layer.object);
  }

  get clearColor(): Color {
    return new Color(this.biome.fog.mid);
  }

  floorAt = (x: number): number => this.terrain.floorAt(x);

  update(u: EnvUpdate): void {
    const cam = u.camera;
    this.backdrop.position.copy(cam.position);
    // Keep the fog clear across the gameplay plane at every zoom level.
    shared.uFogStart.value = cam.position.z * 0.92;

    const span = Math.ceil(Math.max(u.viewW, u.viewH) * 0.62 + 8);
    const cx = cam.position.x;
    const cy = u.playerY;
    this.sun.target.position.set(cx, cy * 0.5, 0);
    this.sun.position.copy(this.sun.target.position).addScaledVector(SUN_DIR, 70);
    if (this.sun.castShadow && span !== this.shadowSpan) {
      this.shadowSpan = span;
      const sc = this.sun.shadow.camera;
      sc.left = -span;
      sc.right = span;
      sc.top = span;
      sc.bottom = -span;
      sc.updateProjectionMatrix();
    }

    const snowMat = this.snow.material as ShaderMaterial;
    const box = snowMat.uniforms.uBoxSize.value as Vector3;
    box.set(Math.max(60, u.viewW + 30), this.level.world.height + 6, 44);
    (snowMat.uniforms.uBoxMin.value as Vector3).set(cx - box.x / 2, -3, -30);
    this.playerLight.position.set(u.playerX, u.playerY + 0.6, 2.4);
    shared.uPlayerPos.value.set(u.playerX, u.hasPlayer ? u.playerY : -1e4, 0);
    for (const l of this.layers) l.update?.(u);
  }

  /** Point-size scale for particle shaders. */
  setViewport(heightPx: number, fovDeg: number, dpr: number): void {
    const s = (heightPx * dpr) / (2 * Math.tan((fovDeg * Math.PI) / 360));
    (this.snow.material as ShaderMaterial).uniforms.uScale.value = s;
    for (const l of this.layers) {
      const m = (l.object as Points | undefined)?.material as ShaderMaterial | undefined;
      if (m?.uniforms?.uScale) m.uniforms.uScale.value = s;
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    for (const l of this.layers) l.dispose();
    this.group.removeFromParent();
  }
}
