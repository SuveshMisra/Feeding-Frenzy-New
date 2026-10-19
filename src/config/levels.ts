import type { SpeciesId } from './species';
import type { Tier } from './tuning';
import type { FeatureId } from '../game/features/types';
import type { ChallengeDef } from '../game/systems/Challenges';

export type BiomeId = 'reef' | 'kelp' | 'wreck' | 'ice' | 'abyss' | 'mangrove' | 'canyon' | 'ruins' | 'crystal' | 'volcanic';

/** Seabed shape. The default is dunes with low hills behind the play area. */
export type TerrainProfile = 'lagoon' | 'canyon' | 'cavern' | 'rift';

export interface BiomeDef {
  fog: { top: string; mid: string; bottom: string; density: number };
  sun: { color: string; intensity: number };
  hemi: { sky: string; ground: string; intensity: number };
  caustics: number;
  causticsColor: string;
  /** Light multiplier at the seabed compared to the surface. */
  deepLight: number;
  shafts: number;
  shaftColor: string;
  shaftIntensity: number;
  /** 'rock' is a cave ceiling. */
  surface: 'water' | 'ice' | 'none' | 'rock';
  surfaceColor: string;
  terrain?: TerrainProfile;
  sand: { base: string; light: string; dark: string; roughness: number };
  snow: { count: number; color: string; size: number; opacity: number };
  plankton: boolean;
  playerLight: number;
  props: {
    rocks: number;
    coral: number;
    brain: number;
    fans: number;
    sponges: number;
    anemones: number;
    kelp: number;
    seagrass: number;
    wreck: boolean;
    icebergs: number;
    vents: number;
    /** Root tangles hanging from the surface down into the mud. */
    mangrove?: number;
    /** Layered cliff walls and terraces. */
    cliffs?: number;
    /** Columns, arches, statue heads and steps. */
    ruins?: number;
    /** Glowing crystal clusters and mushrooms. */
    crystals?: number;
    /** Basalt columns and lava cracks. */
    basalt?: number;
  };
  palette: { coral: string[]; rock: string; rockDark: string; plant: string; plantTip: string };
  /** Glowing embers drifting up from the seabed. */
  embers?: number;
  ambientSchools: number;
  bloom: number;
  exposure: number;
  /** Colour grade before tone mapping; anything left out uses GRADE_DEFAULT. */
  grade?: { contrast?: number; saturation?: number; shadowTint?: string };
}

export const GRADE_DEFAULT = { contrast: 1.08, saturation: 1.15, shadowTint: '#c8dcff' };
/** Dark enclosed biomes: almost everything sits in the shadows, so contrast and a cool tint would just crush them. */
const GRADE_ENCLOSED = { contrast: 1, saturation: 1.12, shadowTint: '#ffffff' };

export interface MusicMood {
  /** MIDI note of the tonic. */
  root: number;
  /** Scale intervals in semitones. */
  scale: number[];
  /** Chord roots as scale degrees. */
  progression: number[];
  tempo: number;
  brightness: number;
  pluckDensity: number;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** Overrides for the level feature's tuning constants (same keys, merged over the defaults). */
export type FeatureOpts = Record<string, number | boolean | readonly number[]>;

export interface GreatWhiteDef {
  /** Seconds of play before the first pass. */
  first: number;
  /** Seconds between passes. */
  every: [number, number];
  /** Swim speed relative to the player's cruise speed at their current stage. */
  speed: number;
  /** How fast it closes in vertically, as a share of its swim speed. */
  chase: number;
}

/** Ocean II's great white for remix `k` (0 = first, 9 = last): sooner, faster and keener each level. */
function greatWhite(k: number): GreatWhiteDef {
  const t = k / 9;
  const mix = (a: number, b: number) => Math.round((a + (b - a) * t) * 100) / 100;
  return { first: mix(45, 30), every: [mix(85, 55), mix(110, 72)], speed: mix(1.1, 1.28), chase: mix(0.2, 0.38) };
}

export type BossKind = 'angler' | 'kraken';

/** A chapter finale: the player starts fully grown and wins by beating the boss instead of growing. */
export interface BossDef {
  kind: BossKind;
  name: string;
  phases: number;
  /** Weak-point bites needed to clear each phase. */
  hitsPerPhase: number;
}

/** Mid-level events (see EventDirector). */
export type EventId = 'baitBall' | 'whale' | 'riptide';

export interface LevelEvents {
  /** Seconds between events. */
  every: readonly [number, number];
  pool: readonly EventId[];
}

export type ChapterId = 1 | 2;

export const CHAPTERS: readonly { id: ChapterId; name: string; from: number }[] = [
  { id: 1, name: 'Ocean I', from: 0 },
  { id: 2, name: 'Ocean II', from: 11 },
];

export interface LevelDef {
  id: string;
  index: number;
  chapter: ChapterId;
  name: string;
  subtitle: string;
  biome: BiomeId;
  /** Look tweaks (dusk, night, storm) merged over the shared biome. */
  biomeOverride?: DeepPartial<BiomeDef>;
  world: { width: number; height: number };
  fishPerStage: number;
  roster: Record<Tier, SpeciesId[]>;
  /** Fish shown on the level card; defaults to the first tier-3 species. */
  cover?: SpeciesId;
  /** `mineDrift`: how far (world units) mines sway sideways on their chains. */
  hazards: { oysters: number; jellyfish: number; mines: number; geysers?: number; mineDrift?: number };
  /** `predators` is how many threats are kept around the player at each growth stage. */
  difficulty: { chaseSpeed: number; detectRadius: number; predators: [number, number, number] };
  /** Score thresholds for the 2nd and 3rd star. Completing the level gives the 1st. */
  stars: [number, number];
  /** The level's signature mechanic (boss levels have none: the boss is the mechanic). */
  feature?: FeatureId;
  featureOpts?: FeatureOpts;
  /** A great white that crosses the screen every so often, eating everything in its path. */
  greatWhite?: GreatWhiteDef;
  boss?: BossDef;
  /** Overrides the ocean's default mid-level events (see `levelEvents`). */
  events?: LevelEvents;
  /** An endless run (see `endlessLevel`): growth never completes and the run ends on game over. */
  endless?: boolean;
  /** One line on the intro card explaining the mechanic. */
  tip: string;
  challenges: ChallengeDef[];
  music: MusicMood;
  seed: number;
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  reef: {
    fog: { top: '#3fd0e6', mid: '#138fb3', bottom: '#064a6e', density: 0.022 },
    sun: { color: '#fff4dc', intensity: 2.6 },
    hemi: { sky: '#8fe8ff', ground: '#2a6f7a', intensity: 1.15 },
    caustics: 1.25,
    causticsColor: '#d9fbff',
    deepLight: 0.6,
    shafts: 16,
    shaftColor: '#dffbff',
    shaftIntensity: 0.55,
    surface: 'water',
    surfaceColor: '#7ff0ff',
    sand: { base: '#d8c49a', light: '#f3e6c4', dark: '#a8916a', roughness: 0.92 },
    snow: { count: 2600, color: '#e8fbff', size: 0.07, opacity: 0.55 },
    plankton: false,
    playerLight: 0,
    props: {
      rocks: 64,
      coral: 200,
      brain: 50,
      fans: 46,
      sponges: 48,
      anemones: 40,
      kelp: 0,
      seagrass: 7200,
      wreck: false,
      icebergs: 0,
      vents: 0,
    },
    palette: {
      coral: ['#ff6f91', '#ff9a5a', '#c56cf0', '#ffd166', '#ff5e7e', '#7cf2c8', '#ff8fd8'],
      rock: '#8a7f73',
      rockDark: '#4d4640',
      plant: '#3f9b58',
      plantTip: '#9be27a',
    },
    ambientSchools: 5,
    bloom: 0.75,
    exposure: 1.05,
  },
  kelp: {
    fog: { top: '#8fd3a8', mid: '#2e8a78', bottom: '#0f3f3c', density: 0.024 },
    sun: { color: '#fff1c9', intensity: 2.4 },
    hemi: { sky: '#bfeec2', ground: '#35553a', intensity: 1.05 },
    caustics: 1.0,
    causticsColor: '#f3ffd8',
    deepLight: 0.55,
    shafts: 13,
    shaftColor: '#f4ffd6',
    shaftIntensity: 0.6,
    surface: 'water',
    surfaceColor: '#c5f5c8',
    sand: { base: '#9b8e6c', light: '#c7b88e', dark: '#6b6048', roughness: 0.95 },
    snow: { count: 3000, color: '#f6ffe6', size: 0.075, opacity: 0.55 },
    plankton: false,
    playerLight: 0,
    props: {
      rocks: 64,
      coral: 18,
      brain: 10,
      fans: 10,
      sponges: 20,
      anemones: 28,
      kelp: 190,
      seagrass: 5200,
      wreck: false,
      icebergs: 0,
      vents: 0,
    },
    palette: {
      coral: ['#e07b53', '#f2c14e', '#b85c8a', '#f78e69'],
      rock: '#6f6a5e',
      rockDark: '#3a3830',
      plant: '#6b7a1e',
      plantTip: '#d8c34a',
    },
    ambientSchools: 4,
    bloom: 0.7,
    exposure: 1.0,
  },
  wreck: {
    fog: { top: '#4fb3b0', mid: '#1d6d73', bottom: '#0a2f3a', density: 0.026 },
    sun: { color: '#e9fff6', intensity: 1.9 },
    hemi: { sky: '#98e0d8', ground: '#27403e', intensity: 0.95 },
    caustics: 0.75,
    causticsColor: '#dcfff7',
    deepLight: 0.5,
    shafts: 8,
    shaftColor: '#d8fff4',
    shaftIntensity: 0.5,
    surface: 'water',
    surfaceColor: '#8fe6dc',
    sand: { base: '#8f8a78', light: '#b8b39c', dark: '#5d594b', roughness: 0.96 },
    snow: { count: 4200, color: '#e1f2ea', size: 0.08, opacity: 0.6 },
    plankton: false,
    playerLight: 0.4,
    props: {
      rocks: 60,
      coral: 64,
      brain: 16,
      fans: 24,
      sponges: 30,
      anemones: 26,
      kelp: 36,
      seagrass: 2800,
      wreck: true,
      icebergs: 0,
      vents: 0,
    },
    palette: {
      coral: ['#d9776b', '#e3b35b', '#9b6fb0', '#c85d6e', '#6fc2a6'],
      rock: '#6c6a62',
      rockDark: '#35342f',
      plant: '#4d6b3a',
      plantTip: '#9fb86a',
    },
    ambientSchools: 3,
    bloom: 0.8,
    exposure: 1.0,
  },
  ice: {
    fog: { top: '#bfe9ff', mid: '#4f9fd1', bottom: '#12385e', density: 0.023 },
    sun: { color: '#eef8ff', intensity: 2.2 },
    hemi: { sky: '#d9f3ff', ground: '#3a5a78', intensity: 1.2 },
    caustics: 0.7,
    causticsColor: '#eaf7ff',
    deepLight: 0.55,
    shafts: 10,
    shaftColor: '#eef9ff',
    shaftIntensity: 0.5,
    surface: 'ice',
    surfaceColor: '#dff5ff',
    sand: { base: '#b9c2c9', light: '#e8eef2', dark: '#7c8891', roughness: 0.9 },
    snow: { count: 3600, color: '#ffffff', size: 0.08, opacity: 0.7 },
    plankton: false,
    playerLight: 0.3,
    props: {
      rocks: 72,
      coral: 0,
      brain: 0,
      fans: 0,
      sponges: 24,
      anemones: 40,
      kelp: 0,
      seagrass: 0,
      wreck: false,
      icebergs: 12,
      vents: 0,
    },
    palette: {
      coral: ['#f3a6c8', '#ffd6e8', '#b9e6ff'],
      rock: '#6d7883',
      rockDark: '#39414a',
      plant: '#6aa0b0',
      plantTip: '#d9f6ff',
    },
    ambientSchools: 4,
    bloom: 0.85,
    exposure: 1.02,
  },
  abyss: {
    fog: { top: '#0b2640', mid: '#051526', bottom: '#010409', density: 0.03 },
    sun: { color: '#6f95c9', intensity: 0.25 },
    hemi: { sky: '#1c3a5e', ground: '#05080f', intensity: 0.35 },
    caustics: 0,
    causticsColor: '#6fb7ff',
    deepLight: 0.7,
    shafts: 0,
    shaftColor: '#6fb7ff',
    shaftIntensity: 0,
    surface: 'none',
    surfaceColor: '#0b2640',
    sand: { base: '#2c2f38', light: '#434857', dark: '#15171c', roughness: 0.95 },
    snow: { count: 3200, color: '#9fd8ff', size: 0.07, opacity: 0.45 },
    plankton: true,
    playerLight: 5.5,
    props: {
      rocks: 80,
      coral: 0,
      brain: 0,
      fans: 0,
      sponges: 28,
      anemones: 30,
      kelp: 0,
      seagrass: 0,
      wreck: false,
      icebergs: 0,
      vents: 8,
    },
    palette: {
      coral: ['#ff6fb5', '#7af7ff', '#c08bff'],
      rock: '#2f323b',
      rockDark: '#121318',
      plant: '#284a5a',
      plantTip: '#6fe7ff',
    },
    ambientSchools: 2,
    bloom: 1.25,
    exposure: 1.1,
    grade: GRADE_ENCLOSED,
  },
  mangrove: {
    fog: { top: '#b9d98a', mid: '#5f8f4e', bottom: '#2a3f22', density: 0.03 },
    sun: { color: '#fff0c0', intensity: 2.5 },
    hemi: { sky: '#e0f0a8', ground: '#4a4a2a', intensity: 1.1 },
    caustics: 1.1,
    causticsColor: '#fff6c8',
    deepLight: 0.65,
    shafts: 18,
    shaftColor: '#fff2c0',
    shaftIntensity: 0.7,
    surface: 'water',
    surfaceColor: '#e8f5b0',
    terrain: 'lagoon',
    sand: { base: '#6e5c3e', light: '#8f7a52', dark: '#45392a', roughness: 0.97 },
    snow: { count: 4200, color: '#efe6b8', size: 0.08, opacity: 0.6 },
    plankton: false,
    playerLight: 0,
    props: {
      rocks: 30,
      coral: 0,
      brain: 0,
      fans: 0,
      sponges: 16,
      anemones: 22,
      kelp: 0,
      seagrass: 6200,
      wreck: false,
      icebergs: 0,
      vents: 0,
      mangrove: 26,
    },
    palette: {
      coral: ['#e0a040', '#c46a4a', '#e8d070', '#8fbf5a'],
      rock: '#6a5a44',
      rockDark: '#3a3024',
      plant: '#5f8a2a',
      plantTip: '#c8d860',
    },
    ambientSchools: 4,
    bloom: 0.75,
    exposure: 1.02,
  },
  canyon: {
    fog: { top: '#3fa0e0', mid: '#14589e', bottom: '#06244a', density: 0.022 },
    sun: { color: '#e8f4ff', intensity: 2.3 },
    hemi: { sky: '#8fd0ff', ground: '#3a3050', intensity: 1.1 },
    caustics: 1.0,
    causticsColor: '#d6f0ff',
    deepLight: 0.5,
    shafts: 12,
    shaftColor: '#d8eeff',
    shaftIntensity: 0.55,
    surface: 'water',
    surfaceColor: '#8fd8ff',
    terrain: 'canyon',
    sand: { base: '#c9a888', light: '#e6cfb0', dark: '#8a6a50', roughness: 0.93 },
    snow: { count: 3000, color: '#e6f4ff', size: 0.07, opacity: 0.55 },
    plankton: false,
    playerLight: 0,
    props: {
      rocks: 50,
      coral: 170,
      brain: 30,
      fans: 60,
      sponges: 50,
      anemones: 30,
      kelp: 0,
      seagrass: 1600,
      wreck: false,
      icebergs: 0,
      vents: 0,
      cliffs: 30,
    },
    palette: {
      coral: ['#ff7a5c', '#ffb347', '#e05fa0', '#a070ff', '#5fe0c0', '#ffd166'],
      rock: '#a0705a',
      rockDark: '#4a3030',
      plant: '#3f8a6a',
      plantTip: '#8fe0b0',
    },
    ambientSchools: 5,
    bloom: 0.8,
    exposure: 1.05,
  },
  ruins: {
    fog: { top: '#5fd0c8', mid: '#1f8a8c', bottom: '#0a3a44', density: 0.024 },
    sun: { color: '#f0fff8', intensity: 2.2 },
    hemi: { sky: '#a8f0e8', ground: '#2a4a48', intensity: 1.05 },
    caustics: 1.15,
    causticsColor: '#e0fff8',
    deepLight: 0.55,
    shafts: 14,
    shaftColor: '#e0fff4',
    shaftIntensity: 0.6,
    surface: 'water',
    surfaceColor: '#a0f0e8',
    sand: { base: '#c8c0a0', light: '#e8e0c4', dark: '#8a8468', roughness: 0.94 },
    snow: { count: 3400, color: '#effff8', size: 0.07, opacity: 0.55 },
    plankton: false,
    playerLight: 0,
    props: {
      rocks: 30,
      coral: 70,
      brain: 20,
      fans: 24,
      sponges: 26,
      anemones: 30,
      kelp: 20,
      seagrass: 3600,
      wreck: false,
      icebergs: 0,
      vents: 0,
      ruins: 40,
    },
    palette: {
      coral: ['#ff8f7a', '#ffc96a', '#c27ad8', '#6fd8b0', '#ff7fae'],
      rock: '#b8c4ba',
      rockDark: '#5a6660',
      plant: '#4f8a5a',
      plantTip: '#a8d880',
    },
    ambientSchools: 4,
    bloom: 0.8,
    exposure: 1.03,
  },
  crystal: {
    fog: { top: '#1e2f5a', mid: '#101a38', bottom: '#05070f', density: 0.028 },
    sun: { color: '#8aa0ff', intensity: 0.35 },
    hemi: { sky: '#3a3a7a', ground: '#0a0a14', intensity: 0.5 },
    caustics: 0,
    causticsColor: '#9fb0ff',
    deepLight: 0.8,
    shafts: 0,
    shaftColor: '#9fb0ff',
    shaftIntensity: 0,
    surface: 'rock',
    surfaceColor: '#1e2f5a',
    terrain: 'cavern',
    sand: { base: '#34324a', light: '#4a4866', dark: '#18172a', roughness: 0.9 },
    snow: { count: 2600, color: '#c8b0ff', size: 0.07, opacity: 0.5 },
    plankton: true,
    playerLight: 4.5,
    props: {
      rocks: 60,
      coral: 0,
      brain: 0,
      fans: 0,
      sponges: 0,
      anemones: 24,
      kelp: 0,
      seagrass: 0,
      wreck: false,
      icebergs: 0,
      vents: 0,
      crystals: 70,
    },
    palette: {
      coral: ['#5ff2ff', '#ff5fd2', '#a77bff', '#7dffb0'],
      rock: '#3c3a52',
      rockDark: '#16151f',
      plant: '#2a3a5a',
      plantTip: '#9f7bff',
    },
    ambientSchools: 1,
    bloom: 1.2,
    exposure: 1.1,
    grade: GRADE_ENCLOSED,
  },
  volcanic: {
    fog: { top: '#5a2a28', mid: '#2a1214', bottom: '#080304', density: 0.027 },
    sun: { color: '#ffb080', intensity: 0.6 },
    hemi: { sky: '#7a3a2a', ground: '#100606', intensity: 0.55 },
    caustics: 0,
    causticsColor: '#ff9a6a',
    deepLight: 0.75,
    shafts: 0,
    shaftColor: '#ffb080',
    shaftIntensity: 0,
    surface: 'none',
    surfaceColor: '#5a2a28',
    terrain: 'rift',
    sand: { base: '#2a2626', light: '#3e3836', dark: '#121010', roughness: 0.9 },
    snow: { count: 2400, color: '#b0a8a0', size: 0.07, opacity: 0.4 },
    plankton: false,
    playerLight: 3.5,
    props: {
      rocks: 70,
      coral: 0,
      brain: 0,
      fans: 0,
      sponges: 10,
      anemones: 10,
      kelp: 0,
      seagrass: 0,
      wreck: false,
      icebergs: 0,
      vents: 5,
      basalt: 36,
    },
    palette: {
      coral: ['#ff7a3c', '#ffb050', '#c04a3a'],
      rock: '#2c2a2a',
      rockDark: '#0e0c0c',
      plant: '#3a2a20',
      plantTip: '#ff8a3c',
    },
    embers: 900,
    ambientSchools: 1,
    bloom: 1.15,
    exposure: 1.08,
    grade: GRADE_ENCLOSED,
  },
};

const PENTATONIC_MAJOR = [0, 2, 4, 7, 9];
const PENTATONIC_MINOR = [0, 3, 5, 7, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

export const LEVELS: LevelDef[] = [
  {
    id: 'reef',
    index: 0,
    chapter: 1,
    name: 'Sunlit Reef',
    subtitle: 'Every legend starts small',
    biome: 'reef',
    world: { width: 110, height: 26 },
    fishPerStage: 50,
    roster: {
      1: ['sardine', 'glimmerfish'],
      2: ['butterflyfish', 'blueTang', 'pufferfish'],
      3: ['grouper', 'parrotfish'],
      4: ['barracuda'],
    },
    hazards: { oysters: 3, jellyfish: 0, mines: 0 },
    difficulty: { chaseSpeed: 0.8, detectRadius: 6.5, predators: [2, 3, 3] },
    stars: [5700, 8100],
    feature: 'puffer',
    tip: 'Pufferfish puff up when you get close. Eat them before they inflate!',
    challenges: [
      { kind: 'feature', key: 'puffer', n: 4, label: 'Eat 4 pufferfish before they puff up' },
      { kind: 'combo', n: 12 },
      { kind: 'golden' },
    ],
    music: {
      root: 62,
      scale: PENTATONIC_MAJOR,
      progression: [0, 3, 4, 2],
      tempo: 84,
      brightness: 1,
      pluckDensity: 0.9,
    },
    seed: 1101,
  },
  {
    id: 'kelp',
    index: 1,
    chapter: 1,
    name: 'Kelp Forest',
    subtitle: 'Golden light, hungry shadows',
    biome: 'kelp',
    world: { width: 120, height: 30 },
    fishPerStage: 50,
    roster: {
      1: ['glimmerfish', 'sardine'],
      2: ['rockfish', 'blueTang'],
      3: ['sheephead', 'parrotfish'],
      4: ['reefShark'],
    },
    hazards: { oysters: 2, jellyfish: 4, mines: 0 },
    difficulty: { chaseSpeed: 0.81, detectRadius: 6.7, predators: [3, 3, 3] },
    stars: [6100, 8600],
    feature: 'kelpHide',
    tip: 'Hide in kelp clumps to shake off hunters. Boosting gives you away!',
    challenges: [
      { kind: 'feature', key: 'hideEscape', n: 3, label: 'Lose 3 hunters in the kelp' },
      { kind: 'combo', n: 15 },
      { kind: 'noDeath' },
    ],
    music: {
      root: 55,
      scale: [0, 2, 4, 5, 7, 9, 10],
      progression: [0, 3, 6, 4],
      tempo: 78,
      brightness: 0.85,
      pluckDensity: 0.8,
    },
    seed: 2202,
  },
  {
    id: 'wreck',
    index: 2,
    chapter: 1,
    name: 'Shipwreck Graveyard',
    subtitle: 'Old iron sleeps with one eye open',
    biome: 'wreck',
    world: { width: 120, height: 27 },
    fishPerStage: 50,
    roster: {
      1: ['sardine'],
      2: ['rockfish', 'butterflyfish'],
      3: ['lionfish', 'grouper'],
      4: ['reefShark', 'barracuda'],
    },
    hazards: { oysters: 2, jellyfish: 3, mines: 5 },
    difficulty: { chaseSpeed: 0.82, detectRadius: 6.9, predators: [2, 2, 3] },
    stars: [6500, 9200],
    feature: 'eels',
    tip: 'Moray eels lunge out of their holes at anything that swims too close',
    challenges: [
      { kind: 'feature', key: 'eelKill', n: 2, label: 'Lure 2 predators to the eels' },
      { kind: 'combo', n: 15 },
      { kind: 'under', seconds: 230 },
    ],
    music: {
      root: 57,
      scale: PENTATONIC_MINOR,
      progression: [0, 3, 2, 4],
      tempo: 72,
      brightness: 0.6,
      pluckDensity: 0.6,
    },
    seed: 3303,
  },
  {
    id: 'ice',
    index: 3,
    chapter: 1,
    name: 'Frozen Shelf',
    subtitle: 'Beneath the ice, nothing is gentle',
    biome: 'ice',
    world: { width: 110, height: 26 },
    fishPerStage: 50,
    roster: {
      1: ['silverside'],
      2: ['char'],
      3: ['cod'],
      4: ['sleeperShark'],
    },
    hazards: { oysters: 2, jellyfish: 7, mines: 3 },
    difficulty: { chaseSpeed: 0.83, detectRadius: 7.1, predators: [2, 3, 2] },
    stars: [6800, 9700],
    feature: 'icicles',
    tip: 'Shaking icicles are about to fall. Lure predators underneath!',
    challenges: [
      { kind: 'feature', key: 'icicleKill', n: 2, label: 'Lure 2 predators under icicles' },
      { kind: 'golden' },
      { kind: 'noDeath' },
    ],
    music: {
      root: 64,
      scale: DORIAN,
      progression: [0, 5, 3, 4],
      tempo: 70,
      brightness: 0.95,
      pluckDensity: 1,
    },
    seed: 4404,
  },
  {
    id: 'abyss',
    index: 4,
    chapter: 1,
    name: 'Abyssal Trench',
    subtitle: 'Follow the light. Or don\u2019t.',
    biome: 'abyss',
    world: { width: 120, height: 29 },
    fishPerStage: 50,
    roster: {
      1: ['lanternfish'],
      2: ['hatchetfish'],
      3: ['viperfish'],
      4: ['anglerfish'],
    },
    hazards: { oysters: 2, jellyfish: 4, mines: 4 },
    difficulty: { chaseSpeed: 0.84, detectRadius: 7.3, predators: [2, 2, 3] },
    stars: [7200, 10100],
    feature: 'darkness',
    tip: 'Your light keeps fading. Eat glowing fish to refill it',
    challenges: [
      { kind: 'feature', key: 'glowEat', n: 40, label: 'Eat 40 glowing fish' },
      { kind: 'combo', n: 15 },
      { kind: 'under', seconds: 240 },
    ],
    music: {
      root: 48,
      scale: PENTATONIC_MINOR,
      progression: [0, 2, 3, 1],
      tempo: 60,
      brightness: 0.4,
      pluckDensity: 0.45,
    },
    seed: 5505,
  },
  {
    id: 'mangrove',
    index: 5,
    chapter: 1,
    name: 'Mangrove Lagoon',
    subtitle: 'Tangled roots hide hungry mouths',
    biome: 'mangrove',
    world: { width: 120, height: 26 },
    fishPerStage: 50,
    roster: {
      1: ['glassfish', 'sardine'],
      2: ['snapper', 'rockfish'],
      3: ['tarpon', 'grouper'],
      4: ['tigerShark'],
    },
    hazards: { oysters: 3, jellyfish: 4, mines: 0 },
    difficulty: { chaseSpeed: 0.82, detectRadius: 7, predators: [2, 2, 2] },
    stars: [6000, 8500],
    feature: 'tide',
    tip: 'The tide rises and falls. Low water packs the fish together',
    challenges: [
      { kind: 'feature', key: 'lowTideEat', n: 25, label: 'Eat 25 fish at low tide' },
      { kind: 'golden' },
      { kind: 'noDeath' },
    ],
    music: {
      root: 60,
      scale: [0, 2, 4, 5, 7, 9, 11],
      progression: [0, 5, 3, 4],
      tempo: 80,
      brightness: 0.9,
      pluckDensity: 0.85,
    },
    seed: 6606,
  },
  {
    id: 'canyon',
    index: 6,
    chapter: 1,
    name: 'Coral Canyon',
    subtitle: 'Walls of colour, falls of shadow',
    biome: 'canyon',
    world: { width: 130, height: 30 },
    fishPerStage: 50,
    roster: {
      1: ['cardinalfish', 'glimmerfish'],
      2: ['angelfish', 'blueTang'],
      3: ['napoleon', 'parrotfish'],
      4: ['hammerhead', 'reefShark'],
    },
    hazards: { oysters: 3, jellyfish: 5, mines: 2 },
    difficulty: { chaseSpeed: 0.85, detectRadius: 7.3, predators: [2, 2, 3] },
    stars: [7100, 10000],
    feature: 'currents',
    tip: 'Ride the currents for speed. Swimming against them is slow going',
    challenges: [
      { kind: 'feature', key: 'ride', n: 20, label: 'Ride currents for 20 seconds' },
      { kind: 'combo', n: 18 },
      { kind: 'under', seconds: 230 },
    ],
    music: {
      root: 59,
      scale: PENTATONIC_MAJOR,
      progression: [0, 2, 3, 4],
      tempo: 88,
      brightness: 1,
      pluckDensity: 1,
    },
    seed: 7707,
  },
  {
    id: 'ruins',
    index: 7,
    chapter: 1,
    name: 'Sunken City',
    subtitle: 'The old gods are hungry too',
    biome: 'ruins',
    world: { width: 125, height: 28 },
    fishPerStage: 50,
    roster: {
      1: ['glassfish', 'cardinalfish'],
      2: ['angelfish', 'snapper'],
      3: ['napoleon', 'lionfish'],
      4: ['hammerhead', 'barracuda'],
    },
    cover: 'angelfish',
    hazards: { oysters: 3, jellyfish: 4, mines: 4 },
    difficulty: { chaseSpeed: 0.86, detectRadius: 7.5, predators: [2, 3, 3] },
    stars: [7300, 9900],
    feature: 'guardians',
    tip: 'Glowing statue eyes mean a sweeping beam is coming. Get out of its way!',
    challenges: [
      { kind: 'feature', key: 'beamKill', n: 2, label: 'Lure 2 predators into a beam' },
      { kind: 'golden' },
      { kind: 'noDeath' },
    ],
    music: {
      root: 57,
      scale: [0, 2, 3, 5, 7, 8, 11],
      progression: [0, 3, 5, 4],
      tempo: 70,
      brightness: 0.7,
      pluckDensity: 0.7,
    },
    seed: 8808,
  },
  {
    id: 'crystal',
    index: 8,
    chapter: 1,
    name: 'Crystal Caverns',
    subtitle: 'Beautiful, glowing and deadly',
    biome: 'crystal',
    world: { width: 120, height: 26 },
    fishPerStage: 50,
    roster: {
      1: ['crystalTetra', 'lanternfish'],
      2: ['cavefish', 'hatchetfish'],
      3: ['coelacanth', 'viperfish'],
      4: ['anglerfish', 'sleeperShark'],
    },
    hazards: { oysters: 2, jellyfish: 5, mines: 3, geysers: 4 },
    difficulty: { chaseSpeed: 0.86, detectRadius: 7.4, predators: [2, 2, 3] },
    stars: [6800, 9600],
    feature: 'crystals',
    tip: 'Bump a crystal to shatter it and stun every fish nearby',
    challenges: [
      { kind: 'feature', key: 'shatter', n: 4, label: 'Shatter 4 crystals' },
      { kind: 'feature', key: 'stunEat', n: 10, label: 'Eat 10 stunned fish' },
      { kind: 'combo', n: 15 },
    ],
    music: {
      root: 63,
      scale: [0, 2, 4, 6, 7, 9, 11],
      progression: [0, 4, 1, 5],
      tempo: 66,
      brightness: 1.05,
      pluckDensity: 1.1,
    },
    seed: 9909,
  },
  {
    id: 'volcanic',
    index: 9,
    chapter: 1,
    name: 'Volcanic Rift',
    subtitle: 'Where the sea itself is burning',
    biome: 'volcanic',
    world: { width: 130, height: 28 },
    fishPerStage: 50,
    roster: {
      1: ['cardinalfish', 'lanternfish'],
      2: ['cavefish', 'rockfish'],
      3: ['coelacanth', 'viperfish'],
      4: ['tigerShark', 'anglerfish'],
    },
    cover: 'tigerShark',
    hazards: { oysters: 2, jellyfish: 3, mines: 4, geysers: 7 },
    difficulty: { chaseSpeed: 0.87, detectRadius: 7.5, predators: [2, 2, 3] },
    stars: [5900, 8300],
    feature: 'heat',
    tip: 'Heat waves rise from the rift. Dive under them before you scald!',
    challenges: [
      { kind: 'feature', key: 'heatDodge', n: 4, label: 'Escape 4 heat waves unscathed' },
      { kind: 'combo', n: 20 },
      { kind: 'golden' },
    ],
    music: {
      root: 50,
      scale: [0, 1, 3, 5, 7, 8, 10],
      progression: [0, 1, 3, 2],
      tempo: 76,
      brightness: 0.5,
      pluckDensity: 0.6,
    },
    seed: 10110,
  },
  {
    id: 'abyssKing',
    index: 10,
    chapter: 1,
    name: 'The Abyss King',
    subtitle: 'Something vast is holding the only light',
    biome: 'abyss',
    biomeOverride: {
      fog: { top: '#123048', mid: '#08162a', bottom: '#020610' },
      hemi: { sky: '#2a5070', intensity: 0.7 },
      playerLight: 1.4,
      bloom: 1.2,
    },
    world: { width: 64, height: 28 },
    fishPerStage: 50,
    roster: {
      1: ['lanternfish', 'glimmerfish'],
      2: ['hatchetfish'],
      3: ['viperfish'],
      4: ['anglerfish'],
    },
    cover: 'anglerKing',
    hazards: { oysters: 2, jellyfish: 2, mines: 0 },
    difficulty: { chaseSpeed: 0.9, detectRadius: 7.5, predators: [0, 0, 0] },
    stars: [15000, 21000],
    boss: { kind: 'angler', name: 'The Abyss King', phases: 3, hitsPerPhase: 3 },
    tip: 'Never touch the lure. Make it lunge and miss, then bite the lure while it\u2019s dazed!',
    challenges: [
      { kind: 'feature', key: 'bossDodge', n: 6, label: 'Make it crash 6 times' },
      { kind: 'noDeath' },
      { kind: 'under', seconds: 200 },
    ],
    music: {
      root: 45,
      scale: [0, 1, 3, 5, 7, 8, 10],
      progression: [0, 1, 5, 1],
      tempo: 100,
      brightness: 0.5,
      pluckDensity: 1.3,
    },
    seed: 21021,
  },
  {
    id: 'reef2',
    index: 11,
    chapter: 2,
    name: 'Reef at Dusk',
    subtitle: 'The colours fade, the hunters wake',
    biome: 'reef',
    biomeOverride: {
      fog: { top: '#e0906e', mid: '#7a4f80', bottom: '#1e1d4c' },
      sun: { color: '#ffb27a', intensity: 1.8 },
      hemi: { sky: '#f0a890', ground: '#3a2a50', intensity: 0.9 },
      caustics: 0.9,
      causticsColor: '#ffd2a8',
      shaftColor: '#ffc89a',
      shaftIntensity: 0.45,
      surfaceColor: '#ffb890',
      playerLight: 0.6,
      bloom: 0.9,
      exposure: 1.0,
    },
    world: { width: 110, height: 26 },
    fishPerStage: 52,
    roster: {
      1: ['sardine', 'glimmerfish'],
      2: ['butterflyfish', 'pufferfish', 'blueTang'],
      3: ['lionfish', 'grouper', 'parrotfish'],
      4: ['barracuda', 'reefShark'],
    },
    hazards: { oysters: 3, jellyfish: 2, mines: 0 },
    difficulty: { chaseSpeed: 0.82, detectRadius: 6.8, predators: [2, 3, 4] },
    stars: [5900, 8400],
    feature: 'puffer',
    featureOpts: { windup: 0.32, pairs: true, lionfishSting: true },
    greatWhite: greatWhite(0),
    tip: 'Puffers swell faster and swim in pairs. Lionfish sting if you bite them head-on!',
    challenges: [
      { kind: 'feature', key: 'puffer', n: 6, label: 'Eat 6 pufferfish before they puff up' },
      { kind: 'feature', key: 'lionfishBack', n: 5, label: 'Eat 5 lionfish from behind' },
      { kind: 'combo', n: 15 },
    ],
    music: {
      root: 61,
      scale: DORIAN,
      progression: [0, 5, 3, 4],
      tempo: 90,
      brightness: 0.8,
      pluckDensity: 1,
    },
    seed: 11211,
  },
  {
    id: 'kelp2',
    index: 12,
    chapter: 2,
    name: 'Kelp Storm',
    subtitle: 'The forest bends to the swell',
    biome: 'kelp',
    biomeOverride: {
      fog: { top: '#6f9a90', mid: '#2a5a58', bottom: '#0a2a2e', density: 0.028 },
      sun: { color: '#d8e8e0', intensity: 1.5 },
      hemi: { sky: '#9ab8b0', intensity: 0.85 },
      caustics: 0.6,
      shafts: 8,
      shaftIntensity: 0.35,
      surfaceColor: '#a8c8c0',
      snow: { count: 4200, opacity: 0.65 },
    },
    world: { width: 120, height: 30 },
    fishPerStage: 52,
    roster: {
      1: ['glimmerfish', 'sardine', 'silverside'],
      2: ['rockfish', 'blueTang', 'snapper'],
      3: ['sheephead', 'parrotfish', 'cod'],
      4: ['reefShark', 'barracuda'],
    },
    hazards: { oysters: 2, jellyfish: 6, mines: 0 },
    difficulty: { chaseSpeed: 0.83, detectRadius: 7, predators: [3, 3, 4] },
    stars: [5500, 7700],
    feature: 'kelpHide',
    featureOpts: { surge: true, surgePeriod: 9, surgeAmp: 2.2, narrow: 0.6, searchMul: 1.4 },
    greatWhite: greatWhite(1),
    tip: 'Storm surges sway the kelp. Cover shrinks at each peak and hunters search longer',
    challenges: [
      { kind: 'feature', key: 'hideEscape', n: 4, label: 'Lose 4 hunters in the storm' },
      { kind: 'combo', n: 18 },
      { kind: 'noDeath' },
    ],
    music: {
      root: 53,
      scale: DORIAN,
      progression: [0, 3, 4, 6],
      tempo: 92,
      brightness: 0.7,
      pluckDensity: 1.1,
    },
    seed: 12312,
  },
  {
    id: 'wreck2',
    index: 13,
    chapter: 2,
    name: 'Ghost Fleet',
    subtitle: 'The drowned fleet stirs',
    biome: 'wreck',
    biomeOverride: {
      fog: { top: '#4f8f9a', mid: '#16505a', bottom: '#04161e', density: 0.03 },
      sun: { color: '#bfe8ff', intensity: 1.1 },
      hemi: { sky: '#7ab8c8', ground: '#1a2a30', intensity: 0.7 },
      caustics: 0.4,
      causticsColor: '#a8f0ff',
      shaftColor: '#a8f0ff',
      shaftIntensity: 0.4,
      playerLight: 1.6,
      snow: { count: 5200, color: '#c8f0ff' },
      bloom: 1.0,
    },
    world: { width: 120, height: 27 },
    fishPerStage: 52,
    roster: {
      1: ['sardine', 'silverside'],
      2: ['rockfish', 'butterflyfish', 'snapper'],
      3: ['lionfish', 'grouper', 'cod'],
      4: ['reefShark', 'barracuda', 'sleeperShark'],
    },
    hazards: { oysters: 2, jellyfish: 4, mines: 7, mineDrift: 3 },
    difficulty: { chaseSpeed: 0.84, detectRadius: 7.2, predators: [2, 3, 3] },
    stars: [6500, 9200],
    feature: 'eels',
    featureOpts: { burrows: 7, aim: 0.38, lunge: 0.12, cooldown: 1.1 },
    greatWhite: greatWhite(2),
    tip: 'More eels strike faster than ever, and loose mines drift on their chains',
    challenges: [
      { kind: 'feature', key: 'eelKill', n: 3, label: 'Lure 3 predators to the eels' },
      { kind: 'combo', n: 18 },
      { kind: 'under', seconds: 240 },
    ],
    music: {
      root: 55,
      scale: PENTATONIC_MINOR,
      progression: [0, 4, 3, 2],
      tempo: 80,
      brightness: 0.5,
      pluckDensity: 0.7,
    },
    seed: 13413,
  },
  {
    id: 'ice2',
    index: 14,
    chapter: 2,
    name: 'Glacier Collapse',
    subtitle: 'The shelf is coming down',
    biome: 'ice',
    biomeOverride: {
      fog: { top: '#9fc8f0', mid: '#3a6ea8', bottom: '#0c2244' },
      sun: { color: '#cfe0ff', intensity: 1.7 },
      hemi: { sky: '#bcd8ff', intensity: 1.0 },
      shafts: 6,
      snow: { count: 5400, size: 0.09, opacity: 0.8 },
      playerLight: 0.6,
      exposure: 1.0,
    },
    world: { width: 110, height: 26 },
    fishPerStage: 52,
    roster: {
      1: ['silverside', 'glassfish'],
      2: ['char', 'rockfish'],
      3: ['cod', 'sheephead'],
      4: ['sleeperShark', 'barracuda'],
    },
    hazards: { oysters: 2, jellyfish: 8, mines: 4 },
    difficulty: { chaseSpeed: 0.85, detectRadius: 7.4, predators: [2, 3, 3] },
    stars: [7900, 11200],
    feature: 'icicles',
    featureOpts: { chain: 3, chainDelay: 0.35, chunkEvery: 4 },
    greatWhite: greatWhite(3),
    tip: 'Icicles fall in chains, and every fourth drop is a huge block of ice',
    challenges: [
      { kind: 'feature', key: 'icicleKill', n: 3, label: 'Lure 3 predators under falling ice' },
      { kind: 'combo', n: 16 },
      { kind: 'under', seconds: 230 },
    ],
    music: {
      root: 62,
      scale: DORIAN,
      progression: [0, 3, 5, 4],
      tempo: 82,
      brightness: 0.8,
      pluckDensity: 1.2,
    },
    seed: 14514,
  },
  {
    id: 'abyss2',
    index: 15,
    chapter: 2,
    name: 'Hadal Deep',
    subtitle: 'Below the last light',
    biome: 'abyss',
    biomeOverride: {
      fog: { top: '#061a30', mid: '#030c18', bottom: '#000204', density: 0.034 },
      sun: { intensity: 0.15 },
      hemi: { intensity: 0.25 },
      snow: { color: '#7ac8ff' },
      palette: { coral: ['#ff5f9f', '#5fe0ff', '#9f7bff'] },
      bloom: 1.35,
    },
    world: { width: 120, height: 29 },
    fishPerStage: 52,
    roster: {
      1: ['lanternfish', 'cardinalfish'],
      2: ['hatchetfish', 'rockfish'],
      3: ['viperfish', 'cod'],
      4: ['anglerfish', 'sleeperShark'],
    },
    hazards: { oysters: 2, jellyfish: 5, mines: 5 },
    difficulty: { chaseSpeed: 0.86, detectRadius: 7.6, predators: [2, 3, 3] },
    stars: [6600, 9300],
    feature: 'darkness',
    featureOpts: { drain: 30, refill: 0.045, lurkers: 3 },
    greatWhite: greatWhite(4),
    tip: 'Your light fades faster. Beware of lights that never move: anglerfish lurk behind them',
    challenges: [
      { kind: 'feature', key: 'glowEat', n: 30, label: 'Eat 30 glowing fish' },
      { kind: 'combo', n: 15 },
      { kind: 'noDeath' },
    ],
    music: {
      root: 46,
      scale: PENTATONIC_MINOR,
      progression: [0, 3, 1, 2],
      tempo: 54,
      brightness: 0.3,
      pluckDensity: 0.35,
    },
    seed: 15615,
  },
  {
    id: 'mangrove2',
    index: 16,
    chapter: 2,
    name: 'Storm Surge',
    subtitle: 'Wild tides, hungry skies',
    biome: 'mangrove',
    biomeOverride: {
      fog: { top: '#8fa888', mid: '#3f5f44', bottom: '#1a2a1a', density: 0.032 },
      sun: { color: '#e0e8d0', intensity: 1.6 },
      hemi: { sky: '#b0c0a0', intensity: 0.9 },
      caustics: 0.6,
      shafts: 8,
      shaftIntensity: 0.4,
      surfaceColor: '#c0d0b0',
      snow: { count: 5200 },
    },
    world: { width: 120, height: 26 },
    fishPerStage: 52,
    roster: {
      1: ['glassfish', 'sardine', 'silverside'],
      2: ['snapper', 'rockfish', 'blueTang'],
      3: ['tarpon', 'grouper', 'cod'],
      4: ['tigerShark', 'barracuda'],
    },
    hazards: { oysters: 3, jellyfish: 6, mines: 0 },
    difficulty: { chaseSpeed: 0.84, detectRadius: 7.3, predators: [2, 2, 3] },
    stars: [6000, 8500],
    feature: 'tide',
    featureOpts: { period: 36, low: 0.65, birds: true },
    greatWhite: greatWhite(5),
    tip: 'The tide drains further and faster. At low water seabirds dive: watch for their shadows',
    challenges: [
      { kind: 'feature', key: 'lowTideEat', n: 30, label: 'Eat 30 fish at low tide' },
      { kind: 'feature', key: 'birdDodge', n: 5, label: 'Dodge 5 diving seabirds' },
      { kind: 'golden' },
    ],
    music: {
      root: 58,
      scale: DORIAN,
      progression: [0, 4, 5, 3],
      tempo: 92,
      brightness: 0.7,
      pluckDensity: 1,
    },
    seed: 16716,
  },
  {
    id: 'canyon2',
    index: 17,
    chapter: 2,
    name: 'Rip Currents',
    subtitle: 'The canyon pulls both ways',
    biome: 'canyon',
    biomeOverride: {
      fog: { top: '#4f88d0', mid: '#1a4a8a', bottom: '#081a3e' },
      sun: { color: '#ffd8a8', intensity: 2.0 },
      causticsColor: '#ffe8c8',
      shaftColor: '#ffe0b8',
      palette: { coral: ['#ff5c7a', '#ff9347', '#d04fc0', '#7a60ff', '#3fd0b0', '#ffc140'] },
    },
    world: { width: 130, height: 30 },
    fishPerStage: 52,
    roster: {
      1: ['cardinalfish', 'glimmerfish', 'sardine'],
      2: ['angelfish', 'blueTang', 'butterflyfish'],
      3: ['napoleon', 'parrotfish', 'grouper'],
      4: ['hammerhead', 'reefShark', 'barracuda'],
    },
    hazards: { oysters: 3, jellyfish: 6, mines: 3 },
    difficulty: { chaseSpeed: 0.87, detectRadius: 7.6, predators: [2, 3, 3] },
    stars: [6200, 8700],
    feature: 'currents',
    featureOpts: { speed: 4.4, flipEvery: [18, 28], flipWarn: 3 },
    greatWhite: greatWhite(6),
    tip: 'Currents run stronger and reverse every so often. Watch for the shift warning',
    challenges: [
      { kind: 'feature', key: 'ride', n: 30, label: 'Ride currents for 30 seconds' },
      { kind: 'combo', n: 20 },
      { kind: 'under', seconds: 240 },
    ],
    music: {
      root: 57,
      scale: PENTATONIC_MAJOR,
      progression: [0, 3, 1, 4],
      tempo: 98,
      brightness: 0.95,
      pluckDensity: 1.2,
    },
    seed: 17817,
  },
  {
    id: 'ruins2',
    index: 18,
    chapter: 2,
    name: 'Awakened City',
    subtitle: 'Every statue has opened its eyes',
    biome: 'ruins',
    biomeOverride: {
      fog: { top: '#3a7a90', mid: '#124858', bottom: '#041a22', density: 0.027 },
      sun: { color: '#bfe8ff', intensity: 1.3 },
      hemi: { sky: '#7ac0c8', intensity: 0.75 },
      caustics: 0.7,
      shaftIntensity: 0.4,
      playerLight: 1.2,
      bloom: 1.0,
    },
    world: { width: 125, height: 28 },
    fishPerStage: 52,
    roster: {
      1: ['glassfish', 'cardinalfish', 'crystalTetra'],
      2: ['angelfish', 'snapper', 'cavefish'],
      3: ['napoleon', 'lionfish', 'coelacanth'],
      4: ['hammerhead', 'barracuda', 'tigerShark'],
    },
    cover: 'angelfish',
    hazards: { oysters: 3, jellyfish: 5, mines: 5 },
    difficulty: { chaseSpeed: 0.88, detectRadius: 7.8, predators: [2, 4, 4] },
    stars: [8400, 11300],
    feature: 'guardians',
    featureOpts: { pairs: true, sweepBack: true },
    greatWhite: greatWhite(7),
    tip: 'Guardians fire in pairs and sweep back again. Wait for the second pass!',
    challenges: [
      { kind: 'feature', key: 'beamKill', n: 3, label: 'Lure 3 predators into a beam' },
      { kind: 'combo', n: 18 },
      { kind: 'noDeath' },
    ],
    music: {
      root: 55,
      scale: [0, 2, 3, 5, 7, 8, 11],
      progression: [0, 5, 3, 4],
      tempo: 78,
      brightness: 0.6,
      pluckDensity: 0.8,
    },
    seed: 18918,
  },
  {
    id: 'crystal2',
    index: 19,
    chapter: 2,
    name: 'Resonance',
    subtitle: 'One crack sings through the cave',
    biome: 'crystal',
    biomeOverride: {
      fog: { top: '#3a1e5a', mid: '#1c1038', bottom: '#07040f' },
      sun: { color: '#d08aff' },
      hemi: { sky: '#5a3a7a' },
      snow: { color: '#ffb0e8' },
      palette: { coral: ['#ff5fd2', '#ffb05f', '#5fffd0', '#a77bff'], plantTip: '#ff7bd8' },
    },
    world: { width: 120, height: 26 },
    fishPerStage: 52,
    roster: {
      1: ['crystalTetra', 'lanternfish', 'glassfish'],
      2: ['cavefish', 'hatchetfish', 'char'],
      3: ['coelacanth', 'viperfish', 'cod'],
      4: ['anglerfish', 'sleeperShark', 'hammerhead'],
    },
    hazards: { oysters: 2, jellyfish: 6, mines: 4, geysers: 5 },
    difficulty: { chaseSpeed: 0.88, detectRadius: 7.7, predators: [2, 3, 3] },
    stars: [6700, 9400],
    feature: 'crystals',
    featureOpts: { count: 7, chain: 7, chainDelay: 0.3, selfStun: 1.8 },
    greatWhite: greatWhite(8),
    tip: 'A shattering crystal sets off its neighbours. Stay clear of the chain or get stunned yourself',
    challenges: [
      { kind: 'feature', key: 'chainShatter', n: 3, label: 'Set off 3 resonance chains' },
      { kind: 'feature', key: 'stunEat', n: 15, label: 'Eat 15 stunned fish' },
      { kind: 'combo', n: 18 },
    ],
    music: {
      root: 61,
      scale: [0, 2, 4, 6, 7, 9, 11],
      progression: [0, 2, 5, 4],
      tempo: 74,
      brightness: 1.1,
      pluckDensity: 1.3,
    },
    seed: 19019,
  },
  {
    id: 'volcanic2',
    index: 20,
    chapter: 2,
    name: 'Eruption',
    subtitle: 'The rift breaks open',
    biome: 'volcanic',
    biomeOverride: {
      fog: { top: '#7a2a18', mid: '#3a1008', bottom: '#0a0302' },
      sun: { color: '#ff9050', intensity: 0.8 },
      hemi: { sky: '#9a3a1a' },
      palette: { plantTip: '#ffb03c' },
      embers: 1500,
      bloom: 1.3,
    },
    world: { width: 130, height: 28 },
    fishPerStage: 52,
    roster: {
      1: ['cardinalfish', 'lanternfish', 'glassfish'],
      2: ['cavefish', 'rockfish', 'char'],
      3: ['coelacanth', 'viperfish', 'cod'],
      4: ['tigerShark', 'anglerfish', 'hammerhead'],
    },
    cover: 'tigerShark',
    hazards: { oysters: 2, jellyfish: 3, mines: 5, geysers: 9 },
    difficulty: { chaseSpeed: 0.88, detectRadius: 7.6, predators: [2, 3, 3] },
    stars: [6300, 8900],
    feature: 'heat',
    featureOpts: { pulses: 2, pulseGap: 2.4, bombs: 2 },
    greatWhite: greatWhite(9),
    tip: 'Heat waves come in double pulses and lava bombs rain down. Watch for their shadows!',
    challenges: [
      { kind: 'feature', key: 'heatDodge', n: 5, label: 'Escape 5 heat waves unscathed' },
      { kind: 'feature', key: 'bombDodge', n: 10, label: 'Dodge 10 lava bombs' },
      { kind: 'combo', n: 22 },
    ],
    music: {
      root: 49,
      scale: [0, 1, 4, 5, 7, 8, 10],
      progression: [0, 1, 5, 3],
      tempo: 88,
      brightness: 0.55,
      pluckDensity: 0.8,
    },
    seed: 20120,
  },
  {
    id: 'kraken',
    index: 21,
    chapter: 2,
    name: 'The Kraken',
    subtitle: 'The city was its nest all along',
    biome: 'ruins',
    biomeOverride: {
      fog: { top: '#2a5068', mid: '#0e2a38', bottom: '#030c12', density: 0.03 },
      sun: { color: '#9fc8ff', intensity: 0.9 },
      hemi: { sky: '#5a8aa0', intensity: 0.65 },
      caustics: 0.5,
      shaftIntensity: 0.3,
      playerLight: 1.3,
      bloom: 1.1,
    },
    world: { width: 64, height: 28 },
    fishPerStage: 52,
    roster: {
      1: ['glassfish', 'cardinalfish', 'crystalTetra'],
      2: ['angelfish', 'snapper'],
      3: ['napoleon', 'coelacanth'],
      4: ['hammerhead'],
    },
    cover: 'napoleon',
    hazards: { oysters: 2, jellyfish: 2, mines: 0 },
    difficulty: { chaseSpeed: 0.92, detectRadius: 8, predators: [0, 0, 0] },
    stars: [16000, 22000],
    boss: { kind: 'kraken', name: 'The Kraken', phases: 3, hitsPerPhase: 3 },
    tip: 'Dodge the slams, bite the glowing tentacle tips, then go for the eye!',
    challenges: [
      { kind: 'feature', key: 'bossDodge', n: 10, label: 'Dodge 10 tentacle slams' },
      { kind: 'noDeath' },
      { kind: 'under', seconds: 220 },
    ],
    music: {
      root: 50,
      scale: [0, 2, 3, 5, 7, 8, 11],
      progression: [0, 5, 1, 4],
      tempo: 104,
      brightness: 0.6,
      pluckDensity: 1.3,
    },
    seed: 22122,
  },
];

/** Level ids in play order. */
export const LEVEL_IDS: readonly string[] = LEVELS.map((l) => l.id);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `base` with every key of `over` replaced; nested objects merge, arrays are replaced whole. */
export function deepMerge<T>(base: T, over: DeepPartial<T> | undefined): T {
  if (!over) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    const cur = out[k];
    out[k] = isPlainObject(cur) && isPlainObject(v) ? deepMerge(cur, v) : v;
  }
  return out as T;
}

const resolved = new WeakMap<LevelDef, BiomeDef>();

/** The level's biome with its look overrides applied. */
export function resolveBiome(level: LevelDef): BiomeDef {
  let b = resolved.get(level);
  if (!b) {
    b = deepMerge(BIOMES[level.biome], level.biomeOverride);
    resolved.set(level, b);
  }
  return b;
}

export function chapterOf(index: number): ChapterId {
  let id: ChapterId = 1;
  for (const c of CHAPTERS) if (index >= c.from) id = c.id;
  return id;
}

/** A chapter's regular levels in order, without its boss. */
export function chapterLevels(chapter: ChapterId): LevelDef[] {
  return LEVELS.filter((l) => l.chapter === chapter && !l.boss);
}

export function chapterBoss(chapter: ChapterId): LevelDef | undefined {
  return LEVELS.find((l) => l.chapter === chapter && l.boss);
}

/** Every level of a chapter in play order, the boss last. */
export function chapterAll(chapter: ChapterId): LevelDef[] {
  return LEVELS.filter((l) => l.chapter === chapter);
}

/**
 * The mid-level events a level can roll, or null for none (boss fights). Ocean I eases them in
 * a few levels at a time; Ocean II has them all, more often.
 */
export function levelEvents(level: LevelDef): LevelEvents | null {
  if (level.boss) return null;
  if (level.events) return level.events;
  if (level.chapter === 2) return { every: [70, 110], pool: ['baitBall', 'whale', 'riptide'] };
  const n = level.index;
  return { every: [80, 120], pool: n < 2 ? ['baitBall'] : n < 5 ? ['baitBall', 'riptide'] : ['baitBall', 'whale', 'riptide'] };
}

/** Beating this level opens endless mode. */
export const ENDLESS_UNLOCK = 'abyssKing';
export const ENDLESS_FISH_PER_STAGE = 35;

/** The levels endless mode can be played in: one per biome, Ocean I's originals. */
export function endlessBases(): LevelDef[] {
  return chapterLevels(1);
}

const endlessLevels = new Map<string, LevelDef>();

/**
 * An endless run in `base`'s biome, with its fish, music and twist. Every event can roll and a
 * great white joins once the danger level climbs (see game/systems/Endless).
 */
export function endlessLevel(base: LevelDef): LevelDef {
  let lv = endlessLevels.get(base.id);
  if (!lv) {
    lv = {
      ...base,
      id: `endless-${base.biome}`,
      subtitle: 'Endless',
      fishPerStage: ENDLESS_FISH_PER_STAGE,
      greatWhite: base.greatWhite ?? { first: 8, every: [70, 100], speed: 1.12, chase: 0.25 },
      events: { every: [70, 110], pool: ['baitBall', 'whale', 'riptide'] },
      challenges: [],
      endless: true,
      seed: base.seed + 909,
    };
    endlessLevels.set(base.id, lv);
  }
  return lv;
}
