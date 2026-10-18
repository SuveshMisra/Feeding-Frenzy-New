import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, SaveStore, defaultSave, levelOpen, migrate, type StorageLike } from '../src/app/Save';
import { heroesFor } from '../src/config/progression';

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe('Save migration', () => {
  it('returns defaults for missing or corrupt data', () => {
    expect(migrate(null, 5)).toEqual(defaultSave());
    expect(migrate('nonsense', 5)).toEqual(defaultSave());
    expect(migrate([1, 2, 3], 5)).toEqual(defaultSave());
  });

  it('upgrades the unversioned pre-release format', () => {
    const old = { unlockedLevel: 2, scores: { reef: 4200, kelp: 0 }, volume: 0.4 };
    const data = migrate(old, 5);
    expect(data.version).toBe(SAVE_VERSION);
    expect(data.unlocked).toBe(2);
    expect(data.best).toEqual({ reef: { score: 4200, stars: 1 } });
    expect(data.settings.music).toBeCloseTo(0.4);
    expect(data.settings.sfx).toBeCloseTo(0.4);
  });

  it('clamps out-of-range values and drops invalid fields', () => {
    const data = migrate(
      {
        version: 1,
        unlocked: 99,
        best: { reef: { score: -5, stars: 7 }, bogus: 'x' },
        settings: { music: 3, sfx: -1, quality: 'extreme', shake: 'yes', controls: 'gamepad' },
      },
      5,
    );
    expect(data.unlocked).toBe(4);
    expect(data.best).toEqual({ reef: { score: 0, stars: 3 } });
    expect(data.settings).toEqual({ music: 1, sfx: 0, quality: 'auto', shake: true, controls: 'follow', testMode: false });
  });

  it('keeps the ultra graphics setting', () => {
    const data = migrate({ version: 1, unlocked: 0, best: {}, settings: { quality: 'ultra' } }, 5);
    expect(data.settings.quality).toBe('ultra');
  });

  it('keeps a valid control scheme', () => {
    const data = migrate({ version: 1, unlocked: 0, best: {}, settings: { controls: 'keys' } }, 5);
    expect(data.settings.controls).toBe('keys');
  });

  it('round-trips through storage and unlocks the next level', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage, 5);
    expect(store.data.unlocked).toBe(0);
    expect(store.recordLevel('reef', 0, 3500, 2)).toBe(true);
    expect(store.recordLevel('reef', 0, 1200, 1)).toBe(false);
    store.updateSettings({ quality: 'low' });

    const reloaded = new SaveStore(storage, 5);
    expect(reloaded.data.unlocked).toBe(1);
    expect(reloaded.data.best.reef).toEqual({ score: 3500, stars: 2 });
    expect(reloaded.data.settings.quality).toBe('low');
  });

  it('migrates a v1 save without losing progress', () => {
    const v1 = {
      version: 1,
      unlocked: 1,
      best: { reef: { score: 4820, stars: 2 } },
      settings: { music: 0, sfx: 0.3, quality: 'high', shake: true, controls: 'follow' },
      seenHowTo: true,
    };
    const data = migrate(v1, 10);
    expect(data.version).toBe(SAVE_VERSION);
    expect(data.unlocked).toBe(1);
    expect(data.best).toEqual({ reef: { score: 4820, stars: 2 } });
    expect(data.settings).toEqual({ ...v1.settings, testMode: false });
    expect(data.seenHowTo).toBe(true);
    expect(data.coins).toBe(0);
    expect(data.upgrades).toEqual({ speed: 0, cooldown: 0, shield: 0, life: 0 });
    expect(data.challenges).toEqual({});
    expect(data.heroes).toEqual(['finn']);
    expect(data.hero).toBe('finn');
  });

  it('unlocks Gulp for a save that already cleared level 5', () => {
    const storage = new MemoryStorage();
    storage.setItem('fin-frenzy.save', JSON.stringify({ version: 1, unlocked: 5, best: { abyss: { score: 9000, stars: 2 } } }));
    const store = new SaveStore(storage, 10);
    const ids = ['reef', 'kelp', 'wreck', 'ice', 'abyss'];
    expect(store.unlockEarnedHeroes(ids)).toEqual(['gulp']);
    expect(store.unlockEarnedHeroes(ids)).toEqual([]);
    expect(new SaveStore(storage, 10).data.heroes).toEqual(['finn', 'gulp']);
  });

  it('cleans up v2 fields', () => {
    const data = migrate({ version: 2, coins: -4, upgrades: { speed: 9, cooldown: 2.7 }, heroes: ['gulp', 'shark'], hero: 'shark' }, 10);
    expect(data.coins).toBe(0);
    expect(data.upgrades).toEqual({ speed: 6, cooldown: 2, shield: 0, life: 0 });
    expect(data.heroes).toEqual(['finn', 'gulp']);
    expect(data.hero).toBe('finn');
  });

  it('keeps v2 progress when moving to v3', () => {
    const v2 = { version: 2, unlocked: 3, best: { reef: { score: 5000, stars: 3 } }, coins: 410, upgrades: { speed: 2, cooldown: 1 }, heroes: ['finn'], hero: 'finn' };
    const data = migrate(v2, 10);
    expect(data.version).toBe(SAVE_VERSION);
    expect(data.coins).toBe(410);
    expect(data.upgrades).toEqual({ speed: 2, cooldown: 1, shield: 0, life: 0 });
    expect(data.challenges).toEqual({});
    expect(data.best).toEqual(v2.best);
  });

  it('clamps v3 upgrades per kind and cleans challenge flags', () => {
    const data = migrate(
      {
        version: 3,
        upgrades: { speed: 1, cooldown: 0, shield: 9, life: 5 },
        challenges: { reef: [true, 'yes', false, true], kelp: 'nope', wreck: [1, 0, true] },
      },
      10,
    );
    expect(data.upgrades).toEqual({ speed: 1, cooldown: 0, shield: 5, life: 2 });
    expect(data.challenges.reef).toEqual([true, false, false]);
    expect(data.challenges.kelp).toBeUndefined();
    expect(data.challenges.wreck).toEqual([false, false, true]);
  });

  it('records challenges and reports only first-time completions', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage, 10);
    expect(store.challengesFor('reef')).toEqual([false, false, false]);
    expect(store.recordChallenges('reef', [true, false, true])).toEqual([0, 2]);
    expect(store.recordChallenges('reef', [true, true, false])).toEqual([1]);
    expect(store.recordChallenges('reef', [true, true, true])).toEqual([]);
    expect(new SaveStore(storage, 10).challengesFor('reef')).toEqual([true, true, true]);
  });

  it('buys shield and life upgrades on their own price tables', () => {
    const store = new SaveStore(new MemoryStorage(), 10);
    store.addCoins(5000);
    for (let i = 0; i < 2; i++) expect(store.buyUpgrade('life')).toBe(true);
    expect(store.buyUpgrade('life')).toBe(false);
    for (let i = 0; i < 5; i++) expect(store.buyUpgrade('shield')).toBe(true);
    expect(store.buyUpgrade('shield')).toBe(false);
    expect(store.data.coins).toBe(5000 - (350 + 700) - (80 + 120 + 170 + 230 + 300));
  });

  it('buys upgrades with coins up to the cap', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage, 10);
    expect(store.buyUpgrade('speed')).toBe(false);
    store.addCoins(2000);
    for (let i = 0; i < 6; i++) expect(store.buyUpgrade('speed')).toBe(true);
    expect(store.buyUpgrade('speed')).toBe(false);
    expect(store.data.upgrades.speed).toBe(6);
    expect(store.data.coins).toBe(2000 - (60 + 90 + 130 + 180 + 240 + 310));
    expect(new SaveStore(storage, 10).data.upgrades.speed).toBe(6);
  });

  it('only selects unlocked heroes', () => {
    const store = new SaveStore(new MemoryStorage(), 10);
    store.setHero('gulp');
    expect(store.data.hero).toBe('finn');
  });

  it('opens a level only once the one before it is cleared', () => {
    const ids = ['reef', 'kelp', 'wreck', 'ice'];
    const store = new SaveStore(new MemoryStorage(), ids.length);
    expect(ids.map((_, i) => levelOpen(store.data, ids, i))).toEqual([true, false, false, false]);
    store.recordLevel('reef', 0, 3000, 1);
    expect(ids.map((_, i) => levelOpen(store.data, ids, i))).toEqual([true, true, false, false]);
    // A level cleared out of order (in test mode) opens the one after it, not the gap before it.
    store.recordLevel('wreck', 2, 3000, 1);
    expect(ids.map((_, i) => levelOpen(store.data, ids, i))).toEqual([true, true, false, true]);
    expect(levelOpen(store.data, ids, 4)).toBe(false);
    expect(levelOpen(store.data, ids, -1)).toBe(false);
  });

  it('test mode opens every level and hero without changing progress', () => {
    const ids = ['reef', 'kelp', 'wreck'];
    const storage = new MemoryStorage();
    const store = new SaveStore(storage, ids.length);
    store.updateSettings({ testMode: true });
    expect(ids.map((_, i) => levelOpen(store.data, ids, i))).toEqual([true, true, true]);
    expect(heroesFor(0, store.data.heroes, true)).toEqual(['finn', 'gulp', 'spike']);
    store.setHero('spike');
    expect(store.data.hero).toBe('spike');
    expect(store.data.heroes).toEqual(['finn']);
    expect(store.data.best).toEqual({});

    const reloaded = new SaveStore(storage, ids.length);
    expect(reloaded.data.settings.testMode).toBe(true);
    // Back to normal play, the real unlocks apply again.
    reloaded.updateSettings({ testMode: false });
    expect(levelOpen(reloaded.data, ids, 1)).toBe(false);
    expect(new SaveStore(storage, ids.length).data.hero).toBe('finn');
  });

  it('clears progress but keeps settings', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage, 10);
    store.recordLevel('reef', 0, 3000, 2);
    store.recordChallenges('reef', [true, false, false]);
    store.addCoins(500);
    store.buyUpgrade('speed');
    store.data.heroes.push('gulp');
    store.updateSettings({ music: 0.2, quality: 'low', testMode: true });
    store.markHowToSeen();

    store.resetProgress();
    const expected = { ...defaultSave(), settings: { ...defaultSave().settings, music: 0.2, quality: 'low', testMode: true }, seenHowTo: true };
    expect(store.data).toEqual(expected);
    expect(new SaveStore(storage, 10).data).toEqual(expected);
  });

  it('falls back to defaults when stored JSON is broken', () => {
    const storage = new MemoryStorage();
    storage.setItem('fin-frenzy.save', '{not json');
    expect(new SaveStore(storage, 5).data).toEqual(defaultSave());
  });
});
