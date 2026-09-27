/**
 * Hydrates ratings + stats for an identity from the database the first time this process sees it,
 * so an update after a server restart builds on the stored numbers instead of starting over.
 *
 * With persistence disabled (local dev, tests) everything runs synchronously. With it enabled, an
 * update for identities that are still loading is queued behind their load; loads for the same
 * identity are shared, so updates for one player are applied in the order they were reported.
 */
import { log } from '../lib/log.ts';
import { hydrateRating } from './ratings.ts';
import { hydrateStatLine } from './stats.ts';
import { statsPersistence } from './statsPersistence.ts';

const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();

/** Resolves once `identity` has been hydrated (immediately when persistence is off or it already is). */
export function ensureIdentityLoaded(identity: string): Promise<void> | null {
  if (!statsPersistence.enabled || loaded.has(identity)) return null;
  const inflight = loading.get(identity);
  if (inflight) return inflight;
  const p = statsPersistence
    .loadIdentity(identity)
    .then((snap) => {
      for (const r of snap.ratings) hydrateRating(identity, r.gameId, r.rating);
      for (const line of snap.stats) hydrateStatLine(identity, line);
    })
    .catch((err: unknown) => log.warn('identity hydration failed', { err: err as Error }))
    .finally(() => {
      loaded.add(identity);
      loading.delete(identity);
    });
  loading.set(identity, p);
  return p;
}

/**
 * Run `fn` once every identity is hydrated — synchronously when nothing needs loading.
 * Errors thrown by `fn` in the deferred path are logged (the synchronous path throws to the caller).
 */
export function withIdentitiesLoaded(identities: Iterable<string>, fn: () => void): void {
  const pending: Array<Promise<void>> = [];
  for (const id of identities) {
    const p = ensureIdentityLoaded(id);
    if (p) pending.push(p);
  }
  if (pending.length === 0) {
    fn();
    return;
  }
  void Promise.all(pending).then(() => {
    try {
      fn();
    } catch (err) {
      log.error('deferred stats update failed', { err: err as Error });
    }
  });
}

let warmed = false;

/** Startup warm-up: recently active ratings, so rating-based seeding is right straight after a restart. */
export function warmRatings(limit = 5000): void {
  if (warmed || !statsPersistence.enabled) return;
  warmed = true;
  void statsPersistence.loadRecentRatings(limit).then((rows) => {
    for (const r of rows) hydrateRating(r.identity, r.gameId, r.rating);
    if (rows.length > 0) log.info('ratings warmed', { count: rows.length });
  });
}

/** Tests only. */
export function resetIdentityLoads(): void {
  loaded.clear();
  loading.clear();
}
