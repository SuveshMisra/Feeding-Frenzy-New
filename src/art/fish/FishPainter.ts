import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace, type Texture } from 'three';
import { Rng } from '../../engine/rng';
import { clamp, lerp } from '../../engine/math';
import { makeCanvas } from '../textures';
import { isHero } from '../../config/species';
import type { FinPoly, FishLayout, Swatch } from './FishGenerator';

export interface PaintedFish {
  map: Texture;
  emissive: Texture | null;
  /** Source canvas, reused for UI thumbnails. */
  canvas: HTMLCanvasElement;
}

type Ctx = CanvasRenderingContext2D;

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): number => clamp(Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)), 0, 255);
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

export function paintFish(L: FishLayout): PaintedFish {
  const { width: W, height: Ht, bodyH } = L.tex;
  const { minX, maxX, minY, maxY } = L.bounds;
  const def = L.def;
  const c = def.colors;
  const rng = new Rng(def.id.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0);
  const [canvas, ctx] = makeCanvas(W, Ht);
  const glowNeeded = !!def.material.glow;
  const [gCanvas, g] = glowNeeded ? makeCanvas(W, Ht) : [null, null];

  const px = W / (maxX - minX);
  const X = (x: number): number => (x - minX) * px;
  const Y = (y: number): number => ((maxY - y) / (maxY - minY)) * bodyH;
  const U = (units: number): number => units * px;

  const bodyPath = (k: Ctx): void => {
    k.beginPath();
    const n = 72;
    for (let i = 0; i <= n; i++) {
      const tn = i / n;
      const x = X(L.xAt(tn));
      const y = Y(L.center(tn) + L.upper(tn));
      if (i === 0) k.moveTo(x, y);
      else k.lineTo(x, y);
    }
    for (let i = n; i >= 0; i--) {
      const tn = i / n;
      k.lineTo(X(L.xAt(tn)), Y(L.center(tn) - L.lower(tn)));
    }
    k.closePath();
  };

  // Back-to-belly shading in strips that follow the local profile, so a tapering snout
  // or tail stalk keeps the dark back and pale belly instead of one flat mid tone.
  const top = Y(L.center(0.4) + L.upper(0.4));
  const bottom = Y(L.center(0.4) - L.lower(0.4));
  const countershade = (k: Ctx): void => {
    const n = 96;
    const minH = (bottom - top) * 0.25;
    for (let i = 0; i < n; i++) {
      const tn = (i + 0.5) / n;
      const xa = i === 0 ? W : X(L.xAt(i / n));
      const xb = i === n - 1 ? 0 : X(L.xAt((i + 1) / n));
      const mid = Y(L.center(tn));
      const t = Math.min(Y(L.center(tn) + L.upper(tn)), mid - minH * 0.5);
      const b = Math.max(Y(L.center(tn) - L.lower(tn)), mid + minH * 0.5);
      const grad = k.createLinearGradient(0, t, 0, b);
      grad.addColorStop(0, shade(c.back, -0.12));
      grad.addColorStop(0.28, c.back);
      grad.addColorStop(0.55, c.mid);
      grad.addColorStop(0.8, c.belly);
      grad.addColorStop(1, shade(c.belly, 0.12));
      k.fillStyle = grad;
      k.fillRect(xb - 1, 0, xa - xb + 2, bodyH);
    }
  };
  // Also covers the band outside the outline, so edge filtering picks up matching colours.
  countershade(ctx);

  // Fins
  for (const f of L.fins) paintFin(ctx, f, L, X, Y, U, rng);
  if (L.def.special?.includes('spines')) {
    for (const f of L.fins) if (f.kind === 'dorsal' || f.kind === 'anal') paintStripedRays(ctx, f, X, Y, U, c.finEdge ?? '#fff');
  }

  // Body base gradient
  ctx.save();
  bodyPath(ctx);
  ctx.clip();
  countershade(ctx);

  paintPattern(ctx, g, L, X, Y, U, rng, bodyPath);

  // Scale texture overlay
  if (def.tail.shape !== 'shark' && def.id !== 'anglerfish') paintScales(ctx, L, X, Y, U);

  // Lateral line
  ctx.strokeStyle = rgba('#ffffff', 0.12);
  ctx.lineWidth = Math.max(1, U(0.004));
  ctx.beginPath();
  for (let i = 0; i <= 30; i++) {
    const tn = lerp(def.eye.t + 0.12, 1, i / 30);
    const y = L.center(tn) + L.upper(tn) * 0.32;
    if (i === 0) ctx.moveTo(X(L.xAt(tn)), Y(y));
    else ctx.lineTo(X(L.xAt(tn)), Y(y));
  }
  ctx.stroke();

  // Gill cover / shark gill slits
  const gillT = Math.min(0.45, def.eye.t + (def.tail.shape === 'shark' ? 0.16 : 0.13));
  if (def.special?.includes('sharkGills')) {
    ctx.strokeStyle = rgba('#0b1016', 0.5);
    ctx.lineWidth = Math.max(1, U(0.005));
    for (let i = 0; i < 5; i++) {
      const tn = gillT + i * 0.022;
      const x = X(L.xAt(tn));
      const yc = L.center(tn);
      ctx.beginPath();
      ctx.moveTo(x, Y(yc + L.upper(tn) * 0.35));
      ctx.quadraticCurveTo(x - U(0.008), Y(yc - L.lower(tn) * 0.1), x, Y(yc - L.lower(tn) * 0.5));
      ctx.stroke();
    }
  } else {
    const tn = gillT;
    const x = X(L.xAt(tn));
    const yc = L.center(tn);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.lineWidth = Math.max(1.5, U(0.007));
    ctx.beginPath();
    ctx.moveTo(x + U(0.01), Y(yc + L.upper(tn) * 0.8));
    ctx.quadraticCurveTo(x - U(0.035), Y(yc), x + U(0.012), Y(yc - L.lower(tn) * 0.85));
    ctx.stroke();
    ctx.strokeStyle = rgba('#ffffff', 0.1);
    ctx.lineWidth = Math.max(1, U(0.004));
    ctx.beginPath();
    ctx.moveTo(x + U(0.018), Y(yc + L.upper(tn) * 0.75));
    ctx.quadraticCurveTo(x - U(0.025), Y(yc), x + U(0.02), Y(yc - L.lower(tn) * 0.8));
    ctx.stroke();
  }

  // Mouth line
  ctx.strokeStyle = rgba('#12060a', 0.55);
  ctx.lineWidth = Math.max(1.5, U(0.006));
  ctx.lineCap = 'round';
  ctx.beginPath();
  // Starts just behind the tip: on a slim snout the round cap would paint the whole tip.
  ctx.moveTo(X(lerp(L.jaw.tipX, L.jaw.hingeX, 0.1)), Y(lerp(L.jaw.tipY, L.jaw.hingeY, 0.1)));
  ctx.quadraticCurveTo(
    X(lerp(L.jaw.tipX, L.jaw.hingeX, 0.5)),
    Y(lerp(L.jaw.tipY, L.jaw.hingeY, 0.5) - L.H * 0.02),
    X(L.jaw.hingeX),
    Y(L.jaw.hingeY),
  );
  ctx.stroke();

  // Top sheen
  const sheen = ctx.createLinearGradient(0, top, 0, bottom);
  sheen.addColorStop(0, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.22, 'rgba(255,255,255,0.14)');
  sheen.addColorStop(0.4, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, bodyH);
  ctx.restore();

  paintEye(ctx, L, X, Y, U);
  if (g) {
    // Keep eye region dark on the glow map; alert glow is added in the shader.
    g.fillStyle = '#000';
    g.beginPath();
    g.arc(X(L.eye.x), Y(L.eye.y), U(L.eye.r) * 1.05, 0, Math.PI * 2);
    g.fill();
  }

  // Swatch strip
  const sw = (s: Swatch, k: Ctx, fill: string | CanvasGradient): void => {
    const x0 = s.u0 * W;
    const x1 = s.u1 * W;
    const y0 = Ht - s.v1 * Ht;
    const y1 = Ht - s.v0 * Ht;
    const pad = 3;
    k.fillStyle = fill;
    k.fillRect(x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2);
  };
  ctx.fillStyle = shade(c.fin, -0.2);
  ctx.fillRect(0, bodyH, W, Ht - bodyH);
  {
    const s = L.swatch.fin;
    const x0 = s.u0 * W;
    const x1 = s.u1 * W;
    const y0 = Ht - s.v1 * Ht;
    const y1 = Ht - s.v0 * Ht;
    ctx.clearRect(x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6);
    const fg = ctx.createLinearGradient(x0, 0, x1, 0);
    fg.addColorStop(0, shade(c.fin, -0.1));
    fg.addColorStop(0.7, c.fin);
    fg.addColorStop(1, c.finEdge ?? shade(c.fin, 0.3));
    ctx.globalAlpha = 0.86;
    sw(s, ctx, fg);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 7; i++) {
      const y = lerp(y0, y1, i / 7);
      ctx.beginPath();
      ctx.moveTo(x0, (y0 + y1) / 2 + (y - (y0 + y1) / 2) * 0.3);
      ctx.lineTo(x1, y);
      ctx.stroke();
    }
  }
  sw(L.swatch.white, ctx, '#f4efe6');
  sw(L.swatch.glow, ctx, def.material.glow ?? '#fff6c8');
  sw(L.swatch.dark, ctx, '#15161c');
  if (g) {
    g.fillStyle = '#000';
    g.fillRect(0, bodyH, W, Ht - bodyH);
    sw(L.swatch.glow, g, '#ffffff');
  }

  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  map.minFilter = LinearMipmapLinearFilter;
  let emissive: Texture | null = null;
  if (gCanvas) {
    emissive = new CanvasTexture(gCanvas);
    emissive.colorSpace = SRGBColorSpace;
    emissive.minFilter = LinearMipmapLinearFilter;
  }
  return { map, emissive, canvas };
}

function finPath(k: Ctx, f: FinPoly, X: (x: number) => number, Y: (y: number) => number): void {
  k.beginPath();
  f.outline.forEach((p, i) => (i === 0 ? k.moveTo(X(p.x), Y(p.y)) : k.lineTo(X(p.x), Y(p.y))));
  k.closePath();
}

function paintFin(
  k: Ctx,
  f: FinPoly,
  L: FishLayout,
  X: (x: number) => number,
  Y: (y: number) => number,
  U: (u: number) => number,
  rng: Rng,
): void {
  const c = L.def.colors;
  let base = c.fin;
  let edge = c.finEdge ?? shade(c.fin, 0.35);
  if (L.def.pattern === 'tang' && f.kind === 'caudal') {
    base = c.accent2 ?? base;
    edge = shade(base, -0.2);
  }
  if (L.def.pattern === 'sheephead' && f.kind === 'caudal') base = c.back;
  k.save();
  finPath(k, f, X, Y);
  k.clip();
  const gr = k.createLinearGradient(X(f.root.x), Y(f.root.y), X(f.tip.x), Y(f.tip.y));
  gr.addColorStop(0, shade(base, -0.1));
  gr.addColorStop(0.7, base);
  gr.addColorStop(1, edge);
  k.fillStyle = gr;
  k.fillRect(0, 0, k.canvas.width, k.canvas.height);
  if (f.kind === 'caudal' || L.def.pattern === 'tang') {
    const e = k.createRadialGradient(X(f.root.x), Y(f.root.y), 0, X(f.root.x), Y(f.root.y), U(L.def.tail.size * 1.2));
    e.addColorStop(0, 'rgba(0,0,0,0)');
    e.addColorStop(0.8, 'rgba(0,0,0,0)');
    e.addColorStop(1, rgba(edge.startsWith('#') ? edge : '#ffffff', 0.35));
    k.fillStyle = e;
    k.fillRect(0, 0, k.canvas.width, k.canvas.height);
  }
  if (c.finEdge && f.kind !== 'caudal') {
    // Edge band along the outer boundary.
    k.strokeStyle = rgba(c.finEdge, 0.9);
    k.lineWidth = Math.max(2, U(0.012));
    k.beginPath();
    const outer = f.rays.map((r) => r[1]);
    outer.forEach((p, i) => (i === 0 ? k.moveTo(X(p.x), Y(p.y)) : k.lineTo(X(p.x), Y(p.y))));
    k.stroke();
  }
  // Rays
  k.strokeStyle = 'rgba(0,0,0,0.16)';
  k.lineWidth = Math.max(1, U(0.0035));
  for (const [a, b] of f.rays) {
    k.beginPath();
    k.moveTo(X(a.x), Y(a.y));
    k.lineTo(X(b.x), Y(b.y));
    k.stroke();
  }
  k.strokeStyle = 'rgba(255,255,255,0.1)';
  for (const [a, b] of f.rays) {
    const o = U(0.004);
    k.beginPath();
    k.moveTo(X(a.x) + o, Y(a.y));
    k.lineTo(X(b.x) + o, Y(b.y));
    k.stroke();
  }
  // Frayed alpha edge
  k.globalCompositeOperation = 'destination-out';
  k.lineWidth = Math.max(2, U(0.008));
  k.strokeStyle = 'rgba(0,0,0,0.35)';
  finPath(k, f, X, Y);
  k.stroke();
  for (let i = 0; i < 18; i++) {
    const r = f.rays[rng.int(0, f.rays.length - 1)];
    if (!r) break;
    const t = rng.range(0.82, 1);
    k.fillStyle = 'rgba(0,0,0,0.25)';
    k.beginPath();
    k.arc(X(lerp(r[0].x, r[1].x, t)), Y(lerp(r[0].y, r[1].y, t)), U(rng.range(0.004, 0.01)), 0, Math.PI * 2);
    k.fill();
  }
  k.restore();
  k.globalCompositeOperation = 'source-over';
}

function paintStripedRays(
  k: Ctx,
  f: FinPoly,
  X: (x: number) => number,
  Y: (y: number) => number,
  U: (u: number) => number,
  light: string,
): void {
  k.save();
  finPath(k, f, X, Y);
  k.clip();
  k.lineCap = 'round';
  for (const [a, b] of f.rays) {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 0.5) / n;
      k.strokeStyle = rgba(light, 0.75);
      k.lineWidth = Math.max(1.5, U(0.008));
      k.beginPath();
      k.moveTo(X(lerp(a.x, b.x, t0)), Y(lerp(a.y, b.y, t0)));
      k.lineTo(X(lerp(a.x, b.x, t1)), Y(lerp(a.y, b.y, t1)));
      k.stroke();
    }
  }
  k.restore();
}

function paintScales(k: Ctx, L: FishLayout, X: (x: number) => number, Y: (y: number) => number, U: (u: number) => number): void {
  const size = U(L.H * 0.07);
  if (size < 3) return;
  k.save();
  k.globalAlpha = 0.09;
  k.strokeStyle = '#000';
  k.lineWidth = Math.max(0.8, size * 0.08);
  const x0 = X(L.xAt(L.def.eye.t + 0.1));
  const x1 = X(L.bodyEndX);
  const y0 = Y(L.bounds.maxY);
  const y1 = Y(L.bounds.minY);
  let row = 0;
  for (let y = y0; y < y1; y += size * 0.55, row++) {
    const off = row % 2 ? size * 0.5 : 0;
    for (let x = x0 - off; x > x1 - size; x -= size) {
      k.beginPath();
      k.arc(x, y, size * 0.55, Math.PI * 0.5, Math.PI * 1.5, false);
      k.stroke();
    }
  }
  k.globalAlpha = 0.05;
  k.strokeStyle = '#fff';
  row = 0;
  for (let y = y0; y < y1; y += size * 0.55, row++) {
    const off = row % 2 ? size * 0.5 : 0;
    for (let x = x0 - off; x > x1 - size; x -= size) {
      k.beginPath();
      k.arc(x + size * 0.06, y, size * 0.5, Math.PI * 0.6, Math.PI * 1.1, false);
      k.stroke();
    }
  }
  k.restore();
}

function paintEye(k: Ctx, L: FishLayout, X: (x: number) => number, Y: (y: number) => number, U: (u: number) => number): void {
  const ex = X(L.eye.x);
  const ey = Y(L.eye.y);
  const r = U(L.eye.r);
  const hero = isHero(L.def);
  // Socket shadow
  const sock = k.createRadialGradient(ex, ey, r * 0.8, ex, ey, r * 1.45);
  sock.addColorStop(0, 'rgba(0,0,0,0.35)');
  sock.addColorStop(1, 'rgba(0,0,0,0)');
  k.fillStyle = sock;
  k.beginPath();
  k.arc(ex, ey, r * 1.45, 0, Math.PI * 2);
  k.fill();
  if (hero) {
    k.fillStyle = '#fbfbf6';
    k.beginPath();
    k.arc(ex, ey, r, 0, Math.PI * 2);
    k.fill();
  }
  const irisR = hero ? r * 0.72 : r;
  const ix = hero ? ex + r * 0.12 : ex;
  const iris = k.createRadialGradient(ix, ey, irisR * 0.3, ix, ey, irisR);
  iris.addColorStop(0, shade(L.def.eye.iris, 0.35));
  iris.addColorStop(0.7, L.def.eye.iris);
  iris.addColorStop(1, shade(L.def.eye.iris, -0.55));
  k.fillStyle = iris;
  k.beginPath();
  k.arc(ix, ey, irisR, 0, Math.PI * 2);
  k.fill();
  k.fillStyle = '#050507';
  k.beginPath();
  k.arc(ix + irisR * 0.05, ey, irisR * (hero ? 0.62 : 0.56), 0, Math.PI * 2);
  k.fill();
  k.fillStyle = 'rgba(255,255,255,0.92)';
  k.beginPath();
  k.arc(ix - irisR * 0.28, ey - irisR * 0.3, irisR * 0.2, 0, Math.PI * 2);
  k.fill();
  k.fillStyle = 'rgba(255,255,255,0.55)';
  k.beginPath();
  k.arc(ix + irisR * 0.25, ey + irisR * 0.28, irisR * 0.09, 0, Math.PI * 2);
  k.fill();
  k.strokeStyle = 'rgba(0,0,0,0.5)';
  k.lineWidth = Math.max(1, r * 0.08);
  k.beginPath();
  k.arc(ex, ey, r, 0, Math.PI * 2);
  k.stroke();
}

function paintPattern(
  k: Ctx,
  g: Ctx | null,
  L: FishLayout,
  X: (x: number) => number,
  Y: (y: number) => number,
  U: (u: number) => number,
  rng: Rng,
  bodyPath: (k: Ctx) => void,
): void {
  const def = L.def;
  const c = def.colors;
  const pointInBody = (x: number, y: number): boolean => {
    const tn = L.tnAt(x);
    return y < L.center(tn) + L.upper(tn) * 0.95 && y > L.center(tn) - L.lower(tn) * 0.95;
  };
  const randPoint = (tn0: number, tn1: number, yMin = -1, yMax = 1): [number, number] => {
    for (let i = 0; i < 30; i++) {
      const tn = rng.range(tn0, tn1);
      const rel = rng.range(yMin, yMax);
      const y = L.center(tn) + (rel > 0 ? L.upper(tn) : L.lower(tn)) * rel;
      const x = L.xAt(tn);
      if (pointInBody(x, y)) return [x, y];
    }
    return [L.xAt(0.5), L.center(0.5)];
  };
  const bandAt = (tn: number, width: number, bulge: number, color: string, outline?: string, outlineW = 0): void => {
    const x = L.xAt(tn);
    const yt = L.center(tn) + L.upper(tn) * 1.3;
    const yb = L.center(tn) - L.lower(tn) * 1.3;
    const draw = (w: number, col: string): void => {
      k.strokeStyle = col;
      k.lineWidth = U(w);
      k.lineCap = 'butt';
      k.beginPath();
      k.moveTo(X(x - bulge * 0.3), Y(yt));
      k.quadraticCurveTo(X(x + bulge), Y((yt + yb) / 2), X(x - bulge * 0.3), Y(yb));
      k.stroke();
    };
    if (outline) draw(width + outlineW * 2, outline);
    draw(width, color);
  };

  switch (def.pattern) {
    case 'hero': {
      bandAt(def.eye.t + 0.12, 0.05, 0.03, c.accent, c.accent2, 0.011);
      bandAt(0.58, 0.058, -0.022, c.accent, c.accent2, 0.011);
      bandAt(0.93, 0.026, 0.0, c.accent, c.accent2, 0.01);
      // Warm glow toward the belly
      const gy = k.createRadialGradient(X(L.xAt(0.3)), Y(L.center(0.3) - L.lower(0.3) * 0.4), 0, X(L.xAt(0.3)), Y(L.center(0.3)), U(0.25));
      gy.addColorStop(0, 'rgba(255,230,160,0.35)');
      gy.addColorStop(1, 'rgba(255,230,160,0)');
      k.fillStyle = gy;
      k.fillRect(0, 0, k.canvas.width, k.canvas.height);
      break;
    }
    case 'gulp': {
      // Pale belly patch, gold freckles along the back and a cheek blush.
      const belly = (k2: Ctx, color: string): void => {
        k2.fillStyle = color;
        k2.beginPath();
        for (let i = 0; i <= 30; i++) {
          const tn = lerp(0.06, 0.8, i / 30);
          const y = L.center(tn) - L.lower(tn) * 0.15;
          if (i === 0) k2.moveTo(X(L.xAt(tn)), Y(y));
          else k2.lineTo(X(L.xAt(tn)), Y(y));
        }
        for (let i = 30; i >= 0; i--) {
          const tn = lerp(0.06, 0.8, i / 30);
          k2.lineTo(X(L.xAt(tn)), Y(L.center(tn) - L.lower(tn) * 1.2));
        }
        k2.closePath();
        k2.fill();
      };
      belly(k, rgba(c.belly, 0.85));
      for (let i = 0; i < 26; i++) {
        const [x, y] = randPoint(0.18, 0.86, 0.25, 0.9);
        k.fillStyle = rgba(c.accent, rng.range(0.7, 0.95));
        k.beginPath();
        k.arc(X(x), Y(y), U(L.H * rng.range(0.035, 0.06)), 0, Math.PI * 2);
        k.fill();
      }
      bandAt(0.88, 0.03, 0, c.accent2 ?? c.accent);
      const cx = X(L.xAt(def.eye.t + 0.05));
      const cy = Y(L.center(def.eye.t + 0.05) - L.lower(def.eye.t + 0.05) * 0.35);
      const blush = k.createRadialGradient(cx, cy, 0, cx, cy, U(L.H * 0.16));
      blush.addColorStop(0, 'rgba(255,120,170,0.55)');
      blush.addColorStop(1, 'rgba(255,120,170,0)');
      k.fillStyle = blush;
      k.fillRect(0, 0, k.canvas.width, k.canvas.height);
      if (g) {
        g.save();
        bodyPath(g);
        g.clip();
        belly(g, 'rgba(255,240,200,0.25)');
        g.restore();
      }
      break;
    }
    case 'lateral': {
      const stripe = (alpha: number, w: number, color: string): void => {
        k.strokeStyle = rgba(color, alpha);
        k.lineWidth = U(w);
        k.lineCap = 'round';
        k.beginPath();
        for (let i = 0; i <= 30; i++) {
          const tn = lerp(0.12, 0.98, i / 30);
          const y = L.center(tn) + L.upper(tn) * 0.05;
          if (i === 0) k.moveTo(X(L.xAt(tn)), Y(y));
          else k.lineTo(X(L.xAt(tn)), Y(y));
        }
        k.stroke();
      };
      stripe(0.35, L.H * 0.22, '#ffffff');
      stripe(0.5, L.H * 0.08, def.id === 'silverside' ? '#e9f7ff' : '#dff1ff');
      if (def.id === 'sardine') {
        for (let i = 0; i < 7; i++) {
          const tn = 0.25 + i * 0.07;
          k.fillStyle = rgba(c.accent, 0.8);
          k.beginPath();
          k.arc(X(L.xAt(tn)), Y(L.center(tn) + L.upper(tn) * 0.35), U(L.H * 0.05), 0, Math.PI * 2);
          k.fill();
        }
      }
      break;
    }
    case 'neon': {
      const band = (y0: number, y1: number, color: string, k2: Ctx): void => {
        k2.fillStyle = color;
        k2.beginPath();
        for (let i = 0; i <= 30; i++) {
          const tn = lerp(0.08, 1, i / 30);
          const y = L.center(tn) + L.upper(tn) * y0;
          if (i === 0) k2.moveTo(X(L.xAt(tn)), Y(y));
          else k2.lineTo(X(L.xAt(tn)), Y(y));
        }
        for (let i = 30; i >= 0; i--) {
          const tn = lerp(0.08, 1, i / 30);
          k2.lineTo(X(L.xAt(tn)), Y(L.center(tn) + L.upper(tn) * y1));
        }
        k2.closePath();
        k2.fill();
      };
      band(-0.05, -2, c.belly, k);
      band(0.35, -0.05, c.accent, k);
      if (g) {
        g.save();
        bodyPath(g);
        g.clip();
        band(0.35, -0.05, '#ffffff', g);
        g.restore();
      }
      break;
    }
    case 'spots': {
      const n = def.patternCount ?? 70;
      for (let i = 0; i < n; i++) {
        const [x, y] = randPoint(0.05, 0.98, -0.6, 0.95);
        const r = L.H * rng.range(0.02, 0.045);
        k.fillStyle = rgba(c.accent, rng.range(0.55, 0.9));
        k.beginPath();
        k.arc(X(x), Y(y), U(r), 0, Math.PI * 2);
        k.fill();
      }
      break;
    }
    case 'mottled': {
      const n = def.patternCount ?? 40;
      for (let i = 0; i < n; i++) {
        const [x, y] = randPoint(0.02, 1, -0.9, 1);
        const r = U(L.H * rng.range(0.08, 0.2));
        const dark = rng.chance(0.65);
        const col = dark ? c.accent : c.accent2 ?? c.belly;
        const gr = k.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), r);
        gr.addColorStop(0, rgba(col.startsWith('#') ? col : '#000000', dark ? 0.5 : 0.35));
        gr.addColorStop(1, rgba(col.startsWith('#') ? col : '#000000', 0));
        k.fillStyle = gr;
        k.beginPath();
        k.ellipse(X(x), Y(y), r * rng.range(1, 1.8), r, rng.range(0, Math.PI), 0, Math.PI * 2);
        k.fill();
      }
      if ((def.id === 'anglerfish' || def.id === 'anglerKing') && g) {
        // Faint glowing freckles.
        for (let i = 0; i < (def.id === 'anglerKing' ? 34 : 16); i++) {
          const [x, y] = randPoint(0.1, 0.9, -0.8, 0.6);
          g.fillStyle = 'rgba(255,255,255,0.35)';
          g.beginPath();
          g.arc(X(x), Y(y), U(L.H * 0.012), 0, Math.PI * 2);
          g.fill();
        }
      }
      break;
    }
    case 'bars': {
      const n = def.patternCount ?? 12;
      for (let i = 0; i < n; i++) {
        const tn = lerp(0.22, 0.92, i / (n - 1));
        const x = L.xAt(tn);
        const yt = L.center(tn) + L.upper(tn) * 1.1;
        const yb = L.center(tn) + L.upper(tn) * -0.05;
        k.strokeStyle = rgba(c.accent, 0.55);
        k.lineWidth = U(L.H * 0.13);
        k.lineCap = 'round';
        k.beginPath();
        k.moveTo(X(x + 0.008), Y(yt));
        k.lineTo(X(x - 0.004), Y(yb));
        k.stroke();
      }
      for (let i = 0; i < 12; i++) {
        const [x, y] = randPoint(0.6, 1, -0.7, 0.2);
        k.fillStyle = rgba('#10161b', 0.7);
        k.beginPath();
        k.arc(X(x), Y(y), U(L.H * 0.035), 0, Math.PI * 2);
        k.fill();
      }
      break;
    }
    case 'eyeBand': {
      // Diagonal chevrons
      k.strokeStyle = 'rgba(184, 138, 0, 0.3)';
      k.lineWidth = U(0.006);
      for (let i = -8; i < 16; i++) {
        const x0 = L.xAt(0.25) - i * 0.045;
        k.beginPath();
        k.moveTo(X(x0), Y(L.bounds.maxY));
        k.lineTo(X(x0 - 0.18), Y(L.center(0.5)));
        k.lineTo(X(x0), Y(L.bounds.minY));
        k.stroke();
      }
      // Eye band
      const ex = L.eye.x;
      k.strokeStyle = '#ffffff';
      k.lineWidth = U(L.eye.r * 3.2);
      k.beginPath();
      k.moveTo(X(ex + 0.01), Y(L.bounds.maxY));
      k.lineTo(X(ex - 0.01), Y(L.bounds.minY));
      k.stroke();
      k.strokeStyle = c.accent;
      k.lineWidth = U(L.eye.r * 2.5);
      k.stroke();
      // Ocellus
      const tn = 0.78;
      const ox = X(L.xAt(tn));
      const oy = Y(L.center(tn) + L.upper(tn) * 0.45);
      const or = U(L.H * 0.09);
      k.fillStyle = '#ffffff';
      k.beginPath();
      k.arc(ox, oy, or * 1.3, 0, Math.PI * 2);
      k.fill();
      k.fillStyle = '#111';
      k.beginPath();
      k.arc(ox, oy, or, 0, Math.PI * 2);
      k.fill();
      break;
    }
    case 'tang': {
      k.fillStyle = c.accent;
      k.beginPath();
      const n = 24;
      for (let i = 0; i <= n; i++) {
        const tn = lerp(0.22, 0.98, i / n);
        const y = L.center(tn) + L.upper(tn) * lerp(0.95, 0.4, i / n);
        if (i === 0) k.moveTo(X(L.xAt(tn)), Y(y));
        else k.lineTo(X(L.xAt(tn)), Y(y));
      }
      for (let i = n; i >= 0; i--) {
        const tn = lerp(0.22, 0.98, i / n);
        const u = i / n;
        const y = L.center(tn) + L.upper(tn) * lerp(0.35, -0.15, u) - Math.sin(u * Math.PI) * L.H * 0.12;
        k.lineTo(X(L.xAt(tn)), Y(y));
      }
      k.closePath();
      k.fill();
      // Blue palette window inside the black mark
      k.fillStyle = c.mid;
      k.beginPath();
      k.ellipse(X(L.xAt(0.52)), Y(L.center(0.52) + L.upper(0.52) * 0.5), U(0.1), U(L.H * 0.09), -0.08, 0, Math.PI * 2);
      k.fill();
      // Yellow tail base
      k.fillStyle = c.accent2 ?? '#ffd23f';
      k.beginPath();
      k.moveTo(X(L.xAt(0.9)), Y(L.center(0.9) + L.upper(0.9) * 1.2));
      k.lineTo(X(L.bodyEndX - 0.05), Y(L.center(1) + L.upper(1) * 2));
      k.lineTo(X(L.bodyEndX - 0.05), Y(L.center(1) - L.lower(1) * 2));
      k.lineTo(X(L.xAt(0.9)), Y(L.center(0.9) - L.lower(0.9) * 1.2));
      k.closePath();
      k.fill();
      break;
    }
    case 'parrot': {
      const size = U(L.H * 0.12);
      k.lineWidth = Math.max(1, size * 0.14);
      for (let y = 0; y < k.canvas.height; y += size * 0.8) {
        for (let x = X(L.xAt(0.2)); x > X(L.bodyEndX) - size; x -= size) {
          k.strokeStyle = rgba(c.accent, 0.5);
          k.beginPath();
          k.arc(x, y, size * 0.55, Math.PI * 0.5, Math.PI * 1.5);
          k.stroke();
        }
      }
      k.strokeStyle = rgba(c.accent, 0.9);
      k.lineWidth = U(L.H * 0.04);
      for (let i = 0; i < 3; i++) {
        k.beginPath();
        const yy = L.eye.y + (i - 1) * L.eye.r * 2.2;
        k.moveTo(X(L.noseX), Y(yy - 0.02));
        k.quadraticCurveTo(X(L.eye.x), Y(yy + 0.015), X(L.eye.x - 0.08), Y(yy - 0.01));
        k.stroke();
      }
      k.strokeStyle = rgba(c.accent2 ?? '#ffd23f', 0.8);
      k.lineWidth = U(L.H * 0.05);
      k.beginPath();
      k.moveTo(X(L.xAt(0.18)), Y(L.center(0.18) - L.lower(0.18) * 0.9));
      k.quadraticCurveTo(X(L.xAt(0.25)), Y(L.center(0.25)), X(L.xAt(0.2)), Y(L.center(0.2) + L.upper(0.2) * 0.8));
      k.stroke();
      break;
    }
    case 'sheephead': {
      const head = k.createLinearGradient(X(L.xAt(0.22)), 0, X(L.xAt(0.34)), 0);
      head.addColorStop(0, c.back);
      head.addColorStop(1, rgba(c.back, 0));
      k.fillStyle = head;
      k.fillRect(X(L.xAt(0.34)), 0, X(L.noseX) - X(L.xAt(0.34)) + 2, k.canvas.height);
      const tail = k.createLinearGradient(X(L.xAt(0.66)), 0, X(L.xAt(0.56)), 0);
      tail.addColorStop(0, c.back);
      tail.addColorStop(1, rgba(c.back, 0));
      k.fillStyle = tail;
      k.fillRect(0, 0, X(L.xAt(0.56)), k.canvas.height);
      k.fillStyle = c.belly;
      k.beginPath();
      k.ellipse(X(L.xAt(0.05)), Y(L.center(0.05) - L.lower(0.05) * 0.5), U(0.07), U(L.H * 0.14), 0.3, 0, Math.PI * 2);
      k.fill();
      break;
    }
    case 'tigerBands': {
      const n = def.patternCount ?? 10;
      for (let i = 0; i < n; i++) {
        const tn = lerp(0.1, 0.98, i / (n - 1));
        const x = L.xAt(tn);
        const w = L.H * (i % 2 ? 0.07 : 0.16);
        k.strokeStyle = i % 2 ? rgba(c.accent2 ?? '#fff', 0.9) : rgba(c.accent, 0.92);
        k.lineWidth = U(w);
        k.beginPath();
        const yt = L.bounds.maxY;
        const yb = L.bounds.minY;
        for (let s = 0; s <= 12; s++) {
          const yy = lerp(yt, yb, s / 12);
          const xx = x + Math.sin(s * 1.3 + i) * L.H * 0.04;
          if (s === 0) k.moveTo(X(xx), Y(yy));
          else k.lineTo(X(xx), Y(yy));
        }
        k.stroke();
      }
      break;
    }
    case 'photophores': {
      const rows = [
        { rel: -0.55, n: 12, r: 0.03 },
        { rel: -0.82, n: 10, r: 0.025 },
        { rel: 0.05, n: 8, r: 0.02 },
      ];
      for (const row of rows) {
        for (let i = 0; i < row.n; i++) {
          const tn = lerp(0.18, 0.95, i / (row.n - 1));
          const x = L.xAt(tn);
          const y = L.center(tn) + (row.rel > 0 ? L.upper(tn) : L.lower(tn)) * row.rel;
          const r = U(L.H * row.r);
          k.fillStyle = '#0a0d12';
          k.beginPath();
          k.arc(X(x), Y(y), r * 1.5, 0, Math.PI * 2);
          k.fill();
          k.fillStyle = c.accent;
          k.beginPath();
          k.arc(X(x), Y(y), r, 0, Math.PI * 2);
          k.fill();
          if (g) {
            const gr = g.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), r * 1.6);
            gr.addColorStop(0, 'rgba(255,255,255,1)');
            gr.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = gr;
            g.beginPath();
            g.arc(X(x), Y(y), r * 1.6, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
      break;
    }
    case 'none':
    default:
      break;
  }
}
