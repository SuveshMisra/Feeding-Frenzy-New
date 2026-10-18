import type { MusicMood } from '../config/levels';
import { Rng } from '../engine/rng';
import type { InstrumentId } from './instruments';
import type { DrumLine, MusicStyle } from './styles';

export type Layer = 'bass' | 'arp' | 'lead' | 'counter' | 'perc1' | 'perc2' | 'perc3';

export interface NoteEvent {
  layer: Layer;
  inst: InstrumentId;
  midi: number;
  vel: number;
  /** Length in sixteenths. */
  dur: number;
}

export interface ChordSpan {
  step: number;
  steps: number;
  /** Pad voicing as MIDI notes. */
  tones: number[];
  degree: number;
}

export type SectionName = 'A' | 'B' | 'A2' | 'C';

export interface Section {
  name: SectionName;
  step: number;
  steps: number;
}

export interface Song {
  steps: number;
  byStep: NoteEvent[][];
  chords: ChordSpan[];
  sections: Section[];
}

/** Sixteenths per chord: every chord lasts two bars. */
const CHORD = 32;
const ORDER: SectionName[] = ['A', 'B', 'A2', 'C'];

/** Two-bar rhythms as [onset, length] in sixteenths. */
const RHYTHMS: [number, number][][] = [
  [
    [0, 3],
    [4, 2],
    [6, 2],
    [8, 4],
    [12, 4],
    [16, 6],
    [22, 2],
    [24, 8],
  ],
  [
    [0, 2],
    [2, 2],
    [4, 4],
    [8, 2],
    [10, 6],
    [16, 4],
    [20, 4],
    [24, 8],
  ],
  [
    [0, 6],
    [6, 2],
    [8, 4],
    [12, 2],
    [14, 2],
    [16, 8],
    [24, 4],
    [28, 4],
  ],
  [
    [0, 4],
    [4, 4],
    [8, 8],
    [16, 4],
    [20, 2],
    [22, 2],
    [24, 8],
  ],
  [
    [2, 2],
    [4, 4],
    [8, 2],
    [10, 2],
    [12, 4],
    [16, 8],
    [26, 6],
  ],
  [
    [0, 3],
    [3, 3],
    [6, 2],
    [8, 6],
    [16, 3],
    [19, 3],
    [22, 2],
    [24, 8],
  ],
];

export function noteAt(m: MusicMood, deg: number): number {
  const n = m.scale.length;
  const oct = Math.floor(deg / n);
  return m.root + m.scale[((deg % n) + n) % n] + 12 * oct;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

function isChordTone(deg: number, chord: number, n: number): boolean {
  const r = mod(deg - chord, n);
  return r === 0 || r === 2 || r === 4;
}

function nearestChordTone(deg: number, chord: number, n: number): number {
  for (let d = 0; d <= n; d++) {
    if (isChordTone(deg - d, chord, n)) return deg - d;
    if (isChordTone(deg + d, chord, n)) return deg + d;
  }
  return deg;
}

interface MotifNote {
  on: number;
  dur: number;
  deg: number;
}

/** A two-bar melodic cell: mostly stepwise, with a direction that occasionally turns. */
function makeMotif(rng: Rng): MotifNote[] {
  const rhythm = rng.pick(RHYTHMS);
  let deg = 0;
  let dir: number = rng.sign();
  return rhythm.map(([on, dur], i) => {
    if (i > 0) {
      const r = rng.next();
      const size = r < 0.45 ? 1 : r < 0.75 ? 2 : r < 0.87 ? 0 : 3;
      if (rng.chance(0.28)) dir = -dir;
      deg += dir * size;
      if (deg > 5 || deg < -3) {
        dir = -dir;
        deg += 2 * dir * size;
      }
    }
    return { on, dur, deg };
  });
}

export function compose(m: MusicMood, style: MusicStyle, seed: number): Song {
  const rng = new Rng(seed * 7 + 13);
  const n = m.scale.length;
  const prog = m.progression;
  const sectionSteps = prog.length * CHORD;
  const steps = sectionSteps * ORDER.length;
  const byStep: NoteEvent[][] = Array.from({ length: steps }, () => []);
  const sixteenth = 60 / m.tempo / 4;
  const add = (step: number, e: NoteEvent): void => {
    if (step >= 0 && step < steps) byStep[step].push(e);
  };

  const lowest = m.root - 3;
  const highest = m.root + 33;
  const center = Math.round(n * 0.75);
  const anchorFor = (chord: number): number => {
    let a = chord;
    while (a < center - n / 2) a += n;
    while (a > center + n / 2) a -= n;
    return a;
  };

  /** Places motif notes over one chord; strong beats land on chord tones. */
  const phrase = (s0: number, chord: number, notes: MotifNote[], layer: Layer, inst: InstrumentId, octave: number, vel: number): void => {
    const anchor = anchorFor(chord);
    let degs = notes.map((nt) => {
      const d = anchor + nt.deg;
      return nt.on % 8 === 0 ? nearestChordTone(d, chord, n) : d;
    });
    const last = notes.length - 1;
    if (notes[last].dur >= 6) degs[last] = nearestChordTone(degs[last], chord, n);
    const midis = (ds: number[]): number[] => ds.map((d) => noteAt(m, d) + 12 * octave);
    let ms = midis(degs);
    if (octave === 1 && Math.max(...ms) > highest) ms = midis((degs = degs.map((d) => d - n)));
    if (octave === 1 && Math.min(...ms) < lowest) ms = midis((degs = degs.map((d) => d + n)));
    notes.forEach((nt, i) => {
      const accent = nt.on % 8 === 0 ? 1 : nt.on % 4 === 0 ? 0.9 : 0.8;
      add(s0 + nt.on, { layer, inst, midi: ms[i], vel: vel * accent * rng.range(0.92, 1.05), dur: nt.dur });
    });
  };

  const motif = makeMotif(rng);
  const answer = makeMotif(rng);
  const inverted = motif.map((nt) => ({ ...nt, deg: -nt.deg }));
  const cadence: MotifNote[] = [...answer.filter((nt) => nt.on < 16), { on: 16, dur: 16, deg: 0 }];
  const sevenths = prog.map(() => n === 7 && rng.chance(0.5));

  const chords: ChordSpan[] = [];
  const sections = ORDER.map((name, si) => ({ name, step: si * sectionSteps, steps: sectionSteps }));

  for (const sec of sections) {
    prog.forEach((chord, k) => {
      const s0 = sec.step + k * CHORD;
      const lastChord = k === prog.length - 1;
      const next = prog[(k + 1) % prog.length];

      // Pads
      const degs = [chord, chord + 2, chord + 4];
      if (sevenths[k]) degs.push(chord + 6);
      const tones = degs.map((d, i) => {
        let note = noteAt(m, d) - (i === 0 ? 12 : 0);
        while (note > m.root + 12) note -= 12;
        return note;
      });
      chords.push({ step: s0, steps: CHORD, tones, degree: chord });

      // Melody
      if (sec.name === 'A' || sec.name === 'A2') {
        phrase(s0, chord, lastChord ? cadence : motif, 'lead', style.lead, 1, 0.85);
        if (sec.name === 'A2') {
          // Harmony a chord tone below, only on the longer notes.
          const longs = (lastChord ? cadence : motif).filter((nt) => nt.dur >= 4).map((nt) => ({ ...nt, deg: nt.deg - 2 }));
          phrase(s0, chord, longs, 'counter', style.arp, 1, 0.42);
        }
      } else if (sec.name === 'B') {
        if (k % 2 === 0) phrase(s0, chord, inverted, 'lead', style.lead, 1, 0.75);
        else phrase(s0, chord, lastChord ? cadence : motif, 'counter', style.arp, 0, 0.7);
      } else {
        const top = nearestChordTone(anchorFor(chord) + 2, chord, n);
        add(s0, { layer: 'lead', inst: style.lead, midi: noteAt(m, top) + 12, vel: 0.55, dur: 24 });
        add(s0 + 24, { layer: 'lead', inst: style.lead, midi: noteAt(m, top - 1) + 12, vel: 0.42, dur: 8 });
      }

      // Arpeggio
      const arpTones = [chord, chord + 2, chord + 4, chord + n, chord + n + 2].map((d) => {
        let note = noteAt(m, d);
        while (note > m.root + 21) note -= 12;
        return note;
      });
      const density = Math.min(1, Math.max(0.3, m.pluckDensity)) * (sec.name === 'C' ? 0.55 : 1);
      const arpAt = (step: number, idx: number, strong: boolean): void => {
        if (!strong && !rng.chance(density)) return;
        add(s0 + step, { layer: 'arp', inst: style.arp, midi: arpTones[idx % arpTones.length], vel: (strong ? 0.8 : 0.58) * rng.range(0.9, 1.08), dur: 4 });
      };
      switch (style.arpPattern) {
        case 'up8':
          for (let s = 0; s < CHORD; s += 2) arpAt(s, (s / 2) % 4, s % 8 === 0);
          break;
        case 'updown8': {
          const seq = [0, 1, 2, 3, 4, 3, 2, 1];
          for (let s = 0; s < CHORD; s += 2) arpAt(s, seq[(s / 2) % 8], s % 8 === 0);
          break;
        }
        case 'alberti8': {
          const seq = [0, 2, 1, 2];
          for (let s = 0; s < CHORD; s += 2) arpAt(s, seq[(s / 2) % 4], s % 8 === 0);
          break;
        }
        case 'broken16': {
          const seq = [0, 2, 1, 3, 2, 4, 3, 1];
          for (let s = 0; s < CHORD; s++) {
            if (s % 2 === 1 && !rng.chance(density * 0.45)) continue;
            arpAt(s, seq[s % 8], s % 8 === 0);
          }
          break;
        }
        case 'sparse':
          for (const s of [0, 6, 10, 16, 22, 26]) arpAt(s, rng.int(0, 4), s % 16 === 0);
          break;
      }

      // Bass
      const bassNote = (d: number): number => {
        let note = noteAt(m, d) - 24;
        while (note > m.root - 12) note -= 12;
        while (note < m.root - 26) note += 12;
        return note;
      };
      const root = bassNote(chord);
      const fifth = bassNote(chord + (n === 7 ? 4 : 3));
      const third = bassNote(chord + 2);
      const approach = bassNote(next + (rng.chance(0.5) ? -1 : 1));
      const b = (step: number, midi: number, dur: number, vel = 0.9): void =>
        add(s0 + step, { layer: 'bass', inst: style.bass, midi, vel: vel * rng.range(0.94, 1.04), dur });
      const pattern = sec.name === 'C' ? 'long' : style.bassPattern;
      switch (pattern) {
        case 'roots':
          b(0, root, 7);
          b(8, rng.chance(0.5) ? fifth : root, 6, 0.75);
          b(16, root, 7);
          b(26, approach, 5, 0.7);
          break;
        case 'island':
          for (const bar of [0, 16]) {
            b(bar, root, 3);
            b(bar + 6, root, 2, 0.7);
            b(bar + 8, fifth, 3, 0.8);
            b(bar + 14, bar === 16 ? approach : root + 12, 2, 0.6);
          }
          break;
        case 'pulse':
          for (let s = 0; s < CHORD; s += 2) b(s, s % 8 === 6 ? root + 12 : root, 2, s % 4 === 0 ? 0.9 : 0.6);
          break;
        case 'long':
          b(0, root, 28, 0.85);
          b(28, fifth, 4, 0.55);
          break;
        case 'walk':
          b(0, root, 4);
          b(4, third, 4, 0.75);
          b(8, fifth, 4, 0.8);
          b(12, third, 4, 0.7);
          b(16, root, 4);
          b(20, fifth, 4, 0.75);
          b(24, root + 12, 4, 0.8);
          b(28, approach, 4, 0.75);
          break;
      }
    });

    // Drums
    const bars = sec.steps / 16;
    for (let bar = 0; bar < bars; bar++) {
      const s0 = sec.step + bar * 16;
      const fillBar = bar === bars - 1 && sec.name !== 'C';
      const drumLines: DrumLine[] = sec.name === 'C' ? style.drums.filter((l) => l.tier === 1) : style.drums;
      for (const line of drumLines) {
        for (let i = 0; i < 16; i++) {
          const c = line.hits[i];
          if (c === '.' || c === undefined) continue;
          if (fillBar && line.tier > 1 && i >= 8) continue;
          drum(s0 + i, line, c, sec.name === 'C' ? 0.8 : 1);
        }
      }
      if (fillBar) for (let i = 8; i < 16; i++) if (style.fill.hits[i] !== '.') drum(s0 + i, style.fill, style.fill.hits[i], 1);
    }
    // A rising swell leads into every section after the first.
    add((sec.step || steps) - Math.round(1.75 / sixteenth), { layer: 'perc2', inst: 'swell', midi: 60, vel: 0.7, dur: 12 });
  }

  function drum(step: number, line: DrumLine, c: string, scale: number): void {
    const vel = (c === 'x' ? 1 : 0.5) * (line.vel ?? 1) * scale * rng.range(0.88, 1.05);
    add(step, { layer: `perc${line.tier}` as Layer, inst: line.inst, midi: 60, vel, dur: 1 });
  }

  return { steps, byStep, chords, sections };
}
