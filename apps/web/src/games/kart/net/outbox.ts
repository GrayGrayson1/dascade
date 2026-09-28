/**
 * Input sequencing: every simulated tick gets the next sequence number and a packed 19-bit input
 * frame. Frames go out in packets of `KART_SIM.inputEvery` (≤ `maxInputsPerPacket`), and stay in
 * `pending` until a snapshot acknowledges them (they are replayed on every reconciliation).
 */
import { KART_SIM, type KartInputPacket } from '@dascade/shared/games/kart';

export interface PendingFrame {
  seq: number;
  packed: number;
  sentAt: number;
}

/** Unacknowledged frames beyond which the client stops replaying and re-syncs from the server. */
export const RESYNC_GAP = 300;
/** Never keep more than this many unacknowledged frames (5 s). */
export const MAX_PENDING = 300;

export class InputOutbox {
  seq = 0;
  pending: PendingFrame[] = [];
  private batch: number[] = [];
  private batchSeq = 0;
  sent = 0;
  held = 0;

  constructor(private readonly send: (p: KartInputPacket) => void) {}

  /**
   * Record one frame; returns its sequence number (the next one, or `seqOverride` when the
   * predictor assigns sequence numbers itself). Flushes when a packet is full.
   */
  push(packed: number, now: number, stalled: boolean, seqOverride?: number): number {
    // A non-consecutive frame can't share a packet (frames in a packet are seq, seq+1, …).
    if (seqOverride !== undefined && this.batch.length && seqOverride !== this.batchSeq + this.batch.length) this.flush(stalled);
    const seq = seqOverride ?? this.seq + 1;
    this.seq = seq;
    this.pending.push({ seq, packed, sentAt: now });
    if (this.pending.length > MAX_PENDING) this.pending.splice(0, this.pending.length - MAX_PENDING);
    if (this.batch.length === 0) this.batchSeq = seq;
    this.batch.push(packed);
    if (this.batch.length >= KART_SIM.inputEvery) this.flush(stalled);
    return seq;
  }

  /**
   * Send the batch. While snapshots have stopped (a stalled connection) the batch is dropped
   * instead of piling up in the socket (a burst would trip the server's rate limit); the server
   * holds the last input and reconciliation fixes the gap.
   */
  flush(stalled = false): void {
    if (!this.batch.length) return;
    if (stalled) {
      this.batch = [];
      this.held++;
      return;
    }
    for (let i = 0; i < this.batch.length; i += KART_SIM.maxInputsPerPacket) {
      this.send({ seq: this.batchSeq + i, inputs: this.batch.slice(i, i + KART_SIM.maxInputsPerPacket) });
      this.sent++;
    }
    this.batch = [];
  }

  /**
   * Drop frames the server has applied. Returns the acknowledged frame (for RTT) if we still had it.
   */
  ack(seq: number): PendingFrame | undefined {
    let found: PendingFrame | undefined;
    let drop = 0;
    for (const f of this.pending) {
      if (f.seq > seq) break;
      if (f.seq === seq) found = f;
      drop++;
    }
    if (drop) this.pending.splice(0, drop);
    return found;
  }

  /** Restart the sequence just after `ack` (first snapshot of a race, or after a long outage). */
  resync(ack: number): void {
    this.seq = Math.max(this.seq, ack);
    this.pending = [];
    this.batch = [];
  }

  reset(): void {
    this.pending = [];
    this.batch = [];
  }
}
