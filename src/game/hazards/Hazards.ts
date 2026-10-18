import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
  type ShaderMaterial,
} from 'three';
import type { BiomeId } from '../../config/levels';
import { HAZARD, TIER_POINTS } from '../../config/tuning';
import { clamp, smoothstep } from '../../engine/math';
import { Rng } from '../../engine/rng';
import type { QualityPreset } from '../../app/Quality';
import type { World } from '../World';
import { isThreat } from '../systems/FoodChain';
import {
  PICKUP_COLORS,
  bubbleMaterial,
  buildGeyserColumnGeometry,
  buildGeyserVentGeometry,
  buildJellyGeometry,
  buildMineGeometry,
  buildPickupGeometry,
  buildShellGeometry,
  chainMaterial,
  geyserColumnMaterial,
  geyserVentMaterial,
  jellyMaterial,
  mineMaterial,
  pearlMaterial,
  pickupMaterial,
  shellMaterial,
  type PickupKind,
} from './HazardArt';

interface Jelly {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  size: number;
  phase: number;
  cooldown: number;
  home: number;
  seed: number;
}

interface Mine {
  x: number;
  /** Where the chain is anchored on the floor (drifting mines swing around it). */
  baseX: number;
  y: number;
  anchorY: number;
  floor: number;
  alive: boolean;
  respawn: number;
  warn: number;
  seed: number;
}

interface Oyster {
  x: number;
  y: number;
  t: number;
  open: number;
  hasPearl: boolean;
  black: boolean;
  regrow: number;
  root: Group;
  top: Group;
  pearl: Mesh;
}

interface Geyser {
  x: number;
  floor: number;
  /** Seconds into the current cycle; it erupts at the end of each `period`. */
  t: number;
  period: number;
  height: number;
  /** 0..1 warning glow before an eruption. */
  warn: number;
  /** 0..1 size of the eruption column. */
  column: number;
  /** The player has already been hit by this eruption. */
  hit: boolean;
  columnMesh: Mesh;
  columnMat: ShaderMaterial;
  glowMat: MeshBasicMaterial;
}

interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  t: number;
  landed: number;
  mesh: Group;
  bubble: Mesh;
}

const JELLY_COLORS: Record<BiomeId, [string, string]> = {
  reef: ['#ff8fd0', '#8ff6ff'],
  kelp: ['#ffb08a', '#ffe6a0'],
  wreck: ['#ffc46b', '#ffefb8'],
  ice: ['#b9dcff', '#f2fbff'],
  abyss: ['#ff4fd8', '#5ff2ff'],
  mangrove: ['#d8f08a', '#fff6c0'],
  canyon: ['#8fb8ff', '#d0f0ff'],
  ruins: ['#7fffd8', '#e0fff4'],
  crystal: ['#c08bff', '#7dffe0'],
  volcanic: ['#ff7a4a', '#ffd08a'],
};

const PICKUP_WEIGHTS: { w: number; v: PickupKind }[] = [
  { w: 0.45, v: 'gem' },
  { w: 0.22, v: 'speed' },
  { w: 0.2, v: 'shield' },
  { w: 0.13, v: 'life' },
];

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const tmpColor = new Color();

/** Sideways offset of a drifting mine from its anchor; never more than 80% of the chain. */
export function mineSwing(time: number, seed: number, drift: number, chain: number): number {
  const amp = Math.min(drift, chain * 0.8);
  return amp * (0.8 * Math.sin(time * 0.35 + seed) + 0.2 * Math.sin(time * 0.13 + seed * 1.7));
}

export class Hazards {
  readonly group = new Group();
  private readonly rng: Rng;
  private jellies: Jelly[] = [];
  private jellyMesh: InstancedMesh | null = null;
  private jellyPhase: InstancedBufferAttribute | null = null;
  private mines: Mine[] = [];
  private mineMesh: InstancedMesh | null = null;
  private chainMesh: InstancedMesh | null = null;
  private lampMesh: InstancedMesh | null = null;
  private oysters: Oyster[] = [];
  private geysers: Geyser[] = [];
  private pickups: Pickup[] = [];
  private nextPickup: number;
  private readonly shield: Mesh;
  private readonly disposables: { dispose(): void }[] = [];
  private shellGeo: { top: BufferGeometry; bottom: BufferGeometry } | null = null;
  private time = 0;
  private readonly pickupAssets = new Map<PickupKind, { geo: BufferGeometry; mat: Material }>();
  private bubbleGeo = new SphereGeometry(1, 24, 16);

  constructor(
    private readonly world: World,
    private readonly quality: QualityPreset,
  ) {
    this.rng = new Rng(world.level.seed + 404);
    this.nextPickup = this.rng.range(HAZARD.pickupInterval[0], HAZARD.pickupInterval[1]) * 0.6;
    this.shield = new Mesh(this.bubbleGeo, bubbleMaterial('#7ff0ff', 1));
    this.shield.visible = false;
    this.shield.renderOrder = 7;
    this.group.add(this.shield);
    this.disposables.push(this.shield.material as Material);
    world.scene.add(this.group);
  }

  build(): void {
    const lvl = this.world.level;
    const W = lvl.world.width;
    const H = lvl.world.height;
    const startX = -W / 2 + 14;
    const spread = (n: number, i: number, margin: number): number => {
      const span = W - margin * 2;
      return -W / 2 + margin + (span * (i + 0.5)) / n + this.rng.range(-span / n / 3, span / n / 3);
    };
    const hz = lvl.hazards;

    if (hz.jellyfish > 0) {
      const [c, g] = JELLY_COLORS[lvl.biome] ?? JELLY_COLORS.reef;
      const geo = buildJellyGeometry(lvl.seed);
      this.jellyPhase = new InstancedBufferAttribute(new Float32Array(hz.jellyfish), 1);
      geo.setAttribute('aPhase', this.jellyPhase);
      const mat = jellyMaterial(c, g);
      this.jellyMesh = new InstancedMesh(geo, mat, hz.jellyfish);
      this.jellyMesh.instanceMatrix.setUsage(DynamicDrawUsage);
      this.jellyMesh.frustumCulled = false;
      this.jellyMesh.renderOrder = 3;
      this.group.add(this.jellyMesh);
      this.disposables.push(geo, mat);
      for (let i = 0; i < hz.jellyfish; i++) {
        let x = spread(hz.jellyfish, i, 12);
        if (Math.abs(x - startX) < 10) x += 14;
        const home = this.rng.range(0.3, 0.8) * H;
        const j: Jelly = {
          x,
          y: home,
          prevX: x,
          prevY: home,
          size: this.rng.range(0.85, 1.3),
          phase: this.rng.range(0, Math.PI * 2),
          cooldown: 0,
          home,
          seed: this.rng.range(0, 100),
        };
        this.jellyPhase.setX(i, j.phase);
        this.jellies.push(j);
      }
    }

    if (hz.mines > 0) {
      const geo = buildMineGeometry();
      const mat = mineMaterial();
      this.mineMesh = new InstancedMesh(geo, mat, hz.mines);
      this.mineMesh.castShadow = this.quality.shadows;
      this.mineMesh.frustumCulled = false;
      const chainGeo = new CylinderGeometry(0.05, 0.05, 1, 5, 1);
      chainGeo.translate(0, 0.5, 0);
      const cmat = chainMaterial();
      this.chainMesh = new InstancedMesh(chainGeo, cmat, hz.mines);
      this.chainMesh.frustumCulled = false;
      const lampGeo = new SphereGeometry(0.12, 10, 8);
      const lampMat = new MeshBasicMaterial({ color: '#ff3b3b' });
      this.lampMesh = new InstancedMesh(lampGeo, lampMat, hz.mines);
      this.lampMesh.frustumCulled = false;
      this.lampMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(hz.mines * 3), 3);
      this.group.add(this.mineMesh, this.chainMesh, this.lampMesh);
      this.disposables.push(geo, mat, chainGeo, cmat, lampGeo, lampMat);
      for (let i = 0; i < hz.mines; i++) {
        let x = spread(hz.mines, i, 16);
        if (Math.abs(x - startX) < 12) x += 16;
        const floor = this.world.env.floorAt(x);
        const anchorY = floor + this.rng.range(0.25, 0.6) * (H - floor);
        this.mines.push({ x, baseX: x, y: anchorY, anchorY, floor, alive: true, respawn: 0, warn: 0, seed: this.rng.range(0, 100) });
      }
    }

    if (hz.oysters > 0) {
      this.shellGeo = { top: buildShellGeometry(true), bottom: buildShellGeometry(false) };
      const shellMat = shellMaterial();
      const whitePearl = pearlMaterial(false);
      const blackPearl = pearlMaterial(true);
      const pearlGeo = new SphereGeometry(0.26, 20, 14);
      this.disposables.push(this.shellGeo.top, this.shellGeo.bottom, shellMat, whitePearl, blackPearl, pearlGeo);
      for (let i = 0; i < hz.oysters; i++) {
        let x = spread(hz.oysters, i, 14);
        if (Math.abs(x - startX) < 8) x += 10;
        for (const m of this.mines) if (Math.abs(m.x - x) < 5) x += 7;
        const y = this.world.env.floorAt(x) + 0.12;
        const root = new Group();
        root.position.set(x, y, 0.6);
        root.rotation.y = -Math.PI / 2 + 0.35;
        root.scale.setScalar(0.95);
        const bottom = new Mesh(this.shellGeo.bottom, shellMat);
        const topPivot = new Group();
        topPivot.position.set(-0.02, 0.02, 0);
        const top = new Mesh(this.shellGeo.top, shellMat);
        topPivot.add(top);
        const black = this.rng.chance(HAZARD.blackPearlChance);
        const pearl = new Mesh(pearlGeo, black ? blackPearl : whitePearl);
        pearl.position.set(0.48, 0.18, 0);
        pearl.userData.white = whitePearl;
        pearl.userData.black = blackPearl;
        bottom.castShadow = top.castShadow = this.quality.shadows;
        root.add(bottom, topPivot, pearl);
        this.group.add(root);
        this.oysters.push({ x, y, t: this.rng.range(0, 7.5), open: 0, hasPearl: true, black, regrow: 0, root, top: topPivot, pearl });
      }
    }

    const geysers = hz.geysers ?? 0;
    if (geysers > 0) {
      const G = HAZARD.geyser;
      const ventGeo = buildGeyserVentGeometry(lvl.seed + 77);
      const ventMat = geyserVentMaterial();
      const colGeo = buildGeyserColumnGeometry();
      const glowGeo = new SphereGeometry(0.42, 14, 8);
      this.disposables.push(ventGeo, ventMat, colGeo, glowGeo);
      const taken = [...this.mines.map((m) => m.x), ...this.oysters.map((o) => o.x)];
      const placed: number[] = [];
      for (let i = 0; i < geysers; i++) {
        let x = spread(geysers, i, 14);
        for (let tries = 0; tries < 16; tries++) {
          const clash = Math.abs(x - startX) < 12 || taken.some((t) => Math.abs(t - x) < 4) || placed.some((t) => Math.abs(t - x) < 9);
          if (!clash) break;
          x = this.rng.range(-W / 2 + 8, W / 2 - 8);
        }
        placed.push(x);
        const floor = this.world.env.floorAt(x);
        const vent = new Mesh(ventGeo, ventMat);
        vent.position.set(x, floor - 0.3, 0);
        vent.scale.set(1.35, 0.8, 1.35);
        vent.rotation.y = this.rng.range(0, Math.PI * 2);
        vent.receiveShadow = this.quality.shadows;
        const glowMat = new MeshBasicMaterial({ color: '#ff5a1f', transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
        const glow = new Mesh(glowGeo, glowMat);
        glow.position.set(x, floor - 0.02, 0);
        glow.scale.set(0.95, 0.35, 0.95);
        const columnMat = geyserColumnMaterial();
        const columnMesh = new Mesh(colGeo, columnMat);
        columnMesh.position.set(x, floor, 0);
        columnMesh.frustumCulled = false;
        columnMesh.renderOrder = 6;
        columnMesh.visible = false;
        this.group.add(vent, glow, columnMesh);
        this.disposables.push(glowMat, columnMat);
        const period = this.rng.range(G.period[0], G.period[1]);
        this.geysers.push({
          x,
          floor,
          t: this.rng.range(0, period * 0.8),
          period,
          height: (H - floor) * this.rng.range(G.reach[0], G.reach[1]),
          warn: 0,
          column: 0,
          hit: false,
          columnMesh,
          columnMat,
          glowMat,
        });
      }
    }
  }

  setViewport(_h: number, _fov: number, _dpr: number): void {}

  update(dt: number): void {
    this.time += dt;
    const w = this.world;
    const p = w.player;
    const playing = w.mode === 'play' && w.started && w.phase === 'play';

    // Jellyfish: pulse upward, sink slowly, drift with the current.
    for (const j of this.jellies) {
      j.prevX = j.x;
      j.prevY = j.y;
      const ph = this.time * 2.4 + j.phase;
      const thrust = Math.max(0, Math.cos(ph));
      j.y += (thrust * thrust * 0.9 - 0.28) * dt * j.size + (j.home - j.y) * 0.04 * dt;
      j.x += Math.sin(this.time * 0.13 + j.seed) * 0.35 * dt;
      j.y = clamp(j.y, w.env.floorAt(j.x) + 3.2 * j.size, Math.max(w.env.floorAt(j.x) + 3.2 * j.size, w.surfaceY - 1.2 * j.size));
      j.cooldown = Math.max(0, j.cooldown - dt);
      if (!playing || !p.alive || j.cooldown > 0) continue;
      const bell = 0.85 * j.size + p.radius;
      const dx = p.x - j.x;
      const dyBell = p.y - (j.y + 0.25 * j.size);
      const inBell = dx * dx + dyBell * dyBell < bell * bell;
      const tentTop = j.y;
      const tentBottom = j.y - 2.6 * j.size;
      const inTent = Math.abs(dx) < 0.75 * j.size + p.radius * 0.7 && p.y < tentTop && p.y > tentBottom;
      if (!inBell && !inTent) continue;
      j.cooldown = HAZARD.jellyCooldown;
      const d = Math.hypot(dx, p.y - j.y) || 1;
      p.vel.x = (dx / d) * 7;
      p.vel.y = ((p.y - j.y) / d) * 5;
      if (p.protected) {
        w.effects.ring(p.x, p.y, tmpColor.set('#9ff4ff'), p.len * 2, 0.35, 0.25);
        continue;
      }
      p.stun = HAZARD.stingStun;
      p.hurtFlash = 1;
      w.scoring.breakCombo();
      w.effects.sparkle(p.x, p.y, tmpColor.set('#f7ff9a'), 22, 3.5, 0.3);
      w.events.emit('sting', { x: p.x, y: p.y });
    }

    // Mines
    const drift = w.level.hazards.mineDrift ?? 0;
    for (const m of this.mines) {
      if (!m.alive) {
        m.respawn -= dt;
        if (m.respawn <= 0) this.respawnMine(m);
        continue;
      }
      const bob = Math.sin(this.time * 0.8 + m.seed) * 0.28;
      if (drift > 0) {
        const chain = m.anchorY - m.floor;
        const dx = mineSwing(this.time, m.seed, drift, chain);
        m.x = m.baseX + dx;
        m.y = m.floor + Math.sqrt(chain * chain - dx * dx) + bob;
      } else {
        m.y = m.anchorY + bob;
      }
      const pd = Math.hypot(p.x - m.x, p.y - m.y);
      m.warn = p.alive && w.mode === 'play' ? clamp(1 - (pd - 1.5) / 6, 0, 1) : 0;
      if (playing && p.alive && pd < 0.95 + p.radius * 0.8) {
        this.explode(m);
        continue;
      }
      // Behind the menus mines just bob; fish blowing them up there is noise, not play.
      if (w.mode !== 'play') continue;
      for (const f of w.spawner.fish) {
        if (!f.alive || f.tier < 2) continue;
        if (Math.hypot(f.x - m.x, f.y - m.y) < 0.9 + f.radius) {
          this.explode(m);
          break;
        }
      }
    }

    // Oysters open and close on a cycle; the pearl can only be taken while open.
    for (const o of this.oysters) {
      o.t = (o.t + dt) % 7.5;
      const t = o.t;
      o.open = t < 3.8 ? 0 : t < 4.4 ? smoothstep(3.8, 4.4, t) : t < 6.9 ? 1 : 1 - smoothstep(6.9, 7.5, t);
      if (!o.hasPearl) {
        o.regrow -= dt;
        if (o.regrow <= 0) {
          o.hasPearl = true;
          o.black = this.rng.chance(HAZARD.blackPearlChance);
          o.pearl.material = o.black ? o.pearl.userData.black : o.pearl.userData.white;
        }
      }
      if (!playing || !p.alive || !o.hasPearl || o.open < 0.6) continue;
      const px = o.x;
      const py = o.y + 0.35;
      if (Math.hypot(p.mouthX - px, p.mouthY - py) < p.mouthRadius + 0.55) {
        o.hasPearl = false;
        o.regrow = HAZARD.pearlRegrow;
        w.scoring.pearls++;
        const col = tmpColor.set(o.black ? '#c58bff' : '#fff4d6');
        w.effects.pickupBurst(px, py, col);
        if (o.black) {
          w.gainLife(px, py);
          w.events.emit('pickup', { kind: 'blackPearl', x: px, y: py });
        } else {
          w.award(HAZARD.pearlPoints, px, py, 'Pearl!', '#fff1c1');
          w.events.emit('pickup', { kind: 'pearl', x: px, y: py });
        }
      }
    }

    this.updateGeysers(dt, playing);

    // Sinking pickups
    if (playing) {
      this.nextPickup -= dt;
      if (this.nextPickup <= 0) {
        this.nextPickup = this.rng.range(HAZARD.pickupInterval[0], HAZARD.pickupInterval[1]);
        this.spawnPickup();
      }
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      k.t += dt;
      const floor = w.env.floorAt(k.x) + 0.7;
      if (k.y > floor) {
        k.y = Math.max(floor, k.y - 0.95 * dt);
        k.x += Math.sin(k.t * 1.4) * 0.45 * dt;
      } else {
        k.landed += dt;
      }
      let remove = k.landed > 6;
      if (!remove && playing && p.alive && Math.hypot(p.x - k.x, p.y - k.y) < p.radius + 0.7) {
        this.collect(k);
        remove = true;
      }
      if (remove) {
        k.mesh.removeFromParent();
        (k.bubble.material as Material).dispose();
        this.pickups.splice(i, 1);
      }
    }
  }

  /** Geysers glow as a warning, then erupt in a column that scalds the player and kills fish. */
  private updateGeysers(dt: number, playing: boolean): void {
    const w = this.world;
    const p = w.player;
    const G = HAZARD.geyser;
    for (const g of this.geysers) {
      if (w.mode !== 'play') {
        g.warn = 0;
        g.column = 0;
        continue;
      }
      const prev = g.t;
      g.t += dt;
      if (g.t >= g.period) {
        g.t -= g.period;
        g.period = this.rng.range(G.period[0], G.period[1]);
        g.hit = false;
      }
      const eruptAt = g.period - G.erupt;
      const warnAt = eruptAt - G.warn;
      const erupting = g.t >= eruptAt;
      g.warn = erupting ? 1 : g.t >= warnAt ? smoothstep(warnAt, eruptAt, g.t) : 0;
      const et = g.t - eruptAt;
      g.column = erupting ? Math.min(1, et / 0.25) * (1 - smoothstep(G.erupt - 0.5, G.erupt, et)) : 0;

      const near = Math.abs(g.x - w.rig.center.x) < w.rig.viewW * 0.8;
      if (near && w.mode === 'play') {
        if (prev < warnAt && g.t >= warnAt) w.events.emit('geyser', { x: g.x, y: g.floor, erupt: false });
        if (prev < eruptAt && g.t >= eruptAt) w.events.emit('geyser', { x: g.x, y: g.floor, erupt: true });
      }
      if (near && g.warn > 0) w.effects.geyserSpray(g.x, g.floor + 0.35, g.height * g.column, dt, erupting && g.column > 0.3);
      if (g.column < 0.15) continue;

      const top = g.floor + g.height * g.column;
      let kills = 0;
      for (const f of w.spawner.fish) {
        if (!f.alive || f.y > top || Math.abs(f.x - g.x) > G.halfWidth + f.radius * 0.6) continue;
        f.alive = false;
        w.effects.deathCloud(f.x, f.y, Math.min(1.5, f.len * 0.4));
        if (w.mode === 'play' && isThreat(w.stage, f.tier)) kills += TIER_POINTS[f.tier] * 2;
      }
      if (kills > 0 && p.alive) w.award(kills, g.x, top, 'Geyser kill!', '#ffb36b');

      if (!playing || !p.alive || g.hit || p.y > top + p.radius * 0.5 || Math.abs(p.x - g.x) > G.halfWidth + p.radius * 0.7) continue;
      g.hit = true;
      const side = Math.sign(p.x - g.x) || 1;
      p.vel.x = side * G.knock;
      p.vel.y = G.knock * 0.7;
      if (p.protected) {
        w.effects.ring(p.x, p.y, tmpColor.set('#9ff4ff'), p.len * 2, 0.35, 0.25);
        continue;
      }
      p.stun = G.stun;
      p.hurtFlash = 1;
      w.scoring.breakCombo();
      w.effects.sparkle(p.x, p.y, tmpColor.set('#ffb050'), 26, 4, 0.35);
      w.events.emit('scald', { x: p.x, y: p.y });
    }
  }

  private respawnMine(m: Mine): void {
    const w = this.world;
    const v = w.rig.viewRect();
    const W = w.level.world.width;
    const H = w.level.world.height;
    for (let attempt = 0; attempt < 20; attempt++) {
      const x = this.rng.range(-W / 2 + 10, W / 2 - 10);
      if (x > v.x0 - 6 && x < v.x1 + 6) continue;
      if (this.mines.some((o) => o !== m && o.alive && Math.abs(o.x - x) < 10)) continue;
      m.x = x;
      m.baseX = x;
      m.floor = w.env.floorAt(x);
      m.anchorY = m.floor + this.rng.range(0.25, 0.6) * (H - m.floor);
      m.y = m.anchorY;
      m.alive = true;
      return;
    }
    m.respawn = 3;
  }

  private explode(m: Mine): void {
    const w = this.world;
    const p = w.player;
    m.alive = false;
    m.respawn = 20;
    const r = HAZARD.mineBlastRadius;
    w.effects.explosion(m.x, m.y, r);
    let kills = 0;
    for (const f of w.spawner.fish) {
      if (!f.alive) continue;
      if (Math.hypot(f.x - m.x, f.y - m.y) > r + f.radius) continue;
      f.alive = false;
      w.effects.deathCloud(f.x, f.y, Math.min(1.5, f.len * 0.4));
      if (w.mode === 'play' && isThreat(w.stage, f.tier)) kills += TIER_POINTS[f.tier] * 3;
    }
    const hitPlayer = p.alive && Math.hypot(p.x - m.x, p.y - m.y) < r * 0.75 + p.radius;
    const lethal = hitPlayer && !p.protected;
    if (hitPlayer) {
      if (!lethal) {
        const d = Math.hypot(p.x - m.x, p.y - m.y) || 1;
        p.vel.x = ((p.x - m.x) / d) * 10;
        p.vel.y = ((p.y - m.y) / d) * 10;
      } else {
        w.killPlayer(null);
      }
    }
    if (kills > 0 && p.alive) w.award(kills, m.x, m.y + 1, 'Mine kill!', '#ffb36b');
    w.events.emit('explosion', { x: m.x, y: m.y, hitPlayer: lethal });
  }

  private spawnPickup(): void {
    const w = this.world;
    const v = w.rig.viewRect();
    const W = w.level.world.width;
    const kind = this.rng.weighted(PICKUP_WEIGHTS);
    const x = clamp(this.rng.range(v.x0 + 3, v.x1 - 3), -W / 2 + 3, W / 2 - 3);
    const y = Math.min(w.surfaceY - 1.2, v.y1 + 1.2);
    let asset = this.pickupAssets.get(kind);
    if (!asset) {
      asset = { geo: buildPickupGeometry(kind), mat: pickupMaterial(kind) };
      this.pickupAssets.set(kind, asset);
      this.disposables.push(asset.geo, asset.mat);
    }
    const g = new Group();
    const core = new Mesh(asset.geo, asset.mat);
    const bubble = new Mesh(this.bubbleGeo, bubbleMaterial(PICKUP_COLORS[kind], 0.9));
    bubble.scale.setScalar(0.62);
    g.add(core, bubble);
    g.position.set(x, y, 0.5);
    this.group.add(g);
    this.pickups.push({ kind, x, y, t: 0, landed: 0, mesh: g, bubble });
  }

  private collect(k: Pickup): void {
    const w = this.world;
    const p = w.player;
    w.effects.pickupBurst(k.x, k.y, tmpColor.set(PICKUP_COLORS[k.kind]));
    switch (k.kind) {
      case 'gem':
        w.award(HAZARD.gemPoints, k.x, k.y, 'Gem!', PICKUP_COLORS.gem);
        break;
      case 'speed':
        p.speedBoost = HAZARD.speedBoost.duration;
        break;
      case 'shield':
        p.shield = Math.max(p.shield, HAZARD.shieldDuration * w.shieldMul);
        p.shieldIsPickup = true;
        break;
      case 'life':
        w.gainLife(k.x, k.y);
        break;
    }
    w.events.emit('pickup', { kind: k.kind, x: k.x, y: k.y });
  }

  render(alpha: number, _dt: number): void {
    const w = this.world;
    if (this.jellyMesh) {
      this.jellies.forEach((j, i) => {
        v3.set(j.prevX + (j.x - j.prevX) * alpha, j.prevY + (j.y - j.prevY) * alpha, -0.2);
        q.identity();
        s3.setScalar(j.size);
        m4.compose(v3, q, s3);
        this.jellyMesh!.setMatrixAt(i, m4);
      });
      this.jellyMesh.instanceMatrix.needsUpdate = true;
    }
    if (this.mineMesh && this.chainMesh && this.lampMesh) {
      let n = 0;
      for (const m of this.mines) {
        if (!m.alive) continue;
        q.setFromAxisAngle(v3.set(0, 1, 0), this.time * 0.3 + m.seed);
        m4.compose(v3.set(m.x, m.y, 0), q, s3.setScalar(1));
        this.mineMesh.setMatrixAt(n, m4);
        const cdx = m.x - m.baseX;
        const cdy = m.y - 0.7 - m.floor;
        const len = Math.max(0.1, Math.hypot(cdx, cdy));
        q.setFromAxisAngle(v3.set(0, 0, 1), -Math.atan2(cdx, Math.max(0.1, cdy)));
        m4.compose(v3.set(m.baseX, m.floor, 0), q, s3.set(1, len, 1));
        this.chainMesh.setMatrixAt(n, m4);
        q.identity();
        m4.compose(v3.set(m.x, m.y + 0.78, 0), q, s3.setScalar(1));
        this.lampMesh.setMatrixAt(n, m4);
        const rate = 2 + m.warn * 10;
        const blink = Math.sin(this.time * rate * Math.PI) > 0 ? 1 : 0.15;
        tmpColor.setRGB(3 * blink + m.warn * 2, 0.25 * blink, 0.2 * blink);
        this.lampMesh.setColorAt(n, tmpColor);
        n++;
      }
      for (const mesh of [this.mineMesh, this.chainMesh, this.lampMesh]) {
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
      }
      if (this.lampMesh.instanceColor) this.lampMesh.instanceColor.needsUpdate = true;
    }
    for (const g of this.geysers) {
      const h = Math.max(0.01, g.height * g.column);
      g.columnMesh.visible = g.column > 0.01;
      g.columnMesh.scale.set(1, h, 1);
      g.columnMat.uniforms.uIntensity.value = g.column;
      g.columnMat.uniforms.uHeight.value = h;
      const flick = 0.85 + 0.15 * Math.sin(this.time * 23 + g.x);
      g.glowMat.color.setRGB(1, 0.22, 0.04).multiplyScalar((0.2 + g.warn * 1.3) * flick);
    }
    for (const o of this.oysters) {
      o.top.rotation.z = o.open * 0.95;
      o.pearl.visible = o.hasPearl;
      const pulse = 1 + Math.sin(this.time * 4 + o.x) * 0.06;
      o.pearl.scale.setScalar(pulse);
    }
    for (const k of this.pickups) {
      k.mesh.position.set(k.x, k.y + Math.sin(k.t * 2.2) * 0.12, 0.5);
      k.mesh.children[0].rotation.set(Math.sin(k.t) * 0.3, k.t * 1.8, 0);
      k.mesh.visible = k.landed < 4 || Math.sin(k.landed * 20) > 0;
    }
    const p = w.player;
    const show = p.visible && p.shield > 0;
    this.shield.visible = show;
    if (show) {
      const px = p.prevX + (p.x - p.prevX) * alpha;
      const py = p.prevY + (p.y - p.prevY) * alpha;
      this.shield.position.set(px, py, p.z);
      this.shield.scale.set(p.len * 0.68, p.len * 0.5, p.len * 0.5);
      const mat = this.shield.material as ReturnType<typeof bubbleMaterial>;
      const expiring = p.shield < 1 ? (Math.sin(this.time * 24) > 0 ? 1 : 0.3) : 1;
      mat.uniforms.uStrength.value = expiring * (0.85 + Math.sin(this.time * 5) * 0.15);
    }
  }

  /** Jellies near a point (used by AI to steer around them). */
  get jellyCount(): number {
    return this.jellies.length;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const k of this.pickups) (k.bubble.material as Material).dispose();
    this.bubbleGeo.dispose();
    this.group.removeFromParent();
  }
}
