/**
 * One server-verified run (authority model 2). The client simulates locally and streams its
 * tick-indexed input log in batches; this replays the same deterministic engine, with the same
 * seed, and is the only source of truth for the run's score, level and game over.
 *
 * Guards (all enforced here, per batch):
 *  - strict batch sequencing (duplicates ignored → idempotent; gaps → resync request),
 *  - wall-clock cap: a client can't be further ahead than the real time since `startAt`
 *    (+ a little slack), so a sped-up client gains nothing,
 *  - structural validation of every event (tick range, code range, per-tick flood cap),
 *  - per-run caps on events and length (CLASSICS.maxRunEvents / maxRunTicks),
 *  - any code the engine refuses = tampered log → the run is rejected.
 */
import { CLASSICS, type RunEndReason, type RunInputBatch, type RunTicket, type RunVerdict } from '@dascade/shared/games/classics';
import { advanceSim, decodeEvents, encodeEvents, type ClassicsSim, type InputEvent } from '@dascade/game-core/classics/shared';

export type IngestResult =
  | { status: 'ok'; ended: false }
  | { status: 'ok'; ended: true; reason: RunEndReason }
  | { status: 'dup' }
  | { status: 'resync'; why: 'gap' | 'ahead' }
  | { status: 'rejected'; why: string };

export interface VerifiedRunInit {
  runId: string;
  matchNo: number;
  playerId: string;
  seed: string;
  startAt: number;
  limitTicks: number;
  options: Record<string, number | string | boolean>;
  board: string;
  sim: ClassicsSim;
  maxCode: number;
  tickHz?: number;
}

export class VerifiedRun {
  readonly runId: string;
  readonly matchNo: number;
  readonly playerId: string;
  readonly seed: string;
  readonly startAt: number;
  readonly limitTicks: number;
  readonly options: Record<string, number | string | boolean>;
  readonly board: string;
  readonly sim: ClassicsSim;
  private readonly maxCode: number;
  private readonly tickMs: number;
  /** Every accepted event (absolute ticks) — for resume after reconnect and audits. */
  readonly log: InputEvent[] = [];
  ackSeq = 0;
  upTo = 0;
  verdict: RunVerdict | null = null;
  endReason: RunEndReason | null = null;
  /** Client-reported score of the final batch (diagnostics). */
  clientScore: number | null = null;

  constructor(init: VerifiedRunInit) {
    this.runId = init.runId;
    this.matchNo = init.matchNo;
    this.playerId = init.playerId;
    this.seed = init.seed;
    this.startAt = init.startAt;
    this.limitTicks = init.limitTicks;
    this.options = init.options;
    this.board = init.board;
    this.sim = init.sim;
    this.maxCode = init.maxCode;
    this.tickMs = 1000 / (init.tickHz ?? CLASSICS.tickHz);
  }

  get ended(): boolean {
    return this.endReason !== null;
  }

  /** Ticks of real time elapsed since the run's clock started. */
  wallTicks(now: number): number {
    return Math.floor((now - this.startAt) / this.tickMs);
  }

  ingest(batch: RunInputBatch, now: number): IngestResult {
    if (this.ended || batch.seq <= this.ackSeq) return { status: 'dup' };
    if (batch.seq !== this.ackSeq + 1) return { status: 'resync', why: 'gap' };
    if (batch.upTo < this.upTo) return { status: 'resync', why: 'gap' };
    if (batch.upTo > this.wallTicks(now) + CLASSICS.aheadSlackTicks) return { status: 'resync', why: 'ahead' };
    if (batch.upTo > CLASSICS.maxRunTicks) return { status: 'rejected', why: 'too-long' };
    const decoded = decodeEvents(batch.events, this.upTo, batch.upTo, this.maxCode);
    if (!decoded.ok) return { status: 'rejected', why: `events:${decoded.reason}` };
    if (this.log.length + decoded.events.length > CLASSICS.maxRunEvents) return { status: 'rejected', why: 'too-many-events' };
    const limit = this.limitTicks > 0 ? this.limitTicks : Infinity;
    const res = advanceSim(this.sim, decoded.events, batch.upTo, limit);
    if (!res.ok) return { status: 'rejected', why: res.reason };
    for (const ev of decoded.events) {
      if (ev.tick < this.sim.tick) this.log.push(ev);
    }
    this.ackSeq = batch.seq;
    this.upTo = this.sim.tick;
    if (batch.clientScore !== undefined) this.clientScore = batch.clientScore;
    if (this.sim.over) return { status: 'ok', ended: true, reason: 'over' };
    if (this.limitTicks > 0 && this.sim.tick >= this.limitTicks) return { status: 'ok', ended: true, reason: 'time' };
    // The client says its engine ended but ours didn't (a divergence): the server's state stands.
    if (batch.final) return { status: 'ok', ended: true, reason: 'over' };
    return { status: 'ok', ended: false };
  }

  end(reason: RunEndReason): void {
    if (!this.endReason) this.endReason = reason;
  }

  /** Private ticket for the owner (with the resume log when anything was verified already). */
  ticket(): RunTicket {
    const ticket: RunTicket = {
      runId: this.runId,
      matchNo: this.matchNo,
      seed: this.seed,
      startAt: this.startAt,
      limitTicks: this.limitTicks,
      options: this.options,
      board: this.board,
    };
    if (this.ackSeq > 0 || this.upTo > 0) ticket.resume = { events: encodeEvents(this.log, 0), upTo: this.upTo, ackSeq: this.ackSeq };
    if (this.ended) ticket.ended = true;
    return ticket;
  }
}
