/**
 * Input-log encoding for verified runs.
 *
 * Wire format (RunInputBatch.events): flattened [dt, code, dt, code, …] where dt is the tick
 * delta from the previous event — the first event of a batch is relative to the previous
 * batch's `upTo` (0 for the first batch). Deltas and codes are small integers, so msgpack
 * encodes most pairs in 2–4 bytes.
 */
import { CLASSICS } from '@dascade/shared/games/classics';
import type { InputEvent } from './sim.ts';

export function encodeEvents(events: readonly InputEvent[], fromTick: number): number[] {
  const out: number[] = [];
  let prev = fromTick;
  for (const ev of events) {
    out.push(ev.tick - prev, ev.code);
    prev = ev.tick;
  }
  return out;
}

export type DecodeResult = { ok: true; events: InputEvent[] } | { ok: false; reason: string };

/**
 * Decode + structurally validate one batch. Ticks must stay in [fromTick, upTo), codes within
 * [0, maxCode], and no more than CLASSICS.maxEventsPerTick events may share a tick.
 */
export function decodeEvents(flat: readonly number[], fromTick: number, upTo: number, maxCode: number): DecodeResult {
  if (flat.length % 2 !== 0) return { ok: false, reason: 'odd' };
  if (upTo < fromTick) return { ok: false, reason: 'backwards' };
  const events: InputEvent[] = [];
  let tick = fromTick;
  let sameTick = 0;
  for (let i = 0; i < flat.length; i += 2) {
    const dt = flat[i]!;
    const code = flat[i + 1]!;
    if (!Number.isInteger(dt) || dt < 0 || !Number.isInteger(code) || code < 0 || code > maxCode) return { ok: false, reason: 'range' };
    tick += dt;
    if (tick >= upTo) return { ok: false, reason: 'past-upTo' };
    sameTick = dt === 0 && events.length > 0 ? sameTick + 1 : 1;
    if (sameTick > CLASSICS.maxEventsPerTick) return { ok: false, reason: 'flood' };
    events.push({ tick, code });
  }
  return { ok: true, events };
}

/**
 * Client-side log keeper. Records events at the tick they were applied, and hands out the
 * next batch to send. Keeps the full log so it can resend after a reconnect/resync.
 */
export class InputRecorder {
  /** Every event of the run (absolute ticks). */
  readonly log: InputEvent[] = [];
  /** Tick the server has acknowledged / the next batch starts from. */
  sentUpTo = 0;
  /** Next batch sequence number. */
  seq = 1;
  private sentIndex = 0;

  record(tick: number, code: number): void {
    this.log.push({ tick, code });
  }

  /** Load a resumed log (after reconnect) so later batches continue it. */
  load(events: readonly InputEvent[], upTo: number, ackSeq: number): void {
    this.log.length = 0;
    for (const ev of events) this.log.push(ev);
    this.rewind(upTo, ackSeq);
  }

  /** Server said it holds everything through `upTo` (batch `ackSeq`): resend from there. */
  rewind(upTo: number, ackSeq: number): void {
    this.sentUpTo = upTo;
    this.seq = ackSeq + 1;
    let i = 0;
    while (i < this.log.length && this.log[i]!.tick < upTo) i++;
    this.sentIndex = i;
  }

  /** True when there is something new to send for `simTick`. */
  pending(simTick: number): boolean {
    return simTick > this.sentUpTo;
  }

  /**
   * Take the next batch covering (sentUpTo, simTick]. Splits so a batch never exceeds
   * CLASSICS.maxBatchEvents (a split batch ends right before the first event it could not hold).
   */
  take(simTick: number): { seq: number; upTo: number; events: number[] } | null {
    if (simTick <= this.sentUpTo) return null;
    const from = this.sentUpTo;
    let end = this.sentIndex;
    while (end < this.log.length && this.log[end]!.tick < simTick && end - this.sentIndex < CLASSICS.maxBatchEvents) end++;
    let upTo = simTick;
    if (end < this.log.length && this.log[end]!.tick < simTick) {
      // Batch is full: stop just before the next unsent event's tick (all events of a tick stay together).
      upTo = this.log[end]!.tick;
      while (end > this.sentIndex && this.log[end - 1]!.tick >= upTo) end--;
      if (upTo <= from) return null;
    }
    const events = encodeEvents(this.log.slice(this.sentIndex, end), from);
    const batch = { seq: this.seq, upTo, events };
    this.seq++;
    this.sentIndex = end;
    this.sentUpTo = upTo;
    return batch;
  }
}
