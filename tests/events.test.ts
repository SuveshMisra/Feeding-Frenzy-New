import { describe, expect, it } from 'vitest';
import { LEVELS, chapterLevels, levelEvents, type EventId } from '../src/config/levels';
import { SPECIES } from '../src/config/species';
import { Rng } from '../src/engine/rng';
import { EVENTS, EventSchedule, pickEvent } from '../src/game/events/EventDirector';

const STEP = 1 / 60;

/** Seconds until the schedule fires, stepping at 60 Hz. */
function runUntilDue(s: EventSchedule, armed: (t: number) => boolean, blocked: (t: number) => boolean, limit = 600): number {
  for (let t = 0; t < limit; t += STEP) if (s.tick(STEP, armed(t), blocked(t))) return t;
  return Infinity;
}

describe('EventSchedule', () => {
  it('waits for the first event, then spaces the rest by the level gap', () => {
    const s = new EventSchedule([70, 110], new Rng(1));
    const first = runUntilDue(s, () => true, () => false);
    expect(first).toBeGreaterThanOrEqual(EVENTS.first[0] - STEP);
    expect(first).toBeLessThanOrEqual(EVENTS.first[1]);
    for (let i = 0; i < 20; i++) {
      s.restart();
      const gap = runUntilDue(s, () => true, () => false);
      expect(gap).toBeGreaterThanOrEqual(70 - STEP);
      expect(gap).toBeLessThanOrEqual(110);
    }
  });

  it('does not count down until armed (stage 2, playing)', () => {
    const s = new EventSchedule([70, 110], new Rng(2));
    const t = runUntilDue(s, (t) => t >= 100, () => false);
    expect(t).toBeGreaterThanOrEqual(100 + EVENTS.first[0] - STEP);
  });

  it('never fires while blocked, and waits a moment after the block clears', () => {
    const s = new EventSchedule([70, 110], new Rng(3), [5, 5]);
    // A great white pass (or another event) from 3 s to 40 s.
    const t = runUntilDue(s, () => true, (t) => t >= 3 && t < 40);
    expect(t).toBeGreaterThanOrEqual(40);
    expect(t).toBeLessThanOrEqual(40 + EVENTS.retry + 0.1);
  });

  it('a higher rate brings events sooner', () => {
    const slow = new EventSchedule([80, 80], new Rng(4), [80, 80]);
    const fast = new EventSchedule([80, 80], new Rng(4), [80, 80]);
    let ts = 0;
    let tf = 0;
    while (!slow.tick(STEP, true, false, 1)) ts += STEP;
    while (!fast.tick(STEP, true, false, 2)) tf += STEP;
    expect(tf).toBeCloseTo(ts / 2, 0);
  });
});

describe('pickEvent', () => {
  it('never repeats the last event when there is a choice', () => {
    const rng = new Rng(9);
    const pool: EventId[] = ['baitBall', 'whale', 'riptide'];
    let last: EventId | null = null;
    const seen = new Set<EventId>();
    for (let i = 0; i < 200; i++) {
      const id = pickEvent(pool, last, rng);
      expect(id).not.toBe(last);
      seen.add(id);
      last = id;
    }
    expect(seen.size).toBe(3);
    expect(pickEvent(['baitBall'], 'baitBall', rng)).toBe('baitBall');
  });
});

describe('levelEvents', () => {
  it('skips boss fights and eases Ocean I in', () => {
    for (const l of LEVELS.filter((l) => l.boss)) expect(levelEvents(l), l.id).toBeNull();
    const one = chapterLevels(1);
    expect(levelEvents(one[0])!.pool).toEqual(['baitBall']);
    expect(levelEvents(one[one.length - 1])!.pool).toContain('whale');
    for (const l of chapterLevels(2)) {
      const e = levelEvents(l)!;
      expect(e.pool, l.id).toEqual(expect.arrayContaining(['baitBall', 'whale', 'riptide']));
      expect(e.every[0]).toBeGreaterThanOrEqual(60);
    }
  });

  it('only rolls bait balls where tier-1 fish exist', () => {
    for (const l of LEVELS) if (levelEvents(l)?.pool.includes('baitBall')) expect(l.roster[1]?.length ?? 0, l.id).toBeGreaterThan(0);
  });

  it('has a humpback for the whale lunge', () => {
    expect(SPECIES.humpback.length).toBeGreaterThan(SPECIES.greatWhite.length);
  });
});
