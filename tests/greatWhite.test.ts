import { describe, expect, it } from 'vitest';
import { chapterLevels } from '../src/config/levels';
import { SPECIES } from '../src/config/species';
import { CAMERA, PLAYER, STAGE_COUNT } from '../src/config/tuning';
import { GREAT_WHITE, greatWhiteLength, laneY } from '../src/game/hazards/GreatWhite';

describe('Great white', () => {
  it('patrols every Ocean II level and none of Ocean I', () => {
    for (const l of chapterLevels(1)) expect(l.greatWhite, l.id).toBeUndefined();
    for (const l of chapterLevels(2)) expect(l.greatWhite, l.id).toBeDefined();
  });

  it('comes every minute or two, sooner and keener through the chapter', () => {
    const list = chapterLevels(2).map((l) => l.greatWhite!);
    for (const g of list) {
      expect(g.every[0]).toBeGreaterThanOrEqual(50);
      expect(g.every[1]).toBeLessThanOrEqual(120);
      expect(g.every[1]).toBeGreaterThan(g.every[0]);
      expect(g.first).toBeGreaterThan(GREAT_WHITE.warn);
    }
    for (let i = 1; i < list.length; i++) {
      expect(list[i].every[0]).toBeLessThanOrEqual(list[i - 1].every[0]);
      expect(list[i].first).toBeLessThanOrEqual(list[i - 1].first);
      expect(list[i].speed).toBeGreaterThanOrEqual(list[i - 1].speed);
      expect(list[i].chase).toBeGreaterThanOrEqual(list[i - 1].chase);
    }
  });

  it('can be dodged vertically: it closes in slower than the player swims', () => {
    for (const l of chapterLevels(2)) {
      const g = l.greatWhite!;
      PLAYER.speedByStage.forEach((s) => expect(s * g.speed * g.chase, l.id).toBeLessThan(s * 0.6));
    }
  });

  it('dwarfs the player, even at the apex', () => {
    CAMERA.viewHeightByStage.forEach((h, i) => {
      const apex = i + 1 === STAGE_COUNT;
      expect(greatWhiteLength(h)).toBeGreaterThan(PLAYER.lengthByStage[i] * (apex ? 2.5 : 4));
    });
    expect(SPECIES.greatWhite.tier).toBe(4);
  });

  it('keeps its lane clear of the seabed and the surface', () => {
    expect(laneY(10, 0, 26, 2)).toBe(10);
    expect(laneY(0, 0, 26, 2)).toBeCloseTo(2.4);
    expect(laneY(40, 0, 26, 2)).toBeCloseTo(23.6);
    expect(laneY(5, 10, 12, 2)).toBeCloseTo(11);
  });
});
