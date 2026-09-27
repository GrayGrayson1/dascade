/**
 * AnswerBox — private answer collection for ONE prompt (question, writing prompt, night action…).
 *
 * Rules:
 *  - Only eligible players may submit (eligibility can be fixed at open time or left open with `eligible: null`).
 *  - One lock per player. Without `allowChange` the first submission IS the lock; later submissions are
 *    rejected ('already_locked') — duplicate messages can never double-count.
 *  - With `allowChange`, a player may resubmit until they `lock()` or the box `close()`s.
 *  - After `close()`, everything is rejected ('closed'). Closing is idempotent.
 *  - Answer content is only ever returned by `get`/`entries` — callers keep it server-side until reveal.
 *  - `submittedAt` times use the caller's clock (pass `now`), so speed bonuses are deterministic in tests.
 */
import type { PartySubmitReason } from '@dascade/shared/party';

export interface AnswerRecord<T> {
  playerId: string;
  value: T;
  /** Time of the latest accepted submission. */
  at: number;
  /** Time of the first accepted submission. */
  firstAt: number;
  locked: boolean;
  /** Number of accepted re-submissions (0 = submitted once). */
  changes: number;
}

export type SubmitResult = { ok: true; changed: boolean; locked: boolean } | { ok: false; reason: PartySubmitReason };

export interface AnswerBoxOptions {
  /** Players may change their answer until they lock it (or the box closes). Default false. */
  allowChange?: boolean;
  /** Eligible player ids. `null`/omitted = anyone may answer. */
  eligible?: Iterable<string> | null;
  /** When the prompt opened (for elapsed-time/speed calculations). Default Date.now(). */
  openedAt?: number;
}

export class AnswerBox<T> {
  readonly allowChange: boolean;
  readonly openedAt: number;
  private readonly records = new Map<string, AnswerRecord<T>>();
  private eligible: Set<string> | null;
  private open = true;

  constructor(opts: AnswerBoxOptions = {}) {
    this.allowChange = Boolean(opts.allowChange);
    this.openedAt = opts.openedAt ?? Date.now();
    this.eligible = opts.eligible ? new Set(opts.eligible) : null;
  }

  get isOpen(): boolean {
    return this.open;
  }

  isEligible(playerId: string): boolean {
    return this.eligible === null || this.eligible.has(playerId);
  }

  /** Late joiner / reconnect: allow this player to answer. */
  addEligible(playerId: string): void {
    this.eligible?.add(playerId);
  }

  /** Player left or was eliminated: stop waiting for them (their answer, if any, is kept). */
  removeEligible(playerId: string): void {
    if (this.eligible === null) this.eligible = new Set([...this.records.keys()].filter((id) => id !== playerId));
    else this.eligible.delete(playerId);
  }

  eligibleIds(): string[] {
    return this.eligible ? [...this.eligible] : [...this.records.keys()];
  }

  submit(playerId: string, value: T, now: number = Date.now()): SubmitResult {
    if (!this.open) return { ok: false, reason: 'closed' };
    if (!this.isEligible(playerId)) return { ok: false, reason: 'not_eligible' };
    const existing = this.records.get(playerId);
    if (existing) {
      if (existing.locked) return { ok: false, reason: 'already_locked' };
      existing.value = value;
      existing.at = now;
      existing.changes += 1;
      return { ok: true, changed: true, locked: false };
    }
    const locked = !this.allowChange;
    this.records.set(playerId, { playerId, value, at: now, firstAt: now, locked, changes: 0 });
    return { ok: true, changed: false, locked };
  }

  /** Explicit lock-in (allowChange mode). Returns false if there is nothing to lock or it is already locked. */
  lock(playerId: string): boolean {
    if (!this.open) return false;
    const r = this.records.get(playerId);
    if (!r || r.locked) return false;
    r.locked = true;
    return true;
  }

  /** Stop accepting answers and lock every submission. Idempotent. */
  close(): void {
    this.open = false;
    for (const r of this.records.values()) r.locked = true;
  }

  /** Withdraw a player's answer (e.g. they were disqualified). */
  discard(playerId: string): boolean {
    return this.records.delete(playerId);
  }

  has(playerId: string): boolean {
    return this.records.has(playerId);
  }

  isLocked(playerId: string): boolean {
    return this.records.get(playerId)?.locked ?? false;
  }

  get(playerId: string): AnswerRecord<T> | undefined {
    return this.records.get(playerId);
  }

  /** Submissions in the order they first arrived. */
  entries(): AnswerRecord<T>[] {
    return [...this.records.values()];
  }

  get count(): number {
    return this.records.size;
  }

  answeredIds(): string[] {
    return [...this.records.keys()];
  }

  /** ms from open to the player's latest accepted submission (null = no answer). */
  elapsed(playerId: string): number | null {
    const r = this.records.get(playerId);
    return r ? Math.max(0, r.at - this.openedAt) : null;
  }

  /**
   * Eligible players still owing a LOCKED answer. Pass `present` (e.g. connected player ids) to
   * ignore players who can't answer right now.
   */
  pending(present?: Iterable<string>): string[] {
    const presentSet = present ? new Set(present) : null;
    const pool = this.eligible ? [...this.eligible] : presentSet ? [...presentSet] : [];
    return pool.filter((id) => (!presentSet || presentSet.has(id)) && !this.records.get(id)?.locked);
  }

  /** Every eligible (and present) player has locked in, and at least one answer exists. */
  isComplete(present?: Iterable<string>): boolean {
    return this.count > 0 && this.pending(present).length === 0;
  }
}
