/** GET /api/stats/me — the current player's stats + DASCADE ratings (guest id or verified account). */
import { STATS_ROUTE, type PlayerStatsResponse } from '@dascade/shared/stats';
import { serverUrl } from '../../net/serverUrl.ts';
import { persistence } from '../../persistence/index.ts';

export async function fetchMyStats(guestId: string, signal?: AbortSignal): Promise<PlayerStatsResponse> {
  const token = await persistence()
    .accessToken()
    .catch(() => undefined);
  const url = `${serverUrl()}${STATS_ROUTE}?guestId=${encodeURIComponent(guestId)}`;
  const res = await fetch(url, { cache: 'no-store', signal, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as Partial<PlayerStatsResponse>;
  return {
    identity: body.identity ?? 'none',
    games: Array.isArray(body.games) ? body.games : [],
    ratings: Array.isArray(body.ratings) ? body.ratings : [],
    persisted: Boolean(body.persisted),
  };
}
