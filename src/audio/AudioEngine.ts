import type { LevelDef } from '../config/levels';
import { Rng } from '../engine/rng';
import { AMBIENCE, Ambience } from './Ambience';
import { reverbImpulse } from './dsp';
import { MusicDirector, type MusicScene } from './MusicDirector';
import { NoteCache } from './notes';
import { Sfx } from './Sfx';

type AudioContextCtor = typeof AudioContext;

/** Semitones from C to the key's tonic, folded into -5..+6 so pitch-shifted sounds stay natural. */
const keyShift = (root: number): number => {
  const pc = ((root % 12) + 12) % 12;
  return pc > 6 ? pc - 12 : pc;
};

/**
 * Owns the AudioContext and the mixer:
 *   music -> pause muffle -> duck ─┐
 *   world sfx + ambience -> underwater tone (+ biome reverb) ─┤-> glue compressor -> limiter
 *   ui ─┘
 * The context is created on the first user gesture.
 */
export class AudioEngine {
  readonly sfx = new Sfx();
  readonly music = new MusicDirector();
  readonly ambience = new Ambience();
  private ctx: AudioContext | null = null;
  private notes: NoteCache | null = null;
  private musicBus: GainNode | null = null;
  private musicMuffle!: BiquadFilterNode;
  private musicDuck!: GainNode;
  private worldBus: GainNode | null = null;
  private worldMuffle!: BiquadFilterNode;
  private worldVerb!: ConvolverNode;
  private worldWet!: GainNode;
  private uiBus: GainNode | null = null;
  private volumes = { music: 0.6, sfx: 0.8 };
  private biome: LevelDef['biome'] | null = null;
  private paused = false;
  private duck = { until: 0, depth: 0 };

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
      return;
    }
    const Ctor: AudioContextCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    void ctx.resume();

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    limiter.connect(ctx.destination);
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.knee.value = 10;
    glue.ratio.value = 2.5;
    glue.attack.value = 0.006;
    glue.release.value = 0.25;
    glue.connect(limiter);

    this.musicBus = ctx.createGain();
    this.musicMuffle = ctx.createBiquadFilter();
    this.musicMuffle.type = 'lowpass';
    this.musicMuffle.frequency.value = 18000;
    this.musicMuffle.Q.value = 0.5;
    this.musicDuck = ctx.createGain();
    this.musicBus.connect(this.musicMuffle).connect(this.musicDuck).connect(glue);

    // World sounds are heard through water: highs rolled off a little, and a biome-sized room.
    this.worldBus = ctx.createGain();
    const tone = ctx.createBiquadFilter();
    tone.type = 'highshelf';
    tone.frequency.value = 4500;
    tone.gain.value = -5;
    this.worldMuffle = ctx.createBiquadFilter();
    this.worldMuffle.type = 'lowpass';
    this.worldMuffle.frequency.value = 18000;
    this.worldMuffle.Q.value = 0.5;
    this.worldBus.connect(tone).connect(this.worldMuffle).connect(glue);
    this.worldVerb = ctx.createConvolver();
    this.worldWet = ctx.createGain();
    this.worldWet.gain.value = 0.2;
    this.worldMuffle.connect(this.worldVerb).connect(this.worldWet).connect(glue);
    this.setSpace(2, 0.2);

    this.uiBus = ctx.createGain();
    this.uiBus.connect(glue);

    this.applyVolumes();
    this.notes = new NoteCache(ctx);
    this.music.init(ctx, this.musicBus, this.notes);
    this.sfx.init(ctx, this.worldBus, this.uiBus);
    this.ambience.init(ctx, this.worldBus);
    if (this.biome) this.setBiome(this.biome);
  }

  /** Starts a level's song and soundscape. */
  playLevel(level: LevelDef, scene: MusicScene): void {
    this.music.play({ mood: level.music, biome: level.biome, seed: level.seed }, scene);
    const shift = keyShift(level.music.root);
    this.sfx.keyShift = shift;
    this.ambience.keyShift = shift;
    this.ambience.set(level.biome, scene === 'title' ? 0.7 : 1);
    this.setBiome(level.biome);
  }

  private setBiome(biome: LevelDef['biome']): void {
    const changed = biome !== this.biome;
    this.biome = biome;
    if (this.ctx && (changed || !this.worldVerb.buffer)) this.setSpace(...AMBIENCE[biome].space);
  }

  private setSpace(seconds: number, wet: number): void {
    const ctx = this.ctx!;
    const [l, r] = reverbImpulse(ctx.sampleRate, seconds, new Rng(Math.round(seconds * 100)), 0.6);
    const buf = ctx.createBuffer(2, l.length, ctx.sampleRate);
    buf.getChannelData(0).set(l);
    buf.getChannelData(1).set(r);
    this.worldVerb.buffer = buf;
    this.worldWet.gain.setTargetAtTime(wet, ctx.currentTime, 0.3);
  }

  setVolumes(music: number, sfx: number): void {
    this.volumes = { music, sfx };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || !this.worldBus || !this.uiBus) return;
    const now = ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(this.volumes.music * this.volumes.music * 1.1, now, 0.05);
    this.worldBus.gain.setTargetAtTime(this.volumes.sfx * this.volumes.sfx * 0.6, now, 0.05);
    this.uiBus.gain.setTargetAtTime(this.volumes.sfx * this.volumes.sfx * 0.6, now, 0.05);
  }

  /** Paused: music and world sounds sink behind a low-pass, as if heard from further away. */
  muffle(on: boolean): void {
    this.paused = on;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.musicMuffle.frequency.setTargetAtTime(on ? 700 : 18000, now, on ? 0.12 : 0.3);
    this.musicDuck.gain.setTargetAtTime(on ? 0.6 : 1, now, 0.15);
    this.worldMuffle.frequency.setTargetAtTime(on ? 600 : 18000, now, on ? 0.12 : 0.3);
  }

  /** Dips the music under a big moment, then lets it swell back. A shallower dip never cuts a deeper one short. */
  duckMusic(depth: number, seconds: number, release = 0.5): void {
    if (!this.ctx || this.paused) return;
    const g = this.musicDuck.gain;
    const now = this.ctx.currentTime;
    if (now < this.duck.until && depth < this.duck.depth) return;
    this.duck = { until: now + seconds, depth };
    g.cancelScheduledValues(now);
    g.setTargetAtTime(1 - depth, now, 0.015);
    g.setTargetAtTime(1, now + seconds, release);
  }

  /** A note on the song's own scale for every bite, climbing with the combo. */
  comboChime(combo: number, pan: number): void {
    if (!this.notes || !this.running) return;
    const midi = this.music.ladder(Math.max(0, combo - 1));
    this.sfx.playBuffer(this.notes.get(this.music.chime, midi), { volume: 0.2 + Math.min(combo, 12) * 0.012, pan, delay: 0.025 });
  }

  suspend(): void {
    if (this.ctx?.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  update(dt: number, ambient: boolean): void {
    this.music.update(dt);
    if (ambient) this.ambience.update(dt);
    this.sfx.pump(2);
  }
}
