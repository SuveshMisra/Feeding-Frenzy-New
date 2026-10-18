import { SOUND_DEFS, buildSound, type SoundDef, type SoundName } from './sounds';

export type { SoundName };

export interface PlayOptions {
  pan?: number;
  pitch?: number;
  volume?: number;
  /** Seconds from now. */
  delay?: number;
}

/** Plays the procedural sound library; sounds are rendered on first use or while idle. */
export class Sfx {
  private ctx: BaseAudioContext | null = null;
  private world: AudioNode | null = null;
  private ui: AudioNode | null = null;
  private readonly buffers = new Map<SoundName, AudioBuffer[]>();
  private readonly lastPlayed = new Map<SoundName, number>();
  private readonly lastTake = new Map<SoundName, number>();
  private readonly queue = Object.keys(SOUND_DEFS) as SoundName[];
  private voices = 0;
  /** Semitones tonal sounds are shifted by to sit in the music's key. */
  keyShift = 0;

  init(ctx: BaseAudioContext, world: AudioNode, ui: AudioNode): void {
    this.ctx = ctx;
    this.world = world;
    this.ui = ui;
  }

  /** Renders queued sounds until `budgetMs` has passed. */
  pump(budgetMs: number): void {
    const end = performance.now() + budgetMs;
    while (this.queue.length && performance.now() < end) this.takes(this.queue.shift()!);
  }

  private takes(name: SoundName): AudioBuffer[] {
    let takes = this.buffers.get(name);
    if (!takes) {
      const ctx = this.ctx!;
      takes = buildSound(name, ctx.sampleRate).map((samples) => {
        const b = ctx.createBuffer(1, samples.length, ctx.sampleRate);
        b.getChannelData(0).set(samples);
        return b;
      });
      this.buffers.set(name, takes);
    }
    return takes;
  }

  play(name: SoundName, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.world || ctx.state !== 'running') return;
    const def: SoundDef = SOUND_DEFS[name];
    const now = ctx.currentTime;
    const at = now + (opts.delay ?? 0);
    if (Math.abs(at - (this.lastPlayed.get(name) ?? -1)) < (def.gap ?? 0.02) || this.voices > 32) return;
    this.lastPlayed.set(name, at);
    const takes = this.takes(name);
    let take = Math.floor(Math.random() * takes.length);
    if (takes.length > 1 && take === this.lastTake.get(name)) take = (take + 1) % takes.length;
    this.lastTake.set(name, take);
    this.start(takes[take], def.bus === 'ui' ? this.ui! : this.world, at, {
      pitch: (opts.pitch ?? 1) * (def.tonal ? Math.pow(2, this.keyShift / 12) : 1),
      volume: (opts.volume ?? 1) * def.gain,
      pan: opts.pan ?? 0,
    });
  }

  /** Plays an arbitrary buffer (instrument notes) on the world bus. */
  playBuffer(buffer: AudioBuffer, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.world || ctx.state !== 'running' || this.voices > 32) return;
    this.start(buffer, this.world, ctx.currentTime + (opts.delay ?? 0), { pitch: opts.pitch ?? 1, volume: opts.volume ?? 1, pan: opts.pan ?? 0 });
  }

  private start(buffer: AudioBuffer, out: AudioNode, at: number, o: { pitch: number; volume: number; pan: number }): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = o.pitch;
    const gain = ctx.createGain();
    gain.gain.value = o.volume;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, o.pan));
    src.connect(panner).connect(gain).connect(out);
    this.voices++;
    src.onended = () => {
      this.voices--;
      gain.disconnect();
    };
    src.start(at);
  }
}
