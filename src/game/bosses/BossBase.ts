import { Group } from 'three';
import type { BossDef } from '../../config/levels';
import { Rng } from '../../engine/rng';
import type { ViewRect } from '../../render/CameraRig';
import type { FishDrawer } from '../../render/FishDrawer';
import type { World } from '../World';

export const BOSS = {
  /** Points for clearing a whole phase's worth of weak-point bites (split across the bites). */
  phaseHitPoints: 3600,
  /** Bonus on top when a phase falls. */
  phasePoints: 1500,
  defeatPoints: 3000,
  /** Seconds the defeat plays out before the results. */
  defeatDelay: 3.6,
};

/**
 * Intro, then a loop of attack (stalking), telegraph and strike. A strike that misses leaves the
 * boss stunned, the only time its weak point can be bitten.
 */
export type BossState = 'intro' | 'attack' | 'telegraph' | 'strike' | 'recover' | 'stunned' | 'hurt' | 'phaseUp' | 'defeated';

export type BossDamage = 'none' | 'hit' | 'phase' | 'defeated';

/** Health as `phases` bars of 1 each. */
export class BossHealth {
  phase = 0;
  /** Damage taken in the current phase, 0..1. */
  dealt = 0;

  constructor(readonly phases: number) {}

  get defeated(): boolean {
    return this.phase >= this.phases;
  }

  /** Health left over the whole fight, 0..1. */
  get left(): number {
    return this.defeated ? 0 : 1 - (this.phase + this.dealt) / this.phases;
  }

  /** Health left in phase `i`, 0..1, for the HUD's bar segments. */
  segment(i: number): number {
    if (i < this.phase) return 0;
    if (i > this.phase) return 1;
    return 1 - this.dealt;
  }

  damage(amount: number): BossDamage {
    if (this.defeated || amount <= 0) return 'none';
    this.dealt += amount;
    if (this.dealt < 1 - 1e-6) return 'hit';
    this.dealt = 0;
    this.phase++;
    return this.defeated ? 'defeated' : 'phase';
  }
}

/** Shared plumbing for chapter bosses: health, the stun rule, scoring and feature events. */
export abstract class BossBase {
  readonly group = new Group();
  readonly health: BossHealth;
  state: BossState = 'intro';
  /** Seconds in the current state. */
  protected t = 0;
  protected time = 0;
  protected readonly rng: Rng;
  protected readonly view: ViewRect = { x0: 0, x1: 0, y0: 0, y1: 0 };
  private readonly disposables: { dispose(): void }[] = [];

  constructor(
    protected readonly world: World,
    readonly def: BossDef,
  ) {
    this.health = new BossHealth(def.phases);
    this.rng = new Rng(world.level.seed + 404);
    world.scene.add(this.group);
  }

  get name(): string {
    return this.def.name;
  }

  /** The weak point is open to bites. */
  get exposed(): boolean {
    return this.state === 'stunned';
  }

  get defeated(): boolean {
    return this.health.defeated;
  }

  /** 0..1 how much danger the player is in, for the music. */
  abstract get danger(): number;

  /** 1 where (x, y) is in the boss's way, for picking a safe respawn spot. */
  abstract threatAt(x: number, y: number): number;

  /** Debug: leave it stunned now. */
  abstract stun(): void;

  build(): void {}

  update(dt: number): void {
    this.time += dt;
    // The fight waits for the intro card; the clock in each state only runs once it is on.
    if (this.world.started) this.t += dt;
  }

  render(_alpha: number, _dt: number): void {}

  draw(_drawer: FishDrawer, _alpha: number, _dt: number): void {}

  /** The player is in control and the fight is on. */
  protected get playing(): boolean {
    const w = this.world;
    return w.mode === 'play' && w.started && w.phase === 'play';
  }

  protected enter(state: BossState): void {
    this.state = state;
    this.t = 0;
  }

  protected emit(kind: string, x: number, y: number): void {
    this.world.events.emit('feature', { kind, x, y });
  }

  protected track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  /** A new phase starts (after the phase-up roar). */
  protected onPhase(): void {}

  /** A bite that left health in the phase. */
  protected onHit(): void {
    this.enter('hurt');
  }

  /**
   * A bite on a weak point, worth `amount` of a phase. Only lands while the boss is stunned
   * (`exposed`); the subclass decides where its weak point is.
   */
  protected wound(amount: number, x: number, y: number, label: string): BossDamage {
    if (!this.exposed || this.defeated || !this.playing) return 'none';
    const w = this.world;
    const r = this.health.damage(amount);
    if (r === 'none') return r;
    w.award(Math.round(BOSS.phaseHitPoints * amount), x, y + 1.2, label, '#ffd27a');
    w.stat('bossHit');
    this.emit('bossHit', x, y);
    if (r === 'defeated') {
      w.award(BOSS.defeatPoints, x, y + 2.6, `${this.name} defeated!`, '#ffe9a0');
      this.enter('defeated');
      this.emit('bossDefeat', x, y);
      w.bossDefeated(x, y);
    } else if (r === 'phase') {
      w.award(BOSS.phasePoints, x, y + 2.6, 'Phase cleared!', '#ffe9a0');
      this.enter('phaseUp');
      this.emit('bossPhase', x, y);
      this.onPhase();
    } else {
      this.onHit();
    }
    return r;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
