import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  type MeshBasicMaterial,
  type ShaderMaterial,
} from 'three';
import type { BossDef } from '../../config/levels';
import { clamp, damp, lerp, smoothstep } from '../../engine/math';
import { patchMaterial } from '../../engine/materialPatches';
import { paint } from '../../env/props/shapes';
import { glowMaterial, ribbonGeometry, ribbonMaterial, softGlowMaterial } from '../features/art';
import type { World } from '../World';
import { BossBase } from './BossBase';

export const KRAKEN = {
  /** Body centre, as a share of the half width (right of centre, away from the player's start). */
  centre: 0.12,
  /** Tentacle roots relative to the body centre. */
  roots: [-16, -7, 7, 16],
  /** Seconds between slams, by phase. */
  gap: [2.7, 2.2, 1.75],
  /** From the second phase on, a second tentacle slams beside the first. */
  doubleFrom: 1,
  /** Second lane offset from the first. */
  doubleOffset: 7,
  /** The tentacle rears over its lane for this long before it slams. */
  raise: [1.35, 1.15, 1],
  slam: 0.22,
  /** Half width of a marked lane. */
  laneHalf: 2.1,
  /** Seconds a slammed tip stays pinned to the seabed, open to a bite. */
  pinned: [2.9, 2.5, 2.2],
  recoil: 0.8,
  /** Seconds the eye stays open once every tentacle of the phase has been bitten. */
  eye: [6, 5.5, 5],
  eyeR: 1.3,
  /** Share of a phase the bitten tips take; the eye takes the rest. */
  tipsShare: 0.6,
  intro: 3.4,
  phaseUp: 3,
  /** Last phase: ink clouds every few seconds that leave only a small circle of sight. */
  ink: { every: [10, 14] as const, dur: 5, dark: 0.82, radius: 7 },
};

const SEGS = 22;
const RADIAL = 10;
const TIP_R = 0.6;

type TentState = 'idle' | 'raise' | 'slam' | 'pinned' | 'recoil' | 'limp';

interface Tentacle {
  i: number;
  rx: number;
  ry: number;
  /** Which way is outward from the body. */
  out: 1 | -1;
  state: TentState;
  t: number;
  lane: number;
  bitten: boolean;
  struck: boolean;
  pts: Float32Array;
  goal: Float32Array;
  geo: BufferGeometry;
  pos: BufferAttribute;
  tip: Mesh;
  tipMat: MeshBasicMaterial;
  halo: Mesh;
  haloMat: ShaderMaterial;
  laneMesh: Mesh;
  laneMat: ShaderMaterial;
  glow: number;
}

const SKIN = new Color('#8a2340');
const SKIN_DARK = new Color('#3c0e22');
const SUCKER = new Color('#f2b6a8');
const tmp = new Color();

/** An open tube of `SEGS + 1` rings; positions are rewritten every frame from the centreline. */
function tubeGeometry(): BufferGeometry {
  const rings = SEGS + 1;
  const g = new BufferGeometry();
  const pos = new BufferAttribute(new Float32Array(rings * RADIAL * 3), 3);
  pos.setUsage(DynamicDrawUsage);
  const col = new Float32Array(rings * RADIAL * 3);
  const idx: number[] = [];
  for (let r = 0; r < rings; r++) {
    const s = r / (rings - 1);
    for (let k = 0; k < RADIAL; k++) {
      const a = (k / RADIAL) * Math.PI * 2;
      // Suckers along the underside (the -normal side), on every other ring.
      const under = Math.cos(a) < -0.55 && r % 2 === 0 && s > 0.15;
      tmp.copy(SKIN_DARK).lerp(SKIN, smoothstep(-0.6, 0.8, Math.cos(a)) * 0.8 + s * 0.2);
      if (under) tmp.lerp(SUCKER, 0.7);
      tmp.toArray(col, (r * RADIAL + k) * 3);
      if (r < rings - 1) {
        const a0 = r * RADIAL + k;
        const b0 = r * RADIAL + ((k + 1) % RADIAL);
        idx.push(a0, b0, a0 + RADIAL, b0, b0 + RADIAL, a0 + RADIAL);
      }
    }
  }
  g.setAttribute('position', pos);
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Ocean II's boss, sunk into the Sunken City's seabed. Its tentacles rear over a marked lane and
 * slam down; a slammed tip stays pinned for a moment and can be bitten. Once enough tips are
 * bitten the great eye opens: bite it to break the phase. In the last phase it clouds the water with ink.
 */
export class Kraken extends BossBase {
  private readonly cx: number;
  private readonly tentacles: Tentacle[] = [];
  private readonly mantle: Mesh;
  private readonly eye: Mesh;
  private readonly pupil: Mesh;
  private readonly eyeMat: MeshStandardMaterial;
  private readonly eyeHalo: Mesh;
  private readonly eyeHaloMat: ShaderMaterial;
  /** 0: sunk to its eye in the seabed, 1: risen with the eye exposed. */
  private rise = 0;
  private emerge = 0;
  private eyeOpen = 0;
  private slamTimer = 1.5;
  private inkTimer: number;
  private ink = 0;
  private inkAmount = 0;
  private roared = false;
  private readonly normal = new Float32Array((SEGS + 1) * 2);

  constructor(world: World, def: BossDef) {
    super(world, def);
    const W2 = world.level.world.width / 2;
    this.cx = W2 * KRAKEN.centre;
    this.inkTimer = this.rng.range(KRAKEN.ink.every[0], KRAKEN.ink.every[1]);

    const skin = this.track(patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.42, side: DoubleSide }), { caustics: true }));
    const mantleGeo = this.track(new SphereGeometry(5.2, 32, 20));
    mantleGeo.scale(1.35, 0.95, 0.85);
    const spots: [number, number, number][] = Array.from({ length: 30 }, () => [this.rng.range(-7, 7), this.rng.range(-1, 5), this.rng.range(0.5, 1.2)]);
    paint(mantleGeo, (x, y, z, c) => {
      c.copy(SKIN_DARK).lerp(SKIN, smoothstep(-3, 4, y) * 0.9);
      for (const [sx, sy, sr] of spots) if ((x - sx) ** 2 + (y - sy) ** 2 < sr * sr && z > 0) c.multiplyScalar(0.6);
    });
    this.mantle = new Mesh(mantleGeo, skin);
    this.mantle.castShadow = true;
    this.eyeMat = this.track(patchMaterial(new MeshStandardMaterial({ color: '#f4d860', emissive: '#ffb020', emissiveIntensity: 0.6, roughness: 0.2 }), {}));
    this.eye = new Mesh(this.track(new SphereGeometry(KRAKEN.eyeR, 24, 16)), this.eyeMat);
    this.pupil = new Mesh(this.track(new SphereGeometry(1, 16, 10)), this.track(patchMaterial(new MeshStandardMaterial({ color: '#08040a', roughness: 0.1 }))));
    this.pupil.scale.set(KRAKEN.eyeR * 0.75, KRAKEN.eyeR * 0.2, KRAKEN.eyeR * 0.3);
    this.eyeHaloMat = this.track(softGlowMaterial('#ffd84a'));
    this.eyeHalo = new Mesh(this.track(new PlaneGeometry(1, 1)), this.eyeHaloMat);
    this.eyeHalo.renderOrder = 6;
    this.group.add(this.mantle, this.eye, this.pupil, this.eyeHalo);

    const tipGeo = this.track(new SphereGeometry(TIP_R, 12, 8));
    const plane = this.track(new PlaneGeometry(1, 1));
    const lane = this.track(ribbonGeometry());
    KRAKEN.roots.forEach((dx, i) => {
      const rx = this.cx + dx;
      const geo = this.track(tubeGeometry());
      const mesh = new Mesh(geo, skin);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      const tipMat = this.track(glowMaterial('#ffd36a'));
      const tip = new Mesh(tipGeo, tipMat);
      const haloMat = this.track(softGlowMaterial('#ffcf5a'));
      const halo = new Mesh(plane, haloMat);
      halo.renderOrder = 6;
      const laneMat = this.track(ribbonMaterial({ color: '#ff3a4a', scroll: -1.6, streaks: 3, streakAmount: 0.45, soft: 1.3, fadeIn: 0.04, fadeOut: 0.12 }));
      const laneMesh = new Mesh(lane, laneMat);
      laneMesh.renderOrder = 5;
      laneMesh.rotation.z = Math.PI / 2;
      laneMesh.visible = false;
      this.group.add(mesh, tip, halo, laneMesh);
      const ry = world.env.floorAt(rx) - 0.6;
      const pts = new Float32Array((SEGS + 1) * 2);
      for (let k = 0; k <= SEGS; k++) {
        pts[k * 2] = rx;
        pts[k * 2 + 1] = ry - 1;
      }
      this.tentacles.push({
        i,
        rx,
        ry,
        out: dx < 0 ? -1 : 1,
        state: 'idle',
        t: 0,
        lane: rx,
        bitten: false,
        struck: false,
        pts,
        goal: new Float32Array(pts),
        geo,
        pos: geo.getAttribute('position') as BufferAttribute,
        tip,
        tipMat,
        halo,
        haloMat,
        laneMesh,
        laneMat,
        glow: 0,
      });
    });
  }

  private get ph(): number {
    return Math.min(this.health.phase, 2);
  }

  private get floorY(): number {
    return this.world.env.floorAt(this.cx);
  }

  private get eyeX(): number {
    return this.cx;
  }

  private get eyeY(): number {
    return this.floorY + 1.7 + this.rise * 2.8 - Math.max(0, -this.rise) * 2;
  }

  get exposed(): boolean {
    return this.state === 'stunned' || this.tentacles.some((tn) => tn.state === 'pinned' && !tn.bitten);
  }

  get danger(): number {
    const p = this.world.player;
    if (!p.alive || this.state === 'defeated') return 0;
    if (this.state === 'stunned') return 0.3;
    let d = 0.55;
    for (const tn of this.tentacles) {
      if ((tn.state === 'raise' || tn.state === 'slam') && Math.abs(p.x - tn.lane) < KRAKEN.laneHalf + 4) d = Math.max(d, 1);
    }
    return d;
  }

  threatAt(x: number, y: number): number {
    for (const tn of this.tentacles) {
      if ((tn.state === 'raise' || tn.state === 'slam') && Math.abs(x - tn.lane) < KRAKEN.laneHalf + 2) return 1;
    }
    return Math.hypot(x - this.cx, y - this.floorY) < 8 ? 1 : 0;
  }

  stun(): void {
    if (this.state !== 'attack') return;
    for (const tn of this.tentacles) tn.bitten = true;
    this.openEye();
  }

  private get bittenCount(): number {
    return this.tentacles.reduce((a, tn) => a + (tn.bitten ? 1 : 0), 0);
  }

  private get tipShare(): number {
    return KRAKEN.tipsShare / this.def.hitsPerPhase;
  }

  update(dt: number): void {
    super.update(dt);
    const w = this.world;
    const ph = this.ph;
    let riseTo = 0;
    let eyeTo = 0.3;
    switch (this.state) {
      case 'intro': {
        this.emerge = w.started ? smoothstep(0, KRAKEN.intro * 0.8, this.t) : 0;
        eyeTo = this.t > KRAKEN.intro * 0.45 ? 1 : 0;
        if (!this.roared && this.t > KRAKEN.intro * 0.45) {
          this.roared = true;
          this.emit('bossRoar', this.eyeX, this.eyeY);
        }
        if (this.t >= KRAKEN.intro) {
          this.enter('attack');
          this.roared = false;
          this.slamTimer = 0.8;
        }
        break;
      }
      case 'attack': {
        this.emerge = 1;
        eyeTo = this.tentacles.some((tn) => tn.state === 'raise') ? 0.75 : 0.35;
        this.slamTimer -= dt;
        if (this.slamTimer <= 0 && this.playing) this.slamTimer = this.pickSlam(ph) ? KRAKEN.gap[ph] : 0.3;
        if (ph >= 2 && this.playing) {
          this.inkTimer -= dt;
          if (this.inkTimer <= 0) {
            this.inkTimer = this.rng.range(KRAKEN.ink.every[0], KRAKEN.ink.every[1]);
            this.ink = KRAKEN.ink.dur;
            this.squirt();
          }
        }
        break;
      }
      case 'stunned': {
        riseTo = 1;
        eyeTo = 1;
        this.eyeBite();
        if (this.state === 'stunned' && this.t >= KRAKEN.eye[ph]) this.closeEye();
        break;
      }
      case 'phaseUp': {
        riseTo = this.t < 1.2 ? 1 : 0;
        eyeTo = 1;
        if (!this.roared && this.t > 0.5) {
          this.roared = true;
          this.emit('bossRoar', this.eyeX, this.eyeY);
        }
        if (this.t >= KRAKEN.phaseUp) {
          this.enter('attack');
          this.roared = false;
          this.slamTimer = 1;
        }
        break;
      }
      case 'defeated': {
        riseTo = -1.6;
        eyeTo = 0;
        this.ink = 0;
        if (Math.random() < dt * 16) {
          w.effects.bubbleBurst(this.cx + this.rng.range(-6, 6), this.floorY + this.rng.range(0, 3), -1, 4, 0.22, 0.8, 1.6);
        }
        break;
      }
      default:
        break;
    }
    this.rise = damp(this.rise, riseTo, this.state === 'defeated' ? 0.8 : 2.5, dt);
    this.eyeOpen = damp(this.eyeOpen, eyeTo, 5, dt);
    this.ink = Math.max(0, this.ink - dt);
    // Floods in quickly and clears over the last second.
    this.inkAmount = damp(this.inkAmount, Math.min(1, this.ink), this.ink > 1 ? 3 : 1.5, dt);
    for (const tn of this.tentacles) this.updateTentacle(tn, dt, ph);
    this.shove();
  }

  /** Rears the tentacle nearest the player over the player's lane (and a second one later on). */
  private pickSlam(ph: number): boolean {
    const p = this.world.player;
    if (!p.alive) return false;
    const W2 = this.world.level.world.width / 2;
    const free = this.tentacles.filter((tn) => tn.state === 'idle' && !tn.bitten);
    if (free.length === 0) return false;
    const lane = clamp(p.x + p.vel.x * 0.35, -W2 + 2, W2 - 2);
    const first = this.nearest(free, lane);
    this.raise(first, lane);
    if (ph >= KRAKEN.doubleFrom) {
      const rest = free.filter((tn) => tn !== first);
      if (rest.length > 0) {
        let lane2 = lane + this.rng.sign() * KRAKEN.doubleOffset;
        if (lane2 < -W2 + 2 || lane2 > W2 - 2) lane2 = lane * 2 - lane2;
        this.raise(this.nearest(rest, lane2), lane2);
      }
    }
    return true;
  }

  private nearest(list: Tentacle[], x: number): Tentacle {
    let best = list[0];
    for (const tn of list) if (Math.abs(tn.rx - x) < Math.abs(best.rx - x)) best = tn;
    return best;
  }

  private raise(tn: Tentacle, lane: number): void {
    tn.state = 'raise';
    tn.t = 0;
    tn.lane = lane;
    tn.struck = false;
    this.emit('bossWarn', lane, this.world.surfaceY - 3);
  }

  private updateTentacle(tn: Tentacle, dt: number, ph: number): void {
    const w = this.world;
    const p = w.player;
    if (w.started) tn.t += dt;
    const boss = this.state;
    // The whole creature goes limp while the eye is open or it is beaten; it rears up on a phase change.
    if ((boss === 'stunned' || boss === 'defeated') && tn.state !== 'limp' && tn.state !== 'recoil') {
      tn.state = 'recoil';
      tn.t = 0;
    } else if ((boss === 'phaseUp' || boss === 'intro') && tn.state !== 'idle') {
      tn.state = 'idle';
      tn.t = 0;
    }
    let rate = 4;
    switch (tn.state) {
      case 'idle':
        this.idlePose(tn, tn.goal);
        rate = boss === 'intro' ? 2.5 : 3;
        break;
      case 'raise':
        this.raisePose(tn, tn.goal);
        rate = 5;
        if (tn.t >= KRAKEN.raise[ph]) {
          tn.state = 'slam';
          tn.t = 0;
          this.emit('bossSwing', tn.lane, w.surfaceY - 4);
        }
        break;
      case 'slam': {
        this.pinPose(tn, tn.goal);
        rate = 26;
        const tipY = tn.pts[SEGS * 2 + 1];
        const inLane = (x: number, r: number) => Math.abs(x - tn.lane) < KRAKEN.laneHalf + r;
        if (!tn.struck && this.playing && p.alive && inLane(p.x, p.radius * 0.5) && tipY <= p.y + 1.6) {
          tn.struck = true;
          if (p.protected) w.hurtPlayer(tn.lane, p.y + 2, 0.5, 14, 'Blocked!');
          else {
            this.emit('bossBite', p.x, p.y);
            w.killPlayer(null);
          }
        }
        for (const g of w.spawner.fish) {
          if (g.alive && g.appear > 0.3 && inLane(g.x, g.radius) && tipY <= g.y + 1) w.killFish(g, 0);
        }
        if (tn.t >= KRAKEN.slam) {
          tn.state = 'pinned';
          tn.t = 0;
          const fy = w.env.floorAt(tn.lane);
          w.effects.sandPuff(tn.lane, fy, 0.4, 7, tmp.set('#8a7a60'), 0.4);
          w.effects.bubbleBurst(tn.lane, fy + 0.5, 0.3, 30, 0.2, 1.4, 3.5);
          w.effects.ring(tn.lane, fy + 0.5, tmp.set('#ffe0b0'), 6, 0.5, 0.14);
          this.emit('bossSlam', tn.lane, fy);
          if (!tn.struck && this.playing && p.alive && Math.abs(p.x - tn.lane) < 10) w.stat('bossDodge');
        }
        break;
      }
      case 'pinned':
        this.pinPose(tn, tn.goal);
        rate = 20;
        if (!tn.bitten) this.tipBite(tn);
        if (tn.state === 'pinned' && tn.t >= KRAKEN.pinned[ph]) {
          tn.state = 'recoil';
          tn.t = 0;
        }
        break;
      case 'recoil':
        if (tn.bitten || boss === 'stunned' || boss === 'defeated') this.limpPose(tn, tn.goal);
        else this.idlePose(tn, tn.goal);
        rate = tn.bitten ? 7 : 4;
        if (tn.t >= KRAKEN.recoil) {
          tn.state = tn.bitten || boss === 'stunned' || boss === 'defeated' ? 'limp' : 'idle';
          tn.t = 0;
        }
        break;
      case 'limp':
        this.limpPose(tn, tn.goal);
        rate = 2.5;
        if (!tn.bitten && boss === 'attack') {
          tn.state = 'idle';
          tn.t = 0;
        }
        break;
    }
    const k = 1 - Math.exp(-rate * dt);
    for (let i = 0; i < tn.pts.length; i++) tn.pts[i] += (tn.goal[i] - tn.pts[i]) * k;
    // The root never moves.
    tn.pts[0] = tn.rx;
    tn.pts[1] = tn.ry;
  }

  private tipBite(tn: Tentacle): void {
    const p = this.world.player;
    if (!this.playing || !p.alive) return;
    const tx = tn.pts[SEGS * 2];
    const ty = tn.pts[SEGS * 2 + 1];
    if (Math.hypot(p.mouthX - tx, p.mouthY - ty) > TIP_R + p.mouthRadius + 0.45) return;
    p.chomp(1);
    this.world.effects.eatBurst(tx, ty, tmp.set('#ff8aa0'), 2.2, 1, p.mouthX, p.mouthY);
    const r = this.wound(this.tipShare, tx, ty, 'Tentacle bitten!');
    if (r === 'none') return;
    tn.bitten = true;
    tn.state = 'recoil';
    tn.t = 0;
    if (r === 'hit' && this.bittenCount >= this.def.hitsPerPhase) this.openEye();
  }

  private openEye(): void {
    this.enter('stunned');
    this.ink = 0;
    this.emit('bossStun', this.eyeX, this.eyeY);
  }

  private closeEye(): void {
    // One tentacle grows back, so the eye needs one more tip to open again.
    const back = this.tentacles.find((tn) => tn.bitten);
    if (back) back.bitten = false;
    this.health.dealt = Math.max(0, this.health.dealt - this.tipShare);
    this.enter('attack');
    this.slamTimer = 0.6;
    this.emit('bossRecover', this.eyeX, this.eyeY);
  }

  private eyeBite(): void {
    const p = this.world.player;
    if (!this.playing || !p.alive || this.eyeOpen < 0.6) return;
    if (Math.hypot(p.mouthX - this.eyeX, p.mouthY - this.eyeY) > KRAKEN.eyeR + p.mouthRadius + 0.5) return;
    p.chomp(1);
    this.world.effects.eatBurst(this.eyeX, this.eyeY, tmp.set('#ffe070'), 3.2, 1, p.mouthX, p.mouthY);
    this.wound(1 - this.health.dealt, this.eyeX, this.eyeY, 'Right in the eye!');
  }

  protected onHit(): void {}

  protected onPhase(): void {
    this.roared = false;
    this.ink = 0;
    for (const tn of this.tentacles) tn.bitten = false;
  }

  private squirt(): void {
    const w = this.world;
    const x = this.eyeX;
    const y = this.eyeY + 1;
    this.emit('bossInk', x, y);
    for (let i = 0; i < 70; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const v = this.rng.range(1, 7);
      w.effects.mote('dot', x, y, 0.2, Math.cos(a) * v, Math.sin(a) * v * 0.7 + 1, this.rng.range(3, 5.5), this.rng.range(1.5, 2.5), this.rng.range(4, 7), tmp.set('#170a1f'), 0.7, 0.1, 0.65);
    }
  }

  /** The mantle is solid. */
  private shove(): void {
    const p = this.world.player;
    if (!p.alive) return;
    const cy = this.floorY - 1.4 + this.rise * 2.8;
    const rx = 5.2 * 1.35;
    const ry = 5.2 * 0.95;
    const dx = (p.x - this.cx) / rx;
    const dy = (p.y - cy) / ry;
    const d = Math.hypot(dx, dy);
    const lim = 1 + p.radius / ry;
    if (d >= lim || d < 1e-4) return;
    p.x = this.cx + (dx / d) * lim * rx;
    p.y = cy + (dy / d) * lim * ry;
  }

  // -------------------------------------------------------------- poses

  private bezier(out: Float32Array, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
    for (let i = 0; i <= SEGS; i++) {
      const s = i / SEGS;
      const u = 1 - s;
      const b0 = u * u * u;
      const b1 = 3 * u * u * s;
      const b2 = 3 * u * s * s;
      const b3 = s * s * s;
      out[i * 2] = b0 * x0 + b1 * x1 + b2 * x2 + b3 * x3;
      out[i * 2 + 1] = b0 * y0 + b1 * y1 + b2 * y2 + b3 * y3;
    }
  }

  private idlePose(tn: Tentacle, out: Float32Array): void {
    const e = this.emerge;
    const sway = Math.sin(this.time * 0.8 + tn.i * 1.7);
    const tx = tn.rx + tn.out * (3 + sway * 2);
    const ty = tn.ry + (8 + Math.sin(this.time * 1.1 + tn.i) * 1.2) * e;
    this.bezier(out, tn.rx, tn.ry, tn.rx + tn.out * 0.4, tn.ry + 4 * e, tx + tn.out * 3, ty + 1.2 * e, tx, ty);
  }

  private raisePose(tn: Tentacle, out: Float32Array): void {
    const top = this.world.surfaceY - 1.6;
    const d = Math.sign(tn.lane - tn.rx) || tn.out;
    const shake = Math.sin(this.time * 23 + tn.i) * 0.25 * smoothstep(0.5, 1, tn.t / KRAKEN.raise[this.ph]);
    this.bezier(out, tn.rx, tn.ry, tn.rx, tn.ry + (top - tn.ry) * 0.7, tn.lane - d * 5, top + 2, tn.lane + shake, top - 2.6);
  }

  private pinPose(tn: Tentacle, out: Float32Array): void {
    const fl = this.world.env.floorAt(tn.lane) + 0.45;
    const d = Math.sign(tn.lane - tn.rx) || tn.out;
    const span = Math.abs(tn.lane - tn.rx);
    this.bezier(out, tn.rx, tn.ry, tn.rx + d * 1.5, tn.ry + 4, tn.lane - d * Math.min(6, span * 0.5), fl + 2.2, tn.lane, fl);
  }

  private limpPose(tn: Tentacle, out: Float32Array): void {
    const sink = this.state === 'defeated' ? Math.min(3, this.t * 1.2) : 0;
    const d = tn.out;
    const ex = tn.rx + d * 6.5;
    const fl = this.world.env.floorAt(ex) + 0.35 - sink;
    const wob = Math.sin(this.time * 1.3 + tn.i) * 0.3;
    this.bezier(out, tn.rx, tn.ry - sink, tn.rx + d, tn.ry + 2.2 - sink, ex - d * 2, fl + 1.6 + wob, ex, fl);
  }

  // -------------------------------------------------------------- render

  render(_alpha: number, dt: number): void {
    const w = this.world;
    const z = -0.6;
    const bodyY = this.floorY - 1.4 + this.rise * 2.8;
    this.mantle.position.set(this.cx, bodyY, -5.2);
    this.mantle.rotation.z = Math.sin(this.time * 0.5) * 0.03;
    const s = 1 + Math.sin(this.time * 1.6) * 0.015;
    this.mantle.scale.set(s, 1 / s, 1);
    const ex = this.eyeX;
    const ey = this.eyeY;
    const open = Math.max(0.06, this.eyeOpen);
    this.eye.position.set(ex, ey, -0.9);
    this.eye.scale.set(1, open, 1);
    this.pupil.position.set(ex, ey, -0.9 + KRAKEN.eyeR * 0.82);
    this.pupil.visible = open > 0.25;
    this.pupil.scale.y = KRAKEN.eyeR * (this.state === 'stunned' ? 0.42 : 0.2) * open;
    const weak = this.state === 'stunned';
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 7);
    const angry = this.tentacles.some((tn) => tn.state === 'raise') || this.state === 'phaseUp';
    this.eyeMat.emissive.set(angry ? '#ff3020' : '#ffb020');
    this.eyeMat.emissiveIntensity = weak ? 1.2 + pulse * 1.4 : angry ? 1.4 : 0.6;
    this.eyeHalo.position.set(ex, ey, -0.4);
    this.eyeHalo.scale.setScalar(weak ? 7 + pulse * 2 : 4);
    this.eyeHaloMat.uniforms.uIntensity.value = (weak ? 1.1 + pulse * 0.6 : 0.25) * open;

    const ph = this.ph;
    for (const tn of this.tentacles) {
      this.writeTube(tn, z + tn.i * 0.05);
      const tx = tn.pts[SEGS * 2];
      const ty = tn.pts[SEGS * 2 + 1];
      const pinned = tn.state === 'pinned' && !tn.bitten;
      let glow = 0.35;
      if (pinned) glow = 1.4 + pulse * 1.2;
      else if (tn.state === 'raise' || tn.state === 'slam') glow = 0.9;
      else if (tn.bitten || tn.state === 'limp') glow = 0.05;
      tn.glow += (glow - tn.glow) * Math.min(1, dt * 10);
      const red = tn.state === 'raise' || tn.state === 'slam';
      tn.tipMat.color.set(red ? '#ff5040' : '#ffd36a').multiplyScalar(tn.glow);
      tn.tip.position.set(tx, ty, z + 0.2);
      tn.tip.scale.setScalar(pinned ? 1 + pulse * 0.3 : 0.75);
      tn.halo.position.set(tx, ty, z + 0.3);
      tn.halo.scale.setScalar(pinned ? 5 + pulse * 1.5 : 3);
      tn.haloMat.uniforms.uIntensity.value = pinned ? 1 : tn.glow * 0.4;
      if (pinned && dt > 0 && Math.random() < dt * 3) w.effects.ring(tx, ty, tmp.set('#ffd36a'), 2.4, 0.45, 0.15);

      const warn = tn.state === 'raise' || (tn.state === 'slam' && tn.t < KRAKEN.slam + 0.1) || (tn.state === 'pinned' && tn.t < 0.25);
      tn.laneMesh.visible = warn;
      if (warn) {
        const fl = w.env.floorAt(tn.lane);
        tn.laneMesh.position.set(tn.lane, fl, 0.2);
        tn.laneMesh.scale.set(w.surfaceY - fl, KRAKEN.laneHalf * 2, 1);
        const k = tn.state === 'raise' ? smoothstep(0, KRAKEN.raise[ph], tn.t) : 1;
        const flicker = tn.state === 'raise' && k > 0.7 ? 0.75 + 0.25 * Math.sin(this.time * 40) : 1;
        tn.laneMat.uniforms.uIntensity.value = tn.state === 'raise' ? (0.12 + 0.5 * k) * flicker : tn.state === 'slam' ? 1.2 : 0.6 * (1 - tn.t / 0.25);
      }
    }

    w.vision.dark = this.inkAmount * KRAKEN.ink.dark;
    w.vision.radius = KRAKEN.ink.radius;
  }

  /** Rebuilds a tentacle's rings around its centreline, tapering to the tip. */
  private writeTube(tn: Tentacle, z: number): void {
    const P = tn.pts;
    const N = this.normal;
    for (let i = 0; i <= SEGS; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(SEGS, i + 1);
      const tx = P[b * 2] - P[a * 2];
      const ty = P[b * 2 + 1] - P[a * 2 + 1];
      const l = Math.hypot(tx, ty) || 1;
      N[i * 2] = -ty / l;
      N[i * 2 + 1] = tx / l;
    }
    const arr = tn.pos.array as Float32Array;
    for (let i = 0; i <= SEGS; i++) {
      const s = i / SEGS;
      const r = lerp(0.95, 0.14, Math.pow(s, 0.85));
      const cx = P[i * 2];
      const cy = P[i * 2 + 1];
      const nx = N[i * 2];
      const ny = N[i * 2 + 1];
      for (let k = 0; k < RADIAL; k++) {
        const ang = (k / RADIAL) * Math.PI * 2;
        const c = Math.cos(ang) * r;
        const sn = Math.sin(ang) * r;
        const o = (i * RADIAL + k) * 3;
        arr[o] = cx + nx * c;
        arr[o + 1] = cy + ny * c;
        arr[o + 2] = z + sn;
      }
    }
    tn.pos.needsUpdate = true;
    tn.geo.computeVertexNormals();
  }
}
