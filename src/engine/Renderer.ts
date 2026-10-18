import { NoToneMapping, PCFSoftShadowMap, SRGBColorSpace, WebGLRenderer } from 'three';

export type ResizeHandler = (width: number, height: number, dpr: number) => void;

export class Renderer {
  readonly gl: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  width = 1;
  height = 1;
  dpr = 1;
  private maxDpr = 2;
  private supersample = 1;
  private handlers = new Set<ResizeHandler>();

  constructor(container: HTMLElement) {
    this.gl = new WebGLRenderer({
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = NoToneMapping;
    this.gl.shadowMap.enabled = false;
    this.gl.shadowMap.type = PCFSoftShadowMap;
    this.gl.setClearColor(0x04304a, 1);
    this.canvas = this.gl.domElement;
    this.canvas.id = 'game-canvas';
    container.appendChild(this.canvas);

    window.addEventListener('resize', this.resize);
    window.visualViewport?.addEventListener('resize', this.resize);
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      document.body.classList.add('context-lost');
    });
    this.resize();
  }

  setMaxDpr(value: number, supersample = 1): void {
    this.maxDpr = value;
    this.supersample = supersample;
    this.resize();
  }

  onResize(handler: ResizeHandler): () => void {
    this.handlers.add(handler);
    handler(this.width, this.height, this.dpr);
    return () => this.handlers.delete(handler);
  }

  readonly resize = (): void => {
    const w = Math.max(1, Math.floor(window.innerWidth));
    const h = Math.max(1, Math.floor(window.innerHeight));
    this.width = w;
    this.height = h;
    this.dpr = Math.min((window.devicePixelRatio || 1) * this.supersample, this.maxDpr);
    this.gl.setPixelRatio(this.dpr);
    this.gl.setSize(w, h);
    for (const fn of this.handlers) fn(w, h, this.dpr);
  };
}
