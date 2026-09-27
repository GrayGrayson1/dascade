import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { defineServer, defineRoom, type Room } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { isGameId, type GameId } from '@dascade/shared';
import { loadRoomClasses } from './rooms/registry.ts';
import { registerApiRoutes } from './http/routes.ts';
import { config } from './config.ts';
import { log } from './lib/log.ts';
import { stampClientIp } from './lib/clientIp.ts';
import { installPlatformServices } from './platform/index.ts';

type RoomClass = new () => Room;

export interface CreateServerOptions {
  /** Serve the built web client (production). */
  serveWeb?: boolean;
  /** Extra rooms (tests). */
  extraRooms?: Record<string, RoomClass>;
  /** Only load these game rooms (defaults to DASCADE_ONLY_GAMES env, else all). */
  games?: GameId[];
}

function envGames(): GameId[] | undefined {
  const raw = process.env.DASCADE_ONLY_GAMES;
  if (!raw) return undefined;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(isGameId);
}

function securityHeaders(req: express.Request, res: express.Response, next: express.NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // HSTS only means something over HTTPS (browsers ignore it on http), so send it when TLS was used.
  if (config.isProduction && (req.secure || req.headers['x-forwarded-proto'] === 'https')) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}

export async function createDascadeServer(options: CreateServerOptions = {}) {
  installPlatformServices();
  const rooms: Record<string, ReturnType<typeof defineRoom>> = {};
  const classes = await loadRoomClasses(options.games ?? envGames(), config.isProduction, (id, err) =>
    log.error(`Game room "${id}" failed to load — cabinet disabled`, { err: err as Error }),
  );
  for (const [id, klass] of Object.entries(classes)) rooms[id] = defineRoom(klass as unknown as RoomClass);
  for (const [name, klass] of Object.entries(options.extraRooms ?? {})) rooms[name] = defineRoom(klass);

  const server = defineServer({
    transport: new WebSocketTransport({
      server: createHttpServer(),
      maxPayload: config.maxPayloadBytes,
      pingInterval: 5000,
      pingMaxRetries: 3,
    }),
    rooms,
    greet: false,
    express: (app) => {
      app.disable('x-powered-by');
      app.use(securityHeaders);
      registerApiRoutes(app);
      if (options.serveWeb) serveWebClient(app);
    },
  });
  if (config.simulatedLatencyMs > 0) {
    log.warn(`Simulating ${config.simulatedLatencyMs}ms latency`);
    server.simulateLatency(config.simulatedLatencyMs);
  }
  return server;
}

/**
 * The HTTP server behind Colyseus + Express. Colyseus registers its matchmaking router as the
 * FIRST 'request' listener, so pre-processing has to happen at emit time:
 *  - stamp the trusted client IP (per-IP throttles must not trust client-supplied X-Forwarded-For);
 *  - refuse oversized matchmaking bodies before they are buffered and JSON-parsed.
 */
function createHttpServer(): http.Server {
  const httpServer = http.createServer();
  const emit = httpServer.emit.bind(httpServer) as (event: string, ...args: unknown[]) => boolean;
  httpServer.emit = ((event: string, ...args: unknown[]): boolean => {
    if (event === 'request' || event === 'upgrade') {
      const req = args[0] as http.IncomingMessage;
      stampClientIp(req);
      if (event === 'request' && req.method === 'POST' && req.url?.startsWith('/matchmake/')) {
        const length = Number(req.headers['content-length'] ?? 0);
        if (length > config.maxMatchmakeBodyBytes) {
          const res = args[1] as http.ServerResponse;
          res.writeHead(413, { 'content-type': 'application/json', connection: 'close' });
          res.end(JSON.stringify({ code: 413, error: 'Request too large.' }));
          return true;
        }
      }
    }
    return emit(event, ...args);
  }) as typeof httpServer.emit;
  return httpServer;
}

/** CSP for the HTML shell. Inline style attributes are used by React; no inline/eval scripts. */
function contentSecurityPolicy(): string {
  const supabase = config.supabasePublicUrl ? ` ${config.supabasePublicUrl} ${config.supabasePublicUrl.replace(/^http/, 'ws')}` : '';
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    `connect-src 'self' ws: wss:${supabase}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

function serveWebClient(app: express.Application): void {
  const dist = config.webDist;
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) {
    log.warn(`Web client not found at ${dist} — run "pnpm build" to serve it from this process.`);
    return;
  }
  const csp = contentSecurityPolicy();
  // Source maps are built ('hidden') for error tooling but not published (set SERVE_SOURCEMAPS=1 to allow).
  if (process.env.SERVE_SOURCEMAPS !== '1') {
    app.use((req, res, next) => (req.path.endsWith('.map') ? void res.status(404).end() : next()));
  }
  app.use(
    '/assets',
    express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', index: false, fallthrough: true }),
  );
  app.use(
    express.static(dist, {
      index: false,
      maxAge: '1h',
      // /index.html (or any other static HTML) gets the same CSP as the SPA fallback.
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Content-Security-Policy', csp);
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );
  // SPA fallback for client routes (never for API / matchmaking).
  app.get(/^\/(?!api\/|matchmake\/|assets\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Security-Policy', csp);
    res.sendFile(index);
  });
}
