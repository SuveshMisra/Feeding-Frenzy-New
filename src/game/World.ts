import { Color, Mesh, Scene, Vector2, type Material } from 'three';
import { createNoise2D } from 'simplex-noise';
import type { LevelDef } from '../config/levels';
import { SPECIES, type SpeciesId } from '../config/species';
import { HEROES, bonusLives, cooldownMul, shieldMul, speedMul, type HeroId, type UpgradeKind } from '../config/progression';
import { LIVES, PUFF_ABILITY, RESPAWN_SHIELD_S, SUCTION, TIER_POINTS, type Stage, type Tier } from '../config/tuning';
import { Emitter } from '../engine/events';
import { DEG, clamp, distToSegmentSq } from '../engine/math';
import { Rng } from '../engine/rng';
import type { QualityPreset } from '../app/Quality';
import type { FishFactory } from '../art/fish/FishFactory';
import { Environment } from '../env/Environment';
import type { Input } from '../input/Input';
import type { CameraRig, ViewRect } from '../render/CameraRig';
import { Effects } from '../render/Effects';
import { FishDrawer } from '../render/FishDrawer';
import { updateFish, updateSchool, type AiContext } from './ai/behaviors';
import type { PredatorState } from './ai/PredatorBrain';
import { SpatialHash } from './ai/SpatialHash';
import type { Fish } from './entities/Fish';
import { Player, puffKnock, type MoveBounds } from './entities/Player';
import { isThreat, playerCanEat } from './systems/FoodChain';
import { Growth } from './systems/Growth';
import { Lives } from './systems/Lives';
import { Scoring, computeLevelBonus, starsFor, type LevelBonus } from './systems/Scoring';
import { GOLDEN, Spawner } from './systems/Spawner';
import { makeCone, pullToward, type SuctionCone } from './systems/Suction';
import { ChallengeTracker, challengeLabel } from './systems/Challenges';
import { GreatWhite } from './hazards/GreatWhite';
import { Hazards } from './hazards/Hazards';
import { createFeature } from './features';
import { spikeMaterial, spikeShellGeometry } from './features/art';
import type { FlowVec, LevelFeature } from './features/types';

export type WorldMode = 'play' | 'attract';
export type WorldPhase = 'play' | 'dead' | 'complete' | 'over';

export interface LevelResult {
  levelId: string;
  levelIndex: number;
  score: number;
  baseScore: number;
  bonus: LevelBonus;
  stars: 1 | 2 | 3;
  fishEaten: number;
  maxCombo: number;
  time: number;
  deaths: number;
  pearls: number;
  /** Coins from golden fish eaten this run. */
  goldenCoins: number;
  /** Which of the level's challenges this run completed. */
  challenges: boolean[];
}

export interface WorldEvents {
  eat: { x: number; y: number; points: number; multiplier: number; combo: number; frenzy: 0 | 1 | 2; tier: Tier; species: SpeciesId; gold: boolean };
  golden: { x: number; y: number; coins: number };
  challenge: { index: number; label: string };
  /** A level feature hurt the player (stun, no life lost). */
  hurt: { x: number; y: number; label: string };
  /** Something happened in the level's signature mechanic; App picks the sound and text. */
  feature: { kind: string; x: number; y: number };
  grow: { stage: Stage; x: number; y: number };
  death: { lives: number; x: number; y: number; gameOver: boolean };
  respawn: { x: number; y: number };
  gameOver: { score: number };
  complete: LevelResult;
  celebrate: { x: number; y: number };
  alert: { fish: Fish };
  predator: { fish: Fish; from: PredatorState; to: PredatorState };
  bonus: { x: number; y: number; points: number; label: string; color?: string };
  life: { lives: number; x: number; y: number };
  sting: { x: number; y: number };
  explosion: { x: number; y: number; hitPlayer: boolean };
  pickup: { kind: string; x: number; y: number };
  shieldBlock: { x: number; y: number };
  boost: { x: number; y: number };
  suction: { x: number; y: number };
  puff: { x: number; y: number; hit: number };
  geyser: { x: number; y: number; erupt: boolean };
  scald: { x: number; y: number };
}

export interface WorldOptions {
  level: LevelDef;
  quality: QualityPreset;
  factory: FishFactory;
  rig: CameraRig;
  input: Input | null;
  mode: WorldMode;
  viewport: () => { width: number; height: number; dpr: number };
  hero?: HeroId;
  /** Shop upgrade tiers. */
  upgrades?: Record<UpgradeKind, number>;
}

const PLAYER_Z = 0.35;
const tmpColor = new Color();

export class World {
  readonly scene = new Scene();
  readonly rig: CameraRig;
  readonly env: Environment;
  readonly effects: Effects;
  readonly drawer: FishDrawer;
  readonly player: Player;
  readonly spawner: Spawner;
  readonly growth: Growth;
  readonly scoring = new Scoring();
  readonly lives: Lives;
  readonly hazards: Hazards;
  readonly feature: LevelFeature | null;
  /** Ocean II's patrolling great white (play mode only). */
  readonly greatWhite: GreatWhite | null;
  readonly challenges: ChallengeTracker;
  readonly events = new Emitter<WorldEvents>();
  readonly level: LevelDef;
  readonly mode: WorldMode;
  /** Shop upgrade: multiplies every shield the player gets. */
  readonly shieldMul: number;
  phase: WorldPhase = 'play';
  /** Set by the level feature each step: predator detection multiplier. */
  detectMul = 1;
  /** Set by the level feature each step: the player is out of sight. */
  playerHidden = false;
  /** Seconds the player has stayed hidden. */
  hiddenTime = 0;
  /** Set by the level feature each step: how much longer hunters search for a hidden player. */
  searchMul = 1;
  /** Set by the level feature each step: below 0 shades the player darker. */
  playerShade = 0;
  /** Set by the level feature: hides the off-screen threat arrows (darkness). */
  hideThreatArrows = false;
  /** Darkness closing in around the player: 0..1 amount, visible radius in world units. */
  readonly vision = { dark: 0, radius: 12 };
  /** 0..1 red heat haze at the screen edges. */
  heatHaze = 0;
  goldenCoins = 0;
  /** False while the level intro is showing: the player can't be hunted and the clock doesn't run. */
  started = false;
  time = 0;
  /** 0..1 how much danger the player is in (drives the music danger layer). */
  danger = 0;
  private phaseTimer = 0;
  private gameOverPending = false;
  private simTime = 0;
  private readonly hash = new SpatialHash<Fish>(2.5);
  private readonly ai: AiContext;
  private readonly bounds: MoveBounds;
  private readonly input: Input | null;
  private readonly viewport: WorldOptions['viewport'];
  private readonly target = new Vector2();
  private readonly cone: SuctionCone = { x: 0, y: 0, dirX: 1, dirY: 0, reach: 1, cosHalf: 1 };
  private readonly view: ViewRect = { x0: 0, x1: 0, y0: 0, y1: 0 };
  private readonly rng: Rng;
  private attractX = 0;
  private attractDir = 1;
  /** Spike's spines, shown while puffed. */
  private readonly puffShell: Mesh | null = null;
  private readonly biters: Fish[] = [];
  private readonly siltColor: Color;

  constructor(opts: WorldOptions) {
    this.level = opts.level;
    this.mode = opts.mode;
    this.input = opts.input;
    this.viewport = opts.viewport;
    this.rng = new Rng(opts.level.seed + 5);
    const hero = HEROES[opts.hero ?? 'finn'];
    this.player = new Player({
      def: SPECIES[hero.species],
      ability: hero.ability,
      speedMul: speedMul(opts.upgrades?.speed ?? 0),
      cooldownMul: cooldownMul(opts.upgrades?.cooldown ?? 0),
    });
    this.shieldMul = shieldMul(opts.upgrades?.shield ?? 0);
    this.lives = new Lives(Math.min(LIVES.max, LIVES.start + bonusLives(opts.upgrades?.life ?? 0)), LIVES.max);
    this.challenges = new ChallengeTracker(opts.level.challenges);
    const vp = opts.viewport();
    this.rig = opts.rig;
    this.rig.setAspect(vp.width / vp.height);
    const W = opts.level.world.width;
    const H = opts.level.world.height;
    this.rig.bounds = { minX: -W / 2, maxX: W / 2, minY: -0.8, maxY: H + 0.6 };
    this.env = new Environment(opts.level, opts.quality);
    this.scene.add(this.env.group);
    const sand = this.env.biome.sand;
    this.siltColor = new Color(sand.base).lerp(new Color('#6e6450'), 0.3);
    this.effects = new Effects(Math.round(2400 * opts.quality.particles));
    this.effects.density = opts.quality.particles;
    this.scene.add(this.effects.group);
    this.drawer = new FishDrawer(opts.factory, this.scene, opts.quality.shadows);
    const roster = new Set<SpeciesId>([this.player.def.id]);
    for (const list of Object.values(opts.level.roster)) for (const id of list) roster.add(id);
    this.drawer.prepare(roster);
    if (this.player.ability === 'puff') {
      this.puffShell = new Mesh(spikeShellGeometry(), spikeMaterial());
      this.puffShell.visible = false;
      this.scene.add(this.puffShell);
    }

    this.bounds = {
      minX: -W / 2,
      maxX: W / 2,
      surfaceY: H,
      floorAt: this.env.floorAt,
    };
    this.growth = new Growth(opts.level.fishPerStage);
    this.spawner = new Spawner(opts.level, this.bounds);
    this.hazards = new Hazards(this, opts.quality);
    this.feature = createFeature(opts.level.feature, this, opts.quality);
    this.greatWhite = this.mode === 'play' && opts.level.greatWhite ? new GreatWhite(this, opts.level.greatWhite) : null;
    const feature = this.feature;
    const noiseRng = new Rng(opts.level.seed + 17);
    this.ai = {
      dt: 1 / 60,
      time: 0,
      player: { x: 0, y: 0, vx: 0, vy: 0, len: 1, stage: 1, maxSpeed: 8, alive: false },
      bounds: this.bounds,
      hash: this.hash,
      noise: createNoise2D(() => noiseRng.next()),
      detectRadius: opts.level.difficulty.detectRadius,
      chaseSpeed: opts.level.difficulty.chaseSpeed,
      detectMul: 1,
      hiddenTime: 0,
      flow: feature?.flowAt ? (x, y, out) => feature.flowAt!(x, y, out) : null,
      onPredatorState: (fish, from, to) => {
        if (to === 'alert' && this.mode === 'play') this.events.emit('alert', { fish });
        this.events.emit('predator', { fish, from, to });
      },
    };

    const startX = this.mode === 'attract' ? 0 : -W / 2 + 14;
    const startY = H * 0.42;
    this.player.spawn(startX, startY, this.mode === 'play' ? this.respawnShield : 0);
    this.player.setStage(1, false);
    if (this.mode === 'attract') {
      this.player.alive = false;
      this.player.visible = false;
      this.attractX = this.rng.range(-W / 4, W / 4);
      this.rig.viewHTarget = this.rig.stageViewHeight(1);
    } else {
      this.rig.viewHTarget = this.rig.stageViewHeight(0);
    }
    this.rig.snap(this.mode === 'attract' ? this.attractX : startX, startY);
    this.syncAiPlayer();
    this.spawner.populate(this.spawnContext());
    this.hazards.build();
    this.feature?.build();
  }

  get stage(): Stage {
    return this.growth.stage;
  }

  get respawnShield(): number {
    return RESPAWN_SHIELD_S * this.shieldMul;
  }

  /** Current water level (the tide moves it). */
  get surfaceY(): number {
    return this.bounds.surfaceY;
  }

  setSurfaceY(y: number): void {
    this.bounds.surfaceY = y;
    this.env.setSurfaceY(y);
  }

  /** Water current at a point (zero unless the level has currents). */
  flowAt(x: number, y: number, out: FlowVec): FlowVec {
    if (this.feature?.flowAt) return this.feature.flowAt(x, y, out);
    out.x = 0;
    out.y = 0;
    return out;
  }

  /** Counts toward a level challenge ("Shatter 4 crystals"). */
  stat(key: string, n = 1): void {
    if (this.counting) this.challenges.stat(key, n);
  }

  /** Score and challenge progress only accrue during the run, not the intro or after the win. */
  private get counting(): boolean {
    return this.mode === 'play' && this.started && (this.phase === 'play' || this.phase === 'dead');
  }

  /** Leaves a fish helpless (drifting, can't bite) for `seconds`. Hunters forget the player. */
  stunFish(f: Fish, seconds: number): void {
    f.stunned = Math.max(f.stunned, seconds);
    f.panic = 0;
    f.flash = Math.max(f.flash, 0.6);
    if (f.brain?.hunting) f.brain.enter('giveUp');
  }

  /** Kills a fish with a hazard. Returns the bonus it is worth (only threats pay). */
  killFish(f: Fish, mul = 2): number {
    f.alive = false;
    this.effects.deathCloud(f.x, f.y, Math.min(1.5, f.len * 0.4));
    return this.mode === 'play' && this.started && isThreat(this.growth.stage, f.tier) ? TIER_POINTS[f.tier] * mul : 0;
  }

  /**
   * Knocks the player away from (x, y) and, unless shielded, stuns them and breaks the
   * combo. Returns true when it landed.
   */
  hurtPlayer(x: number, y: number, stun: number, knock: number, label: string, color = '#f7ff9a'): boolean {
    const p = this.player;
    if (!p.alive || this.mode !== 'play' || this.phase !== 'play') return false;
    const dx = p.x - x;
    const dy = p.y - y;
    const d = Math.hypot(dx, dy) || 1;
    p.vel.x = (dx / d) * knock;
    p.vel.y = (dy / d) * knock * 0.8;
    if (p.protected) {
      this.effects.ring(p.x, p.y, tmpColor.set('#9ff4ff'), p.len * 2, 0.35, 0.25);
      this.events.emit('shieldBlock', { x: p.x, y: p.y });
      return false;
    }
    p.stun = Math.max(p.stun, stun);
    p.hurtFlash = 1;
    this.scoring.breakCombo();
    this.effects.sparkle(p.x, p.y, tmpColor.set(color), 22, 3.5, 0.3);
    this.events.emit('hurt', { x: p.x, y: p.y, label });
    return true;
  }

  private syncAiPlayer(): void {
    const p = this.player;
    const v = this.ai.player;
    v.x = p.x;
    v.y = p.y;
    v.vx = p.vel.x;
    v.vy = p.vel.y;
    v.len = p.len;
    v.stage = this.growth.stage;
    v.maxSpeed = p.cruiseSpeed;
    v.alive = this.mode === 'play' && this.started && p.alive && this.phase === 'play';
  }

  /** Hands control to the player after the intro, with a fresh spawn shield. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.player.shield = Math.max(this.player.shield, this.respawnShield);
  }

  private spawnContext() {
    const hasPlayer = this.mode === 'play';
    return {
      stage: this.growth.stage,
      playerX: hasPlayer ? this.player.x : this.rig.center.x,
      playerY: hasPlayer ? this.player.y : this.rig.center.y,
      view: this.rig.viewRect(this.view),
      detectRadius: this.level.difficulty.detectRadius,
      hasPlayer,
    };
  }

  resize(width: number, height: number, dpr: number): void {
    this.rig.setAspect(width / height);
    this.rig.viewHTarget = this.rig.stageViewHeight(this.mode === 'attract' ? 1 : this.growth.stage - 1);
    this.effects.setViewport(height, this.rig.camera.fov, dpr);
    this.env.setViewport(height, this.rig.camera.fov, dpr);
    this.hazards.setViewport(height, this.rig.camera.fov, dpr);
    this.feature?.setViewport?.(height, this.rig.camera.fov, dpr);
  }

  /** Fixed-step simulation. */
  update(dt: number): void {
    this.simTime += dt;
    this.ai.dt = dt;
    this.ai.time = this.simTime;
    const playing = this.mode === 'play';
    if (playing && this.started && this.phase === 'play') this.time += dt;
    if (!this.started) this.player.shield = Math.max(this.player.shield, this.respawnShield);

    // Player
    const p = this.player;
    let target: { x: number; y: number } | null = null;
    let dir: { x: number; y: number; mag: number } | null = null;
    const boostPressed = this.input?.consumeBoost() ?? false;
    if (playing && this.input && p.alive && this.phase !== 'over') {
      const cmd = this.input.read();
      if (cmd.kind === 'target') {
        const vp = this.viewport();
        this.rig.screenToWorld(cmd.sx, cmd.sy, vp.width, vp.height, this.target);
        target = this.target;
      } else if (cmd.kind === 'direction') {
        dir = cmd;
      }
    }
    if (this.phase === 'complete') {
      target = null;
      dir = { x: p.facing, y: 0.15, mag: 0.35 };
    }
    if (boostPressed && playing && this.started && this.phase === 'play') {
      if (p.ability === 'suction') this.trySuction();
      else if (p.ability === 'puff') this.tryPuff();
      else this.tryBoost(target, dir);
    }
    if (this.feature?.flowAt) this.feature.flowAt(p.x, p.y, p.drift);
    p.update(dt, target, dir, this.bounds);
    this.syncAiPlayer();

    // Level feature: may hide the player, dim predator senses, hurt or stun things.
    this.detectMul = 1;
    this.playerHidden = false;
    this.playerShade = 0;
    this.hideThreatArrows = false;
    this.searchMul = 1;
    this.feature?.update(dt);
    this.hiddenTime = this.playerHidden && p.alive ? this.hiddenTime + dt : 0;
    this.ai.detectMul = this.detectMul;
    this.ai.hiddenTime = this.hiddenTime;
    this.ai.searchMul = this.searchMul;

    // Fish AI
    const fish = this.spawner.fish;
    this.hash.clear();
    for (const f of fish) if (f.alive) this.hash.insert(f);
    for (const s of this.spawner.schools) updateSchool(s, this.ai);
    for (const f of fish) if (f.alive) updateFish(f, this.ai);

    if (playing && this.started && p.suckTime > 0 && p.alive && this.phase === 'play') this.applySuction(dt);
    if (playing && this.started) this.collide();
    this.hazards.update(dt);
    this.greatWhite?.update(dt);
    this.scoring.update(dt);
    this.spawner.update(dt, this.spawnContext());
    this.updatePhase(dt);
    this.updateDanger(dt);
    if (playing && this.started) {
      this.challenges.setTime(this.time);
      for (const i of this.challenges.newlyDone()) {
        this.events.emit('challenge', { index: i, label: challengeLabel(this.level.challenges[i]) });
      }
    }
  }

  private collide(): void {
    const p = this.player;
    const stage = this.growth.stage;
    let anticipation = 0;
    const ph = p.headingAngle;
    const pcx = Math.cos(ph);
    const pcy = Math.sin(ph);
    const biters = this.biters;
    for (const f of this.spawner.fish) {
      if (!f.alive || f.appear < 0.35) continue;
      const fh = f.headingAngle;
      const hx = Math.cos(fh) * f.len * 0.36;
      const hy = Math.sin(fh) * f.len * 0.36;
      if (playerCanEat(stage, f.tier)) {
        if (!p.alive || this.phase !== 'play') continue;
        const reach = (p.mouthRadius + f.radius * 0.9) * (p.suckTime > 0 ? 1.5 : 1);
        const d2 = distToSegmentSq(p.mouthX, p.mouthY, f.x - hx, f.y - hy, f.x + hx, f.y + hy);
        if (d2 < reach * reach) {
          if (f.spiky) {
            if (f.biteCooldown <= 0) {
              f.biteCooldown = 1;
              this.hurtPlayer(f.x, f.y, 0.9, 8, 'Ouch, spines!');
            }
            continue;
          }
          if (this.feature?.stings?.(f)) {
            if (f.biteCooldown <= 0) {
              f.biteCooldown = 1;
              if (this.hurtPlayer(f.x, f.y, 1, 8, 'Stung!', '#ffb08a')) this.events.emit('feature', { kind: 'sting', x: f.x, y: f.y });
            }
            continue;
          }
          this.eat(f);
          continue;
        }
        // Open wide when food is just ahead.
        const dx = f.x - p.x;
        const dy = f.y - p.y;
        const ahead = dx * pcx + dy * pcy;
        if (ahead > 0 && ahead < p.len * 1.5 + 1 && Math.abs(dx * pcy - dy * pcx) < p.len * 0.6 + f.radius) {
          anticipation = Math.max(anticipation, 1 - ahead / (p.len * 1.5 + 1));
        }
      } else {
        // A predator that has given up is swimming away with its eyes dimmed; it no longer bites.
        if (!p.alive || this.phase !== 'play' || f.biteCooldown > 0 || f.stunned > 0 || f.brain?.state === 'giveUp') continue;
        const bx = Math.cos(ph) * p.len * 0.3;
        const by = Math.sin(ph) * p.len * 0.3;
        const reach = f.mouthRadius + p.radius * 0.8;
        const d2 = distToSegmentSq(f.mouthX, f.mouthY, p.x - bx, p.y - by, p.x + bx, p.y + by);
        if (d2 < reach * reach) biters.push(f);
      }
    }
    // Bites resolve after every eat, so the fish that finishes the level wins a same-frame tie.
    for (const f of biters) {
      if (!p.alive || this.phase !== 'play') break;
      if (p.puffTime > 0) {
        this.blockBite(f);
        this.stunFish(f, PUFF_ABILITY.stun * 0.6);
      } else if (p.protected) this.blockBite(f);
      else this.killPlayer(f);
    }
    biters.length = 0;
    if (p.suckTime > 0) p.jawTarget = 1;
    else if (p.jaw < 0.95) p.jawTarget = Math.min(0.75, anticipation * 1.2);
  }

  /** Spike puffs up: every threat in range is knocked away and stunned. */
  private tryPuff(): void {
    const p = this.player;
    if (!p.puff()) return;
    const stage = this.growth.stage;
    let hit = 0;
    for (const f of this.spawner.fish) {
      if (!f.alive || f.appear < 0.35 || playerCanEat(stage, f.tier)) continue;
      const k = puffKnock(p.x, p.y, f.x, f.y, PUFF_ABILITY.radius + f.radius + p.len * 0.5, PUFF_ABILITY.knock);
      if (!k) continue;
      f.vel.x = k.x;
      f.vel.y = k.y;
      this.stunFish(f, PUFF_ABILITY.stun);
      f.biteCooldown = Math.max(f.biteCooldown, PUFF_ABILITY.stun);
      hit++;
    }
    if (hit > 0) this.stat('puffStun', hit);
    this.effects.ring(p.x, p.y, tmpColor.set('#ffd27a'), PUFF_ABILITY.radius * 2, 0.4, 0.2);
    this.effects.sparkle(p.x, p.y, tmpColor.set('#fff0c2'), 26, 4, 0.3);
    this.events.emit('puff', { x: p.x, y: p.y, hit });
  }

  private trySuction(): void {
    const p = this.player;
    if (!p.suck()) return;
    this.effects.ring(p.mouthX, p.mouthY, tmpColor.set('#bff8ff'), p.len * 1.4 + 0.5, 0.35, 0.18);
    this.events.emit('suction', { x: p.x, y: p.y });
  }

  /** Pulls edible fish in the cone ahead of the mouth; collide() eats them when they arrive. */
  private applySuction(dt: number): void {
    const p = this.player;
    const cone = makeCone(p.mouthX, p.mouthY, p.headingAngle, p.suckReach, this.cone);
    const stage = this.growth.stage;
    for (const f of this.spawner.fish) {
      if (!f.alive || f.appear < 0.35 || !playerCanEat(stage, f.tier)) continue;
      if (pullToward(cone, f, dt, f.radius) > 0) f.sucked = 0.15;
    }
  }

  private eat(f: Fish): void {
    const p = this.player;
    this.feature?.onEat?.(f);
    f.alive = false;
    const res = this.scoring.eat(f.tier);
    const grow = this.growth.add(1);
    this.challenges.onEat(f.def.id, res.combo);
    if (f.stunned > 0) this.stat('stunEat');
    p.jaw = 1;
    p.jawTarget = 0;
    p.squash = 0.14;
    tmpColor.set(f.golden ? '#ffd257' : f.def.colors.mid);
    this.effects.eatBurst(f.x, f.y, tmpColor, Math.max(0.5, f.len * 0.9));
    this.events.emit('eat', {
      x: f.x,
      y: f.y,
      points: res.points,
      multiplier: res.multiplier,
      combo: res.combo,
      frenzy: res.frenzy,
      tier: f.tier,
      species: f.def.id,
      gold: res.gold,
    });
    if (f.golden && this.mode === 'play') {
      this.scoring.startGoldFrenzy();
      this.goldenCoins += GOLDEN.coins;
      this.effects.sparkle(f.x, f.y, tmpColor.set('#ffe27a'), 40, 5, 0.5);
      this.effects.ring(f.x, f.y, tmpColor.set('#ffd257'), 5, 0.6, 0.2);
      this.events.emit('golden', { x: f.x, y: f.y, coins: GOLDEN.coins });
      this.challenges.onGolden();
    }
    if (grow === 'grew') {
      p.setStage(this.growth.stage);
      p.flash = 1;
      this.rig.viewHTarget = this.rig.stageViewHeight(this.growth.stage - 1);
      this.effects.growBurst(p.x, p.y, p.lenTarget);
      this.events.emit('grow', { stage: this.growth.stage, x: p.x, y: p.y });
    } else if (grow === 'complete') {
      this.phase = 'complete';
      this.phaseTimer = 2.4;
      p.invincible = true;
      p.flash = 1;
      this.effects.growBurst(p.x, p.y, p.len * 1.3);
      this.events.emit('celebrate', { x: p.x, y: p.y });
    }
  }

  private tryBoost(target: { x: number; y: number } | null, dir: { x: number; y: number; mag: number } | null): void {
    const p = this.player;
    let dx = 0;
    let dy = 0;
    if (target) {
      dx = target.x - p.x;
      dy = target.y - p.y;
      if (Math.hypot(dx, dy) < p.len * 0.6) dx = dy = 0;
    } else if (dir && dir.mag > 0) {
      dx = dir.x;
      dy = dir.y;
    }
    if (!p.boost(dx, dy)) return;
    const s = p.speed || 1;
    const tail = p.len * 0.45;
    const tx = p.x - (p.vel.x / s) * tail;
    const ty = p.y - (p.vel.y / s) * tail;
    this.effects.bubbleBurst(tx, ty, PLAYER_Z, 18 + Math.round(p.len * 6), 0.15 + p.len * 0.03, 0.3 + p.len * 0.15, 2.6);
    this.effects.ring(tx, ty, tmpColor.set('#c8fbff'), p.len * 1.8 + 0.6, 0.3, 0.2);
    this.events.emit('boost', { x: p.x, y: p.y });
  }

  private blockBite(f: Fish): void {
    const p = this.player;
    const dx = f.x - p.x;
    const dy = f.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    f.vel.x = (dx / d) * 9;
    f.vel.y = (dy / d) * 9;
    f.biteCooldown = 1.2;
    f.jaw = 1;
    f.brain?.enter('giveUp');
    this.effects.ring(p.x, p.y, tmpColor.set('#9ff4ff'), p.len * 2.4, 0.4, 0.25);
    this.events.emit('shieldBlock', { x: p.x, y: p.y });
  }

  killPlayer(by: Fish | null): void {
    const p = this.player;
    if (!p.alive || this.mode !== 'play') return;
    p.alive = false;
    p.visible = false;
    p.vel.x = p.vel.y = 0;
    if (by) {
      by.jaw = 1;
      by.jawTarget = 0;
      by.biteCooldown = 2;
      by.brain?.enter('giveUp');
    }
    this.effects.deathCloud(p.x, p.y, p.len);
    this.scoring.breakCombo();
    this.scoring.goldTime = 0;
    this.challenges.onDeath();
    const over = this.lives.lose();
    this.gameOverPending = over;
    this.phase = 'dead';
    this.phaseTimer = over ? 1.8 : 1.5;
    this.events.emit('death', { lives: this.lives.count, x: p.x, y: p.y, gameOver: over });
  }

  private updatePhase(dt: number): void {
    if (this.phase === 'dead') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        if (this.gameOverPending) {
          this.phase = 'over';
          this.events.emit('gameOver', { score: this.scoring.score });
        } else {
          this.respawn();
        }
      }
    } else if (this.phase === 'complete') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.phase = 'over';
        this.events.emit('complete', this.result());
      }
    }
  }

  private respawn(): void {
    const p = this.player;
    const v = this.rig.viewRect(this.view);
    const H = this.level.world.height;
    let best = { x: this.rig.center.x, y: H * 0.6, score: -Infinity };
    for (let i = 0; i < 9; i++) {
      const x = clamp(v.x0 + ((i % 3) + 0.5) * ((v.x1 - v.x0) / 3), this.bounds.minX + 3, this.bounds.maxX - 3);
      const y = clamp(v.y0 + (Math.floor(i / 3) + 0.5) * ((v.y1 - v.y0) / 3), this.env.floorAt(x) + 2, H - 2);
      let nearest = Infinity;
      for (const f of this.spawner.fish) {
        if (!f.alive || playerCanEat(this.growth.stage, f.tier)) continue;
        nearest = Math.min(nearest, Math.hypot(f.x - x, f.y - y));
      }
      const score = nearest - Math.hypot(x - this.rig.center.x, y - this.rig.center.y) * 0.25 - (this.greatWhite?.threatAt(x, y) ?? 0) * 30;
      if (score > best.score) best = { x, y, score };
    }
    p.spawn(best.x, best.y, this.respawnShield);
    for (const f of this.spawner.fish) if (f.brain?.hunting) f.brain.enter('giveUp');
    this.phase = 'play';
    this.effects.bubbleBurst(best.x, best.y, PLAYER_Z, 30, 0.16, 0.8, 3);
    this.events.emit('respawn', { x: best.x, y: best.y });
  }

  private updateDanger(dt: number): void {
    let d = 0;
    const p = this.player;
    if (p.alive && this.mode === 'play') {
      for (const f of this.spawner.fish) {
        if (!f.alive || !f.brain || f.mode !== 'predator') continue;
        const s = f.brain.state;
        if (s !== 'chase' && s !== 'alert') continue;
        const dist = Math.hypot(f.x - p.x, f.y - p.y);
        const w = (s === 'chase' ? 1 : 0.55) * clamp(1.4 - dist / 14, 0.3, 1);
        d = Math.max(d, w);
      }
      if (this.greatWhite) d = Math.max(d, this.greatWhite.danger);
    }
    this.danger += (d - this.danger) * Math.min(1, dt * (d > this.danger ? 4 : 1.2));
  }

  result(): LevelResult {
    const bonus = computeLevelBonus(this.time, this.lives.deaths);
    const baseScore = this.scoring.score;
    const score = baseScore + bonus.total;
    return {
      levelId: this.level.id,
      levelIndex: this.level.index,
      score,
      baseScore,
      bonus,
      stars: starsFor(score, this.level.stars),
      fishEaten: this.scoring.fishEaten,
      maxCombo: this.scoring.maxCombo,
      time: this.time,
      deaths: this.lives.deaths,
      pearls: this.scoring.pearls,
      goldenCoins: this.goldenCoins,
      challenges: this.challenges.final(),
    };
  }

  /** Awards points not tied to eating (pearls, gems, mine kills). */
  award(points: number, x: number, y: number, label: string, color?: string): void {
    if (!this.counting) return;
    this.scoring.add(points);
    this.events.emit('bonus', { x, y, points, label, color });
  }

  gainLife(x: number, y: number): void {
    if (this.lives.gain()) this.events.emit('life', { lives: this.lives.count, x, y });
    else this.award(TIER_POINTS[4] * 5, x, y, 'Max lives!', '#ff9ad5');
  }

  /** Variable-rate visual update. */
  render(alpha: number, dt: number): void {
    const p = this.player;
    const px = p.prevX + (p.x - p.prevX) * alpha;
    const py = p.prevY + (p.y - p.prevY) * alpha;
    if (this.mode === 'attract') {
      const W = this.level.world.width;
      this.attractX += this.attractDir * dt * 1.6;
      if (Math.abs(this.attractX) > W / 2 - 25) this.attractDir *= -1;
      this.rig.drift(dt, this.attractX, this.level.world.height * 0.4 + Math.sin(this.simTime * 0.1) * 2);
    } else if (dt > 0) {
      this.rig.update(dt, px, py, p.alive ? p.vel.x : 0, p.alive ? p.vel.y : 0);
    }
    const cam = this.rig.camera;
    this.env.update({
      time: this.simTime,
      dt,
      camera: cam,
      playerX: px,
      playerY: py,
      hasPlayer: this.mode === 'play' && p.visible,
      viewW: this.rig.viewW,
      viewH: this.rig.viewH,
    });
    this.env.playerLight.visible = this.env.biome.playerLight > 0 && p.visible;
    this.effects.update(dt);
    if (p.alive && p.visible && dt > 0) {
      const spd = p.speed / p.maxSpeed;
      const dash = p.boostLevel;
      const tailX = p.x - Math.cos(p.headingAngle) * p.len * 0.45;
      const tailY = p.y - Math.sin(p.headingAngle) * p.len * 0.45;
      if (spd > 0.55 || dash > 0) {
        this.effects.trail(tailX, tailY, PLAYER_Z - 0.1, Math.max(0, spd - 0.5) * 1.4 + dash * 4, dt, 0.06 + p.len * 0.03);
      }
      if (dash > 0.2) this.effects.wake(tailX, tailY, PLAYER_Z - 0.15, p.vel.x, p.vel.y, 0.3 + p.len * 0.25, dt);
      const floor = this.env.floorAt(p.x);
      const above = p.y - floor;
      if (above < 1.6 && spd > 0.35) {
        this.effects.sandPuff(p.x, Math.max(floor, p.y - p.radius), PLAYER_Z, (1 - above / 1.6) * (spd + dash), this.siltColor, dt);
      }
      if (p.suckTime > 0) {
        const a = p.headingAngle;
        this.effects.suctionStream(p.mouthX, p.mouthY, Math.cos(a), Math.sin(a), p.suckReach, SUCTION.halfAngleDeg * DEG, dt);
      }
    }
    this.hazards.render(alpha, dt);
    this.feature?.render(alpha, dt);

    const v = this.rig.viewRect(this.view);
    this.drawer.begin();
    for (const f of this.spawner.fish) {
      if (!f.alive) continue;
      const m = f.len;
      f.onScreen = f.x > v.x0 - m && f.x < v.x1 + m && f.y > v.y0 - m && f.y < v.y1 + m;
      if (f.x < v.x0 - 12 || f.x > v.x1 + 12) continue;
      if (dt > 0 && f.onScreen && f.tier >= 3) {
        const floor = this.env.floorAt(f.x);
        const above = f.y - f.radius - floor;
        if (above < 1 && f.speed > 2) this.effects.sandPuff(f.x, f.y - f.radius, f.z, (1 - above) * f.len * 0.5, this.siltColor, dt);
      }
      if (f.golden) {
        f.tint = 0.85 + 0.15 * Math.sin(this.simTime * 6 + f.uid);
        if (dt > 0 && f.onScreen && Math.random() < dt * 22) {
          const back = f.facing > 0 ? -1 : 1;
          this.effects.sparkle(f.x + back * f.len * 0.45, f.y + (Math.random() - 0.5) * f.radius, tmpColor.set(Math.random() < 0.5 ? '#ffe27a' : '#fff6c8'), 1, 0.8, 0.28);
        }
        if (dt > 0 && f.onScreen && Math.random() < dt * 30) {
          this.effects.mote('glow', f.x, f.y, f.z + 0.2, f.vel.x * 0.3, f.vel.y * 0.3, 0.55, f.len * 1.1, f.len * 0.3, tmpColor.set('#ffc040'), 3, 0, 0.45);
        }
      }
      this.drawer.draw(f, alpha, f.appear, f.golden ? f.scaleMul * 1.3 : f.scaleMul);
    }
    this.feature?.drawFish?.(this.drawer, alpha);
    this.greatWhite?.draw(this.drawer, alpha, dt);
    if (p.visible) {
      const blink = p.shield > 0 && p.shield < 1 ? (Math.sin(this.simTime * 30) > 0 ? 1 : 0.9) : 1;
      p.z = PLAYER_Z;
      p.tint = this.scoring.goldTime > 0 ? 0.22 + 0.12 * Math.sin(this.simTime * 8) : this.playerShade;
      const puff = p.puffLevel;
      this.drawer.draw(p, alpha, 1, (1 + p.squash) * blink * (1 + PUFF_ABILITY.swell * puff));
      if (this.puffShell) {
        this.puffShell.visible = puff > 0.05;
        if (this.puffShell.visible) {
          this.puffShell.position.set(px, py, PLAYER_Z);
          this.puffShell.rotation.set(this.simTime * 0.6, this.simTime * 1.4, 0);
          this.puffShell.scale.setScalar(p.len * 0.33 * (1 + PUFF_ABILITY.swell * puff) * Math.min(1, puff * 1.4));
        }
      }
    } else if (this.puffShell) {
      this.puffShell.visible = false;
    }
    this.drawer.end();
  }

  /** Threats that are hunting the player (for off-screen arrows). */
  huntingThreats(out: Fish[] = []): Fish[] {
    out.length = 0;
    for (const f of this.spawner.fish) {
      if (f.alive && f.mode === 'predator' && f.brain?.hunting) out.push(f);
    }
    return out;
  }

  // Debug helpers
  cheatGrow(): void {
    if (this.growth.complete) return;
    const need = this.growth.perStage - this.growth.points;
    for (let i = 0; i < need - 1; i++) this.growth.add(1);
    const fake = this.spawner.fish.find((f) => f.alive && playerCanEat(this.growth.stage, f.tier));
    if (fake) {
      fake.x = this.player.mouthX;
      fake.y = this.player.mouthY;
    } else {
      const r = this.growth.add(1);
      if (r === 'grew') {
        this.player.setStage(this.growth.stage);
        this.rig.viewHTarget = this.rig.stageViewHeight(this.growth.stage - 1);
        this.events.emit('grow', { stage: this.growth.stage, x: this.player.x, y: this.player.y });
      }
    }
  }

  cheatComplete(): void {
    this.growth.forceStage(3);
    this.player.setStage(3);
    this.growth.points = this.growth.perStage - 1;
    this.cheatGrow();
  }

  dispose(): void {
    this.events.clear();
    this.spawner.clear();
    this.hazards.dispose();
    this.feature?.dispose();
    this.drawer.dispose();
    this.effects.dispose();
    this.env.dispose();
    if (this.puffShell) {
      this.puffShell.geometry.dispose();
      (this.puffShell.material as Material).dispose();
    }
  }
}
