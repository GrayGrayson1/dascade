/**
 * Client-side prediction of the local kart. The client lane owns timing, batching and sending;
 * this class owns the frames and the exact replay:
 *  - `step()` quantizes the input exactly as it travels, advances the local prediction with the
 *    shared `stepKart` and records the frame (seq, packed input, lock state, estimated tick).
 *  - `reconcile()` takes the authoritative state + ack from `kart:own`, drops acknowledged
 *    frames and replays the rest. Uninterrupted, the replay reproduces the server bit for bit.
 * Items are rolled on the server; self-affecting uses (turbo, shield, warp) and drift/pad/ramp
 * boosts are part of `stepKart`, so they feel instant.
 */
import { packKartInput, quantizeKartInput, unpackKartInput, type KartInput } from '@dascade/shared/games/kart';
import { stepKart, type KartState, type KartStepInfo } from './kart.ts';
import type { KartSpec } from './spec.ts';
import type { KartTrack } from './track.ts';

export interface PendingFrame {
  seq: number;
  packed: number;
  locked: boolean;
  /** Estimated server tick at which the frame is applied (moving hazards). */
  tick: number;
}

/** Unacknowledged frames beyond this are dropped (a long outage): the next reconcile re-syncs. */
export const MAX_PENDING_FRAMES = 240;

export class KartPredictor {
  readonly track: KartTrack;
  spec: KartSpec;
  state: KartState | null = null;
  prev: KartState | null = null;
  info: KartStepInfo | null = null;
  seq = 0;
  /** Seq of the first frame the server applied after GO (0 = not known yet). */
  goSeq = 0;
  /**
   * Input delay in ticks: the server applies frame `seq` at tick ≈ seq + applyLag (from the last
   * `kart:own`: tick − ack). Used to lock frames exactly as the server will.
   */
  applyLag = 0;
  private frames: PendingFrame[] = [];

  constructor(track: KartTrack, spec: KartSpec) {
    this.track = track;
    this.spec = spec;
  }

  get pending(): readonly PendingFrame[] {
    return this.frames;
  }

  reset(): void {
    this.state = null;
    this.prev = null;
    this.info = null;
    this.frames = [];
    this.goSeq = 0;
    this.applyLag = 0;
  }

  /**
   * Whether the next frame (seq + 1) will be applied on the grid (locked) by the server, given the
   * race's `goTick` (−1 = not scheduled): once `goSeq` is known it is exact, before that frame
   * `f` is locked while f + applyLag ≤ goTick (the server applies frames after the tick of GO).
   */
  nextFrameLocked(goTick: number): boolean {
    const next = this.seq + 1;
    if (this.goSeq > 0) return next < this.goSeq;
    if (goTick < 0) return true;
    return next + this.applyLag <= goTick;
  }

  /** Ticks until the next frame is the first one applied after GO (≤ 0 = racing): time the lights by it. */
  framesToGo(goTick: number): number {
    if (this.goSeq > 0) return this.goSeq - (this.seq + 1);
    if (goTick < 0) return Infinity;
    return goTick + 1 - (this.seq + 1 + this.applyLag);
  }

  /**
   * Predict one local frame. Returns the frame to send ({seq, packed}). Before the first
   * reconcile there is no state yet; the frame is still numbered and recorded.
   */
  step(input: KartInput, locked: boolean, tick: number): { seq: number; packed: number } {
    const q = quantizeKartInput(input);
    const packed = packKartInput(q);
    const seq = ++this.seq;
    this.frames.push({ seq, packed, locked, tick });
    if (this.frames.length > MAX_PENDING_FRAMES) this.frames.splice(0, this.frames.length - MAX_PENDING_FRAMES);
    if (this.state) {
      this.prev = this.state;
      const r = stepKart(this.state, q, this.spec, this.track, { locked, tick });
      this.state = r.state;
      this.info = r.info;
    }
    return { seq, packed };
  }

  /**
   * Adopt the server's state for our kart (acknowledged up to `ack`) and replay the frames after
   * it. Pass `goSeq` from `kart:own`: frames are then replayed locked/unlocked exactly as the server
   * applies them (start boost/stall agree at any latency). Without it, `racing` = the snapshot
   * status is racing (pending frames replay unlocked). Returns the position error (u) between the
   * old prediction and the corrected one (0 on the first reconcile).
   */
  reconcile(server: KartState, ack: number, serverTick: number, racing: boolean, goSeq = 0): number {
    this.frames = this.frames.filter((f) => f.seq > ack);
    if (this.seq < ack) this.seq = ack;
    if (goSeq > 0) this.goSeq = goSeq;
    if (ack > 0) this.applyLag = serverTick - ack;
    const old = this.state;
    let s = server;
    let prev = server;
    let info: KartStepInfo | null = null;
    let tick = serverTick;
    for (const f of this.frames) {
      prev = s;
      tick++;
      // Lock exactly as the server did: by goSeq once known, else the frame's own guess.
      const locked = this.goSeq > 0 ? f.seq < this.goSeq : racing ? false : f.locked;
      const r = stepKart(s, unpackKartInput(f.packed), this.spec, this.track, { locked, tick });
      f.tick = tick;
      s = r.state;
      info = r.info;
    }
    this.state = s;
    this.prev = prev;
    if (info) this.info = info;
    if (!old) return 0;
    const dx = old.x - s.x;
    const dy = old.y - s.y;
    const dz = old.z - s.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
