/**
 * DAS Survey client hooks: typed game state, the private per-question payload and a tiny
 * session-lifetime cache of YOUR OWN answers (the server forgets individual answers as soon
 * as answering closes, so the client keeps its own copy to show "You said …" at the reveal).
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ordinal } from '@dascade/shared';
import type { IconName } from '@dascade/ui';
import {
  SURVEY_MSG,
  parseSurveyQuestion,
  type SurveyHistoryEntry,
  type SurveyPrivate,
  type SurveyPublicState,
  type SurveyQuestion,
  type SurveyQuestionMode,
  type SurveyResult,
  type SurveyPackId,
  type SurveySettings,
} from '@dascade/shared/games/survey';
import { useGame, useLatestMessage } from '../../net/hooks.ts';
import { parseJson } from '../_party/index.ts';

export function useSurveyGame() {
  return useGame<SurveyPublicState, SurveySettings>();
}

/** The private payload for question `q` (stale payloads from earlier questions are ignored). */
export function useSurveyPrivate(q: number): SurveyPrivate | null {
  const priv = useLatestMessage<SurveyPrivate>(SURVEY_MSG.private);
  const mine = priv && priv.q === q ? priv : null;
  // Remember our own answer before the server seals the question.
  useEffect(() => {
    if (mine && mine.answered && !mine.sealed) rememberAnswer(mine.q, mine.skipped ? 'skip' : mine.answer);
  }, [mine]);
  return mine;
}

// ---------------------------------------------------------------------------
// Own-answer cache (module level: survives re-renders and reconnects within this tab)
// ---------------------------------------------------------------------------

type OwnAnswer = number | 'skip' | null;
const ownAnswers = new Map<number, OwnAnswer>();
const listeners = new Set<() => void>();
let version = 0;

export function rememberAnswer(q: number, answer: OwnAnswer): void {
  if (ownAnswers.get(q) === answer) return;
  ownAnswers.set(q, answer);
  // Keep the cache small: only the latest few questions matter.
  if (ownAnswers.size > 40) ownAnswers.delete(ownAnswers.keys().next().value as number);
  version++;
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Your own answer to question `q` (option index, 'skip', or null when unknown). */
export function useOwnAnswer(q: number): OwnAnswer {
  useSyncExternalStore(subscribe, () => version);
  return ownAnswers.get(q) ?? null;
}

// ---------------------------------------------------------------------------
// Parsed state slices
// ---------------------------------------------------------------------------

export function useQuestion(json: string | undefined): SurveyQuestion | null {
  return useMemo(() => parseSurveyQuestion(json), [json]);
}

export function useResult(json: string | undefined): SurveyResult | null {
  return useMemo(() => parseJson<SurveyResult | null>(json, null), [json]);
}

export function useHistory(json: string | undefined): SurveyHistoryEntry[] {
  return useMemo(() => parseJson<SurveyHistoryEntry[]>(json, []), [json]);
}

// ---------------------------------------------------------------------------
// Presentation constants
// ---------------------------------------------------------------------------

export const MODE_ICON: Record<SurveyQuestionMode, IconName> = {
  majority: 'crown',
  rank: 'trophy',
  percent: 'sparkle',
};

/** Mode colours (always paired with the mode name + icon). */
export const MODE_COLOR: Record<SurveyQuestionMode, string> = {
  majority: 'var(--accent)',
  rank: 'var(--yellow)',
  percent: 'var(--accent-2)',
};

/** Pack art (AVATAR_ART keys from @dascade/ui, drawn with <PixelArt>). */
export const PACK_ART: Record<SurveyPackId, string> = {
  office: 'disk',
  food: 'pizza',
  weekend: 'coffee',
  tech: 'robot',
  whatif: 'alien',
  travel: 'rocket',
};

/** "2nd" / "2nd–3rd" for a (possibly tied) rank range. */
export function rankLabel(lo: number, hi: number): string {
  return lo === hi ? ordinal(lo) : `${ordinal(lo)}–${ordinal(hi)}`;
}
