import { Color, Mesh } from 'three';
import { clamp } from '../../engine/math';
import { FeatureBase } from './FeatureBase';
import { iceMaterial, icicleGeometry } from './art';
import { chainPicks, spreadSlots } from './helpers';

export const ICE = {
  count: 9,
  /** Seconds between one icicle starting to shake and the next. */
  gap: [2.5, 5] as const,
  shake: 1.3,
  gravity: 26,
  regrow: 12,
  growTime: 2,
  stun: 1.2,
  knock: 6,
  /** Icicles per collapse: the nearest neighbours follow the first one down. */
  chain: 1,
  chainDelay: 0.35,
  /** Neighbours further than this stay put. */
  chainReach: 14,
  /** Every n-th falling icicle is a wide block of ice (0 = never). */
  chunkEvery: 0,
};

type IcicleState = 'grown' | 'shake' | 'fall' | 'gone';

interface Icicle {
  x: number;
  root: number;
  len: number;
  state: IcicleState;
  t: number;
  /** Tip height while falling. */
  y: number;
  vy: number;
  grow: number;
  hitPlayer: boolean;
  /** This drop is a wide ice block with double the crush width. */
  chunk: boolean;
  mesh: Mesh;
}

const FROST = new Color('#e8f8ff');

/** Frozen Shelf: icicles shake loose and fall, crushing fish (lure predators under them!). */
export class IciclesFeature extends FeatureBase {
  private readonly cfg = this.opts(ICE);
  private icicles: Icicle[] = [];
  private next = 3;
  private drops = 0;

  build(): void {
    const w = this.world;
    const lvl = w.level;
    const H = lvl.world.height;
    const mat = this.track(iceMaterial());
    const xs = spreadSlots(this.cfg.count, lvl.world.width, 8, () => this.rng.next());
    xs.forEach((x, i) => {
      const len = this.rng.range(3.6, 5.4);
      const mesh = new Mesh(this.track(icicleGeometry(lvl.seed + 70 + i)), mat);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.icicles.push({ x, root: H + 0.35, len, state: 'grown', t: 0, y: 0, vy: 0, grow: 1, hitPlayer: false, chunk: false, mesh });
    });
  }

  private ready(c: Icicle): boolean {
    return c.state === 'grown' && c.grow >= 1;
  }

  private pick(): Icicle | null {
    const w = this.world;
    const v = w.rig.viewRect();
    const ready = this.icicles.filter((c) => this.ready(c) && c.x > v.x0 + 2 && c.x < v.x1 - 2);
    if (ready.length === 0) return null;
    // Prefer an icicle with a hunter swimming underneath, so luring works.
    for (const c of ready) {
      for (const f of w.spawner.fish) {
        if (f.alive && f.mode === 'predator' && f.brain?.hunting && Math.abs(f.x - c.x) < 2.5) return c;
      }
    }
    return this.rng.pick(ready);
  }

  /** Starts an icicle shaking after `delay` seconds. */
  private loosen(c: Icicle, delay: number): void {
    c.state = 'shake';
    c.t = -delay;
    this.drops++;
    c.chunk = this.cfg.chunkEvery > 0 && this.drops % this.cfg.chunkEvery === 0;
  }

  update(dt: number): void {
    super.update(dt);
    const w = this.world;
    if (!this.dormant) this.next -= dt;
    if (this.next <= 0) {
      this.next = this.rng.range(this.cfg.gap[0], this.cfg.gap[1]);
      const c = this.pick();
      if (c) {
        this.loosen(c, 0);
        if (this.cfg.chain > 1) {
          const others = this.icicles.filter((o) => o !== c && this.ready(o));
          chainPicks(
            others.map((o) => o.x),
            c.x,
            this.cfg.chain - 1,
            this.cfg.chainReach,
          ).forEach((idx, k) => this.loosen(others[idx], (k + 1) * this.cfg.chainDelay));
        }
        w.events.emit('feature', { kind: 'icicleCrack', x: c.x, y: c.root - c.len });
      }
    }
    for (const c of this.icicles) {
      c.t += dt;
      switch (c.state) {
        case 'shake':
          if (c.t < 0) break;
          if (Math.random() < dt * 14) w.effects.mote('glow', c.x + (Math.random() - 0.5) * 0.6, c.root - Math.random() * c.len * 0.4, 0.2, 0, -1.5, 1.2, 0.18, 0.05, FROST, 0.5, -1, 0.8);
          if (c.t >= this.cfg.shake) {
            c.state = 'fall';
            c.y = c.root - c.len;
            c.vy = 0;
            c.hitPlayer = false;
          }
          break;
        case 'fall': {
          c.vy -= this.cfg.gravity * dt;
          c.y += c.vy * dt;
          this.crush(c);
          if (c.y <= w.env.floorAt(c.x)) this.shatter(c);
          break;
        }
        case 'gone':
          if (c.t >= this.cfg.regrow) {
            c.state = 'grown';
            c.grow = 0;
          }
          break;
        case 'grown':
          c.grow = Math.min(1, c.grow + dt / this.cfg.growTime);
          break;
      }
    }
  }

  /** Kills fish and bonks the player in the falling icicle's path. */
  private crush(c: Icicle): void {
    const w = this.world;
    const p = w.player;
    const half = c.chunk ? 0.9 : 0.45;
    const top = c.y + c.len * 0.7;
    for (const f of w.spawner.fish) {
      if (!f.alive || Math.abs(f.x - c.x) > half + f.radius || f.y < c.y - f.radius || f.y > top) continue;
      const bonus = w.killFish(f, 2);
      if (bonus > 0) {
        w.award(bonus, c.x, c.y + 1, c.chunk ? 'Ice block!' : 'Icicle crush!', '#cfefff');
        w.stat('icicleKill');
      }
    }
    if (!c.hitPlayer && this.playing && p.alive && Math.abs(p.x - c.x) < half + p.radius && p.y > c.y - p.radius && p.y < top) {
      c.hitPlayer = true;
      w.hurtPlayer(c.x, c.y + c.len, this.cfg.stun * (c.chunk ? 1.4 : 1), this.cfg.knock, 'Bonk!', '#dff4ff');
    }
  }

  private shatter(c: Icicle): void {
    const w = this.world;
    const floor = w.env.floorAt(c.x);
    c.state = 'gone';
    c.t = 0;
    if (this.near(c.x)) {
      const k = c.chunk ? 1.8 : 1;
      for (let i = 0; i < 26 * k; i++) {
        const a = Math.PI * (0.1 + Math.random() * 0.8);
        const s = (2 + Math.random() * 5) * Math.sqrt(k);
        w.effects.mote(i % 3 === 0 ? 'glow' : 'dot', c.x, floor + 0.2, 0.3, Math.cos(a) * s, Math.sin(a) * s, 0.6 + Math.random() * 0.6, 0.22, 0.05, FROST, 2.5, -3, 0.95);
      }
      w.effects.bubbleBurst(c.x, floor + 0.3, 0.3, Math.round(14 * k), 0.12, 0.6, 2);
      w.effects.ring(c.x, floor + 0.3, FROST, 2.6 * k, 0.4, 0.2);
      w.events.emit('feature', { kind: c.chunk ? 'iceBlock' : 'icicleShatter', x: c.x, y: floor });
    }
  }

  render(): void {
    for (const c of this.icicles) {
      const m = c.mesh;
      m.visible = c.state !== 'gone';
      if (!m.visible) continue;
      const s = c.state === 'grown' ? clamp(c.grow, 0.05, 1) : 1;
      const len = c.len * s;
      const swell = c.state === 'fall' ? 1 : c.state === 'shake' ? clamp(c.t / this.cfg.shake, 0, 1) : 0;
      const wide = c.chunk ? 1 + 1.2 * swell : 1;
      m.scale.set(wide, len * (1 - 0.2 * (wide - 1)), wide);
      const shaking = c.state === 'shake' && c.t >= 0;
      const shake = shaking ? Math.sin(this.time * 60) * 0.06 * (0.4 + c.t / this.cfg.shake) : 0;
      m.rotation.z = shake;
      const tipY = c.state === 'fall' ? c.y : c.root - len;
      m.position.set(c.x + shake * 0.5, tipY, 0.1);
    }
  }
}
