import type { FishAsset } from '../art/fish/FishFactory';

/**
 * Side-view portrait of a species: the painted texture's body region clipped to the
 * silhouette. Body and fins are clipped separately so opposite winding can't punch holes.
 */
export function fishThumbnail(asset: FishAsset, width = 176, height = 96): string {
  const L = asset.layout;
  const { minX, maxX, minY, maxY } = L.bounds;
  const bw = maxX - minX;
  const bh = maxY - minY;
  const pad = 6;
  const s = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh);
  const ox = (width - bw * s) / 2;
  const oy = (height - bh * s) / 2;
  const X = (x: number): number => ox + (x - minX) * s;
  const Y = (y: number): number => oy + (maxY - y) * s;

  const body = new Path2D();
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const tn = i / N;
    const x = X(L.xAt(tn));
    const y = Y(L.center(tn) + L.upper(tn));
    if (i === 0) body.moveTo(x, y);
    else body.lineTo(x, y);
  }
  for (let i = N; i >= 0; i--) {
    const tn = i / N;
    body.lineTo(X(L.xAt(tn)), Y(L.center(tn) - L.lower(tn)));
  }
  body.closePath();
  const parts = [body];
  for (const f of L.fins) {
    const p = new Path2D();
    f.outline.forEach((pt, i) => (i === 0 ? p.moveTo(X(pt.x), Y(pt.y)) : p.lineTo(X(pt.x), Y(pt.y))));
    p.closePath();
    parts.push(p);
  }

  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d')!;
  const src = asset.canvas;
  for (const p of parts.slice(1)) {
    g.save();
    g.clip(p);
    g.drawImage(src, 0, 0, L.tex.width, L.tex.bodyH, ox, oy, bw * s, bh * s);
    g.restore();
  }
  g.save();
  g.clip(body);
  g.drawImage(src, 0, 0, L.tex.width, L.tex.bodyH, ox, oy, bw * s, bh * s);
  g.restore();
  g.lineWidth = 1.2;
  g.strokeStyle = 'rgba(4, 18, 30, 0.35)';
  g.stroke(body);
  return c.toDataURL('image/png');
}
