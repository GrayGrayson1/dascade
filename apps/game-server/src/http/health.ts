/**
 * GET /api/health: is the server up, and what is it holding.
 *
 * `ok`, `uptimeSeconds` and `rooms` are the original fields (ShowRecovery and crew tools read them).
 * Everything else was added later, additively; never rename or remove a field (docs/SHOWDOWN.md).
 */
import { matchMaker } from '@colyseus/core';
import type { RoomMetadata } from '@dascade/shared';
import { processStartedAt, runningCommit } from '../lib/process.ts';

/** One game's live multiplayer rooms (solo rooms aren't counted) and the seated players in them (spectators aren't). */
export interface GameLoad {
  rooms: number;
  players: number;
}

export interface HealthReport {
  ok: true;
  uptimeSeconds: number;
  /** Every live room, solo rooms included. */
  rooms: number;
  /** Clients the rooms hold, spectators included (a dropped player counts until their reconnect grace ends). */
  clients: number;
  /** The commit this process runs (Render's RENDER_GIT_COMMIT, shortened), or null when unknown. */
  commit: string | null;
  /** Resident memory in MB. */
  rssMb: number;
  /** Keyed by game id; lists only games with at least one multiplayer room (a missing game has none). */
  games: Record<string, GameLoad>;
}

export type LiveRooms = Pick<HealthReport, 'rooms' | 'clients' | 'games'>;

interface RoomListing {
  name: string;
  clients: number;
  metadata?: unknown;
}

export function summarizeRooms(listings: readonly RoomListing[]): LiveRooms {
  const games: Record<string, GameLoad> = {};
  let clients = 0;
  for (const room of listings) {
    clients += room.clients;
    const meta = (room.metadata ?? {}) as Partial<RoomMetadata>;
    if (meta.solo) continue;
    const load = (games[meta.gameId ?? room.name] ??= { rooms: 0, players: 0 });
    load.rooms++;
    // RoomMetadata.players counts seated players, never spectators.
    load.players += meta.players ?? 0;
  }
  return { rooms: listings.length, clients, games };
}

/** The rooms this process holds right now. */
export async function liveRooms(): Promise<LiveRooms> {
  return summarizeRooms(await matchMaker.query({}));
}

export async function healthReport(now = Date.now()): Promise<HealthReport> {
  const live = await liveRooms();
  return {
    ok: true,
    uptimeSeconds: Math.round((now - processStartedAt) / 1000),
    rooms: live.rooms,
    clients: live.clients,
    commit: runningCommit() || null,
    rssMb: Math.round(process.memoryUsage.rss() / (1024 * 1024)),
    games: live.games,
  };
}
