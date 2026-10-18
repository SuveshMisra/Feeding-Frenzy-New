import { Color, Mesh, type ShaderMaterial } from 'three';
import { FeatureBase } from './FeatureBase';
import { BAND_EDGE, bandFlow, bandWeight, spreadSlots, type CurrentBand } from './helpers';
import { ribbonGeometry, ribbonMaterial } from './art';
import type { FeatureHud, FlowVec } from './types';

export const CURRENT = {
  bands: 4,
  length: [30, 42] as const,
  thickness: [3.2, 4.2] as const,
  speed: 3.4,
  /** Streak particles per second per band on screen. */
  streaks: 34,
  /** Seconds between the currents reversing ([0, 0] = they never do). */
  flipEvery: [0, 0] as readonly number[],
  /** Warning before a reversal. */
  flipWarn: 3,
  /** The currents ease to a stop and back up over this long while they turn. */
  flipTurn: 1.4,
};

const STREAK = new Color('#e4fbff');

/** Strength (0..1) and whether the direction has flipped yet, `t` seconds into a turn lasting `turn`. */
export function currentTurn(t: number, turn: number): { strength: number; flipped: boolean } {
  const k = Math.min(1, Math.max(0, t / turn));
  return { strength: Math.abs(Math.cos(k * Math.PI)), flipped: k >= 0.5 };
}

interface Ribbon {
  band: CurrentBand;
  mesh: Mesh;
  mat: ShaderMaterial;
}

/** Coral Canyon: horizontal currents carry fish and player. Riding one is fast. */
export class CurrentsFeature extends FeatureBase {
  private readonly cfg = this.opts(CURRENT);
  private bands: CurrentBand[] = [];
  private ribbons: Ribbon[] = [];
  private riding = false;
  private rideCooldown = 0;
  private nextFlip = Infinity;
  private turnT = -1;
  private flipped = false;
  private warned = false;

  build(): void {
    const w = this.world;
    const lvl = w.level;
    const H = lvl.world.height;
    const geo = this.track(ribbonGeometry(24));
    const xs = spreadSlots(this.cfg.bands, lvl.world.width, 22, () => this.rng.next());
    let dir: 1 | -1 = this.rng.chance(0.5) ? 1 : -1;
    xs.forEach((x) => {
      const len = this.rng.range(this.cfg.length[0], this.cfg.length[1]);
      const thick = this.rng.range(this.cfg.thickness[0], this.cfg.thickness[1]);
      const floor = w.env.floorAt(x);
      const y0 = this.rng.range(Math.max(floor + 2.5, H * 0.25), H * 0.72);
      const band: CurrentBand = { x0: x - len / 2, x1: x + len / 2, y0, y1: Math.min(H - 1.5, y0 + thick), dir, speed: this.cfg.speed };
      this.bands.push(band);
      dir = dir > 0 ? -1 : 1;
      const totalLen = len + BAND_EDGE.x * 2;
      const spacing = 5;
      const mat = this.track(
        ribbonMaterial({ color: '#d8fbff', scroll: (this.cfg.speed * 2) / spacing, streaks: totalLen / spacing, soft: 0.6, fadeIn: 0.14, fadeOut: 0.14, lanes: 7 }),
      );
      mat.uniforms.uIntensity.value = 0.26;
      const mesh = new Mesh(geo, mat);
      const totalH = band.y1 - band.y0 + BAND_EDGE.y * 1.5;
      mesh.scale.set(totalLen, totalH, 1);
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      const ribbon = { band, mesh, mat };
      this.place(ribbon);
      this.ribbons.push(ribbon);
    });
    if (this.cfg.flipEvery[1] > 0) this.nextFlip = this.rng.range(this.cfg.flipEvery[0], this.cfg.flipEvery[1]);
  }

  /** Ribbon u runs toward +x; flip it for leftward currents so the streaks flow downstream. */
  private place(r: Ribbon): void {
    const b = r.band;
    r.mesh.position.set(b.dir > 0 ? b.x0 - BAND_EDGE.x : b.x1 + BAND_EDGE.x, (b.y0 + b.y1) / 2, -0.6);
    r.mesh.rotation.y = b.dir < 0 ? Math.PI : 0;
  }

  flowAt(x: number, y: number, out: FlowVec): FlowVec {
    return bandFlow(this.bands, x, y, out);
  }

  update(dt: number): void {
    super.update(dt);
    const w = this.world;
    const p = w.player;
    this.rideCooldown -= dt;
    this.updateFlip(dt);
    let riding = false;
    if (this.playing && p.alive) {
      for (const b of this.bands) {
        if (b.speed > this.cfg.speed * 0.5 && bandWeight(b, p.x, p.y) > 0.5 && p.vel.x * b.dir > 0.5) riding = true;
      }
    }
    if (riding) {
      w.stat('ride', dt);
      if (!this.riding && this.rideCooldown <= 0) {
        w.events.emit('feature', { kind: 'currentRide', x: p.x, y: p.y });
        this.rideCooldown = 2.5;
      }
    }
    this.riding = riding;
  }

  private updateFlip(dt: number): void {
    if (!Number.isFinite(this.nextFlip)) return;
    const w = this.world;
    if (this.turnT >= 0) {
      this.turnT += dt;
      const turn = currentTurn(this.turnT, this.cfg.flipTurn);
      if (turn.flipped && !this.flipped) {
        this.flipped = true;
        for (const r of this.ribbons) {
          r.band.dir = r.band.dir > 0 ? -1 : 1;
          this.place(r);
        }
      }
      for (const r of this.ribbons) {
        r.band.speed = this.cfg.speed * turn.strength;
        r.mat.uniforms.uIntensity.value = 0.26 * turn.strength;
      }
      if (this.turnT >= this.cfg.flipTurn) {
        this.turnT = -1;
        this.nextFlip = this.rng.range(this.cfg.flipEvery[0], this.cfg.flipEvery[1]);
        this.warned = false;
      }
      return;
    }
    if (!this.playing) return;
    this.nextFlip -= dt;
    if (!this.warned && this.nextFlip <= this.cfg.flipWarn) {
      this.warned = true;
      w.events.emit('feature', { kind: 'currentWarn', x: w.player.x, y: w.player.y });
    }
    if (this.nextFlip <= 0) {
      this.turnT = 0;
      this.flipped = false;
      w.events.emit('feature', { kind: 'currentFlip', x: w.player.x, y: w.player.y });
    }
  }

  render(_alpha: number, dt: number): void {
    const w = this.world;
    const v = w.rig.viewRect();
    for (const b of this.bands) {
      if (b.x1 < v.x0 || b.x0 > v.x1) continue;
      const x0 = Math.max(b.x0, v.x0 - 2);
      const x1 = Math.min(b.x1, v.x1 + 2);
      let n = this.cfg.streaks * dt * ((x1 - x0) / Math.max(1, v.x1 - v.x0)) * (b.speed / this.cfg.speed);
      while (n > 0) {
        if (Math.random() < n) {
          const x = x0 + Math.random() * (x1 - x0);
          const y = b.y0 + Math.random() * (b.y1 - b.y0);
          w.effects.mote('glow', x, y, -0.3 + Math.random() * 0.8, b.dir * b.speed * 2.2, 0, 0.9 + Math.random() * 0.6, 0.14, 0.06, STREAK, 0, 0, 0.7);
        }
        n -= 1;
      }
    }
  }

  hud(): FeatureHud | null {
    if (this.warned || this.turnT >= 0) return { label: 'Currents shifting!', tone: 'current', alarm: true };
    return this.riding ? { label: 'Riding the current', tone: 'current' } : null;
  }
}
