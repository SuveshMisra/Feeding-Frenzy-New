import { Color, Mesh, MeshStandardMaterial } from 'three';
import { patchMaterial } from '../../engine/materialPatches';
import { smoothstep } from '../../engine/math';
import { crystalClusterGeometry } from '../../env/props/crystal';
import { FeatureBase } from './FeatureBase';
import { chainPicks, spreadSlots } from './helpers';

export const CRYSTAL = {
  count: 5,
  scale: 1.15,
  ring: 0.5,
  /** Stuns every fish within this distance. */
  radius: 6,
  stun: 3,
  regrow: 20,
  growTime: 2.5,
  /** Neighbours that resonate and shatter after the one the player bumped. */
  chain: 0,
  chainDelay: 0.3,
  chainReach: 16,
  /** Seconds a resonating (chained) shatter stuns the player if they are caught in it. */
  selfStun: 0,
};

type CrystalState = 'idle' | 'ring' | 'gone';

interface Cluster {
  x: number;
  y: number;
  state: CrystalState;
  t: number;
  grow: number;
  /** Set off by a neighbour rather than the player. */
  chained: boolean;
  color: Color;
  mesh: Mesh;
  mat: MeshStandardMaterial;
}

/** Crystal Caverns: bump a crystal and it shatters, stunning every fish nearby. */
export class CrystalsFeature extends FeatureBase {
  private readonly cfg = this.opts(CRYSTAL);
  private clusters: Cluster[] = [];

  build(): void {
    const w = this.world;
    const lvl = w.level;
    const pal = w.env.biome.palette;
    const xs = spreadSlots(this.cfg.count, lvl.world.width, 14, () => this.rng.next(), { x: this.startX, gap: 8 });
    xs.forEach((x, i) => {
      const floor = w.env.floorAt(x);
      const color = new Color(pal.coral[i % pal.coral.length]);
      const mat = this.track(
        patchMaterial(new MeshStandardMaterial({ color, vertexColors: true, roughness: 0.18, metalness: 0.05, flatShading: true }), {
          glow: 1.9,
          translucency: 0.25,
          rim: { color: new Color('#e9fbff'), power: 2.4, strength: 0.45 },
        }),
      );
      const mesh = new Mesh(this.track(crystalClusterGeometry(lvl.seed + 600 + i)), mat);
      mesh.position.set(x, floor - 0.1, 0.4);
      mesh.rotation.y = this.rng.range(0, Math.PI * 2);
      mesh.scale.setScalar(this.cfg.scale);
      this.group.add(mesh);
      this.clusters.push({ x, y: floor + 1.2 * this.cfg.scale, state: 'idle', t: 0, grow: 1, chained: false, color, mesh, mat });
    });
  }

  update(dt: number): void {
    super.update(dt);
    const w = this.world;
    const p = w.player;
    for (const c of this.clusters) {
      c.t += dt;
      switch (c.state) {
        case 'idle':
          c.grow = Math.min(1, c.grow + dt / this.cfg.growTime);
          if (c.grow >= 1 && this.playing && p.alive && Math.hypot(p.x - c.x, p.y - c.y) < 1.4 + p.radius) {
            c.state = 'ring';
            c.t = 0;
            c.chained = false;
            w.events.emit('feature', { kind: 'crystalRing', x: c.x, y: c.y });
          }
          break;
        case 'ring':
          if (c.t < 0) break;
          if (Math.random() < dt * 30) w.effects.mote('glow', c.x + (Math.random() - 0.5) * 1.6, c.y + (Math.random() - 0.3) * 1.6, 0.6, 0, 0.6, 0.5, 0.25, 0.05, c.color, 1, 0, 0.9);
          if (c.t >= this.cfg.ring) this.shatter(c);
          break;
        case 'gone':
          if (c.t >= this.cfg.regrow) {
            c.state = 'idle';
            c.t = 0;
            c.grow = 0;
          }
          break;
      }
    }
  }

  private shatter(c: Cluster): void {
    const w = this.world;
    c.state = 'gone';
    c.t = 0;
    let stunned = 0;
    for (const f of w.spawner.fish) {
      if (!f.alive || Math.hypot(f.x - c.x, f.y - c.y) > this.cfg.radius + f.radius) continue;
      w.stunFish(f, this.cfg.stun);
      stunned++;
    }
    const p = w.player;
    if (c.chained && this.cfg.selfStun > 0 && this.playing && p.alive && Math.hypot(p.x - c.x, p.y - c.y) < this.cfg.radius + p.radius) {
      w.hurtPlayer(c.x, c.y, this.cfg.selfStun, 5, 'Resonance!', '#e0b8ff');
    }
    if (!c.chained && this.cfg.chain > 0) this.resonate(c);
    w.stat('shatter');
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 7;
      w.effects.mote(i % 2 ? 'glow' : 'dot', c.x, c.y, 0.6, Math.cos(a) * s, Math.sin(a) * s, 0.5 + Math.random() * 0.7, 0.3, 0.05, c.color, 3, -2, 1);
    }
    w.effects.ring(c.x, c.y, c.color, this.cfg.radius * 2, 0.55, 0.12);
    w.effects.ring(c.x, c.y, new Color('#ffffff'), this.cfg.radius * 1.2, 0.35, 0.2);
    w.events.emit('feature', { kind: 'crystalShatter', x: c.x, y: c.y });
    if (stunned >= 3) w.events.emit('feature', { kind: 'crystalStun', x: c.x, y: c.y + 1.5 });
  }

  /** Sets the nearest grown neighbours ringing, one after another. */
  private resonate(c: Cluster): void {
    const others = this.clusters.filter((o) => o !== c && o.state === 'idle' && o.grow >= 1);
    const picks = chainPicks(
      others.map((o) => o.x),
      c.x,
      this.cfg.chain,
      this.cfg.chainReach,
    );
    picks.forEach((idx, k) => {
      const o = others[idx];
      o.state = 'ring';
      o.t = -(k + 1) * this.cfg.chainDelay;
      o.chained = true;
    });
    if (picks.length > 0) {
      this.world.stat('chainShatter');
      this.world.events.emit('feature', { kind: 'crystalChain', x: c.x, y: c.y + 1.5 });
    }
  }

  render(): void {
    for (const c of this.clusters) {
      const m = c.mesh;
      m.visible = c.state !== 'gone';
      if (!m.visible) continue;
      const ring = c.state === 'ring' ? Math.max(0, c.t) / this.cfg.ring : 0;
      const s = this.cfg.scale * (0.15 + 0.85 * smoothstep(0, 1, c.grow)) * (1 + ring * 0.12);
      m.scale.setScalar(s);
      m.position.x = c.x + (ring > 0 ? Math.sin(this.time * 70) * 0.05 * ring : 0);
      const u = (m.material as MeshStandardMaterial).userData.ffUniforms as { uGlow?: { value: number } } | undefined;
      if (u?.uGlow) u.uGlow.value = 1.9 + ring * 3 + Math.sin(this.time * 2 + c.x) * 0.25;
    }
  }
}
