import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { BiomeDef, LevelDef } from '../config/levels';
import { shared, waterPrelude } from '../engine/materialPatches';
import { Rng } from '../engine/rng';
import type { EnvLayer } from './Environment';

/** Soft god rays slanting down from the surface; they wrap around the camera. */
export function buildShafts(biome: BiomeDef, level: LevelDef, count: number): EnvLayer | null {
  if (count <= 0 || biome.shaftIntensity <= 0) return null;
  const rng = new Rng(level.seed + 5);
  const band = 110;
  const corner = [-0.5, 0, 0.5, 0, -0.5, 1, 0.5, 1];
  const quad = [0, 2, 1, 1, 2, 3];
  const pos: number[] = [];
  const shaft: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < count; i++) {
    const s = [rng.range(0, band), rng.range(-24, 3), rng.range(1.2, 5), rng.next()];
    for (let k = 0; k < 4; k++) {
      pos.push(corner[k * 2], corner[k * 2 + 1], 0);
      shaft.push(...s);
    }
    for (const q of quad) index.push(i * 4 + q);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aShaft', new Float32BufferAttribute(shaft, 4));
  geo.setIndex(index);
  const top = level.world.height + 3;
  const mat = new ShaderMaterial({
    uniforms: {
      ...shared,
      uCamX: { value: 0 },
      uBand: { value: band },
      uTop: { value: top },
      uLength: { value: top + 6 },
      uLean: { value: 0.3 },
      uColor: { value: new Color(biome.shaftColor) },
      uIntensity: { value: biome.shaftIntensity },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uCamX;
      uniform float uBand;
      uniform float uTop;
      uniform float uLength;
      uniform float uLean;
      attribute vec4 aShaft;
      varying vec2 vUv;
      varying float vEdge;
      varying float vSeed;
      varying vec3 vWorld;
      void main() {
        float x = uCamX + mod(aShaft.x - uCamX + uBand * 0.5, uBand) - uBand * 0.5;
        vEdge = 1.0 - smoothstep(0.34, 0.5, abs(x - uCamX) / uBand);
        float down = position.y * uLength;
        float sway = sin(uTime * 0.21 + aShaft.w * 6.3) * 0.8 * position.y;
        float w = aShaft.z * (1.0 + position.y * 0.8);
        vec3 p = vec3(x + position.x * w + down * uLean + sway, uTop - down, aShaft.y);
        vUv = vec2(position.x + 0.5, position.y);
        vSeed = aShaft.w;
        vWorld = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${waterPrelude(false)}
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec2 vUv;
      varying float vEdge;
      varying float vSeed;
      varying vec3 vWorld;
      void main() {
        // Interpolated UVs can land a hair outside 0..1 at quad edges, and pow() of a
        // negative base is NaN, which bloom would smear across the whole frame.
        float across = pow(max(sin(vUv.x * 3.14159), 0.0), 1.8);
        float along = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.4) * smoothstep(0.0, 0.1, vUv.y);
        float flicker = 0.55 + 0.45 * sin(uTime * (0.3 + vSeed * 0.4) + vSeed * 20.0);
        float streak = 0.7 + 0.3 * sin(vUv.x * 11.0 + vSeed * 30.0 + uTime * 0.17);
        float a = across * along * flicker * streak * vEdge * uIntensity * 0.35;
        a *= 1.0 - ffFogFactor(vWorld) * 0.75;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.name = 'light-shafts';
  return {
    object: mesh,
    update: (u) => {
      mat.uniforms.uCamX.value = u.camera.position.x;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** Shimmering smoke plumes rising from vent mouths (positions in world space). */
export function buildPlumes(mouths: Vector3[], perVent: number, seed: number): EnvLayer {
  const rng = new Rng(seed + 31);
  const n = mouths.length * perVent;
  const vent = new Float32Array(n * 4);
  const rnd = new Float32Array(n * 3);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const m = mouths[Math.floor(i / perVent)];
    vent.set([m.x, m.y, m.z, rng.range(9, 15)], i * 4);
    rnd.set([rng.next(), rng.next(), rng.next()], i * 3);
    pos.set([m.x, m.y, m.z], i * 3);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aVent', new Float32BufferAttribute(vent, 4));
  geo.setAttribute('aRnd', new Float32BufferAttribute(rnd, 3));
  const mat = new ShaderMaterial({
    uniforms: { ...shared, uScale: { value: 600 } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uScale;
      uniform vec2 uCurrent;
      attribute vec4 aVent;
      attribute vec3 aRnd;
      varying float vAge;
      varying vec3 vWorld;
      void main() {
        float age = fract(uTime * (0.06 + aRnd.y * 0.05) + aRnd.x);
        vec3 p = aVent.xyz;
        p.y += age * aVent.w;
        float spread = age * (0.4 + age * 2.2);
        p.x += sin(aRnd.x * 40.0 + uTime * 0.6) * spread + uCurrent.x * age * age * 5.0;
        p.z += cos(aRnd.z * 30.0 + uTime * 0.5) * spread * 0.6;
        vAge = age;
        vWorld = p;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((0.45 + age * 2.6) * uScale / -mv.z, 1.0, 180.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${waterPrelude(false)}
      varying float vAge;
      varying vec3 vWorld;
      void main() {
        float r = length(gl_PointCoord * 2.0 - 1.0);
        if (r > 1.0) discard;
        float soft = 1.0 - smoothstep(0.15, 1.0, r);
        vec3 hot = vec3(1.0, 0.5, 0.16) * 2.4;
        vec3 smoke = vec3(0.012, 0.014, 0.018);
        vec3 col = mix(hot, smoke, smoothstep(0.0, 0.14, vAge));
        float a = soft * smoothstep(0.0, 0.03, vAge) * (1.0 - smoothstep(0.45, 1.0, vAge)) * mix(0.75, 0.16, vAge);
        gl_FragColor = vec4(ffFog(col, vWorld), a);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  pts.name = 'vent-plumes';
  return {
    object: pts,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** Glowing embers drifting up from the seabed; they wrap around the camera. */
export function buildEmbers(level: LevelDef, count: number, seed: number): EnvLayer | null {
  if (count <= 0) return null;
  const rng = new Rng(seed + 47);
  const pos = new Float32Array(count * 3);
  const rnd = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    pos.set([rng.next(), rng.next(), rng.next()], i * 3);
    rnd.set([rng.next(), rng.next()], i * 2);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aRnd', new Float32BufferAttribute(rnd, 2));
  const H = level.world.height;
  const mat = new ShaderMaterial({
    uniforms: {
      ...shared,
      uBoxMin: { value: new Vector3(0, -2, -36) },
      uBoxSize: { value: new Vector3(90, H + 4, 46) },
      uScale: { value: 600 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uBoxMin;
      uniform vec3 uBoxSize;
      uniform float uScale;
      attribute vec2 aRnd;
      varying float vHeat;
      varying vec3 vWorld;
      void main() {
        float rise = uTime * (0.5 + aRnd.x * 0.9);
        vec3 p = position * uBoxSize;
        p.y += rise;
        p.x += sin(uTime * 0.8 + aRnd.y * 30.0) * 0.6 + uTime * 0.15;
        p.z += cos(uTime * 0.6 + aRnd.x * 20.0) * 0.5;
        p = mod(p - uBoxMin, uBoxSize) + uBoxMin;
        float h = clamp((p.y - uBoxMin.y) / uBoxSize.y, 0.0, 1.0);
        // Embers cool and fade as they rise.
        vHeat = (1.0 - h) * (0.55 + 0.45 * sin(uTime * (4.0 + aRnd.y * 6.0) + aRnd.x * 50.0));
        vWorld = p;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((0.05 + aRnd.y * 0.08) * uScale / -mv.z, 1.0, 10.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${waterPrelude(false)}
      varying float vHeat;
      varying vec3 vWorld;
      void main() {
        float r = length(gl_PointCoord * 2.0 - 1.0);
        if (r > 1.0) discard;
        float a = (1.0 - smoothstep(0.0, 1.0, r)) * clamp(vHeat, 0.0, 1.0) * (1.0 - ffFogFactor(vWorld) * 0.85);
        vec3 col = mix(vec3(1.0, 0.22, 0.04), vec3(1.0, 0.75, 0.3), vHeat) * 2.2;
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  pts.name = 'embers';
  return {
    object: pts,
    update: (u) => {
      const box = mat.uniforms.uBoxSize.value as Vector3;
      box.x = Math.max(60, u.viewW + 30);
      (mat.uniforms.uBoxMin.value as Vector3).set(u.camera.position.x - box.x / 2, -2, -36);
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** Distant schools drifting through the fog behind the play area. */
export function buildAmbientSchools(biome: BiomeDef, level: LevelDef, schools: number): EnvLayer | null {
  if (schools <= 0) return null;
  const rng = new Rng(level.seed + 404);
  // Side-on fish silhouette: body diamond plus a forked tail.
  const shape = [
    0.5, 0, 0, 0.05, 0.17, 0, -0.3, 0, 0,
    0.5, 0, 0, -0.3, 0, 0, 0.05, -0.15, 0,
    -0.3, 0, 0, -0.52, 0.16, 0, -0.44, 0, 0,
    -0.3, 0, 0, -0.44, 0, 0, -0.52, -0.16, 0,
  ];
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(shape, 3));
  const school: number[] = [];
  const off: number[] = [];
  const scale: number[] = [];
  const W = level.world.width + 90;
  const H = level.world.height;
  for (let s = 0; s < schools; s++) {
    const z = rng.range(-46, -20);
    const y = rng.range(H * 0.2, H * 0.85);
    const speed = rng.range(0.8, 2.1) * rng.sign();
    const x0 = rng.range(0, W);
    const size = rng.range(0.5, 0.95) * (1 - (z + 20) / -60);
    const fish = rng.int(18, 36);
    for (let f = 0; f < fish; f++) {
      school.push(x0, y, z, speed);
      off.push(rng.gauss(4), rng.gauss(1.6), rng.gauss(2.4), rng.range(0, 6.283));
      scale.push(size * rng.range(0.8, 1.2));
    }
  }
  geo.setAttribute('aSchool', new InstancedBufferAttribute(new Float32Array(school), 4));
  geo.setAttribute('aOff', new InstancedBufferAttribute(new Float32Array(off), 4));
  geo.setAttribute('aScale', new InstancedBufferAttribute(new Float32Array(scale), 1));
  geo.instanceCount = scale.length;
  const tint = new Color(biome.fog.bottom).lerp(new Color('#000000'), 0.35);
  const mat = new ShaderMaterial({
    uniforms: {
      ...shared,
      uLeft: { value: -W / 2 },
      uWidth: { value: W },
      uColor: { value: tint },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uLeft;
      uniform float uWidth;
      attribute vec4 aSchool;
      attribute vec4 aOff;
      attribute float aScale;
      varying vec3 vWorld;
      void main() {
        float dir = sign(aSchool.w);
        float x = uLeft + mod(aSchool.x + aSchool.w * uTime - uLeft, uWidth);
        vec3 c = vec3(x, aSchool.y + sin(uTime * 0.13 + aSchool.x) * 1.4, aSchool.z) + aOff.xyz;
        c += vec3(sin(uTime * 0.7 + aOff.w * 5.0) * 0.35, sin(uTime * 0.9 + aOff.w * 3.0) * 0.25, 0.0);
        vec3 p = position;
        float tail = smoothstep(-0.1, -0.5, p.x);
        p.y += sin(uTime * 9.0 + aOff.w * 10.0) * 0.05 * tail;
        p.x *= dir;
        vec3 wp = c + p * aScale;
        vWorld = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${waterPrelude(false)}
      uniform vec3 uColor;
      varying vec3 vWorld;
      void main() {
        vec3 col = uColor * mix(uDeepLight, 1.0, clamp(vWorld.y / uSurfaceY, 0.0, 1.0));
        gl_FragColor = vec4(ffFog(col, vWorld), 1.0);
      }
    `,
    side: DoubleSide,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'ambient-schools';
  return {
    object: mesh,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}
