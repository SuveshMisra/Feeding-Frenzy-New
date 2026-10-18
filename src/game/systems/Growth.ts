import { FISH_PER_STAGE, STAGE_COUNT, type Stage } from '../../config/tuning';

export type GrowthResult = 'none' | 'grew' | 'complete';

/** Growth meter: `perStage` points fill a stage; filling the last stage completes the level. */
export class Growth {
  stage: Stage = 1;
  points = 0;
  complete = false;
  eaten = 0;

  constructor(readonly perStage = FISH_PER_STAGE) {}

  add(points = 1): GrowthResult {
    if (this.complete) return 'none';
    this.eaten++;
    this.points += points;
    if (this.points < this.perStage) return 'none';
    if (this.stage < STAGE_COUNT) {
      this.points -= this.perStage;
      this.stage = (this.stage + 1) as Stage;
      return 'grew';
    }
    this.points = this.perStage;
    this.complete = true;
    return 'complete';
  }

  get stageProgress(): number {
    return Math.min(1, this.points / this.perStage);
  }

  /** Progress over the whole level, 0..1 across all stages. */
  get totalProgress(): number {
    return Math.min(1, ((this.stage - 1) * this.perStage + this.points) / (this.perStage * STAGE_COUNT));
  }

  forceStage(stage: Stage): void {
    this.stage = stage;
    this.points = 0;
    this.complete = false;
  }

  reset(): void {
    this.stage = 1;
    this.points = 0;
    this.complete = false;
    this.eaten = 0;
  }
}
