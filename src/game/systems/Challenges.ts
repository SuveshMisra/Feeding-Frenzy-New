import { SPECIES, type SpeciesId } from '../../config/species';

/** Optional goals per level. Each pays `CHALLENGE_COINS` the first time it is completed. */
export type ChallengeDef =
  | { kind: 'combo'; n: number }
  | { kind: 'noDeath' }
  | { kind: 'under'; seconds: number }
  | { kind: 'eat'; species: SpeciesId; n: number; label?: string }
  | { kind: 'golden' }
  | { kind: 'feature'; key: string; n: number; label: string };

export const CHALLENGE_COINS = 30;

export interface ChallengeState {
  maxCombo: number;
  deaths: number;
  time: number;
  eaten: Partial<Record<SpeciesId, number>>;
  golden: number;
  stats: Record<string, number>;
}

export interface ChallengeStatus {
  done: boolean;
  /** Can no longer be completed this run. */
  failed: boolean;
  progress: number;
  target: number;
}

export function emptyChallengeState(): ChallengeState {
  return { maxCombo: 0, deaths: 0, time: 0, eaten: {}, golden: 0, stats: {} };
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

export function challengeLabel(def: ChallengeDef): string {
  switch (def.kind) {
    case 'combo':
      return `Reach a ${def.n} combo`;
    case 'noDeath':
      return 'Clear without losing a life';
    case 'under':
      return `Clear in under ${clock(def.seconds)}`;
    case 'eat':
      return def.label ?? `Eat ${def.n} ${SPECIES[def.species].name}`;
    case 'golden':
      return 'Catch a golden fish';
    case 'feature':
      return def.label;
  }
}

/** Where a challenge stands. `finished` is true once the level has been cleared. */
export function evaluateChallenge(def: ChallengeDef, s: ChallengeState, finished: boolean): ChallengeStatus {
  switch (def.kind) {
    case 'combo':
      return { done: s.maxCombo >= def.n, failed: false, progress: Math.min(s.maxCombo, def.n), target: def.n };
    case 'noDeath': {
      const failed = s.deaths > 0;
      return { done: finished && !failed, failed, progress: finished && !failed ? 1 : 0, target: 1 };
    }
    case 'under': {
      const failed = s.time > def.seconds;
      return { done: finished && !failed, failed, progress: Math.max(0, def.seconds - s.time), target: def.seconds };
    }
    case 'eat': {
      const n = s.eaten[def.species] ?? 0;
      return { done: n >= def.n, failed: false, progress: Math.min(n, def.n), target: def.n };
    }
    case 'golden':
      return { done: s.golden > 0, failed: false, progress: Math.min(1, s.golden), target: 1 };
    case 'feature': {
      const n = s.stats[def.key] ?? 0;
      return { done: n >= def.n, failed: false, progress: Math.min(n, def.n), target: def.n };
    }
  }
}

/** Short progress text for the HUD tracker. */
export function progressText(def: ChallengeDef, st: ChallengeStatus): string {
  if (st.done) return 'Done';
  if (st.failed) return 'Failed';
  switch (def.kind) {
    case 'under':
      return `${clock(st.progress)} left`;
    case 'noDeath':
      return 'No deaths yet';
    case 'golden':
      return 'Not yet';
    default:
      return `${Math.floor(st.progress)}/${st.target}`;
  }
}

/** Follows a run's events and reports how each challenge is going. */
export class ChallengeTracker {
  readonly state = emptyChallengeState();
  private readonly announced: boolean[];

  constructor(readonly defs: readonly ChallengeDef[]) {
    this.announced = defs.map(() => false);
  }

  onEat(species: SpeciesId, combo: number): void {
    const s = this.state;
    s.eaten[species] = (s.eaten[species] ?? 0) + 1;
    s.maxCombo = Math.max(s.maxCombo, combo);
  }

  onGolden(): void {
    this.state.golden++;
  }

  onDeath(): void {
    this.state.deaths++;
  }

  stat(key: string, n = 1): void {
    this.state.stats[key] = (this.state.stats[key] ?? 0) + n;
  }

  setTime(t: number): void {
    this.state.time = t;
  }

  status(finished = false): ChallengeStatus[] {
    return this.defs.map((d) => evaluateChallenge(d, this.state, finished));
  }

  /** Indices that became done since the last call (for a HUD toast). */
  newlyDone(): number[] {
    const out: number[] = [];
    this.status().forEach((st, i) => {
      if (st.done && !this.announced[i]) {
        this.announced[i] = true;
        out.push(i);
      }
    });
    return out;
  }

  /** Final results once the level is cleared. */
  final(): boolean[] {
    return this.status(true).map((s) => s.done);
  }
}
