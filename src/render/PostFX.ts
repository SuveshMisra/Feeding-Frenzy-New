import {
  Color,
  HalfFloatType,
  Vector2,
  Vector3,
  type Material,
  type Mesh,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import {
  BloomEffect,
  ChromaticAberrationEffect,
  DepthDownsamplingPass,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  NormalPass,
  RenderPass,
  SMAAEffect,
  SSAOEffect,
  SMAAPreset,
  ShockWaveEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  type Effect,
} from 'postprocessing';
import { GRADE_DEFAULT, type BiomeDef } from '../config/levels';
import type { QualityPreset } from '../app/Quality';
import { UnderwaterEffect } from './UnderwaterEffect';

/**
 * Ambient occlusion, bloom, depth of field, underwater wobble, shockwaves, colour grade,
 * vignette and AgX tone mapping. Chromatic aberration and SMAA sample neighbours, so they
 * get their own passes.
 */
export class PostFX {
  readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private mainPass!: EffectPass;
  private caPass!: EffectPass;
  private smaaPass: EffectPass | null = null;
  private normalPass: NormalPass | null = null;
  private depthPass: DepthDownsamplingPass | null = null;
  private ssao: SSAOEffect | null = null;
  private readonly hidden: Object3D[] = [];
  private scene: Scene;
  private dof: DepthOfFieldEffect | null = null;
  private bloom!: BloomEffect;
  private readonly underwater = new UnderwaterEffect();
  private shock!: ShockWaveEffect;
  private ca!: ChromaticAberrationEffect;
  private caAmount = 0;
  /** Draw the aberration pass once while it is invisible so its shader is compiled before the first hit. */
  private warmCa = true;
  private hurtAmount = 0;
  private frenzy = 0;
  private darkTarget = 0;
  private heatTarget = 0;
  private goldTarget = 0;
  private time = 0;
  private readonly shockPos = new Vector3();
  readonly focusTarget = new Vector3();
  private quality: QualityPreset;
  private bloomBase = 0.8;

  constructor(
    renderer: WebGLRenderer,
    scene: Scene,
    private readonly camera: PerspectiveCamera,
    quality: QualityPreset,
  ) {
    this.quality = quality;
    this.scene = scene;
    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.buildPasses();
  }

  private buildPasses(): void {
    const q = this.quality;
    for (const p of [this.mainPass, this.caPass, this.smaaPass, this.normalPass, this.depthPass]) {
      if (p) {
        this.composer.removePass(p);
        p.dispose();
      }
    }
    const cam = this.camera;
    this.normalPass = this.depthPass = this.ssao = null;
    if (q.ao) {
      const normalPass = (this.normalPass = new NormalPass(this.scene, cam));
      const renderNormals = normalPass.render.bind(normalPass);
      normalPass.render = (...args) => {
        this.hideUnsolid();
        renderNormals(...args);
        this.restoreUnsolid();
      };
      // Half resolution needs downsampled normals and depth to upsample against; full doesn't.
      const half = q.aoResolution < 1;
      this.depthPass = half ? new DepthDownsamplingPass({ normalBuffer: normalPass.texture, resolutionScale: q.aoResolution }) : null;
      this.ssao = new SSAOEffect(cam, normalPass.texture, {
        normalDepthBuffer: this.depthPass?.texture,
        resolutionScale: q.aoResolution,
        depthAwareUpsampling: true,
        samples: 16,
        rings: 7,
        radius: 0.1,
        minRadiusScale: 0.25,
        intensity: 5,
        bias: 0.02,
        fade: 0.02,
        luminanceInfluence: 0.15,
        worldDistanceThreshold: 40,
        worldDistanceFalloff: 12,
        worldProximityThreshold: 2.5,
        worldProximityFalloff: 1.5,
        color: new Color('#05202c'),
      });
      this.composer.addPass(normalPass, 1);
      if (this.depthPass) this.composer.addPass(this.depthPass, 2);
    }
    this.dof = q.dof
      ? new DepthOfFieldEffect(cam, { focusDistance: 20, focusRange: 10, bokehScale: 1.8, resolutionScale: 0.5 })
      : null;
    if (this.dof) {
      this.dof.target = this.focusTarget;
      // The seabed runs towards the camera, so full near blur smears the playfield floor; keep it mostly for the backdrop.
      const coc = this.dof.cocMaterial;
      coc.fragmentShader = coc.fragmentShader.replace('vec2(step(signedDistance,0.0),', 'vec2(step(signedDistance,0.0)*0.4,');
    }
    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 0.78,
      luminanceSmoothing: 0.25,
      intensity: this.bloomBase,
      radius: 0.72,
    });
    this.shock = new ShockWaveEffect(cam, this.shockPos, { speed: 1.6, maxRadius: 0.55, waveSize: 0.14, amplitude: 0.035 });
    const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.58 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const effects: Effect[] = [];
    // Depth of field swaps out-of-focus pixels for its own blurred copy of the scene,
    // so occlusion has to come after it or it would only show on things in focus.
    if (this.dof) effects.push(this.dof);
    if (this.ssao) effects.push(this.ssao);
    effects.push(this.underwater, this.shock);
    if (q.bloom) effects.push(this.bloom);
    effects.push(vignette, tone);
    this.underwater.u('uWobble').value = q.underwater ? 1 : 0;
    // The composer only draws its last pass to the screen and skips disabled passes,
    // so the toggled aberration pass must never be last.
    this.ca = new ChromaticAberrationEffect({ offset: new Vector2(0, 0), radialModulation: true, modulationOffset: 0.2 });
    this.caPass = new EffectPass(cam, this.ca);
    this.caPass.enabled = false;
    this.warmCa = true;
    this.composer.addPass(this.caPass);
    this.mainPass = new EffectPass(cam, ...effects);
    this.composer.addPass(this.mainPass);
    if (q.smaa) {
      const preset = q.smaaQuality === 'ultra' ? SMAAPreset.ULTRA : SMAAPreset.MEDIUM;
      this.smaaPass = new EffectPass(cam, new SMAAEffect({ preset }));
      this.composer.addPass(this.smaaPass);
    } else {
      this.smaaPass = null;
    }
  }

  setQuality(q: QualityPreset): void {
    this.quality = q;
    this.buildPasses();
  }

  setScene(scene: Scene): void {
    this.scene = scene;
    this.renderPass.mainScene = scene;
    if (this.normalPass) this.normalPass.mainScene = scene;
  }

  /**
   * Compiles the scene's shaders, hidden objects included (boss glows, telegraphs), so none of
   * them stalls a frame the first time it appears. Shaders depend on the target they draw into,
   * so this compiles against the composer's buffer rather than the screen.
   */
  precompile(): void {
    const gl = this.composer.getRenderer();
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(this.composer.inputBuffer);
    gl.compile(this.scene, this.camera);
    gl.setRenderTarget(prev);
  }

  /**
   * The normals are drawn with one plain material, so anything see-through (particles, fins,
   * light shafts) or cut out by alpha (sea fans) would show up as solid shapes.
   */
  private hideUnsolid(): void {
    this.scene.traverseVisible((o) => {
      const m = (o as Mesh).material as Material | Material[] | undefined;
      if (!m) return;
      const mat = Array.isArray(m) ? m[0] : m;
      if (mat.transparent || !mat.depthWrite || mat.alphaTest > 0) {
        o.visible = false;
        this.hidden.push(o);
      }
    });
  }

  private restoreUnsolid(): void {
    for (const o of this.hidden) o.visible = true;
    this.hidden.length = 0;
  }

  applyBiome(b: BiomeDef): void {
    this.bloomBase = b.bloom;
    this.bloom.intensity = b.bloom;
    this.underwater.u('uExposure').value = b.exposure;
    this.underwater.u('uTintAmount').value = b.surface === 'none' || b.surface === 'rock' ? 0.05 : 0.12;
    const g = { ...GRADE_DEFAULT, ...b.grade };
    this.underwater.u('uContrast').value = g.contrast;
    this.underwater.u('uSaturation').value = g.saturation;
    // Normalised to unit luminance so the tint shifts shadow hue without darkening them.
    const tint = new Color(g.shadowTint);
    const lum = tint.r * 0.2126 + tint.g * 0.7152 + tint.b * 0.0722;
    (this.underwater.u('uShadowTint').value as Vector3).set(tint.r / lum, tint.g / lum, tint.b / lum);
    for (const name of ['uDark', 'uHeat', 'uGold']) this.underwater.u(name).value = 0;
    this.darkTarget = this.heatTarget = this.goldTarget = 0;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  shockwave(x: number, y: number, z = 0, strength = 1): void {
    this.shockPos.set(x, y, z);
    this.shock.amplitude = 0.03 * strength;
    this.shock.maxRadius = 0.4 + 0.25 * strength;
    this.shock.explode();
  }

  hurt(amount = 1): void {
    this.hurtAmount = Math.max(this.hurtAmount, amount);
    this.caAmount = Math.max(this.caAmount, amount);
  }

  setFrenzy(level: number): void {
    this.frenzy = level;
  }

  /** Drops every gameplay effect at once (hurt flash, fringing, frenzy, heat, gold, darkness, shockwave). */
  calm(): void {
    this.hurtAmount = 0;
    this.caAmount = 0;
    this.caPass.enabled = false;
    this.frenzy = this.darkTarget = this.heatTarget = this.goldTarget = 0;
    for (const name of ['uHurt', 'uFrenzy', 'uDark', 'uHeat', 'uGold']) this.underwater.u(name).value = 0;
    this.shock.amplitude = 0;
  }

  /** Darkens the screen outside a circle at (cx, cy) in uv space; radius is a share of the screen height. */
  setDarkness(amount: number, cx: number, cy: number, radius: number, aspect: number): void {
    this.darkTarget = amount;
    this.underwater.u('uDarkCenter').value.set(cx, cy);
    this.underwater.u('uDarkRadius').value = radius;
    this.underwater.u('uAspect').value = aspect;
  }

  setHeat(level: number): void {
    this.heatTarget = level;
  }

  setGold(level: number): void {
    this.goldTarget = level;
  }

  update(realDt: number): void {
    this.time += realDt;
    this.underwater.u('uTime').value = this.time;
    this.hurtAmount = Math.max(0, this.hurtAmount - realDt * 1.4);
    this.caAmount = Math.max(0, this.caAmount - realDt * 1.8);
    this.underwater.u('uHurt').value = this.hurtAmount;
    const fz = this.underwater.u('uFrenzy');
    fz.value += (this.frenzy - fz.value) * Math.min(1, realDt * 4);
    const ease = (name: string, target: number, rate: number) => {
      const u = this.underwater.u(name);
      u.value += (target - u.value) * Math.min(1, realDt * rate);
    };
    ease('uDark', this.darkTarget, 2.5);
    ease('uHeat', this.heatTarget, 3);
    ease('uGold', this.goldTarget, 4);
    const ca = this.caAmount * 0.004;
    this.ca.offset.set(ca, ca * 0.6);
    this.caPass.enabled = this.caAmount > 0.01;
    this.bloom.intensity = this.bloomBase * (1 + (fz.value as number) * 0.25);
    // Occlusion fades out a little behind the play plane, before the fog takes over.
    if (this.ssao) this.ssao.ssaoMaterial.worldDistanceThreshold = this.camera.position.z + 14;
  }

  render(dt: number): void {
    if (this.warmCa) {
      this.warmCa = false;
      this.caPass.enabled = true;
    }
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
