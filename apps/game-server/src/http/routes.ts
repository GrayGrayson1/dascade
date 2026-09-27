import type express from 'express';
import { matchMaker } from '@colyseus/core';
import { KeyedRateLimiter, isValidRoomCode, normalizeRoomCode, type RoomLookup, type RoomMetadata } from '@dascade/shared';
import { config } from '../config.ts';
import { CLIENT_IP_HEADER, ipRateKey } from '../lib/clientIp.ts';
import { registerStatsRoutes } from '../platform/statsRoutes.ts';
import { registerClassicsRoutes } from '../rooms/classics/scoresRoute.ts';
import { registerTournamentRoutes } from './tournamentRoutes.ts';

const startedAt = Date.now();

// Room lookups reveal whether a code is live: throttle per IP so codes can't be enumerated,
// while staying generous for offices where everyone shares one public address.
const lookupLimiter = new KeyedRateLimiter(config.relaxedLimits ? { burst: 5000, perSecond: 500 } : { burst: 300, perSecond: 10 });

export function registerApiRoutes(app: express.Application): void {
  registerStatsRoutes(app);
  registerClassicsRoutes(app);
  registerTournamentRoutes(app);
  app.get('/api/health', async (_req, res) => {
    const rooms = await matchMaker.query({});
    res.json({ ok: true, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), rooms: rooms.length });
  });

  app.get('/api/rooms/:code', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ip = String(req.headers[CLIENT_IP_HEADER] ?? req.socket.remoteAddress ?? 'unknown');
    if (!lookupLimiter.take(ipRateKey(ip))) {
      res.status(429).json({ error: 'Too many lookups — please wait a moment.' });
      return;
    }
    const code = normalizeRoomCode(String(req.params.code ?? ''));
    const lookup: RoomLookup = { exists: false, code };
    if (!isValidRoomCode(code)) {
      res.status(200).json(lookup);
      return;
    }
    const [room] = await matchMaker.query({ roomId: code });
    if (!room) {
      res.status(200).json(lookup);
      return;
    }
    const meta = (room.metadata ?? {}) as Partial<RoomMetadata>;
    const players = meta.players ?? room.clients;
    const maxPlayers = meta.maxPlayers ?? room.maxClients;
    res.json({
      exists: true,
      code,
      gameId: meta.gameId ?? room.name,
      roomName: meta.roomName,
      phase: meta.phase,
      players,
      maxPlayers,
      locked: Boolean(meta.locked),
      full: players >= maxPlayers,
      allowSpectators: meta.allowSpectators ?? true,
    } satisfies RoomLookup);
  });
}
