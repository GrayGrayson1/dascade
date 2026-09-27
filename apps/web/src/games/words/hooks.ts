/**
 * DASwords client hooks: typed game context, my private list (stale rounds ignored), submissions.
 */
import { useMemo } from 'react';
import {
  WORDS_MSG,
  type WordsPrivate,
  type WordsPublicState,
  type WordsSettings,
} from '@dascade/shared/games/words';
import { session, useGame, useLatestMessage } from '../../net/hooks.ts';
import { parseJson } from '../_party/index.ts';

export function useWordsGame() {
  return useGame<WordsPublicState, WordsSettings>();
}

/** My entries for the current round (null until the server sends them; stale rounds ignored). */
export function useWordsPrivate(round: number): WordsPrivate | null {
  const priv = useLatestMessage<WordsPrivate>(WORDS_MSG.private);
  return priv && priv.round === round ? priv : null;
}

export function submitWord(round: number, word: string, path?: number[]): void {
  const text = word.trim();
  if (!text) return;
  session.send(WORDS_MSG.submit, { round, word: text.slice(0, 40), ...(path && path.length ? { path } : {}) });
}

export function useJson<T>(json: string | undefined, fallback: T): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fallback is a constant per call site
  return useMemo(() => parseJson<T>(json, fallback), [json]);
}

/** Letters only, lowercase (mirrors the server's normalization for live previews). */
export function lettersOnly(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? word : many}`;
}
