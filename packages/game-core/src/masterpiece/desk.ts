/**
 * WriteDesk — collects a round's private answers. Every showdown prompt has its own party-kit
 * AnswerBox (eligible = that prompt's authors), so each writer can hold one or two prompts and
 * each answer locks on first submission (duplicates can never double-count).
 *
 * Implements the kit's collector shape (isOpen / isComplete / pending) so a PartyRoom can track it
 * for the public "who has finished writing" strip.
 */
import type { PartySubmitReason } from '@dascade/shared/party';
import { AnswerBox } from '../party/index.ts';
import type { WrittenEntry } from './plan.ts';

export interface DeskPrompt {
  showdownId: string;
  authors: readonly string[];
}

export type DeskSubmitResult = { ok: true; done: boolean } | { ok: false; reason: PartySubmitReason };

export class WriteDesk {
  private readonly boxes = new Map<string, AnswerBox<string>>();
  private readonly authorsOf = new Map<string, string[]>();
  private readonly byWriter = new Map<string, string[]>();
  private open = true;
  /** When each writer finished all their prompts (ms since openedAt). */
  private readonly finishedAt = new Map<string, number>();

  constructor(
    prompts: readonly DeskPrompt[],
    readonly openedAt: number = Date.now(),
  ) {
    for (const p of prompts) {
      this.boxes.set(p.showdownId, new AnswerBox<string>({ eligible: p.authors, openedAt }));
      this.authorsOf.set(p.showdownId, [...p.authors]);
      for (const a of p.authors) this.byWriter.set(a, [...(this.byWriter.get(a) ?? []), p.showdownId]);
    }
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Showdown ids this writer must answer. */
  promptsOf(writerId: string): string[] {
    return this.byWriter.get(writerId) ?? [];
  }

  writers(): string[] {
    return [...this.byWriter.keys()];
  }

  answerOf(writerId: string, showdownId: string): string | null {
    return this.boxes.get(showdownId)?.get(writerId)?.value ?? null;
  }

  submittedCount(writerId: string): number {
    return this.promptsOf(writerId).filter((sid) => this.answerOf(writerId, sid) !== null).length;
  }

  isDone(writerId: string): boolean {
    const prompts = this.promptsOf(writerId);
    return prompts.length > 0 && prompts.every((sid) => this.answerOf(writerId, sid) !== null);
  }

  submit(writerId: string, showdownId: string, text: string, now: number = Date.now()): DeskSubmitResult {
    if (!this.open) return { ok: false, reason: 'closed' };
    const box = this.boxes.get(showdownId);
    if (!box) return { ok: false, reason: 'stale' };
    if (!this.promptsOf(writerId).includes(showdownId)) return { ok: false, reason: 'not_eligible' };
    const result = box.submit(writerId, text, now);
    if (!result.ok) return result;
    const done = this.isDone(writerId);
    if (done && !this.finishedAt.has(writerId)) this.finishedAt.set(writerId, Math.max(0, now - this.openedAt));
    return { ok: true, done };
  }

  /** Total ms from the start of writing to each submission (for the "quick wit" award). */
  submitMs(writerId: string): number {
    let total = 0;
    for (const sid of this.promptsOf(writerId)) {
      const rec = this.boxes.get(sid)?.get(writerId);
      if (rec) total += Math.max(0, rec.firstAt - this.openedAt);
    }
    return total;
  }

  close(): void {
    this.open = false;
    for (const box of this.boxes.values()) box.close();
  }

  /** Written entries for one showdown, in author order (null = never answered). */
  entries(showdownId: string): WrittenEntry[] {
    return (this.authorsOf.get(showdownId) ?? []).map((authorId) => ({ authorId, text: this.answerOf(authorId, showdownId) }));
  }

  /** Writers among `present` who still owe an answer. */
  pending(present?: Iterable<string>): string[] {
    const pool = present ? [...present] : this.writers();
    return pool.filter((id) => this.byWriter.has(id) && !this.isDone(id));
  }

  /** Every present writer has answered everything (and at least one writer is present). */
  isComplete(present?: Iterable<string>): boolean {
    const pool = present ? [...present].filter((id) => this.byWriter.has(id)) : this.writers();
    return pool.length > 0 && this.pending(pool).length === 0;
  }
}
