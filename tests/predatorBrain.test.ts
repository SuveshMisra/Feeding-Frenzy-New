import { describe, expect, it } from 'vitest';
import { PredatorBrain, type PredatorSense } from '../src/game/ai/PredatorBrain';
import { PREDATOR } from '../src/config/tuning';

const DT = 1 / 60;
const DETECT = 7;
const LOSE = DETECT * PREDATOR.loseMultiplier;

function sense(over: Partial<PredatorSense> = {}): PredatorSense {
  return { dist: 20, inViewCone: true, canEatPlayer: true, detectRadius: DETECT, maxChase: PREDATOR.maxChase, ...over };
}

function run(brain: PredatorBrain, seconds: number, s: PredatorSense): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) brain.update(DT, s);
}

function chasing(): PredatorBrain {
  const b = new PredatorBrain();
  b.update(DT, sense({ dist: DETECT - 1 }));
  run(b, PREDATOR.reactionTime + 0.05, sense({ dist: DETECT - 1 }));
  return b;
}

describe('PredatorBrain', () => {
  it('stays wandering while the player is far away', () => {
    const b = new PredatorBrain();
    run(b, 3, sense({ dist: DETECT + 0.5 }));
    expect(b.state).toBe('wander');
  });

  it('notices an edible player inside detectRadius, then chases after the reaction delay', () => {
    const b = new PredatorBrain();
    b.update(DT, sense({ dist: DETECT - 1 }));
    expect(b.state).toBe('alert');
    run(b, PREDATOR.reactionTime * 0.5, sense({ dist: DETECT - 1 }));
    expect(b.state).toBe('alert');
    run(b, PREDATOR.reactionTime, sense({ dist: DETECT - 1 }));
    expect(b.state).toBe('chase');
  });

  it('ignores players it cannot eat (smaller or shielded)', () => {
    const b = new PredatorBrain();
    run(b, 2, sense({ dist: 1, canEatPlayer: false }));
    expect(b.state).toBe('wander');
  });

  it('only notices from behind when the player is very close', () => {
    const b = new PredatorBrain();
    run(b, 1, sense({ dist: DETECT * 0.8, inViewCone: false }));
    expect(b.state).toBe('wander');
    b.update(DT, sense({ dist: DETECT * PREDATOR.closeFraction * 0.9, inViewCone: false }));
    expect(b.state).toBe('alert');
  });

  it('keeps chasing between detectRadius and loseRadius (hysteresis)', () => {
    const b = chasing();
    run(b, 1, sense({ dist: (DETECT + LOSE) / 2 }));
    expect(b.state).toBe('chase');
  });

  it('gives up once the player swims beyond loseRadius', () => {
    const b = chasing();
    b.update(DT, sense({ dist: LOSE + 0.1 }));
    expect(b.state).toBe('giveUp');
  });

  it('gives up after the chase timeout even if the player stays close', () => {
    const b = chasing();
    run(b, PREDATOR.maxChase - 0.2, sense({ dist: 3 }));
    expect(b.state).toBe('chase');
    run(b, 0.4, sense({ dist: 3 }));
    expect(b.state).toBe('giveUp');
  });

  it('gives up when the player outgrows it', () => {
    const b = chasing();
    b.update(DT, sense({ dist: 2, canEatPlayer: false }));
    expect(b.state).toBe('giveUp');
  });

  it('ignores the player during the cooldown, then can notice again', () => {
    const b = chasing();
    b.update(DT, sense({ dist: LOSE + 1 }));
    expect(b.state).toBe('giveUp');
    run(b, PREDATOR.cooldown - 0.2, sense({ dist: 2 }));
    expect(b.state).toBe('giveUp');
    let steps = 0;
    while (b.state === 'giveUp' && steps < 60) {
      b.update(DT, sense({ dist: 2 }));
      steps++;
    }
    expect(b.state).toBe('wander');
    b.update(DT, sense({ dist: 2 }));
    expect(b.state).toBe('alert');
  });

  it('uses a lose radius 1.6 times the detect radius', () => {
    expect(PREDATOR.loseMultiplier).toBeCloseTo(1.6);
  });
});
