import { HEROES, isHeroId, upgradeCost, upgradeMax, type HeroId, type UpgradeKind } from '../config/progression';

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
/** 'follow': the fish swims toward the cursor (keys still work). 'keys': cursor is ignored. */
export type ControlScheme = 'follow' | 'keys';

export interface Settings {
  music: number;
  sfx: number;
  quality: QualitySetting;
  shake: boolean;
  controls: ControlScheme;
  /** Opens every level and fish without touching the save's real progress. */
  testMode: boolean;
}

export interface LevelRecord {
  score: number;
  stars: number;
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  /** Furthest level index reached by clearing the one before it. */
  unlocked: number;
  best: Record<string, LevelRecord>;
  settings: Settings;
  seenHowTo: boolean;
  coins: number;
  upgrades: Record<UpgradeKind, number>;
  heroes: HeroId[];
  /** Last hero picked, used as the default in the fish picker. */
  hero: HeroId;
  /** Completed challenges per level id, in the level's challenge order. */
  challenges: Record<string, boolean[]>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SAVE_VERSION = 3;
export const SAVE_KEY = 'fin-frenzy.save';
/** Challenges per level. */
export const CHALLENGES_PER_LEVEL = 3;

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    unlocked: 0,
    best: {},
    settings: { music: 0.6, sfx: 0.8, quality: 'auto', shake: true, controls: 'follow', testMode: false },
    seenHowTo: false,
    coins: 0,
    upgrades: { speed: 0, cooldown: 0, shield: 0, life: 0 },
    heroes: ['finn'],
    hero: 'finn',
    challenges: {},
  };
}

const QUALITY: QualitySetting[] = ['auto', 'low', 'medium', 'high', 'ultra'];

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Turns any stored value into a valid SaveData. Handles missing or corrupt data,
 * the unversioned pre-release format ({ unlockedLevel, scores, volume }) and
 * out-of-range values. Older versions keep the defaults for fields they lack.
 */
export function migrate(raw: unknown, levelCount: number): SaveData {
  const out = defaultSave();
  const src = obj(raw);
  if (!src) return out;
  const maxLevel = Math.max(0, levelCount - 1);

  if (src.version === undefined) {
    out.unlocked = Math.floor(num(src.unlockedLevel, 0, 0, maxLevel));
    const scores = obj(src.scores);
    if (scores) {
      for (const [id, score] of Object.entries(scores)) {
        if (typeof score === 'number' && score > 0) out.best[id] = { score: Math.floor(score), stars: 1 };
      }
    }
    const vol = num(src.volume, -1, 0, 1);
    if (vol >= 0) {
      out.settings.music = vol;
      out.settings.sfx = vol;
    }
    return out;
  }

  out.unlocked = Math.floor(num(src.unlocked, 0, 0, maxLevel));
  const best = obj(src.best);
  if (best) {
    for (const [id, rec] of Object.entries(best)) {
      const r = obj(rec);
      if (!r) continue;
      const score = Math.floor(num(r.score, 0, 0, 1e9));
      const stars = Math.floor(num(r.stars, 0, 0, 3));
      if (score > 0 || stars > 0) out.best[id] = { score, stars };
    }
  }
  const s = obj(src.settings);
  if (s) {
    out.settings.music = num(s.music, out.settings.music, 0, 1);
    out.settings.sfx = num(s.sfx, out.settings.sfx, 0, 1);
    if (QUALITY.includes(s.quality as QualitySetting)) out.settings.quality = s.quality as QualitySetting;
    if (typeof s.shake === 'boolean') out.settings.shake = s.shake;
    if (s.controls === 'follow' || s.controls === 'keys') out.settings.controls = s.controls;
    if (typeof s.testMode === 'boolean') out.settings.testMode = s.testMode;
  }
  out.seenHowTo = src.seenHowTo === true;
  // v2 fields.
  out.coins = Math.floor(num(src.coins, 0, 0, 1e9));
  const up = obj(src.upgrades);
  if (up) {
    for (const kind of Object.keys(out.upgrades) as UpgradeKind[]) {
      out.upgrades[kind] = Math.floor(num(up[kind], 0, 0, upgradeMax(kind)));
    }
  }
  if (Array.isArray(src.heroes)) {
    for (const id of src.heroes) if (isHeroId(id) && !out.heroes.includes(id)) out.heroes.push(id);
  }
  if (isHeroId(src.hero) && out.heroes.includes(src.hero)) out.hero = src.hero;
  // v3 fields.
  const ch = obj(src.challenges);
  if (ch) {
    for (const [id, list] of Object.entries(ch)) {
      if (!Array.isArray(list)) continue;
      const done = Array.from({ length: CHALLENGES_PER_LEVEL }, (_, i) => list[i] === true);
      if (done.some(Boolean)) out.challenges[id] = done;
    }
  }
  return out;
}

/** A level opens once the one before it is cleared. `levelIds` maps level index to id. */
export function levelOpen(data: SaveData, levelIds: readonly string[], index: number): boolean {
  if (index < 0 || index >= levelIds.length) return false;
  return index === 0 || data.settings.testMode || Boolean(data.best[levelIds[index - 1]]);
}

export class SaveStore {
  data: SaveData;

  constructor(
    private readonly storage: StorageLike | null,
    private readonly levelCount: number,
    private readonly key = SAVE_KEY,
  ) {
    this.data = this.load();
  }

  load(): SaveData {
    try {
      const raw = this.storage?.getItem(this.key);
      return migrate(raw ? JSON.parse(raw) : null, this.levelCount);
    } catch {
      return defaultSave();
    }
  }

  persist(): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.data));
    } catch {
      // Storage can be full or disabled (private mode); progress stays in memory.
    }
  }

  /** Records a completed level and unlocks the next one. Returns true for a new best score. */
  recordLevel(id: string, index: number, score: number, stars: number): boolean {
    const prev = this.data.best[id];
    const isBest = !prev || score > prev.score;
    this.data.best[id] = {
      score: Math.max(prev?.score ?? 0, score),
      stars: Math.max(prev?.stars ?? 0, stars),
    };
    this.data.unlocked = Math.min(this.levelCount - 1, Math.max(this.data.unlocked, index + 1));
    this.persist();
    return isBest;
  }

  /** Marks challenges as completed. Returns the indices completed for the first time. */
  recordChallenges(id: string, done: readonly boolean[]): number[] {
    const prev = this.data.challenges[id] ?? Array.from({ length: CHALLENGES_PER_LEVEL }, () => false);
    const fresh: number[] = [];
    const next = prev.map((was, i) => {
      if (!was && done[i]) fresh.push(i);
      return was || done[i] === true;
    });
    if (fresh.length) {
      this.data.challenges[id] = next;
      this.persist();
    }
    return fresh;
  }

  challengesFor(id: string): boolean[] {
    return this.data.challenges[id] ?? Array.from({ length: CHALLENGES_PER_LEVEL }, () => false);
  }

  updateSettings(patch: Partial<Settings>): void {
    this.data.settings = { ...this.data.settings, ...patch };
    this.persist();
  }

  markHowToSeen(): void {
    this.data.seenHowTo = true;
    this.persist();
  }

  addCoins(n: number): void {
    this.data.coins += Math.max(0, Math.floor(n));
    this.persist();
  }

  /** Buys the next tier of an upgrade. Returns false when maxed or unaffordable. */
  buyUpgrade(kind: UpgradeKind): boolean {
    const cost = upgradeCost(this.data.upgrades[kind], kind);
    if (cost === null || this.data.coins < cost) return false;
    this.data.coins -= cost;
    this.data.upgrades[kind]++;
    this.persist();
    return true;
  }

  /**
   * Unlocks every hero whose unlock level has been cleared. `levelIds` maps level index to id.
   * Returns the heroes that were newly unlocked.
   */
  unlockEarnedHeroes(levelIds: readonly string[]): HeroId[] {
    const fresh: HeroId[] = [];
    for (const def of Object.values(HEROES)) {
      if (def.unlockAfter < 0 || this.data.heroes.includes(def.id)) continue;
      const id = levelIds[def.unlockAfter];
      if (id && this.data.best[id]) {
        this.data.heroes.push(def.id);
        fresh.push(def.id);
      }
    }
    if (fresh.length) this.persist();
    return fresh;
  }

  /** Wipes levels, stars, coins, upgrades, fish and challenges. Settings stay. */
  resetProgress(): void {
    this.data = { ...defaultSave(), settings: this.data.settings, seenHowTo: this.data.seenHowTo };
    this.persist();
  }

  setHero(id: HeroId): void {
    if ((!this.data.heroes.includes(id) && !this.data.settings.testMode) || this.data.hero === id) return;
    this.data.hero = id;
    this.persist();
  }
}
