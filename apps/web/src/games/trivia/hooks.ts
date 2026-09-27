/**
 * Trivia client hooks: typed game context, parsed views, private view and sounds.
 */
import { useEffect, useMemo, useRef } from 'react';
import {
  TRIVIA_MSG,
  type TriviaEvent,
  type TriviaPackInfo,
  type TriviaPrivate,
  type TriviaPublicState,
  type TriviaQuestionView,
  type TriviaRevealView,
  type TriviaSettings,
} from '@dascade/shared/games/trivia';
import { useRoomMessage } from '../../net/hooks.ts';
import { sfx } from '../../audio/audio.ts';
import { parseJson, useLatestPrivate, usePartyGame, useTimerTicks } from '../_party/index.ts';

export function useTriviaGame() {
  return usePartyGame<TriviaPublicState, TriviaSettings>();
}

export function useQuestionView(json: string | undefined): TriviaQuestionView | null {
  return useMemo(() => parseJson<TriviaQuestionView | null>(json, null), [json]);
}

export function useRevealView(json: string | undefined): TriviaRevealView | null {
  return useMemo(() => parseJson<TriviaRevealView | null>(json, null), [json]);
}

export function usePackInfo(json: string | undefined): TriviaPackInfo | null {
  return useMemo(() => parseJson<TriviaPackInfo | null>(json, null), [json]);
}

/**
 * This player's private view for question `seq` (null until something is locked / revealed).
 * `undefined` = the latest payload whatever its question (e.g. the final wager).
 */
export function useTriviaPrivate(seq: number | undefined): TriviaPrivate | null {
  return useLatestPrivate<TriviaPrivate>(TRIVIA_MSG.private, seq);
}

/**
 * Game-show sounds: whoosh on a new question, pop on lock-in, correct/wrong on your reveal,
 * ticks in the last five seconds while you still owe an answer. All through sfx() (mute-aware).
 */
export function useTriviaSounds(opts: {
  stage: string;
  seq: number | undefined;
  locked: boolean;
  canAnswer: boolean;
  priv: TriviaPrivate | null;
}): void {
  const { stage, seq, locked, canAnswer, priv } = opts;
  useRoomMessage<TriviaEvent>(TRIVIA_MSG.event, (e) => {
    if (e.type === 'question') sfx('whoosh');
    else if (e.type === 'final') sfx('ding');
  });
  useTimerTicks(stage === 'question' && canAnswer && !locked);
  const lockedSeq = useRef<number | null>(null);
  useEffect(() => {
    if (locked && seq !== undefined && lockedSeq.current !== seq) {
      lockedSeq.current = seq;
      sfx('pop');
    }
  }, [locked, seq]);
  const resultSeq = useRef<number | null>(null);
  useEffect(() => {
    if (!priv?.result || resultSeq.current === priv.seq) return;
    resultSeq.current = priv.seq;
    if (!priv.result.answered) return;
    sfx(priv.result.correct ? 'correct' : priv.result.partial ? 'ding' : 'wrong');
  }, [priv]);
}
