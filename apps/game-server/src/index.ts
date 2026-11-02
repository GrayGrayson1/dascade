import { createDascadeServer } from './server.ts';
import { config, supabaseEnabled } from './config.ts';
import { liveRooms } from './http/health.ts';
import { log } from './lib/log.ts';
import { drainWrites } from './lib/pendingWrites.ts';
import { statsPersistence } from './platform/statsPersistence.ts';

/** How long a clean shutdown waits for queued/in-flight database writes. */
const SHUTDOWN_FLUSH_MS = 8_000;

// Node 22 turns an unhandled rejection into an uncaught exception, which Colyseus answers by shutting
// the whole server down: one stray promise must not end every room. Log it and keep serving.
process.on('unhandledRejection', (reason: unknown) => {
  log.error('unhandled promise rejection', { err: reason instanceof Error ? reason : new Error(String(reason)) });
});

const server = await createDascadeServer({ serveWeb: config.isProduction || process.env.SERVE_WEB === '1' });

// SIGTERM (deploy, instance sleep): say what's being dropped, then rooms are disposed (tournaments save
// their final snapshot), then queued stats/ratings, high scores, tournament and match writes get a
// bounded moment to finish.
server.onBeforeShutdown(async () => {
  const live = await liveRooms().catch(() => null);
  if (live) log.info(`shutting down with ${live.rooms} rooms / ${live.clients} clients`, { games: live.games });
});
server.onShutdown(async () => {
  const settled = await drainWrites(SHUTDOWN_FLUSH_MS, [() => statsPersistence.flush()]);
  if (!settled) log.warn('shutdown: some database writes did not finish in time', { waitedMs: SHUTDOWN_FLUSH_MS });
});

await server.listen(config.port, config.host);
log.info(`DASCADE game server listening on http://${config.host}:${config.port}`, {
  persistence: supabaseEnabled ? 'supabase' : 'none',
  mode: config.isProduction ? 'production' : 'development',
});
