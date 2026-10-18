import { Mesh, PlaneGeometry, type ShaderMaterial } from 'three';
import { SPECIES } from '../../config/species';
import { damp } from '../../engine/math';
import type { FishDrawer } from '../../render/FishDrawer';
import { Fish } from '../entities/Fish';
import { FeatureBase } from './FeatureBase';
import { softGlowMaterial } from './art';
import { lightRadius, spreadSlots } from './helpers';
import type { FeatureHud } from './types';

export const DARK = {
  /** Seconds for a full light meter to run dry. */
  drain: 40,
  /** Light restored per glowing fish eaten (most abyss fish glow, so steady eating keeps pace). */
  refill: 0.05,
  /** Visible radius in world units at empty and full light. */
  radius: [3.4, 15] as const,
  /** Screen darkness outside the light. */
  amount: 0.93,
  low: 0.25,
  /** Predators notice less of a dim fish. */
  lowDetect: 0.8,
  /** Anglerfish that wait motionless behind their lures. */
  lurkers: 0,
  /** A lurker lunges at a player whose body comes this close to its lure. */
  lurkReach: 4,
  lurkSpeed: 15,
  lurkLunge: 0.4,
  lurkCooldown: 3.5,
  lurkStun: 1.1,
  lurkKnock: 8,
  /** Small fish this close to a lure get snapped up. */
  lurkSnap: 1.6,
};

type LurkState = 'wait' | 'lunge' | 'back';

interface Lurker {
  fish: Fish;
  homeX: number;
  homeY: number;
  state: LurkState;
  t: number;
  cooldown: number;
  hit: boolean;
  glow: Mesh;
  glowMat: ShaderMaterial;
}

/** Abyssal Trench: the player's light runs down; glowing prey refills it. */
export class DarknessFeature extends FeatureBase {
  private readonly cfg = this.opts(DARK);
  light = 1;
  private shownRadius: number = this.cfg.radius[1];
  private wasLow = false;
  private baseLight = 0;
  private lurkers: Lurker[] = [];

  build(): void {
    const w = this.world;
    this.baseLight = w.env.playerLight.intensity;
    if (this.cfg.lurkers <= 0) return;
    const def = SPECIES.anglerfish;
    w.drawer.prepare([def.id]);
    const lvl = w.level;
    const H = lvl.world.height;
    const geo = this.track(new PlaneGeometry(1, 1));
    const xs = spreadSlots(this.cfg.lurkers, lvl.world.width, 18, () => this.rng.next(), { x: this.startX, gap: 22 });
    for (const x of xs) {
      const floor = w.env.floorAt(x);
      const y = floor + this.rng.range(2.2, Math.min(6, H * 0.3));
      const fish = new Fish(def, 1.05);
      fish.place(x, y, this.rng.chance(0.5) ? 0.01 : -0.01, 0);
      fish.vel.x = 0;
      fish.appear = 1;
      fish.z = -0.4;
      fish.mode = 'predator';
      const glowMat = this.track(softGlowMaterial('#ffd27a'));
      const glow = new Mesh(geo, glowMat);
      glow.renderOrder = 6;
      this.group.add(glow);
      this.lurkers.push({ fish, homeX: x, homeY: y, state: 'wait', t: 0, cooldown: 0, hit: false, glow, glowMat });
    }
  }

  /** Where the lure dangles: ahead of and above the mouth. */
  private lure(l: Lurker): { x: number; y: number } {
    const f = l.fish;
    return { x: f.x + f.facing * f.len * 0.75, y: f.y + f.len * 0.32 };
  }

  update(dt: number): void {
    super.update(dt);
    const w = this.world;
    if (this.playing) this.light = Math.max(0, this.light - dt / this.cfg.drain);
    const low = this.light < this.cfg.low;
    if (low && !this.wasLow && this.playing) w.events.emit('feature', { kind: 'lightLow', x: w.player.x, y: w.player.y });
    this.wasLow = low;
    if (low && w.mode === 'play') {
      w.detectMul *= this.cfg.lowDetect;
      w.hideThreatArrows = true;
    }
    for (const l of this.lurkers) this.updateLurker(l, dt);
  }

  private updateLurker(l: Lurker, dt: number): void {
    const w = this.world;
    const p = w.player;
    const f = l.fish;
    l.t += dt;
    l.cooldown -= dt;
    switch (l.state) {
      case 'wait': {
        f.vel.x = damp(f.vel.x, 0, 4, dt);
        f.vel.y = (l.homeY + Math.sin(this.time * 0.7 + l.homeX) * 0.25 - f.y) * 1.5;
        f.jawTarget = 0.1;
        if (l.cooldown > 0) break;
        const lure = this.lure(l);
        if (this.playing && p.alive && Math.hypot(p.x - lure.x, p.y - lure.y) - p.radius < this.cfg.lurkReach) {
          l.state = 'lunge';
          l.t = 0;
          l.hit = false;
          const dx = p.x - f.mouthX;
          const dy = p.y - f.mouthY;
          const d = Math.hypot(dx, dy) || 1;
          f.vel.x = (dx / d) * this.cfg.lurkSpeed;
          f.vel.y = (dy / d) * this.cfg.lurkSpeed;
          f.jawTarget = 1;
          f.alert = 1;
          if (this.near(f.x)) w.events.emit('feature', { kind: 'lureSnap', x: f.x, y: f.y });
          break;
        }
        for (const o of w.spawner.fish) {
          if (!o.alive || o.tier > 2 || o.appear < 0.5) continue;
          if (Math.hypot(o.x - lure.x, o.y - lure.y) < this.cfg.lurkSnap + o.radius) {
            o.alive = false;
            w.effects.deathCloud(o.x, o.y, Math.min(1, o.len * 0.4));
            f.jaw = 1;
            f.jawTarget = 0;
            l.cooldown = 1.5;
            break;
          }
        }
        break;
      }
      case 'lunge': {
        const k = Math.max(0, 1 - dt * 2.5);
        f.vel.x *= k;
        f.vel.y *= k;
        if (!l.hit && this.playing && p.alive && Math.hypot(p.x - f.mouthX, p.y - f.mouthY) < f.mouthRadius + p.radius) {
          l.hit = true;
          f.jaw = 1;
          f.jawTarget = 0;
          w.hurtPlayer(f.mouthX, f.mouthY, this.cfg.lurkStun, this.cfg.lurkKnock, 'Lured!', '#ffd27a');
        }
        if (l.t >= this.cfg.lurkLunge) {
          l.state = 'back';
          l.t = 0;
          f.jawTarget = 0;
        }
        break;
      }
      case 'back': {
        const dx = l.homeX - f.x;
        const dy = l.homeY - f.y;
        const d = Math.hypot(dx, dy);
        const s = Math.min(3, d * 2);
        f.vel.x = damp(f.vel.x, (dx / (d || 1)) * s, 4, dt);
        f.vel.y = damp(f.vel.y, (dy / (d || 1)) * s, 4, dt);
        if (d < 0.3) {
          l.state = 'wait';
          l.cooldown = this.cfg.lurkCooldown;
          // Face back out the way it was looking before the lunge.
          f.vel.x = l.homeX > 0 ? -0.3 : 0.3;
        }
        break;
      }
    }
    f.integrate(dt);
    f.alert = Math.max(0, f.alert - dt);
  }

  onEat(f: Fish): void {
    if (!f.def.material.glow) return;
    this.light = Math.min(1, this.light + this.cfg.refill);
    this.world.stat('glowEat');
  }

  render(_alpha: number, dt: number): void {
    const w = this.world;
    const target = lightRadius(this.light, this.cfg.radius[0], this.cfg.radius[1]);
    this.shownRadius += (target - this.shownRadius) * Math.min(1, dt * 3);
    const on = w.mode === 'play' && w.player.visible;
    w.vision.dark = on ? this.cfg.amount : 0;
    w.vision.radius = this.shownRadius;
    w.env.playerLight.intensity = this.baseLight * (0.35 + 0.65 * this.light);
    for (const l of this.lurkers) {
      const lure = this.lure(l);
      l.glow.position.set(lure.x, lure.y, l.fish.z + 0.4);
      const pulse = 0.8 + 0.2 * Math.sin(this.time * 2.4 + l.homeX);
      const dim = l.state === 'wait' ? 1 : 0.35;
      l.glowMat.uniforms.uIntensity.value = 1.1 * pulse * dim;
      l.glow.scale.setScalar(1.3 + pulse * 0.4);
    }
  }

  drawFish(drawer: FishDrawer, alpha: number): void {
    const v = this.world.rig.viewRect();
    for (const l of this.lurkers) {
      const f = l.fish;
      if (f.x < v.x0 - 10 || f.x > v.x1 + 10) continue;
      drawer.draw(f, alpha, 1, 1);
    }
  }

  hud(): FeatureHud | null {
    return this.world.mode === 'play' ? { label: 'Light', value: this.light, tone: 'light', alarm: this.light < this.cfg.low } : null;
  }
}
