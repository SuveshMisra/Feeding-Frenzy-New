import {
  CanvasTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture,
} from 'three';
import { Rng } from '../engine/rng';

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: false })!;
  return [c, ctx];
}

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Value noise that tiles every `period` lattice cells. */
export function periodicNoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const wx0 = ((x0 % period) + period) % period;
  const wy0 = ((y0 % period) + period) % period;
  const wx1 = (wx0 + 1) % period;
  const wy1 = (wy0 + 1) % period;
  const a = hash2(wx0, wy0, seed);
  const b = hash2(wx1, wy0, seed);
  const c = hash2(wx0, wy1, seed);
  const d = hash2(wx1, wy1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function fbmPeriodic(x: number, y: number, period: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += periodicNoise(x * freq, y * freq, period * freq, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function finishTexture<T extends Texture>(t: T, color: boolean): T {
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = color ? SRGBColorSpace : NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export function heightToNormal(heights: Float32Array, w: number, h: number, strength: number): DataTexture {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = heights[y * w + ((x - 1 + w) % w)];
      const r = heights[y * w + ((x + 1) % w)];
      const d = heights[((y - 1 + h) % h) * w + x];
      const u = heights[((y + 1) % h) * w + x];
      let nx = (l - r) * strength;
      let ny = (d - u) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * w + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
  return finishTexture(tex, false);
}

/** Sand grain color variation plus a rippled normal map. */
export function makeSandTextures(): { color: Texture; normal: Texture } {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const heights = new Float32Array(size * size);
  const rng = new Rng(77);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = fbmPeriodic(u * 8, v * 8, 8, 4, 3);
      const speck = rng.next();
      let g = 0.82 + (n - 0.5) * 0.35;
      if (speck > 0.985) g *= 0.72;
      else if (speck < 0.012) g = Math.min(1, g * 1.25);
      const i = (y * size + x) * 4;
      img.data[i] = g * 255;
      img.data[i + 1] = g * 250;
      img.data[i + 2] = g * 238;
      img.data[i + 3] = 255;
      const ripple = Math.sin((u * 6 + fbmPeriodic(u * 4, v * 4, 4, 2, 9) * 1.4) * Math.PI * 2);
      heights[y * size + x] = ripple * 0.6 + fbmPeriodic(u * 16, v * 16, 16, 3, 5) * 0.8;
    }
  }
  ctx.putImageData(img, 0, 0);
  const color = finishTexture(new CanvasTexture(canvas), true);
  const normal = heightToNormal(heights, size, size, 2.2);
  return { color, normal };
}

/** Overlapping fish scale arcs as a tileable normal map. */
export function makeScaleNormal(): DataTexture {
  const size = 128;
  const cells = 8;
  const heights = new Float32Array(size * size);
  const cell = size / cells;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hMax = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const cy = Math.floor(y / cell) + oy;
          const shift = ((cy % 2) + 2) % 2 === 0 ? 0 : 0.5;
          const cx = Math.floor(x / cell - shift) + ox;
          const px = (cx + 0.5 + shift) * cell;
          const py = (cy + 0.5) * cell;
          let dx = x - px;
          const dy = y - py;
          dx = ((dx + size / 2) % size + size) % size - size / 2;
          const d = Math.hypot(dx * 0.9, dy) / (cell * 0.75);
          if (d < 1 && dx > -cell * 0.6) {
            const h = (1 - d * d) * (0.6 + 0.4 * (dx / cell + 0.5));
            if (h > hMax) hMax = h;
          }
        }
      }
      heights[y * size + x] = hMax;
    }
  }
  return heightToNormal(heights, size, size, 3);
}

/** Neutral grain used as detail on rocks, wood and props. */
export function makeGrainTexture(): Texture {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbmPeriodic((x / size) * 6, (y / size) * 6, 6, 5, 21);
      const g = 0.72 + n * 0.4;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, g * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(new CanvasTexture(canvas), true);
}

/** F1 and F2 distances to jittered cell points; tiles every `cells` cells. */
function voronoi(x: number, y: number, cells: number, seed: number): { f1: number; f2: number; id: number } {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox;
      const gy = cy + oy;
      const wx = ((gx % cells) + cells) % cells;
      const wy = ((gy % cells) + cells) % cells;
      const px = gx + 0.15 + hash2(wx, wy, seed) * 0.7;
      const py = gy + 0.15 + hash2(wx, wy, seed + 1) * 0.7;
      const d = Math.hypot(x - px, y - py);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash2(wx, wy, seed + 2);
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1, f2, id };
}

/**
 * Cracked, pitted stone. RGB: albedo multiplier around 1. A: low-frequency mask that
 * decides where algae grows. Plus the matching normal map.
 */
export function makeStoneTextures(): { color: Texture; normal: Texture } {
  const size = 256;
  const cells = 5;
  const data = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const vo = voronoi(u * cells, v * cells, cells, 31);
      const crack = 1 - smooth(0.0, 0.07, vo.f2 - vo.f1);
      const n = fbmPeriodic(u * 8, v * 8, 8, 4, 41);
      const fine = fbmPeriodic(u * 32, v * 32, 32, 2, 43);
      const pit = smooth(0.7, 0.85, fbmPeriodic(u * 20, v * 20, 20, 2, 47));
      heights[y * size + x] = n * 0.7 + fine * 0.25 + vo.id * 0.25 - crack * 0.7 - pit * 0.3;
      const g = (0.86 + (n - 0.5) * 0.5 + (vo.id - 0.5) * 0.16 + (fine - 0.5) * 0.12) * (1 - crack * 0.45) * (1 - pit * 0.25);
      const i = (y * size + x) * 4;
      data[i] = Math.min(255, g * 255);
      data[i + 1] = Math.min(255, g * 252);
      data[i + 2] = Math.min(255, g * 246);
      data[i + 3] = fbmPeriodic(u * 3, v * 3, 3, 3, 53) * 255;
    }
  }
  const color = finishTexture(new DataTexture(data, size, size, RGBAFormat, UnsignedByteType), true);
  const normal = heightToNormal(heights, size, size, 2.6);
  return { color, normal };
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Weathered planks for the shipwreck. */
export function makeWoodTexture(): Texture {
  const w = 512;
  const h = 512;
  const [canvas, ctx] = makeCanvas(w, h);
  const rng = new Rng(4242);
  const planks = 8;
  const ph = h / planks;
  for (let i = 0; i < planks; i++) {
    const base = 60 + rng.range(-10, 14);
    ctx.fillStyle = `rgb(${base + 30}, ${base + 12}, ${base - 8})`;
    ctx.fillRect(0, i * ph, w, ph);
    for (let k = 0; k < 40; k++) {
      ctx.strokeStyle = `rgba(30, 18, 8, ${rng.range(0.05, 0.18)})`;
      ctx.lineWidth = rng.range(0.5, 2);
      const y = i * ph + rng.range(2, ph - 2);
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + k) * 1.5);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(12, 8, 4, 0.85)';
    ctx.fillRect(0, i * ph, w, 3);
    const seam = rng.range(0, w);
    ctx.fillRect(seam, i * ph, 3, ph);
    for (let n = 0; n < 3; n++) {
      ctx.fillStyle = 'rgba(20, 12, 6, 0.9)';
      ctx.beginPath();
      ctx.arc(seam + (n % 2 ? -8 : 8), i * ph + ph * (0.3 + n * 0.2), 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (let k = 0; k < 26; k++) {
    const g = ctx.createRadialGradient(rng.range(0, w), rng.range(0, h), 0, rng.range(0, w), rng.range(0, h), rng.range(40, 120));
    const green = rng.chance(0.6);
    g.addColorStop(0, green ? 'rgba(70, 110, 60, 0.45)' : 'rgba(120, 70, 30, 0.4)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  return finishTexture(new CanvasTexture(canvas), true);
}

/** Branching lattice with alpha for sea fans. */
export function makeFanTexture(): Texture {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size, size);
  const rng = new Rng(99);
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  const branch = (x: number, y: number, ang: number, len: number, width: number, depth: number): void => {
    const x2 = x + Math.cos(ang) * len;
    const y2 = y - Math.sin(ang) * len;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (depth <= 0) return;
    const n = depth > 3 ? 2 : rng.int(2, 3);
    for (let i = 0; i < n; i++) {
      branch(x2, y2, ang + rng.range(-0.7, 0.7), len * rng.range(0.62, 0.82), width * 0.72, depth - 1);
    }
  };
  branch(size / 2, size, Math.PI / 2, size * 0.24, 7, 7);
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1;
  for (let i = 0; i < 260; i++) {
    const x = rng.range(size * 0.1, size * 0.9);
    const y = rng.range(size * 0.05, size * 0.85);
    const a = rng.range(0, Math.PI);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12);
    ctx.stroke();
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

export interface SharedTextures {
  sandColor: Texture;
  sandNormal: Texture;
  scaleNormal: DataTexture;
  grain: Texture;
  wood: Texture;
  fan: Texture;
  stone: Texture;
  stoneNormal: Texture;
}

let sharedCache: SharedTextures | null = null;

export function getSharedTextures(): SharedTextures {
  if (sharedCache) return sharedCache;
  const sand = makeSandTextures();
  const stone = makeStoneTextures();
  sharedCache = {
    stone: stone.color,
    stoneNormal: stone.normal,
    sandColor: sand.color,
    sandNormal: sand.normal,
    scaleNormal: makeScaleNormal(),
    grain: makeGrainTexture(),
    wood: makeWoodTexture(),
    fan: makeFanTexture(),
  };
  return sharedCache;
}
