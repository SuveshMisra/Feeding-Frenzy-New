import { Color, Mesh, MeshBasicMaterial, PlaneGeometry, type Group, type ShaderMaterial } from 'three';
import { smoothstep } from '../../engine/math';
import type { Rng } from '../../engine/rng';
import type { World } from '../World';
import { lavaBombGeometry, softGlowMaterial } from './art';

export const BOMB = {
  /** Seconds a bomb waits between landings. */
  gap: [3, 5.5] as const,
  /** The glowing marker shows where it will land this long before it hits. */
  warn: 1.7,
  /** Seconds to fall from above the view to the floor. */
  fall: 0.55,
  radius: 1.2,
  /** Fish within this distance of the impact are killed. */
  blast: 2.2,
  stun: 0.75,
  knock: 7,
  /** A landing this close to the player that misses counts as a dodge. */
  dodge: 5,
};

type BombState = 'idle' | 'warn' | 'fall';

interface Bomb {
  state: BombState;
  t: number;
  wait: number;
  x: number;
  y: number;
  top: number;
  floor: number;
  hit: boolean;
  mesh: Mesh;
  marker: Mesh;
  markerMat: ShaderMaterial;
}

const EMBER = new Color('#ff8a3c');
const SMOKE = new Color('#3a2a26');

/** Eruption: molten rocks rain from above. A glow on the floor marks where each will land. */
export class LavaBombs {
  private readonly bombs: Bomb[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  constructor(
    private readonly world: World,
    group: Group,
    private readonly rng: Rng,
    count: number,
  ) {
    const geo = lavaBombGeometry(world.level.seed + 77);
    const mat = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const plane = new PlaneGeometry(1, 1);
    this.disposables.push(geo, mat, plane);
    for (let i = 0; i < count; i++) {
      const mesh = new Mesh(geo, mat);
      mesh.visible = false;
      const markerMat = softGlowMaterial('#ff5a24');
      const marker = new Mesh(plane, markerMat);
      marker.renderOrder = 5;
      marker.visible = false;
      group.add(mesh, marker);
      this.disposables.push(markerMat);
      this.bombs.push({ state: 'idle', t: 0, wait: 2 + i * 1.3, x: 0, y: 0, top: 0, floor: 0, hit: false, mesh, marker, markerMat });
    }
  }

  /** Where the next bomb lands: the first aims near the player, the rest anywhere on screen. */
  private target(i: number): number {
    const w = this.world;
    const v = w.rig.viewRect();
    const W = w.level.world.width;
    const x = i === 0 ? w.player.x + this.rng.range(-5, 5) : this.rng.range(v.x0 + 2, v.x1 - 2);
    return Math.max(-W / 2 + 2, Math.min(W / 2 - 2, x));
  }

  update(dt: number, playing: boolean): void {
    const w = this.world;
    const p = w.player;
    this.bombs.forEach((b, i) => {
      b.t += dt;
      switch (b.state) {
        case 'idle':
          if (!playing) break;
          b.wait -= dt;
          if (b.wait <= 0 && p.alive) {
            b.state = 'warn';
            b.t = 0;
            b.x = this.target(i);
            b.floor = w.env.floorAt(b.x);
            b.top = w.rig.viewRect().y1 + 3;
            if (i === 0) w.events.emit('feature', { kind: 'bombWarn', x: b.x, y: b.floor });
          }
          break;
        case 'warn':
          if (b.t >= BOMB.warn - BOMB.fall) {
            b.state = 'fall';
            b.t = 0;
            b.hit = false;
          }
          break;
        case 'fall': {
          const k = Math.min(1, b.t / BOMB.fall);
          b.y = b.top + (b.floor + 0.4 - b.top) * k * k;
          if (Math.random() < dt * 40) w.effects.mote('glow', b.x + (Math.random() - 0.5) * 0.4, b.y + 0.5, 0.3, 0, 2, 0.6, 0.35, 0.05, EMBER, 0.5, 0, 0.9);
          if (!b.hit && playing && p.alive && Math.abs(p.x - b.x) < BOMB.radius + p.radius && Math.abs(p.y - b.y) < BOMB.radius + p.radius) {
            b.hit = true;
            w.hurtPlayer(b.x, b.y + 1, BOMB.stun, BOMB.knock, 'Burned!', '#ff9a50');
          }
          if (k >= 1) this.land(b, playing);
          break;
        }
      }
    });
  }

  private land(b: Bomb, playing: boolean): void {
    const w = this.world;
    const p = w.player;
    b.state = 'idle';
    b.t = 0;
    b.wait = this.rng.range(BOMB.gap[0], BOMB.gap[1]);
    for (const f of w.spawner.fish) {
      if (!f.alive || Math.hypot(f.x - b.x, f.y - b.floor) > BOMB.blast + f.radius) continue;
      const bonus = w.killFish(f, 2);
      if (bonus > 0) w.award(bonus, b.x, b.floor + 1.5, 'Lava bomb!', '#ffb070');
    }
    if (!b.hit && playing && p.alive && Math.abs(p.x - b.x) < BOMB.dodge && p.y - b.floor < BOMB.dodge * 1.5) {
      if (Math.hypot(p.x - b.x, p.y - b.floor) < BOMB.blast + p.radius) {
        w.hurtPlayer(b.x, b.floor, BOMB.stun, BOMB.knock, 'Burned!', '#ff9a50');
      } else {
        w.stat('bombDodge');
      }
    }
    const near = Math.abs(b.x - w.rig.center.x) < w.rig.viewW;
    if (!near) return;
    for (let i = 0; i < 24; i++) {
      const a = Math.PI * (0.1 + Math.random() * 0.8);
      const s = 2 + Math.random() * 6;
      w.effects.mote(i % 3 ? 'glow' : 'dot', b.x, b.floor + 0.3, 0.3, Math.cos(a) * s, Math.sin(a) * s, 0.5 + Math.random() * 0.6, 0.3, 0.05, i % 4 ? EMBER : SMOKE, 2, -2, 1);
    }
    w.effects.ring(b.x, b.floor + 0.3, EMBER, BOMB.blast * 2, 0.4, 0.2);
    w.events.emit('feature', { kind: 'bombLand', x: b.x, y: b.floor });
  }

  render(time: number): void {
    for (const b of this.bombs) {
      b.mesh.visible = b.state === 'fall';
      if (b.mesh.visible) {
        b.mesh.position.set(b.x, b.y, 0.2);
        b.mesh.rotation.set(time * 3, time * 2, 0);
        b.mesh.scale.setScalar(1.6);
      }
      const warn = b.state === 'warn' ? smoothstep(0, BOMB.warn - BOMB.fall, b.t) : b.state === 'fall' ? 1 : 0;
      b.marker.visible = warn > 0.01;
      if (b.marker.visible) {
        const pulse = 0.75 + 0.25 * Math.sin(time * 18);
        b.marker.position.set(b.x, b.floor + 0.25, 0.7);
        b.marker.scale.set(BOMB.radius * 3.4 * (1.4 - warn * 0.4), BOMB.radius * 1.1, 1);
        b.markerMat.uniforms.uIntensity.value = (0.35 + warn * 0.9) * pulse;
      }
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
