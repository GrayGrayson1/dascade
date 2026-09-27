/**
 * DASterpiece client hooks: typed game state, the private view (stale rounds ignored) and
 * derived helpers shared by the stage components.
 */
import { useMemo } from 'react';
import {
  MASTERPIECE_MSG,
  type MasterpiecePublicState,
  type MasterpieceSettings,
  type MpHallEntry,
  type MpPrivate,
} from '@dascade/shared/games/masterpiece';
import { useLatestMessage } from '../../net/hooks.ts';
import { parseJson, usePartyGame } from '../_party/index.ts';

export function useMpGame() {
  return usePartyGame<MasterpiecePublicState, MasterpieceSettings>();
}

/** The private view for the current round (a payload from an earlier round is ignored). */
export function useMpPrivate(round: number): MpPrivate | null {
  const priv = useLatestMessage<MpPrivate>(MASTERPIECE_MSG.private);
  return priv && priv.round === round ? priv : null;
}

export function useHall(json: string | undefined): MpHallEntry[] {
  return useMemo(() => parseJson<MpHallEntry[]>(json, []), [json]);
}

/** A, B, C … Z, then AA… (galleries never exceed 10). */
export function exhibitLetter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `${String.fromCharCode(65 + Math.floor(index / 26) - 1)}${String.fromCharCode(65 + (index % 26))}`;
}

export const RANK_NAMES = ['Gold', 'Silver', 'Bronze'] as const;
