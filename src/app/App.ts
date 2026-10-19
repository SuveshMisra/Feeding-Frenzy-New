import { Scene, Vector2 } from 'three';
import { CHAPTERS, LEVELS, LEVEL_IDS, resolveBiome, type LevelDef } from '../config/levels';
import { SPECIES, type SpeciesId } from '../config/species';
import type { Tier } from '../config/tuning';
import { Loop } from '../engine/Loop';
import { Renderer } from '../engine/Renderer';
import { shared } from '../engine/materialPatches';
import { clamp, lerp, smoothstep } from '../engine/math';
import { CausticsGenerator } from '../art/caustics';
import { FishFactory, type FactoryOptions } from '../art/fish/FishFactory';
import { CameraRig } from '../render/CameraRig';
import { PostFX } from '../render/PostFX';
import { EnvironmentBaker } from '../render/EnvironmentMap';
import { Input } from '../input/Input';
import { World, type LevelResult, type WorldMode } from '../game/World';
import { Hud, type ChainEntry } from '../ui/Hud';
import { Screens, type Reward } from '../ui/Screens';
import { fishThumbnail } from '../ui/Thumbnails';
import { h } from '../ui/dom';
import { AudioEngine } from '../audio/AudioEngine';
import { DEBUG, DebugPanel } from '../debug/DebugPanel';
import { SaveStore, levelOpen, type Settings } from './Save';
import { coinsFor, heroesFor, type HeroId, type UpgradeKind } from '../config/progression';
import { CHALLENGE_COINS } from '../game/systems/Challenges';
import type { SoundName } from '../audio/Sfx';
import { AdaptiveQuality, PRESETS, lowerLevel, resolveQuality, type QualityLevel, type QualityPreset } from './Quality';

/** 'won' covers the celebration before the results: no pausing, so the clear can't be thrown away. */
type AppState = 'title' | 'intro' | 'playing' | 'won' | 'paused' | 'ended';

const HIT_STOP = { scale: 0.08, cooldown: 0.3 };

const ENV_INTENSITY = 0.75;
const HEMI_WITH_ENV = 0.4;

function factoryOptions(q: QualityPreset): FactoryOptions {
  return { physical: q.physical, detail: q.detailNormals, texScale: q.fishTexScale };
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export class App {
  private readonly renderer: Renderer;
  private readonly save: SaveStore;
  private readonly loop: Loop;
  private readonly rig: CameraRig;
  private readonly post: PostFX;
  private readonly caustics: CausticsGenerator;
  private readonly envBaker: EnvironmentBaker;
  private readonly input: Input;
  private readonly hud: Hud;
  private readonly screens: Screens;
  private readonly audio = new AudioEngine();
  private readonly adaptive: AdaptiveQuality;
  private readonly ui: HTMLElement;
  private readonly rotateHint: HTMLElement;
  private factory: FishFactory;
  private qualityLevel: QualityLevel;
  private quality: QualityPreset;
  private world: World | null = null;
  private state: AppState = 'title';
  private readonly timers: number[] = [];
  private levelIndex = 0;
  private hero: HeroId = 'finn';
  private slow = { t: 0, dur: 1, scale: 1 };
  private punch = 0;
  /** Small zoom-in on each bite, decaying back to 0. */
  private nibble = 0;
  private hitStop = 0;
  private lastHitStop = 0;
  private portraitDismissed = false;
  private debug: DebugPanel | null = null;
  private readonly thumbs = new Map<SpeciesId, string>();
  private readonly screenPos = new Vector2();
  private readonly viewport = () => ({ width: this.renderer.width, height: this.renderer.height, dpr: this.renderer.dpr });

  constructor(container: HTMLElement) {
    this.save = new SaveStore(safeStorage(), LEVELS.length);
    const settings = this.save.data.settings;
    this.qualityLevel = resolveQuality(settings.quality);
    this.quality = PRESETS[this.qualityLevel];
    this.renderer = new Renderer(container);
    this.applyRendererQuality();
    this.ui = h('div', { class: 'ui-root' });
    container.append(this.ui);
    this.factory = new FishFactory(factoryOptions(this.quality));
    this.caustics = new CausticsGenerator(this.quality.causticsSize);
    this.caustics.interval = this.quality.causticsInterval;
    shared.uCausticsTex.value = this.caustics.texture;
    this.envBaker = new EnvironmentBaker(this.renderer.gl);
    this.rig = new CameraRig(this.renderer.width / this.renderer.height);
    this.rig.shakeEnabled = settings.shake;
    this.post = new PostFX(this.renderer.gl, new Scene(), this.rig.camera, this.quality);

    this.input = new Input(this.renderer.canvas, this.ui);
    this.input.scheme = settings.controls;
    this.input.enabled = false;
    this.input.onPause = () => this.togglePause();
    this.hud = new Hud(this.ui);
    this.hud.onPause = () => this.togglePause();
    this.hud.onBoost = () => this.input.requestBoost();
    this.screens = new Screens(
      this.ui,
      this.save,
      {
        play: (i, hero) => this.play(i, hero),
        buy: (kind) => this.buy(kind),
        pickHero: (id) => this.save.setHero(id),
        resume: () => this.resume(),
        restart: () => this.play(this.levelIndex, this.hero),
        quit: () => this.toTitle(),
        levels: () => this.toTitle(true),
        next: () => this.screens.startLevel(Math.min(this.levelIndex + 1, LEVELS.length - 1), () => this.toTitle(true)),
        settings: (patch) => this.applySettings(patch),
        fullscreen: () => this.toggleFullscreen(),
        click: () => this.audio.sfx.play('click'),
        sound: (name, opts) => this.audio.sfx.play(name, opts),
        howToSeen: () => this.save.markHowToSeen(),
        clearProgress: () => {
          this.save.resetProgress();
          this.toTitle();
        },
      },
      (id) => this.thumb(id),
    );
    this.rotateHint = h(
      'div',
      {
        class: 'rotate-hint',
        on: {
          click: () => {
            this.portraitDismissed = true;
            this.rotateHint.classList.remove('show');
          },
        },
      },
      h('div', { class: 'rotate-icon', html: '<svg viewBox="0 0 48 48"><rect x="15" y="6" width="18" height="32" rx="3.5"/><path d="M8 30a18 18 0 0018 14" fill="none" stroke-width="3" stroke-linecap="round"/><path d="M22 40l5 4-5 4" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
      h('div', { text: 'Rotate your device for a bigger ocean' }),
      h('div', { class: 'rotate-sub', text: 'Tap to play in portrait anyway' }),
    );
    this.ui.append(this.rotateHint);
    this.audio.setVolumes(settings.music, settings.sfx);
    this.adaptive = new AdaptiveQuality(() => this.downgrade());
    this.loop = new Loop(
      (dt) => this.update(dt),
      (a, s, r) => this.render(a, s, r),
    );
    this.renderer.onResize((w, hh, dpr) => this.onResize(w, hh, dpr));

    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    window.addEventListener('touchend', unlock, true);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing') this.pause();
        this.audio.suspend();
      } else {
        this.audio.resume();
      }
    });
    this.ui.addEventListener('pointerdown', (e) => {
      if (this.state === 'intro' && !(e.target as HTMLElement).closest('button')) this.screens.skipIntro();
    });
  }

  async start(): Promise<void> {
    if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = this;
    if (DEBUG) {
      this.debug = await DebugPanel.create(this.renderer.gl);
      this.setupDebug();
    }
    this.save.unlockEarnedHeroes(LEVEL_IDS);
    const params = new URLSearchParams(location.search);
    const direct = params.get('level');
    const directIndex = direct === null ? -1 : clamp(parseInt(direct, 10) || 0, 0, LEVELS.length - 1);
    if (directIndex >= 0 && levelOpen(this.save.data, LEVEL_IDS, directIndex)) this.play(directIndex, this.save.data.hero);
    else this.toTitle(directIndex >= 0);
    this.loop.start();
    requestAnimationFrame(() => document.body.classList.add('ready'));
    setTimeout(() => document.getElementById('splash')?.remove(), 1400);
  }

  // ---------------------------------------------------------------- flow

  private toTitle(levels = false): void {
    this.clearTimers();
    this.state = 'title';
    this.loop.simulate = true;
    this.loop.timeScale = 1;
    this.slow.t = 0;
    this.punch = 0;
    this.nibble = 0;
    this.hitStop = 0;
    this.post.calm();
    this.input.enabled = false;
    this.hud.visible = false;
    this.adaptive.enabled = false;
    const idx = Math.min(this.save.data.unlocked, LEVELS.length - 1);
    this.levelIndex = idx;
    this.loadWorld(idx, 'attract');
    this.hud.attach(null);
    if (levels) this.screens.showLevels();
    else this.screens.showTitle();
    this.audio.playLevel(LEVELS[idx], 'title');
    this.audio.music.setDanger(0);
    this.audio.muffle(false);
  }

  private play(index: number, hero: HeroId = 'finn'): void {
    this.clearTimers();
    this.levelIndex = index;
    this.hero = heroesFor(index, this.save.data.heroes, this.save.data.settings.testMode).includes(hero) ? hero : 'finn';
    this.loop.simulate = true;
    this.loop.timeScale = 1;
    this.slow.t = 0;
    this.hitStop = 0;
    const world = this.loadWorld(index, 'play');
    this.hud.attach(world, this.chainFor(world.level));
    this.hud.visible = true;
    this.state = 'intro';
    this.input.enabled = false;
    this.screens.showIntro(world.level, () => {
      if (this.world === world && this.state === 'intro') this.begin();
    });
    this.audio.playLevel(world.level, 'play');
    this.audio.music.setScene('play');
    this.audio.music.setStage(1);
    this.audio.muffle(false);
    this.adaptive.reset();
    this.adaptive.enabled = this.save.data.settings.quality === 'auto';
  }

  private begin(): void {
    this.state = 'playing';
    this.world?.start();
    this.input.enabled = true;
    this.input.clear();
  }

  private togglePause(): void {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.loop.simulate = false;
    this.input.enabled = false;
    this.screens.showPause();
    this.audio.muffle(true);
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.loop.simulate = true;
    this.input.enabled = true;
    this.input.clear();
    this.screens.hide();
    this.audio.muffle(false);
  }

  private completeLevel(r: LevelResult): void {
    this.state = 'ended';
    this.input.enabled = false;
    this.adaptive.enabled = false;
    const firstClear = !this.save.data.best[r.levelId];
    const isBest = this.save.recordLevel(r.levelId, r.levelIndex, r.score, r.stars);
    const newChallenges = this.save.recordChallenges(r.levelId, r.challenges);
    const coins = coinsFor(r.score, r.stars, firstClear) + newChallenges.length * CHALLENGE_COINS;
    this.save.addCoins(coins);
    const unlocked = this.save.unlockEarnedHeroes(LEVEL_IDS);
    // Golden fish coins were banked when caught; they show in the run's total.
    const reward: Reward = { coins: coins + r.goldenCoins, firstClear, unlocked, newChallenges, goldenCoins: r.goldenCoins };
    this.hud.visible = false;
    if (r.levelIndex >= LEVELS.length - 1) this.screens.showVictory(r, isBest, reward);
    else if (CHAPTERS.some((c) => c.from === r.levelIndex + 1)) this.screens.showChapterComplete(r, isBest, reward);
    else this.screens.showResults(r, isBest, true, reward);
    this.later(1500, () => this.audio.sfx.play('coin'));
    this.later(1650, () => this.audio.sfx.play('coin', { pitch: 1.25 }));
    if (unlocked.length) this.later(2300, () => this.audio.sfx.play('unlock'));
  }

  /** A timeout that is cancelled when the player leaves the current screen. */
  private later(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private clearTimers(): void {
    for (const id of this.timers) clearTimeout(id);
    this.timers.length = 0;
  }

  private buy(kind: UpgradeKind): boolean {
    if (!this.save.buyUpgrade(kind)) return false;
    this.audio.sfx.play('coin');
    setTimeout(() => this.audio.sfx.play('coin', { pitch: 1.3 }), 90);
    return true;
  }

  private gameOver(): void {
    const w = this.world;
    if (!w) return;
    this.state = 'ended';
    this.input.enabled = false;
    this.adaptive.enabled = false;
    this.hud.visible = false;
    this.screens.showGameOver(w.scoring.score, w.level);
    this.audio.sfx.play('gameOver');
    this.audio.music.stinger('lose');
    this.audio.music.setScene('outro');
  }

  // ---------------------------------------------------------------- world

  private loadWorld(index: number, mode: WorldMode): World {
    this.world?.dispose();
    this.world = null;
    const level = LEVELS[index];
    const q = this.quality;
    const f = this.factory.opts;
    if (f.physical !== q.physical || f.detail !== q.detailNormals || f.texScale !== q.fishTexScale) {
      this.factory.dispose();
      this.factory = new FishFactory(factoryOptions(q));
    }
    const world = new World({
      level,
      quality: q,
      factory: this.factory,
      rig: this.rig,
      input: mode === 'play' ? this.input : null,
      mode,
      viewport: this.viewport,
      hero: mode === 'play' ? this.hero : 'finn',
      upgrades: this.save.data.upgrades,
    });
    const biome = resolveBiome(level);
    world.scene.environment = this.envBaker.bake(biome);
    world.scene.environmentIntensity = ENV_INTENSITY;
    // The environment map now supplies much of the ambient light the hemisphere light used to.
    world.env.hemi.intensity *= HEMI_WITH_ENV;
    this.post.setScene(world.scene);
    this.post.applyBiome(biome);
    this.renderer.gl.setClearColor(world.env.clearColor, 1);
    world.resize(this.renderer.width, this.renderer.height, this.renderer.dpr);
    this.wire(world);
    this.world = world;
    return world;
  }

  private thumb(id: SpeciesId): string {
    let t = this.thumbs.get(id);
    if (!t) {
      t = fishThumbnail(this.factory.asset(id));
      this.thumbs.set(id, t);
    }
    return t;
  }

  private chainFor(level: LevelDef): ChainEntry[] {
    const out: ChainEntry[] = [];
    for (const tier of [1, 2, 3, 4] as Tier[]) {
      const ids = level.roster[tier];
      if (!ids.length) continue;
      const id = ids[0];
      out.push({ tier, name: SPECIES[id].name, src: this.thumb(id) });
    }
    return out;
  }

  private wire(w: World): void {
    // The world behind the menus gets no shake, flashes, slow motion or gameplay sounds.
    if (w.mode !== 'play') return;
    const ev = w.events;
    const sfx = this.audio.sfx;
    const pan = (x: number) => clamp((x - this.rig.center.x) / Math.max(1, this.rig.viewW * 0.5), -1, 1) * 0.8;
    ev.on('eat', (e) => {
      const meal = e.meal;
      const full = meal >= 1;
      const cls = e.multiplier === 3 ? 'x3' : e.multiplier === 2 ? 'x2' : '';
      this.hud.popup(e.x, e.y, `+${e.points}`, full && e.tier >= 2 ? `${cls} big` : cls);
      this.hud.ate();
      sfx.play(e.tier >= 3 ? 'eatBig' : e.tier === 2 ? 'eatMid' : 'eat', {
        pan: pan(e.x),
        pitch: (1 + Math.min(e.combo, 12) * 0.015) * (0.94 + Math.random() * 0.12),
        volume: 0.7 + 0.3 * meal,
      });
      this.audio.comboChime(e.combo, pan(e.x));
      this.audio.duckMusic(0.12 + 0.18 * meal, 0.08, 0.12);
      const p = w.player;
      this.rig.kick(e.x - p.x, e.y - p.y, this.rig.viewH * 0.3 * (0.3 + 0.7 * meal));
      this.nibble = Math.max(this.nibble, 0.008 + 0.017 * meal);
      if (full) this.hitStopFor(0.02 + 0.017 * e.tier);
      if (e.tier >= 2) this.rig.addTrauma(0.05 * e.tier * meal);
      if (this.input.usingTouch && this.save.data.settings.shake) navigator.vibrate?.(full ? 10 + 6 * e.tier : 6);
      if (e.frenzy) {
        this.hud.banner(e.frenzy === 2 ? 'DOUBLE FRENZY!' : 'FRENZY!', `x${e.multiplier} points`, 'frenzy', 1.3);
        sfx.play('frenzy');
        this.audio.duckMusic(0.3, 0.6);
      }
    });
    ev.on('grow', (e) => {
      this.slowMo(1.1, 0.3);
      this.post.shockwave(e.x, e.y, 0.3, 1.1);
      this.rig.addTrauma(0.22);
      this.punch = 1;
      this.hud.banner('You grew!', e.stage === 3 ? 'Only the biggest can stop you now' : 'Bigger fish are on the menu', 'grow', 2);
      sfx.play('grow');
      this.audio.music.stinger('grow');
      this.audio.music.setStage(e.stage);
      this.audio.duckMusic(0.35, 1);
    });
    ev.on('celebrate', (e) => {
      if (this.state === 'playing') this.state = 'won';
      this.slowMo(1.8, 0.25);
      this.post.shockwave(e.x, e.y, 0.3, 1.6);
      this.punch = 1.4;
      this.hud.banner('Level complete!', w.level.name, 'complete', 2.6);
      sfx.play('complete');
      this.audio.music.stinger('win');
      this.audio.music.setScene('outro');
      this.audio.duckMusic(0.4, 1.5);
    });
    ev.on('death', (e) => {
      this.rig.addTrauma(0.65);
      this.post.hurt(1);
      this.slowMo(0.7, 0.35);
      sfx.play('death', { pan: pan(e.x) });
      this.audio.duckMusic(0.5, 1.2);
      if (!e.gameOver) this.hud.banner('Chomped!', `${e.lives} ${e.lives === 1 ? 'life' : 'lives'} left`, 'danger', 1.6);
    });
    ev.on('respawn', () => sfx.play('respawn'));
    ev.on('gameOver', () => this.gameOver());
    ev.on('complete', (r) => this.completeLevel(r));
    ev.on('alert', (e) => sfx.play('alert', { pan: pan(e.fish.x), volume: 0.8 }));
    ev.on('bonus', (e) => {
      this.hud.popup(e.x, e.y, `${e.label} +${e.points}`, 'bonus', 1.5);
      sfx.play('bonus', { pan: pan(e.x) });
    });
    ev.on('life', (e) => {
      this.hud.popup(e.x, e.y, '+1 Life', 'life', 1.6);
      sfx.play('life');
    });
    ev.on('sting', (e) => {
      this.rig.addTrauma(0.3);
      this.post.hurt(0.45);
      sfx.play('sting', { pan: pan(e.x) });
      this.hud.popup(e.x, e.y + 0.8, 'Stung!', 'danger');
    });
    ev.on('explosion', (e) => {
      const d = Math.hypot(e.x - w.player.x, e.y - w.player.y);
      this.rig.addTrauma(clamp(1.05 - d / 28, 0.15, 0.9));
      this.post.shockwave(e.x, e.y, 0, 1.5);
      sfx.play('explosion', { pan: pan(e.x), volume: clamp(1.2 - d / 60, 0.3, 1) });
      this.audio.duckMusic(clamp(0.5 - d / 80, 0.1, 0.45), 0.8);
    });
    ev.on('pickup', (e) => {
      const pearl = e.kind === 'pearl' || e.kind === 'blackPearl';
      sfx.play(pearl ? 'pearl' : 'pickup', { pan: pan(e.x) });
      const label: Record<string, string> = { speed: 'Speed boost!', shield: 'Shield!', blackPearl: 'Black pearl!' };
      if (label[e.kind]) this.hud.popup(e.x, e.y + 1, label[e.kind], 'power', 1.4);
    });
    ev.on('shieldBlock', (e) => {
      sfx.play('block', { pan: pan(e.x) });
      this.rig.addTrauma(0.15);
    });
    ev.on('boost', (e) => {
      sfx.play('boost', { pan: pan(e.x), pitch: 0.95 + Math.random() * 0.1 });
    });
    ev.on('suction', (e) => {
      sfx.play('slurp', { pan: pan(e.x), pitch: 0.96 + Math.random() * 0.08 });
    });
    ev.on('puff', (e) => {
      sfx.play('puff', { pan: pan(e.x), pitch: 0.75 });
      this.rig.addTrauma(e.hit > 0 ? 0.3 : 0.12);
      this.post.shockwave(e.x, e.y, 0.15, 0.6);
      if (e.hit > 1) this.hud.popup(e.x, e.y + 1.2, `Bounced ${e.hit}!`, 'power', 1.2);
    });
    ev.on('geyser', (e) => {
      const d = Math.hypot(e.x - w.player.x, e.y - w.player.y);
      const volume = clamp(1.15 - d / 40, 0.2, 1);
      sfx.play(e.erupt ? 'geyser' : 'geyserWarn', { pan: pan(e.x), volume });
      if (e.erupt && d < 18) this.rig.addTrauma(clamp(0.4 - d / 50, 0.05, 0.35));
    });
    ev.on('scald', (e) => {
      this.rig.addTrauma(0.4);
      this.post.hurt(0.55);
      sfx.play('sting', { pan: pan(e.x), pitch: 0.8 });
      this.hud.popup(e.x, e.y + 0.8, 'Scorched!', 'danger');
    });
    ev.on('hurt', (e) => {
      this.rig.addTrauma(0.35);
      this.post.hurt(0.5);
      sfx.play('sting', { pan: pan(e.x), pitch: 0.7 });
      this.hud.popup(e.x, e.y + 0.9, e.label, 'danger', 1.3);
    });
    ev.on('golden', (e) => {
      this.hud.popup(e.x, e.y + 1, `+${e.coins} coins`, 'gold', 1.8);
      this.hud.banner('GOLDEN FRENZY!', 'Double points', 'gold', 1.6);
      this.save.addCoins(e.coins);
      sfx.play('golden', { pan: pan(e.x) });
      setTimeout(() => sfx.play('coin', { pitch: 1.2 }), 160);
      this.post.shockwave(e.x, e.y, 0.3, 0.8);
    });
    ev.on('challenge', (e) => {
      this.hud.challengeDone(e.index);
      this.hud.banner('Challenge complete!', e.label, 'challenge', 2, true);
      sfx.play('challenge');
    });
    ev.on('feature', (e) => this.onFeature(w, e.kind, e.x, e.y));
  }

  /** Sounds, popups and banners for level mechanics. */
  private onFeature(w: World, kind: string, x: number, y: number): void {
    const sfx = this.audio.sfx;
    const d = Math.hypot(x - w.player.x, y - w.player.y);
    const pan = clamp((x - this.rig.center.x) / Math.max(1, this.rig.viewW * 0.5), -1, 1) * 0.8;
    const play = (name: SoundName, opts: { pitch?: number; volume?: number } = {}) =>
      sfx.play(name, { pan, volume: (opts.volume ?? 1) * clamp(1.2 - d / 40, 0.25, 1), pitch: opts.pitch });
    switch (kind) {
      case 'puffInflate':
        play('puff', { pitch: 0.9 + Math.random() * 0.2 });
        break;
      case 'hide':
        play('swoosh', { volume: 0.5, pitch: 0.8 });
        break;
      case 'hideEscape':
        this.hud.popup(x, y + 1, 'Lost them!', 'bonus', 1.3);
        play('bonus', { pitch: 0.9 });
        break;
      case 'eelLunge':
        play('eelLunge', { pitch: 0.9 + Math.random() * 0.2 });
        break;
      case 'icicleCrack':
        play('crack');
        break;
      case 'icicleShatter':
        play('shatter');
        this.rig.addTrauma(clamp(0.3 - d / 60, 0.04, 0.25));
        break;
      case 'lightLow':
        this.hud.banner('Your light is fading', 'Eat glowing fish to recharge', 'danger', 2);
        play('dim');
        break;
      case 'tideLow':
        this.hud.banner('Low tide', 'The water is shallow. Watch your head!', 'tide', 1.6);
        play('tide');
        break;
      case 'tideHigh':
        this.hud.banner('Tide rising', '', 'tide', 1.3);
        play('tide', { pitch: 1.3 });
        break;
      case 'currentRide':
        play('swoosh', { volume: 0.8, pitch: 1.2 });
        break;
      case 'guardianWarn':
        play('charge');
        break;
      case 'guardianBeam':
        play('beam');
        this.rig.addTrauma(clamp(0.25 - d / 80, 0.03, 0.2));
        break;
      case 'crystalRing':
        play('chime', { pitch: 0.9 + Math.random() * 0.25 });
        break;
      case 'crystalShatter':
        play('shatter', { pitch: 1.35 });
        this.post.shockwave(x, y, 0.4, 0.9);
        this.rig.addTrauma(0.18);
        break;
      case 'crystalStun':
        this.hud.popup(x, y, 'Stunned!', 'power', 1.3);
        break;
      case 'heatWarn':
        this.hud.banner('Heat wave!', 'Stay out of the scalding water', 'danger', 2);
        play('heatWarn', { volume: 1.2 });
        break;
      case 'heatDodge':
        this.hud.popup(x, y + 1, 'Dodged it!', 'bonus', 1.3);
        play('bonus', { pitch: 1.1 });
        break;
      case 'heatPulse':
        play('heatWarn', { pitch: 1.3, volume: 0.8 });
        break;
      case 'sting':
        this.rig.addTrauma(0.2);
        break;
      case 'surge':
        play('swoosh', { volume: 0.8, pitch: 0.6 });
        break;
      case 'iceBlock':
        play('shatter', { pitch: 0.7, volume: 1.2 });
        this.rig.addTrauma(clamp(0.45 - d / 50, 0.06, 0.4));
        break;
      case 'lureSnap':
        play('lureSnap');
        break;
      case 'birdWarn':
        play('bird');
        break;
      case 'birdSplash':
        play('splash');
        this.rig.addTrauma(clamp(0.25 - d / 60, 0.03, 0.2));
        break;
      case 'birdDodge':
        this.hud.popup(x, y + 1, 'Missed you!', 'bonus', 1.2);
        break;
      case 'currentWarn':
        this.hud.banner('Currents shifting!', 'Every current is about to reverse', 'tide', 1.8);
        play('currentShift');
        break;
      case 'currentFlip':
        play('currentShift', { pitch: 1.3 });
        this.rig.addTrauma(0.15);
        break;
      case 'crystalChain':
        this.hud.popup(x, y, 'Resonance!', 'power', 1.3);
        play('chime', { pitch: 0.7 });
        break;
      case 'bombWarn':
        play('lavaWhistle');
        break;
      case 'bombLand':
        play('lavaBomb');
        this.post.shockwave(x, y, 0.2, 0.7);
        this.rig.addTrauma(clamp(0.4 - d / 50, 0.04, 0.35));
        break;
      case 'giantFirst':
        this.hud.banner('Great white!', 'Get out of its path', 'danger', 2.2);
        sfx.play('giantWarn', { pan });
        break;
      case 'giantWarn':
        sfx.play('giantWarn', { pan });
        break;
      case 'giantEnter':
        play('swoosh', { pitch: 0.45, volume: 1.4 });
        this.rig.addTrauma(0.25);
        this.audio.duckMusic(0.25, 1.5);
        break;
      case 'giantChomp':
        play('giantBite', { pitch: 0.9 + Math.random() * 0.15, volume: 0.75 });
        this.rig.addTrauma(clamp(0.35 - d / 60, 0.05, 0.3));
        break;
      case 'giantBite':
        play('giantBite', { pitch: 0.8 });
        this.post.shockwave(x, y, 0.2, 1);
        break;
    }
  }

  private slowMo(duration: number, scale: number): void {
    if (this.slow.t > 0 && this.slow.scale < scale) return;
    this.slow = { t: duration, dur: duration, scale };
  }

  /** A near-freeze of a few frames that gives a bite weight. Rapid chains of bites only get the first. */
  private hitStopFor(seconds: number): void {
    const now = performance.now();
    if (now - this.lastHitStop < HIT_STOP.cooldown * 1000) return;
    this.lastHitStop = now;
    this.hitStop = Math.max(this.hitStop, seconds);
  }

  // ---------------------------------------------------------------- loop

  private update(dt: number): void {
    this.world?.update(dt);
  }

  private render(alpha: number, dt: number, realDt: number): void {
    this.debug?.begin();
    const w = this.world;
    let timeScale = 1;
    if (this.slow.t > 0) {
      this.slow.t = Math.max(0, this.slow.t - realDt);
      const k = 1 - this.slow.t / this.slow.dur;
      timeScale = lerp(this.slow.scale, 1, smoothstep(0.45, 1, k));
    }
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - realDt);
      timeScale *= HIT_STOP.scale;
    }
    this.loop.timeScale = timeScale;
    let zoom = 1;
    if (this.punch > 0) {
      this.punch = Math.max(0, this.punch - realDt * 1.6);
      zoom = 1 - Math.sin(Math.min(1, this.punch) * Math.PI) * 0.05;
    }
    if (this.nibble > 0) {
      this.nibble = this.nibble < 1e-4 ? 0 : this.nibble * Math.exp(-realDt * 12);
      zoom *= 1 - this.nibble;
    }
    this.rig.zoomPunch = zoom;
    if (this.state === 'intro') this.screens.updateIntro(realDt);
    if (w) {
      shared.uTime.value += dt;
      this.caustics.update(this.renderer.gl, shared.uTime.value);
      w.render(alpha, dt);
      const p = w.player;
      if (p.visible) this.post.focusTarget.set(p.x, p.y, p.z);
      else this.post.focusTarget.set(this.rig.center.x, this.rig.center.y, 0);
      const m = w.scoring.multiplier;
      this.post.setFrenzy(m > 1 ? (m - 1) / 2 : 0);
      this.post.setGold(w.scoring.goldTime > 0 ? 1 : 0);
      this.post.setHeat(w.mode === 'play' ? w.heatHaze : 0);
      if (w.vision.dark > 0 && p.visible) {
        const v = this.screenPos;
        this.rig.worldToScreen(p.x, p.y, p.z, 1, 1, v);
        this.post.setDarkness(w.vision.dark, v.x, 1 - v.y, w.vision.radius / Math.max(1, this.rig.viewH * this.rig.zoomPunch), this.renderer.width / Math.max(1, this.renderer.height));
      } else {
        this.post.setDarkness(0, 0.5, 0.5, 1, 1);
      }
      this.post.update(realDt);
      this.post.render(dt);
      this.hud.update(realDt, this.renderer.width, this.renderer.height);
      this.audio.music.setDanger(this.state === 'playing' ? w.danger : 0);
      this.audio.music.setFrenzy(this.state === 'playing' && m > 1 ? (m - 1) / 2 : 0);
    }
    this.audio.update(realDt, this.state !== 'paused');
    if (this.state === 'playing') this.adaptive.sample(realDt);
    this.debug?.end();
  }

  private onResize(w: number, hh: number, dpr: number): void {
    this.rig.setAspect(w / hh);
    this.post.setSize(w, hh);
    this.world?.resize(w, hh, dpr);
    const portrait = hh > w * 1.1 && Math.min(w, hh) < 700;
    const hint = portrait && !this.portraitDismissed;
    this.rotateHint.classList.toggle('show', hint);
    if (hint) this.pause();
    document.body.classList.toggle('portrait', portrait);
    document.body.classList.toggle('compact', Math.min(w, hh) < 520);
  }

  // ---------------------------------------------------------------- settings & quality

  private applyRendererQuality(): void {
    const q = this.quality;
    this.renderer.setMaxDpr(q.maxDpr, q.supersample);
    this.renderer.gl.shadowMap.enabled = q.shadows;
  }

  private applySettings(patch: Partial<Settings>): void {
    const prevQuality = this.save.data.settings.quality;
    this.save.updateSettings(patch);
    const s = this.save.data.settings;
    this.audio.setVolumes(s.music, s.sfx);
    this.rig.shakeEnabled = s.shake;
    this.input.scheme = s.controls;
    if (patch.sfx !== undefined) this.audio.sfx.play('pickup', { volume: 0.6 });
    if (patch.quality && patch.quality !== prevQuality) {
      this.setQuality(resolveQuality(s.quality));
      this.adaptive.enabled = s.quality === 'auto' && this.state === 'playing';
    }
  }

  private setQuality(level: QualityLevel): void {
    if (level === this.qualityLevel) return;
    this.qualityLevel = level;
    this.quality = PRESETS[level];
    this.applyRendererQuality();
    this.post.setQuality(this.quality);
    this.caustics.interval = this.quality.causticsInterval;
    if (this.world) {
      this.world.effects.density = this.quality.particles;
      this.world.env.sun.castShadow = this.quality.shadows;
    }
    this.onResize(this.renderer.width, this.renderer.height, this.renderer.dpr);
  }

  /** Called by AdaptiveQuality when frames stay slow. Only swaps cheap runtime settings. */
  private downgrade(): void {
    const next = lowerLevel(this.qualityLevel);
    if (!next) {
      this.adaptive.enabled = false;
      return;
    }
    this.setQuality(next);
  }

  private toggleFullscreen(): void {
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      (document.exitFullscreen?.bind(document) ?? doc.webkitExitFullscreen?.bind(doc))?.();
    } else {
      const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
      void Promise.resolve(req?.()).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- debug

  private setupDebug(): void {
    const dbg = this.debug;
    if (!dbg) return;
    const f = dbg.folder('Game');
    const actions = {
      grow: () => this.world?.cheatGrow(),
      complete: () => this.world?.cheatComplete(),
      die: () => this.world?.killPlayer(null),
      invincible: false,
      level: 0,
      go: () => this.play(actions.level),
    };
    f.add(actions, 'grow').name('Grow one stage');
    f.add(actions, 'complete').name('Complete level');
    f.add(actions, 'die').name('Lose a life');
    f.add(actions, 'invincible').onChange((v: boolean) => {
      if (this.world) this.world.player.invincible = v;
    });
    f.add(actions, 'level', 0, LEVELS.length - 1, 1);
    f.add(actions, 'go').name('Play level');
    const q = dbg.folder('Quality');
    const qs = { level: this.qualityLevel };
    q.add(qs, 'level', ['low', 'medium', 'high', 'ultra']).onChange((v: QualityLevel) => this.setQuality(v));
  }
}
