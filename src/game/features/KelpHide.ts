import { Color, DoubleSide, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Euler, Vector3 } from 'three';
import { patchMaterial, shared } from '../../engine/materialPatches';
import { damp } from '../../engine/math';
import { kelpGeometry } from '../../env/props/shapes';
import { FeatureBase } from './FeatureBase';
import { spanAt, spreadSlots } from './helpers';
import type { FeatureHud } from './types';

export const KELP = {
  clumps: 6,
  halfWidth: 3,
  strands: 9,
  /** Cover reaches this share of the water height. */
  height: 0.62,
  detectMul: 0.3,
  shade: -0.55,
  /** Storm surge: the kelp sways sideways on a cycle and cover narrows at each peak. */
  surge: false,
  surgePeriod: 9,
  surgeAmp: 2.2,
  /** Cover half-width at the peak of a surge, as a share of `halfWidth`. */
  narrow: 0.6,
  /** Hunters search this much longer before giving up on a hidden player. */
  searchMul: 1,
};

/** Sideways sway (-1..1) of storm kelp at time `t`. */
export function surgePhase(t: number, period: number): number {
  return Math.sin((t / period) * Math.PI * 2);
}

/** Cover half-width at a given surge phase. */
export function surgeHalfWidth(halfWidth: number, phase: number, narrow: number): number {
  return halfWidth * (1 - (1 - narrow) * Math.abs(phase));
}

const BASE_CURRENT = shared.uCurrent.value.x;

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const p3 = new Vector3();
const s3 = new Vector3();

/** Kelp Forest: dense clumps at the play plane hide the player from hunters. */
export class KelpHideFeature extends FeatureBase {
  private readonly cfg = this.opts(KELP);
  private spans: { x0: number; x1: number; top: number; cx: number }[] = [];
  private surge = 0;
  private hidden = false;
  private shade = 0;

  build(): void {
    const w = this.world;
    const lvl = w.level;
    const H = lvl.world.height;
    const pal = w.env.biome.palette;
    const base = new Color(pal.plant);
    const colors = { stem: base.clone().multiplyScalar(0.65), base, tip: new Color(pal.plantTip) };
    const geos = [0.5, 0.62, 0.72].map((k, i) => this.track(kelpGeometry(lvl.seed + 300 + i, H * k, colors)));
    const mat = this.track(
      patchMaterial(new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, roughness: 0.7 }), {
        translucency: 0.55,
        sway: { freq: 0.5, amount: 0.9, height: H * 0.6 },
        fade: true,
      }),
    );
    const xs = spreadSlots(this.cfg.clumps, lvl.world.width, 14, () => this.rng.next(), { x: this.startX, gap: 9 });
    const items: { x: number; y: number; z: number; s: number; ry: number; g: number; c: number }[] = [];
    for (const x of xs) {
      const floor = w.env.floorAt(x);
      this.spans.push({ x0: x - this.cfg.halfWidth, x1: x + this.cfg.halfWidth, top: floor + H * this.cfg.height, cx: x });
      for (let k = 0; k < this.cfg.strands; k++) {
        const sx = x + (k / (this.cfg.strands - 1) - 0.5) * this.cfg.halfWidth * 2 + this.rng.range(-0.4, 0.4);
        items.push({
          x: sx,
          y: w.env.floorAt(sx) - 0.3,
          z: this.rng.range(-1.6, 1.8),
          s: this.rng.range(0.9, 1.15),
          ry: this.rng.range(0, Math.PI * 2),
          g: k % geos.length,
          c: this.rng.range(0.8, 1.1),
        });
      }
    }
    geos.forEach((geo, gi) => {
      const mine = items.filter((it) => it.g === gi);
      const mesh = new InstancedMesh(geo, mat, mine.length);
      mine.forEach((it, i) => {
        e.set(0, it.ry, 0);
        q.setFromEuler(e);
        m4.compose(p3.set(it.x, it.y, it.z), q, s3.setScalar(it.s));
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, new Color().setScalar(it.c));
      });
      mesh.receiveShadow = true;
      this.track(mesh);
      this.group.add(mesh);
    });

    w.events.on('predator', (ev) => {
      if (ev.to === 'giveUp' && (ev.from === 'chase' || ev.from === 'alert') && w.hiddenTime > 0 && this.playing) {
        w.stat('hideEscape');
        w.events.emit('feature', { kind: 'hideEscape', x: ev.fish.x, y: ev.fish.y });
      }
    });
  }

  update(dt: number): void {
    super.update(dt);
    const w = this.world;
    const p = w.player;
    if (this.cfg.surge) {
      const ph = surgePhase(this.time, this.cfg.surgePeriod);
      const half = surgeHalfWidth(this.cfg.halfWidth, ph, this.cfg.narrow);
      // The canopy swings furthest; cover sits around the middle of the strands.
      const shift = ph * this.cfg.surgeAmp * 0.6;
      for (const s of this.spans) {
        s.x0 = s.cx + shift - half;
        s.x1 = s.cx + shift + half;
      }
      const prev = this.surge;
      this.surge = ph;
      if (Math.abs(ph) > 0.95 && Math.abs(prev) <= 0.95 && this.near(p.x)) w.events.emit('feature', { kind: 'surge', x: p.x, y: p.y });
    }
    w.searchMul = this.cfg.searchMul;
    const i = spanAt(this.spans, p.x);
    const hidden = this.playing && p.alive && i >= 0 && p.y < this.spans[i].top && p.boostTime <= 0 && p.suckTime <= 0;
    if (hidden && !this.hidden) w.events.emit('feature', { kind: 'hide', x: p.x, y: p.y });
    this.hidden = hidden;
    this.shade = damp(this.shade, hidden ? this.cfg.shade : 0, 6, dt);
    w.playerShade = this.shade;
    if (hidden) {
      w.playerHidden = true;
      w.detectMul = this.cfg.detectMul;
    }
  }

  render(): void {
    if (this.cfg.surge) shared.uCurrent.value.x = BASE_CURRENT + this.surge * this.cfg.surgeAmp * 1.4;
  }

  hud(): FeatureHud | null {
    if (this.hidden) return { label: 'Hidden', tone: 'hidden' };
    if (this.cfg.surge && Math.abs(this.surge) > 0.8 && this.world.mode === 'play') return { label: 'Surge!', tone: 'current' };
    return null;
  }

  dispose(): void {
    shared.uCurrent.value.x = BASE_CURRENT;
    super.dispose();
  }
}
