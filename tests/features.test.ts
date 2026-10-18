import { describe, expect, it } from 'vitest';
import { BAND_EDGE, bandFlow, bandWeight, beamHits, heatBand, lightRadius, spanAt, spreadSlots, tideSurface, type CurrentBand } from '../src/game/features/helpers';

describe('Feature helpers', () => {
  const band: CurrentBand = { x0: -10, x1: 10, y0: 5, y1: 9, dir: 1, speed: 3 };

  it('gives full current strength inside a band and none far outside', () => {
    expect(bandWeight(band, 0, 7)).toBeCloseTo(1);
    expect(bandWeight(band, 0, 5 - BAND_EDGE.y - 0.1)).toBe(0);
    expect(bandWeight(band, 10 + BAND_EDGE.x + 1, 7)).toBe(0);
    const edge = bandWeight(band, 10, 7);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
  });

  it('sums band flows in their directions', () => {
    const back: CurrentBand = { ...band, dir: -1, speed: 1 };
    const out = { x: 9, y: 9 };
    bandFlow([band, back], 0, 7, out);
    expect(out.x).toBeCloseTo(2);
    expect(out.y).toBe(0);
    bandFlow([band], 50, 7, out);
    expect(out.x).toBe(0);
  });

  it('runs the tide from high to low and back', () => {
    expect(tideSurface(0, 40, 20, 0.7)).toBeCloseTo(20);
    expect(tideSurface(20, 40, 20, 0.7)).toBeCloseTo(14);
    expect(tideSurface(40, 40, 20, 0.7)).toBeCloseTo(20);
    const mid = tideSurface(10, 40, 20, 0.7);
    expect(mid).toBeGreaterThan(14);
    expect(mid).toBeLessThan(20);
  });

  it('raises a heat band from the floor until it passes the surface', () => {
    expect(heatBand(-1, 6, 0, 20, 4)).toBeNull();
    expect(heatBand(7, 6, 0, 20, 4)).toBeNull();
    const start = heatBand(0, 6, 0, 20, 4)!;
    expect(start.y1).toBeCloseTo(0);
    const mid = heatBand(3, 6, 0, 20, 4)!;
    expect(mid.y1 - mid.y0).toBeCloseTo(4);
    expect(mid.y1).toBeCloseTo(12);
    const end = heatBand(6, 6, 0, 20, 4)!;
    expect(end.y0).toBeCloseTo(20);
  });

  it('hits circles along a beam and misses those beside or behind it', () => {
    expect(beamHits(0, 0, 0, 10, 1, 5, 0, 0.2)).toBe(true);
    expect(beamHits(0, 0, 0, 10, 1, 5, 2, 0.2)).toBe(false);
    expect(beamHits(0, 0, 0, 10, 1, 14, 0, 0.2)).toBe(false);
    expect(beamHits(0, 0, Math.PI / 2, 10, 1, 0, 8, 0.2)).toBe(true);
    // Wider at the far end than near the source.
    expect(beamHits(0, 0, 0, 10, 1, 1, 0.75, 0)).toBe(false);
    expect(beamHits(0, 0, 0, 10, 1, 9.5, 0.75, 0)).toBe(true);
  });

  it('finds spans, maps light to a radius and spreads slots', () => {
    expect(spanAt([{ x0: 0, x1: 4 }, { x0: 10, x1: 12 }], 11)).toBe(1);
    expect(spanAt([{ x0: 0, x1: 4 }], 5)).toBe(-1);
    expect(lightRadius(0, 3, 15)).toBe(3);
    expect(lightRadius(0.5, 3, 15)).toBe(9);
    expect(lightRadius(2, 3, 15)).toBe(15);
    const xs = spreadSlots(5, 100, 10, () => 0.5);
    expect(xs).toHaveLength(5);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    expect(xs[0]).toBeGreaterThanOrEqual(-40);
    const avoided = spreadSlots(5, 100, 10, () => 0.5, { x: xs[0], gap: 6 });
    expect(avoided[0]).toBeCloseTo(xs[0] + 6);
  });
});
