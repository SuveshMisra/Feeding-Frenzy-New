import { PerspectiveCamera, Vector2, Vector3 } from 'three';
import { createNoise2D } from 'simplex-noise';
import { CAMERA } from '../config/tuning';
import { clamp, damp } from '../engine/math';
import { Rng } from '../engine/rng';

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ViewRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Side-on follow camera for the z = 0 gameplay plane. Pulls back as the player grows,
 * leads the player's motion and clamps to the level bounds. Trauma-based shake.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  readonly center = new Vector2();
  viewH: number = CAMERA.viewHeightByStage[0];
  viewHTarget: number = CAMERA.viewHeightByStage[0];
  bounds: Bounds = { minX: -50, maxX: 50, minY: 0, maxY: 34 };
  shakeEnabled = true;
  /** Extra zoom multiplier for cinematic moments (1 = none). */
  zoomPunch = 1;
  private trauma = 0;
  private time = 0;
  private readonly noise = ((r) => createNoise2D(() => r.next()))(new Rng(9));
  private readonly tmp = new Vector3();
  private readonly lead = new Vector2();
  private readonly shakeOffset = new Vector3();
  private readonly shakeRot = new Vector3();
  /** Directional nudge (bites) that springs back to centre. */
  private readonly kickPos = new Vector2();
  private readonly kickVel = new Vector2();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(CAMERA.fov, aspect, 0.5, 420);
  }

  get distance(): number {
    return this.distanceFor(this.viewH * this.zoomPunch);
  }

  distanceFor(viewH: number): number {
    return viewH / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  get viewW(): number {
    return this.viewH * this.zoomPunch * this.camera.aspect;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** View height for a growth stage, widened on narrow (portrait) screens. */
  stageViewHeight(stageIndex: number): number {
    const base = CAMERA.viewHeightByStage[clamp(stageIndex, 0, 2)];
    const a = this.camera.aspect;
    if (a >= 1.2) return base;
    const minW = base * 1.2;
    return Math.min(base * 1.7, Math.max(base, minW / a));
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Jolts the view along (dx, dy); `strength` is the initial speed in world units per second. */
  kick(dx: number, dy: number, strength: number): void {
    const d = Math.hypot(dx, dy);
    if (d < 1e-4) return;
    this.kickVel.x += (dx / d) * strength;
    this.kickVel.y += (dy / d) * strength;
  }

  snap(x: number, y: number): void {
    this.viewH = this.viewHTarget;
    this.trauma = 0;
    this.kickPos.set(0, 0);
    this.kickVel.set(0, 0);
    this.zoomPunch = 1;
    this.lead.set(0, 0);
    this.center.set(x, y);
    this.clampCenter();
    this.apply(0);
  }

  update(dt: number, px: number, py: number, vx: number, vy: number): void {
    this.time += dt;
    this.viewH = damp(this.viewH, this.viewHTarget, 1.6, dt);
    this.lead.set(vx * CAMERA.lookAhead, vy * CAMERA.lookAhead * 0.6);
    const tx = px + this.lead.x;
    const ty = py + this.lead.y;
    this.center.x = damp(this.center.x, tx, CAMERA.followLambda, dt);
    this.center.y = damp(this.center.y, ty, CAMERA.followLambda * 0.8, dt);
    this.clampCenter();
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const kp = this.kickPos;
    const kv = this.kickVel;
    kv.x += (-kp.x * 260 - kv.x * 24) * dt;
    kv.y += (-kp.y * 260 - kv.y * 24) * dt;
    kp.x += kv.x * dt;
    kp.y += kv.y * dt;
    this.apply(dt);
  }

  /** Free camera drift for the title screen. */
  drift(dt: number, x: number, y: number): void {
    this.time += dt;
    this.viewH = damp(this.viewH, this.viewHTarget, 1.2, dt);
    this.center.x = damp(this.center.x, x, 0.8, dt);
    this.center.y = damp(this.center.y, y, 0.8, dt);
    this.clampCenter();
    this.apply(dt);
  }

  private clampCenter(): void {
    const h = this.viewH * this.zoomPunch;
    const w = h * this.camera.aspect;
    const b = this.bounds;
    const minX = b.minX + w / 2;
    const maxX = b.maxX - w / 2;
    this.center.x = minX < maxX ? clamp(this.center.x, minX, maxX) : (b.minX + b.maxX) / 2;
    const minY = b.minY - CAMERA.marginBottom + h / 2;
    const maxY = b.maxY + CAMERA.marginTop - h / 2;
    this.center.y = minY < maxY ? clamp(this.center.y, minY, maxY) : (minY + maxY) / 2;
  }

  private apply(_dt: number): void {
    const d = this.distance;
    const t2 = this.shakeEnabled ? this.trauma * this.trauma : 0;
    const n = this.noise;
    const t = this.time * 18;
    const kick = this.shakeEnabled ? 1 : 0;
    this.shakeOffset.set(n(t, 1.3) * 0.55 * t2 + this.kickPos.x * kick, n(t, 7.1) * 0.45 * t2 + this.kickPos.y * kick, 0);
    this.shakeRot.set(0, 0, n(t, 13.7) * 0.035 * t2);
    const cam = this.camera;
    cam.position.set(this.center.x + this.shakeOffset.x, this.center.y + d * 0.07 + this.shakeOffset.y, d);
    this.tmp.set(this.center.x + this.shakeOffset.x * 0.6, this.center.y + this.shakeOffset.y * 0.6, 0);
    cam.lookAt(this.tmp);
    cam.rotateZ(this.shakeRot.z);
    cam.updateMatrixWorld();
  }

  /** Visible rectangle on the gameplay plane. */
  viewRect(out: ViewRect = { x0: 0, x1: 0, y0: 0, y1: 0 }): ViewRect {
    const h = this.viewH * this.zoomPunch;
    const w = h * this.camera.aspect;
    out.x0 = this.center.x - w / 2;
    out.x1 = this.center.x + w / 2;
    out.y0 = this.center.y - h / 2;
    out.y1 = this.center.y + h / 2;
    return out;
  }

  /** Projects a screen point (CSS px) onto the z = 0 plane. */
  screenToWorld(sx: number, sy: number, width: number, height: number, out: Vector2): Vector2 {
    const ndcX = (sx / width) * 2 - 1;
    const ndcY = -(sy / height) * 2 + 1;
    const cam = this.camera;
    this.tmp.set(ndcX, ndcY, 0.5).unproject(cam);
    const dir = this.tmp.sub(cam.position).normalize();
    const t = -cam.position.z / dir.z;
    out.set(cam.position.x + dir.x * t, cam.position.y + dir.y * t);
    return out;
  }

  /** Projects a world point to CSS px. Returns false when behind the camera. */
  worldToScreen(x: number, y: number, z: number, width: number, height: number, out: Vector2): boolean {
    this.tmp.set(x, y, z).project(this.camera);
    out.set((this.tmp.x * 0.5 + 0.5) * width, (-this.tmp.y * 0.5 + 0.5) * height);
    return this.tmp.z < 1;
  }
}
