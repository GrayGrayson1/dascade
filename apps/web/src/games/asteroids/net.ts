/**
 * Asteroid Run client netcode (no rendering here).
 *
 *  - Own ship: predicted with the shared flight model (`stepShipMotion`) on the same control
 *    frames we send (2 per packet via the kit's InputPump). Every snapshot carries our ship's
 *    exact state and the last applied seq: we rewind to it and replay the frames after the ack,
 *    so the ship answers instantly and still matches the server. A small visual offset hides
 *    corrections (bumps off rocks are the server's call); big ones snap.
 *  - Own shots: spawned locally the moment the gun fires (same ids as the server's), then
 *    retired when the server's snapshot shows them gone (they hit something).
 *  - Everything else (rocks, other ships, their shots, drops) is interpolated ~100 ms behind.
 */
import { ASTEROIDS_MSG, ASTEROIDS_NET } from '@dascade/shared/games/asteroids';
import {
  SHIP,
  ShipFlag,
  WORLD,
  decodeAsteroidsSnapshot,
  delta,
  stepShipMotion,
  wrap,
  type AsteroidsSnapshot,
  type ShipMotion,
  type SnapShip,
} from '@dascade/game-core/asteroids';
import { InputPump, SnapshotBuffer, subscribeBytes } from '../_classics/index.ts';

const TICK_MS = 1000 / 60;

export interface LocalBullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export interface Interp {
  a: AsteroidsSnapshot;
  b: AsteroidsSnapshot;
  t: number;
}

function motionOf(s: SnapShip): ShipMotion {
  return { x: s.x, y: s.y, vx: s.vx, vy: s.vy, h: s.h, cooldown: s.cooldown, shots: s.shots, spread: s.spread, rapid: s.rapid, thrusting: (s.flags & ShipFlag.thrusting) !== 0 };
}

export class AsteroidsNet {
  readonly buffer = new SnapshotBuffer<AsteroidsSnapshot>(TICK_MS, 100);
  latest: AsteroidsSnapshot | null = null;
  mySlot = -1;
  /** Predicted own ship (null while dead / not flying). */
  me: ShipMotion | null = null;
  readonly bullets: LocalBullet[] = [];
  private readonly pump = new InputPump(ASTEROIDS_MSG.input, ASTEROIDS_NET.inputEvery, ASTEROIDS_NET.maxInputsPerPacket);
  private history: Array<{ seq: number; frame: number }> = [];
  private matchId = -1;
  private offset = { x: 0, y: 0 };
  private unsub: (() => void) | null = null;
  onSnapshot: ((s: AsteroidsSnapshot, prev: AsteroidsSnapshot | null) => void) | null = null;
  /** Called when our gun fires locally (sound / muzzle flash). */
  onFire: ((count: number) => void) | null = null;

  attach(): void {
    this.unsub = subscribeBytes(ASTEROIDS_MSG.snap, (bytes) => this.receive(bytes));
  }

  detach(): void {
    this.unsub?.();
    this.unsub = null;
  }

  reset(): void {
    this.buffer.clear();
    this.latest = null;
    this.me = null;
    this.history = [];
    this.bullets.length = 0;
    this.offset = { x: 0, y: 0 };
    this.matchId = -1;
  }

  private receive(bytes: Uint8Array): void {
    const s = decodeAsteroidsSnapshot(bytes);
    if (!s) return;
    if (s.matchId !== this.matchId) {
      this.reset();
      this.matchId = s.matchId;
    }
    const prev = this.latest;
    this.latest = s;
    this.buffer.push(s.tick, performance.now(), s);
    this.reconcile(s);
    this.onSnapshot?.(s, prev);
  }

  private reconcile(s: AsteroidsSnapshot): void {
    const ship = s.ships.find((x) => x.slot === this.mySlot);
    if (!ship || !(ship.flags & ShipFlag.alive)) {
      this.me = null;
      this.history = [];
      return;
    }
    const before = this.me ? { x: this.me.x, y: this.me.y } : null;
    const m = motionOf(ship);
    this.history = this.history.filter((h) => h.seq > ship.ack);
    for (const h of this.history) stepShipMotion(m, h.frame, this.mySlot, true);
    this.me = m;
    if (before) {
      const dx = delta(m.x, before.x + this.offset.x, WORLD.width);
      const dy = delta(m.y, before.y + this.offset.y, WORLD.height);
      this.offset = dx * dx + dy * dy < 60 * 60 ? { x: dx, y: dy } : { x: 0, y: 0 };
    }
    // Local shots the server has already resolved (fired before its latest shot count and gone) are done.
    const serverShots = ship.shots;
    const alive = new Set(s.bullets.filter((b) => b.owner === this.mySlot).map((b) => b.id));
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]!;
      const shot = b.id & 0xfff;
      const confirmed = ((serverShots - shot) & 0xfff) < 0x800;
      if (confirmed && !alive.has(b.id)) this.bullets.splice(i, 1);
    }
  }

  /** Fixed 60 Hz step while playing: predict our ship with this frame and send it. */
  step(frame: number, live: boolean): void {
    if (!live) return;
    const seq = this.pump.push(frame);
    const me = this.me;
    if (!me) return;
    this.history.push({ seq, frame });
    if (this.history.length > 120) this.history.shift();
    const spawned = stepShipMotion(me, frame, this.mySlot, true);
    for (const b of spawned) this.bullets.push({ ...b, life: SHIP.bulletLife });
    if (spawned.length) this.onFire?.(spawned.length);
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]!;
      b.x = wrap(b.x + b.vx, WORLD.width);
      b.y = wrap(b.y + b.vy, WORLD.height);
      if (--b.life <= 0) this.bullets.splice(i, 1);
    }
  }

  /** Our ship for drawing (prediction + decaying correction offset). */
  myShip(): (ShipMotion & { ox: number; oy: number }) | null {
    return this.me ? { ...this.me, ox: this.offset.x, oy: this.offset.y } : null;
  }

  decay(frameMs: number): void {
    const k = Math.pow(0.001, Math.min(0.1, frameMs / 1000) / 0.15);
    this.offset.x *= k;
    this.offset.y *= k;
  }

  sample(now = performance.now()): Interp | null {
    const r = this.buffer.sample(now);
    return r ? { a: r.a, b: r.b, t: r.t } : null;
  }
}
