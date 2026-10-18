import type { QualityPreset } from '../../app/Quality';
import type { World } from '../World';
import { CrystalsFeature } from './Crystals';
import { CurrentsFeature } from './Currents';
import { DarknessFeature } from './Darkness';
import { GuardiansFeature } from './Guardians';
import { HeatWavesFeature } from './HeatWaves';
import { IciclesFeature } from './Icicles';
import { KelpHideFeature } from './KelpHide';
import { MorayEelsFeature } from './MorayEels';
import { PufferFeature } from './Pufferfish';
import { TideFeature } from './Tide';
import type { FeatureId, LevelFeature } from './types';

export type { FeatureHud, FeatureId, FeatureTone, LevelFeature } from './types';

/** Builds the signature mechanic for a level, or null for levels without one. */
export function createFeature(id: FeatureId | undefined, world: World, _quality: QualityPreset): LevelFeature | null {
  switch (id) {
    case 'puffer':
      return new PufferFeature(world, id);
    case 'kelpHide':
      return new KelpHideFeature(world, id);
    case 'eels':
      return new MorayEelsFeature(world, id);
    case 'icicles':
      return new IciclesFeature(world, id);
    case 'darkness':
      return new DarknessFeature(world, id);
    case 'tide':
      return new TideFeature(world, id);
    case 'currents':
      return new CurrentsFeature(world, id);
    case 'guardians':
      return new GuardiansFeature(world, id);
    case 'crystals':
      return new CrystalsFeature(world, id);
    case 'heat':
      return new HeatWavesFeature(world, id);
    default:
      return null;
  }
}
