import type { BossDef } from '../../config/levels';
import type { World } from '../World';
import { AnglerKing } from './AnglerKing';
import type { BossBase } from './BossBase';
import { Kraken } from './Kraken';

export function createBoss(def: BossDef, world: World): BossBase {
  switch (def.kind) {
    case 'angler':
      return new AnglerKing(world, def);
    case 'kraken':
      return new Kraken(world, def);
  }
}
