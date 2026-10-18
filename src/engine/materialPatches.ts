import {
  Color,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
  type MeshStandardMaterial,
  type Texture,
} from 'three';
import { getSharedTextures } from '../art/textures';
import waterPars from './shaders/water_pars.glsl?raw';
import patchVertex from './shaders/patch_vertex.glsl?raw';
import patchFragment from './shaders/patch_fragment.glsl?raw';

/** Uniforms shared by every patched material and custom water shader. */
export const shared = {
  uTime: { value: 0 },
  uFogTop: { value: new Color('#3fd0e6') },
  uFogMid: { value: new Color('#138fb3') },
  uFogBottom: { value: new Color('#064a6e') },
  uFogDensity: { value: 0.022 },
  uFogStart: { value: 16 },
  uFogDarken: { value: 1 },
  uSurfaceY: { value: 34 },
  uDeepLight: { value: 0.6 },
  uCausticsTex: { value: null as Texture | null },
  uCausticsStrength: { value: 1 },
  uCausticsScale: { value: 0.15 },
  uCausticsColor: { value: new Color('#dffbff') },
  uCurrent: { value: new Vector2(0.4, 0.1) },
  uSunColor: { value: new Color('#fff4dc') },
  uPlayerPos: { value: new Vector3() },
};

export interface FishUniforms {
  /** x: amplitude, y: wave number, z: nose x, w: front stiffness */
  uSwim: IUniform<Vector4>;
  /** x, y: hinge position, z: max jaw angle */
  uJawHinge: IUniform<Vector3>;
  /** x, y: eye uv, z: radius in v units, w: u-to-v aspect */
  uEye: IUniform<Vector4>;
}

export interface PatchOptions {
  caustics?: boolean;
  fish?: FishUniforms;
  fins?: boolean;
  sway?: { freq: number; amount: number; height: number };
  /** Dither-fade where the mesh covers the player on screen (foreground scenery). */
  fade?: boolean;
  translucency?: number;
  rim?: { color: Color; power: number; strength: number };
  /** Emissive strength driven by the (vertex x instance) colour. */
  glow?: number;
  /** World-space triplanar stone detail (albedo and relief), with algae on upward faces. */
  stone?: StoneOptions;
}

export interface StoneOptions {
  /** Texture repeats per world unit. */
  scale?: number;
  relief?: number;
  algae?: Color;
  algaeAmount?: number;
}

export function createFishUniforms(): FishUniforms {
  return {
    uSwim: { value: new Vector4(0.07, 4.5, 0.5, 0.05) },
    uJawHinge: { value: new Vector3(0.35, 0, 0.55) },
    uEye: { value: new Vector4(0.8, 0.6, 0.05, 1) },
  };
}

const VERTEX_DEFORM = /* glsl */ `
vec3 ffPos = position;
#ifdef FF_FISH
  ffFishDeform(ffPos, objectNormal);
  vFx = aFx;
  vJaw = vec2(sign(aJaw.y), abs(aJaw.y));
#endif
#ifdef FF_SWAY
  ffSwayDeform(ffPos);
#endif
`;

const VERTEX_WORLD = /* glsl */ `
{
  vec4 ffWp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    ffWp = instanceMatrix * ffWp;
  #endif
  vFFWorldPos = (modelMatrix * ffWp).xyz;
  #ifdef FF_FADE
    // Foreground scenery opens a dithered window around the player's screen position.
    vec4 ffPc = projectionMatrix * viewMatrix * vec4(uPlayerPos, 1.0);
    float ffAsp = projectionMatrix[1][1] / projectionMatrix[0][0];
    float ffD = length((gl_Position.xy / gl_Position.w - ffPc.xy / ffPc.w) * vec2(ffAsp, 1.0));
    float ffFront = smoothstep(uPlayerPos.z + 1.5, uPlayerPos.z + 3.5, vFFWorldPos.z);
    vFade = mix(1.0, mix(0.18, 1.0, smoothstep(0.16, 0.42, ffD)), ffFront);
  #endif
}
`;

const FRAG_MOUTH = /* glsl */ `
#ifdef FF_FISH
  float ffMouth = vFx.x * vJaw.y * (1.0 - smoothstep(0.3, 0.9, abs(vJaw.x)));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.02, 0.04), clamp(ffMouth * 1.6, 0.0, 1.0));
  // vFx.w > 0: golden fish, keeps the pattern as light and dark gold. < 0: hidden in cover.
  float ffGold = clamp(vFx.w, 0.0, 1.0);
  float ffLuma = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.6, 0.08) * (0.4 + ffLuma * 0.55), ffGold * 0.95);
  diffuseColor.rgb *= 1.0 + clamp(vFx.w, -1.0, 0.0) * 0.6;
#endif
`;

const FRAG_EMISSIVE = /* glsl */ `
#ifdef FF_FISH
  #ifdef USE_MAP
    vec2 ffEd = (vMapUv - uEye.xy) * vec2(uEye.w, 1.0);
    float ffEyeMask = 1.0 - smoothstep(uEye.z * 0.5, uEye.z * 1.15, length(ffEd));
    totalEmissiveRadiance += vec3(1.0, 0.1, 0.04) * (vFx.y * ffEyeMask * 6.0);
  #endif
  totalEmissiveRadiance += diffuseColor.rgb * vec3(0.7, 0.9, 1.0) * (vFx.z * 1.6) + vec3(0.3, 0.5, 0.6) * (vFx.z * vFx.z * 0.5);
  totalEmissiveRadiance += vec3(1.0, 0.55, 0.08) * (clamp(vFx.w, 0.0, 1.0) * 0.45);
#endif
#ifdef FF_GLOW
  // Only the bright parts glow, so dark vertex colours (stems, bases) stay unlit.
  float ffLum = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
  totalEmissiveRadiance += diffuseColor.rgb * (uGlow * smoothstep(0.3, 0.85, ffLum));
#endif
`;

// Whiteout-blended triplanar normal mapping (after Ben Golus), done in world space.
const FRAG_STONE = /* glsl */ `
#ifdef FF_STONE
{
  vec3 sn = inverseTransformDirection(normal, viewMatrix);
  vec3 sb = pow(abs(sn), vec3(4.0));
  sb /= sb.x + sb.y + sb.z;
  vec3 sp = vFFWorldPos * uStoneScale;
  vec4 st = texture2D(uStoneTex, sp.zy) * sb.x + texture2D(uStoneTex, sp.xz) * sb.y + texture2D(uStoneTex, sp.xy) * sb.z;
  diffuseColor.rgb *= st.rgb * 1.25;
  float algae = smoothstep(0.5, 0.9, sn.y + (st.a - 0.5) * 1.6) * uAlgaeAmount;
  diffuseColor.rgb = mix(diffuseColor.rgb, uAlgaeColor * (0.35 + st.r * 0.75), algae);
  vec3 nx = texture2D(uStoneNormal, sp.zy).xyz * 2.0 - 1.0;
  vec3 ny = texture2D(uStoneNormal, sp.xz).xyz * 2.0 - 1.0;
  vec3 nz = texture2D(uStoneNormal, sp.xy).xyz * 2.0 - 1.0;
  float relief = uStoneRelief * (1.0 - algae * 0.6);
  nx = vec3(nx.xy * relief + sn.zy, abs(nx.z) * sn.x);
  ny = vec3(ny.xy * relief + sn.xz, abs(ny.z) * sn.y);
  nz = vec3(nz.xy * relief + sn.xy, abs(nz.z) * sn.z);
  vec3 wn = normalize(nx.zyx * sb.x + ny.xzy * sb.y + nz.xyz * sb.z);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}
#endif
`;

// Wet, glassy eyes: near-mirror roughness inside the painted eye so they catch moving glints.
const FRAG_ROUGHNESS = /* glsl */ `
#if defined(FF_FISH) && defined(USE_MAP)
{
  vec2 ffEr = (vMapUv - uEye.xy) * vec2(uEye.w, 1.0);
  roughnessFactor = mix(roughnessFactor, 0.05, 1.0 - smoothstep(uEye.z * 0.85, uEye.z * 1.05, length(ffEr)));
}
#endif
`;

const FRAG_WATER = /* glsl */ `
{
  #if defined(FF_FISH) && !defined(FF_FINS)
    // Light bleeding through the thin edges of the body, tinted by the fish's own colour.
    float ffEdge = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.5);
    outgoingLight += diffuseColor.rgb * diffuseColor.rgb * uSunColor * (ffEdge * 0.9);
  #endif
  vec3 ffN = inverseTransformDirection(normal, viewMatrix);
  outgoingLight = ffWater(outgoingLight, diffuseColor.rgb, vFFWorldPos, ffN);
  #ifdef FF_TRANSLUCENT
    float ffDepthLight = mix(uDeepLight, 1.0, clamp(vFFWorldPos.y / uSurfaceY, 0.0, 1.0));
    outgoingLight += diffuseColor.rgb * uSunColor * (uTranslucency * ffDepthLight);
  #endif
  #ifdef FF_RIM
    float ffRim = pow(max(1.0 - abs(dot(normal, normalize(vViewPosition))), 0.0), uRimPower);
    outgoingLight += uRimColor * (ffRim * uRimStrength);
  #endif
}
`;

/**
 * Injects the shared underwater look (depth light, caustics, gradient fog) and
 * optional fish swimming / plant sway deformation into a standard material.
 */
export function patchMaterial<T extends MeshStandardMaterial>(mat: T, opts: PatchOptions = {}): T {
  const defines: string[] = [];
  if (opts.caustics) defines.push('FF_CAUSTICS');
  if (opts.fish) defines.push('FF_FISH');
  if (opts.fins) defines.push('FF_FINS');
  if (opts.sway) defines.push('FF_SWAY');
  if (opts.fade) defines.push('FF_FADE');
  if (opts.translucency) defines.push('FF_TRANSLUCENT');
  if (opts.rim) defines.push('FF_RIM');
  if (opts.glow) defines.push('FF_GLOW');
  if (opts.stone) defines.push('FF_STONE');
  const key = 'ff|' + defines.join(',');
  const header = defines.map((d) => `#define ${d}`).join('\n') + '\n';

  const local: Record<string, IUniform> = {};
  if (opts.sway) {
    local.uSway = { value: new Vector3(opts.sway.freq, opts.sway.amount, opts.sway.height) };
  }
  if (opts.translucency) local.uTranslucency = { value: opts.translucency };
  if (opts.rim) {
    local.uRimColor = { value: opts.rim.color };
    local.uRimPower = { value: opts.rim.power };
    local.uRimStrength = { value: opts.rim.strength };
  }
  if (opts.glow) local.uGlow = { value: opts.glow };
  if (opts.stone) {
    const tex = getSharedTextures();
    local.uStoneTex = { value: tex.stone };
    local.uStoneNormal = { value: tex.stoneNormal };
    local.uStoneScale = { value: opts.stone.scale ?? 0.35 };
    local.uStoneRelief = { value: opts.stone.relief ?? 1 };
    local.uAlgaeColor = { value: opts.stone.algae ?? new Color('#4f6b2c') };
    local.uAlgaeAmount = { value: opts.stone.algae ? (opts.stone.algaeAmount ?? 0.8) : 0 };
  }
  mat.userData.ffUniforms = local;

  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, local, opts.fish ?? {});
    shader.vertexShader =
      header +
      shader.vertexShader
        .replace('#include <common>', `#include <common>\n${patchVertex}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${VERTEX_DEFORM}`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = ffPos;')
        .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_WORLD}`);
    shader.fragmentShader =
      header +
      shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${waterPars}\n${patchFragment}`)
        .replace(
          '#include <clipping_planes_fragment>',
          '#include <clipping_planes_fragment>\n#ifdef FF_FADE\nif (vFade < 0.995 && ffDither(gl_FragCoord.xy) >= vFade) discard;\n#endif',
        )
        .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAG_MOUTH}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGHNESS}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_STONE}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`)
        .replace('#include <opaque_fragment>', `${FRAG_WATER}\n#include <opaque_fragment>`)
        .replace('#include <fog_fragment>', 'gl_FragColor.rgb = ffFog(gl_FragColor.rgb, vFFWorldPos);');
  };
  mat.needsUpdate = true;
  return mat;
}

/** GLSL prelude for custom ShaderMaterials that want the same fog and caustics. */
export function waterPrelude(caustics = false): string {
  return (caustics ? '#define FF_CAUSTICS\n' : '') + waterPars;
}

export function sharedUniforms(): typeof shared {
  return shared;
}
