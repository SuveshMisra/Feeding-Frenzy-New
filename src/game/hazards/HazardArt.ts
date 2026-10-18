import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  ShaderMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  CatmullRomCurve3,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial, shared, waterPrelude } from '../../engine/materialPatches';
import { Rng } from '../../engine/rng';

function withPart(geo: BufferGeometry, part: number): BufferGeometry {
  const n = geo.getAttribute('position').count;
  geo.setAttribute('aPart', new Float32BufferAttribute(new Float32Array(n).fill(part), 1));
  for (const name of Object.keys(geo.attributes)) {
    if (!['position', 'normal', 'aPart'].includes(name)) geo.deleteAttribute(name);
  }
  return geo;
}

/** Bell + frilly oral arms + trailing tentacles, unit size (bell radius ~1). */
export function buildJellyGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const profile: Vector2[] = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * Math.PI * 0.5;
    const r = Math.sin(a) * (1 + 0.08 * Math.sin(t * Math.PI));
    const y = Math.cos(a) * 0.78 - (t > 0.85 ? (t - 0.85) * 0.9 : 0);
    profile.push(new Vector2(Math.max(0.001, r), y));
  }
  // Inner surface of the bell (thin skirt)
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    const a = t * Math.PI * 0.5;
    profile.push(new Vector2(Math.max(0.001, Math.sin(a) * 0.9), Math.cos(a) * 0.6 - 0.05));
  }
  const bell = new LatheGeometry(profile, 28);
  const pieces: BufferGeometry[] = [withPart(bell, 0)];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    const pts: Vector3[] = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      pts.push(new Vector3(Math.cos(a) * 0.18 + Math.sin(t * 7 + i) * 0.1, -t * 1.5, Math.sin(a) * 0.18 + Math.cos(t * 6 + i) * 0.1));
    }
    const arm = new TubeGeometry(new CatmullRomCurve3(pts), 16, 0.08, 5, false);
    pieces.push(withPart(arm, 1));
  }
  const tentacles = 10;
  for (let i = 0; i < tentacles; i++) {
    const a = (i / tentacles) * Math.PI * 2;
    const len = rng.range(2.2, 3.4);
    const pts: Vector3[] = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      pts.push(new Vector3(Math.cos(a) * 0.86 * (1 - t * 0.3), -0.02 - t * len, Math.sin(a) * 0.86 * (1 - t * 0.3)));
    }
    const tube = new TubeGeometry(new CatmullRomCurve3(pts), 20, 0.022, 3, false);
    pieces.push(withPart(tube, 2));
  }
  const merged = mergeGeometries(pieces, false)!;
  merged.computeBoundingSphere();
  return merged;
}

export function jellyMaterial(color: string, glow: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...shared,
      uColor: { value: new Color(color) },
      uGlow: { value: new Color(glow) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aPart;
      attribute float aPhase;
      varying float vPart;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vWorld;
      varying float vY;
      void main() {
        vec3 p = position;
        float ph = uTime * 2.4 + aPhase;
        float pulse = sin(ph);
        vPart = aPart;
        vY = position.y;
        if (aPart < 0.5) {
          float rim = smoothstep(0.7, -0.1, p.y);
          p.xz *= 1.0 - 0.16 * pulse * (0.35 + rim);
          p.y *= 1.0 + 0.1 * pulse;
        } else {
          float d = max(0.0, -p.y);
          p.x += sin(ph * 0.5 + d * 1.8 + aPhase) * d * 0.14;
          p.z += cos(ph * 0.45 + d * 1.5) * d * 0.1;
          p.y += pulse * 0.06 * d;
        }
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${waterPrelude(false)}
      uniform vec3 uColor;
      uniform vec3 uGlow;
      varying float vPart;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vWorld;
      varying float vY;
      void main() {
        float fres = pow(max(1.0 - abs(dot(normalize(vN), vView)), 0.0), 2.0);
        vec3 col;
        float a;
        if (vPart < 0.5) {
          float spots = smoothstep(0.55, 0.9, sin(vWorld.x * 9.0) * sin(vY * 14.0));
          col = mix(uColor, uGlow, fres) * (0.6 + fres * 1.4) + uGlow * spots * 0.25;
          a = 0.28 + fres * 0.55;
        } else if (vPart < 1.5) {
          col = mix(uColor, uGlow, 0.5) * 1.1;
          a = 0.55;
        } else {
          col = uGlow * 1.2;
          a = 0.45 * smoothstep(-3.6, -0.5, vY) + 0.1;
        }
        col = ffFog(col, vWorld);
        gl_FragColor = vec4(col, a * (1.0 - ffFogFactor(vWorld) * 0.6));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** Spiky sea mine centred at the origin, radius ~0.75. */
export function buildMineGeometry(): BufferGeometry {
  const pieces: BufferGeometry[] = [];
  const core = new IcosahedronGeometry(0.72, 3);
  pieces.push(core);
  const dirs: Vector3[] = [];
  const count = 14;
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const phi = i * 2.399963;
    dirs.push(new Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r));
  }
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  for (const d of dirs) {
    const spike = new CylinderGeometry(0.05, 0.11, 0.42, 7, 1);
    const cap = new SphereGeometry(0.075, 8, 6);
    cap.translate(0, 0.22, 0);
    const m = new Matrix4().compose(d.clone().multiplyScalar(0.84), q.setFromUnitVectors(up, d), new Vector3(1, 1, 1));
    spike.applyMatrix4(m);
    cap.applyMatrix4(m);
    pieces.push(spike, cap);
  }
  const band = new TorusGeometry(0.73, 0.05, 6, 32);
  band.rotateX(Math.PI / 2);
  pieces.push(band);
  const cleaned = pieces.map((g) => {
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    return g.index ? g.toNonIndexed() : g;
  });
  const merged = mergeGeometries(cleaned, false)!;
  merged.computeVertexNormals();
  return merged;
}

export function mineMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: '#3b3a36', roughness: 0.55, metalness: 0.75 });
  return patchMaterial(m, { caustics: true, rim: { color: new Color('#ff9b6b'), power: 3, strength: 0.08 } });
}

export function chainMaterial(): MeshStandardMaterial {
  return patchMaterial(new MeshStandardMaterial({ color: '#2d2b27', roughness: 0.7, metalness: 0.6 }), { caustics: true });
}

/** Scalloped shell half, hinge at the origin, opening toward +x. */
export function buildShellGeometry(top: boolean): BufferGeometry {
  const ribs = 11;
  const segU = 44;
  const segV = 12;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= segV; j++) {
    const v = j / segV;
    for (let i = 0; i <= segU; i++) {
      const u = i / segU;
      const ang = (u - 0.5) * Math.PI * 0.95;
      const r = v * 1.0;
      const rib = Math.pow(Math.abs(Math.sin(u * Math.PI * ribs)), 0.6) * 0.06 * v;
      const bulge = Math.sin(v * Math.PI * 0.95) * 0.32 + rib;
      const x = Math.cos(ang) * r * 1.05;
      const z = Math.sin(ang) * r * 0.95;
      const y = (top ? 1 : -1) * bulge;
      pos.push(x, y, z);
    }
  }
  const row = segU + 1;
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      if (top) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function shellMaterial(): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({
    color: '#c9a7a0',
    roughness: 0.45,
    metalness: 0.05,
    clearcoat: 0.6,
    iridescence: 0.7,
    iridescenceIOR: 1.6,
    side: DoubleSide,
  });
  return patchMaterial(m, { caustics: true });
}

export function pearlMaterial(black: boolean): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({
    color: black ? '#1c1a24' : '#f6f1ea',
    roughness: 0.12,
    metalness: 0.1,
    clearcoat: 1,
    iridescence: 1,
    iridescenceIOR: 1.8,
    emissive: black ? '#3a1f5a' : '#fff6e8',
    emissiveIntensity: black ? 0.6 : 0.35,
  });
  return patchMaterial(m, {});
}

export type PickupKind = 'gem' | 'speed' | 'shield' | 'life';

export const PICKUP_COLORS: Record<PickupKind, string> = {
  gem: '#54ffb0',
  speed: '#ffe35a',
  shield: '#5fe8ff',
  life: '#ff5f8f',
};

function heartShape(): Shape {
  const s = new Shape();
  s.moveTo(0, -0.45);
  s.bezierCurveTo(-0.1, -0.3, -0.5, -0.05, -0.5, 0.18);
  s.bezierCurveTo(-0.5, 0.42, -0.2, 0.5, 0, 0.3);
  s.bezierCurveTo(0.2, 0.5, 0.5, 0.42, 0.5, 0.18);
  s.bezierCurveTo(0.5, -0.05, 0.1, -0.3, 0, -0.45);
  return s;
}

function boltShape(): Shape {
  const s = new Shape();
  s.moveTo(0.08, 0.5);
  s.lineTo(-0.28, 0.02);
  s.lineTo(-0.02, 0.02);
  s.lineTo(-0.12, -0.5);
  s.lineTo(0.28, 0.06);
  s.lineTo(0.02, 0.06);
  s.closePath();
  return s;
}

export function buildPickupGeometry(kind: PickupKind): BufferGeometry {
  const extrude = { depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 2, curveSegments: 10 };
  let g: BufferGeometry;
  switch (kind) {
    case 'gem':
      g = new OctahedronGeometry(0.42, 0);
      g.scale(0.8, 1.1, 0.8);
      break;
    case 'speed':
      g = new ExtrudeGeometry(boltShape(), extrude);
      g.translate(0, 0, -0.08);
      break;
    case 'shield':
      g = new TorusGeometry(0.34, 0.09, 10, 28);
      break;
    case 'life':
      g = new ExtrudeGeometry(heartShape(), extrude);
      g.translate(0, 0, -0.08);
      break;
  }
  g.computeVertexNormals();
  return g;
}

export function pickupMaterial(kind: PickupKind): MeshStandardMaterial {
  const c = new Color(PICKUP_COLORS[kind]);
  const m = new MeshPhysicalMaterial({
    color: c,
    emissive: c,
    emissiveIntensity: 1.1,
    roughness: 0.2,
    metalness: 0.2,
    clearcoat: 1,
    flatShading: kind === 'gem',
  });
  return patchMaterial(m, {});
}

/** A lumpy basalt crater with a glowing throat (the throat is painted bright for `glow`). */
export function buildGeyserVentGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const profile = [
    new Vector2(0.0, 0.05),
    new Vector2(0.3, 0.08),
    new Vector2(0.4, 0.38),
    new Vector2(0.62, 0.55),
    new Vector2(0.9, 0.45),
    new Vector2(1.3, 0.22),
    new Vector2(1.75, 0.02),
    new Vector2(2.1, -0.3),
  ];
  const geo = new LatheGeometry(profile, 18);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const bumps = Array.from({ length: 18 }, () => rng.range(0.85, 1.2));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const k = bumps[Math.floor(((a / (Math.PI * 2) + 1) % 1) * 18) % 18];
    const y = pos.getY(i) * (r > 0.5 ? k : 1);
    pos.setY(i, y);
    // Hot throat, cooling to black rock outside the rim.
    const heat = Math.max(0, 1 - (r - 0.3) / 0.35);
    colors[i * 3] = 0.16 + heat * 0.84;
    colors[i * 3 + 1] = 0.13 + heat * 0.17;
    colors[i * 3 + 2] = 0.12 - heat * 0.07;
  }
  geo.deleteAttribute('uv');
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export function geyserVentMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
  return patchMaterial(m, { glow: 2 });
}

/** A unit-height open cylinder (base at y = 0) for the eruption column. */
export function buildGeyserColumnGeometry(): BufferGeometry {
  const geo = new CylinderGeometry(0.75, 0.45, 1, 16, 12, true);
  geo.translate(0, 0.5, 0);
  return geo;
}

/** Additive boiling column: hot streaks racing upward, soft at the edges and top. */
export function geyserColumnMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: shared.uTime,
      uIntensity: { value: 0 },
      uHeight: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec3 p = position;
        // Boiling wobble that grows toward the top.
        float w = sin(p.y * 9.0 - uTime * 14.0 + uv.x * 18.0) * 0.08 * (0.3 + p.y);
        p.xz *= 1.0 + w + p.y * 0.35;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        // The column is stretched along y, so fresnel uses horizontal normals only.
        vN = normalize(mat3(modelMatrix) * vec3(normal.x, 0.0, normal.z));
        vec3 toCam = cameraPosition - wp.xyz;
        vView = normalize(vec3(toCam.x, 0.0, toCam.z));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      uniform float uHeight;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float facing = abs(dot(normalize(vN), vView));
        float core = pow(facing, 1.6);
        float y = vUv.y * uHeight;
        float flow = sin(vUv.x * 37.7 + sin(y * 0.9 - uTime * 4.0) * 1.5);
        float bands = sin(y * 1.6 - uTime * 15.0 + vUv.x * 12.6);
        float streak = clamp(0.5 + 0.3 * flow + 0.25 * bands, 0.0, 1.0);
        float fade = smoothstep(0.0, 0.06, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
        vec3 hot = mix(vec3(0.85, 0.07, 0.01), vec3(1.0, 0.4, 0.08), core * streak);
        float a = uIntensity * fade * (core * 0.8 + 0.2) * (0.35 + 0.65 * streak);
        gl_FragColor = vec4(hot * 1.1 * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

/** Soft fresnel bubble used for pickups and the player's shield. */
export function bubbleMaterial(color: string, strength = 1): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uStrength: { value: strength },
      uTime: shared.uTime,
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vLocal;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - wp.xyz);
        vLocal = position;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vLocal;
      void main() {
        float f = pow(max(1.0 - abs(dot(normalize(vN), vView)), 0.0), 2.5);
        float swirl = 0.5 + 0.5 * sin(vLocal.y * 8.0 + uTime * 2.0 + vLocal.x * 5.0);
        float hl = pow(max(0.0, dot(normalize(vN), normalize(vec3(-0.4, 0.7, 0.6)))), 24.0);
        vec3 col = uColor * (f * 1.4 + swirl * 0.12) + vec3(1.0) * hl * 0.9;
        gl_FragColor = vec4(col * uStrength, (f * 0.8 + hl * 0.8 + 0.04) * uStrength);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}
