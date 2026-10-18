import type GUI from 'lil-gui';
import type { WebGLRenderer } from 'three';

export const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

interface StatsLike {
  dom: HTMLElement;
  begin(): void;
  end(): void;
  update(): void;
}

/** Tuning sliders, cheats and frame stats. Only loaded with `?debug` in the URL. */
export class DebugPanel {
  private constructor(
    readonly gui: GUI,
    private readonly stats: StatsLike | null,
  ) {}

  static async create(renderer: WebGLRenderer): Promise<DebugPanel | null> {
    if (!DEBUG) return null;
    const [{ default: GUIClass }, { default: Stats }] = await Promise.all([import('lil-gui'), import('stats-gl')]);
    const gui = new GUIClass({ title: 'Fin Frenzy debug', width: 290 });
    gui.domElement.style.zIndex = '1000';
    gui.domElement.addEventListener('pointerdown', (e) => e.stopPropagation());
    let stats: StatsLike | null = null;
    try {
      const s = new Stats({ trackGPU: true, horizontal: true, logsPerSecond: 4, graphsPerSecond: 30, precision: 2 });
      s.dom.style.zIndex = '1000';
      document.body.appendChild(s.dom);
      await s.init(renderer);
      stats = s as unknown as StatsLike;
    } catch (err) {
      console.warn('stats-gl unavailable', err);
    }
    return new DebugPanel(gui, stats);
  }

  folder(name: string): GUI {
    return this.gui.addFolder(name);
  }

  begin(): void {
    this.stats?.begin();
  }

  end(): void {
    this.stats?.end();
    this.stats?.update();
  }
}
