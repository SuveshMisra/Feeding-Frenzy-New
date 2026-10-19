import {
  CHAPTERS,
  ENDLESS_UNLOCK,
  LEVELS,
  LEVEL_IDS,
  chapterAll,
  chapterLevels,
  chapterOf,
  endlessBases,
  levelEvents,
  resolveBiome,
  type ChapterId,
  type EventId,
  type LevelDef,
} from '../config/levels';
import { HEROES, HERO_IDS, UPGRADES, endlessHeroes, heroesFor, upgradeCost, upgradeMax, type HeroId, type UpgradeKind } from '../config/progression';
import { CHALLENGE_COINS, challengeLabel } from '../game/systems/Challenges';
import { ENDLESS } from '../game/systems/Endless';
import type { SpeciesId } from '../config/species';
import { BOOST, PUFF_ABILITY, SUCTION } from '../config/tuning';
import type { EndlessResult, LevelResult } from '../game/World';
import { levelOpen, type ControlScheme, type QualitySetting, type SaveStore, type Settings } from '../app/Save';
import { ABILITY_ICONS } from './Hud';
import { abilityCooldownFor } from '../game/entities/Player';
import { formatScore, formatTime, h } from './dom';
import type { PlayOptions, SoundName } from '../audio/Sfx';

/** What a cleared level paid out, shown on the results screen. */
export interface Reward {
  coins: number;
  firstClear: boolean;
  unlocked: HeroId[];
  /** Challenge indices completed for the first time this run. */
  newChallenges: number[];
  goldenCoins: number;
}

export interface ScreenActions {
  play(index: number, hero: HeroId): void;
  /** An endless run in level `index`'s biome. */
  playEndless(index: number, hero: HeroId): void;
  buy(kind: UpgradeKind): boolean;
  pickHero(id: HeroId): void;
  resume(): void;
  restart(): void;
  quit(): void;
  levels(): void;
  /** Back to the endless biome picker. */
  endless(): void;
  next(): void;
  settings(patch: Partial<Settings>): void;
  fullscreen(): void;
  click(): void;
  sound(name: SoundName, opts?: PlayOptions): void;
  howToSeen(): void;
  /** Wipes the save's progress (settings stay) and returns to the title. */
  clearProgress(): void;
}

const STAR =
  '<svg viewBox="0 0 24 24"><path d="M12 2.4l2.95 5.98 6.6.96-4.78 4.66 1.13 6.57L12 17.47l-5.9 3.1 1.13-6.57L2.45 9.34l6.6-.96z"/></svg>';

const ICONS = {
  move: '<svg viewBox="0 0 48 48"><path d="M24 4l7 8h-5v9h9v-5l8 8-8 8v-5h-9v9h5l-7 8-7-8h5v-9h-9v5l-8-8 8-8v5h9v-9h-5z"/></svg>',
  eat: '<svg viewBox="0 0 48 48"><path d="M4 24c5-10 17-13 26-6l-9 6 9 6c-9 7-21 4-26-6z"/><circle cx="12" cy="20.5" r="2.2" fill="#052033"/><path d="M34 24c2-3 6-4 9-2l3-2v8l-3-2c-3 2-7 1-9-2z" opacity=".75"/></svg>',
  danger:
    '<svg viewBox="0 0 48 48"><path d="M2 27c8-12 25-15 36-6l8-6-2 11 2 11-8-6c-11 9-28 6-36-4z"/><circle cx="11" cy="24.5" r="2.4" fill="#ff4d6d"/><path d="M4 30l4-1 1 3 3-2 2 3 2-2" stroke="#052033" stroke-width="1.6" fill="none"/></svg>',
  combo: '<svg viewBox="0 0 48 48"><path d="M27 3L10 27h11l-4 18 20-26H25z"/></svg>',
  boost: '<svg viewBox="0 0 48 48"><path d="M6 10.5l4.2-4.2L27.9 24 10.2 41.7 6 37.5 19.5 24zM21 10.5l4.2-4.2L42.9 24 25.2 41.7 21 37.5 34.5 24z"/></svg>',
  pearl:
    '<svg viewBox="0 0 48 48"><path d="M4 30c4-10 14-15 20-15s16 5 20 15c-5 6-12 9-20 9S9 36 4 30z" opacity=".7"/><circle cx="24" cy="26" r="8"/><circle cx="21" cy="23" r="2.4" fill="#fff"/></svg>',
  speed:
    '<svg viewBox="0 0 48 48"><path d="M16 24c4-9 15-11 22-5l6-4v18l-6-4c-7 6-18 4-22-5z"/><circle cx="24" cy="22" r="2" fill="#052033"/><path d="M3 17h10M1 24h11M3 31h10" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" fill="none"/></svg>',
  cooldown:
    '<svg viewBox="0 0 48 48"><path d="M19 3h10v5H19z"/><path d="M24 9a17 17 0 1 0 0 34 17 17 0 0 0 0-34zm0 5a12 12 0 1 1 0 24 12 12 0 0 1 0-24z"/><path d="M24 17v9l6 4" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M37 8l4 4-3 3-4-4z"/></svg>',
  shield:
    '<svg viewBox="0 0 48 48"><path d="M24 3l17 6v13c0 11-7 19-17 23C14 41 7 33 7 22V9z"/><path d="M24 10l11 4v8c0 7-4 13-11 16z" fill="#052033" opacity=".28"/><path d="M17 23l5 5 9-10" stroke="#052033" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  life: '<svg viewBox="0 0 48 48"><path d="M24 42S5 30 5 17C5 10 10 5 16.5 5c3.6 0 6 1.8 7.5 4.2C25.5 6.8 27.9 5 31.5 5 38 5 43 10 43 17c0 13-19 25-19 25z"/><path d="M24 15v14M17 22h14" stroke="#052033" stroke-width="3.6" stroke-linecap="round" fill="none"/></svg>',
  twist:
    '<svg viewBox="0 0 48 48"><path d="M3 30c5-6 10-6 15 0s10 6 15 0 10-6 12-3v8c-2-3-7-3-12 3s-10 6-15 0-10-6-15 0z"/><path d="M24 3l3 7 7 1-5 5 1.5 7L24 19.5 17.5 23 19 16l-5-5 7-1z"/></svg>',
};

const COIN =
  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="#ffc24d" stroke="#fff1a8" stroke-width="1.5"/><circle cx="12" cy="12" r="7.4" fill="none" stroke="#d98a1c" stroke-width="1.3"/><path d="M6.8 12c2-2.8 5.6-3.3 8-1.2l2.4-1.6v5.6l-2.4-1.6c-2.4 2.1-6 1.6-8-1.2z" fill="#b8650a"/></svg>';

const UPGRADE_ICONS: Record<UpgradeKind, string> = { speed: ICONS.speed, cooldown: ICONS.cooldown, shield: ICONS.shield, life: ICONS.life };

const LOCK =
  '<svg viewBox="0 0 24 24"><path d="M7 10V7.5a5 5 0 0 1 10 0V10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><rect x="4.5" y="10" width="15" height="11" rx="2.6" fill="currentColor"/><circle cx="12" cy="15.5" r="1.8" fill="#052033"/></svg>';

const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The level whose clear opens endless mode. */
const ENDLESS_GATE = LEVELS.find((l) => l.id === ENDLESS_UNLOCK)!;

/** Intro-card line for the first level that can roll each mid-level event. */
const EVENT_NOTES: Record<EventId, string> = {
  baitBall: 'New: once you grow, bait balls swirl in. Feast while they last!',
  riptide: 'New: riptides can sweep the water sideways',
  whale: 'New: a humpback may lunge up from below. Watch for rising bubbles!',
};

const TIPS = [
  'Predators give up when you swim out of range. Break line of sight and keep moving.',
  'Check the food chain (top right): green-ringed fish are food, red ones will eat you.',
  'Eat quickly to build a Frenzy: 5 in a row doubles your points, 10 triples them.',
  'After respawning, a shield bubble protects you for a moment. Use it to escape.',
  'Black pearls give an extra life. Watch the oysters open and close.',
  'A red glow in a fish\u2019s eyes means it has spotted you.',
  'Lure predators into sea mines to blow them up for bonus points.',
  `Boost to snatch fleeing prey or dodge a predator\u2019s bite. It recharges in ${BOOST.cooldown} seconds.`,
  'Every clear earns coins. Spend them in the Shop on speed, recharge, longer shields and extra lives.',
  'A golden fish shows up now and then. Catch it for coins and 6 seconds of double points!',
  'Each level has 3 optional challenges worth bonus coins. Track them at the top left.',
  'Gulp\u2019s suction pulls in every small fish in front of it. Aim at the middle of a school!',
  'Spike puffs up into a spiny ball. Wait until a hunter is close, then puff to bounce it away stunned.',
];

function touchUi(): boolean {
  return document.body.classList.contains('touch') || matchMedia('(pointer: coarse)').matches;
}

function fullscreenSupported(): boolean {
  const doc = document as Document & { webkitFullscreenEnabled?: boolean };
  return Boolean(document.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

function starsHtml(n: number, cls = ''): string {
  return [1, 2, 3].map((i) => `<span class="star ${i <= n ? 'on' : ''} ${cls}" style="--i:${i}">${STAR}</span>`).join('');
}

function coinBadge(coins: number, cls = ''): HTMLElement {
  return h('span', { class: `coin-badge ${cls}`.trim(), attrs: { title: 'Coins' } }, h('span', { class: 'coin-icon', html: COIN }), h('b', { text: formatScore(coins) }));
}

export class Screens {
  private readonly root: HTMLElement;
  private current: HTMLElement | null = null;
  private back: (() => void) | null = null;
  private intro: { el: HTMLElement; timer: number; done: () => void } | null = null;
  private tipIndex = Math.floor(Math.random() * TIPS.length);
  /** Level select tab, and the next level at the time it was picked. */
  private tab: { chapter: ChapterId; next: number } | null = null;
  private hovered: Element | null = null;
  private backing = false;
  /** The paused run is endless (the pause menu offers biomes instead of levels). */
  private pausedEndless = false;
  private pausedLevel: LevelDef | null = null;

  constructor(
    parent: HTMLElement,
    private readonly save: SaveStore,
    private readonly act: ScreenActions,
    private readonly thumb: (id: SpeciesId) => string,
  ) {
    this.root = h('div', { class: 'screens' });
    parent.append(this.root);
    // Capture phase so a sub-screen's back action wins over the gameplay pause toggle.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code !== 'Escape' || !this.back) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        if (e.repeat) return;
        this.act.sound('back');
        this.backing = true;
        this.back();
        this.backing = false;
      },
      true,
    );
    this.root.addEventListener('pointerover', (e) => {
      const el = (e.target as Element).closest('button:not(:disabled)');
      if (el === this.hovered) return;
      this.hovered = el;
      if (el && e.pointerType === 'mouse') this.act.sound('hover');
    });
  }

  get visible(): boolean {
    return this.current !== null;
  }

  private mount(el: HTMLElement, back: (() => void) | null = null, focus?: HTMLElement | null): void {
    if (this.current && !this.backing) this.act.sound('open');
    this.leave();
    this.current = el;
    this.back = back;
    this.root.append(el);
    requestAnimationFrame(() => el.classList.add('enter'));
    const target = focus ?? el.querySelector<HTMLElement>('.btn.primary');
    target?.focus({ preventScroll: true });
  }

  private leave(): void {
    const old = this.current;
    if (!old) return;
    this.current = null;
    old.classList.remove('enter');
    old.classList.add('leave');
    setTimeout(() => old.remove(), 320);
  }

  hide(): void {
    this.leave();
    this.back = null;
  }

  private btn(label: string, cls: string, fn: () => void): HTMLButtonElement {
    return h('button', {
      class: `btn ${cls}`.trim(),
      text: label,
      on: {
        click: () => {
          this.act.click();
          fn();
        },
      },
    });
  }

  showTitle(): void {
    const d = this.save.data;
    const records = Object.values(d.best);
    const stars = records.reduce((a, r) => a + r.stars, 0);
    const total = records.reduce((a, r) => a + r.score, 0);
    const el = h(
      'div',
      { class: 'screen title-screen' },
      h(
        'div',
        { class: 'logo', attrs: { role: 'heading', 'aria-level': '1' } },
        h('span', { class: 'logo-a', text: 'Fin' }),
        h('span', { class: 'logo-b', text: 'Frenzy' }),
      ),
      h('div', { class: 'tagline', text: 'Eat. Grow. Rule the deep.' }),
      h(
        'div',
        { class: 'menu' },
        this.btn('Play', 'primary big', () => {
          if (!d.seenHowTo) this.showHowTo(() => this.showLevels(), () => this.showTitle());
          else this.showLevels();
        }),
        this.endlessOpen()
          ? this.btn('Endless', 'endless-btn', () => this.showEndless())
          : h(
              'button',
              { class: 'btn endless-btn locked', attrs: { disabled: '', title: `Beat ${ENDLESS_GATE.name} to unlock endless mode` } },
              h('span', { class: 'btn-lock', html: LOCK }),
              'Endless',
            ),
        this.btn('Shop', 'shop-btn', () => this.showShop(() => this.showTitle())),
        this.btn('How to play', '', () => this.showHowTo(() => this.showTitle(), () => this.showTitle())),
        this.btn('Settings', '', () => this.showSettings(() => this.showTitle())),
      ),
      stars > 0 || d.coins > 0
        ? h(
            'div',
            { class: 'title-stats' },
            h('span', { class: 'mini-star', html: STAR }),
            `${stars} / ${LEVELS.length * 3}`,
            h('span', { class: 'dot' }),
            `Total ${formatScore(total)}`,
            h('span', { class: 'dot' }),
            coinBadge(d.coins),
          )
        : null,
      d.settings.testMode ? h('div', { class: 'test-badge', text: 'Test mode: every level and fish is open' }) : null,
      fullscreenSupported()
        ? h('button', {
            class: 'icon-btn corner-btn',
            attrs: { 'aria-label': 'Fullscreen', title: 'Fullscreen' },
            html: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            on: {
              click: () => {
                this.act.click();
                this.act.fullscreen();
              },
            },
          })
        : null,
    );
    this.mount(el);
  }

  /**
   * A chapter opens with its first level, once the boss of the one before it is beaten. Any
   * record inside it also keeps it open, for saves from before the bosses existed.
   */
  private chapterOpen(id: ChapterId): boolean {
    const c = CHAPTERS.find((ch) => ch.id === id);
    const d = this.save.data;
    return !c || levelOpen(d, LEVEL_IDS, c.from) || chapterAll(c.id).some((lv) => Boolean(d.best[lv.id]));
  }

  showLevels(chapter?: ChapterId): void {
    const d = this.save.data;
    const next = LEVELS.findIndex((lv) => !d.best[lv.id]);
    // Open on the chapter holding the next level, or the one picked last while that hasn't changed.
    const nextChapter = chapterOf(next >= 0 ? next : LEVELS.length - 1);
    if (chapter) this.tab = { chapter, next };
    else if (!this.tab || this.tab.next !== next) this.tab = { chapter: nextChapter, next };
    const current = this.tab.chapter;
    const open = this.chapterOpen(current);
    const levels = chapterAll(current);
    const locked = (id: HeroId) => !d.heroes.includes(id) && !d.settings.testMode;
    let stars = 0;
    let cleared = 0;
    const grid = h('div', { class: `level-grid ${open ? '' : 'locked'}`.trim() });
    levels.forEach((lv) => {
      const i = lv.index;
      const b = resolveBiome(lv);
      const rec = d.best[lv.id];
      if (rec) {
        stars += rec.stars;
        cleared++;
      }
      // Inside a locked chapter the chapter overlay explains the lock instead.
      const playable = levelOpen(d, LEVEL_IDS, i);
      const status = rec ? (rec.stars >= 3 ? 'perfect' : 'cleared') : i === next ? 'next' : playable || !open ? 'new' : 'locked';
      const ribbon = status === 'perfect' ? 'Perfect!' : status === 'next' ? 'Next up' : '';
      const featured = lv.cover ?? lv.roster[3][0] ?? lv.roster[2][0] ?? lv.roster[1][0];
      const done = this.save.challengesFor(lv.id);
      const doneCount = done.filter(Boolean).length;
      const card = h(
        'button',
        {
          class: `level-card ${status} ${lv.boss ? 'boss' : ''}`.trim(),
          attrs: {
            'aria-label': `${lv.boss ? 'Boss' : 'Level'} ${i + 1}: ${lv.name}, ${playable ? (rec ? `${rec.stars} of 3 stars, best ${formatScore(rec.score)}` : 'not cleared yet') : `locked, clear level ${i} first`}, ${doneCount} of ${done.length} challenges`,
            'aria-disabled': String(!playable),
          },
          style: {
            background: lv.boss
              ? `linear-gradient(100deg, #6a0c22 0%, ${b.fog.mid} 42%, ${b.fog.bottom} 78%, #4a0818 100%)`
              : `linear-gradient(180deg, ${b.fog.top} 0%, ${b.fog.mid} 52%, ${b.fog.bottom} 100%)`,
          },
          on: {
            click: () => {
              if (!open || !playable) return;
              this.act.click();
              this.startLevel(i, () => this.showLevels());
            },
          },
        },
        h('div', { class: 'level-num', text: String(i + 1) }),
        lv.boss ? h('div', { class: 'level-boss-tag', text: 'Boss' }) : null,
        h(
          'div',
          { class: 'level-challenges', attrs: { title: lv.challenges.map((c, k) => `${done[k] ? '\u2713' : '\u2022'} ${challengeLabel(c)}`).join('\n') } },
          ...done.map((on) => h('span', { class: `cpip ${on ? 'on' : ''}` })),
        ),
        ribbon ? h('div', { class: 'level-ribbon', text: ribbon }) : null,
        status === 'locked' ? h('div', { class: 'level-lock', html: LOCK }) : null,
        ...HERO_IDS.filter((id) => locked(id) && HEROES[id].unlockAfter === i).map((id) =>
          h('div', { class: 'level-unlock' }, h('img', { attrs: { src: this.thumb(HEROES[id].species), alt: '' } }), `Clear to unlock ${HEROES[id].name}`),
        ),
        featured ? h('img', { class: 'level-fish', attrs: { src: this.thumb(featured), alt: '' } }) : null,
        h('div', { class: 'level-name', text: lv.name }),
        h('div', { class: 'level-sub', text: lv.subtitle }),
        h(
          'div',
          { class: 'level-foot' },
          h('div', { class: 'level-stars', html: starsHtml(rec?.stars ?? 0) }),
          h('div', { class: 'level-best', text: rec ? `Best ${formatScore(rec.score)}` : status === 'locked' ? `Clear level ${i} to unlock` : 'Not cleared' }),
        ),
      );
      if (!open || !playable) card.tabIndex = -1;
      grid.append(card);
    });
    const tabs = h(
      'div',
      { class: 'chapter-tabs', attrs: { role: 'tablist' } },
      ...CHAPTERS.map((c) => {
        const list = chapterAll(c.id);
        const got = list.reduce((a, lv) => a + (d.best[lv.id]?.stars ?? 0), 0);
        const isOpen = this.chapterOpen(c.id);
        return h(
          'button',
          {
            class: `chapter-tab ${c.id === current ? 'active' : ''} ${isOpen ? '' : 'locked'}`.trim(),
            attrs: { role: 'tab', 'aria-selected': String(c.id === current), 'aria-label': `${c.name}${isOpen ? `, ${got} of ${list.length * 3} stars` : ', locked'}` },
            on: {
              click: () => {
                if (c.id === current) return;
                this.act.click();
                this.showLevels(c.id);
              },
            },
          },
          isOpen ? null : h('span', { class: 'tab-lock', html: LOCK }),
          h('span', { class: 'tab-name', text: c.name }),
          h('span', { class: 'tab-stars' }, h('span', { class: 'mini-star', html: STAR }), `${got}/${list.length * 3}`),
        );
      }),
    );
    const prev = CHAPTERS.find((c) => c.id === current);
    const gate = prev && prev.from > 0 ? LEVELS[prev.from - 1] : null;
    const board = h(
      'div',
      { class: 'level-board' },
      grid,
      open || !gate
        ? null
        : h(
            'div',
            { class: 'chapter-lock' },
            h('div', { class: 'lock-icon', html: LOCK }),
            h('div', { class: 'lock-title', text: `Clear ${gate.name} to unlock` }),
            h('div', { class: 'lock-sub', text: 'Ten tougher remixes of every ocean, each with a new twist' }),
          ),
    );
    const el = h(
      'div',
      { class: 'screen levels-screen' },
      h('h2', { text: 'Choose your ocean' }),
      tabs,
      h(
        'div',
        { class: 'levels-summary' },
        h('span', { class: 'mini-star', html: STAR }),
        `${stars} / ${levels.length * 3}`,
        h('span', { class: 'dot' }),
        `${cleared} / ${levels.length} cleared`,
        h('span', { class: 'dot' }),
        coinBadge(d.coins),
        d.settings.testMode ? h('span', { class: 'test-badge', text: 'Test mode' }) : null,
      ),
      board,
      h('div', { class: 'row' }, this.btn('Back', 'ghost', () => this.showTitle()), this.btn('Shop', 'shop-btn', () => this.showShop(() => this.showLevels()))),
    );
    const focusIdx = levels.findIndex((lv) => lv.index === next);
    const focus = open ? (grid.children[Math.max(0, focusIdx)] as HTMLElement) : (tabs.querySelector('.chapter-tab.active') as HTMLElement);
    this.mount(el, () => this.showTitle(), focus);
  }

  /** Starts a level, asking which fish to use first when there is a choice. */
  startLevel(index: number, back: () => void): void {
    const options = heroesFor(index, this.save.data.heroes, this.save.data.settings.testMode);
    const level = LEVELS[index];
    if (options.length > 1) this.showHeroPick(`Level ${index + 1} \u00b7 ${level.name}`, options, back, (id) => this.act.play(index, id));
    else this.act.play(index, options[0] ?? 'finn');
  }

  private endlessOpen(): boolean {
    const d = this.save.data;
    return d.settings.testMode || Boolean(d.best[ENDLESS_UNLOCK]);
  }

  /** Endless mode's biome picker: any Ocean I biome whose level has been cleared. */
  showEndless(): void {
    const d = this.save.data;
    const bases = endlessBases();
    let focus: HTMLElement | null = null;
    const cards = bases.map((lv) => {
      const b = resolveBiome(lv);
      const open = d.settings.testMode || Boolean(d.best[lv.id]);
      const best = d.endless[lv.biome] ?? 0;
      const featured = lv.cover ?? lv.roster[3][0] ?? lv.roster[2][0];
      const card = h(
        'button',
        {
          class: `level-card endless-card ${open ? (best ? 'cleared' : 'new') : 'locked'}`,
          attrs: {
            'aria-label': `Endless in ${lv.name}${open ? (best ? `, best ${formatScore(best)}` : ', no runs yet') : `, locked, clear level ${lv.index + 1} first`}`,
            'aria-disabled': String(!open),
          },
          style: { background: `linear-gradient(180deg, ${b.fog.top} 0%, ${b.fog.mid} 52%, ${b.fog.bottom} 100%)` },
          on: {
            click: () => {
              if (!open) return;
              this.act.click();
              this.startEndless(lv.index, () => this.showEndless());
            },
          },
        },
        open ? null : h('div', { class: 'level-lock', html: LOCK }),
        featured ? h('img', { class: 'level-fish', attrs: { src: this.thumb(featured), alt: '' } }) : null,
        h('div', { class: 'level-name', text: lv.name }),
        h('div', { class: 'level-sub', text: lv.subtitle }),
        h('div', { class: 'level-foot' }, h('div', { class: 'level-best', text: open ? (best ? `Best ${formatScore(best)}` : 'No runs yet') : `Clear level ${lv.index + 1} to unlock` })),
      );
      if (!open) card.tabIndex = -1;
      else if (!focus) focus = card;
      return card;
    });
    const el = h(
      'div',
      { class: 'screen levels-screen endless-screen' },
      h('h2', { text: 'Endless' }),
      h('p', { class: 'endless-intro', text: `Survive as long as you can. Danger rises every ${ENDLESS.step} seconds, and your points rise with it.` }),
      h('div', { class: 'level-board' }, h('div', { class: 'level-grid' }, ...cards)),
      h('div', { class: 'row' }, this.btn('Back', 'ghost', () => this.showTitle()), this.btn('Shop', 'shop-btn', () => this.showShop(() => this.showEndless()))),
    );
    this.mount(el, () => this.showTitle(), focus);
  }

  /** Starts an endless run, asking which fish to use first when there is a choice. */
  startEndless(index: number, back: () => void): void {
    const options = endlessHeroes(this.save.data.heroes, this.save.data.settings.testMode);
    if (options.length > 1) this.showHeroPick(`Endless \u00b7 ${LEVELS[index].name}`, options, back, (id) => this.act.playEndless(index, id));
    else this.act.playEndless(index, options[0] ?? 'finn');
  }

  private showHeroPick(eyebrow: string, options: HeroId[], back: () => void, play: (id: HeroId) => void): void {
    const last = this.save.data.hero;
    let focus: HTMLElement | null = null;
    const cards = options.map((id) => {
      const def = HEROES[id];
      const cooldown = abilityCooldownFor(def.ability).toFixed(0);
      const card = h(
        'button',
        {
          class: `hero-card hero-${id} ${id === last ? 'selected' : ''}`.trim(),
          attrs: { 'aria-label': `Play as ${def.name}: ${def.blurb}` },
          on: {
            click: () => {
              this.act.click();
              this.act.pickHero(id);
              play(id);
            },
          },
        },
        id === last ? h('div', { class: 'level-ribbon', text: 'Last pick' }) : null,
        h('img', { class: 'hero-fish', attrs: { src: this.thumb(def.species), alt: '' } }),
        h('div', { class: 'hero-name', text: def.name }),
        h('div', { class: 'hero-ability' }, h('span', { class: 'hero-ability-icon', html: ABILITY_ICONS[def.ability] }), `${def.abilityName} \u00b7 ${cooldown}s`),
        h('div', { class: 'hero-blurb', text: def.blurb }),
      );
      if (id === last) focus = card;
      return card;
    });
    const el = h(
      'div',
      { class: 'screen panel hero-screen' },
      h('div', { class: 'eyebrow', text: eyebrow }),
      h('h2', { text: 'Choose your fish' }),
      h('div', { class: `hero-grid ${cards.length > 2 ? 'three' : ''}`.trim() }, ...cards),
      h('div', { class: 'row' }, this.btn('Back', 'ghost', back)),
    );
    this.mount(el, back, focus ?? cards[0]);
  }

  showShop(back: () => void): void {
    const balance = coinBadge(this.save.data.coins, 'big');
    const rows = (Object.keys(UPGRADES) as UpgradeKind[]).map((kind) => {
      const def = UPGRADES[kind];
      const pips = h('div', { class: 'shop-pips' });
      const value = h('div', { class: 'shop-value' });
      const buy = h('button', {
        class: 'btn primary shop-buy',
        on: {
          click: () => {
            if (this.act.buy(kind)) {
              refresh();
              row.classList.remove('bought');
              void row.offsetWidth;
              row.classList.add('bought');
            } else {
              this.act.click();
            }
          },
        },
      });
      const row = h(
        'div',
        { class: `shop-row shop-${kind}` },
        h('div', { class: 'tip-icon', html: UPGRADE_ICONS[kind] }),
        h('div', { class: 'shop-body' }, h('div', { class: 'tip-title', text: def.name }), value, pips),
        buy,
      );
      return { kind, pips, value, buy, row };
    });
    const refresh = () => {
      const d = this.save.data;
      balance.querySelector('b')!.textContent = formatScore(d.coins);
      for (const r of rows) {
        const level = d.upgrades[r.kind];
        const cost = upgradeCost(level, r.kind);
        r.value.textContent = level > 0 ? `Now ${UPGRADES[r.kind].describe(level)}` : 'No upgrades yet';
        r.pips.replaceChildren(...Array.from({ length: upgradeMax(r.kind) }, (_, i) => h('span', { class: `pip ${i < level ? 'on' : ''}` })));
        r.buy.replaceChildren();
        if (cost === null) {
          r.buy.textContent = 'Maxed';
          r.buy.disabled = true;
          r.buy.setAttribute('aria-label', `${UPGRADES[r.kind].name} is maxed`);
        } else {
          r.buy.append(h('span', { class: 'coin-icon', html: COIN }), h('b', { text: formatScore(cost) }));
          r.buy.disabled = d.coins < cost;
          r.buy.setAttribute('aria-label', `Buy ${UPGRADES[r.kind].describe(level + 1)} for ${cost} coins`);
        }
        r.buy.classList.toggle('maxed', cost === null);
      }
    };
    refresh();
    const el = h(
      'div',
      { class: 'screen panel shop-screen' },
      h('h2', { text: 'Shop' }),
      balance,
      h('div', { class: 'tips' }, ...rows.map((r) => r.row)),
      h('p', { class: 'shop-note', text: 'Upgrades apply to every fish you play. Earn coins by clearing levels, completing challenges and catching golden fish.' }),
      h('div', { class: 'row' }, this.btn('Done', 'ghost', back)),
    );
    this.mount(el, back, rows.find((r) => !r.buy.disabled)?.buy ?? null);
  }

  showSettings(back: () => void): void {
    const s = this.save.data.settings;
    const slider = (label: string, value: number, onInput: (v: number) => void) => {
      const input = h('input', {
        attrs: { type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(value * 100)), 'aria-label': label },
      });
      const out = h('span', { class: 'setting-value', text: `${Math.round(value * 100)}` });
      const paint = () => input.style.setProperty('--fill', `${input.value}%`);
      paint();
      input.addEventListener('input', () => {
        out.textContent = input.value;
        paint();
        onInput(Number(input.value) / 100);
      });
      return h('label', { class: 'setting' }, h('span', { class: 'setting-label', text: label }), h('div', { class: 'setting-control' }, input, out));
    };
    const seg = <T extends string>(label: string, options: [T, string][], current: T, onPick: (v: T) => void) => {
      const wrap = h('div', { class: 'segmented', attrs: { role: 'radiogroup', 'aria-label': label } });
      for (const [v, t] of options) {
        const b = h('button', {
          class: v === current ? 'on' : '',
          text: t,
          attrs: { role: 'radio', 'aria-checked': String(v === current) },
          on: {
            click: () => {
              for (const x of wrap.querySelectorAll('button')) {
                x.classList.remove('on');
                x.setAttribute('aria-checked', 'false');
              }
              b.classList.add('on');
              b.setAttribute('aria-checked', 'true');
              this.act.click();
              onPick(v);
            },
          },
        });
        wrap.append(b);
      }
      return h('div', { class: 'setting' }, h('span', { class: 'setting-label', text: label }), wrap);
    };
    const el = h(
      'div',
      { class: 'screen panel settings-screen' },
      h('h2', { text: 'Settings' }),
      slider('Music', s.music, (v) => this.act.settings({ music: v })),
      slider('Sound effects', s.sfx, (v) => this.act.settings({ sfx: v })),
      seg<QualitySetting>(
        'Graphics',
        [
          ['auto', 'Auto'],
          ['low', 'Low'],
          ['medium', 'Medium'],
          ['high', 'High'],
          ['ultra', 'Ultra'],
        ],
        s.quality,
        (v) => this.act.settings({ quality: v }),
      ),
      seg<'on' | 'off'>(
        'Screen shake',
        [
          ['on', 'On'],
          ['off', 'Off'],
        ],
        s.shake ? 'on' : 'off',
        (v) => this.act.settings({ shake: v === 'on' }),
      ),
      seg<ControlScheme>(
        'Mouse control',
        [
          ['follow', 'Follow pointer'],
          ['keys', 'Keys only'],
        ],
        s.controls,
        (v) => this.act.settings({ controls: v }),
      ),
      seg<'on' | 'off'>(
        'Test mode',
        [
          ['on', 'On'],
          ['off', 'Off'],
        ],
        s.testMode ? 'on' : 'off',
        (v) => {
          this.act.settings({ testMode: v === 'on' });
          // The level map may have been opened on a chapter that test mode just locked again.
          this.tab = null;
        },
      ),
      h('p', { class: 'setting-note', text: 'Test mode opens every level and fish without changing your saved progress.' }),
      this.clearProgressRow(),
      h('div', { class: 'row' }, this.btn('Fullscreen', 'ghost', () => this.act.fullscreen()), this.btn('Done', 'primary', back)),
    );
    this.mount(el, back);
  }

  /** "Clear progress" that asks once more before wiping the save. */
  private clearProgressRow(): HTMLElement {
    const row = h('div', { class: 'setting clear-progress' });
    const ask = (): void => {
      row.replaceChildren(
        h('span', { class: 'setting-label', text: 'Progress' }),
        this.btn('Clear progress', 'danger small', confirm),
      );
    };
    const confirm = (): void => {
      const cancel = this.btn('Cancel', 'ghost small', () => {
        ask();
        row.querySelector<HTMLElement>('.btn')?.focus();
      });
      row.replaceChildren(
        h('span', { class: 'setting-label confirm-text', text: 'Erase all levels, stars, coins, upgrades and fish? This can\u2019t be undone.' }),
        h(
          'div',
          { class: 'setting-control' },
          cancel,
          this.btn('Erase', 'danger small', () => {
            this.tab = null;
            this.act.clearProgress();
          }),
        ),
      );
      cancel.focus();
    };
    ask();
    return row;
  }

  showHowTo(then: () => void, back: () => void): void {
    const touch = touchUi();
    const tip = (icon: string, title: string, text: string, cls: string) =>
      h('div', { class: `tip ${cls}` }, h('div', { class: 'tip-icon', html: icon }), h('div', { class: 'tip-body' }, h('div', { class: 'tip-title', text: title }), h('div', { class: 'tip-text', text })));
    const el = h(
      'div',
      { class: 'screen panel howto-screen' },
      h('h2', { text: 'How to play' }),
      h(
        'div',
        { class: 'tips' },
        tip(
          ICONS.move,
          'Swim',
          touch ? 'Touch and drag anywhere to steer with the virtual stick.' : 'Lead your fish with the mouse, or use WASD / arrow keys.',
          'tip-move',
        ),
        tip(ICONS.eat, 'Eat smaller fish', 'Green-ringed fish in the food chain are food. Fill the growth meter to grow, and grow 3 times to clear the level.', 'tip-eat'),
        tip(ICONS.danger, 'Escape bigger fish', 'Red-ringed fish hunt you when you come close and their eyes glow red. Swim away and they give up.', 'tip-danger'),
        tip(
          ICONS.boost,
          'Boost',
          touch
            ? `Tap the boost button, or tap with a second finger, for a quick dash. It recharges in ${BOOST.cooldown} seconds.`
            : `Left-click (or press Space) for a quick dash to catch prey or escape. It recharges in ${BOOST.cooldown} seconds.`,
          'tip-boost',
        ),
        tip(
          ABILITY_ICONS.suction,
          'Gulp\u2019s suction',
          this.save.data.heroes.includes('gulp')
            ? `Playing as Gulp, the same button inhales every small fish in front of you for ${SUCTION.duration} seconds. Point it at a school!`
            : `Clear level ${HEROES.gulp.unlockAfter + 1} to unlock Gulp, who inhales every small fish in front of it instead of dashing.`,
          'tip-suction',
        ),
        tip(
          ABILITY_ICONS.puff,
          'Spike\u2019s puff',
          this.save.data.heroes.includes('spike')
            ? `Playing as Spike, the same button puffs you into a spiny ball for ${PUFF_ABILITY.duration} seconds. Hunters that touch you bounce off stunned.`
            : `Clear level ${HEROES.spike.unlockAfter + 1} to unlock Spike, who puffs into a spiny ball that bounces hunters away.`,
          'tip-suction',
        ),
        tip(ICONS.combo, 'Feeding frenzy', 'Eat fast to chain combos: 5 in a row doubles your points, 10 triples them.', 'tip-combo'),
        tip(ICONS.pearl, 'Treasure and hazards', 'Snatch pearls from open oysters and catch sinking power-ups. Jellyfish sting and mines explode!', 'tip-pearl'),
        tip(
          ICONS.twist,
          'Every ocean has a twist',
          'Each level has its own mechanic, from puffing pufferfish to rising tides and heat waves. Catch golden fish and finish challenges for bonus coins.',
          'tip-twist',
        ),
      ),
      h(
        'div',
        { class: 'row' },
        this.btn('Got it!', 'primary big', () => {
          this.act.howToSeen();
          then();
        }),
      ),
    );
    this.mount(el, back);
  }

  /** The level's twist first, then what is new compared with the level before it. */
  private levelNotes(level: LevelDef): string[] {
    const notes: string[] = [];
    if (level.tip) notes.push(level.tip);
    const prev = LEVELS[level.index - 1];
    if (level.endless) {
      notes.push(`Danger rises every ${ENDLESS.step} seconds: more hunters, faster chases, more events`);
      notes.push(`A great white joins the hunt at danger ${ENDLESS.greatWhiteFrom}`);
    } else {
      if (level.hazards.jellyfish > 0 && !(prev && prev.hazards.jellyfish > 0)) notes.push('Watch out: jellyfish sting and stun you');
      if (level.hazards.mines > 0 && !(prev && prev.hazards.mines > 0)) notes.push('New: sea mines blow up anything nearby');
      if (level.greatWhite) notes.push(prev?.greatWhite ? 'A great white patrols these waters' : 'New: a great white patrols these waters. Get out of its path!');
      const before = prev ? (levelEvents(prev)?.pool ?? []) : [];
      for (const id of levelEvents(level)?.pool ?? []) if (!before.includes(id)) notes.push(EVENT_NOTES[id]);
      if (level.index === 0) {
        notes.push(touchUi() ? 'Tap the boost button for a quick dash' : 'Left-click to boost');
        notes.push('Grab pearls from open oysters for big points');
      }
    }
    return notes;
  }

  showIntro(level: LevelDef, done: () => void): void {
    this.hide();
    this.skipIntro();
    const notes = this.levelNotes(level);
    const boss = level.boss;
    const el = h(
      'div',
      { class: boss ? 'intro boss' : level.endless ? 'intro endless' : 'intro' },
      h('div', { class: 'intro-level', text: boss ? `Boss \u00b7 Level ${level.index + 1}` : level.endless ? 'Endless' : `Level ${level.index + 1}` }),
      h('div', { class: 'intro-name', text: boss ? boss.name : level.name }),
      h('div', { class: 'intro-sub', text: level.endless ? 'How long can you survive?' : level.subtitle }),
      h('div', {
        class: 'intro-goal',
        text: boss
          ? `You start fully grown \u00b7 Dodge its attacks, then bite its weak spot \u00b7 ${boss.phases} phases`
          : level.endless
            ? `Eat ${level.fishPerStage} fish to grow \u00b7 No finish line \u00b7 The run ends when your lives run out`
            : `Eat ${level.fishPerStage} fish to grow \u00b7 3 growth stages`,
      }),
      ...notes.map((n, i) => h('div', { class: `intro-note ${i === 0 && level.tip ? 'twist' : ''}`.trim(), text: n })),
    );
    this.root.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    this.intro = { el, timer: 2.8 + notes.length * 0.5 + (level.tip ? 1.4 : 0), done };
  }

  /** Advances the intro card; returns true while it is still up. */
  updateIntro(dt: number): boolean {
    const it = this.intro;
    if (!it) return false;
    it.timer -= dt;
    if (it.timer <= 0) this.skipIntro();
    return this.intro !== null;
  }

  skipIntro(): void {
    const it = this.intro;
    if (!it) return;
    this.intro = null;
    it.el.classList.remove('show');
    it.el.classList.add('out');
    setTimeout(() => it.el.remove(), 700);
    it.done();
  }

  showPause(level = this.pausedLevel, endless = this.pausedEndless): void {
    this.pausedLevel = level;
    this.pausedEndless = endless;
    const notes = level ? this.levelNotes(level) : [];
    const title = level?.boss ? level.boss.name : level?.endless ? 'Endless' : level?.name;
    const el = h(
      'div',
      { class: 'screen panel pause-screen' },
      h('h2', { text: 'Paused' }),
      notes.length > 0
        ? h(
            'div',
            { class: 'pause-tips' },
            h('div', { class: 'pause-tips-title', text: title ? `Tips \u00b7 ${title}` : 'Tips' }),
            h('ul', {}, ...notes.map((n, i) => h('li', { class: i === 0 && level?.tip ? 'twist' : '', text: n }))),
          )
        : null,
      h(
        'div',
        { class: 'menu' },
        this.btn('Resume', 'primary big', () => this.act.resume()),
        this.btn(endless ? 'Restart run' : 'Restart level', '', () => this.act.restart()),
        endless ? this.btn('Endless biomes', '', () => this.act.endless()) : this.btn('Level select', '', () => this.act.levels()),
        this.btn('Settings', '', () => this.showSettings(() => this.showPause())),
        this.btn('Quit to menu', 'ghost', () => this.act.quit()),
      ),
    );
    this.mount(el);
  }

  private rewardRows(reward: Reward): { rows: HTMLElement[]; coins: HTMLElement } {
    const coins = h('b', { class: 'count', text: '+0' });
    const rows: HTMLElement[] = [
      h(
        'div',
        { class: 'result-coins' },
        h('span', { class: 'coin-icon', html: COIN }),
        h('span', { text: reward.firstClear ? 'Coins (first clear bonus!)' : 'Coins' }),
        coins,
      ),
    ];
    for (const id of reward.unlocked) {
      const def = HEROES[id];
      rows.push(
        h(
          'div',
          { class: 'unlock-banner' },
          h('img', { attrs: { src: this.thumb(def.species), alt: '' } }),
          h('div', {}, h('div', { class: 'unlock-title', text: `New fish unlocked: ${def.name}!` }), h('div', { class: 'unlock-sub', text: `${def.blurb} Pick it before levels ${def.minLevel + 1}\u2013${LEVELS.length}.` })),
        ),
      );
    }
    return { rows, coins };
  }

  /** Challenge checklist for a cleared run; first-time completions show their coin bonus. */
  private challengeList(r: LevelResult, reward: Reward): HTMLElement {
    const level = LEVELS[r.levelIndex];
    const saved = this.save.challengesFor(level.id);
    const items = level.challenges.map((c, i) => {
      const now = r.challenges[i] ?? false;
      const fresh = reward.newChallenges.includes(i);
      const state = now ? 'done' : saved[i] ? 'old' : 'miss';
      return h(
        'div',
        { class: `challenge-item ${state} ${fresh ? 'fresh' : ''}`.trim(), attrs: { style: `--i:${i}` } },
        h('span', { class: 'challenge-check', html: now || saved[i] ? CHECK : '' }),
        h('span', { class: 'challenge-text', text: challengeLabel(c) }),
        fresh ? h('b', { class: 'challenge-pay' }, h('span', { class: 'coin-icon', html: COIN }), `+${CHALLENGE_COINS}`) : null,
      );
    });
    const extra =
      reward.goldenCoins > 0
        ? h('div', { class: 'challenge-item golden done' }, h('span', { class: 'challenge-check', html: STAR }), h('span', { class: 'challenge-text', text: 'Golden fish caught' }), h('b', { class: 'challenge-pay' }, h('span', { class: 'coin-icon', html: COIN }), `+${reward.goldenCoins}`))
        : null;
    return h('div', { class: 'challenge-list' }, h('div', { class: 'challenge-head', text: 'Challenges' }), ...items, extra);
  }

  showResults(r: LevelResult, isBest: boolean, hasNext: boolean, reward: Reward): void {
    const rows: [string, string][] = [
      ['Fish eaten', String(r.fishEaten)],
      ['Best combo', String(r.maxCombo)],
      ['Pearls', String(r.pearls)],
      ['Time', formatTime(r.time)],
      ['Score', formatScore(r.baseScore)],
      ['Speed bonus', r.bonus.time ? `+${formatScore(r.bonus.time)}` : '\u2014'],
      ['No-death bonus', r.bonus.noDeath ? `+${formatScore(r.bonus.noDeath)}` : '\u2014'],
    ];
    const total = h('b', { class: 'count', text: '0' });
    const pay = this.rewardRows(reward);
    const el = h(
      'div',
      { class: 'screen panel results-screen' },
      h('div', { class: 'eyebrow', text: LEVELS[r.levelIndex].name }),
      h('h2', { text: 'Level complete!' }),
      h('div', { class: 'big-stars', html: starsHtml(r.stars, 'pop') }),
      h('div', { class: 'result-rows' }, ...rows.map(([k, v]) => h('div', { class: 'result-row' }, h('span', { text: k }), h('b', { text: v })))),
      h('div', { class: 'result-total' }, h('span', { text: 'Total' }), total),
      isBest ? h('div', { class: 'new-best', text: 'New best!' }) : null,
      this.challengeList(r, reward),
      ...pay.rows,
      h(
        'div',
        { class: 'row' },
        hasNext ? this.btn('Next level', 'primary big', () => this.act.next()) : null,
        this.btn('Replay', '', () => this.act.restart()),
        this.btn('Levels', 'ghost', () => this.act.levels()),
      ),
    );
    this.mount(el);
    this.starChimes(r.stars);
    this.countUp(total, r.score, 1.3);
    this.countUp(pay.coins, reward.coins, 1, '+', 1.5);
  }

  /** The end of an endless run: how long it lasted, how bad it got, and the biome's best. */
  showEndlessResults(r: EndlessResult, isBest: boolean, prevBest: number, coins: number): void {
    const level = LEVELS[r.levelIndex];
    const rows: [string, string][] = [
      ['Time survived', formatTime(r.time)],
      ['Peak danger', String(r.danger)],
      ['Fish eaten', String(r.fishEaten)],
      ['Best combo', String(r.maxCombo)],
      ['Biome best', formatScore(Math.max(prevBest, r.score))],
    ];
    const total = h('b', { class: 'count', text: '0' });
    const coinsEl = h('b', { class: 'count', text: '+0' });
    const el = h(
      'div',
      { class: 'screen panel results-screen endless-results' },
      h('div', { class: 'eyebrow', text: `Endless \u00b7 ${level.name}` }),
      h('h2', { text: 'Run over' }),
      h('div', { class: 'result-rows' }, ...rows.map(([k, v]) => h('div', { class: 'result-row' }, h('span', { text: k }), h('b', { text: v })))),
      h('div', { class: 'result-total' }, h('span', { text: 'Score' }), total),
      isBest ? h('div', { class: 'new-best', text: prevBest > 0 ? `New best! Beat ${formatScore(prevBest)}` : 'New best!' }) : null,
      h('div', { class: 'result-coins' }, h('span', { class: 'coin-icon', html: COIN }), h('span', { text: 'Coins' }), coinsEl),
      h(
        'div',
        { class: 'row' },
        this.btn('Go again', 'primary big', () => this.act.restart()),
        this.btn('Biomes', '', () => this.act.endless()),
        this.btn('Menu', 'ghost', () => this.act.quit()),
      ),
    );
    this.mount(el);
    this.countUp(total, r.score, 1.3);
    this.countUp(coinsEl, coins, 1, '+', 1.5);
  }

  showGameOver(score: number, level: LevelDef): void {
    const best = this.save.data.best[level.id]?.score ?? 0;
    this.tipIndex = (this.tipIndex + 1) % TIPS.length;
    const el = h(
      'div',
      { class: 'screen panel gameover-screen' },
      h('div', { class: 'eyebrow', text: level.name }),
      h('h2', { text: 'Game over' }),
      h('div', { class: 'go-score', text: formatScore(score) }),
      h('div', { class: 'go-best', text: best ? `Best ${formatScore(best)}` : 'Clear the level to set a best score' }),
      h('div', { class: 'go-tip' }, h('b', { text: 'Tip: ' }), TIPS[this.tipIndex]),
      h('div', { class: 'row' }, this.btn('Try again', 'primary big', () => this.act.restart()), this.btn('Levels', 'ghost', () => this.act.levels())),
    );
    this.mount(el);
  }

  /** Shown after the last level of a chapter: the next chapter is open. */
  showChapterComplete(r: LevelResult, isBest: boolean, reward: Reward): void {
    const done = chapterOf(r.levelIndex);
    const doneDef = CHAPTERS.find((c) => c.id === done)!;
    const nextDef = CHAPTERS.find((c) => c.from === r.levelIndex + 1);
    const list = chapterAll(done);
    const stars = list.reduce((a, lv) => a + (this.save.data.best[lv.id]?.stars ?? 0), 0);
    const totalEl = h('b', { class: 'count', text: '0' });
    const pay = this.rewardRows(reward);
    const preview = nextDef
      ? h(
          'div',
          { class: 'chapter-preview' },
          ...chapterLevels(nextDef.id)
            .slice(0, 5)
            .map((lv) => {
              const b = resolveBiome(lv);
              const fish = lv.cover ?? lv.roster[3][0];
              return h(
                'div',
                { class: 'preview-card', attrs: { title: lv.name }, style: { background: `linear-gradient(180deg, ${b.fog.top}, ${b.fog.bottom})` } },
                h('img', { attrs: { src: this.thumb(fish), alt: '' } }),
              );
            }),
        )
      : null;
    const el = h(
      'div',
      { class: 'screen panel victory-screen chapter-screen' },
      h('div', { class: 'eyebrow', text: `${LEVELS[r.levelIndex].name} ${LEVELS[r.levelIndex].boss ? 'defeated' : 'cleared'}` }),
      h('h2', { text: `${doneDef.name} complete!` }),
      h('div', { class: 'big-stars', html: starsHtml(r.stars, 'pop') }),
      nextDef
        ? h('p', { class: 'victory-text' }, h('b', { text: `${nextDef.name} unlocked. ` }), 'Ten tougher remixes of every ocean, each with a twist of its own.')
        : null,
      preview,
      h(
        'div',
        { class: 'result-rows' },
        h('div', { class: 'result-row' }, h('span', { text: `${LEVELS[r.levelIndex].name} score` }), h('b', { text: formatScore(r.score) })),
        h('div', { class: 'result-row' }, h('span', { text: `${doneDef.name} stars` }), h('b', { text: `${stars} / ${list.length * 3}` })),
      ),
      h('div', { class: 'result-total' }, h('span', { text: 'Run total' }), totalEl),
      isBest ? h('div', { class: 'new-best', text: 'New best!' }) : null,
      this.challengeList(r, reward),
      ...pay.rows,
      h(
        'div',
        { class: 'row' },
        nextDef ? this.btn('Dive deeper', 'primary big', () => this.startLevel(nextDef.from, () => this.act.levels())) : null,
        this.btn('Replay', '', () => this.act.restart()),
        this.btn('Levels', 'ghost', () => this.act.levels()),
      ),
    );
    this.mount(el);
    this.starChimes(r.stars);
    this.countUp(totalEl, r.score, 1.3);
    this.countUp(pay.coins, reward.coins, 1, '+', 1.5);
  }

  showVictory(r: LevelResult, isBest: boolean, reward: Reward): void {
    const records = Object.values(this.save.data.best);
    const stars = records.reduce((a, x) => a + x.stars, 0);
    const total = records.reduce((a, x) => a + x.score, 0);
    const totalEl = h('b', { class: 'count', text: '0' });
    const pay = this.rewardRows(reward);
    const el = h(
      'div',
      { class: 'screen panel victory-screen' },
      h('div', { class: 'eyebrow', text: 'All oceans conquered' }),
      h('h2', { text: 'Ruler of the deep!' }),
      h('p', { class: 'victory-text', text: 'From tiny fry to the bane of the Kraken. Nothing in the sea is bigger than you now.' }),
      h('div', { class: 'big-stars', html: starsHtml(r.stars, 'pop') }),
      h('div', { class: 'result-rows' }, h('div', { class: 'result-row' }, h('span', { text: `${LEVELS[r.levelIndex].name} score` }), h('b', { text: formatScore(r.score) })), h('div', { class: 'result-row' }, h('span', { text: 'Stars collected' }), h('b', { text: `${stars} / ${LEVELS.length * 3}` }))),
      h('div', { class: 'result-total' }, h('span', { text: 'All levels' }), totalEl),
      isBest ? h('div', { class: 'new-best', text: 'New best!' }) : null,
      this.challengeList(r, reward),
      ...pay.rows,
      h('div', { class: 'row' }, this.btn('Level select', 'primary big', () => this.act.levels()), this.btn('Menu', 'ghost', () => this.act.quit())),
    );
    this.mount(el);
    this.starChimes(r.stars);
    this.countUp(totalEl, total, 1.6);
    this.countUp(pay.coins, reward.coins, 1, '+', 1.7);
  }

  /** Chimes in time with the star pop animation (see .star.pop in styles.css). */
  private starChimes(stars: number): void {
    for (let i = 1; i <= stars; i++) this.act.sound('star', { delay: 0.47 + i * 0.28, pitch: [1, 1.26, 1.5][i - 1] });
  }

  private countUp(el: HTMLElement, value: number, seconds: number, prefix = '', delay = 0.35): void {
    const start = performance.now() + delay * 1000;
    let last = 0;
    const tick = (now: number) => {
      if (!el.isConnected) return;
      const k = Math.min(1, Math.max(0, (now - start) / (seconds * 1000)));
      el.textContent = prefix + formatScore(value * (1 - Math.pow(1 - k, 3)));
      if (value > 0 && k > 0 && k < 1 && now - last > 55) {
        last = now;
        this.act.sound('tally', { pitch: 0.9 + k * 0.5 });
      }
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
