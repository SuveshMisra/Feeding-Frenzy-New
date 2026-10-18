import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/config/levels';
import { compose, noteAt } from '../src/audio/composer';
import { renderNote, type InstrumentId } from '../src/audio/instruments';
import { SOUND_DEFS, buildSound, type SoundName } from '../src/audio/sounds';
import { STYLES } from '../src/audio/styles';
import { midiHz } from '../src/audio/dsp';

const SR = 48000;
const peak = (s: Float32Array) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** Fundamental by autocorrelation over a window after the attack. */
function pitchOf(s: Float32Array, from = 0.06, len = 0.12): number {
  const a = Math.floor(from * SR);
  const n = Math.floor(len * SR);
  const lo = Math.floor(SR / 2000);
  const corr = new Float64Array(Math.ceil(SR / 40));
  let best = 0;
  for (let lag = lo; lag < corr.length; lag++) {
    let c = 0;
    for (let i = a; i < a + n; i++) c += s[i] * s[i + lag];
    corr[lag] = c;
    best = Math.max(best, c);
  }
  // The first strong peak is the period; later ones are its multiples.
  for (let lag = lo + 1; lag < corr.length - 1; lag++) {
    const c = corr[lag];
    if (c > best * 0.85 && c >= corr[lag - 1] && c >= corr[lag + 1]) {
      const shift = (corr[lag - 1] - corr[lag + 1]) / (2 * (corr[lag - 1] - 2 * c + corr[lag + 1]));
      return SR / (lag + shift);
    }
  }
  return 0;
}

const PITCHED: InstrumentId[] = ['marimba', 'kalimba', 'glock', 'steelpan', 'bell', 'ep', 'harp', 'koto', 'nylon', 'pluckBass', 'subBass'];
const DRUMS: InstrumentId[] = ['kick', 'shaker', 'rim', 'woodblock', 'congaLow', 'congaHigh', 'taiko', 'doum', 'tek', 'glassTap', 'brush', 'swell', 'drop'];

describe('Instruments', () => {
  it('renders finite notes under full scale that end quietly', () => {
    for (const id of [...PITCHED, ...DRUMS]) {
      for (const midi of [36, 60, 84]) {
        const s = renderNote(id, midi, SR, 5);
        expect(s.every(Number.isFinite), id).toBe(true);
        expect(peak(s), id).toBeGreaterThan(0.3);
        expect(peak(s), id).toBeLessThanOrEqual(0.951);
        expect(Math.abs(s[s.length - 1]), id).toBeLessThan(0.01);
      }
    }
  });

  it('is deterministic per seed', () => {
    expect(renderNote('harp', 60, SR, 9)).toEqual(renderNote('harp', 60, SR, 9));
    expect(renderNote('shaker', 60, SR, 9)).not.toEqual(renderNote('shaker', 60, SR, 10));
  });

  it('plays in tune, including the plucked strings', () => {
    for (const id of ['marimba', 'kalimba', 'steelpan', 'ep', 'harp', 'koto', 'nylon'] as const) {
      for (const midi of [55, 62, 69, 74]) {
        const f = pitchOf(renderNote(id, midi, SR, 3));
        const cents = 1200 * Math.log2(f / midiHz(midi));
        expect(Math.abs(cents), `${id} ${midi}: ${f.toFixed(1)} Hz`).toBeLessThan(15);
      }
    }
  });
});

describe('Sound effects', () => {
  it('builds every take finite, normalized and click-free', () => {
    for (const name of Object.keys(SOUND_DEFS) as SoundName[]) {
      const takes = buildSound(name, SR);
      expect(takes.length).toBe(SOUND_DEFS[name].takes);
      for (const s of takes) {
        expect(s.every(Number.isFinite), name).toBe(true);
        expect(peak(s), name).toBeGreaterThan(0.85);
        expect(peak(s), name).toBeLessThanOrEqual(0.901);
        expect(Math.abs(s[s.length - 1]), name).toBeLessThan(0.01);
        expect(s.length / SR, name).toBeLessThan(4);
      }
    }
  });

  it('varies between takes', () => {
    const [a, b] = buildSound('bubble', SR);
    expect(a).not.toEqual(b);
  });
});

describe('Composer', () => {
  it('is deterministic per seed and loops whole bars', () => {
    const lv = LEVELS[0];
    const a = compose(lv.music, STYLES[lv.biome], lv.seed);
    expect(compose(lv.music, STYLES[lv.biome], lv.seed)).toEqual(a);
    expect(compose(lv.music, STYLES[lv.biome], lv.seed + 1)).not.toEqual(a);
    expect(a.steps % 16).toBe(0);
    expect(a.sections.map((s) => s.name)).toEqual(['A', 'B', 'A2', 'C']);
  });

  it('writes every level a song in its own key with melody, bass, arpeggio and drums', () => {
    for (const lv of LEVELS) {
      const m = lv.music;
      const song = compose(m, STYLES[lv.biome], lv.seed);
      const pcs = new Set(m.scale.map((x) => (m.root + x) % 12));
      const layers = new Set<string>();
      for (const evs of song.byStep) {
        for (const e of evs) {
          layers.add(e.layer);
          expect(e.vel, lv.id).toBeGreaterThan(0);
          expect(e.vel, lv.id).toBeLessThan(1.2);
          if (e.layer.startsWith('perc')) continue;
          expect(pcs.has(((e.midi % 12) + 12) % 12), `${lv.id} ${e.layer} ${e.midi}`).toBe(true);
          if (e.layer === 'lead') {
            expect(e.midi, lv.id).toBeGreaterThanOrEqual(m.root - 3);
            expect(e.midi, lv.id).toBeLessThanOrEqual(m.root + 33);
          }
          if (e.layer === 'bass') expect(e.midi, lv.id).toBeLessThanOrEqual(m.root);
        }
      }
      for (const l of ['lead', 'bass', 'arp', 'counter', 'perc1', 'perc2']) expect(layers.has(l), `${lv.id} ${l}`).toBe(true);
      for (const c of song.chords) for (const t of c.tones) expect(pcs.has(t % 12), lv.id).toBe(true);
    }
  });

  it('lands the melody on chord tones on the downbeats of the theme', () => {
    const lv = LEVELS[1];
    const m = lv.music;
    const song = compose(m, STYLES[lv.biome], lv.seed);
    const a = song.sections[0];
    let checked = 0;
    for (let s = a.step; s < a.step + a.steps; s += 8) {
      const chord = song.chords.find((c) => c.step <= s && s < c.step + c.steps)!;
      const tones = new Set([0, 2, 4].map((d) => noteAt(m, chord.degree + d) % 12));
      for (const e of song.byStep[s]) {
        if (e.layer !== 'lead') continue;
        expect(tones.has(e.midi % 12), `step ${s}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(4);
  });
});
