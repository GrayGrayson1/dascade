/**
 * React bindings for the Classics kit: standings/meta selectors, a tiny external HUD store for
 * values the game loop updates (no per-frame React state), verified high-score fetching and
 * a per-device personal best.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ClassicsMetaView, ClassicsPublicState, ClassicsStandingView, HighScoreBoardView } from '@dascade/shared/games/classics';
import { useRoomSelector } from '../../net/hooks.ts';
import { useSessionStore } from '../../net/session.ts';
import { serverUrl } from '../../net/serverUrl.ts';

// ---------------------------------------------------------------------------
// Room selectors
// ---------------------------------------------------------------------------

export interface StandingRow extends ClassicsStandingView {
  id: string;
}

function standingsEqual(a: StandingRow[], b: StandingRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.id !== y.id || x.score !== y.score || x.status !== y.status || x.rank !== y.rank || x.level !== y.level || x.lives !== y.lives || x.stat !== y.stat || x.name !== y.name || x.best !== y.best) return false;
  }
  return true;
}

/** Standings sorted by rank (live score rank, or the final placement once a match is decided), then score. */
export function useStandings(): StandingRow[] {
  const rows = useRoomSelector<ClassicsPublicState, StandingRow[]>(
    (s) =>
      Object.entries(s.standings ?? {})
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => (a.rank || 9999) - (b.rank || 9999) || b.score - a.score || a.name.localeCompare(b.name)),
    standingsEqual,
  );
  return rows ?? [];
}

export function useClassicsMeta(): ClassicsMetaView | null {
  return useRoomSelector<ClassicsPublicState, ClassicsMetaView | null>((s) => s.classics ?? null);
}

export function useMyId(): string | null {
  return useSessionStore((s) => s.playerId);
}

export function useMyStanding(): ClassicsStandingView | null {
  const me = useMyId();
  return useRoomSelector<ClassicsPublicState, ClassicsStandingView | null>((s) => (me ? (s.standings?.[me] ?? null) : null));
}

// ---------------------------------------------------------------------------
// HUD store (written by the game loop, read by React only when a value changes)
// ---------------------------------------------------------------------------

export interface HudStore<T extends Record<string, unknown>> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(listener: () => void): () => void;
}

export function createHudStore<T extends Record<string, unknown>>(initial: T): HudStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(patch) {
      let dirty = false;
      for (const k of Object.keys(patch) as Array<keyof T>) {
        if (!Object.is(value[k], patch[k])) {
          dirty = true;
          break;
        }
      }
      if (!dirty) return;
      value = { ...value, ...patch };
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useHud<T extends Record<string, unknown>, R>(store: HudStore<T>, select: (v: T) => R): R {
  const sel = useRef(select);
  sel.current = select;
  return useSyncExternalStore(
    store.subscribe,
    () => sel.current(store.get()),
    () => sel.current(store.get()),
  );
}

// ---------------------------------------------------------------------------
// High scores
// ---------------------------------------------------------------------------

export async function fetchBoard(gameId: string, board: string): Promise<HighScoreBoardView> {
  const res = await fetch(`${serverUrl()}/api/classics/scores/${encodeURIComponent(gameId)}?board=${encodeURIComponent(board)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`scores ${res.status}`);
  return (await res.json()) as HighScoreBoardView;
}

/** Top verified scores for a board; `refresh` changes (e.g. a verdict id) trigger a refetch. */
export function useHighScores(gameId: string, board: string, refresh: unknown = 0): { data: HighScoreBoardView | null; error: boolean; loading: boolean } {
  const [state, setState] = useState<{ data: HighScoreBoardView | null; error: boolean; loading: boolean }>({ data: null, error: false, loading: true });
  useEffect(() => {
    if (!board) {
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

// ---------------------------------------------------------------------------
// Personal best (this device), updated from server verdicts only
// ---------------------------------------------------------------------------

const bestKey = (gameId: string, board: string) => `dascade.classics.best.${gameId}.${board || 'casual'}`;

export function readBest(gameId: string, board: string): number {
  try {
    const n = Number(localStorage.getItem(bestKey(gameId, board)) ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function writeBest(gameId: string, board: string, score: number): boolean {
  const prev = readBest(gameId, board);
  if (score <= prev) return false;
  try {
    localStorage.setItem(bestKey(gameId, board), String(Math.floor(score)));
  } catch {
    /* storage unavailable: the in-room best still shows */
  }
  return true;
}

export function usePersonalBest(gameId: string, board: string): [number, (score: number) => boolean] {
  const [best, setBest] = useState(() => readBest(gameId, board));
  useEffect(() => setBest(readBest(gameId, board)), [gameId, board]);
  const submit = useCallback(
    (score: number) => {
      const improved = writeBest(gameId, board, score);
      if (improved) setBest(Math.floor(score));
      return improved;
    },
    [gameId, board],
  );
  return [best, submit];
}
