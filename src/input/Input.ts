import type { ControlScheme } from '../app/Save';
import { TouchJoystick } from './TouchJoystick';

export type InputCommand =
  | { kind: 'none' }
  /** Screen-space point (CSS px) the fish should swim toward. */
  | { kind: 'target'; sx: number; sy: number }
  /** Unit direction (y up) with magnitude 0..1. */
  | { kind: 'direction'; x: number; y: number; mag: number };

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class Input {
  readonly joystick: TouchJoystick;
  scheme: ControlScheme = 'follow';
  /** True once any touch has been seen; switches the UI into touch mode. */
  touchSeen = false;
  enabled = true;
  onPause: (() => void) | null = null;
  onAnyInput: (() => void) | null = null;

  private readonly keys = new Set<string>();
  private pointerX = 0;
  private pointerY = 0;
  private pointerInside = false;
  private mode: 'pointer' | 'keys' | 'touch' = 'pointer';
  private moveAccum = 0;
  private boostQueued = false;

  constructor(private readonly surface: HTMLElement, uiLayer: HTMLElement) {
    this.joystick = new TouchJoystick(uiLayer);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
    surface.addEventListener('pointermove', this.onPointerMove);
    surface.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    surface.addEventListener('pointerleave', this.onPointerLeave);
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get usingTouch(): boolean {
    return this.mode === 'touch';
  }

  read(): InputCommand {
    if (!this.enabled) return { kind: 'none' };
    let kx = 0;
    let ky = 0;
    for (const code of this.keys) {
      const v = MOVE_KEYS[code];
      if (v) {
        kx += v[0];
        ky += v[1];
      }
    }
    if (kx !== 0 || ky !== 0) {
      const d = Math.hypot(kx, ky);
      return { kind: 'direction', x: kx / d, y: ky / d, mag: 1 };
    }
    if (this.mode === 'touch') {
      const j = this.joystick;
      if (j.active && j.mag > 0) return { kind: 'direction', x: j.x, y: j.y, mag: j.mag };
      return { kind: 'none' };
    }
    if (this.mode === 'pointer' && this.pointerInside && this.scheme === 'follow') {
      return { kind: 'target', sx: this.pointerX, sy: this.pointerY };
    }
    return { kind: 'none' };
  }

  /** Queues a boost: left click, Space, a second finger or the HUD boost button. */
  requestBoost(): void {
    if (this.enabled) this.boostQueued = true;
  }

  /** True once per queued boost; the world drains it every simulation step. */
  consumeBoost(): boolean {
    const queued = this.boostQueued;
    this.boostQueued = false;
    return queued;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (!e.repeat) this.onPause?.();
      return;
    }
    if (MOVE_KEYS[e.code]) {
      this.keys.add(e.code);
      this.mode = 'keys';
      this.moveAccum = 0;
      if (e.code.startsWith('Arrow')) e.preventDefault();
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) this.requestBoost();
    }
    this.onAnyInput?.();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.joystick.move(e.pointerId, e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - this.pointerX;
    const dy = e.clientY - this.pointerY;
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
    this.pointerInside = true;
    if (this.mode !== 'pointer') {
      // Require a deliberate mouse move before leaving keyboard mode.
      this.moveAccum += Math.hypot(dx, dy);
      if (this.moveAccum > 24) this.mode = 'pointer';
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.onAnyInput?.();
    if (e.pointerType === 'touch') {
      this.touchSeen = true;
      this.mode = 'touch';
      document.body.classList.add('touch');
      if (!this.enabled || (e.target as HTMLElement).closest('button, .screen, .panel')) return;
      if (!this.joystick.active) this.joystick.start(e.pointerId, e.clientX, e.clientY);
      else this.requestBoost();
      this.surface.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
    this.pointerInside = true;
    // Keyboard players click to boost too; only a deliberate mouse move hands steering back to the cursor.
    if (this.mode !== 'keys') this.mode = 'pointer';
    if (e.button === 0) this.requestBoost();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') this.joystick.end(e.pointerId);
  };

  private onPointerLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') this.pointerInside = false;
  };

  readonly clear = (): void => {
    this.keys.clear();
    this.joystick.reset();
    this.boostQueued = false;
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  }
}
