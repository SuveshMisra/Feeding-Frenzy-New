/** Floating thumbstick: appears where the finger lands, reports a direction and magnitude. */
export class TouchJoystick {
  readonly el: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  active = false;
  x = 0;
  y = 0;
  mag = 0;
  private id = -1;
  private ox = 0;
  private oy = 0;
  radius = 58;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'joystick';
    this.knob = document.createElement('div');
    this.knob.className = 'joystick-knob';
    this.el.appendChild(this.knob);
    parent.appendChild(this.el);
  }

  owns(pointerId: number): boolean {
    return this.active && pointerId === this.id;
  }

  start(pointerId: number, x: number, y: number): void {
    this.active = true;
    this.id = pointerId;
    this.ox = x;
    this.oy = y;
    this.x = 0;
    this.y = 0;
    this.mag = 0;
    this.el.style.transform = `translate(${x}px, ${y}px)`;
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.el.classList.add('visible');
  }

  move(pointerId: number, x: number, y: number): void {
    if (!this.owns(pointerId)) return;
    let dx = x - this.ox;
    let dy = y - this.oy;
    const d = Math.hypot(dx, dy);
    const r = this.radius;
    if (d > r) {
      // Drag the base along so the stick never feels stuck at the rim.
      const over = d - r;
      this.ox += (dx / d) * over;
      this.oy += (dy / d) * over;
      dx = x - this.ox;
      dy = y - this.oy;
      this.el.style.transform = `translate(${this.ox}px, ${this.oy}px)`;
    }
    const dd = Math.hypot(dx, dy);
    const dead = 6;
    this.mag = dd < dead ? 0 : Math.min(1, (dd - dead) / (r - dead));
    this.x = dd > 0 ? dx / dd : 0;
    this.y = dd > 0 ? -dy / dd : 0;
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  end(pointerId: number): void {
    if (!this.owns(pointerId)) return;
    this.active = false;
    this.id = -1;
    this.mag = 0;
    this.el.classList.remove('visible');
  }

  reset(): void {
    this.active = false;
    this.id = -1;
    this.mag = 0;
    this.el.classList.remove('visible');
  }
}
