import { Color, Mesh, MeshStandardMaterial, PlaneGeometry, PointLight, SphereGeometry, type MeshBasicMaterial, type ShaderMaterial } from 'three';
import type { BossDef } from '../../config/levels';
import { SPECIES } from '../../config/species';
import { clamp, damp, dampAngle, distToSegmentSq, smoothstep } from '../../engine/math';
import { patchMaterial } from '../../engine/materialPatches';
import type { FishDrawer } from '../../render/FishDrawer';
import { Fish } from '../entities/Fish';
import { FACING_TILT } from '../entities/Player';
import { glowMaterial, ribbonGeometry, ribbonMaterial, softGlowMaterial } from '../features/art';
import type { World } from '../World';
import { BossBase } from './BossBase';

export const ANGLER = {
  /** Keeps about this far to the side of the player while it stalks. */
  stalkDist: 12,
  /** Seconds of stalking before each lunge, by phase. */
  stalk: [4.6, 3.8, 3.2],
  stalkSpeed: 7,
  /** Wind-up before a lunge; the aim locks for the last `lock` seconds. */
  telegraph: [1.3, 1.05, 0.9],
  lock: 0.32,
  lungeSpeed: [27, 31, 35],
  /** A lunge that hits nothing gives up after this long. */
  maxLunge: 2.4,
  /** Lunges stay this close to horizontal (radians), so it ends up in a wall or the seabed. */
  maxPitch: 0.6,
  /** Seconds dazed after a crash, by phase: the limp lure is the weak point. */
  stun: [5.5, 4.8, 4.2],
  /** The last phase lunges twice: the first crash only staggers it. */
  stagger: 0.75,
  /** Speed it bounces back off a side wall at; the daze damps it to a stop a few units out. */
  wallRecoil: 10,
  /** The limp lure stays at least this far inside the side walls, where the player can reach it. */
  lureWallGap: 3,
  hurt: 1.2,
  phaseUp: 2.8,
  /** Seconds it takes to swim in once the fight starts. */
  intro: 3,
  /** Lure reach ahead of the head while it stalks. */
  lureReach: 6.5,
  lureR: 0.42,
  /** The player's body this close to the lure sets off a snap. */
  lureSnap: 1.3,
  snapTime: 0.42,
  snapSpeed: 24,
  /** Small fish within this of the lure are drawn in, and gulped when they reach it. */
  lurePull: 7,
  /** Lanternfish swarm when each phase starts (none in the first). */
  swarm: [0, 14, 20],
  z: -0.25,
};

const BEADS = 11;
const tmp = new Color();

/**
 * Ocean I's boss. It stalks the player with a glowing lure that draws in small fish and snaps
 * at anything that touches it, then winds up and lunges. A lunge that misses crashes into the
 * trench wall or the seabed and leaves it dazed, its lure hanging limp: bite the lure!
 */
export class AnglerKing extends BossBase {
  private readonly fish: Fish;
  /** Which side of the player it stalks from (1: to the right). */
  private side: 1 | -1 = 1;
  /** Swimming round the player to the roomier side. */
  private crossing = 0;
  private aim = 0;
  private lunges = 0;
  private snapping = 0;
  private biteGap = 0;
  private gulpGap = 0;
  private pulseGap = 0;
  private roared = false;
  private readonly lure = { x: 0, y: 0, px: 0, py: 0 };
  private readonly beads: Mesh[] = [];
  private readonly bulb: Mesh;
  private readonly bulbMat: MeshBasicMaterial;
  private readonly halo: Mesh;
  private readonly haloMat: ShaderMaterial;
  private readonly streak: Mesh;
  private readonly streakMat: ShaderMaterial;
  private readonly light: PointLight;
  private lureGlow = 1;

  constructor(world: World, def: BossDef) {
    super(world, def);
    const sp = SPECIES.anglerKing;
    world.drawer.pool(sp.id, 1);
    const f = (this.fish = new Fish(sp, 1));
    const W = world.level.world.width;
    f.place(W / 2 + f.len * 0.7, world.level.world.height * 0.5, -0.01, 0);
    f.vel.x = 0;
    f.appear = 1;
    f.z = ANGLER.z;
    f.mode = 'predator';
    this.lure.x = this.lure.px = f.x - 4;
    this.lure.y = this.lure.py = f.y + 2;

    const beadGeo = this.track(new SphereGeometry(1, 8, 6));
    const beadMat = this.track(patchMaterial(new MeshStandardMaterial({ color: '#2b2f3c', roughness: 0.6 }), { caustics: false }));
    for (let i = 0; i < BEADS; i++) {
      const b = new Mesh(beadGeo, beadMat);
      b.scale.setScalar(0.2 - 0.11 * (i / (BEADS - 1)));
      this.beads.push(b);
      this.group.add(b);
    }
    this.bulbMat = this.track(glowMaterial('#fff0b8'));
    this.bulb = new Mesh(this.track(new SphereGeometry(ANGLER.lureR, 14, 10)), this.bulbMat);
    this.haloMat = this.track(softGlowMaterial('#ffc862'));
    this.halo = new Mesh(this.track(new PlaneGeometry(1, 1)), this.haloMat);
    this.halo.renderOrder = 6;
    this.streakMat = this.track(ribbonMaterial({ color: '#ff4a3a', scroll: -2.4, streaks: 5, streakAmount: 0.7, soft: 1.6, fadeIn: 0.03, fadeOut: 0.55 }));
    this.streak = new Mesh(this.track(ribbonGeometry()), this.streakMat);
    this.streak.renderOrder = 5;
    this.streak.visible = false;
    this.light = new PointLight('#ffc862', 0, 16, 1.6);
    this.group.add(this.bulb, this.halo, this.streak, this.light);
  }

  private get W2(): number {
    return this.world.level.world.width / 2;
  }

  private get ph(): number {
    return Math.min(this.health.phase, 2);
  }

  /** Head-up direction for the current heading (the body's "up" flips with facing). */
  private upOf(h: number, facing: number): [number, number] {
    return facing > 0 ? [-Math.sin(h), Math.cos(h)] : [Math.sin(h), -Math.cos(h)];
  }

  /** Where the lure's filament leaves the head, at sim position (x, y). */
  private anchor(x = this.fish.x, y = this.fish.y): [number, number] {
    const f = this.fish;
    const h = f.headingAngle;
    const [ux, uy] = this.upOf(h, f.facing);
    return [x + Math.cos(h) * f.len * 0.3 + ux * f.radius * 0.95, y + Math.sin(h) * f.len * 0.3 + uy * f.radius * 0.95];
  }

  get danger(): number {
    const p = this.world.player;
    if (!p.alive) return 0;
    const f = this.fish;
    switch (this.state) {
      case 'telegraph':
      case 'strike':
        return 1;
      case 'attack':
        return clamp(1.15 - Math.hypot(p.x - f.mouthX, p.y - f.mouthY) / 22, 0.45, 0.85);
      case 'recover':
        return 0.85;
      case 'stunned':
        return 0.3;
      case 'defeated':
        return 0;
      default:
        return 0.6;
    }
  }

  threatAt(x: number, y: number): number {
    const f = this.fish;
    if (this.state === 'defeated') return 0;
    return Math.hypot(x - f.x, y - f.y) < f.len * 1.1 ? 1 : 0;
  }

  stun(): void {
    if (this.state === 'attack' || this.state === 'telegraph' || this.state === 'strike') this.daze();
  }

  update(dt: number): void {
    super.update(dt);
    const w = this.world;
    const p = w.player;
    const f = this.fish;
    this.lure.px = this.lure.x;
    this.lure.py = this.lure.y;
    this.biteGap -= dt;
    this.gulpGap -= dt;
    const ph = this.ph;
    let facing: 1 | -1 = f.facing;
    let pitch = 0;
    let roll = 0;
    // Where the lure wants to be, relative to the anchor; null: hang limp.
    let lureTo: [number, number] | null = null;

    switch (this.state) {
      case 'intro': {
        if (!w.started) {
          f.vel.x = f.vel.y = 0;
          break;
        }
        this.side = f.x >= p.x ? 1 : -1;
        this.steer(dt, p.x + this.side * ANGLER.stalkDist, p.y + 1, ANGLER.stalkSpeed * 1.2);
        facing = p.x > f.x ? 1 : -1;
        f.jawTarget = 0.2;
        lureTo = this.reachFor(p.x, p.y, 0.6);
        if (!this.roared && this.t > ANGLER.intro * 0.45) {
          this.roared = true;
          f.jaw = 1;
          f.alert = 1;
          this.emit('bossRoar', f.mouthX, f.mouthY);
        }
        if (this.t >= ANGLER.intro) this.toStalk();
        break;
      }
      case 'attack': {
        const W2 = this.W2;
        const reach = W2 - f.len * 0.45;
        // Swing round to the other side when the player has backed it against a wall.
        if (!this.crossing && Math.abs(p.x + this.side * ANGLER.stalkDist) > reach && Math.abs(p.x - this.side * ANGLER.stalkDist) <= reach) {
          this.side = this.side > 0 ? -1 : 1;
          const H = w.surfaceY;
          this.crossing = p.y > H * 0.5 ? -1 : 1;
        }
        let ty = p.y + Math.sin(this.time * 0.6) * 2;
        if (this.crossing) {
          ty = p.y + this.crossing * (f.radius + p.radius + 4);
          if ((f.x - p.x) * this.side > ANGLER.stalkDist * 0.55) this.crossing = 0;
        }
        const tx = clamp(p.x + this.side * ANGLER.stalkDist, -reach, reach);
        this.steer(dt, tx, ty, ANGLER.stalkSpeed * (1 + 0.15 * ph));
        facing = p.x > f.x ? 1 : -1;
        if (this.snapping > 0) {
          this.snapping -= dt;
          f.jawTarget = this.snapping > ANGLER.snapTime * 0.4 ? 1 : 0;
          lureTo = [facing * 1.5, 0.6];
        } else {
          f.jawTarget = 0.15 + 0.1 * Math.sin(this.time * 1.3);
          lureTo = this.reachFor(p.x, p.y, 1);
          this.tempt(dt);
          if (this.t >= ANGLER.stalk[ph] && !this.crossing) {
            this.lunges = ph >= 2 ? 2 : 1;
            this.windUp();
          }
        }
        this.mouthHits();
        break;
      }
      case 'telegraph': {
        const dur = ANGLER.telegraph[ph] * (this.lunges < (ph >= 2 ? 2 : 1) ? 0.65 : 1);
        if (this.t < dur - ANGLER.lock && p.alive) this.aim = this.aimAt(p.x + p.vel.x * 0.15, p.y + p.vel.y * 0.15);
        facing = Math.cos(this.aim) >= 0 ? 1 : -1;
        pitch = this.pitchFor(this.aim, facing);
        // Draw back against the aim, jaw wide.
        const back = 2.6 * (1 - smoothstep(0, dur, this.t));
        f.vel.x = damp(f.vel.x, -Math.cos(this.aim) * back, 4, dt);
        f.vel.y = damp(f.vel.y, -Math.sin(this.aim) * back, 4, dt);
        f.jawTarget = 1;
        f.alert = 1;
        lureTo = [facing * 1.2, 0.5];
        this.mouthHits();
        if (this.t >= dur) {
          this.enter('strike');
          const s = ANGLER.lungeSpeed[ph];
          f.vel.x = Math.cos(this.aim) * s;
          f.vel.y = Math.sin(this.aim) * s;
          this.emit('bossLunge', f.mouthX, f.mouthY);
        }
        break;
      }
      case 'strike': {
        facing = Math.cos(this.aim) >= 0 ? 1 : -1;
        pitch = this.pitchFor(this.aim, facing);
        f.jawTarget = 1;
        f.alert = 1;
        lureTo = [-facing * 0.6, 0.9];
        this.mouthHits();
        this.gulp(f.mouthRadius * 1.1);
        if (this.crashed()) this.crash();
        else if (this.t > ANGLER.maxLunge) this.toStalk();
        break;
      }
      case 'recover': {
        f.vel.x = damp(f.vel.x, 0, 5, dt);
        f.vel.y = damp(f.vel.y, 0, 5, dt);
        facing = p.x > f.x ? 1 : -1;
        roll = Math.sin(this.t * 14) * 0.12;
        f.jawTarget = 0.5;
        lureTo = null;
        if (this.t >= ANGLER.stagger) this.windUp();
        break;
      }
      case 'stunned': {
        f.vel.x = damp(f.vel.x, 0, 3, dt);
        f.vel.y = damp(f.vel.y, Math.sin(this.time * 1.4) * 0.3, 3, dt);
        roll = 0.38 + Math.sin(this.time * 2.2) * 0.06;
        f.jawTarget = 0.45;
        f.alert = 0;
        lureTo = null;
        this.pulseGap -= dt;
        if (this.pulseGap <= 0) {
          this.pulseGap = 0.7;
          w.effects.ring(this.lure.x, this.lure.y, tmp.set('#ffd27a'), 2.6, 0.5, 0.16);
        }
        this.lureBite();
        if (this.state === 'stunned' && this.t >= ANGLER.stun[ph]) {
          this.emit('bossRecover', f.mouthX, f.mouthY);
          f.jaw = 1;
          this.toStalk();
        }
        break;
      }
      case 'hurt': {
        const away = f.x >= p.x ? 1 : -1;
        f.vel.x = damp(f.vel.x, away * 7 * (1 - this.t / ANGLER.hurt), 4, dt);
        f.vel.y = damp(f.vel.y, 1.5, 3, dt);
        facing = p.x > f.x ? 1 : -1;
        roll = Math.sin(this.t * 18) * 0.15 * (1 - this.t / ANGLER.hurt);
        f.jawTarget = 1;
        lureTo = [facing * 1, 1.2];
        if (this.t >= ANGLER.hurt) this.toStalk();
        break;
      }
      case 'phaseUp': {
        this.side = f.x >= p.x ? 1 : -1;
        this.steer(dt, clamp(p.x + this.side * ANGLER.stalkDist * 1.25, -this.W2 + 6, this.W2 - 6), w.surfaceY * 0.5, ANGLER.stalkSpeed * 1.4);
        facing = p.x > f.x ? 1 : -1;
        f.alert = 1;
        f.jawTarget = this.t > 0.4 && this.t < 1.6 ? 1 : 0.2;
        if (!this.roared && this.t > 0.4) {
          this.roared = true;
          this.emit('bossRoar', f.mouthX, f.mouthY);
        }
        lureTo = [facing * 2, 1.5];
        if (this.t >= ANGLER.phaseUp) this.toStalk();
        break;
      }
      case 'defeated': {
        f.vel.x = damp(f.vel.x, 0, 2, dt);
        f.vel.y = damp(f.vel.y, -1.1, 1.5, dt);
        roll = Math.min(2.6, this.t * 1.1);
        f.jawTarget = 0.7;
        f.alert = 0;
        f.tint = Math.max(-0.7, -this.t * 0.3);
        lureTo = null;
        if (Math.random() < dt * 14) w.effects.bubbleBurst(f.x + (Math.random() - 0.5) * f.len * 0.6, f.y + f.radius * 0.5, f.z + 0.3, 3, 0.2, 0.6, 1.2);
        break;
      }
    }

    this.move(dt, facing, pitch, roll);
    if (this.state !== 'defeated') this.keepInside();
    this.moveLure(dt, lureTo);
    if (p.alive && this.state !== 'defeated') this.shove();
  }

  /** Stalk: a lure position reaching toward (x, y), relative to the anchor. */
  private reachFor(x: number, y: number, k: number): [number, number] {
    const [ax, ay] = this.anchor();
    const dx = x - ax;
    const dy = y - ay;
    const d = Math.hypot(dx, dy) || 1;
    const r = Math.min(ANGLER.lureReach * k, Math.max(1.5, d - 1.2));
    return [(dx / d) * r + Math.sin(this.time * 1.7) * 0.4, (dy / d) * r + Math.sin(this.time * 1.1) * 0.5];
  }

  private steer(dt: number, tx: number, ty: number, speed: number): void {
    const f = this.fish;
    const w = this.world;
    const lo = w.env.floorAt(f.x) + f.radius + 0.8;
    const hi = w.surfaceY - f.radius - 0.8;
    const y = lo < hi ? clamp(ty, lo, hi) : (lo + hi) / 2;
    let vx = (tx - f.x) * 1.1;
    let vy = (y - f.y) * 1.3;
    const s = Math.hypot(vx, vy);
    if (s > speed) {
      vx *= speed / s;
      vy *= speed / s;
    }
    f.vel.x = damp(f.vel.x, vx, 2.5, dt);
    f.vel.y = damp(f.vel.y, vy, 2.5, dt);
  }

  private aimAt(x: number, y: number): number {
    const f = this.fish;
    let a = Math.atan2(y - f.mouthY, x - f.mouthX);
    const right = Math.cos(a) >= 0;
    // Fold into the allowed cone about the horizontal on whichever side the player is.
    const off = right ? a : Math.atan2(Math.sin(a), -Math.cos(a));
    const c = clamp(off, -ANGLER.maxPitch, ANGLER.maxPitch);
    a = right ? c : Math.PI - c;
    return a;
  }

  private pitchFor(aim: number, facing: number): number {
    return clamp(facing > 0 ? aim : Math.atan2(Math.sin(aim), -Math.cos(aim)), -ANGLER.maxPitch, ANGLER.maxPitch);
  }

  private toStalk(): void {
    const f = this.fish;
    const p = this.world.player;
    this.enter('attack');
    this.side = f.x >= p.x ? 1 : -1;
    this.crossing = 0;
    this.snapping = 0;
    this.roared = false;
  }

  private windUp(): void {
    const p = this.world.player;
    this.enter('telegraph');
    this.aim = this.aimAt(p.x, p.y);
    this.emit('bossWarn', this.fish.mouthX, this.fish.mouthY);
  }

  private crashed(): boolean {
    const f = this.fish;
    const w = this.world;
    const mx = f.mouthX;
    const my = f.mouthY;
    // keepInside holds the mouth 0.4 off the wall, so a lunge pinned there counts as a hit.
    if (mx > this.W2 - 0.6 || mx < -this.W2 + 0.6) return true;
    if (my - f.mouthRadius * 0.4 < w.env.floorAt(mx) || f.y - f.radius * 0.75 < w.env.floorAt(f.x)) return true;
    return f.y + f.radius * 0.75 > w.surfaceY;
  }

  private crash(): void {
    const f = this.fish;
    const w = this.world;
    const mx = f.mouthX;
    const my = f.mouthY;
    f.vel.x *= -0.15;
    f.vel.y *= -0.15;
    f.flash = 1;
    f.jaw = 0;
    this.keepInside();
    w.effects.explosion(mx, my, 2.6);
    w.effects.sandPuff(mx, my, f.z + 0.4, 6, tmp.set('#5a5470'), 0.4);
    this.emit('bossCrash', mx, my);
    if (this.playing && w.player.alive) w.stat('bossDodge');
    this.lunges--;
    if (this.lunges > 0) this.enter('recover');
    else this.daze();
    // Rebound off a side wall into open water so the lure doesn't end up off-screen.
    const wall = mx > this.W2 - 0.6 ? 1 : mx < -this.W2 + 0.6 ? -1 : 0;
    if (wall) f.vel.x = -wall * ANGLER.wallRecoil;
  }

  private daze(): void {
    const f = this.fish;
    this.enter('stunned');
    this.pulseGap = 0;
    f.vel.x = f.vel.y = 0;
    this.emit('bossStun', f.mouthX, f.mouthY);
  }

  /** Small prey near the lure is drawn in and gulped; the player touching it sets off a snap. */
  private tempt(dt: number): void {
    const w = this.world;
    const p = w.player;
    const L = this.lure;
    for (const g of w.spawner.fish) {
      if (!g.alive || g.tier > 2 || g.appear < 0.5) continue;
      const dx = L.x - g.x;
      const dy = L.y - g.y;
      const d = Math.hypot(dx, dy);
      if (d > ANGLER.lurePull || d < 1e-3) continue;
      const pull = 3.2 * (1 - d / ANGLER.lurePull) + 0.6;
      g.x += (dx / d) * pull * dt;
      g.y += (dy / d) * pull * dt;
      if (d < ANGLER.lureR + g.radius + 0.25) {
        w.killFish(g, 0);
        w.effects.sparkle(L.x, L.y, tmp.set('#ffe6a0'), 8, 2, 0.25);
        if (this.gulpGap <= 0) {
          this.gulpGap = 0.6;
          this.emit('lureSnap', L.x, L.y);
        }
      }
    }
    if (this.playing && p.alive && Math.hypot(p.x - L.x, p.y - L.y) - p.radius < ANGLER.lureSnap) {
      const f = this.fish;
      this.snapping = ANGLER.snapTime;
      const dx = L.x - f.mouthX;
      const dy = L.y - f.mouthY;
      const d = Math.hypot(dx, dy) || 1;
      f.vel.x = (dx / d) * ANGLER.snapSpeed;
      f.vel.y = (dy / d) * ANGLER.snapSpeed;
      f.jaw = 0;
      this.emit('bossSnap', L.x, L.y);
    }
  }

  /** The mouth bites the player (a shield only knocks them away) while it is awake. */
  private mouthHits(): void {
    const w = this.world;
    const p = w.player;
    const f = this.fish;
    if (!this.playing || !p.alive || this.biteGap > 0) return;
    const d = Math.hypot(p.x - f.mouthX, p.y - f.mouthY) - p.radius * 0.6;
    if (d > f.mouthRadius) return;
    this.biteGap = 1;
    f.jaw = 0;
    if (p.protected) {
      w.hurtPlayer(f.mouthX, f.mouthY, 0.4, 14, 'Blocked!');
    } else {
      this.emit('bossBite', f.mouthX, f.mouthY);
      w.killPlayer(null);
    }
  }

  /** Eats every fish in its mouth while it lunges. */
  private gulp(r: number): void {
    const w = this.world;
    const f = this.fish;
    let n = 0;
    for (const g of w.spawner.fish) {
      if (!g.alive || g.appear < 0.3) continue;
      if (Math.hypot(g.x - f.mouthX, g.y - f.mouthY) - g.radius < r) {
        w.killFish(g, 0);
        n++;
      }
    }
    if (n > 0 && this.gulpGap <= 0) {
      this.gulpGap = 0.35;
      this.emit('giantChomp', f.mouthX, f.mouthY);
    }
  }

  /** Dazed: the limp lure is the weak point. */
  private lureBite(): void {
    const p = this.world.player;
    if (!this.playing || !p.alive) return;
    const L = this.lure;
    if (Math.hypot(p.mouthX - L.x, p.mouthY - L.y) > ANGLER.lureR + p.mouthRadius + 0.45) return;
    p.chomp(1);
    this.fish.flash = 1;
    this.world.effects.eatBurst(L.x, L.y, tmp.set('#ffd27a'), 2.4, 1, p.mouthX, p.mouthY);
    this.wound(1 / this.def.hitsPerPhase, L.x, L.y, 'Lure bitten!');
  }

  protected onPhase(): void {
    const w = this.world;
    const p = w.player;
    this.roared = false;
    const n = ANGLER.swarm[Math.min(this.health.phase, ANGLER.swarm.length - 1)];
    if (n > 0) w.spawner.spawnSchool('lanternfish', p.x - this.side * 9, p.y + 3, n, this.side > 0 ? 1 : -1, 2.4, 8);
  }

  private move(dt: number, facing: 1 | -1, pitch: number, roll: number): void {
    const f = this.fish;
    f.prevX = f.x;
    f.prevY = f.y;
    f.x += f.vel.x * dt;
    f.y += f.vel.y * dt;
    f.facing = facing;
    f.yaw = dampAngle(f.yaw, facing > 0 ? -FACING_TILT : -Math.PI + FACING_TILT, this.state === 'strike' ? 9 : 3.5, dt);
    f.pitch = damp(f.pitch, pitch, this.state === 'strike' || this.state === 'telegraph' ? 9 : 3, dt);
    f.roll = damp(f.roll, roll, 4, dt);
    const norm = Math.min(1.3, f.speed / 8);
    f.phase = (f.phase + dt * Math.PI * 2 * f.def.swim.freq * (0.45 + norm * 1.1)) % (Math.PI * 20);
    f.jaw = damp(f.jaw, f.jawTarget, f.jawTarget > f.jaw ? 10 : 6, dt);
    f.flash = Math.max(0, f.flash - dt * 2);
    f.alert = Math.max(0, f.alert - dt * 1.5);
  }

  private keepInside(): void {
    const f = this.fish;
    const w = this.world;
    // It swims in from beyond the trench wall.
    if (this.state === 'intro') return;
    const W2 = this.W2;
    const reachX = Math.cos(f.headingAngle) * f.len * 0.4;
    f.x = clamp(f.x, -W2 + Math.max(0.5, -reachX) + 0.4, W2 - Math.max(0.5, reachX) - 0.4);
    const lo = w.env.floorAt(f.x) + f.radius * 0.7;
    const hi = w.surfaceY - f.radius * 0.7;
    f.y = lo < hi ? clamp(f.y, lo, hi) : (lo + hi) / 2;
  }

  private moveLure(dt: number, to: [number, number] | null): void {
    const f = this.fish;
    const w = this.world;
    const [ax, ay] = this.anchor();
    const L = this.lure;
    let tx: number;
    let ty: number;
    let rate = 3.2;
    if (to) {
      tx = ax + to[0];
      ty = ay + to[1];
      if (this.state === 'strike' || this.state === 'telegraph') rate = 12;
    } else {
      // Limp: dangles below and ahead of the head, swinging.
      const gap = this.W2 - ANGLER.lureWallGap;
      tx = clamp(ax + f.facing * 1.7 + Math.sin(this.time * 1.8) * 0.35, -gap, gap);
      ty = ay - 2.3;
      rate = 2.6;
    }
    L.x = damp(L.x, tx, rate, dt);
    L.y = damp(L.y, ty, rate, dt);
    L.y = Math.max(L.y, w.env.floorAt(L.x) + 0.6);
  }

  /** The body is solid: the player is pushed off it rather than swimming through. */
  private shove(): void {
    const f = this.fish;
    const p = this.world.player;
    const h = f.headingAngle;
    const cx = Math.cos(h);
    const cy = Math.sin(h);
    const ax = f.x + cx * f.len * 0.2;
    const ay = f.y + cy * f.len * 0.2;
    const bx = f.x - cx * f.len * 0.38;
    const by = f.y - cy * f.len * 0.38;
    const r = f.radius * 0.8 + p.radius;
    const d2 = distToSegmentSq(p.x, p.y, ax, ay, bx, by);
    if (d2 >= r * r || d2 < 1e-6) return;
    // Push straight out from the body's axis.
    const t = clamp(((p.x - bx) * (ax - bx) + (p.y - by) * (ay - by)) / ((ax - bx) ** 2 + (ay - by) ** 2), 0, 1);
    const qx = bx + (ax - bx) * t;
    const qy = by + (ay - by) * t;
    const d = Math.sqrt(d2);
    const push = r - d;
    p.x += ((p.x - qx) / d) * push;
    p.y += ((p.y - qy) / d) * push;
  }

  render(alpha: number, dt: number): void {
    const f = this.fish;
    const L = this.lure;
    const fx = f.prevX + (f.x - f.prevX) * alpha;
    const fy = f.prevY + (f.y - f.prevY) * alpha;
    const [ax, ay] = this.anchor(fx, fy);
    const lx = L.px + (L.x - L.px) * alpha;
    const ly = L.py + (L.y - L.py) * alpha;
    const z = f.z + 0.15;
    const limp = this.state === 'stunned' || this.state === 'recover' || this.state === 'defeated';
    // Filament: a quadratic curve that arches up out of the head, or droops when limp.
    const cx = limp ? ax + f.facing * 1.3 : ax + (lx - ax) * 0.3;
    const cy = limp ? ay + 0.7 : Math.max(ay, ly) + 1.6;
    for (let i = 0; i < BEADS; i++) {
      const s = i / (BEADS - 1);
      const u = 1 - s;
      this.beads[i].position.set(u * u * ax + 2 * u * s * cx + s * s * lx, u * u * ay + 2 * u * s * cy + s * s * ly, z);
    }
    const weak = this.state === 'stunned';
    const pulse = 0.5 + 0.5 * Math.sin(this.time * (weak ? 7 : 2.4));
    let glow = 1;
    if (weak) glow = 1.6 + pulse * 1.1;
    else if (this.state === 'telegraph' || this.state === 'strike') glow = 0.45;
    else if (this.state === 'defeated') glow = Math.max(0, 1 - this.t / 2);
    else if (this.state === 'hurt') glow = 0.3;
    this.lureGlow += (glow - this.lureGlow) * Math.min(1, dt * 8);
    const g = this.lureGlow;
    this.bulb.position.set(lx, ly, z + 0.05);
    this.bulb.scale.setScalar(1 + (weak ? pulse * 0.35 : 0));
    this.bulbMat.color.setRGB(1.2 * g, 1.05 * g, 0.7 * g);
    this.halo.position.set(lx, ly, z + 0.1);
    this.halo.scale.setScalar(4 + g * 2.2);
    this.haloMat.uniforms.uIntensity.value = 0.9 * g;
    this.light.position.set(lx, ly, z + 1.5);
    this.light.intensity = 6 * g;

    const tele = this.state === 'telegraph';
    this.streak.visible = tele;
    if (tele) {
      const dur = ANGLER.telegraph[this.ph];
      const k = smoothstep(0, dur * 0.8, this.t);
      const locked = this.t > dur - ANGLER.lock;
      const mx = fx + Math.cos(f.headingAngle) * f.len * 0.4;
      const my = fy + Math.sin(f.headingAngle) * f.len * 0.4;
      this.streak.position.set(mx, my, f.z + 0.6);
      this.streak.rotation.set(0, 0, this.aim);
      this.streak.scale.set(30, f.mouthRadius * (locked ? 1.7 : 2.3), 1);
      this.streakMat.uniforms.uIntensity.value = (locked ? 1.5 : 0.25 + 0.75 * k) * (0.85 + 0.15 * Math.sin(this.time * 30));
    }
  }

  draw(drawer: FishDrawer, alpha: number, dt: number): void {
    const f = this.fish;
    drawer.draw(f, alpha);
    if (dt <= 0) return;
    const w = this.world;
    const h = f.headingAngle;
    const tx = f.x - Math.cos(h) * f.len * 0.45;
    const ty = f.y - Math.sin(h) * f.len * 0.45;
    if (this.state === 'strike') w.effects.trail(tx, ty, f.z, 3, dt, 0.25);
    if (this.state === 'stunned' && Math.random() < dt * 10) {
      // Dazed: little sparks circling over its head.
      const [ax, ay] = this.anchor();
      const a = this.time * 4 + Math.random() * 0.5;
      w.effects.mote('glow', ax + Math.cos(a) * 1.6, ay + 0.8 + Math.sin(a) * 0.5, f.z + 0.5, 0, 0.3, 0.5, 0.35, 0.05, tmp.set('#fff2b0'), 1, 0, 0.9);
    }
  }
}
