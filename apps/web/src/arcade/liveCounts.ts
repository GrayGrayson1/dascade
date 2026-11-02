/**
 * "Live now" on the cabinet plaques, from GET /api/health's optional `games` field (frozen contract 1:
 * `{ [gameId]: { rooms, players } }`, multiplayer rooms only, players = seated non-spectators). A missing
 * field means "no data" (an older server): nothing shows. A game without rooms is absent: 0.
 */
import { isGameId, type CabinetDef, type GameId } from '@dascade/shared';

export interface LiveCount {
  rooms: number;
  players: number;
}
export type LiveGames = Partial<Record<GameId, LiveCount>>;

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** The health body's `games`, validated; null when the field is missing or malformed. */
export function parseLiveGames(raw: unknown): LiveGames | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: LiveGames = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isGameId(id) || !v || typeof v !== 'object') continue;
    const rooms = count((v as Record<string, unknown>).rooms);
    if (rooms > 0) out[id] = { rooms, players: count((v as Record<string, unknown>).players) };
  }
  return out;
}

/** Live rooms and players across a cabinet's games (sub-modes sharing a game count once), or null when none. */
export function cabinetLive(cabinet: Pick<CabinetDef, 'games'>, games: LiveGames | null | undefined): LiveCount | null {
  if (!games) return null;
  let rooms = 0;
  let players = 0;
  for (const id of new Set(cabinet.games.map((g) => g.gameId))) {
    const live = games[id];
    if (!live) continue;
    rooms += live.rooms;
    players += live.players;
  }
  return rooms > 0 ? { rooms, players } : null;
}

/** "2 rooms live · 9 playing" (the player half only when someone is seated). */
export function liveLabel(live: LiveCount): string {
  const rooms = `${live.rooms} ${live.rooms === 1 ? 'room' : 'rooms'} live`;
  return live.players > 0 ? `${rooms} · ${live.players} playing` : rooms;
}
