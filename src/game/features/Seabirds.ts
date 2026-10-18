import { Color, Mesh, MeshStandardMaterial, PlaneGeometry, type Group, type ShaderMaterial } from 'three';
import { patchMaterial } from '../../engine/materialPatches';
import { damp, smoothstep } from '../../engine/math';
import type { Rng } from '../../engine/rng';
import type { World } from '../World';
import { seabirdGeometry, shadowMaterial } from './art';

export const BIRD = {
  /** Seconds between dives while the tide is low. */
  gap: [3, 5.5] as const,
  /** The shadow tracks the player for this long before the bird drops. */
  warn: 1.3,
  /** Seconds from leaving the sky to the bottom of the dive. */
  dive: 0.5,
  /** How deep under the surface a dive reaches. */
  depth: 4.5,
  rise: 0.7,
  radius: 0.8,
  stun: 1.2,
  knock: 7,
  /** A dive this close to the player that misses counts as a dodge. */
  dodge: 4,
};

type BirdState = 'idle' | 'warn' | 'dive' | 'rise';

const SPLASH = new Color('#e8fff4');

/** Height of a diving bird `t` seconds into a dive that falls from `top` to `bottom` in `dur` seconds. */
export function diveY(t: number, dur: number, top: number, bottom: number): number {
  const k = Math.min(1, Math.max(0, t / dur));
  return top + (bottom - top) * k * k;
}

/** Storm Surge: at low tide seabirds dive at the player. The shadow on the water gives them away. */
export class Seabirds {
  private state: BirdState = 'idle';
  private t = 0;
  private next = 4;
  private x = 0;
  private y = 0;
  private hit = false;
  private splashed = false;
  private readonly bird: Mesh;
  private readonly shadow: Mesh;
  private readonly shadowMat: ShaderMaterial;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(
    private readonly world: World,
    group: Group,
    private readonly rng: Rng,
  ) {
    const geo = seabirdGeometry();
    const mat = patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), { caustics: true });
    this.bird = new Mesh(geo, mat);
    this.bird.visible = false;
    this.bird.castShadow = true;
    const plane = new PlaneGeometry(1, 1);
    this.shadowMat = shadowMaterial();
    this.shadow = new Mesh(plane, this.shadowMat);
    this.shadow.renderOrder = 5;
    this.shadow.visible = false;
    group.add(this.bird, this.shadow);
    this.disposables.push(geo, mat, plane, this.shadowMat);
  }

  get warning(): boolean {
    return this.state === 'warn';
  }

  /** `low`: the tide is out far enough for birds to hunt. */
  update(dt: number, low: boolean, playing: boolean): void {
    const w = this.world;
    const p = w.player;
    const surface = w.surfaceY;
    this.t += dt;
    switch (this.state) {
      case 'idle':
        this.next -= dt;
        if (this.next <= 0 && low && playing && p.alive) {
          this.state = 'warn';
          this.t = 0;
          this.x = p.x + p.vel.x * 0.4;
          w.events.emit('feature', { kind: 'birdWarn', x: this.x, y: surface });
        }
        break;
      case 'warn':
        // The shadow drifts after the player, slower than they can swim.
        this.x = damp(this.x, p.x + p.vel.x * 0.35, 1.6, dt);
        if (this.t >= BIRD.warn) {
          this.state = 'dive';
          this.t = 0;
          this.hit = false;
          this.splashed = false;
          w.events.emit('feature', { kind: 'birdDive', x: this.x, y: surface });
        }
        break;
      case 'dive': {
        const top = surface + 7;
        this.y = diveY(this.t, BIRD.dive, top, surface - BIRD.depth);
        if (!this.splashed && this.y < surface) {
          this.splashed = true;
          w.effects.bubbleBurst(this.x, surface - 0.4, 0.3, 26, 0.14, 0.8, 3);
          w.effects.ring(this.x, surface - 0.2, SPLASH, 3, 0.4, 0.2);
          w.events.emit('feature', { kind: 'birdSplash', x: this.x, y: surface });
        }
        this.strike(playing);
        if (this.t >= BIRD.dive) {
          this.state = 'rise';
          this.t = 0;
          if (!this.hit && playing && p.alive && Math.abs(p.x - this.x) < BIRD.dodge && p.y > surface - BIRD.depth - 3) {
            w.stat('birdDodge');
            w.events.emit('feature', { kind: 'birdDodge', x: p.x, y: p.y });
          }
        }
        break;
      }
      case 'rise':
        this.y = diveY(this.t, BIRD.rise, surface - BIRD.depth, surface + 8);
        if (this.t >= BIRD.rise) {
          this.state = 'idle';
          this.next = this.rng.range(BIRD.gap[0], BIRD.gap[1]);
        }
        break;
    }
  }

  private strike(playing: boolean): void {
    const w = this.world;
    const p = w.player;
    if (this.y > w.surfaceY + 0.5) return;
    const tipY = this.y - 1.1;
    if (!this.hit && playing && p.alive && Math.abs(p.x - this.x) < BIRD.radius + p.radius && p.y > tipY - p.radius && p.y < this.y + 1) {
      this.hit = true;
      w.hurtPlayer(this.x, this.y + 1.5, BIRD.stun, BIRD.knock, 'Snatched!', '#fff2c8');
    }
    for (const f of w.spawner.fish) {
      if (!f.alive || f.tier > 2 || Math.abs(f.x - this.x) > BIRD.radius + f.radius || f.y < tipY - f.radius || f.y > this.y + 1) continue;
      w.killFish(f, 0);
    }
  }

  render(time: number): void {
    const w = this.world;
    const surface = w.surfaceY;
    const flying = this.state === 'dive' || this.state === 'rise';
    this.bird.visible = flying;
    if (flying) {
      this.bird.position.set(this.x, this.y, 0.3);
      this.bird.rotation.set(0, Math.sin(time * 3) * 0.3, this.state === 'rise' ? Math.PI : 0);
    }
    const warn = this.state === 'warn' ? smoothstep(0, BIRD.warn, this.t) : this.state === 'dive' ? 1 - smoothstep(0, BIRD.dive, this.t) : 0;
    this.shadow.visible = warn > 0.01;
    if (this.shadow.visible) {
      this.shadow.position.set(this.x, surface - 0.6, 0.6);
      const s = 3.2 - warn * 1.4;
      this.shadow.scale.set(s, s * 0.45, 1);
      this.shadowMat.uniforms.uOpacity.value = 0.25 + warn * 0.5 + 0.08 * Math.sin(time * 12);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
