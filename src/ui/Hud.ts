import { Vector2 } from 'three';
import type { World } from '../game/World';
import type { Fish } from '../game/entities/Fish';
import type { Tier } from '../config/tuning';
import type { AbilityKind } from '../config/progression';
import type { FeatureHud } from '../game/features/types';
import { HAZARD } from '../config/tuning';
import { playerCanEat } from '../game/systems/FoodChain';
import { challengeLabel, progressText } from '../game/systems/Challenges';
import { GOLD_FRENZY } from '../game/systems/Scoring';
import { dangerProgress } from '../game/systems/Endless';
import { FISH_ICON, formatScore, h } from './dom';

type PowerKind = 'speed' | 'shield' | 'gold';

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const ABILITY_ICONS: Record<AbilityKind, string> = {
  dash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5l6.5 6.5-6.5 6.5M12.5 5.5l6.5 6.5-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  suction:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 11-4.2-7.6M17.5 12a5.5 5.5 0 11-2.6-4.7M14 12a2 2 0 11-1-1.7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  puff: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5.2" fill="currentColor"/><path d="M12 2.5v3.2M12 18.3v3.2M2.5 12h3.2M18.3 12h3.2M5.3 5.3l2.3 2.3M16.4 16.4l2.3 2.3M5.3 18.7l2.3-2.3M16.4 7.6l2.3-2.3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};
const ABILITY_LABELS: Record<AbilityKind, string> = { dash: 'Boost', suction: 'Suck', puff: 'Puff' };

interface Popup {
  el: HTMLElement;
  x: number;
  y: number;
  t: number;
  life: number;
}

interface QueuedBanner {
  title: string;
  sub: string;
  cls: string;
  duration: number;
  wait: boolean;
}

export interface ChainEntry {
  tier: Tier;
  name: string;
  src: string;
}

const MAX_POPUPS = 24;
const MAX_ARROWS = 6;

function restartAnimation(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

const SHARK_ICON =
  '<svg viewBox="0 0 48 24" aria-hidden="true"><path d="M1 6.5L5.5 12.4L1.5 18.5L8.5 15.6C14 16.6 20 16.9 25 16.5L27.6 20.5L29.6 16.2C36 15.6 42 14.4 47 12.2C42.5 9.8 37 8.6 31 8.3L27.5 2L24.4 8.1C18 8.2 12.5 9 8.4 10.2Z"/></svg>';

export class Hud {
  readonly el: HTMLElement;
  onPause: (() => void) | null = null;
  onBoost: (() => void) | null = null;
  private world: World | null = null;
  private readonly boostEl: HTMLElement;
  private readonly boostRing: HTMLElement;
  private readonly boostIcon: HTMLElement;
  private readonly boostName: HTMLElement;
  private boostWasReady = true;
  private readonly scoreEl: HTMLElement;
  private readonly livesEl: HTMLElement;
  private readonly comboEl: HTMLElement;
  private readonly comboFill: HTMLElement;
  private readonly comboText: HTMLElement;
  private readonly growthEl: HTMLElement;
  private readonly segs: HTMLElement[] = [];
  private readonly growthText: HTMLElement;
  private readonly stageText: HTMLElement;
  private readonly bossEl: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossHint: HTMLElement;
  private readonly bossSegs: HTMLElement;
  private bossFills: HTMLElement[] = [];
  private readonly dangerEl: HTMLElement;
  private readonly dangerNum: HTMLElement;
  private readonly dangerMul: HTMLElement;
  private readonly dangerFill: HTMLElement;
  private lastDanger = 0;
  private readonly chainEl: HTMLElement;
  private readonly powersEl: HTMLElement;
  private readonly powerEls: Record<PowerKind, { el: HTMLElement; ring: HTMLElement }>;
  private readonly featureEl: HTMLElement;
  private readonly featureLabel: HTMLElement;
  private readonly featureFill: HTMLElement;
  private readonly eventEl: HTMLElement;
  private readonly eventLabel: HTMLElement;
  private readonly eventFill: HTMLElement;
  private readonly challengesEl: HTMLElement;
  private challengeRows: { el: HTMLElement; progress: HTMLElement; state: string }[] = [];
  private challengeTimer = 0;
  private readonly layer: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly bannerTitle: HTMLElement;
  private readonly bannerSub: HTMLElement;
  private chainItems: { tier: Tier; el: HTMLElement }[] = [];
  private shownScore = 0;
  private lastLives = -1;
  private lastStage = 0;
  private lastCombo = 0;
  private lastChainStage = 0;
  private bannerTimer = 0;
  private readonly bannerQueue: QueuedBanner[] = [];
  private bannerCurrent: QueuedBanner | null = null;
  private readonly popups: Popup[] = [];
  private readonly arrows: HTMLElement[] = [];
  private readonly giantEl: HTMLElement;
  private readonly markers = new Map<Fish, HTMLElement>();
  private readonly hunting: Fish[] = [];
  private readonly v = new Vector2();

  constructor(parent: HTMLElement) {
    this.scoreEl = h('div', { class: 'hud-score', text: '0' });
    this.livesEl = h('div', { class: 'hud-lives' });
    this.comboFill = h('div', { class: 'hud-combo-fill' });
    this.comboText = h('div', { class: 'hud-combo-text' });
    this.comboEl = h('div', { class: 'hud-combo' }, h('div', { class: 'hud-combo-bar' }, this.comboFill), this.comboText);
    const segWrap = h('div', { class: 'hud-growth-segs' });
    for (let i = 0; i < 3; i++) {
      const fill = h('div', { class: 'seg-fill' });
      this.segs.push(fill);
      segWrap.append(h('div', { class: 'seg' }, fill, h('span', { class: 'seg-num', text: String(i + 1) })));
    }
    this.stageText = h('span', { class: 'hud-stage', text: 'Stage 1' });
    this.growthText = h('span', { class: 'hud-count', text: '0/20' });
    this.growthEl = h('div', { class: 'hud-growth' }, h('div', { class: 'hud-growth-label' }, this.stageText, this.growthText), segWrap);
    this.bossName = h('span', { class: 'hud-boss-name' });
    this.bossHint = h('span', { class: 'hud-boss-hint', text: 'Bite the weak spot!' });
    this.bossSegs = h('div', { class: 'hud-boss-segs' });
    this.bossEl = h('div', { class: 'hud-boss' }, h('div', { class: 'hud-boss-label' }, this.bossName, this.bossHint), this.bossSegs);
    this.dangerNum = h('b', { class: 'hud-danger-num', text: '1' });
    this.dangerMul = h('span', { class: 'hud-danger-mul' });
    this.dangerFill = h('div', { class: 'hud-danger-fill' });
    this.dangerEl = h(
      'div',
      { class: 'hud-danger', attrs: { title: 'Danger rises over time. Points rise with it.' } },
      h('span', { class: 'hud-danger-label', text: 'Danger' }),
      this.dangerNum,
      h('div', { class: 'hud-danger-bar' }, this.dangerFill),
      this.dangerMul,
    );
    this.chainEl = h('div', { class: 'hud-chain' });
    const pauseBtn = h('button', {
      class: 'icon-btn hud-pause',
      attrs: { 'aria-label': 'Pause', title: 'Pause (Esc)' },
      html: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>',
      on: { click: () => this.onPause?.() },
    });
    const mkPower = (cls: string, label: string) => {
      const ring = h('div', { class: 'power-ring' });
      const el = h('div', { class: `power ${cls}` }, ring, h('span', { text: label }));
      return { el, ring };
    };
    this.powerEls = { speed: mkPower('power-speed', 'Speed'), shield: mkPower('power-shield', 'Shield'), gold: mkPower('power-gold', `Golden x${GOLD_FRENZY.mul}`) };
    this.powersEl = h('div', { class: 'hud-powers' }, this.powerEls.gold.el, this.powerEls.speed.el, this.powerEls.shield.el);
    this.featureLabel = h('span', { class: 'hud-feature-label' });
    this.featureFill = h('div', { class: 'hud-feature-fill' });
    this.featureEl = h('div', { class: 'hud-feature' }, this.featureLabel, h('div', { class: 'hud-feature-bar' }, this.featureFill));
    this.eventLabel = h('span', { class: 'hud-feature-label' });
    this.eventFill = h('div', { class: 'hud-feature-fill' });
    this.eventEl = h('div', { class: 'hud-feature' }, this.eventLabel, h('div', { class: 'hud-feature-bar' }, this.eventFill));
    this.challengesEl = h('div', { class: 'hud-challenges' });
    this.layer = h('div', { class: 'hud-layer' });
    this.bannerTitle = h('div', { class: 'banner-title' });
    this.bannerSub = h('div', { class: 'banner-sub' });
    this.bannerEl = h('div', { class: 'hud-banner' }, this.bannerTitle, this.bannerSub);
    this.boostRing = h('div', { class: 'boost-ring' });
    this.boostIcon = h('div', { class: 'boost-icon', html: ABILITY_ICONS.dash });
    this.boostName = h('span', { text: ABILITY_LABELS.dash });
    this.boostEl = h(
      'div',
      {
        class: 'hud-boost ready',
        attrs: { role: 'button', 'aria-label': 'Boost' },
        on: {
          pointerdown: (e) => {
            e.preventDefault();
            this.onBoost?.();
          },
        },
      },
      h('div', { class: 'boost-btn' }, this.boostRing, this.boostIcon),
      h('div', { class: 'boost-label' }, this.boostName, h('span', { class: 'boost-key', text: 'Click' })),
    );
    this.el = h(
      'div',
      { class: 'hud hidden' },
      this.layer,
      h(
        'div',
        { class: 'hud-top' },
        h('div', { class: 'hud-left' }, this.livesEl, this.scoreEl, this.comboEl, this.challengesEl),
        h('div', { class: 'hud-center' }, this.growthEl, this.bossEl, this.dangerEl, this.featureEl, this.eventEl, this.powersEl),
        h('div', { class: 'hud-right' }, this.chainEl, pauseBtn),
      ),
      this.boostEl,
      this.bannerEl,
    );
    parent.append(this.el);
    for (let i = 0; i < MAX_ARROWS; i++) {
      const a = h('div', { class: 'threat-arrow', html: '<svg viewBox="0 0 24 24"><path d="M20 12L5 4.5L8.5 12L5 19.5Z"/></svg>' });
      this.layer.append(a);
      this.arrows.push(a);
    }
    this.giantEl = h('div', { class: 'giant-warning', html: `${SHARK_ICON}<span>Great white</span>` });
    this.layer.append(this.giantEl);
  }

  attach(world: World | null, chain: ChainEntry[] = []): void {
    this.world = world;
    this.shownScore = 0;
    this.lastLives = -1;
    this.lastStage = 0;
    this.lastCombo = 0;
    this.lastChainStage = 0;
    this.bannerTimer = 0;
    this.bannerQueue.length = 0;
    this.bannerCurrent = null;
    this.boostWasReady = true;
    const ability = world?.player.ability ?? 'dash';
    this.boostIcon.innerHTML = ABILITY_ICONS[ability];
    this.boostName.textContent = ABILITY_LABELS[ability];
    this.boostEl.setAttribute('aria-label', ABILITY_LABELS[ability]);
    this.boostEl.classList.toggle('suction', ability === 'suction');
    this.boostEl.classList.toggle('puff', ability === 'puff');
    this.bannerEl.classList.remove('show');
    for (const p of this.popups) p.el.remove();
    this.popups.length = 0;
    for (const m of this.markers.values()) m.remove();
    this.markers.clear();
    this.giantEl.classList.remove('show');
    this.chainEl.replaceChildren();
    this.chainItems = chain.map((c) => {
      const el = h('div', { class: `chain-item tier-${c.tier}`, attrs: { title: c.name } }, h('img', { attrs: { src: c.src, alt: c.name } }));
      this.chainEl.append(el);
      return { tier: c.tier, el };
    });
    this.featureEl.className = 'hud-feature';
    this.eventEl.className = 'hud-feature';
    const boss = world?.mode === 'play' ? world.boss : null;
    this.growthEl.classList.toggle('gone', !!boss);
    this.dangerEl.classList.toggle('show', !!world?.endless);
    this.lastDanger = 0;
    this.bossEl.className = boss ? `hud-boss show boss-${boss.def.kind}` : 'hud-boss';
    this.bossName.textContent = boss?.name ?? '';
    // Phase 1 is the rightmost segment, so the whole bar drains right to left.
    this.bossFills = [];
    this.bossSegs.replaceChildren();
    for (let i = (boss?.def.phases ?? 0) - 1; i >= 0; i--) {
      const fill = h('div', { class: 'bseg-fill' });
      this.bossFills[i] = fill;
      this.bossSegs.append(h('div', { class: 'bseg' }, h('div', { class: 'bseg-lag' }), fill));
    }
    this.challengeTimer = 0;
    this.challengeRows = (world?.challenges.defs ?? []).map((def) => {
      const progress = h('span', { class: 'hc-progress' });
      const el = h('div', { class: 'hc-row' }, h('span', { class: 'hc-check', html: CHECK }), h('span', { class: 'hc-label', text: challengeLabel(def) }), progress);
      return { el, progress, state: '' };
    });
    this.challengesEl.replaceChildren(...this.challengeRows.map((r) => r.el));
  }

  /** Flashes a tracker line when its challenge completes. */
  challengeDone(index: number): void {
    const r = this.challengeRows[index];
    if (!r) return;
    this.challengeTimer = 0;
    r.el.classList.remove('flash');
    void r.el.offsetWidth;
    r.el.classList.add('flash');
  }

  private updateChallenges(dt: number): void {
    const w = this.world!;
    this.challengeTimer -= dt;
    if (this.challengeTimer > 0) return;
    this.challengeTimer = 0.25;
    this.challengesEl.classList.toggle('show', w.mode === 'play' && this.challengeRows.length > 0);
    const status = w.challenges.status();
    status.forEach((st, i) => {
      const r = this.challengeRows[i];
      if (!r) return;
      const state = st.done ? 'done' : st.failed ? 'failed' : '';
      if (state !== r.state) {
        r.el.classList.toggle('done', st.done);
        r.el.classList.toggle('failed', st.failed);
        r.state = state;
      }
      r.progress.textContent = progressText(w.challenges.defs[i], st);
    });
  }

  private updateFeature(): void {
    const w = this.world!;
    this.meter(this.featureEl, this.featureLabel, this.featureFill, w.feature?.hud() ?? null);
    this.meter(this.eventEl, this.eventLabel, this.eventFill, w.director?.hud() ?? null, 'event');
  }

  private meter(el: HTMLElement, label: HTMLElement, fill: HTMLElement, f: FeatureHud | null, extra = ''): void {
    if (!f) {
      el.classList.remove('show');
      return;
    }
    const meter = f.value !== undefined;
    el.className = `hud-feature show tone-${f.tone} ${meter ? 'meter' : 'chip'} ${f.alarm ? 'alarm' : ''} ${extra}`.trim();
    if (label.textContent !== f.label) label.textContent = f.label;
    if (meter) fill.style.transform = `scaleX(${Math.max(0, Math.min(1, f.value!)).toFixed(3)})`;
  }

  set visible(v: boolean) {
    this.el.classList.toggle('hidden', !v);
  }

  /**
   * With `wait`, the banner is queued behind the one on screen instead of replacing it,
   * and goes back in the queue if a normal banner interrupts it.
   */
  banner(title: string, sub = '', cls = '', duration = 2.2, wait = false): void {
    if (this.bannerTimer > 0) {
      if (wait) {
        this.bannerQueue.push({ title, sub, cls, duration, wait });
        return;
      }
      const cur = this.bannerCurrent;
      if (cur?.wait && this.bannerTimer > 0.5) this.bannerQueue.unshift({ ...cur, duration: this.bannerTimer });
    }
    this.bannerCurrent = { title, sub, cls, duration, wait };
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.bannerEl.className = `hud-banner ${cls}`;
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
    this.bannerTimer = duration;
  }

  popup(x: number, y: number, text: string, cls = '', life = 1.1): void {
    if (this.popups.length >= MAX_POPUPS) {
      const old = this.popups.shift()!;
      old.el.remove();
    }
    const el = h('div', { class: `popup ${cls}`, text });
    this.layer.append(el);
    this.popups.push({ el, x, y, t: 0, life });
  }

  /** Each bite bumps the score and flashes the growth segment it fed. */
  ate(): void {
    restartAnimation(this.scoreEl, 'bump');
    const seg = this.segs.find((s) => s.parentElement!.classList.contains('active'));
    if (seg) restartAnimation(seg.parentElement!, 'tick');
  }

  /** Endless: the danger level just went up. */
  dangerUp(): void {
    restartAnimation(this.dangerEl, 'up');
  }

  private updateDanger(): void {
    const w = this.world!;
    if (!w.endless) return;
    const lv = w.dangerLevel;
    if (lv !== this.lastDanger) {
      this.lastDanger = lv;
      this.dangerNum.textContent = String(lv);
      this.dangerMul.textContent = `x${Number(w.scoring.pointsMul.toFixed(2))} pts`;
      this.dangerEl.style.setProperty('--heat', Math.min(1, (lv - 1) / 6).toFixed(3));
    }
    this.dangerFill.style.transform = `scaleX(${dangerProgress(w.time).toFixed(3)})`;
  }

  /** A weak-point bite landed: the boss bar jolts. */
  bossHit(): void {
    restartAnimation(this.bossEl, 'hit');
  }

  private updateBoss(): void {
    const boss = this.world!.boss;
    if (!boss) return;
    const hp = boss.health;
    this.bossFills.forEach((fill, i) => {
      const v = hp.segment(i);
      fill.style.transform = `scaleX(${v.toFixed(3)})`;
      const seg = fill.parentElement!;
      seg.classList.toggle('active', i === hp.phase && !hp.defeated);
      seg.classList.toggle('empty', v <= 0);
      (seg.firstElementChild as HTMLElement).style.transform = `scaleX(${v.toFixed(3)})`;
    });
    this.bossEl.classList.toggle('open', boss.exposed && !boss.defeated);
    this.bossEl.classList.toggle('beaten', boss.defeated);
  }

  pulseGrowth(): void {
    this.growthEl.classList.remove('pulse');
    void this.growthEl.offsetWidth;
    this.growthEl.classList.add('pulse');
  }

  update(dt: number, width: number, height: number): void {
    const w = this.world;
    if (!w) return;
    const rig = w.rig;
    const s = w.scoring;

    const target = s.score;
    this.shownScore += (target - this.shownScore) * Math.min(1, dt * 9);
    if (Math.abs(target - this.shownScore) < 1) this.shownScore = target;
    this.scoreEl.textContent = formatScore(this.shownScore);

    if (w.lives.count !== this.lastLives) {
      const lost = this.lastLives > w.lives.count;
      this.livesEl.replaceChildren();
      for (let i = 0; i < w.lives.count; i++) this.livesEl.append(h('span', { class: 'life', html: FISH_ICON }));
      if (this.lastLives >= 0) {
        this.livesEl.classList.remove('gain', 'lose');
        void this.livesEl.offsetWidth;
        this.livesEl.classList.add(lost ? 'lose' : 'gain');
      }
      this.lastLives = w.lives.count;
    }

    const g = w.growth;
    for (let i = 0; i < 3; i++) {
      const stageIdx = i + 1;
      const fill = g.full || stageIdx < g.stage ? 1 : stageIdx === g.stage ? g.stageProgress : 0;
      this.segs[i].style.transform = `scaleX(${fill})`;
      this.segs[i].parentElement!.classList.toggle('active', stageIdx === g.stage && !g.full);
      this.segs[i].parentElement!.classList.toggle('done', fill >= 1);
    }
    this.stageText.textContent = g.full ? (w.endless ? 'Fully grown \u2013 survive!' : 'Fully grown!') : `Stage ${g.stage}`;
    this.growthText.textContent = g.full ? '' : `${g.points}/${g.perStage}`;
    if (g.stage !== this.lastStage) {
      if (this.lastStage) this.pulseGrowth();
      this.lastStage = g.stage;
    }

    if (g.stage !== this.lastChainStage) {
      this.lastChainStage = g.stage;
      for (const c of this.chainItems) {
        const edible = playerCanEat(g.stage, c.tier);
        c.el.classList.toggle('edible', edible);
        c.el.classList.toggle('danger', !edible);
      }
    }

    if (s.combo >= 2) {
      this.comboEl.classList.add('show');
      this.comboFill.style.transform = `scaleX(${s.comboFraction})`;
      const m = s.multiplier;
      this.comboText.textContent = m > 1 ? `${m === 3 ? 'DOUBLE FRENZY' : 'FRENZY'} x${m}` : `Combo ${s.combo}`;
      this.comboEl.classList.toggle('frenzy', m > 1);
      if (s.combo !== this.lastCombo) {
        this.comboText.classList.remove('bump');
        void this.comboText.offsetWidth;
        this.comboText.classList.add('bump');
      }
    } else {
      this.comboEl.classList.remove('show', 'frenzy');
    }
    this.lastCombo = s.combo;

    const p = w.player;
    this.power('speed', p.alive ? p.speedBoost : 0, 8);
    this.power('shield', p.alive && p.shieldIsPickup ? p.shield : 0, HAZARD.shieldDuration * w.shieldMul);
    this.power('gold', s.goldTime, GOLD_FRENZY.duration);
    this.updateFeature();
    this.updateBoss();
    this.updateDanger();
    this.updateChallenges(dt);

    const ready = p.alive && p.boostCooldown <= 0;
    this.boostEl.classList.toggle('ready', ready);
    this.boostEl.classList.toggle('active', p.abilityActive);
    this.boostRing.style.setProperty('--p', ready ? '1' : (1 - p.boostCooldown / p.abilityCooldown).toFixed(3));
    if (ready && !this.boostWasReady) {
      this.boostEl.classList.remove('charged');
      void this.boostEl.offsetWidth;
      this.boostEl.classList.add('charged');
    }
    this.boostWasReady = ready;

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        const next = this.bannerQueue.shift();
        if (next) this.banner(next.title, next.sub, next.cls, next.duration, next.wait);
        else this.bannerEl.classList.remove('show');
      }
    }

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pp = this.popups[i];
      pp.t += dt;
      if (pp.t >= pp.life) {
        pp.el.remove();
        this.popups.splice(i, 1);
        continue;
      }
      rig.worldToScreen(pp.x, pp.y, 0.3, width, height, this.v);
      const k = pp.t / pp.life;
      const rise = 46 * (1 - (1 - k) * (1 - k));
      pp.el.style.transform = `translate(${this.v.x.toFixed(1)}px, ${(this.v.y - rise).toFixed(1)}px) translate(-50%, -50%)`;
      pp.el.style.opacity = String(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
    }

    this.updateThreats(width, height);
    this.updateGiant(width, height);
  }

  private updateGiant(width: number, height: number): void {
    const w = this.world!;
    const g = w.mode === 'play' ? (w.greatWhite?.warning ?? null) : null;
    this.giantEl.classList.toggle('show', g !== null);
    if (!g) return;
    w.rig.worldToScreen(w.rig.center.x, g.y, 0, width, height, this.v);
    const y = Math.max(110, Math.min(height - 110, this.v.y));
    const fromLeft = g.dir > 0;
    this.giantEl.classList.toggle('right', !fromLeft);
    this.giantEl.classList.toggle('close', g.k > 0.6);
    this.giantEl.style.transform = `translate(${fromLeft ? 16 : width - 16}px, ${y.toFixed(1)}px) translate(${fromLeft ? '0' : '-100%'}, -50%)`;
  }

  private power(kind: PowerKind, t: number, max: number): void {
    const p = this.powerEls[kind];
    p.el.classList.toggle('show', t > 0);
    if (t > 0) p.ring.style.setProperty('--p', String(Math.min(1, t / max)));
  }

  private updateThreats(width: number, height: number): void {
    const w = this.world!;
    const rig = w.rig;
    const threats = w.mode === 'play' && w.player.alive ? w.huntingThreats(this.hunting) : this.hunting.splice(0);
    const margin = 34;
    let n = 0;
    const seen = new Set<Fish>();
    for (const f of threats) {
      rig.worldToScreen(f.x, f.y, f.z, width, height, this.v);
      const on = this.v.x > 0 && this.v.x < width && this.v.y > 0 && this.v.y < height;
      if (on) {
        const showMark = f.brain!.state === 'alert' || f.brain!.timer < 0.7;
        if (showMark) {
          seen.add(f);
          let m = this.markers.get(f);
          if (!m) {
            m = h('div', { class: 'alert-mark', text: '!' });
            this.layer.append(m);
            this.markers.set(f, m);
          }
          rig.worldToScreen(f.x, f.y + f.len * 0.42 + 0.5, f.z, width, height, this.v);
          m.style.transform = `translate(${this.v.x.toFixed(1)}px, ${this.v.y.toFixed(1)}px) translate(-50%, -100%)`;
        }
        continue;
      }
      if (n >= this.arrows.length || w.hideThreatArrows) continue;
      const cx = width / 2;
      const cy = height / 2;
      const dx = this.v.x - cx;
      const dy = this.v.y - cy;
      const sx = (cx - margin) / Math.max(1e-3, Math.abs(dx));
      const sy = (cy - margin) / Math.max(1e-3, Math.abs(dy));
      const s = Math.min(sx, sy);
      const ax = cx + dx * s;
      const ay = cy + dy * s;
      const ang = Math.atan2(dy, dx);
      const dist = Math.hypot(f.x - w.player.x, f.y - w.player.y);
      const scale = Math.max(0.7, Math.min(1.25, 1.4 - dist / 30));
      const a = this.arrows[n++];
      a.classList.add('show');
      a.classList.toggle('chasing', f.brain!.state === 'chase');
      a.style.transform = `translate(${ax.toFixed(1)}px, ${ay.toFixed(1)}px) translate(-50%, -50%) rotate(${ang.toFixed(3)}rad) scale(${scale.toFixed(2)})`;
    }
    for (let i = n; i < this.arrows.length; i++) this.arrows[i].classList.remove('show');
    for (const [f, m] of this.markers) {
      if (!seen.has(f)) {
        m.remove();
        this.markers.delete(f);
      }
    }
  }
}
