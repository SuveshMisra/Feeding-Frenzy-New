import { isDrum, renderNote, type InstrumentId } from './instruments';

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * Lazily rendered instrument samples, one buffer per (instrument, note, take). Notes a song will
 * need are queued up front and rendered a few at a time so loading never stalls a frame.
 */
export class NoteCache {
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly queue: [InstrumentId, number, number][] = [];

  constructor(private readonly ctx: BaseAudioContext) {}

  takes(id: InstrumentId): number {
    return isDrum(id) ? 3 : 1;
  }

  get(id: InstrumentId, midi: number, take = 0): AudioBuffer {
    const key = `${id}:${midi}:${take}`;
    let buf = this.buffers.get(key);
    if (!buf) {
      const samples = renderNote(id, midi, this.ctx.sampleRate, (hash(id) + midi * 7919 + take * 104729) >>> 0);
      buf = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
      buf.getChannelData(0).set(samples);
      this.buffers.set(key, buf);
    }
    return buf;
  }

  /** Drops pitched notes outside `keep` ("id:midi" keys) so visiting many levels doesn't pile up buffers. */
  retain(keep: Set<string>): void {
    for (const key of this.buffers.keys()) {
      const [id, midi] = key.split(':');
      if (!isDrum(id as InstrumentId) && !keep.has(`${id}:${midi}`)) this.buffers.delete(key);
    }
  }

  want(id: InstrumentId, midi: number): void {
    for (let t = 0; t < this.takes(id); t++) if (!this.buffers.has(`${id}:${midi}:${t}`)) this.queue.push([id, midi, t]);
  }

  /** Renders queued notes until `budgetMs` has passed. */
  pump(budgetMs: number): void {
    const end = performance.now() + budgetMs;
    while (this.queue.length && performance.now() < end) {
      const [id, midi, take] = this.queue.shift()!;
      this.get(id, midi, take);
    }
  }
}
