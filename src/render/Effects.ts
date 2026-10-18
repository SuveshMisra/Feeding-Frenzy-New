import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  NormalBlending,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector3,
  type Blending,
} from 'three';
const PKind = { Bubble: 0, Dot: 1, Glow: 2 } as const;
type PKind = (typeof PKind)[keyof typeof PKind];

const pointVertex = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
attribute float aKind;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
varying float vKind;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / -mv.z, 1.0, 256.0);
  vAlpha = aAlpha;
  vColor = aColor;
  vKind = aKind;
}
`;

const pointFragment = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
varying float vKind;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.y = -p.y;
  float r = length(p);
  if (r > 1.0) discard;
  vec3 col = vColor;
  float a;
  if (vKind < 0.5) {
    float rim = smoothstep(0.55, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r));
    float hl = 1.0 - smoothstep(0.0, 0.3, length(p - vec2(-0.34, 0.36)));
    a = rim * 0.85 + hl * 0.95 + 0.07;
    col = mix(col, vec3(1.0), hl * 0.9);
  } else if (vKind < 1.5) {
    a = 1.0 - smoothstep(0.15, 1.0, r);
  } else {
    a = pow(max(0.0, 1.0 - r), 2.2);
  }
  gl_FragColor = vec4(col, a * vAlpha);
}
`;

class ParticleLayer {
  readonly points: Points;
  private readonly cap: number;
  private count = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly drag: Float32Array;
  private readonly buoy: Float32Array;
  private readonly wobble: Float32Array;
  private readonly col: Float32Array;
  private readonly kind: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly geo: BufferGeometry;
  readonly material: ShaderMaterial;

  constructor(capacity: number, blending: Blending) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.buoy = new Float32Array(capacity);
    this.wobble = new Float32Array(capacity);
    this.col = new Float32Array(capacity * 3);
    this.kind = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.geo = new BufferGeometry();
    const attr = (name: string, arr: Float32Array, n: number): void => {
      // Must reference arr: Float32BufferAttribute copies it, so later writes would never reach the GPU.
      const a = new BufferAttribute(arr, n);
      a.setUsage(DynamicDrawUsage);
      this.geo.setAttribute(name, a);
    };
    attr('position', this.pos, 3);
    attr('aColor', this.col, 3);
    attr('aSize', this.size, 1);
    attr('aAlpha', this.alpha, 1);
    attr('aKind', this.kind, 1);
    this.geo.setDrawRange(0, 0);
    this.material = new ShaderMaterial({
      vertexShader: pointVertex,
      fragmentShader: pointFragment,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    sizeEnd: number,
    color: Color,
    kind: PKind,
    drag = 2,
    buoy = 0,
    alpha = 1,
  ): void {
    let i = this.count;
    if (i >= this.cap) i = Math.floor(Math.random() * this.cap);
    else this.count++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size;
    this.size1[i] = sizeEnd;
    this.alpha0[i] = alpha;
    this.drag[i] = drag;
    this.buoy[i] = buoy;
    this.wobble[i] = Math.random() * 10;
    this.col[i * 3] = color.r;
    this.col[i * 3 + 1] = color.g;
    this.col[i * 3 + 2] = color.b;
    this.kind[i] = kind;
  }

  update(dt: number, time: number): void {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + this.buoy[i] * dt;
      this.vel[i * 3 + 2] *= k;
      const wob = this.kind[i] === PKind.Bubble ? Math.sin(time * 9 + this.wobble[i]) * 0.35 : 0;
      this.pos[i * 3] += (this.vel[i * 3] + wob) * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      const fadeIn = Math.min(1, t * 8);
      const fadeOut = Math.min(1, (1 - t) * 3);
      this.alpha[i] = this.alpha0[i] * fadeIn * fadeOut;
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    for (const name of ['position', 'aColor', 'aSize', 'aAlpha', 'aKind']) {
      const a = this.geo.getAttribute(name) as BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  private copy(from: number, to: number): void {
    for (let c = 0; c < 3; c++) {
      this.pos[to * 3 + c] = this.pos[from * 3 + c];
      this.vel[to * 3 + c] = this.vel[from * 3 + c];
      this.col[to * 3 + c] = this.col[from * 3 + c];
    }
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.size0[to] = this.size0[from];
    this.size1[to] = this.size1[from];
    this.alpha0[to] = this.alpha0[from];
    this.drag[to] = this.drag[from];
    this.buoy[to] = this.buoy[from];
    this.wobble[to] = this.wobble[from];
    this.kind[to] = this.kind[from];
    this.size[to] = this.size[from];
    this.alpha[to] = this.alpha[from];
  }

  clear(): void {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}

const ringVertex = /* glsl */ `
attribute vec4 aRing;
attribute vec3 aRingColor;
varying vec2 vUv;
varying vec4 vRing;
varying vec3 vColor;
void main() {
  vUv = uv;
  vRing = aRing;
  vColor = aRingColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const ringFragment = /* glsl */ `
varying vec2 vUv;
varying vec4 vRing;
varying vec3 vColor;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float w = vRing.y;
  float ring = smoothstep(1.0 - w, 1.0 - w * 0.5, r) * (1.0 - smoothstep(1.0 - w * 0.5, 1.0, r));
  float fill = (1.0 - smoothstep(0.0, 1.0, r)) * vRing.w;
  gl_FragColor = vec4(vColor, (ring + fill) * vRing.z);
}
`;

interface Ring {
  x: number;
  y: number;
  z: number;
  t: number;
  dur: number;
  size: number;
  thick: number;
  color: Color;
  fill: number;
}

class RingLayer {
  readonly mesh: InstancedMesh;
  private readonly rings: Ring[] = [];
  private readonly ringAttr: InstancedBufferAttribute;
  private readonly colorAttr: InstancedBufferAttribute;
  private readonly m = new Matrix4();
  private readonly v = new Vector3();

  constructor(private readonly cap: number) {
    const geo = new PlaneGeometry(1, 1);
    this.ringAttr = new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.colorAttr = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.ringAttr.setUsage(DynamicDrawUsage);
    this.colorAttr.setUsage(DynamicDrawUsage);
    geo.setAttribute('aRing', this.ringAttr);
    geo.setAttribute('aRingColor', this.colorAttr);
    const mat = new ShaderMaterial({
      vertexShader: ringVertex,
      fragmentShader: ringFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new InstancedMesh(geo, mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 6;
  }

  add(x: number, y: number, z: number, color: Color, size: number, dur: number, thick: number, fill = 0): void {
    if (this.rings.length >= this.cap) this.rings.shift();
    this.rings.push({ x, y, z, t: 0, dur, size, thick, color: color.clone(), fill });
  }

  update(dt: number): void {
    const ra = this.ringAttr.array as Float32Array;
    const ca = this.colorAttr.array as Float32Array;
    let n = 0;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      if (r.t >= r.dur) {
        this.rings.splice(i, 1);
      }
    }
    for (const r of this.rings) {
      const k = r.t / r.dur;
      const ease = 1 - Math.pow(1 - k, 3);
      const s = r.size * (0.2 + ease * 0.8);
      this.v.set(r.x, r.y, r.z);
      this.m.makeScale(s, s, s).setPosition(this.v);
      this.mesh.setMatrixAt(n, this.m);
      ra[n * 4] = k;
      ra[n * 4 + 1] = r.thick;
      ra[n * 4 + 2] = (1 - k) * (1 - k);
      ra[n * 4 + 3] = r.fill;
      ca[n * 3] = r.color.r;
      ca[n * 3 + 1] = r.color.g;
      ca[n * 3 + 2] = r.color.b;
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.ringAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  clear(): void {
    this.rings.length = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
    this.mesh.dispose();
  }
}

const WHITE = new Color('#ffffff');
const BUBBLE = new Color('#d8fbff');
const INK = new Color('#5a0d1a');
const WAKE = new Color('#bdf4ff');
const tmp = new Color();

/** Particles and flashes for bites, growth, deaths and explosions. */
export class Effects {
  readonly group = new Group();
  private readonly bubbles: ParticleLayer;
  private readonly soft: ParticleLayer;
  private readonly glow: ParticleLayer;
  private readonly rings: RingLayer;
  private trailAcc = 0;
  private sandAcc = 0;
  private wakeAcc = 0;
  private suckAcc = 0;
  private geyserAcc = 0;
  private time = 0;
  density = 1;

  constructor(capacity = 2400) {
    this.bubbles = new ParticleLayer(capacity, NormalBlending);
    this.soft = new ParticleLayer(Math.floor(capacity * 0.6), NormalBlending);
    this.glow = new ParticleLayer(Math.floor(capacity * 0.6), AdditiveBlending);
    this.rings = new RingLayer(32);
    this.group.add(this.soft.points, this.bubbles.points, this.glow.points, this.rings.mesh);
  }

  /** Pixel scale for point sizes: viewport height / (2 tan(fov / 2)). */
  setViewport(heightPx: number, fovDeg: number, dpr: number): void {
    const s = (heightPx * dpr) / (2 * Math.tan((fovDeg * Math.PI) / 360));
    for (const l of [this.bubbles, this.soft, this.glow]) l.material.uniforms.uScale.value = s;
  }

  update(dt: number): void {
    this.time += dt;
    this.bubbles.update(dt, this.time);
    this.soft.update(dt, this.time);
    this.glow.update(dt, this.time);
    this.rings.update(dt);
  }

  private n(count: number): number {
    return Math.max(1, Math.round(count * this.density));
  }

  bubbleBurst(x: number, y: number, z: number, count: number, size = 0.14, spread = 0.5, speed = 1.6): void {
    for (let i = 0; i < this.n(count); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random());
      this.bubbles.emit(
        x + Math.cos(a) * spread * Math.random(),
        y + Math.sin(a) * spread * Math.random(),
        z + (Math.random() - 0.5) * spread,
        Math.cos(a) * s,
        Math.sin(a) * s,
        (Math.random() - 0.5) * s,
        1.2 + Math.random() * 1.4,
        size * (0.5 + Math.random()),
        size * 1.3,
        BUBBLE,
        PKind.Bubble,
        2.2,
        2.6 + Math.random() * 1.5,
        0.9,
      );
    }
  }

  /** Continuous bubble trail; `strength` 0..1. */
  trail(x: number, y: number, z: number, strength: number, dt: number, size = 0.1): void {
    this.trailAcc += strength * dt * 14 * this.density;
    while (this.trailAcc >= 1) {
      this.trailAcc -= 1;
      this.bubbles.emit(
        x + (Math.random() - 0.5) * 0.2,
        y + (Math.random() - 0.5) * 0.2,
        z + (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.4,
        0.2,
        0,
        1 + Math.random(),
        size * (0.5 + Math.random() * 0.8),
        size * 1.2,
        BUBBLE,
        PKind.Bubble,
        1.5,
        2.2,
        0.75,
      );
    }
  }

  /** Silt kicked up around (x, y) by something swimming fast just above the seabed. */
  sandPuff(x: number, y: number, z: number, strength: number, color: Color, dt: number): void {
    this.sandAcc += strength * dt * 30 * this.density;
    while (this.sandAcc >= 1) {
      this.sandAcc -= 1;
      this.soft.emit(
        x + (Math.random() - 0.5) * 0.8,
        y + Math.random() * 0.4,
        z + 0.2 + Math.random() * 0.5,
        (Math.random() - 0.5) * 2,
        2.2 + Math.random() * 2.2,
        (Math.random() - 0.5) * 0.6,
        1.8 + Math.random() * 1.2,
        0.4 + Math.random() * 0.3,
        1.8 + Math.random() * 1,
        color,
        PKind.Dot,
        1.6,
        0.35,
        0.7,
      );
    }
  }

  /** Faint shimmer of disturbed water behind a dashing fish. */
  wake(x: number, y: number, z: number, vx: number, vy: number, size: number, dt: number): void {
    this.wakeAcc += dt * 40 * this.density;
    while (this.wakeAcc >= 1) {
      this.wakeAcc -= 1;
      this.glow.emit(
        x + (Math.random() - 0.5) * size * 0.6,
        y + (Math.random() - 0.5) * size * 0.6,
        z,
        -vx * 0.15 + (Math.random() - 0.5) * 0.6,
        -vy * 0.15 + (Math.random() - 0.5) * 0.6,
        0,
        0.35 + Math.random() * 0.25,
        size * (0.5 + Math.random() * 0.4),
        size * 0.1,
        WAKE,
        PKind.Glow,
        3,
        0,
        0.22,
      );
    }
  }

  eatBurst(x: number, y: number, color: Color, size: number): void {
    const s = Math.max(0.6, size);
    for (let i = 0; i < this.n(10 + s * 6); i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (1.2 + Math.random() * 2.4) * s;
      tmp.copy(color).lerp(WHITE, Math.random() * 0.3);
      this.soft.emit(x, y, 0.3, Math.cos(a) * v, Math.sin(a) * v, (Math.random() - 0.5) * v, 0.45 + Math.random() * 0.5, 0.12 * s, 0.02, tmp, PKind.Dot, 5, -1.5, 0.95);
    }
    for (let i = 0; i < this.n(8); i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 2 + Math.random() * 3;
      this.glow.emit(x, y, 0.4, Math.cos(a) * v, Math.sin(a) * v, 0, 0.35 + Math.random() * 0.3, 0.25 * s, 0.02, WHITE, PKind.Glow, 6, 0, 0.8);
    }
    this.bubbleBurst(x, y, 0.2, 6 + s * 3, 0.1 * s, 0.3 * s, 1.4);
    this.rings.add(x, y, 0.5, tmp.copy(color).lerp(WHITE, 0.5), 1.4 * s + 0.6, 0.35, 0.22);
  }

  sparkle(x: number, y: number, color: Color, count: number, speed = 3, size = 0.35): void {
    for (let i = 0; i < this.n(count); i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.glow.emit(x, y, 0.5, Math.cos(a) * v, Math.sin(a) * v, (Math.random() - 0.5) * v, 0.6 + Math.random() * 0.6, size * (0.5 + Math.random()), 0.02, color, PKind.Glow, 3.5, 0.3, 1);
    }
  }

  deathCloud(x: number, y: number, size: number): void {
    for (let i = 0; i < this.n(26); i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.6 + Math.random() * 2.2;
      tmp.copy(INK).offsetHSL(0, 0, Math.random() * 0.15);
      this.soft.emit(x, y, 0.4, Math.cos(a) * v, Math.sin(a) * v, 0, 1.2 + Math.random() * 1.2, 0.35 * size, 1.3 * size, tmp, PKind.Dot, 2.2, 0.2, 0.7);
    }
    this.bubbleBurst(x, y, 0.3, 24, 0.16, 0.6, 3);
    this.rings.add(x, y, 0.6, tmp.set('#ff5a6e'), 3.5 * size, 0.5, 0.18);
  }

  growBurst(x: number, y: number, size: number): void {
    this.sparkle(x, y, tmp.set('#fff3b0'), 40, 6, 0.5);
    this.sparkle(x, y, tmp.set('#7ff6ff'), 30, 4.5, 0.4);
    this.bubbleBurst(x, y, 0.3, 40, 0.18, size * 0.5, 4);
    this.rings.add(x, y, 0.6, tmp.set('#fff6c8'), size * 4.5, 0.7, 0.12, 0.25);
    this.rings.add(x, y, 0.6, tmp.set('#7ff6ff'), size * 3, 0.5, 0.2);
  }

  explosion(x: number, y: number, radius: number): void {
    this.sparkle(x, y, tmp.set('#ffcf7a'), 50, radius * 2.2, 0.7);
    this.sparkle(x, y, tmp.set('#ff6a3a'), 30, radius * 1.4, 0.9);
    for (let i = 0; i < this.n(24); i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 1 + Math.random() * radius;
      this.soft.emit(x, y, 0.3, Math.cos(a) * v, Math.sin(a) * v, 0, 1.5 + Math.random() * 1.5, 0.6, 2.2, tmp.set('#3b3f45'), PKind.Dot, 2, 0.6, 0.55);
    }
    this.bubbleBurst(x, y, 0.3, 60, 0.22, radius * 0.4, radius * 1.2);
    this.rings.add(x, y, 0.7, tmp.set('#ffe0a0'), radius * 2.4, 0.55, 0.14, 0.6);
  }

  /**
   * Water streaming into a mouth at (x, y) from a cone along (dirX, dirY): motes and bubbles
   * that spiral inward and vanish at the lips. Call every step while the vortex runs.
   */
  suctionStream(x: number, y: number, dirX: number, dirY: number, reach: number, halfAngle: number, dt: number): void {
    this.suckAcc += dt * 90 * this.density;
    while (this.suckAcc >= 1) {
      this.suckAcc -= 1;
      const a = Math.atan2(dirY, dirX) + (Math.random() * 2 - 1) * halfAngle;
      const d = reach * (0.35 + Math.random() * 0.65);
      const sx = x + Math.cos(a) * d;
      const sy = y + Math.sin(a) * d;
      const speed = 7 + reach * 0.9;
      const life = d / speed;
      // Inward with a sideways swirl.
      const ix = (x - sx) / d;
      const iy = (y - sy) / d;
      const swirl = 0.35;
      const vx = (ix - iy * swirl) * speed;
      const vy = (iy + ix * swirl) * speed;
      if (Math.random() < 0.55) {
        this.glow.emit(sx, sy, 0.45, vx, vy, 0, life, 0.16 + Math.random() * 0.12, 0.04, tmp.set('#bff8ff'), PKind.Glow, 0, 0, 0.55);
      } else {
        this.bubbles.emit(sx, sy, 0.35, vx, vy, 0, life, 0.08 + Math.random() * 0.08, 0.03, BUBBLE, PKind.Bubble, 0, 0, 0.8);
      }
    }
  }

  /**
   * Lava geyser spray from a vent at (x, y). While `erupting`, embers, bubbles and ash
   * shoot up a column of `height`; otherwise a few warning bubbles and sparks escape.
   */
  geyserSpray(x: number, y: number, height: number, dt: number, erupting: boolean): void {
    this.geyserAcc += dt * (erupting ? 75 : 14) * this.density;
    while (this.geyserAcc >= 1) {
      this.geyserAcc -= 1;
      const r = Math.random();
      const jx = (Math.random() - 0.5) * 0.9;
      if (erupting) {
        const up = height * (1.4 + Math.random() * 0.8);
        if (r < 0.45) {
          this.glow.emit(x + jx, y + Math.random() * 0.5, 0.3 + (Math.random() - 0.5) * 0.6, jx * 2, up, 0, 0.35 + Math.random() * 0.35, 0.3 + Math.random() * 0.35, 0.05, tmp.set(Math.random() < 0.5 ? '#ffb050' : '#ff5a1f'), PKind.Glow, 1.2, 0, 0.9);
        } else if (r < 0.8) {
          this.bubbles.emit(x + jx * 1.2, y + Math.random() * height * 0.8, 0.3, jx * 2.5, up * 0.5, (Math.random() - 0.5), 0.6 + Math.random() * 0.6, 0.1 + Math.random() * 0.12, 0.2, BUBBLE, PKind.Bubble, 2, 3, 0.8);
        } else {
          this.soft.emit(x + jx * 1.4, y + height * (0.7 + Math.random() * 0.3), 0.2, jx * 2, 2 + Math.random() * 2, 0, 1.4 + Math.random(), 0.5, 1.9, tmp.set('#2e2a2a'), PKind.Dot, 1.5, 0.5, 0.5);
        }
      } else if (r < 0.6) {
        this.bubbles.emit(x + jx, y + 0.2, 0.3, jx * 0.5, 1.5 + Math.random() * 1.5, 0, 1 + Math.random(), 0.06 + Math.random() * 0.08, 0.12, BUBBLE, PKind.Bubble, 1.5, 2.5, 0.75);
      } else {
        this.glow.emit(x + jx * 0.7, y + 0.1, 0.3, jx * 0.6, 0.8 + Math.random(), 0, 0.5 + Math.random() * 0.4, 0.18, 0.04, tmp.set('#ff7a2a'), PKind.Glow, 1, 0, 0.8);
      }
    }
  }

  /**
   * One particle for level features: an additive 'glow' mote, a soft 'dot' or a 'bubble'.
   * Respects the quality density by randomly skipping.
   */
  mote(kind: 'glow' | 'dot' | 'bubble', x: number, y: number, z: number, vx: number, vy: number, life: number, size: number, sizeEnd: number, color: Color, drag = 2, buoy = 0, alpha = 1): void {
    if (this.density < 1 && Math.random() > this.density) return;
    const layer = kind === 'glow' ? this.glow : kind === 'dot' ? this.soft : this.bubbles;
    const k = kind === 'glow' ? PKind.Glow : kind === 'dot' ? PKind.Dot : PKind.Bubble;
    layer.emit(x, y, z, vx, vy, (Math.random() - 0.5) * 0.3, life, size, sizeEnd, kind === 'bubble' ? BUBBLE : color, k, drag, buoy, alpha);
  }

  pickupBurst(x: number, y: number, color: Color): void {
    this.sparkle(x, y, color, 26, 3.5, 0.45);
    this.rings.add(x, y, 0.6, color, 3, 0.45, 0.2, 0.2);
    this.bubbleBurst(x, y, 0.2, 10, 0.12, 0.4, 1.6);
  }

  ring(x: number, y: number, color: Color, size: number, dur = 0.5, thick = 0.18): void {
    this.rings.add(x, y, 0.5, color, size, dur, thick);
  }

  clear(): void {
    this.bubbles.clear();
    this.soft.clear();
    this.glow.clear();
    this.rings.clear();
  }

  dispose(): void {
    this.bubbles.dispose();
    this.soft.dispose();
    this.glow.dispose();
    this.rings.dispose();
  }
}