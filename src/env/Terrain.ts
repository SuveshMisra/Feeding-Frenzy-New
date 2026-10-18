import {
  Color,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector2,
} from 'three';
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import type { BiomeDef, LevelDef } from '../config/levels';
import { smoothstep } from '../engine/math';
import { Rng } from '../engine/rng';
import { patchMaterial } from '../engine/materialPatches';
import { getSharedTextures } from '../art/textures';

/** Height field for the seabed. The gameplay floor is the z = 0 slice. */
export class TerrainShape {
  private readonly n1: NoiseFunction2D;
  private readonly n2: NoiseFunction2D;
  private readonly n3: NoiseFunction2D;
  readonly halfW: number;
  private readonly top: number;

  constructor(
    level: LevelDef,
    private readonly biome: BiomeDef,
  ) {
    const r = new Rng(level.seed);
    this.n1 = createNoise2D(() => r.next());
    this.n2 = createNoise2D(() => r.next());
    this.n3 = createNoise2D(() => r.next());
    this.halfW = level.world.width / 2;
    this.top = level.world.height;
  }

  height(x: number, z: number): number {
    const dunes = this.n1(x * 0.045, z * 0.06) * 1.1 + this.n2(x * 0.13, z * 0.13) * 0.35;
    const ripples = this.n3(x * 0.5, z * 0.35) * 0.06;
    let h = dunes + ripples;
    switch (this.biome.terrain) {
      case 'lagoon':
        // Soft mud flats cut by shallow channels.
        h = h * 0.55 - Math.max(0, this.n2(x * 0.03, z * 0.09 + 4)) * 0.8;
        break;
      case 'canyon': {
        // Steep stepped walls rise just behind the play area.
        const wall = smoothstep(-8, -21, z);
        if (wall > 0) {
          const raw = h + wall * (13 + this.n2(x * 0.05, 9.1) * 5 + this.n1(x * 0.15, z * 0.1) * 1.6);
          h = raw + (Math.round(raw / 2.6) * 2.6 - raw) * 0.65 * wall;
        }
        break;
      }
      case 'cavern':
        // Lumpy cave floor and a back wall that climbs to meet the ceiling.
        h += Math.abs(this.n3(x * 0.09, z * 0.09)) * 1.1;
        h += smoothstep(-14, -38, z) * (this.top * 0.75 + this.n2(x * 0.06, 2.2) * 4);
        break;
      case 'rift':
        // A fissure behind the play area and jagged ridges beyond it.
        h -= smoothstep(-5, -11, z) * smoothstep(-24, -15, z) * 2.4;
        h += smoothstep(-22, -46, z) * (5 + Math.abs(this.n2(x * 0.045, 1.3)) * 13 + Math.abs(this.n1(x * 0.16, z * 0.1)) * 2.5);
        break;
    }
    // Low rolling hills in the distance frame the level; walls at both ends.
    const back = smoothstep(-20, -75, z);
    h += back * (2.5 + this.n2(x * 0.03, 3.7) * 3.5 + this.n1(x * 0.08, z * 0.05) * 1.5);
    const edge = smoothstep(this.halfW - 2, this.halfW + 14, Math.abs(x));
    h += edge * (16 + this.n3(z * 0.1, x * 0.02) * 4);
    // Slope away toward the camera so the foreground never blocks the view.
    h -= smoothstep(4, 16, z) * 2.2;
    if (this.biome.props.vents > 0) h -= smoothstep(-6, -30, z) * 1.5;
    return h;
  }

  floorAt(x: number): number {
    return this.height(x, 0);
  }
}

export function buildTerrainMesh(shape: TerrainShape, biome: BiomeDef, detail: number, level: LevelDef): Mesh {
  const halfW = level.world.width / 2 + 70;
  const zMin = -95;
  const zMax = 18;
  const w = halfW * 2;
  const d = zMax - zMin;
  const segX = Math.round((w / 1.1) * detail);
  const segZ = Math.round((d / 1.1) * detail);
  const geo = new PlaneGeometry(w, d, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, (zMin + zMax) / 2);
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const colors = new Float32Array(pos.count * 3);
  const base = new Color(biome.sand.base);
  const light = new Color(biome.sand.light);
  const dark = new Color(biome.sand.dark);
  const c = new Color();
  const rng = new Rng(level.seed + 11);
  const noise = createNoise2D(() => rng.next());
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = shape.height(x, z);
    pos.setY(i, h);
    uv.setXY(i, x / 5, z / 5);
    const n = noise(x * 0.06, z * 0.06) * 0.5 + 0.5;
    const n2 = noise(x * 0.3 + 40, z * 0.3) * 0.5 + 0.5;
    c.copy(base).lerp(light, smoothstep(0.55, 0.9, n) * 0.7).lerp(dark, smoothstep(0.45, 0.1, n2) * 0.45);
    // Distant hills are rockier and darker.
    const rocky = smoothstep(2.5, 9, h);
    c.lerp(dark, rocky * 0.5);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const tex = getSharedTextures();
  const mat = new MeshStandardMaterial({
    map: tex.sandColor,
    normalMap: tex.sandNormal,
    normalScale: new Vector2(0.6, 0.6),
    vertexColors: true,
    roughness: biome.sand.roughness,
    metalness: 0,
  });
  patchMaterial(mat, { caustics: biome.caustics > 0 });
  const mesh = new Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
