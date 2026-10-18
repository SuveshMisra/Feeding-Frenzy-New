import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  NormalBlending,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { createNoise2D } from 'simplex-noise';
import type { BiomeDef, LevelDef } from '../config/levels';
import { patchMaterial, shared, waterPrelude } from '../engine/materialPatches';
import { smoothstep } from '../engine/math';
import { Rng } from '../engine/rng';

/** Gradient sphere matching the fog, so distant geometry dissolves seamlessly. */
export function buildBackdrop(biome: BiomeDef): Mesh {
  const mat = new ShaderMaterial({
    uniforms: {
      ...shared,
      uSunDir: { value: new Vector3(-0.3, 1, 0.2).normalize() },
      uSunGlow: { value: biome.surface === 'none' || biome.surface === 'rock' ? 0 : 0.35 },
      uShaftColor: { value: new Color(biome.shaftColor) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      ${waterPrelude(false)}
      uniform vec3 uSunDir;
      uniform float uSunGlow;
      uniform vec3 uShaftColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = ffFogColor(d);
        float s = max(dot(d, uSunDir), 0.0);
        col += uShaftColor * pow(s, 8.0) * uSunGlow * uFogDarken;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: BackSide,
    depthWrite: false,
  });
  const mesh = new Mesh(new SphereGeometry(380, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'backdrop';
  return mesh;
}

/** Animated water surface seen from below (Snell's window + glints). */
export function buildWaterSurface(biome: BiomeDef, level: LevelDef): Mesh | null {
  if (biome.surface === 'none' || biome.surface === 'rock') return null;
  const ice = biome.surface === 'ice';
  const w = level.world.width + 260;
  const geo = new PlaneGeometry(w, 260, 1, 1);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, level.world.height, -80);
  const mat = new ShaderMaterial({
    uniforms: {
      ...shared,
      uSurfaceColor: { value: new Color(biome.surfaceColor) },
      uIce: { value: ice ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${waterPrelude(false)}
      uniform vec3 uSurfaceColor;
      uniform float uIce;
      varying vec3 vWorld;
      float wave(vec2 p, float t) {
        return sin(p.x * 0.35 + t * 0.9) * 0.5 + sin(p.y * 0.42 - t * 0.7 + p.x * 0.12) * 0.5
          + sin((p.x + p.y) * 0.9 + t * 1.6) * 0.25 + sin((p.x - p.y * 1.3) * 1.7 - t * 2.1) * 0.12;
      }
      void main() {
        vec2 p = vWorld.xz;
        float t = uTime;
        float e = 0.15;
        float h = wave(p, t);
        vec3 n = normalize(vec3(wave(p + vec2(e, 0.0), t) - h, e * 2.2, wave(p + vec2(0.0, e), t) - h));
        vec3 v = normalize(vWorld - cameraPosition);
        float up = clamp(v.y, 0.0, 1.0);
        // Inside Snell's window the sky shows through; outside, total internal
        // reflection mirrors the sunlit upper water rather than the dark depths.
        float window = smoothstep(0.3, 0.8, up + (n.x + n.z) * 0.35);
        vec3 reflected = ffFogColor(vec3(v.x, 0.3, v.z)) * 1.08;
        vec3 sky = uSurfaceColor * 1.55;
        vec3 col = mix(reflected, sky, window);
        float spark = pow(max(0.0, 1.0 - abs(n.x * 2.4 + n.z * 1.8)), 12.0);
        col += uSurfaceColor * spark * (0.22 + window * 0.8);
        col *= 0.93 + 0.07 * h;
        if (uIce > 0.5) {
          float crack = smoothstep(0.03, 0.0, abs(sin(p.x * 0.21 + sin(p.y * 0.33) * 1.8) * sin(p.y * 0.17 + p.x * 0.05)));
          vec3 iceCol = mix(vec3(0.72, 0.88, 0.98), vec3(0.95, 0.99, 1.0), window);
          col = mix(iceCol * 0.85, iceCol, 0.5 + 0.5 * h) - crack * 0.18;
        }
        col = ffFog(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: DoubleSide,
    depthWrite: true,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'water-surface';
  return mesh;
}

/**
 * Rocky cave ceiling seen from below, with stalactites. It sits on the gameplay
 * surface limit and curves down at the back to meet the cavern wall.
 */
export function buildCaveCeiling(biome: BiomeDef, level: LevelDef, detail: number): Mesh {
  const rng = new Rng(level.seed + 61);
  const n1 = createNoise2D(() => rng.next());
  const n2 = createNoise2D(() => rng.next());
  const w = level.world.width + 200;
  const zMin = -110;
  const zMax = 22;
  const geo = new PlaneGeometry(w, zMax - zMin, Math.round((w / 1.2) * detail * 0.5), Math.round(((zMax - zMin) / 1.2) * detail * 0.5));
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, (zMin + zMax) / 2);
  const H = level.world.height;
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4);
  const colors = new Float32Array(pos.count * 3);
  const base = new Color(biome.palette.rock);
  const dark = new Color(biome.palette.rockDark);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const lumps = n1(x * 0.08, z * 0.08) * 1.2 + n2(x * 0.25, z * 0.25) * 0.35;
    // Stalactites are kept short over the play plane so they never hide the action.
    const reach = 0.3 + 0.7 * smoothstep(2, 9, Math.abs(z));
    const drip = Math.pow(Math.max(0, n2(x * 0.32 + 7, z * 0.32)), 3) * 7 * reach;
    const sag = smoothstep(-22, -70, z) * 10;
    const y = H + 1.2 + lumps - drip - sag;
    pos.setY(i, y);
    c.copy(dark).lerp(base, smoothstep(-0.8, 1.6, lumps) * 0.8).multiplyScalar(1 - Math.min(0.5, drip * 0.12));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: DoubleSide }), { stone: { scale: 0.2, relief: 1.2 } });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'cave-ceiling';
  return mesh;
}

/** Drifting marine snow that wraps around the camera (no CPU updates). */
export function buildMarineSnow(biome: BiomeDef, count: number, seed: number): Points {
  const rng = new Rng(seed + 99);
  const geo = new BufferGeometry();
  const pos = new Float32Array(count * 3);
  const rnd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rng.range(0, 1);
    pos[i * 3 + 1] = rng.range(0, 1);
    pos[i * 3 + 2] = rng.range(0, 1);
    rnd[i] = rng.next();
  }
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aRnd', new Float32BufferAttribute(rnd, 1));
  const mat = new ShaderMaterial({
    uniforms: {
      ...shared,
      uBoxMin: { value: new Vector3() },
      uBoxSize: { value: new Vector3(80, 50, 46) },
      uColor: { value: new Color(biome.snow.color) },
      uSize: { value: biome.snow.size },
      uOpacity: { value: biome.snow.opacity },
      uScale: { value: 600 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uBoxMin;
      uniform vec3 uBoxSize;
      uniform float uSize;
      uniform float uScale;
      attribute float aRnd;
      varying float vAlpha;
      varying vec3 vWorld;
      void main() {
        vec3 p = position * uBoxSize;
        p += vec3(sin(uTime * 0.2 + aRnd * 40.0) * 0.6 + uTime * 0.12, -uTime * (0.12 + aRnd * 0.18), cos(uTime * 0.17 + aRnd * 30.0) * 0.4);
        p = mod(p - uBoxMin, uBoxSize) + uBoxMin;
        vWorld = p;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * (0.5 + aRnd) * uScale / -mv.z, 1.0, 12.0);
        vec3 rel = (p - uBoxMin) / uBoxSize;
        vec3 edge = min(rel, 1.0 - rel);
        vAlpha = smoothstep(0.0, 0.08, min(edge.x, min(edge.y, edge.z))) * (0.5 + aRnd * 0.5);
      }
    `,
    fragmentShader: /* glsl */ `
      ${waterPrelude(false)}
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;
      varying vec3 vWorld;
      void main() {
        float r = length(gl_PointCoord * 2.0 - 1.0);
        if (r > 1.0) discard;
        float a = (1.0 - smoothstep(0.1, 1.0, r)) * vAlpha * uOpacity * (1.0 - ffFogFactor(vWorld) * 0.8);
        vec3 col = uColor * mix(uDeepLight, 1.0, clamp(vWorld.y / uSurfaceY, 0.0, 1.0));
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: biome.plankton ? AdditiveBlending : NormalBlending,
  });
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  pts.name = 'marine-snow';
  return pts;
}
