import type { GreatWhiteDef } from '../../config/levels';
import { SPECIES } from '../../config/species';
import { PLAYER, TIER_POINTS } from '../../config/tuning';
import { clamp, damp, distToSegmentSq } from '../../engine/math';
import { Rng } from '../../engine/rng';
import type { ViewRect } from '../../render/CameraRig';
import type { FishDrawer } from '../../render/FishDrawer';
import { Fish } from '../entities/Fish';
import type { World } from '../World';

export const GREAT_WHITE = {
  /** Seconds of warning before it swims in. */
  warn: 2.6,
  /** Body length as a share of the view height, so it towers over the player at every stage. */
  size: 0.7,
  minLength: 9,
  /** Speed multiplier for its final surge when the player is right in front of it. */
  lunge: 1.3,
  /** It surges when the player is within this many body lengths ahead. */
  lungeRange: 1.2,
  /** Bite reach multiplier on the mouth radius. */
  bite: 1.25,
  /** Getting this close (world units) to the mouth and surviving is a close shave. */
  closeCall: 2.5,
  /** Fallback: a pass never lasts longer than this. */
  maxPass: 16,
  z: -0.3,
};

type GreatWhiteState = 'idle' | 'warn' | 'pass';

/** Where the HUD should point while the shark is coming but not yet on screen. */
export interface GreatWhiteWarning {
  /** Direction it swims: 1 = it comes in from the left. */
  dir: 1 | -1;
  y: number;
  /** 0..1 through the warning. */
  k: number;
}

/** Body length for a view `viewH` tall. */
export function greatWhiteLength(viewH: number): number {
  return Math.max(GREAT_WHITE.minLength, viewH * GREAT_WHITE.size);
}

/** Height of a lane centred on `y` that keeps a body `half` tall clear of the seabed and the surface. */
export function laneY(y: number, floor: number, surface: number, half: number): number {
  const lo = floor + half + 0.4;
  const hi = surface - half - 0.4;
  return lo < hi ? clamp(y, lo, hi) : (lo + hi) / 2;
}

/**
 * Ocean II: every minute or two a huge great white crosses the screen, chasing the player
 * a little and eating every fish its mouth touches. A warning shows which side it comes from.
 */
export class GreatWhite {
  private state: GreatWhiteState = 'idle';
  private t = 0;
  private timer: number;
  private dir: 1 | -1 = 1;
  private y = 0;
  private len = GREAT_WHITE.minLength;
  private speed = 0;
  private shark: Fish | null = null;
  /** Already bit (or was blocked by) the player this pass. */
  private hit = false;
  private closest = Infinity;
  private seen = false;
  private chompGap = 0;
  private passes = 0;
  private readonly rng: Rng;
  private readonly view: ViewRect = { x0: 0, x1: 0, y0: 0, y1: 0 };

  constructor(
    private readonly world: World,
    private readonly cfg: GreatWhiteDef,
  ) {
    this.rng = new Rng(world.level.seed + 77);
    this.timer = cfg.first;
    world.drawer.pool('greatWhite', 1);
  }

  private get playing(): boolean {
    const w = this.world;
    return w.mode === 'play' && w.started && w.phase === 'play';
  }

  /** Debug: start the next pass now. */
  summon(): void {
    if (this.state === 'idle') this.timer = 0;
  }

  get warning(): GreatWhiteWarning | null {
    if (this.state === 'warn') return { dir: this.dir, y: this.y, k: Math.min(1, this.t / GREAT_WHITE.warn) };
    if (this.state === 'pass' && this.shark && !this.seen) return { dir: this.dir, y: this.shark.y, k: 1 };
    return null;
  }

  /** 0..1 how much danger the player is in, for the music. */
  get danger(): number {
    const p = this.world.player;
    if (!p.alive) return 0;
    if (this.state === 'warn') return 0.35 + 0.4 * Math.min(1, this.t / GREAT_WHITE.warn);
    const f = this.shark;
    if (this.state !== 'pass' || !f) return 0;
    if ((p.x - f.x) * this.dir < -f.len * 0.3) return 0.2;
    return clamp(1.3 - Math.hypot(p.x - f.mouthX, p.y - f.mouthY) / (f.len * 1.5), 0.4, 1);
  }

  /** 1 when (x, y) lies in the path of the shark, for picking a safe respawn spot. */
  threatAt(x: number, y: number): number {
    const f = this.shark;
    if (this.state !== 'pass' || !f) return 0;
    return Math.abs(y - f.y) < f.len * 0.4 && (x - f.x) * this.dir > -f.len * 0.5 ? 1 : 0;
  }

  update(dt: number): void {
    const p = this.world.player;
    switch (this.state) {
      case 'idle':
        if (this.playing && p.alive) this.timer -= dt;
        if (this.timer <= 0) this.startWarning();
        break;
      case 'warn':
        this.t += dt;
        this.y = damp(this.y, this.lane(p.y), 1.5, dt);
        if (this.t >= GREAT_WHITE.warn) this.enter();
        break;
      case 'pass':
        this.swim(dt);
        break;
    }
  }

  private get half(): number {
    return this.len * SPECIES.greatWhite.body.height * 0.5;
  }

  private lane(y: number, x = this.world.player.x): number {
    const w = this.world;
    return laneY(y, w.env.floorAt(x), w.surfaceY, this.half);
  }

  private startWarning(): void {
    const w = this.world;
    const p = w.player;
    this.state = 'warn';
    this.t = 0;
    this.dir = this.rng.sign();
    this.len = greatWhiteLength(w.rig.viewHTarget);
    this.y = this.lane(p.y);
    const v = w.rig.viewRect(this.view);
    w.events.emit('feature', { kind: this.passes === 0 ? 'giantFirst' : 'giantWarn', x: this.dir > 0 ? v.x0 : v.x1, y: this.y });
  }

  private enter(): void {
    const w = this.world;
    const def = SPECIES.greatWhite;
    const v = w.rig.viewRect(this.view);
    const f = new Fish(def, this.len / def.length);
    this.speed = PLAYER.speedByStage[w.stage - 1] * this.cfg.speed;
    f.place(this.dir > 0 ? v.x0 - this.len * 0.55 : v.x1 + this.len * 0.55, this.y, this.dir * this.speed, 0);
    f.mode = 'predator';
    f.appear = 1;
    f.z = GREAT_WHITE.z;
    f.jawTarget = 0.3;
    this.shark = f;
    this.state = 'pass';
    this.t = 0;
    this.hit = false;
    this.seen = false;
    this.closest = Infinity;
    this.passes++;
  }

  private swim(dt: number): void {
    const w = this.world;
    const p = w.player;
    const f = this.shark!;
    const L = f.len;
    const playing = this.playing;
    this.t += dt;
    this.chompGap -= dt;

    // Steer: closes in on the player's height while they are still ahead, and surges when close.
    const ahead = (p.x - f.x) * this.dir;
    let vy = 0;
    let mul = 1;
    if (playing && p.alive && !w.playerHidden && ahead > -L * 0.1) {
      const ty = this.lane(p.y + p.vel.y * 0.3, f.x);
      vy = clamp((ty - f.y) * 1.5, -1, 1) * this.speed * this.cfg.chase;
      if (ahead < L * GREAT_WHITE.lungeRange && Math.abs(p.y - f.y) < L * 0.35) mul = GREAT_WHITE.lunge;
    }
    f.vel.x = damp(f.vel.x, this.dir * this.speed * mul, 2.5, dt);
    f.vel.y = damp(f.vel.y, vy, 3, dt);
    f.integrate(dt);
    const reach = this.dir * L * 0.4;
    const floor = Math.max(w.env.floorAt(f.x), w.env.floorAt(f.x - reach), w.env.floorAt(f.x + reach));
    f.y = laneY(f.y, floor, w.surfaceY, f.radius);

    const mx = f.mouthX;
    const my = f.mouthY;
    const bite = f.mouthRadius * GREAT_WHITE.bite;
    let open = false;

    if (playing && p.alive) {
      const d = Math.hypot(p.x - mx, p.y - my) - p.radius;
      this.closest = Math.min(this.closest, d - bite);
      if (d < L * 0.6 && ahead > 0) open = true;
      if (!this.hit && d < bite) {
        this.hit = true;
        f.jaw = 0;
        if (p.protected) {
          // Knocked out of the lane rather than along it, or the shark just catches up again.
          w.hurtPlayer(p.x - this.dir * 0.6, f.y + (p.y >= f.y ? -1 : 1), 0.4, 13, 'Blocked!');
        } else {
          w.events.emit('feature', { kind: 'giantBite', x: mx, y: my });
          w.killPlayer(null);
        }
      }
      if (p.alive) this.shove(f);
    }

    let eaten = 0;
    for (const g of w.spawner.fish) {
      if (!g.alive || g.appear < 0.3) continue;
      const d = Math.hypot(g.x - mx, g.y - my) - g.radius;
      if (d < L * 0.5 && (g.x - f.x) * this.dir > 0) open = true;
      if (d < bite) {
        w.killFish(g, 0);
        eaten++;
      }
    }
    if (eaten > 0) {
      f.jaw = Math.min(f.jaw, 0.15);
      w.stat('giantFeed', eaten);
      if (this.chompGap <= 0 && this.onScreen(f)) {
        this.chompGap = 0.35;
        w.events.emit('feature', { kind: 'giantChomp', x: mx, y: my });
      }
    }
    f.jawTarget = open ? 0.9 : 0.25;

    const v = w.rig.viewRect(this.view);
    if (!this.seen && mx > v.x0 && mx < v.x1) {
      this.seen = true;
      w.events.emit('feature', { kind: 'giantEnter', x: mx, y: my });
    }
    const tail = f.x - this.dir * L * 0.6;
    const gone = this.dir > 0 ? tail > v.x1 + 1 : tail < v.x0 - 1;
    const outOfWorld = Math.abs(f.x) > w.level.world.width / 2 + L * 1.5;
    if ((gone && this.seen) || outOfWorld || this.t > GREAT_WHITE.maxPass) this.leave();
  }

  /** The body is solid: the player is pushed off it rather than swimming through. */
  private shove(f: Fish): void {
    const p = this.world.player;
    const h = f.headingAngle;
    const cx = Math.cos(h);
    const cy = Math.sin(h);
    const L = f.len;
    const ax = f.x + cx * L * 0.25;
    const ay = f.y + cy * L * 0.25;
    const bx = f.x - cx * L * 0.42;
    const by = f.y - cy * L * 0.42;
    const r = f.radius * 0.85 + p.radius;
    const d2 = distToSegmentSq(p.x, p.y, ax, ay, bx, by);
    if (d2 >= r * r) return;
    const s = p.y >= f.y ? 1 : -1;
    p.y += s * (r - Math.sqrt(d2));
    if (p.vel.y * s < 0) p.vel.y = 0;
  }

  private onScreen(f: Fish): boolean {
    const v = this.world.rig.viewRect(this.view);
    return f.x + f.len * 0.5 > v.x0 && f.x - f.len * 0.5 < v.x1;
  }

  private leave(): void {
    const w = this.world;
    const p = w.player;
    if (!this.hit && this.playing && p.alive && this.closest < GREAT_WHITE.closeCall) {
      w.stat('giantDodge');
      w.award(TIER_POINTS[4] * 2, p.x, p.y + 1, 'Close shave!', '#bfe9ff');
    }
    this.shark = null;
    this.state = 'idle';
    this.timer = this.rng.range(this.cfg.every[0], this.cfg.every[1]);
  }

  draw(drawer: FishDrawer, alpha: number, dt: number): void {
    const f = this.shark;
    if (!f) return;
    drawer.draw(f, alpha);
    if (dt <= 0 || !this.onScreen(f)) return;
    const h = f.headingAngle;
    const tx = f.x - Math.cos(h) * f.len * 0.45;
    const ty = f.y - Math.sin(h) * f.len * 0.45;
    this.world.effects.trail(tx, ty, f.z, 1.2, dt, 0.08 + f.len * 0.012);
  }
}
