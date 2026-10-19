import {
  BackSide,
  Color,
  DynamicDrawUsage,
  FrontSide,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector2,
  type BufferGeometry,
  type Matrix4,
  type Object3D,
  type Side,
  type Texture,
} from 'three';
import { SPECIES, type SpeciesDef, type SpeciesId } from '../../config/species';
import { createFishUniforms, patchMaterial, type FishUniforms } from '../../engine/materialPatches';
import { getSharedTextures } from '../textures';
import { buildBodyGeometry, buildFinGeometry, buildLayout, type FishLayout } from './FishGenerator';
import { paintFish } from './FishPainter';

export interface FishAsset {
  id: SpeciesId;
  def: SpeciesDef;
  layout: FishLayout;
  bodyGeo: BufferGeometry;
  finGeo: BufferGeometry;
  bodyMat: MeshStandardMaterial;
  /** Front faces of the see-through fins; `finBackMat` draws their back faces first. */
  finMat: MeshStandardMaterial;
  finBackMat: MeshStandardMaterial;
  uniforms: FishUniforms;
  map: Texture;
  emissive: Texture | null;
  canvas: HTMLCanvasElement;
}

export interface FactoryOptions {
  physical: boolean;
  /** Scale normal detail (off on low quality). */
  detail: boolean;
  /** Painted texture resolution multiplier. */
  texScale?: number;
}

/** Anything that can draw a batch of fish of one species (procedural today, glTF later). */
export interface FishRenderer {
  readonly capacity: number;
  begin(): void;
  push(matrix: Matrix4, phase: number, ampMul: number, jaw: number, alert: number, flash: number, tint?: number): boolean;
  end(): void;
  addTo(parent: Object3D): void;
  removeFromParent(): void;
  dispose(): void;
}

export class FishFactory {
  private readonly assets = new Map<SpeciesId, FishAsset>();

  constructor(readonly opts: FactoryOptions) {}

  asset(id: SpeciesId): FishAsset {
    let a = this.assets.get(id);
    if (!a) {
      a = this.build(id);
      this.assets.set(id, a);
    }
    return a;
  }

  pool(id: SpeciesId, capacity: number, castShadow = false): FishPool {
    return new FishPool(this.asset(id), capacity, castShadow);
  }

  private build(id: SpeciesId): FishAsset {
    const def = SPECIES[id];
    const layout = buildLayout(def, this.opts.texScale ?? 1);
    const bodyGeo = buildBodyGeometry(layout);
    const finGeo = buildFinGeometry(layout);
    const painted = paintFish(layout);
    const m = def.material;
    const shared = getSharedTextures();
    const base = {
      map: painted.map,
      roughness: m.roughness,
      metalness: m.metalness ?? 0.04,
      normalMap: this.opts.detail ? shared.scaleNormal : null,
      normalScale: new Vector2(0.4, 0.4),
    };
    let bodyMat: MeshStandardMaterial;
    if (this.opts.physical) {
      bodyMat = new MeshPhysicalMaterial({
        ...base,
        clearcoat: m.clearcoat,
        clearcoatRoughness: 0.25,
        iridescence: m.iridescence ?? 0,
        iridescenceIOR: 1.45,
        iridescenceThicknessRange: [140, 460],
      });
    } else {
      bodyMat = new MeshStandardMaterial(base);
    }
    if (painted.emissive) {
      bodyMat.emissiveMap = painted.emissive;
      bodyMat.emissive = new Color(m.glow ?? '#ffffff');
      bodyMat.emissiveIntensity = m.glowIntensity ?? 1;
    } else {
      bodyMat.emissive = new Color('#000000');
    }
    const uniforms = createFishUniforms();
    uniforms.uSwim.value.set(def.swim.amp, def.swim.wave, layout.noseX, 0.04);
    uniforms.uJawHinge.value.set(layout.jaw.hingeX, layout.jaw.hingeY, layout.jaw.maxAngle);
    const { minX, maxX, minY, maxY } = layout.bounds;
    const sf = layout.tex.stripH / layout.tex.height;
    const dx = maxX - minX;
    const dy = maxY - minY;
    uniforms.uEye.value.set(
      (layout.eye.x - minX) / dx,
      sf + ((layout.eye.y - minY) / dy) * (1 - sf),
      (layout.eye.r / dy) * (1 - sf),
      (dx * (1 - sf)) / dy,
    );
    patchMaterial(bodyMat, { caustics: true, fish: uniforms });

    const finMaterial = (side: Side): MeshStandardMaterial => {
      const mat = new MeshStandardMaterial({
        map: painted.map,
        roughness: 0.5,
        metalness: 0,
        transparent: true,
        side,
        depthWrite: false,
        alphaTest: 0.04,
      });
      if (painted.emissive) {
        mat.emissiveMap = painted.emissive;
        mat.emissive = new Color(m.glow ?? '#ffffff');
        mat.emissiveIntensity = m.glowIntensity ?? 1;
      }
      return patchMaterial(mat, { caustics: true, fish: uniforms, fins: true, translucency: 0.35 });
    };

    return {
      id,
      def,
      layout,
      bodyGeo,
      finGeo,
      bodyMat,
      finMat: finMaterial(FrontSide),
      finBackMat: finMaterial(BackSide),
      uniforms,
      map: painted.map,
      emissive: painted.emissive,
      canvas: painted.canvas,
    };
  }

  dispose(): void {
    for (const a of this.assets.values()) {
      a.bodyGeo.dispose();
      a.finGeo.dispose();
      a.bodyMat.dispose();
      a.finMat.dispose();
      a.finBackMat.dispose();
      a.map.dispose();
      a.emissive?.dispose();
    }
    this.assets.clear();
  }
}

/** Instanced batch of one species: body and fins share the instance matrices. */
export class FishPool implements FishRenderer {
  readonly body: InstancedMesh;
  /**
   * The fins are drawn as a back-face then a front-face mesh. That is how three draws a
   * double-sided transparent material anyway, but it flips the material's side and recompiles
   * its parameters twice a frame to do it.
   */
  readonly finsBack: InstancedMesh;
  readonly fins: InstancedMesh;
  readonly capacity: number;
  private readonly swim: InstancedBufferAttribute;
  private readonly fx: InstancedBufferAttribute;
  private count = 0;

  constructor(readonly asset: FishAsset, capacity: number, castShadow: boolean) {
    this.capacity = capacity;
    this.swim = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    this.fx = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.swim.setUsage(DynamicDrawUsage);
    this.fx.setUsage(DynamicDrawUsage);
    const bodyGeo = asset.bodyGeo.clone();
    const finGeo = asset.finGeo.clone();
    for (const g of [bodyGeo, finGeo]) {
      g.setAttribute('aSwim', this.swim);
      g.setAttribute('aFx', this.fx);
    }
    this.body = new InstancedMesh(bodyGeo, asset.bodyMat, capacity);
    // Created before the front faces so it sorts (by id) just ahead of them.
    this.finsBack = new InstancedMesh(finGeo, asset.finBackMat, capacity);
    this.fins = new InstancedMesh(finGeo, asset.finMat, capacity);
    this.body.instanceMatrix.setUsage(DynamicDrawUsage);
    this.fins.instanceMatrix = this.finsBack.instanceMatrix = this.body.instanceMatrix;
    for (const m of [this.body, this.finsBack, this.fins]) {
      m.frustumCulled = false;
      m.count = 0;
      m.castShadow = castShadow;
      m.receiveShadow = false;
    }
    for (const m of [this.finsBack, this.fins]) {
      m.castShadow = false;
      m.renderOrder = 1;
    }
    // Transparent objects sort by their bounds' centre: both halves must share one so nothing lands between them.
    this.finsBack.computeBoundingSphere = () => {
      if (!this.fins.boundingSphere) this.fins.computeBoundingSphere();
      this.finsBack.boundingSphere = this.fins.boundingSphere;
    };
  }

  begin(): void {
    this.count = 0;
  }

  push(matrix: Matrix4, phase: number, ampMul: number, jaw: number, alert: number, flash: number, tint = 0): boolean {
    if (this.count >= this.capacity) return false;
    const i = this.count++;
    matrix.toArray(this.body.instanceMatrix.array, i * 16);
    const s = this.swim.array as Float32Array;
    s[i * 2] = phase;
    s[i * 2 + 1] = ampMul;
    const f = this.fx.array as Float32Array;
    f[i * 4] = jaw;
    f[i * 4 + 1] = alert;
    f[i * 4 + 2] = flash;
    f[i * 4 + 3] = tint;
    return true;
  }

  end(): void {
    this.body.count = this.count;
    this.finsBack.count = this.count;
    this.fins.count = this.count;
    if (this.count > 0) {
      this.body.instanceMatrix.clearUpdateRanges();
      this.body.instanceMatrix.addUpdateRange(0, this.count * 16);
      this.body.instanceMatrix.needsUpdate = true;
      this.swim.clearUpdateRanges();
      this.swim.addUpdateRange(0, this.count * 2);
      this.swim.needsUpdate = true;
      this.fx.clearUpdateRanges();
      this.fx.addUpdateRange(0, this.count * 4);
      this.fx.needsUpdate = true;
    }
  }

  addTo(parent: Object3D): void {
    parent.add(this.body, this.finsBack, this.fins);
  }

  removeFromParent(): void {
    this.body.removeFromParent();
    this.finsBack.removeFromParent();
    this.fins.removeFromParent();
  }

  dispose(): void {
    this.removeFromParent();
    this.body.geometry.dispose();
    this.fins.geometry.dispose();
    this.body.dispose();
    this.finsBack.dispose();
    this.fins.dispose();
  }
}
