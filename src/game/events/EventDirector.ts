import { Color } from 'three';
import type { EventId, LevelEvents } from '../../config/levels';
import { SPECIES, type SpeciesId } from '../../config/species';
import { PLAYER, TIER_POINTS } from '../../config/tuning';
import { clamp, damp, smoothstep } from '../../engine/math';
import { Rng } from '../../engine/rng';
import type { ViewRect } from '../../render/CameraRig';
import type { FishDrawer } from '../../render/FishDrawer';
import { Fish, type School } from '../entities/Fish';
import { FACING_TILT } from '../entities/Player';
import type { FeatureHud, FlowVec } from '../features/types';
import type { World } from '../World';

export const EVENTS = {
  /** Seconds after the player first reaches stage 2 until the first event. */
  first: [18, 32] as const,
  /** An event that comes due while something else is going on waits this long after it clears. */
  retry: 4,
  /** Events hold back while a great white is due within this many seconds. */
  sharkClear: 22,
  bait: {
    dur: 12,
    count: 30,
    spread: 1.3,
    band: 5,
    /** Radians per second around the ball's centre. */
    swirl: 1.5,
    radius: 2.4,
    /** Feast bonus for each fish eaten out of the ball, paid when it breaks up. */
    perFish: 60,
    /** Wandering hunters this close turn toward the ball. */
    lure: 26,
  },
  whale: {
    warn: 2.2,
    /** The column stops following the player this long before the lunge. */
    lock: 0.6,
    rise: 24,
    hold: 0.8,
    sink: 10,
    /** Body length as a share of the view height. */
    size: 0.85,
    minLength: 16,
    bite: 1.25,
    /** Surviving this close (world units) to the mouth pays a close-shave bonus. */
    closeCall: 2.6,
    /** Half-width of the bubble column. */
    column: 2.2,
    z: -0.4,
  },
  riptide: {
    warn: 2.5,
    dur: 15,
    ramp: 2,
    /** Current speed as a share of the player's cruise speed. */
    share: 0.5,
    dark: 0.55,
    radius: 8,
    gust: 4,
  },
};

/** When the next event is due. Pure timing, so it can be tested without a world. */
export class EventSchedule {
  private timer: number;

  constructor(
    private readonly every: readonly [number, number],
    private readonly rng: Rng,
    first: readonly [number, number] = EVENTS.first,
  ) {
    this.timer = rng.range(first[0], first[1]);
  }

  get remaining(): number {
    return this.timer;
  }

  /**
   * Counts down while `armed` (scaled by `rate`). Returns true when an event should start now;
   * one that comes due while `blocked` waits `EVENTS.retry` seconds past the block.
   */
  tick(dt: number, armed: boolean, blocked: boolean, rate = 1): boolean {
    if (!armed) return false;
    this.timer -= dt * rate;
    if (this.timer > 0) return false;
    if (blocked) {
      this.timer = EVENTS.retry;
      return false;
    }
    return true;
  }

  /** After an event ends. */
  restart(): void {
    this.timer = this.rng.range(this.every[0], this.every[1]);
  }

  /** Debug: due now. */
  now(): void {
    this.timer = 0;
  }
}

/** A random event from the pool, never the same one twice in a row when there is a choice. */
export function pickEvent(pool: readonly EventId[], last: EventId | null, rng: Rng): EventId {
  const options = pool.length > 1 ? pool.filter((id) => id !== last) : pool;
  return rng.pick(options as EventId[]);
}

interface GameEvent {
  readonly id: EventId;
  /** Returns false once the event is over. */
  update(dt: number): boolean;
  /** Called once when the event ends, or when the level ends mid-event. */
  end(): void;
  readonly danger: number;
  threatAt(x: number, y: number): number;
  hud(): FeatureHud | null;
  flowAt?(x: number, y: number, out: FlowVec): void;
  onEat?(f: Fish): void;
  draw?(drawer: FishDrawer, alpha: number, dt: number): void;
}

const tmp = new Color();
const view: ViewRect = { x0: 0, x1: 0, y0: 0, y1: 0 };

/**
 * Every minute or two, once the player has grown a stage, something happens: a bait ball
 * swirls in, a humpback lunges up from below, or a riptide sweeps the water sideways.
 * One at a time, and never on top of a great white pass.
 */
export class EventDirector {
  private readonly schedule: EventSchedule;
  private readonly rng: Rng;
  private current: GameEvent | null = null;
  private last: EventId | null = null;
  /** Multiplies how fast the next event comes due (endless mode escalates it). */
  rate = 1;
  /** Events started this level. */
  count = 0;

  constructor(
    private readonly world: World,
    readonly cfg: LevelEvents,
  ) {
    this.rng = new Rng(world.level.seed + 909);
    this.schedule = new EventSchedule(cfg.every, this.rng);
    if (cfg.pool.includes('whale')) world.drawer.pool('humpback', 1);
  }

  /** An event is running. */
  get busy(): boolean {
    return this.current !== null;
  }

  get active(): EventId | null {
    return this.current?.id ?? null;
  }

  get danger(): number {
    return this.current?.danger ?? 0;
  }

  threatAt(x: number, y: number): number {
    return this.current?.threatAt(x, y) ?? 0;
  }

  hud(): FeatureHud | null {
    return this.current?.hud() ?? null;
  }

  /** Adds the event's current (riptide) to `out`. */
  addFlow(x: number, y: number, out: FlowVec): void {
    this.current?.flowAt?.(x, y, out);
  }

  onEat(f: Fish): void {
    this.current?.onEat?.(f);
  }

  /** Debug: start `id` (or the next random one) as soon as nothing blocks it. */
  trigger(id?: EventId): void {
    if (this.current) return;
    if (id) this.start(id);
    else this.schedule.now();
  }

  update(dt: number): void {
    const w = this.world;
    const cur = this.current;
    if (cur) {
      // A level that ends mid-event stops it at once (the riptide would push the victory lap).
      if (!cur.update(dt) || w.phase === 'complete' || w.phase === 'over') this.finish();
      return;
    }
    const armed = w.mode === 'play' && w.started && w.phase === 'play' && w.player.alive && w.stage >= 2;
    const gw = w.greatWhite;
    const blocked = !!w.boss || (!!gw && (gw.busy || gw.eta < EVENTS.sharkClear));
    if (this.schedule.tick(dt, armed, blocked, this.rate)) this.start(pickEvent(this.cfg.pool, this.last, this.rng));
  }

  private start(id: EventId): void {
    const w = this.world;
    this.current = id === 'baitBall' ? new BaitBall(w, this.rng) : id === 'whale' ? new WhaleLunge(w, this.rng) : new Riptide(w, this.rng);
    this.last = id;
    this.count++;
    w.stat('events');
  }

  private finish(): void {
    this.current?.end();
    this.current = null;
    this.schedule.restart();
  }

  draw(drawer: FishDrawer, alpha: number, dt: number): void {
    this.current?.draw?.(drawer, alpha, dt);
  }

  dispose(): void {
    this.current?.end();
    this.current = null;
  }
}

function emit(w: World, kind: string, x: number, y: number): void {
  w.events.emit('feature', { kind, x, y });
}

/** A dense school of small fry swirls in: a feast window, and the hunters come too. */
class BaitBall implements GameEvent {
  readonly id = 'baitBall';
  readonly danger = 0;
  private t = 0;
  private readonly school: School;
  private readonly members: Set<Fish>;
  private readonly cx: number;
  private readonly cy: number;
  private eaten = 0;
  private sparkle = 0;

  constructor(
    private readonly w: World,
    rng: Rng,
  ) {
    const p = w.player;
    const B = EVENTS.bait;
    const W2 = w.level.world.width / 2;
    // In front of the player, or toward the open side when they are near a wall.
    const side = p.x + 12 > W2 - 4 ? -1 : p.x - 12 < -W2 + 4 ? 1 : p.facing;
    const cx = clamp(p.x + side * rng.range(8, 11), -W2 + 5, W2 - 5);
    const cy = clamp(p.y + rng.range(-2.5, 2.5), w.env.floorAt(cx) + 3.5, w.surfaceY - 3);
    const tier1 = w.level.roster[1] ?? [];
    const schooling = tier1.filter((id) => SPECIES[id].behavior === 'school');
    const id: SpeciesId = rng.pick(schooling.length > 0 ? schooling : tier1.length > 0 ? tier1 : ['sardine']);
    this.school = w.spawner.spawnSchool(id, cx, cy, B.count, side > 0 ? -1 : 1, B.spread, B.band, 0);
    this.members = new Set(this.school.members);
    // spawnSchool keeps the centre inside the level; swirl around where it actually went.
    this.cx = this.school.goalX;
    this.cy = this.school.goalY;
    w.effects.ring(this.cx, this.cy, tmp.set('#bfefff'), 7, 0.7, 0.2);
    emit(w, 'baitBall', this.cx, this.cy);
  }

  update(dt: number): boolean {
    const w = this.w;
    const B = EVENTS.bait;
    this.t += dt;
    const s = this.school;
    const alive = s.members.filter((m) => m.alive);
    if (alive.length === 0 || this.t >= B.dur) return false;
    let mx = 0;
    let my = 0;
    for (const m of alive) {
      mx += m.x;
      my += m.y;
    }
    mx /= alive.length;
    my /= alive.length;
    const a = this.t * B.swirl;
    const tx = this.cx + Math.cos(a) * B.radius * 1.5;
    const ty = this.cy + Math.sin(a) * B.radius * 0.8;
    s.heading = Math.atan2(ty - my, tx - mx);
    s.panic = 0;
    // Glints off the swirling scales.
    this.sparkle -= dt;
    if (this.sparkle <= 0 && w.effects.density > 0.3) {
      this.sparkle = 0.12;
      const m = alive[(Math.random() * alive.length) | 0];
      w.effects.sparkle(m.x, m.y, tmp.set('#e8fbff'), 2, 1, 0.18);
    }
    // Wandering hunters smell the feast.
    for (const f of w.spawner.fish) {
      if (!f.alive || !f.brain || f.brain.state !== 'wander') continue;
      const dx = mx - f.x;
      const dy = my - f.y;
      if (dx * dx + dy * dy < B.lure * B.lure) f.wanderAngle = Math.atan2(dy * 0.5, dx);
    }
    return true;
  }

  onEat(f: Fish): void {
    if (!this.members.has(f)) return;
    this.eaten++;
    this.w.stat('baitEat');
  }

  end(): void {
    const w = this.w;
    const p = w.player;
    if (this.eaten > 0 && p.alive) w.award(this.eaten * EVENTS.bait.perFish, p.x, p.y + 1.2, `Feast x${this.eaten}!`, '#bfefff');
    emit(w, 'baitEnd', p.x, p.y);
  }

  threatAt(): number {
    return 0;
  }

  hud(): FeatureHud {
    return { label: 'Bait ball', value: 1 - this.t / EVENTS.bait.dur, tone: 'light' };
  }
}

type WhaleState = 'warn' | 'rise' | 'hold' | 'sink';

/** Rising bubbles mark a column; then a humpback lunges up through it, mouth wide. */
class WhaleLunge implements GameEvent {
  readonly id = 'whale';
  private state: WhaleState = 'warn';
  private t = 0;
  private x: number;
  private vy = 0;
  private whale: Fish | null = null;
  private readonly len: number;
  private hit = false;
  private closest = Infinity;
  private bubble = 0;
  private ringGap = 0;
  private chompGap = 0;

  constructor(
    private readonly w: World,
    private readonly rng: Rng,
  ) {
    const p = w.player;
    this.len = Math.max(EVENTS.whale.minLength, w.rig.viewHTarget * EVENTS.whale.size);
    this.x = this.column(p.x + p.vel.x * 0.6);
    emit(w, 'whaleWarn', this.x, w.env.floorAt(this.x) + 2);
  }

  private column(x: number): number {
    const W2 = this.w.level.world.width / 2;
    return clamp(x, -W2 + 3, W2 - 3);
  }

  private get playing(): boolean {
    const w = this.w;
    return w.mode === 'play' && w.started && w.phase === 'play';
  }

  get danger(): number {
    const p = this.w.player;
    if (!p.alive) return 0;
    const near = clamp(1.2 - Math.abs(p.x - this.x) / 10, 0.2, 1);
    if (this.state === 'warn') return near * (0.4 + 0.5 * Math.min(1, this.t / EVENTS.whale.warn));
    return this.state === 'rise' ? near : 0.15;
  }

  threatAt(x: number): number {
    return (this.state === 'warn' || this.state === 'rise') && Math.abs(x - this.x) < EVENTS.whale.column + 2 ? 1 : 0;
  }

  hud(): FeatureHud | null {
    return this.state === 'warn' ? { label: 'Whale below!', tone: 'heat', alarm: true } : null;
  }

  update(dt: number): boolean {
    const w = this.w;
    const p = w.player;
    const E = EVENTS.whale;
    this.t += dt;
    switch (this.state) {
      case 'warn': {
        if (this.t < E.warn - E.lock && p.alive) this.x = damp(this.x, this.column(p.x), 1.4, dt);
        const floor = w.env.floorAt(this.x);
        const k = Math.min(1, this.t / E.warn);
        this.bubble -= dt;
        if (this.bubble <= 0) {
          this.bubble = 0.04 - 0.025 * k;
          const bx = this.x + this.rng.range(-E.column, E.column);
          const by = floor + 0.4 + this.rng.range(0, 2 + 8 * k);
          w.effects.bubbleBurst(bx, by, E.z + 0.6, 3 + Math.round(4 * k), 0.22 + 0.16 * k, 0.5, 4 + 6 * k);
        }
        this.ringGap -= dt;
        if (this.ringGap <= 0) {
          this.ringGap = 0.4 - 0.2 * k;
          w.effects.ring(this.x, floor + 0.8 + k * 3, tmp.set('#d8f4ff'), E.column * 2.2, 0.5, 0.14);
        }
        if (this.t >= E.warn) this.lunge();
        break;
      }
      case 'rise': {
        const f = this.whale!;
        this.vy = E.rise;
        this.move(f, dt, 1);
        this.bite(f);
        if (f.mouthY >= w.surfaceY - 0.4 || this.t > 3) {
          this.state = 'hold';
          this.t = 0;
          f.jawTarget = 0;
          for (let i = 0; i < 4; i++) w.effects.bubbleBurst(f.mouthX + this.rng.range(-2, 2), w.surfaceY - 0.5, E.z + 0.6, 10, 0.24, 1.6, 3);
          emit(w, 'whaleBreach', f.mouthX, w.surfaceY - 0.5);
        }
        break;
      }
      case 'hold': {
        const f = this.whale!;
        this.vy = damp(this.vy, 0, 6, dt);
        this.move(f, dt, 0.4);
        if (this.t >= E.hold) {
          this.state = 'sink';
          this.t = 0;
        }
        break;
      }
      case 'sink': {
        const f = this.whale!;
        this.vy = damp(this.vy, -E.sink, 1.5, dt);
        this.move(f, dt, 0.5);
        if (f.mouthY < w.env.floorAt(f.x) - 1.5 || this.t > 5) return false;
        break;
      }
    }
    if (this.whale && p.alive && this.state !== 'warn') this.shove(this.whale);
    return true;
  }

  private lunge(): void {
    const w = this.w;
    const E = EVENTS.whale;
    const def = SPECIES.humpback;
    const f = new Fish(def, this.len / def.length);
    const floor = w.env.floorAt(this.x);
    f.place(this.x, floor - this.len * 0.42, 0, E.rise);
    f.facing = 1;
    f.yaw = -FACING_TILT;
    f.pitch = Math.PI * 0.46;
    f.mode = 'predator';
    f.appear = 1;
    f.z = E.z;
    f.jaw = 0.4;
    f.jawTarget = 1;
    this.whale = f;
    this.state = 'rise';
    this.t = 0;
    this.closest = Infinity;
    w.effects.sandPuff(this.x, floor + 0.3, E.z + 0.5, 8, tmp.set(w.env.biome.sand.base), 0.5);
    emit(w, 'whaleLunge', this.x, floor + 2);
  }

  private move(f: Fish, dt: number, swim: number): void {
    f.prevX = f.x;
    f.prevY = f.y;
    f.y += this.vy * dt;
    f.vel.x = 0;
    f.vel.y = this.vy;
    // A slow roll as it climbs, like a real lunge.
    f.roll = damp(f.roll, this.state === 'rise' ? 0.35 : 0, 2, dt);
    f.phase = (f.phase + dt * Math.PI * 2 * f.def.swim.freq * (0.5 + swim)) % (Math.PI * 20);
    f.jaw = damp(f.jaw, f.jawTarget, f.jawTarget > f.jaw ? 10 : 5, dt);
    f.flash = Math.max(0, f.flash - dt * 2);
  }

  /** Swallows everything in its mouth on the way up. */
  private bite(f: Fish): void {
    const w = this.w;
    const p = w.player;
    const E = EVENTS.whale;
    const mx = f.mouthX;
    const my = f.mouthY;
    const r = f.mouthRadius * E.bite;
    this.chompGap -= 1 / 60;
    if (this.playing && p.alive) {
      const d = Math.hypot(p.x - mx, p.y - my) - p.radius;
      this.closest = Math.min(this.closest, d - r);
      if (!this.hit && d < r) {
        this.hit = true;
        if (p.protected) {
          w.hurtPlayer(mx, p.y - 1, 0.4, 14, 'Blocked!');
        } else {
          emit(w, 'whaleBite', mx, my);
          w.killPlayer(null);
        }
      }
    }
    let eaten = 0;
    for (const g of w.spawner.fish) {
      if (!g.alive || g.appear < 0.3) continue;
      if (Math.hypot(g.x - mx, g.y - my) - g.radius < r) {
        w.killFish(g, 0);
        eaten++;
      }
    }
    if (eaten > 0) {
      w.stat('whaleFeed', eaten);
      if (this.chompGap <= 0) {
        this.chompGap = 0.3;
        emit(w, 'giantChomp', mx, my);
      }
    }
  }

  /** The body is solid: the player is pushed out sideways. */
  private shove(f: Fish): void {
    const p = this.w.player;
    const top = f.mouthY;
    const bottom = f.y - f.len * 0.5;
    if (p.y > top || p.y < bottom) return;
    const r = f.radius * 0.9 + p.radius;
    const dx = p.x - f.x;
    if (Math.abs(dx) >= r) return;
    p.x = f.x + (dx >= 0 ? r : -r);
    if (p.vel.x * dx < 0) p.vel.x = 0;
  }

  end(): void {
    const w = this.w;
    const p = w.player;
    if (!this.hit && this.whale && this.playing && p.alive && this.closest < EVENTS.whale.closeCall) {
      w.stat('whaleDodge');
      w.award(TIER_POINTS[4] * 2, p.x, p.y + 1, 'Close shave!', '#bfe9ff');
    }
    this.whale = null;
  }

  draw(drawer: FishDrawer, alpha: number, dt: number): void {
    const f = this.whale;
    if (!f) return;
    drawer.draw(f, alpha);
    if (dt > 0 && this.state === 'rise') this.w.effects.trail(f.x, f.y - f.len * 0.45, f.z, 1.4, dt, 0.1 + f.len * 0.01);
  }
}

/** A strong sideways current: darker water, streaking debris, everything pushed along. */
class Riptide implements GameEvent {
  readonly id = 'riptide';
  readonly danger = 0.25;
  private state: 'warn' | 'surge' = 'warn';
  private t = 0;
  private readonly dir: 1 | -1;
  private debris = 0;
  private gust = 0;
  private time = 0;
  private readonly ownsVision: boolean;

  constructor(
    private readonly w: World,
    rng: Rng,
  ) {
    this.dir = rng.sign();
    this.ownsVision = !w.feature || w.feature.id !== 'darkness';
    const v = w.rig.viewRect(view);
    emit(w, this.dir > 0 ? 'riptideWarnE' : 'riptideWarnW', this.dir > 0 ? v.x0 : v.x1, w.player.y);
  }

  /** 0..1 how strong the surge is right now. */
  private get amount(): number {
    if (this.state !== 'surge') return 0;
    const R = EVENTS.riptide;
    return smoothstep(0, R.ramp, this.t) * (1 - smoothstep(R.dur - R.ramp, R.dur, this.t));
  }

  private get speed(): number {
    return PLAYER.speedByStage[this.w.stage - 1] * EVENTS.riptide.share;
  }

  threatAt(): number {
    return 0;
  }

  hud(): FeatureHud {
    const R = EVENTS.riptide;
    if (this.state === 'warn') return { label: 'Riptide incoming', tone: 'current', alarm: true };
    return { label: this.dir > 0 ? 'Riptide \u2192' : '\u2190 Riptide', value: 1 - this.t / R.dur, tone: 'current' };
  }

  flowAt(x: number, y: number, out: FlowVec): void {
    const k = this.amount;
    if (k <= 0) return;
    out.x += this.dir * this.speed * k * (0.8 + 0.2 * Math.sin(y * 0.45 + this.time * 1.3));
    out.y += Math.sin(x * 0.18 + this.time * 0.9) * 0.6 * k;
  }

  update(dt: number): boolean {
    const w = this.w;
    const R = EVENTS.riptide;
    this.t += dt;
    this.time += dt;
    if (this.state === 'warn') {
      if (this.t >= R.warn) {
        this.state = 'surge';
        this.t = 0;
        this.gust = R.gust;
        emit(w, 'riptide', w.player.x, w.player.y);
      }
      return true;
    }
    if (this.t >= R.dur) return false;
    const k = this.amount;
    if (this.ownsVision) {
      w.vision.dark = R.dark * k;
      w.vision.radius = R.radius;
    } else {
      w.vision.dark = Math.max(w.vision.dark, R.dark * k);
    }
    // Debris and silt streaking along with the current.
    const v = w.rig.viewRect(view);
    this.debris += dt * 110 * k * w.effects.density;
    const vx = this.dir * this.speed * 2.4;
    while (this.debris >= 1) {
      this.debris--;
      const x = this.dir > 0 ? v.x0 - 1 + Math.random() * (v.x1 - v.x0) * 0.6 : v.x1 + 1 - Math.random() * (v.x1 - v.x0) * 0.6;
      const y = v.y0 + Math.random() * (v.y1 - v.y0);
      const silt = Math.random() < 0.65;
      w.effects.mote(silt ? 'dot' : 'bubble', x, y, -1 + Math.random() * 2, vx * (0.7 + Math.random() * 0.6), (Math.random() - 0.5) * 0.8, 1.5, silt ? 0.13 : 0.16, 0.08, tmp.set(silt ? '#c8d4cc' : '#eef8ff'), 0, silt ? 0 : 0.6, 0.85);
    }
    this.gust -= dt;
    if (this.gust <= 0 && this.t < R.dur - R.ramp) {
      this.gust = R.gust;
      emit(w, 'riptideGust', w.player.x - this.dir * 6, w.player.y);
    }
    return true;
  }

  end(): void {
    const w = this.w;
    if (this.ownsVision) w.vision.dark = 0;
    if (this.state === 'surge' && w.player.alive) {
      w.stat('riptideSurvive');
      emit(w, 'riptideEnd', w.player.x, w.player.y);
    }
  }
}
