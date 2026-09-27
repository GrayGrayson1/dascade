/**
 * Pure building blocks for server-simulated real-time Classics (authority model 1).
 *
 *  - IntentQueue (server): per-player queue of sequenced intent frames with a credit bank, so
 *    a client can never act faster than real time however fast it sends, and a starved or
 *    disconnected player simply repeats a neutral/last frame instead of freezing the sim.
 *  - SnapshotBuffer (client): time-stamped server snapshots with interpolation for remote
 *    entities (render ~100 ms in the past, lerp between the bracketing pair).
 *  - Intent bitfields: pack up to 31 boolean intents into one integer frame.
 */

// ---------------------------------------------------------------------------
// Intent bitfields
// ---------------------------------------------------------------------------

/** Build a packer for a fixed list of boolean intents (bit i = names[i]). */
export function intentBits<N extends string>(names: readonly N[]) {
  if (names.length > 31) throw new RangeError('at most 31 intents');
  const max = (1 << names.length) - 1;
  return {
    max,
    pack(on: Partial<Record<N, boolean>>): number {
      let v = 0;
      names.forEach((n, i) => {
        if (on[n]) v |= 1 << i;
      });
      return v;
    },
    unpack(frame: number): Record<N, boolean> {
      const out = {} as Record<N, boolean>;
      const f = frame & max;
      names.forEach((n, i) => {
        out[n] = (f & (1 << i)) !== 0;
      });
      return out;
    },
    has(frame: number, name: N): boolean {
      const i = names.indexOf(name);
      return i >= 0 && (frame & (1 << i)) !== 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Server: IntentQueue
// ---------------------------------------------------------------------------

export interface IntentQueueOptions {
  /** Max banked steps (ticks of credit). */
  maxCredit?: number;
  /** Queued frames beyond this are trimmed (oldest first) to `trimTo`. */
  maxQueue?: number;
  trimTo?: number;
  /** Ticks without input before `starved` turns true (callers usually neutralize held intents). */
  starveTicks?: number;
  /** A seq this far ahead of the last one re-anchors the sequence (client kept counting while stalled). */
  maxSeqJump?: number;
}

export class IntentQueue {
  private readonly q: Array<{ seq: number; frame: number }> = [];
  private lastSeq = 0;
  private credit = 0;
  private idle = 0;
  /** Seq of the last frame consumed (echo it in snapshots for client reconciliation). */
  ackSeq = 0;
  /** The frame currently in effect. */
  current = 0;
  private readonly o: Required<IntentQueueOptions>;

  constructor(opts: IntentQueueOptions = {}) {
    this.o = { maxCredit: 8, maxQueue: 12, trimTo: 4, starveTicks: 12, maxSeqJump: 600, ...opts };
  }

  /** Queue frames `seq, seq+1, …`. Old/duplicate frames are ignored. Returns frames accepted. */
  push(seq: number, frames: readonly number[], maxFrame: number): number {
    if (this.lastSeq === 0) this.lastSeq = seq - 1;
    if (seq > this.lastSeq + this.o.maxSeqJump) {
      this.q.length = 0;
      this.lastSeq = seq - 1;
    }
    let accepted = 0;
    for (let k = 0; k < frames.length; k++) {
      const s = seq + k;
      if (s <= this.lastSeq) continue;
      const f = frames[k]!;
      this.q.push({ seq: s, frame: Number.isInteger(f) && f >= 0 && f <= maxFrame ? f : 0 });
      this.lastSeq = s;
      accepted++;
    }
    if (this.q.length > this.o.maxQueue) {
      const dropped = this.q.splice(0, this.q.length - this.o.trimTo);
      this.ackSeq = dropped[dropped.length - 1]!.seq;
    }
    return accepted;
  }

  /**
   * Called once per server tick: returns the frame to simulate this tick. Consumes one queued
   * frame per earned credit (two when the queue is backing up), otherwise repeats `current`.
   */
  next(): number {
    this.credit = Math.min(this.o.maxCredit, this.credit + 1);
    const take = this.q.length > 3 ? 2 : 1;
    let consumed = 0;
    while (consumed < take && this.credit >= 1 && this.q.length > 0) {
      const f = this.q.shift()!;
      this.current = f.frame;
      this.ackSeq = f.seq;
      this.credit -= 1;
      consumed++;
    }
    this.idle = consumed > 0 ? 0 : this.idle + 1;
    return this.current;
  }

  /** No input for a while (lag, tab hidden, disconnected). */
  get starved(): boolean {
    return this.idle >= this.o.starveTicks;
  }

  get queued(): number {
    return this.q.length;
  }

  reset(): void {
    this.q.length = 0;
    this.lastSeq = 0;
    this.credit = 0;
    this.idle = 0;
    this.ackSeq = 0;
    this.current = 0;
  }
}

// ---------------------------------------------------------------------------
// Client: SnapshotBuffer
// ---------------------------------------------------------------------------

export interface TimedSnapshot<T> {
  /** Server tick of the snapshot. */
  tick: number;
  /** Local receive time (ms, performance.now()). */
  at: number;
  data: T;
}

/**
 * Keeps recent snapshots and finds the pair bracketing `renderTick = latestTick − delayTicks`
 * (estimated from arrival times). Use `sample()` each frame and lerp entity fields by `t`.
 */
export class SnapshotBuffer<T> {
  private readonly items: Array<TimedSnapshot<T>> = [];
  private offset: number | null = null;

  constructor(
    private readonly tickMs: number,
    private readonly delayMs = 100,
    private readonly capacity = 32,
  ) {}

  push(tick: number, at: number, data: T): void {
    const last = this.items[this.items.length - 1];
    if (last && tick <= last.tick) return;
    this.items.push({ tick, at, data });
    if (this.items.length > this.capacity) this.items.shift();
    // Track the smallest (least delayed) arrival offset, relaxing slowly so clock drift is absorbed.
    const off = at - tick * this.tickMs;
    this.offset = this.offset === null ? off : Math.min(off, this.offset + 0.5);
  }

  get latest(): TimedSnapshot<T> | undefined {
    return this.items[this.items.length - 1];
  }

  /** Interpolation pair for local time `now`; `t` in [0, 1]. Null until a snapshot exists. */
  sample(now: number): { a: T; b: T; t: number; tick: number } | null {
    const n = this.items.length;
    if (n === 0 || this.offset === null) return null;
    const renderTick = (now - this.delayMs - this.offset) / this.tickMs;
    const first = this.items[0]!;
    const last = this.items[n - 1]!;
    if (renderTick <= first.tick) return { a: first.data, b: first.data, t: 0, tick: first.tick };
    if (renderTick >= last.tick) return { a: last.data, b: last.data, t: 0, tick: last.tick };
    for (let i = n - 1; i > 0; i--) {
      const a = this.items[i - 1]!;
      const b = this.items[i]!;
      if (renderTick >= a.tick) {
        const span = b.tick - a.tick;
        return { a: a.data, b: b.data, t: span > 0 ? (renderTick - a.tick) / span : 0, tick: renderTick };
      }
    }
    return { a: first.data, b: first.data, t: 0, tick: first.tick };
  }

  clear(): void {
    this.items.length = 0;
    this.offset = null;
  }
}
