import { describe, expect, it } from 'vitest';
import { CHAPTERS, LEVELS, chapterLevels } from '../src/config/levels';
import { ChallengeTracker, challengeLabel, emptyChallengeState, evaluateChallenge, progressText, type ChallengeDef } from '../src/game/systems/Challenges';

describe('Challenges', () => {
  it('tracks the best combo, not the current one', () => {
    const t = new ChallengeTracker([{ kind: 'combo', n: 3 }]);
    t.onEat('lionfish', 2);
    t.onEat('lionfish', 3);
    t.onEat('lionfish', 0);
    expect(t.status()[0]).toMatchObject({ done: true, progress: 3, target: 3 });
  });

  it('only completes no-death and time challenges once the level is cleared', () => {
    const noDeath: ChallengeDef = { kind: 'noDeath' };
    const under: ChallengeDef = { kind: 'under', seconds: 200 };
    const s = emptyChallengeState();
    s.time = 150;
    expect(evaluateChallenge(noDeath, s, false).done).toBe(false);
    expect(evaluateChallenge(noDeath, s, true).done).toBe(true);
    expect(evaluateChallenge(under, s, false)).toMatchObject({ done: false, failed: false, progress: 50 });
    expect(evaluateChallenge(under, s, true).done).toBe(true);
    s.deaths = 1;
    s.time = 201;
    expect(evaluateChallenge(noDeath, s, true)).toMatchObject({ done: false, failed: true });
    expect(evaluateChallenge(under, s, true)).toMatchObject({ done: false, failed: true });
  });

  it('counts species, golden fish and feature stats', () => {
    const t = new ChallengeTracker([
      { kind: 'eat', species: 'lionfish', n: 2 },
      { kind: 'golden' },
      { kind: 'feature', key: 'shatter', n: 2, label: 'Shatter 2 crystals' },
    ]);
    t.onEat('lionfish', 1);
    t.onEat('sardine', 1);
    t.stat('shatter');
    expect(t.status().map((s) => s.done)).toEqual([false, false, false]);
    t.onEat('lionfish', 2);
    t.onGolden();
    t.stat('shatter', 1);
    expect(t.status().map((s) => s.done)).toEqual([true, true, true]);
  });

  it('announces each completion once', () => {
    const t = new ChallengeTracker([{ kind: 'golden' }, { kind: 'feature', key: 'ride', n: 5, label: 'Ride' }]);
    expect(t.newlyDone()).toEqual([]);
    t.onGolden();
    expect(t.newlyDone()).toEqual([0]);
    expect(t.newlyDone()).toEqual([]);
    t.stat('ride', 5.5);
    expect(t.newlyDone()).toEqual([1]);
  });

  it('reports final results with the level cleared', () => {
    const t = new ChallengeTracker([{ kind: 'noDeath' }, { kind: 'combo', n: 99 }, { kind: 'under', seconds: 100 }]);
    t.setTime(80);
    expect(t.final()).toEqual([true, false, true]);
    t.onDeath();
    expect(t.final()).toEqual([false, false, true]);
  });

  it('formats progress for the HUD', () => {
    const s = emptyChallengeState();
    s.stats.ride = 7.6;
    const ride: ChallengeDef = { kind: 'feature', key: 'ride', n: 20, label: 'Ride currents' };
    expect(progressText(ride, evaluateChallenge(ride, s, false))).toBe('7/20');
    const under: ChallengeDef = { kind: 'under', seconds: 230 };
    s.time = 100;
    expect(progressText(under, evaluateChallenge(under, s, false))).toBe('2:10 left');
    expect(challengeLabel(under)).toBe('Clear in under 3:50');
    expect(challengeLabel({ kind: 'combo', n: 12 })).toBe('Reach a 12 combo');
  });

  it('gives every level a feature, a tip and three challenges', () => {
    for (const lv of LEVELS) {
      expect(lv.feature, lv.id).toBeTruthy();
      expect(lv.tip.length, lv.id).toBeGreaterThan(10);
      expect(lv.challenges, lv.id).toHaveLength(3);
      for (const c of lv.challenges) expect(challengeLabel(c).length).toBeGreaterThan(5);
    }
    for (const c of CHAPTERS) {
      const list = chapterLevels(c.id);
      expect(new Set(list.map((l) => l.feature)).size, c.name).toBe(list.length);
    }
  });
});
