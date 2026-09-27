/**
 * DASception client hooks: match-guarded private payloads, the Glitch channel, and the
 * private suspicion board (client-only notes, never sent anywhere).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DECEPTION_MSG, type DeceptionNodeView, type DeceptionPrivate, type DeceptionTeamLog } from '@dascade/shared/games/deception';
import { useLatestMessage } from '../../net/hooks.ts';

/** Your private payload for the running match (null for spectators / stale payloads). */
export function useDeceptionPrivate(match: number): DeceptionPrivate | null {
  const payload = useLatestMessage<DeceptionPrivate>(DECEPTION_MSG.private);
  if (!payload || match <= 0 || payload.match !== match || !payload.role) return null;
  return payload;
}

export function useTeamLog(match: number): DeceptionTeamLog['lines'] {
  const payload = useLatestMessage<DeceptionTeamLog>(DECEPTION_MSG.team);
  return useMemo(() => (payload && payload.match === match ? payload.lines : []), [payload, match]);
}

export type SuspicionTag = 'suspect' | 'trust';

function readTags(key: string): Record<string, SuspicionTag> {
  try {
    const raw = sessionStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, SuspicionTag> = {};
    for (const [id, tag] of Object.entries(parsed as Record<string, unknown>)) if (tag === 'suspect' || tag === 'trust') out[id] = tag;
    return out;
  } catch {
    return {};
  }
}

/**
 * Private suspicion board: tap a player to cycle none → suspect → trusted. Stored only in this
 * browser tab (per room + match) — it never touches the network.
 */
export function useSuspicion(code: string, match: number) {
  const key = `dascade:deception:notes:${code}:${match}`;
  const [tags, setTags] = useState<Record<string, SuspicionTag>>(() => readTags(key));
  useEffect(() => setTags(readTags(key)), [key]);
  const cycle = useCallback(
    (id: string) => {
      setTags((prev) => {
        const next = { ...prev };
        const cur = prev[id];
        if (!cur) next[id] = 'suspect';
        else if (cur === 'suspect') next[id] = 'trust';
        else delete next[id];
        try {
          sessionStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* private mode: notes just aren't remembered */
        }
        return next;
      });
    },
    [key],
  );
  return { tags, cycle };
}

/** Remembered per tab: players at the same table can hide their role card. */
export function useHiddenRole(): [boolean, (v: boolean) => void] {
  const key = 'dascade:deception:hide-role';
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const set = useCallback((v: boolean) => {
    setHidden(v);
    try {
      sessionStorage.setItem(key, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);
  return [hidden, set];
}

export interface NodeEntry extends DeceptionNodeView {
  id: string;
}

/** Nodes in seat order. */
export function sortedNodes(nodes: Record<string, DeceptionNodeView> | undefined): NodeEntry[] {
  return Object.entries(nodes ?? {})
    .map(([id, n]) => ({ ...n, id }))
    .sort((a, b) => a.seat - b.seat);
}
