/**
 * Verified Classics high scores: fetching a board, the hook and the score format. No room or session
 * imports, so the arcade's Classics picker can lazy-load the board without the Colyseus client.
 * (useClassics.ts and Hud.tsx re-export these for the games.)
 */
import { useEffect, useState } from 'react';
import type { HighScoreBoardView } from '@dascade/shared/games/classics';
import { serverUrl } from '../../net/serverUrl.ts';

export function formatScore(n: number): string {
  return Math.max(0, Math.floor(n)).toLocaleString('en-US');
}

/** One board's top scores; `board` null = the game's default board (the server picks it). */
export async function fetchBoard(gameId: string, board: string | null): Promise<HighScoreBoardView> {
  const query = board === null ? '' : `?board=${encodeURIComponent(board)}`;
  const res = await fetch(`${serverUrl()}/api/classics/scores/${encodeURIComponent(gameId)}${query}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`scores ${res.status}`);
  return (await res.json()) as HighScoreBoardView;
}

/**
 * Top verified scores for a board ('' = unranked: nothing to fetch; null = the default board);
 * `refresh` changes (e.g. a verdict id) trigger a refetch.
 */
export function useHighScores(
  gameId: string,
  board: string | null,
  refresh: unknown = 0,
): { data: HighScoreBoardView | null; error: boolean; loading: boolean } {
  const [state, setState] = useState<{ data: HighScoreBoardView | null; error: boolean; loading: boolean }>({
    data: null,
    error: false,
    loading: true,
  });
  useEffect(() => {
    if (board === '') {
      setState({ data: null, error: false, loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fetchBoard(gameId, board)
      .then((data) => alive && setState({ data, error: false, loading: false }))
      .catch(() => alive && setState((s) => ({ data: s.data, error: true, loading: false })));
    return () => {
      alive = false;
    };
  }, [gameId, board, refresh]);
  return state;
}
