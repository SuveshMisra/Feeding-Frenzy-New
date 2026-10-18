import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { shared, patchMaterial } from '../../engine/materialPatches';
import { lerp, smoothstep } from '../../engine/math';
import { Rng } from '../../engine/rng';
import { mergeParts, paint } from '../../env/props/shapes';

export interface RibbonOptions {
  color: string;
  /** Streak scroll speed along u (cycles per second, negative scrolls back). */
  scroll?: number;
  /** Streaks along the length. */
  streaks?: number;
  /** 0: solid, 1: fully streaked. */
  streakAmount?: number;
  /** Higher = thinner bright core across the width. */
  soft?: number;
  /** Fade length at each end, as a share of the length. */
  fadeIn?: number;
  fadeOut?: number;
  /** When set, draws this many thin dashed flow lines across the width instead of stripes. */
  lanes?: number;
}

/**
 * Additive glowing strip: u runs along its length, v across. Used for statue beams,
 * current streams and heat bands. Set `uIntensity` to show it.
 */
export function ribbonMaterial(o: RibbonOptions): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: shared.uTime,
      uIntensity: { value: 0 },
      uColor: { value: new Color(o.color) },
      uScroll: { value: o.scroll ?? 1 },
      uStreaks: { value: o.streaks ?? 6 },
      uStreakAmount: { value: o.streakAmount ?? 0.5 },
      uSoft: { value: o.soft ?? 1.5 },
      uFade: { value: [o.fadeIn ?? 0.08, o.fadeOut ?? 0.25] },
      uLanes: { value: o.lanes ?? 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      uniform vec3 uColor;
      uniform float uScroll;
      uniform float uStreaks;
      uniform float uStreakAmount;
      uniform float uSoft;
      uniform float uFade[2];
      uniform float uLanes;
      varying vec2 vUv;
      void main() {
        float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
        float edge = pow(clamp(across, 0.0, 1.0), uSoft);
        float along = smoothstep(0.0, uFade[0], vUv.x) * (1.0 - smoothstep(1.0 - uFade[1], 1.0, vUv.x));
        float streak;
        if (uLanes > 0.5) {
          float ly = vUv.y * uLanes + sin(vUv.x * 9.0 + uTime * 0.7) * 0.18;
          float lane = floor(ly);
          float h = fract(sin(lane * 12.9898 + 4.1) * 43758.5453);
          float thin = pow(1.0 - abs(fract(ly) - 0.5) * 2.0, 8.0);
          float d = fract(vUv.x * uStreaks * (0.7 + h * 0.6) - uTime * uScroll * (0.75 + h * 0.5) + h * 7.0);
          float dash = smoothstep(0.0, 0.12, d) * (1.0 - smoothstep(0.3, 0.62, d));
          streak = mix(0.12, 2.6, thin * dash);
        } else {
          float wob = sin(vUv.y * 11.0 + uTime * 1.7) * 0.35 + sin(vUv.y * 23.0 - uTime * 2.3) * 0.15;
          float s = 0.5 + 0.5 * sin((vUv.x * uStreaks - uTime * uScroll) * 6.2832 + wob * 3.0);
          streak = mix(1.0, s * s * 1.6, uStreakAmount);
        }
        float a = uIntensity * edge * along * streak;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

/** A unit strip from x = 0 to 1, y = -0.5 to 0.5, with u along x. */
export function ribbonGeometry(segments = 16): BufferGeometry {
  const g = new PlaneGeometry(1, 1, segments, 1);
  g.translate(0.5, 0, 0);
  return g;
}

/** A soft round additive glow on a unit plane facing the camera. Set `uIntensity` to show it. */
export function softGlowMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uIntensity: { value: 0 }, uColor: { value: new Color(color) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float r = length(vUv * 2.0 - 1.0);
        float a = pow(max(0.0, 1.0 - r), 2.2) * uIntensity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/** Unlit additive dot for glowing eyes and lamps. Brightness is the colour. */
export function glowMaterial(color: string): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
}

const UP = new Vector3(0, 1, 0);

/** Radial spikes on a unit sphere shell (a pufferfish's inflated spines), radius ~1.25. */
export function spikeShellGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const count = 34;
  const q = new Quaternion();
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const phi = i * 2.399963;
    const d = new Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r);
    const spike = new ConeGeometry(0.07, 0.36, 5, 1, true);
    spike.translate(0, 0.18, 0);
    paint(spike, (_x, sy, _z, c) => c.setScalar(lerp(0.75, 1.15, smoothstep(0, 0.36, sy))));
    spike.applyMatrix4(new Matrix4().compose(d.clone().multiplyScalar(0.92), q.setFromUnitVectors(UP, d), new Vector3(1, 1, 1)));
    spike.deleteAttribute('uv');
    parts.push(spike);
  }
  return mergeParts(parts);
}

export function spikeMaterial(): MeshStandardMaterial {
  return patchMaterial(new MeshStandardMaterial({ color: '#fff0c2', vertexColors: true, roughness: 0.45 }), { caustics: true });
}

const EEL_SKIN = new Color(0.34, 0.42, 0.15);
const EEL_BELLY = new Color(0.75, 0.72, 0.38);

function eelSpots(seed: number): (x: number, y: number, z: number, c: Color) => void {
  const rng = new Rng(seed);
  const spots: [number, number, number][] = Array.from({ length: 26 }, () => [rng.range(0, Math.PI * 2), rng.range(0, 1), rng.range(0.035, 0.07)]);
  return (x, y, z, c) => {
    const a = Math.atan2(z, x);
    c.copy(EEL_SKIN).lerp(EEL_BELLY, smoothstep(0.2, 1, Math.cos(a + Math.PI * 0.5)) * 0.6);
    for (const [sa, sy, sr] of spots) {
      const da = Math.atan2(Math.sin(a - sa), Math.cos(a - sa)) * 0.22;
      if (da * da + (y - sy) * (y - sy) < sr * sr) c.multiplyScalar(0.45);
    }
  };
}

/** A moray eel body along +y from y = 0 to 1: a tapered, mottled tube with a fin ridge. */
export function eelBodyGeometry(seed: number): BufferGeometry {
  const body = new CylinderGeometry(0.2, 0.25, 1, 12, 12, true);
  body.translate(0, 0.5, 0);
  const fin = new PlaneGeometry(0.14, 1, 1, 8);
  fin.rotateY(Math.PI / 2);
  fin.translate(-0.25, 0.5, 0);
  paint(body, eelSpots(seed));
  paint(fin, (_x, y, _z, c) => c.copy(EEL_SKIN).multiplyScalar(0.7 + y * 0.3));
  for (const g of [body, fin]) g.deleteAttribute('uv');
  return mergeParts([body, fin]);
}

/** The blunt upper head, sitting on the body's end at the origin and pointing along +y. */
export function eelHeadGeometry(seed: number): BufferGeometry {
  const head = new SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  head.scale(1.05, 2, 1.15);
  paint(head, eelSpots(seed + 1));
  head.deleteAttribute('uv');
  return head;
}

/** Lower jaw, hinged at the origin, pointing along +y. */
export function eelJawGeometry(): BufferGeometry {
  const g = new ConeGeometry(0.13, 0.38, 10, 1, false);
  g.translate(0, 0.19, 0);
  g.scale(1, 1, 0.8);
  paint(g, (_x, y, _z, c) => c.copy(EEL_BELLY).multiplyScalar(0.7 + y * 0.8));
  g.deleteAttribute('uv');
  return g;
}

export function creatureMaterial(): MeshStandardMaterial {
  return patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: DoubleSide }), { caustics: true });
}

/** A hanging icicle: tip at the origin, root at y = 1. Bluish at the tip. */
export function icicleGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const main = new ConeGeometry(0.5, 1, 8, 6);
  main.rotateX(Math.PI);
  main.translate(0, 0.5, 0);
  parts.push(main);
  for (let k = 0; k < 3; k++) {
    const h = rng.range(0.3, 0.55);
    const c = new ConeGeometry(0.2, h, 6, 2);
    c.rotateX(Math.PI);
    c.translate(rng.range(-0.38, 0.38), 1 - h / 2, rng.range(-0.25, 0.25));
    parts.push(c);
  }
  for (const p of parts) {
    paint(p, (_x, y, _z, col) => col.setRGB(lerp(0.62, 0.95, y), lerp(0.85, 0.98, y), 1));
    p.deleteAttribute('uv');
  }
  return mergeParts(parts);
}

export function iceMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.9, flatShading: true });
  return patchMaterial(m, { rim: { color: new Color('#e8fbff'), power: 2.2, strength: 0.7 }, glow: 0.35 });
}

/** A lumpy burrow mound with a dark mouth facing the camera at (0, 0.75, 0.9). */
export function burrowGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const g = new IcosahedronGeometry(1, 3);
  g.deleteAttribute('uv');
  const pos = g.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = 1 + Math.sin(v.x * 3.1 + seed) * 0.08 + Math.sin(v.z * 4.3 + v.y * 2.7) * 0.06 + rng.range(-0.02, 0.02);
    v.multiplyScalar(n);
    // Scoop a mouth into the front, above the base.
    const dm = Math.hypot(v.x * 1.1, (v.y - 0.25) * 1.3);
    if (v.z > 0) v.z -= 0.45 * Math.exp(-dm * dm * 6) * v.z;
    v.set(v.x * 1.5, Math.max(-0.2, v.y) * 1.05, v.z * 1.0);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  paint(g, (x, y, z, c) => {
    const dm = Math.hypot(x / 1.5 * 1.1, (y / 1.05 - 0.25) * 1.3);
    const mouth = z > 0 ? Math.exp(-dm * dm * 7) : 0;
    c.setRGB(0.38, 0.33, 0.27).multiplyScalar(lerp(0.75, 1.1, smoothstep(-0.2, 1, y)) * (1 - mouth * 0.92));
  });
  return g;
}

export function rockMaterial(): MeshStandardMaterial {
  return patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true }), { caustics: true });
}

const BIRD_WHITE = new Color('#f4f3ee');
const BIRD_TIP = new Color('#2a2c30');

/** A gannet folded for a dive: beak pointing down -y from about y = -1.3, wings swept up behind. */
export function seabirdGeometry(): BufferGeometry {
  const body = new SphereGeometry(0.3, 14, 10);
  body.scale(1, 2.1, 0.95);
  paint(body, (_x, y, _z, c) => c.copy(BIRD_WHITE).multiplyScalar(lerp(0.82, 1, smoothstep(-0.6, 0.6, y))));
  const head = new SphereGeometry(0.21, 12, 8);
  head.translate(0, -0.66, 0.02);
  paint(head, (_x, y, _z, c) => c.set('#f3e3a6').lerp(BIRD_WHITE, smoothstep(-0.7, -0.5, y)));
  const beak = new ConeGeometry(0.075, 0.55, 8);
  beak.rotateX(Math.PI);
  beak.translate(0, -1.05, 0.02);
  paint(beak, (_x, _y, _z, c) => c.set('#9aa6ae'));
  const parts = [body, head, beak];
  for (const side of [-1, 1]) {
    const wing = new ConeGeometry(0.2, 1.7, 4);
    wing.scale(1, 1, 0.22);
    wing.translate(0, 0.85, 0);
    wing.rotateZ(side * -0.32);
    wing.translate(side * 0.24, -0.05, -0.04);
    paint(wing, (_x, y, _z, c) => c.copy(BIRD_WHITE).lerp(BIRD_TIP, smoothstep(0.85, 1.35, y)));
    parts.push(wing);
  }
  const tail = new ConeGeometry(0.15, 0.55, 6);
  tail.translate(0, 0.85, -0.02);
  paint(tail, (_x, y, _z, c) => c.copy(BIRD_WHITE).lerp(BIRD_TIP, smoothstep(0.9, 1.1, y)));
  parts.push(tail);
  for (const g of parts) g.deleteAttribute('uv');
  return mergeParts(parts);
}

/** A soft dark blob on a unit plane (a shadow or telegraph). Set `uOpacity` to show it. */
export function shadowMaterial(color = '#000a10'): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uColor: { value: new Color(color) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float r = length(vUv * 2.0 - 1.0);
        float a = (1.0 - smoothstep(0.3, 1.0, r)) * uOpacity;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

/** A cracked molten rock: dark crust with glowing seams (vertex colours, pair with a glow material). */
export function lavaBombGeometry(seed: number): BufferGeometry {
  const rng = new Rng(seed);
  const g = new IcosahedronGeometry(0.5, 2);
  g.deleteAttribute('uv');
  const pos = g.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.multiplyScalar(1 + rng.range(-0.12, 0.12));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  paint(g, (x, y, z, c) => {
    const seam = Math.abs(Math.sin(x * 9 + seed) + Math.sin(y * 11 + z * 7)) < 0.35 ? 1 : 0;
    c.setRGB(0.18, 0.1, 0.08).lerp(new Color(2.6, 0.9, 0.25), seam);
  });
  return g;
}
