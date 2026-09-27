/** HTTP helpers for the Tournament Center landing (no room connection needed). */
import type { TournamentListResponse, TournamentListing } from '@dascade/shared';
import { serverUrl } from '../net/serverUrl.ts';

export async function fetchTournaments(signal?: AbortSignal): Promise<TournamentListing[]> {
  const res = await fetch(`${serverUrl()}/api/tournaments`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as Partial<TournamentListResponse>;
  return Array.isArray(body.tournaments) ? body.tournaments : [];
}

/** Per-tournament secrets kept in this browser (participant + organizer tokens from `tournament:me`). */
export interface StoredTournamentTokens {
  participantToken?: string;
  organizerToken?: string;
  savedAt: number;
}

const KEY = (code: string) => `dascade:tournament:${code}`;
const TTL_MS = 14 * 24 * 3600_000;

export function loadTournamentTokens(code: string): StoredTournamentTokens | null {
  try {
    const raw = localStorage.getItem(KEY(code));
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredTournamentTokens;
    if (!v || typeof v !== 'object' || Date.now() - (v.savedAt ?? 0) > TTL_MS) return null;
    return v;
  } catch {
    return null;
  }
}

export function saveTournamentTokens(code: string, patch: Partial<Omit<StoredTournamentTokens, 'savedAt'>>): void {
  try {
    const prev = loadTournamentTokens(code) ?? { savedAt: 0 };
    const next: StoredTournamentTokens = { ...prev, ...patch, savedAt: Date.now() };
    if (
      next.participantToken === prev.participantToken &&
      next.organizerToken === prev.organizerToken &&
      Date.now() - prev.savedAt < 60_000
    )
      return;
    localStorage.setItem(KEY(code), JSON.stringify(next));
    pruneTournamentTokens();
  } catch {
    /* storage unavailable: the tokens just won't survive a reload */
  }
}

function pruneTournamentTokens(): void {
  const prefix = KEY('');
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k?.startsWith(prefix)) continue;
    try {
      const v = JSON.parse(localStorage.getItem(k) ?? 'null') as StoredTournamentTokens | null;
      if (!v || Date.now() - (v.savedAt ?? 0) > TTL_MS) localStorage.removeItem(k);
    } catch {
      localStorage.removeItem(k);
    }
  }
}
