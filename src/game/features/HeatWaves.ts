import { Color, Mesh, type ShaderMaterial } from 'three';
import { smoothstep } from '../../engine/math';
import { FeatureBase } from './FeatureBase';
import { ribbonGeometry, ribbonMaterial } from './art';
import { heatBand } from './helpers';
import { LavaBombs } from './LavaBombs';
import type { FeatureHud } from './types';

export const HEAT = {
  first: 15,
  idle: [22, 30] as const,
  warn: 2.5,
  rise: 6,
  thickness: 4.5,
  /** Seconds inside the band to fill the heat meter. */
  fill: 0.55,
  cool: 0.6,
  stun: 1.1,
  knock: 4,
  /** Fish caught in the band drift up stunned at this speed. */
  lift: 2.5,
  /** Bands per heat wave, each `pulseGap` seconds behind the last. */
  pulses: 1,
  pulseGap: 1.8,
  /** Lava bombs falling at any one time (0 = none). */
  bombs: 0,
};

type HeatState = 'idle' | 'warn' | 'rise';

const EMBER = new Color('#ffb070');

/** Every band of a wave of `pulses` bands `gap` seconds apart, `t` seconds after it starts rising. */
export function heatPulses(t: number, pulses: number, gap: number, rise: number, floor: number, surface: number, thickness: number): ({ y0: number; y1: number } | null)[] {
  return Array.from({ length: Math.max(1, pulses) }, (_, i) => heatBand(t - i * gap, rise, floor, surface, thickness));
}

/** Volcanic Vents: scalding heat waves rise from the floor; dodge them or get burned. */
export class HeatWavesFeature extends FeatureBase {
  private readonly cfg = this.opts(HEAT);
  private state: HeatState = 'idle';
  private t = 0;
  private idle = this.cfg.first;
  heat = 0;
  private scalded = false;
  private bands: ({ y0: number; y1: number } | null)[] = [];
  private meshes: { mesh: Mesh; mat: ShaderMaterial; power: number }[] = [];
  private bombs: LavaBombs | null = null;

  build(): void {
    const geo = this.track(ribbonGeometry(8));
    for (let i = 0; i < Math.max(1, this.cfg.pulses); i++) {
      const mat = this.track(ribbonMaterial({ color: '#ff7a2e', scroll: 0.25, streaks: 26, streakAmount: 0.4, soft: 1.6, fadeIn: 0, fadeOut: 0 }));
      const mesh = new Mesh(geo, mat);
      mesh.renderOrder = 3;
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.group.add(mesh);
      this.meshes.push({ mesh, mat, power: 0 });
    }
    if (this.cfg.bombs > 0) this.bombs = new LavaBombs(this.world, this.group, this.rng, this.cfg.bombs);
  }

  private get anyBand(): boolean {
    return this.bands.some((b) => b !== null);
  }

  update(dt: number): void {
    super.update(dt);
    const w = this.world;
    const p = w.player;
    this.bombs?.update(dt, this.playing);
    if (!this.playing) {
      this.heat = Math.max(0, this.heat - dt / this.cfg.cool);
      return;
    }
    this.t += dt;
    switch (this.state) {
      case 'idle':
        if (this.t >= this.idle) {
          this.state = 'warn';
          this.t = 0;
          w.events.emit('feature', { kind: 'heatWarn', x: p.x, y: w.env.floorAt(p.x) });
        }
        break;
      case 'warn':
        if (Math.random() < dt * 40) {
          const v = w.rig.viewRect();
          const x = v.x0 + Math.random() * (v.x1 - v.x0);
          w.effects.mote('glow', x, w.env.floorAt(x) + 0.3, 0.3, 0, 2 + Math.random() * 2, 1, 0.2, 0.05, EMBER, 0.3, 1, 0.8);
        }
        if (this.t >= this.cfg.warn) {
          this.state = 'rise';
          this.t = 0;
          this.scalded = false;
        }
        break;
      case 'rise': {
        const H = w.surfaceY;
        this.bands = heatPulses(this.t, this.cfg.pulses, this.cfg.pulseGap, this.cfg.rise, w.env.floorAt(p.x) - this.cfg.thickness, H, this.cfg.thickness);
        const started = this.t > (this.cfg.pulses - 1) * this.cfg.pulseGap;
        if (started && !this.anyBand) {
          if (!this.scalded && p.alive) {
            w.stat('heatDodge');
            w.events.emit('feature', { kind: 'heatDodge', x: p.x, y: p.y });
          }
          this.state = 'idle';
          this.t = 0;
          this.idle = this.rng.range(this.cfg.idle[0], this.cfg.idle[1]);
          break;
        }
        if (this.cfg.pulses > 1 && this.t - dt < this.cfg.pulseGap && this.t >= this.cfg.pulseGap) {
          w.events.emit('feature', { kind: 'heatPulse', x: p.x, y: w.env.floorAt(p.x) });
        }
        for (const f of w.spawner.fish) {
          if (!f.alive || !this.bands.some((b) => b && f.y >= b.y0 && f.y <= b.y1)) continue;
          w.stunFish(f, 0.6);
          f.y = Math.min(H - f.radius, f.y + this.cfg.lift * dt);
        }
        break;
      }
    }
    const inside = this.state === 'rise' && p.alive && this.bands.some((b) => b && p.y > b.y0 && p.y < b.y1);
    if (inside && !p.protected) {
      this.heat = Math.min(1, this.heat + dt / this.cfg.fill);
      if (this.heat >= 1) {
        this.scalded = true;
        this.heat = 0.3;
        w.hurtPlayer(p.x, p.y - 1, this.cfg.stun, this.cfg.knock, 'Scalded!', '#ff9a50');
      }
    } else {
      this.heat = Math.max(0, this.heat - dt / this.cfg.cool);
    }
    if (this.state !== 'rise') this.bands = [];
  }

  render(_alpha: number, dt: number): void {
    const w = this.world;
    const v = w.rig.viewRect();
    const pad = 6;
    let power = 0;
    this.meshes.forEach((m, i) => {
      const b = this.bands[i] ?? null;
      m.power += ((b ? 1 : 0) - m.power) * Math.min(1, dt * 5);
      power = Math.max(power, m.power);
      m.mesh.visible = m.power > 0.01 && b !== null;
      if (!b) return;
      m.mesh.position.set(v.x0 - pad, (b.y0 + b.y1) / 2, 0.8);
      m.mesh.scale.set(v.x1 - v.x0 + pad * 2, (b.y1 - b.y0) * 1.25, 1);
      m.mat.uniforms.uIntensity.value = 0.32 * m.power;
      if (Math.random() < dt * 30) {
        const x = v.x0 + Math.random() * (v.x1 - v.x0);
        w.effects.mote('glow', x, b.y0 + Math.random() * (b.y1 - b.y0), 0.5, 0, 3, 0.8, 0.2, 0.05, EMBER, 0.5, 1, 0.8);
      }
    });
    w.heatHaze = Math.max(power * 0.7, this.heat * 0.6, this.state === 'warn' ? 0.25 * smoothstep(0, this.cfg.warn, this.t) : 0);
    this.bombs?.render(this.time);
  }

  hud(): FeatureHud | null {
    if (this.world.mode !== 'play') return null;
    if (this.state === 'warn') return { label: this.cfg.pulses > 1 ? 'Double heat wave!' : 'Heat wave!', tone: 'heat', alarm: true };
    if (this.heat > 0.02 || this.state === 'rise') return { label: 'Heat', value: this.heat, tone: 'heat', alarm: this.heat > 0.6 };
    return null;
  }

  dispose(): void {
    this.bombs?.dispose();
    super.dispose();
  }
}
