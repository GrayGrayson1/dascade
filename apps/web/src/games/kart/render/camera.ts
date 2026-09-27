/**
 * Camera rig: low spring chase cam (look-ahead, speed FOV, boost kick, drift offset toward the
 * outside, airborne lift, landing dip, impact shake), a start-grid flyover during the countdown, a
 * finish orbit and a looser spectator follow. Reduced motion: fixed FOV, no shake, gentler follow.
 * Allocation-free per frame.
 */
import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { KF, type KartCameraMode, type KartPose } from './types.ts';

const tmp = new Vector3();
const want = new Vector3();
const look = new Vector3();

function angleLerp(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class CameraRig {
  private pos = new Vector3();
  private tgt = new Vector3();
  private heading = 0;
  private fov = 70;
  private shake = 0;
  private dip = 0;
  private initialized = false;
  private orbitA = 0;
  private driftOff = 0;
  private lastSlot = -1;
  private boostKick = 0;
  private pushBack = 0;
  reducedMotion = false;
  baseFov = 62;
  /** Chase distance / height (set per aspect by the renderer: close and low, kart big in the lower centre). */
  chaseDist = 3.35;
  chaseHeight = 1.5;

  constructor(private readonly cam: PerspectiveCamera) {}

  /** Impact shake (0..1). */
  kick(amount: number): void {
    if (this.reducedMotion) return;
    this.shake = Math.min(1, this.shake + amount);
  }

  land(amount: number): void {
    if (this.reducedMotion) return;
    this.dip = Math.min(0.6, this.dip + amount);
  }

  boost(): void {
    if (this.reducedMotion) return;
    this.boostKick = 1;
  }

  reset(): void {
    this.initialized = false;
  }

  update(mode: KartCameraMode, p: KartPose | null, dt: number, introT: number, t: number): void {
    const cam = this.cam;
    if (!p) {
      cam.updateProjectionMatrix();
      return;
    }
    if (p.slot !== this.lastSlot) {
      this.lastSlot = p.slot;
      this.initialized = false;
    }
    const rm = this.reducedMotion;
    const kx = p.x;
    const ky = p.z;
    const kz = -p.y;
    const spinning = (p.flags & KF.spinning) !== 0;
    if (!this.initialized) {
      this.heading = p.heading;
      this.lagY = ky;
      this.initialized = true;
      this.snap = true;
    }
    if (!spinning) this.heading = angleLerp(this.heading, p.heading, 1 - Math.exp(-dt * (rm ? 3.5 : 5.5)));
    const fx = Math.cos(this.heading);
    const fz = -Math.sin(this.heading);
    const rx = Math.sin(this.heading);
    const rz = Math.cos(this.heading);
    const speed = Math.abs(p.speed);
    const sf = Math.min(1.3, speed / 26);
    const boosting = (p.flags & KF.boosting) !== 0;
    const air = (p.flags & KF.airborne) !== 0;
    let fovTarget = this.baseFov;
    let stiff = rm ? 4 : 7.5;

    if (mode === 'intro' && introT < 1) {
      const e = MathUtils.smootherstep(introT, 0, 1);
      const theta = Math.PI * (1 - e) + 0.35 * Math.sin(e * Math.PI);
      const r = MathUtils.lerp(24, this.chaseDist, e);
      const h = MathUtils.lerp(10, this.chaseHeight, e);
      const bx = -fx;
      const bz = -fz;
      const cx = bx * Math.cos(theta) - bz * Math.sin(theta);
      const cz = bx * Math.sin(theta) + bz * Math.cos(theta);
      want.set(kx + cx * r, ky + h, kz + cz * r);
      look.set(kx + fx * 4 * e, ky + 1 + (1 - e) * 1.5, kz + fz * 4 * e);
      stiff = 12;
    } else if (mode === 'orbit') {
      this.orbitA += dt * (rm ? 0.15 : 0.4);
      const a = this.orbitA + this.heading;
      want.set(kx + Math.cos(a) * 7, ky + 2.4, kz - Math.sin(a) * 7);
      look.set(kx, ky + 0.9, kz);
      stiff = 3;
    } else {
      const spect = mode === 'spectate';
      // speed and boost push the camera back a little (smoothed so it breathes, never jumps)
      const pushTarget = rm ? 0 : sf * 0.22 + (boosting ? 0.28 : 0);
      this.pushBack += (pushTarget - this.pushBack) * Math.min(1, dt * 2.5);
      const dist = spect ? 8.5 + sf : this.chaseDist + this.pushBack;
      let h = (spect ? 3.8 : this.chaseHeight) + (air ? 0.7 : 0) - this.dip * 0.4;
      const drifting = (p.flags & KF.drifting) !== 0;
      const dTarget = drifting ? (p.flags & KF.driftLeft ? 1 : -1) * 1.0 : 0;
      this.driftOff += (dTarget - this.driftOff) * Math.min(1, dt * 3);
      if (rm) h += 0.2;
      want.set(kx - fx * dist + rx * this.driftOff, ky + h, kz - fz * dist + rz * this.driftOff);
      const ahead = 4.2 + speed * 0.14;
      look.set(kx + fx * ahead, ky + 1.05 + (air ? -0.25 : 0), kz + fz * ahead);
      if (!rm) fovTarget = this.baseFov + sf * 5 + this.boostKick * 4 + (boosting ? 3 : 0);
      if (spect) stiff = rm ? 3 : 4.5;
    }

    // Smooth the offset RELATIVE to the kart (not the absolute position), so the camera never
    // trails further behind as speed rises; it only eases heading swings, bumps and mode changes.
    want.x -= kx;
    want.y -= ky;
    want.z -= kz;
    look.x -= kx;
    look.y -= ky;
    look.z -= kz;
    if (this.snap) {
      this.pos.copy(want);
      this.tgt.copy(look);
      this.snap = false;
    } else {
      const k = 1 - Math.exp(-dt * stiff);
      const kv = 1 - Math.exp(-dt * (stiff * 1.6));
      this.pos.x += (want.x - this.pos.x) * k;
      this.pos.z += (want.z - this.pos.z) * k;
      this.pos.y += (want.y - this.pos.y) * kv;
      const kl = 1 - Math.exp(-dt * stiff * 1.8);
      this.tgt.lerp(look, kl);
    }
    // vertical: follow the kart's height with a little lag so jumps and landings read
    this.lagY += (ky - this.lagY) * Math.min(1, dt * (rm ? 5 : 9));
    if (Math.abs(ky - this.lagY) > 6) this.lagY = ky;
    const camX = kx + this.pos.x;
    const camY = Math.max(this.lagY + this.pos.y, ky + 0.9);
    const camZ = kz + this.pos.z;

    this.fov += (fovTarget - this.fov) * Math.min(1, dt * 4);
    this.boostKick = Math.max(0, this.boostKick - dt * 1.6);
    this.dip = Math.max(0, this.dip - dt * 2.5);
    cam.position.set(camX, camY, camZ);
    if (this.shake > 0.001 && !rm) {
      const s = this.shake * this.shake * 0.35;
      cam.position.x += Math.sin(t * 71) * s;
      cam.position.y += Math.sin(t * 57 + 1) * s;
      cam.position.z += Math.sin(t * 63 + 2) * s;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    cam.lookAt(kx + this.tgt.x, this.lagY + this.tgt.y, kz + this.tgt.z);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    void tmp;
  }

  private snap = true;
  private lagY = 0;

  get fovNow(): number {
    return this.fov;
  }
}
