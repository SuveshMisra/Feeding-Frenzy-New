import type { BiomeId } from '../config/levels';
import type { DrumId, PitchedId } from './instruments';

export type PadType = 'soft' | 'warm' | 'glass' | 'choir' | 'drone';
export type ArpPattern = 'up8' | 'updown8' | 'broken16' | 'sparse' | 'alberti8';
export type BassPattern = 'roots' | 'island' | 'pulse' | 'long' | 'walk';

/** One drum voice in a groove: 16 steps per bar, 'x' full, 'o' ghost, '.' rest. */
export interface DrumLine {
  inst: DrumId;
  /** 1 = from the first growth stage, 2 = mid, 3 = full band / frenzy. */
  tier: 1 | 2 | 3;
  hits: string;
  vel?: number;
}

export interface MusicStyle {
  lead: PitchedId;
  arp: PitchedId;
  bass: PitchedId;
  pad: PadType;
  arpPattern: ArpPattern;
  bassPattern: BassPattern;
  drums: DrumLine[];
  /** Fill played on the last bar of each section. */
  fill: DrumLine;
  /** 0..1 delay of off-beat sixteenths. */
  swing: number;
  /** Reverb tail in seconds and wet level. */
  space: [number, number];
  /** Combo chimes and pickups ring on this. */
  chime: PitchedId;
}

const ISLAND: DrumLine[] = [
  { inst: 'shaker', tier: 1, hits: 'o.x.o.x.o.x.o.x.', vel: 0.8 },
  { inst: 'congaLow', tier: 2, hits: 'x.....x...x.....' },
  { inst: 'congaHigh', tier: 2, hits: '....x.....x..x..', vel: 0.8 },
  { inst: 'kick', tier: 2, hits: 'x.......x.......', vel: 0.7 },
  { inst: 'rim', tier: 3, hits: '..x...x...x...xo', vel: 0.9 },
];

export const STYLES: Record<BiomeId, MusicStyle> = {
  reef: {
    lead: 'marimba',
    arp: 'kalimba',
    bass: 'pluckBass',
    pad: 'soft',
    arpPattern: 'up8',
    bassPattern: 'island',
    drums: ISLAND,
    fill: { inst: 'congaHigh', tier: 2, hits: '........x.x.xxox', vel: 0.75 },
    swing: 0.12,
    space: [2.4, 0.42],
    chime: 'kalimba',
  },
  kelp: {
    lead: 'ep',
    arp: 'harp',
    bass: 'subBass',
    pad: 'warm',
    arpPattern: 'updown8',
    bassPattern: 'roots',
    drums: [
      { inst: 'brush', tier: 1, hits: 'x...x...x...x...', vel: 0.8 },
      { inst: 'kick', tier: 2, hits: 'x.......x.....o.', vel: 0.75 },
      { inst: 'rim', tier: 2, hits: '....x.......x...', vel: 0.5 },
      { inst: 'shaker', tier: 3, hits: '..x...x...x...x.', vel: 1 },
    ],
    fill: { inst: 'brush', tier: 2, hits: '........x.x.x.xx', vel: 0.7 },
    swing: 0.22,
    space: [3, 0.5],
    chime: 'harp',
  },
  wreck: {
    lead: 'nylon',
    arp: 'marimba',
    bass: 'pluckBass',
    pad: 'choir',
    arpPattern: 'sparse',
    bassPattern: 'roots',
    drums: [
      { inst: 'woodblock', tier: 1, hits: 'x.......x.......', vel: 0.55 },
      { inst: 'congaLow', tier: 2, hits: 'x.....x.........', vel: 0.9 },
      { inst: 'kick', tier: 2, hits: 'x...........x...', vel: 0.6 },
      { inst: 'rim', tier: 3, hits: '....x.......x..o', vel: 0.9 },
    ],
    fill: { inst: 'congaLow', tier: 2, hits: '..........x.x.xx', vel: 0.8 },
    swing: 0,
    space: [3.2, 0.5],
    chime: 'marimba',
  },
  ice: {
    lead: 'glock',
    arp: 'kalimba',
    bass: 'subBass',
    pad: 'glass',
    arpPattern: 'broken16',
    bassPattern: 'long',
    drums: [
      { inst: 'glassTap', tier: 1, hits: 'x.......x.......', vel: 0.6 },
      { inst: 'shaker', tier: 2, hits: '..x...x...x...x.', vel: 1 },
      { inst: 'kick', tier: 2, hits: 'x.........x.....', vel: 0.5 },
      { inst: 'glassTap', tier: 3, hits: '....o......o..o.', vel: 0.6 },
      { inst: 'drop', tier: 3, hits: '.......x........', vel: 0.5 },
    ],
    fill: { inst: 'glassTap', tier: 2, hits: '........x.x.x.xx', vel: 0.45 },
    swing: 0,
    space: [4, 0.6],
    chime: 'glock',
  },
  abyss: {
    lead: 'bell',
    arp: 'kalimba',
    bass: 'subBass',
    pad: 'drone',
    arpPattern: 'sparse',
    bassPattern: 'long',
    drums: [
      { inst: 'kick', tier: 1, hits: 'x..o............', vel: 0.6 },
      { inst: 'doum', tier: 2, hits: '........x.....o.', vel: 0.6 },
      { inst: 'drop', tier: 2, hits: '....x.......x...', vel: 0.6 },
      { inst: 'taiko', tier: 3, hits: 'x...............', vel: 0.5 },
      { inst: 'shaker', tier: 3, hits: '..o...o...o...o.', vel: 0.8 },
    ],
    fill: { inst: 'kick', tier: 2, hits: '........x..x.x.x', vel: 0.5 },
    swing: 0,
    space: [5, 0.65],
    chime: 'kalimba',
  },
  mangrove: {
    lead: 'steelpan',
    arp: 'marimba',
    bass: 'pluckBass',
    pad: 'soft',
    arpPattern: 'alberti8',
    bassPattern: 'island',
    drums: ISLAND,
    fill: { inst: 'congaHigh', tier: 2, hits: '......x.x.xxx.xx', vel: 0.75 },
    swing: 0.18,
    space: [2.2, 0.4],
    chime: 'steelpan',
  },
  canyon: {
    lead: 'marimba',
    arp: 'harp',
    bass: 'pluckBass',
    pad: 'warm',
    arpPattern: 'broken16',
    bassPattern: 'walk',
    drums: [
      { inst: 'shaker', tier: 1, hits: 'xoxoxoxoxoxoxoxo', vel: 0.65 },
      { inst: 'kick', tier: 2, hits: 'x.....x...x.....', vel: 0.8 },
      { inst: 'congaHigh', tier: 2, hits: '.....x.....x.x..', vel: 0.7 },
      { inst: 'rim', tier: 3, hits: '....x.......x...', vel: 0.6 },
      { inst: 'congaLow', tier: 3, hits: '...x......x.....', vel: 0.7 },
    ],
    fill: { inst: 'congaHigh', tier: 2, hits: '........xxoxxoxx', vel: 0.7 },
    swing: 0.08,
    space: [2.6, 0.42],
    chime: 'marimba',
  },
  ruins: {
    lead: 'koto',
    arp: 'harp',
    bass: 'subBass',
    pad: 'choir',
    arpPattern: 'updown8',
    bassPattern: 'roots',
    drums: [
      { inst: 'tek', tier: 1, hits: '...x...x..x.x...', vel: 0.6 },
      { inst: 'doum', tier: 2, hits: 'x.....x...x.....' },
      { inst: 'shaker', tier: 3, hits: 'o.x.o.x.o.x.o.x.', vel: 0.95 },
    ],
    fill: { inst: 'tek', tier: 2, hits: '........x.xxx.xx', vel: 0.6 },
    swing: 0.1,
    space: [3.6, 0.55],
    chime: 'koto',
  },
  crystal: {
    lead: 'glock',
    arp: 'kalimba',
    bass: 'subBass',
    pad: 'glass',
    arpPattern: 'broken16',
    bassPattern: 'long',
    drums: [
      { inst: 'glassTap', tier: 1, hits: 'x.....x.....x...', vel: 0.55 },
      { inst: 'shaker', tier: 2, hits: '..x...x...x...x.', vel: 1 },
      { inst: 'kick', tier: 2, hits: 'x.......x.......', vel: 0.5 },
      { inst: 'drop', tier: 3, hits: '.......x.......x', vel: 0.5 },
      { inst: 'rim', tier: 3, hits: '....o.......o...', vel: 0.6 },
    ],
    fill: { inst: 'glassTap', tier: 2, hits: '......x.x.x.xxxx', vel: 0.4 },
    swing: 0,
    space: [5, 0.65],
    chime: 'glock',
  },
  volcanic: {
    lead: 'ep',
    arp: 'marimba',
    bass: 'pluckBass',
    pad: 'drone',
    arpPattern: 'up8',
    bassPattern: 'pulse',
    drums: [
      { inst: 'kick', tier: 1, hits: 'x.......x.......', vel: 0.5 },
      { inst: 'taiko', tier: 2, hits: 'x.......x..x....', vel: 0.75 },
      { inst: 'tek', tier: 2, hits: '....x.......x...', vel: 0.5 },
      { inst: 'doum', tier: 3, hits: '......x.......x.', vel: 0.7 },
      { inst: 'shaker', tier: 3, hits: 'x.x.x.x.x.x.x.x.', vel: 0.55 },
    ],
    fill: { inst: 'taiko', tier: 2, hits: '........x.x.xxxx', vel: 0.6 },
    swing: 0,
    space: [3.8, 0.55],
    chime: 'marimba',
  },
};
