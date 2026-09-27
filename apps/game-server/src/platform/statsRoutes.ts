/**
 * GET /api/stats/me — the calling player's DASCADE stats and ratings.
 *
 * Identity: a verified Supabase account (`Authorization: Bearer <access token>`) when present and
 * valid, otherwise the browser's guest id (`?guestId=`). Guest ids are best-effort identities (the
 * same trust level the rating system already uses for office play); stats are not sensitive.
 */
import type express from 'express';
import { KeyedRateLimiter } from '@dascade/shared';
import { StatsQuerySchema, STATS_ROUTE, type PlayerStatsResponse } from '@dascade/shared/stats';
import { config } from '../config.ts';
import { CLIENT_IP_HEADER, ipRateKey } from '../lib/clientIp.ts';
import { matchSink } from '../persistence/index.ts';
import { ratingIdentity, ratingsForIdentity } from './ratings.ts';
import { statsForIdentity } from './stats.ts';
import { ensureIdentityLoaded } from './statsLoader.ts';
import { statsPersistence } from './statsPersistence.ts';

const limiter = new KeyedRateLimiter(config.relaxedLimits ? { burst: 5000, perSecond: 500 } : { burst: 60, perSecond: 2 });
/** How long a request waits for the database before answering with what this process holds. */
const LOAD_WAIT_MS = 3_000;

function bearer(req: express.Request): string | null {
  const raw = req.headers.authorization;
  if (typeof raw !== 'string') return null;
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]{10,4096})$/.exec(raw.trim());
  return m ? m[1]! : null;
}

export function registerStatsRoutes(app: express.Application): void {
  app.get(STATS_ROUTE, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ip = String(req.headers[CLIENT_IP_HEADER] ?? req.socket.remoteAddress ?? 'unknown');
    if (!limiter.take(ipRateKey(ip))) {
      res.status(429).json({ error: 'Too many requests — please wait a moment.' });
      return;
    }
    const parsed = StatsQuerySchema.safeParse({ guestId: typeof req.query.guestId === 'string' ? req.query.guestId : undefined });
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid guest id.' });
      return;
    }
    const token = bearer(req);
    const userId = token ? await matchSink.verifyUser(token) : null;
    const identity = ratingIdentity({ userId: userId ?? undefined, guestId: parsed.data.guestId });
    const body: PlayerStatsResponse = {
      identity: userId ? 'account' : identity ? 'guest' : 'none',
      games: [],
      ratings: [],
      persisted: statsPersistence.enabled,
    };
    if (identity) {
      // Hydration may be retrying (database hiccup): don't hold the request for it.
      const load = ensureIdentityLoaded(identity);
      if (load) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([load.catch(() => undefined), new Promise<void>((resolve) => (timer = setTimeout(resolve, LOAD_WAIT_MS)))]);
        clearTimeout(timer);
      }
      body.games = statsForIdentity(identity);
      body.ratings = ratingsForIdentity(identity);
    }
    res.json(body);
  });
}
