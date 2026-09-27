/**
 * GET /api/classics/scores/:gameId?board=<key>  →  HighScoreBoardView (top CLASSICS.boardSize).
 * Public, read-only, throttled per IP. Unknown games/boards return 404/400 without detail.
 */
import type express from 'express';
import { GAME_CATALOG, KeyedRateLimiter, isGameId } from '@dascade/shared';
import { BOARD_KEY_RE } from '@dascade/shared/games/classics';
import { config } from '../../config.ts';
import { CLIENT_IP_HEADER, ipRateKey } from '../../lib/clientIp.ts';
import { highScores } from './highScores.ts';
import { createHighScorePersistence } from './highScorePersistence.ts';

const limiter = new KeyedRateLimiter(config.relaxedLimits ? { burst: 5000, perSecond: 500 } : { burst: 60, perSecond: 4 });

/** Default board per game when the query omits one. */
const DEFAULT_BOARD: Record<string, string> = {
  bricks: 'arcade',
  blocks: 'marathon',
  memory: 'classic',
  paddle: 'pro-classic-to7',
  snake: 'solo-normal',
  asteroids: 'pilot',
};

export function registerClassicsRoutes(app: express.Application): void {
  // Optional durable mirror (Supabase configured) — installed once with the API routes.
  const persistence = createHighScorePersistence();
  if (persistence) highScores.setPersistence(persistence);
  app.get('/api/classics/scores/:gameId', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ip = String(req.headers[CLIENT_IP_HEADER] ?? req.socket.remoteAddress ?? 'unknown');
    if (!limiter.take(ipRateKey(ip))) {
      res.status(429).json({ error: 'Too many requests — please wait a moment.' });
      return;
    }
    const gameId = String(req.params.gameId ?? '');
    if (!isGameId(gameId) || GAME_CATALOG[gameId].cabinet !== 'classics') {
      res.status(404).json({ error: 'Unknown game.' });
      return;
    }
    const raw = typeof req.query.board === 'string' ? req.query.board : (DEFAULT_BOARD[gameId] ?? 'arcade');
    if (!BOARD_KEY_RE.test(raw)) {
      res.status(400).json({ error: 'Invalid board.' });
      return;
    }
    res.json(highScores.top(gameId, raw));
  });
}
