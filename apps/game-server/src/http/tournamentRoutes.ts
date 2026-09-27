/**
 * GET /api/tournaments — live public tournaments for the Tournament Center landing list.
 * Unlisted, draft and cancelled tournaments are never listed (unlisted ones are joined by code).
 */
import type express from 'express';
import { KeyedRateLimiter, type TournamentListResponse, type TournamentListing } from '@dascade/shared';
import { config } from '../config.ts';
import { CLIENT_IP_HEADER, ipRateKey } from '../lib/clientIp.ts';
import { listTournaments } from '../platform/tournaments.ts';

const MAX_LISTED = 60;
const limiter = new KeyedRateLimiter(config.relaxedLimits ? { burst: 5000, perSecond: 500 } : { burst: 60, perSecond: 2 });

/** Joinable first, then running, then finished; newest first within each group. */
const STATUS_ORDER: Record<TournamentListing['status'], number> = {
  REGISTRATION: 0,
  CHECK_IN: 1,
  READY: 2,
  IN_PROGRESS: 3,
  COMPLETE: 4,
  DRAFT: 5,
  CANCELLED: 6,
};

export function registerTournamentRoutes(app: express.Application): void {
  app.get('/api/tournaments', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ip = String(req.headers[CLIENT_IP_HEADER] ?? req.socket.remoteAddress ?? 'unknown');
    if (!limiter.take(ipRateKey(ip))) {
      res.status(429).json({ error: 'Too many requests — please wait a moment.' });
      return;
    }
    const tournaments = listTournaments()
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.createdAt - a.createdAt)
      .slice(0, MAX_LISTED);
    res.json({ tournaments } satisfies TournamentListResponse);
  });
}
