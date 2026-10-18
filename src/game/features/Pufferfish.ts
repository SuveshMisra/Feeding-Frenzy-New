import { DynamicDrawUsage, Euler, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { easeOutBack } from '../../engine/math';
import type { Fish } from '../entities/Fish';
import { FeatureBase } from './FeatureBase';
import { spikeMaterial, spikeShellGeometry } from './art';

export const PUFF = {
  /** Puffs up when the player comes this close (plus body lengths). */
  trigger: 3.2,
  /** Seconds between noticing the player and starting to swell: the window to eat it. */
  windup: 0.45,
  /** Seconds it stays puffed. */
  duration: 3,
  cooldown: 2,
  growRate: 6,
  shrinkRate: 1.6,
  /** Extra size when fully puffed. */
  swell: 0.7,
  bonus: 120,
  /** Every new pufferfish brings a partner. */
  pairs: false,
  /** Lionfish sting a player who bites them head-on. */
  lionfishSting: false,
  /** No more partners once this many puffers are about. */
  maxPuffers: 8,
};

/** True when the point lies ahead of the fish's head (within about 70 degrees of its heading). */
export function lionfishFacing(heading: number, fx: number, fy: number, px: number, py: number): boolean {
  const dx = px - fx;
  const dy = py - fy;
  const d = Math.hypot(dx, dy) || 1;
  return (dx * Math.cos(heading) + dy * Math.sin(heading)) / d > 0.35;
}

interface Puff {
  inflate: number;
  windup: number;
  timer: number;
  cooldown: number;
  spin: number;
}

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const p3 = new Vector3();
const s3 = new Vector3();

/** Sunlit Reef: pufferfish swell into spiky balls when the player gets close. */
export class PufferFeature extends FeatureBase {
  private readonly cfg = this.opts(PUFF);
  private readonly puffs = new Map<Fish, Puff>();
  private readonly partners = new WeakSet<Fish>();
  private spikes: InstancedMesh | null = null;

  build(): void {
    const geo = this.track(spikeShellGeometry());
    const mat = this.track(spikeMaterial());
    this.spikes = new InstancedMesh(geo, mat, 24);
    this.spikes.instanceMatrix.setUsage(DynamicDrawUsage);
    this.spikes.frustumCulled = false;
    this.spikes.count = 0;
    this.group.add(this.spikes);
  }

  update(dt: number): void {
    super.update(dt);
    const w = this.world;
    const p = w.player;
    const watching = this.playing && p.alive;
    for (const f of w.spawner.fish) {
      if (!f.alive || f.def.id !== 'pufferfish') continue;
      let s = this.puffs.get(f);
      if (!s) {
        s = { inflate: 0, windup: 0, timer: 0, cooldown: 0, spin: this.rng.range(0, 6) };
        this.puffs.set(f, s);
        if (this.cfg.pairs && !this.partners.has(f) && this.puffs.size < this.cfg.maxPuffers) {
          // Swim alongside rather than behind: new fish spawn just outside the view, and a
          // partner placed further out would be despawned straight away.
          const dir = f.facing >= 0 ? 1 : -1;
          const side = f.y > (f.bandMin + f.bandMax) / 2 ? -1 : 1;
          const mate = w.spawner.spawnNear('pufferfish', f.x - dir * f.len * 0.4, f.y + side * (f.len + 0.6), dir, f.appear);
          this.partners.add(mate);
        }
      }
      s.cooldown -= dt;
      const d = Math.hypot(p.x - f.x, p.y - f.y) - p.len * 0.5 - f.len * 0.5;
      if (watching && d < this.cfg.trigger && s.timer <= 0 && s.windup <= 0 && s.cooldown <= 0) {
        s.windup = this.cfg.windup;
        f.alert = 1;
      }
      if (s.windup > 0) {
        s.windup -= dt;
        f.flash = Math.max(f.flash, 0.25);
        if (s.windup <= 0) {
          s.timer = this.cfg.duration;
          if (this.near(f.x)) w.events.emit('feature', { kind: 'puffInflate', x: f.x, y: f.y });
        }
      }
      if (s.timer > 0) {
        s.timer -= dt;
        if (s.timer <= 0) s.cooldown = this.cfg.cooldown;
      }
      const target = s.timer > 0 ? 1 : 0;
      s.inflate += (target - s.inflate) * Math.min(1, dt * (target ? this.cfg.growRate : this.cfg.shrinkRate));
      s.spin += dt * (0.4 + s.inflate);
      f.scaleMul = 1 + this.cfg.swell * easeOutBack(Math.min(1, s.inflate));
      f.spiky = s.inflate > 0.45;
      if (s.inflate > 0.3) {
        // A puffed fish is a slow balloon.
        const k = Math.max(0, 1 - dt * 3);
        f.vel.x *= k;
        f.vel.y *= k;
      }
    }
    for (const f of this.puffs.keys()) if (!f.alive) this.puffs.delete(f);
  }

  onEat(f: Fish): void {
    if (f.def.id === 'lionfish' && this.cfg.lionfishSting) {
      this.world.stat('lionfishBack');
      return;
    }
    if (f.def.id !== 'pufferfish' || f.spiky) return;
    this.world.award(this.cfg.bonus, f.x, f.y + 0.6, 'Puffer snack!', '#ffe08a');
    this.world.stat('puffer');
  }

  /** A lionfish facing the player has its venomous spines forward. */
  stings(f: Fish): boolean {
    if (!this.cfg.lionfishSting || f.def.id !== 'lionfish') return false;
    return lionfishFacing(f.headingAngle, f.x, f.y, this.world.player.x, this.world.player.y);
  }

  render(alpha: number): void {
    const mesh = this.spikes;
    if (!mesh) return;
    let n = 0;
    for (const [f, s] of this.puffs) {
      if (!f.alive || s.inflate < 0.05 || n >= mesh.instanceMatrix.count) continue;
      p3.set(f.prevX + (f.x - f.prevX) * alpha, f.prevY + (f.y - f.prevY) * alpha, f.z);
      e.set(s.spin * 0.3, s.spin, 0);
      q.setFromEuler(e);
      s3.setScalar(f.len * 0.33 * f.scaleMul * Math.min(1, s.inflate * 1.4));
      m4.compose(p3, q, s3);
      mesh.setMatrixAt(n++, m4);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }
}
