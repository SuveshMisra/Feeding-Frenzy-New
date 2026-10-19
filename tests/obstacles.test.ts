import { describe, expect, it } from 'vitest';
import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three';
import { ObstacleMap, swimHeights } from '../src/env/Obstacles';

function boxes(...at: [x: number, y: number, z: number, h: number][]): InstancedMesh {
  const mesh = new InstancedMesh(new BoxGeometry(2, 1, 2).translate(0, 0.5, 0), new MeshBasicMaterial(), at.length);
  at.forEach(([x, y, z, h], i) => mesh.setMatrixAt(i, new Matrix4().makeTranslation(x, y, z).multiply(new Matrix4().makeScale(1, h, 1))));
  return mesh;
}

describe('obstacle map', () => {
  const ground = (x: number): number => (x > 15 ? 5 : 0);

  it('reads the seabed where nothing stands', () => {
    const map = new ObstacleMap(-20, 20, -10, 10, ground, 20);
    expect(map.floor(0, 0, 1, 1)).toBe(0);
    expect(map.floor(17, 0, 1, 1)).toBe(5);
    expect(map.ceiling(0, 0, 1, 1)).toBe(Infinity);
  });

  it('raises the floor over standing props, only within reach', () => {
    const map = new ObstacleMap(-20, 20, -10, 10, ground, 20);
    map.addInstances(boxes([0, 0, 0, 8]));
    expect(map.floor(0, 0, 1, 1)).toBeCloseTo(8);
    expect(map.floor(1.8, 0, 1, 1)).toBeCloseTo(8);
    expect(map.floor(6, 0, 1, 1)).toBe(0);
    expect(map.floor(0, 6, 1, 1)).toBe(0);
  });

  it('lowers the ceiling under props hanging from the surface', () => {
    const map = new ObstacleMap(-20, 20, -10, 10, ground, 20);
    map.addInstances(boxes([0, 14, 0, 6]));
    expect(map.ceiling(0, 0, 1, 1)).toBeCloseTo(14);
    expect(map.floor(0, 0, 1, 1)).toBe(0);
  });

  it('treats a column from seabed to surface as standing', () => {
    const map = new ObstacleMap(-20, 20, -10, 10, ground, 20);
    map.addInstances(boxes([0, 0, 0, 20]));
    expect(map.floor(0, 0, 1, 1)).toBeCloseTo(20);
    expect(map.ceiling(0, 0, 1, 1)).toBe(Infinity);
  });
});

describe('swim heights', () => {
  const n = 100;
  const flat = (v: number): Float32Array => new Float32Array(n).fill(v);

  it('cruises where the way is clear', () => {
    expect([...swimHeights(10, flat(0), flat(Infinity), 0.3)].every((h) => h === 10)).toBe(true);
  });

  it('climbs over a rock early and no steeper than the slope', () => {
    const floor = flat(0);
    for (let i = 48; i <= 52; i++) floor[i] = 16;
    const h = swimHeights(10, floor, flat(Infinity), 0.5);
    for (let i = 0; i < n; i++) {
      expect(h[i]).toBeGreaterThanOrEqual(floor[i]);
      expect(Math.abs(h[(i + 1) % n] - h[i])).toBeLessThanOrEqual(0.5 + 1e-6);
    }
    expect(h[50]).toBe(16);
    expect(h[0]).toBe(10);
  });

  it('dives under a low ceiling and wraps around the loop', () => {
    const ceiling = flat(Infinity);
    ceiling[0] = 4;
    const h = swimHeights(10, flat(0), ceiling, 1);
    expect(h[0]).toBe(4);
    expect(h[n - 2]).toBe(6);
    expect(h[50]).toBe(10);
  });

  it('goes over when floor and ceiling clash', () => {
    const floor = flat(0);
    const ceiling = flat(Infinity);
    floor[20] = 12;
    ceiling[20] = 8;
    expect(swimHeights(10, floor, ceiling, 1)[20]).toBe(12);
  });
});
