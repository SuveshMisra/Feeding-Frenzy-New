import { Group, Mesh, SphereGeometry } from 'three';
import { clamp, damp } from '../../engine/math';
import type { Fish } from '../entities/Fish';
import { FeatureBase } from './FeatureBase';
import { burrowGeometry, creatureMaterial, eelBodyGeometry, eelHeadGeometry, eelJawGeometry, glowMaterial, rockMaterial } from './art';
import { spreadSlots } from './helpers';

export const EEL = {
  burrows: 5,
  /** Strikes at anything within this distance of its hole. */
  reach: 4.4,
  /** Longest stretch out of the hole. */
  maxLen: 4.8,
  aim: 0.45,
  lunge: 0.16,
  hold: 0.22,
  retract: 0.7,
  cooldown: 1.6,
  bite: 0.45,
};

type EelState = 'hide' | 'peek' | 'aim' | 'lunge' | 'retract';

interface Eel {
  x: number;
  y: number;
  state: EelState;
  t: number;
  cooldown: number;
  nextPeek: number;
  /** Visible length out of the hole. */
  len: number;
  angle: number;
  jaw: number;
  reachLen: number;
  target: Fish | 'player' | null;
  hit: boolean;
  root: Group;
  body: Mesh;
  head: Group;
  jawMesh: Mesh;
  eyes: Mesh[];
}

/** Shipwreck Graveyard: moray eels lunge from burrows at whatever swims close, player included. */
export class MorayEelsFeature extends FeatureBase {
  private readonly cfg = this.opts(EEL);
  private eels: Eel[] = [];

  build(): void {
    const w = this.world;
    const lvl = w.level;
    const bodyGeo = this.track(eelBodyGeometry(lvl.seed));
    const headGeo = this.track(eelHeadGeometry(lvl.seed));
    const jawGeo = this.track(eelJawGeometry());
    const eyeGeo = this.track(new SphereGeometry(0.05, 8, 6));
    const skin = this.track(creatureMaterial());
    const rock = this.track(rockMaterial());
    const eyeMat = this.track(glowMaterial('#ffe36a'));
    const xs = spreadSlots(this.cfg.burrows, lvl.world.width, 12, () => this.rng.next(), { x: this.startX, gap: 12 });
    xs.forEach((x, i) => {
      const floor = w.env.floorAt(x);
      const mound = new Mesh(this.track(burrowGeometry(lvl.seed + 40 + i)), rock);
      mound.position.set(x, floor - 0.05, -0.35);
      mound.scale.setScalar(1.2);
      mound.rotation.y = this.rng.range(-0.25, 0.25);
      mound.receiveShadow = true;
      mound.castShadow = true;
      const root = new Group();
      const y = floor + 0.3;
      root.position.set(x, y, 0.25);
      const body = new Mesh(bodyGeo, skin);
      const head = new Group();
      const headMesh = new Mesh(headGeo, skin);
      const jawMesh = new Mesh(jawGeo, skin);
      jawMesh.position.set(-0.07, 0.02, 0);
      const eyes = [-1, 1].map((side) => {
        const eye = new Mesh(eyeGeo, eyeMat);
        eye.position.set(0.07, 0.2, side * 0.17);
        head.add(eye);
        return eye;
      });
      head.add(headMesh, jawMesh);
      root.add(body, head);
      this.group.add(mound, root);
      this.eels.push({
        x,
        y,
        state: 'hide',
        t: 0,
        cooldown: 0,
        nextPeek: this.rng.range(1, 5),
        len: 0.2,
        angle: Math.PI / 2,
        jaw: 0,
        reachLen: 0,
        target: null,
        hit: false,
        root,
        body,
        head,
        jawMesh,
        eyes,
      });
    });
  }

  private pickTarget(e: Eel): { target: Fish | 'player'; x: number; y: number } | null {
    const w = this.world;
    const p = w.player;
    let best: { target: Fish | 'player'; x: number; y: number } | null = null;
    let bestD = this.cfg.reach;
    if (this.playing && p.alive) {
      const d = Math.hypot(p.x - e.x, p.y - e.y) - p.radius;
      if (d < bestD && p.y > e.y - 0.2) {
        bestD = d;
        best = { target: 'player', x: p.x, y: p.y };
      }
    }
    for (const f of w.spawner.fish) {
      if (!f.alive || f.appear < 0.5 || f.y < e.y - 0.2) continue;
      const d = Math.hypot(f.x - e.x, f.y - e.y) - f.radius;
      if (d < bestD) {
        bestD = d;
        best = { target: f, x: f.x, y: f.y };
      }
    }
    return best;
  }

  update(dt: number): void {
    super.update(dt);
    const w = this.world;
    const p = w.player;
    for (const e of this.eels) {
      e.t += dt;
      e.cooldown -= dt;
      const near = this.near(e.x, 1);
      switch (e.state) {
        case 'hide':
        case 'peek': {
          const want = e.state === 'peek' ? 1.1 + Math.sin(this.time * 2.2 + e.x) * 0.15 : 0.18;
          e.len = damp(e.len, want, 5, dt);
          e.angle = damp(e.angle, Math.PI / 2 + Math.sin(this.time * 0.9 + e.x) * 0.35, 3, dt);
          e.jaw = damp(e.jaw, e.state === 'peek' ? 0.25 + 0.2 * Math.sin(this.time * 3 + e.x) : 0, 6, dt);
          e.nextPeek -= dt;
          if (e.nextPeek <= 0) {
            e.state = e.state === 'peek' ? 'hide' : 'peek';
            e.nextPeek = e.state === 'peek' ? this.rng.range(2, 3.5) : this.rng.range(2.5, 5);
          }
          if (e.cooldown > 0 || !near) break;
          const t = this.pickTarget(e);
          if (t) {
            e.state = 'aim';
            e.t = 0;
            e.target = t.target;
            e.angle = this.aimAt(e, t.x, t.y);
          }
          break;
        }
        case 'aim': {
          const tx = e.target === 'player' ? p.x : e.target?.x;
          const ty = e.target === 'player' ? p.y : e.target?.y;
          const alive = e.target === 'player' ? p.alive : (e.target?.alive ?? false);
          if (!alive || tx === undefined || ty === undefined) {
            this.retract(e);
            break;
          }
          e.angle = damp(e.angle, this.aimAt(e, tx, ty), 10, dt);
          e.len = damp(e.len, 0.9, 8, dt);
          e.jaw = damp(e.jaw, 1, 10, dt);
          if (e.t >= this.cfg.aim) {
            e.state = 'lunge';
            e.t = 0;
            e.hit = false;
            e.reachLen = clamp(Math.hypot(tx - e.x, ty - e.y) + 0.6, 1.5, this.cfg.maxLen);
            if (near) w.events.emit('feature', { kind: 'eelLunge', x: e.x, y: e.y + 1 });
          }
          break;
        }
        case 'lunge': {
          const k = Math.min(1, e.t / this.cfg.lunge);
          e.len = 0.9 + (e.reachLen - 0.9) * (1 - (1 - k) * (1 - k));
          e.jaw = k < 1 ? 1 : damp(e.jaw, 0, 18, dt);
          if (!e.hit) this.bite(e);
          if (e.t >= this.cfg.lunge + this.cfg.hold) this.retract(e);
          break;
        }
        case 'retract': {
          e.len = damp(e.len, 0.18, 6, dt);
          e.jaw = damp(e.jaw, 0, 8, dt);
          if (e.t >= this.cfg.retract) {
            e.state = 'hide';
            e.nextPeek = this.rng.range(1.5, 3);
          }
          break;
        }
      }
    }
  }

  private aimAt(e: Eel, x: number, y: number): number {
    return clamp(Math.atan2(y - e.y, x - e.x), 0.25, Math.PI - 0.25);
  }

  private retract(e: Eel): void {
    e.state = 'retract';
    e.t = 0;
    e.cooldown = this.cfg.cooldown;
    e.target = null;
  }

  /** Checks the head against the player and every fish while the eel strikes. */
  private bite(e: Eel): void {
    const w = this.world;
    const p = w.player;
    const hx = e.x + Math.cos(e.angle) * (e.len + 0.25);
    const hy = e.y + Math.sin(e.angle) * (e.len + 0.25);
    if (this.playing && p.alive && Math.hypot(p.x - hx, p.y - hy) < this.cfg.bite + p.radius) {
      e.hit = true;
      if (p.protected) {
        w.hurtPlayer(hx, hy, 0, 9, 'Blocked');
      } else {
        w.events.emit('feature', { kind: 'eelBite', x: hx, y: hy });
        w.killPlayer(null);
      }
      return;
    }
    for (const f of w.spawner.fish) {
      if (!f.alive || Math.hypot(f.x - hx, f.y - hy) > this.cfg.bite + f.radius) continue;
      e.hit = true;
      const bonus = w.killFish(f, 2);
      if (bonus > 0) {
        w.award(bonus, hx, hy + 0.8, 'Eel ambush!', '#d8f08a');
        w.stat('eelKill');
      }
      if (this.near(e.x)) w.events.emit('feature', { kind: 'eelBite', x: hx, y: hy });
      return;
    }
  }

  render(): void {
    for (const e of this.eels) {
      const sway = Math.sin(this.time * 3 + e.x) * 0.05 * (e.state === 'lunge' ? 0 : 1);
      e.root.rotation.z = e.angle - Math.PI / 2 + sway;
      e.body.scale.set(1, Math.max(0.01, e.len), 1);
      e.head.position.y = e.len;
      e.jawMesh.rotation.z = e.jaw * 0.7;
      const glare = e.state === 'aim' || e.state === 'lunge' ? 1 : 0.35;
      for (const eye of e.eyes) eye.scale.setScalar(0.8 + glare * 0.6);
    }
  }
}
