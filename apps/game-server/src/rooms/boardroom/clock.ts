/**
 * DAS Boardroom kit — the server-owned game clock (Fischer increment).
 *
 * Authority: only the server's wall clock (Date.now) decides time. Clients never report time;
 * they render `remaining = sideMs − (serverNow − turnStartedAt)` for the running side, using the
 * synced server clock, so the display is smooth and needs no per-tick patches.
 *
 * Flags: a timer is scheduled for the exact moment the running side's time runs out (plus a small
 * network grace, see FLAG_GRACE_MS) and every incoming action also checks `overdue()` first, so a
 * late timer tick can never let a move through after the flag fell.
 *
 * Increment is added after each completed turn (Fischer). Untimed games (`baseMs` 0) never run.
 */
import { otherSide, type BoardSide } from '@dascade/shared/games/boardroom';
import type { BoardClockState } from './schema.ts';

/**
 * A move that reaches the server within this many ms after the flag moment is still accepted (the
 * mover's clock is floored at 0 before the increment). It compensates the one-way trip of the move
 * message, so players on normal connections don't lose on time with a move "in the air".
 */
export const FLAG_GRACE_MS = 150;

export interface ClockScheduler {
  schedule(key: string, ms: number, fn: () => void): void;
  cancel(key: string): void;
}

export interface ClockTimes {
  baseMs: number;
  incrementMs: number;
}

const FLAG_TIMER = 'boardroom:flag';

export class ServerClock {
  graceMs = FLAG_GRACE_MS;

  constructor(
    private readonly view: BoardClockState,
    private readonly scheduler: ClockScheduler,
    private readonly onFlag: (side: BoardSide) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** Reset both clocks to a new time control (stopped). `baseMs <= 0` = untimed. */
  configure(times: ClockTimes): void {
    this.scheduler.cancel(FLAG_TIMER);
    const base = Math.max(0, Math.round(times.baseMs));
    this.view.enabled = base > 0;
    this.view.baseMs = base;
    this.view.incrementMs = base > 0 ? Math.max(0, Math.round(times.incrementMs)) : 0;
    this.view.firstMs = base;
    this.view.secondMs = base;
    this.view.running = '';
    this.view.turnStartedAt = 0;
    this.view.flagged = '';
  }

  get enabled(): boolean {
    return this.view.enabled;
  }

  get running(): BoardSide | null {
    return (this.view.running || null) as BoardSide | null;
  }

  /** Time left for a side right now (never negative). Untimed clocks report their base (0). */
  remaining(side: BoardSide, now = this.now()): number {
    return Math.max(0, this.rawRemaining(side, now));
  }

  /** The side whose flag has fallen (beyond the grace) but was not processed yet, if any. */
  overdue(now = this.now()): BoardSide | null {
    const side = this.running;
    if (!this.view.enabled || !side) return null;
    return this.rawRemaining(side, now) <= -this.graceMs ? side : null;
  }

  /** Start (or restart) a side's clock without touching the other side's time. */
  start(side: BoardSide): void {
    if (!this.view.enabled || this.view.flagged) return;
    this.view.running = side;
    this.view.turnStartedAt = this.now();
    this.arm();
  }

  /**
   * `mover` completed a turn: charge the time it used (floored at 0 — callers gate moves with
   * `overdue()` first), add the increment and start the opponent's clock.
   */
  switchAfterMove(mover: BoardSide): void {
    if (!this.view.enabled || this.view.flagged) return;
    const now = this.now();
    if (this.view.running === mover) {
      this.setMs(mover, Math.max(0, this.rawRemaining(mover, now)) + this.view.incrementMs);
    }
    this.view.running = otherSide(mover);
    this.view.turnStartedAt = now;
    this.arm();
  }

  /** Hand the running clock to `side` without increment (take-backs). */
  handTo(side: BoardSide): void {
    if (!this.view.enabled || this.view.flagged) return;
    this.chargeRunning();
    this.start(side);
  }

  /** Stop both clocks, charging the running side for the time it used. */
  stop(): void {
    this.scheduler.cancel(FLAG_TIMER);
    this.chargeRunning();
    this.view.running = '';
  }

  /** Mark `side` as flagged (time 0, clocks stopped). */
  flag(side: BoardSide): void {
    this.scheduler.cancel(FLAG_TIMER);
    this.setMs(side, 0);
    this.view.running = '';
    this.view.flagged = side;
  }

  private chargeRunning(): void {
    const side = this.running;
    if (!this.view.enabled || !side) return;
    this.setMs(side, this.remaining(side));
    this.view.turnStartedAt = this.now();
  }

  private rawRemaining(side: BoardSide, now: number): number {
    const base = side === 'first' ? this.view.firstMs : this.view.secondMs;
    if (!this.view.enabled || this.view.running !== side) return base;
    return base - Math.max(0, now - this.view.turnStartedAt);
  }

  private setMs(side: BoardSide, ms: number): void {
    if (side === 'first') this.view.firstMs = ms;
    else this.view.secondMs = ms;
  }

  private arm(): void {
    this.scheduler.cancel(FLAG_TIMER);
    const side = this.running;
    if (!this.view.enabled || !side) return;
    const due = this.rawRemaining(side, this.now()) + this.graceMs;
    this.scheduler.schedule(FLAG_TIMER, Math.max(0, due), () => {
      // Re-check: the clock may have been handed over/stopped while the timer was pending.
      if (this.running !== side) return;
      if (this.rawRemaining(side, this.now()) > -this.graceMs) {
        this.arm();
        return;
      }
      this.flag(side);
      this.onFlag(side);
    });
  }
}
