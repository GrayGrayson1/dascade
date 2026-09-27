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
   * it. `racing` = the snapshot status is racing (frames recorded as locked just before GO are
   * replayed unlocked, as the server applied them). Returns the position error (u) between the
   * old prediction and the corrected one (0 on the first reconcile).
   */
  reconcile(server: KartState, ack: number, serverTick: number, racing: boolean): number {
    this.frames = this.frames.filter((f) => f.seq > ack);
    if (this.seq < ack) this.seq = ack;
    const old = this.state;
    let s = server;
    let prev = server;
    let info: KartStepInfo | null = null;
    let tick = serverTick;
    for (const f of this.frames) {
      prev = s;
      tick++;
      const r = stepKart(s, unpackKartInput(f.packed), this.spec, this.track, { locked: racing ? false : f.locked, tick });
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
