/**
 * Question planning: which questions a game asks, in which order.
 *
 *  - Single-kind modes draw that kind from the selected packs.
 *  - Mixed interleaves the three kinds in a shuffled cycle (e.g. percent → majority → rank → …)
 *    so no kind repeats back-to-back while every kind has questions left.
 *  - Custom plays the host's questions in the order they were written (all of them).
 *  - The deck remembers which built-in questions this room has already seen and prefers fresh
 *    ones; once a pool runs dry it quietly recycles the oldest.
 */
import { shuffleInPlace, type Rng } from '@dascade/shared';
import {
  SURVEY_QUESTION_MODES,
  type SurveyGameMode,
  type SurveyPackId,
  type SurveyQuestion,
  type SurveyQuestionMode,
} from '@dascade/shared/games/survey';
import { SURVEY_PACKS } from './packs.ts';

export interface PlanInput {
  mode: SurveyGameMode;
  count: number;
  packs: readonly SurveyPackId[];
  custom: readonly SurveyQuestion[];
}

/** Built-in questions available for a pack selection, per kind. */
export function poolFor(packs: readonly SurveyPackId[], mode?: SurveyQuestionMode): SurveyQuestion[] {
  const out: SurveyQuestion[] = [];
  for (const id of new Set(packs)) for (const q of SURVEY_PACKS[id] ?? []) if (!mode || q.mode === mode) out.push(q);
  return out;
}

/** How many questions a game with these settings would actually ask. */
export function plannedCount(input: PlanInput): number {
  if (input.mode === 'custom') return input.custom.length;
  const available = input.mode === 'mixed' ? poolFor(input.packs).length : poolFor(input.packs, input.mode).length;
  return Math.min(input.count, available);
}

const cloneQuestion = (q: SurveyQuestion): SurveyQuestion => ({ ...q, options: [...q.options] });

export class QuestionDeck {
  /** Built-in question ids already asked in this room, oldest first. */
  private readonly seen = new Set<string>();

  plan(input: PlanInput, rng: Rng): SurveyQuestion[] {
    if (input.mode === 'custom') return input.custom.map(cloneQuestion);
    const count = Math.max(0, Math.floor(input.count));
    const queues = new Map<SurveyQuestionMode, SurveyQuestion[]>();
    for (const mode of SURVEY_QUESTION_MODES) queues.set(mode, this.queue(poolFor(input.packs, mode), rng));

    const kinds: SurveyQuestionMode[] = input.mode === 'mixed' ? shuffleInPlace([...SURVEY_QUESTION_MODES], rng) : [input.mode];
    const out: SurveyQuestion[] = [];
    let cursor = 0;
    let misses = 0;
    while (out.length < count && misses < kinds.length) {
      const kind = kinds[cursor % kinds.length] as SurveyQuestionMode;
      cursor++;
      const next = queues.get(kind)?.shift();
      if (!next) {
        misses++;
        continue;
      }
      misses = 0;
      out.push(cloneQuestion(next));
    }
    for (const q of out) this.markSeen(q.id);
    return out;
  }

  /** Unseen questions first (shuffled), then previously seen ones, oldest first. */
  private queue(pool: SurveyQuestion[], rng: Rng): SurveyQuestion[] {
    const fresh = shuffleInPlace(
      pool.filter((q) => !this.seen.has(q.id)),
      rng,
    );
    const order = [...this.seen];
    const stale = pool.filter((q) => this.seen.has(q.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return [...fresh, ...stale];
  }

  private markSeen(id: string): void {
    this.seen.delete(id); // re-insert: Set order = oldest first
    this.seen.add(id);
  }

  hasSeen(id: string): boolean {
    return this.seen.has(id);
  }

  reset(): void {
    this.seen.clear();
  }
}
