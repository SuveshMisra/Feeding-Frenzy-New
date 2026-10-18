import { Mesh, MeshStandardMaterial, PlaneGeometry, SphereGeometry, type MeshBasicMaterial, type ShaderMaterial } from 'three';
import { patchMaterial } from '../../engine/materialPatches';
import { smoothstep } from '../../engine/math';
import { statueHeadGeometry } from '../../env/props/ruins';
import { FeatureBase } from './FeatureBase';
import { glowMaterial, ribbonGeometry, ribbonMaterial, softGlowMaterial } from './art';
import { beamHits, spreadSlots } from './helpers';

export const GUARD = {
  heads: 4,
  scale: 1.2,
  idle: [6, 10] as const,
  warn: 1.5,
  beam: 2.5,
  length: 17,
  halfWidth: 0.85,
  /** Sweep arc in radians, measured from +x. */
  arc: [0.4, Math.PI - 0.4] as const,
  stun: 1.3,
  knock: 7,
  /** A waking head also wakes its nearest neighbour; they sweep in opposite directions. */
  pairs: false,
  /** Heads within this distance count as neighbours. */
  pairReach: 40,
  /** After a sweep, the beam swings straight back the other way. */
  sweepBack: false,
};

type GuardState = 'idle' | 'warn' | 'beam';

/** Index of the candidate x nearest to `x` within `reach` (null entries are skipped), or -1. */
export function nearestPartner(xs: readonly (number | null)[], x: number, reach: number): number {
  let best = -1;
  let bestD = reach;
  xs.forEach((cx, i) => {
    if (cx === null) return;
    const d = Math.abs(cx - x);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

interface Guardian {
  x: number;
  /** Beam origin (between the eyes). */
  ox: number;
  oy: number;
  state: GuardState;
  t: number;
  idle: number;
  from: number;
  to: number;
  angle: number;
  power: number;
  hitPlayer: boolean;
  /** On the return sweep. */
  back: boolean;
  beam: Mesh;
  beamMat: ShaderMaterial;
  eyeMat: MeshBasicMaterial;
  flare: Mesh;
  flareMat: ShaderMaterial;
}

/** Sunken City: stone heads wake up, glare, then sweep a beam that stuns the player and kills fish. */
export class GuardiansFeature extends FeatureBase {
  private readonly cfg = this.opts(GUARD);
  private heads: Guardian[] = [];

  build(): void {
    const w = this.world;
    const lvl = w.level;
    const s = this.cfg.scale;
    const headGeo = this.track(statueHeadGeometry(lvl.seed + 500));
    const stone = this.track(patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, color: '#b8c4b8' }), { caustics: true }));
    const beamGeo = this.track(ribbonGeometry(24));
    const eyeGeo = this.track(new SphereGeometry(0.1, 10, 8));
    const flareGeo = this.track(new PlaneGeometry(1, 1));
    const xs = spreadSlots(this.cfg.heads, lvl.world.width, 16, () => this.rng.next(), { x: this.startX, gap: 14 });
    xs.forEach((x) => {
      const floor = w.env.floorAt(x);
      const head = new Mesh(headGeo, stone);
      const y = floor + 0.55 * s;
      head.position.set(x, y, -1.5);
      head.scale.setScalar(s);
      head.rotation.set(-0.12, this.rng.range(-0.15, 0.15), this.rng.range(-0.08, 0.08));
      head.castShadow = true;
      head.receiveShadow = true;
      const eyeMat = this.track(glowMaterial('#000000'));
      for (const side of [-1, 1]) {
        const eye = new Mesh(eyeGeo, eyeMat);
        eye.position.set(side * 0.22, 0.16, 0.72);
        head.add(eye);
      }
      const beamMat = this.track(ribbonMaterial({ color: '#9ffff0', scroll: 1.4, streaks: 5, streakAmount: 0.3, soft: 0.8, fadeIn: 0.02, fadeOut: 0.4 }));
      const beam = new Mesh(beamGeo, beamMat);
      const oy = y + 0.16 * s;
      beam.position.set(x, oy, 0.2);
      beam.scale.set(this.cfg.length, this.cfg.halfWidth * 2.6, 1);
      beam.renderOrder = 6;
      beam.frustumCulled = false;
      beam.visible = false;
      const flareMat = this.track(softGlowMaterial('#8ffff0'));
      const flare = new Mesh(flareGeo, flareMat);
      flare.position.set(x, oy, 0.3);
      flare.renderOrder = 6;
      this.group.add(head, beam, flare);
      this.heads.push({
        x,
        ox: x,
        oy,
        state: 'idle',
        t: 0,
        idle: this.rng.range(2, this.cfg.idle[1]),
        from: 0,
        to: 0,
        angle: Math.PI / 2,
        power: 0,
        hitPlayer: false,
        back: false,
        beam,
        beamMat,
        eyeMat,
        flare,
        flareMat,
      });
    });
  }

  update(dt: number): void {
    super.update(dt);
    const w = this.world;
    for (const g of this.heads) {
      g.t += dt;
      const near = this.near(g.x, 0.9);
      switch (g.state) {
        case 'idle':
          if (this.dormant) g.t = 0;
          else if (g.t >= g.idle && near) {
            const left = this.rng.chance(0.5);
            this.wake(g, left);
            if (this.cfg.pairs) {
              const mate = this.partner(g);
              if (mate) this.wake(mate, !left);
            }
            w.events.emit('feature', { kind: 'guardianWarn', x: g.ox, y: g.oy });
          }
          break;
        case 'warn':
          if (g.t >= this.cfg.warn) {
            g.state = 'beam';
            g.t = 0;
            g.hitPlayer = false;
            if (near) w.events.emit('feature', { kind: 'guardianBeam', x: g.ox, y: g.oy });
          }
          break;
        case 'beam': {
          const k = g.t / this.cfg.beam;
          g.angle = g.from + (g.to - g.from) * smoothstep(0, 1, k);
          const turning = this.cfg.sweepBack && !g.back;
          g.power = (g.back ? 1 : smoothstep(0, 0.06, k)) * (turning ? 1 : 1 - smoothstep(0.92, 1, k));
          if (g.power > 0.5) this.zap(g);
          if (g.t >= this.cfg.beam && this.cfg.sweepBack && !g.back) {
            g.back = true;
            g.t = 0;
            g.hitPlayer = false;
            [g.from, g.to] = [g.to, g.from];
            if (near) w.events.emit('feature', { kind: 'guardianBeam', x: g.ox, y: g.oy });
          } else if (g.t >= this.cfg.beam) {
            g.state = 'idle';
            g.t = 0;
            g.idle = this.rng.range(this.cfg.idle[0], this.cfg.idle[1]);
          }
          break;
        }
      }
      if (g.state !== 'beam') g.power = 0;
    }
  }

  private wake(g: Guardian, left: boolean): void {
    g.state = 'warn';
    g.t = 0;
    g.back = false;
    g.from = left ? this.cfg.arc[1] : this.cfg.arc[0];
    g.to = left ? this.cfg.arc[0] : this.cfg.arc[1];
    g.angle = g.from;
  }

  /** The nearest other idle head within reach. */
  private partner(g: Guardian): Guardian | null {
    const i = nearestPartner(
      this.heads.map((h) => (h === g || h.state !== 'idle' ? null : h.x)),
      g.x,
      this.cfg.pairReach,
    );
    return i >= 0 ? this.heads[i] : null;
  }

  private zap(g: Guardian): void {
    const w = this.world;
    const p = w.player;
    if (!g.hitPlayer && this.playing && p.alive && beamHits(g.ox, g.oy, g.angle, this.cfg.length, this.cfg.halfWidth, p.x, p.y, p.radius * 0.8)) {
      g.hitPlayer = true;
      w.hurtPlayer(p.x - Math.cos(g.angle), p.y - Math.sin(g.angle), this.cfg.stun, this.cfg.knock, 'Zapped!', '#a8fff4');
    }
    for (const f of w.spawner.fish) {
      if (!f.alive || f.appear < 0.5 || !beamHits(g.ox, g.oy, g.angle, this.cfg.length, this.cfg.halfWidth, f.x, f.y, f.radius * 0.7)) continue;
      const bonus = w.killFish(f, 2);
      if (bonus > 0) {
        w.award(bonus, f.x, f.y + 0.8, 'Guardian zap!', '#a8fff4');
        w.stat('beamKill');
      }
    }
  }

  render(): void {
    for (const g of this.heads) {
      const fading = !(this.cfg.sweepBack && !g.back);
      const warn = g.state === 'warn' ? smoothstep(0, this.cfg.warn, g.t) : g.state === 'beam' ? (fading ? 1 - smoothstep(0.85, 1, g.t / this.cfg.beam) : 1) : 0;
      const flick = 0.85 + 0.15 * Math.sin(this.time * 31 + g.x);
      g.eyeMat.color.setRGB(0.5, 1.6, 1.4).multiplyScalar(0.06 + warn * 1.1 * flick);
      g.flareMat.uniforms.uIntensity.value = warn * 0.9 * flick;
      g.flare.visible = warn > 0.01;
      g.flare.scale.setScalar(1.6 + warn * 1.4 + g.power * 0.8);
      g.beam.visible = g.power > 0.01;
      g.beam.rotation.z = g.angle;
      g.beamMat.uniforms.uIntensity.value = g.power * 1.5 * flick;
    }
  }
}
