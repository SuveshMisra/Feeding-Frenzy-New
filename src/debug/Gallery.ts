import {
  Color,
  DirectionalLight,
  Euler,
  HemisphereLight,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { FishFactory, type FishPool } from '../art/fish/FishFactory';
import { CausticsGenerator } from '../art/caustics';
import { SPECIES, type SpeciesId } from '../config/species';
import { Loop } from '../engine/Loop';
import { shared } from '../engine/materialPatches';
import type { Renderer } from '../engine/Renderer';

/** `?gallery`: every species lined up for checking the procedural fish art. */
export function startGallery(renderer: Renderer): void {
  const scene = new Scene();
  scene.background = new Color('#0f6f94');
  const camera = new PerspectiveCamera(40, 1, 0.1, 200);
  camera.position.set(0, 0, 26);
  const fitWidth = new URLSearchParams(location.search).get('gallery') ? 14 : 48;
  renderer.onResize((w, h) => {
    camera.aspect = w / h;
    const halfTan = Math.tan((camera.fov * Math.PI) / 360);
    camera.position.z = Math.max(fitWidth / 2 / (halfTan * camera.aspect), 26);
    camera.updateProjectionMatrix();
  });
  const sun = new DirectionalLight('#fff4dc', 2.6);
  sun.position.set(4, 20, 10);
  scene.add(sun, new HemisphereLight('#8fe8ff', '#2a6f7a', 1.1));
  const caustics = new CausticsGenerator(512);
  shared.uCausticsTex.value = caustics.texture;
  shared.uSurfaceY.value = 20;
  shared.uFogStart.value = 40;
  shared.uFogDensity.value = 0.01;

  const factory = new FishFactory({ physical: true, detail: true });
  const ids = Object.keys(SPECIES) as SpeciesId[];
  const pools = ids.map((id) => {
    const p = factory.pool(id, 1);
    p.addTo(scene);
    return p;
  });
  const cols = 5;
  const m = new Matrix4();
  const q = new Quaternion();
  const e = new Euler(0, 0, 0, 'YZX');
  const pos = new Vector3();
  const scl = new Vector3();
  const params = new URLSearchParams(location.search);
  const only = params.get('gallery');
  let t = 0;
  const draw = (pool: FishPool, i: number, n: number): void => {
    const def = pool.asset.def;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const spacingX = only ? 0 : 9;
    const spacingY = only ? 0 : 5;
    pos.set((col - (cols - 1) / 2) * spacingX, ((Math.ceil(n / cols) - 1) / 2 - row) * spacingY, 0);
    const len = only ? 10 : Math.min(def.length, 7) * (def.length < 1 ? 3 : 1.3);
    scl.setScalar(len);
    const turn = params.has('turn') ? Math.sin(t * 0.6) * 0.5 + 0.5 : 0;
    const tilt = 0.35;
    e.set(0.0, -tilt + turn * (-Math.PI + 2 * tilt), 0);
    q.setFromEuler(e);
    m.compose(pos, q, scl);
    pool.begin();
    pool.push(m, t * def.swim.freq * Math.PI * 2, 1, (Math.sin(t * 2) * 0.5 + 0.5) * (params.has('jaw') ? 1 : 0), 0, 0);
    pool.end();
  };
  const loop = new Loop(
    (dt) => {
      t += dt;
    },
    () => {
      shared.uTime.value = t;
      caustics.update(renderer.gl, t);
      const shown = only ? pools.filter((p) => p.asset.id === only) : pools;
      pools.forEach((p) => {
        p.body.visible = shown.includes(p);
        p.fins.visible = shown.includes(p);
      });
      shown.forEach((p, i) => draw(p, i, shown.length));
      renderer.gl.render(scene, camera);
    },
  );
  loop.start();
}
