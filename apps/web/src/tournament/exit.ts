/**
 * Leaving a Tournament Center match room. Every "Leave" / "Back to …" control in a match room takes
 * the player (or spectator) back to the tournament kiosk — the bracket, their next match, the
 * champion — never to the arcade floor or a cabinet picker. Leaving the kiosk itself goes back to the
 * Tournament Center landing.
 */
import { useMemo } from 'react';
import type { NavigateFunction } from 'react-router';
import { session, useSessionStore } from '../net/session.ts';
import { useRoomSelector } from '../net/hooks.ts';
import { useApp } from '../app/store.ts';
import { sfx } from '../audio/audio.ts';
import { parseMatchInfo } from './matchInfo.ts';

/** Where the Tournament Center landing lives (leaving a kiosk goes there). */
export const TOURNAMENTS_PATH = '/tournaments';

export interface TournamentExit {
  /** Kiosk room code. */
  code: string;
  name: string;
  /** The series is decided (or was resolved/cancelled by the tournament): nothing more to play here. */
  over: boolean;
  /** This client is one of the two participants of the match. */
  participant: boolean;
}

/** The tournament this room plays a match for (null outside Tournament Center match rooms). */
export function useTournamentExit(): TournamentExit | null {
  const json = useRoomSelector((s) => s.tournamentJson);
  const playerId = useSessionStore((s) => s.playerId);
  return useMemo(() => {
    const info = parseMatchInfo(json);
    if (!info) return null;
    return {
      code: info.tournamentCode,
      name: info.tournamentName,
      over: info.seriesStatus === 'decided' || info.seriesStatus === 'void',
      participant: Boolean(playerId && info.participants.some((p) => p.playerId === playerId)),
    };
  }, [json, playerId]);
}

/**
 * Leave the current room for wherever "leave" should lead: the kiosk from a match room, the
 * Tournament Center landing from a kiosk, else `fallback` (the arcade floor by default).
 */
export async function leaveRoomTo(navigate: NavigateFunction, exit: TournamentExit | null, fallback = '/'): Promise<void> {
  if (exit) {
    sfx('back');
    const res = await session.joinRoom(exit.code);
    if (res.ok) {
      navigate(`/room/${exit.code}`);
      return;
    }
    // The tournament is gone (finished and cleaned up, or cancelled): the landing lists the others.
    useApp.getState().toast('info', `${exit.name} is no longer open.`);
    session.clearNotices();
    navigate(TOURNAMENTS_PATH);
    return;
  }
  const kiosk = useSessionStore.getState().gameId === 'tournament';
  await session.leaveRoom();
  navigate(kiosk ? TOURNAMENTS_PATH : fallback);
}
