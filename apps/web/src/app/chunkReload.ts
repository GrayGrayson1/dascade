/**
 * Stale-deploy recovery. Every deploy replaces /assets, so a tab opened before it asks for chunk
 * hashes that now 404 (the next lazy screen, game or skin fails to import). Reloading picks up the
 * new build — once: a sessionStorage timestamp stops a chunk that is genuinely broken from
 * reload-looping the tab (the error screen shows instead).
 */

const RELOAD_KEY = 'dascade:chunk-reload-at';
/** A second chunk failure this soon after an automatic reload is a real error, not a stale tab. */
export const CHUNK_RELOAD_WINDOW_MS = 30_000;

const CHUNK_ERROR_RE =
  /dynamically imported module|Importing a module script failed|Failed to fetch dynamically imported|error loading dynamically imported module|Unable to preload CSS/i;

/** Whether an error is a failed lazy chunk / module preload (Chrome, Safari and Firefox wordings). */
export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'string') return CHUNK_ERROR_RE.test(err);
  const e = err as { name?: unknown; message?: unknown };
  if (e.name === 'ChunkLoadError') return true;
  return typeof e.message === 'string' && CHUNK_ERROR_RE.test(e.message);
}

type GuardStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Claims the one automatic reload allowed per window (and records it). False when a reload was
 * attempted within `windowMs`, or when storage is unavailable (no guard → no automatic reload).
 */
export function claimChunkReload(storage: GuardStorage | null, now: number, windowMs = CHUNK_RELOAD_WINDOW_MS): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(RELOAD_KEY));
    if (Number.isFinite(last) && last > 0 && now >= last && now - last < windowMs) return false;
    storage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

let reloading = false;

/** True once an automatic reload is under way (screens render a quiet "updating" state meanwhile). */
export function isReloadingForUpdate(): boolean {
  return reloading;
}

/** Reloads the page to pick up a new deploy. False (and no reload) when one was just tried. */
export function reloadForNewDeploy(): boolean {
  if (reloading) return true;
  if (!claimChunkReload(sessionStorageOrNull(), Date.now())) return false;
  reloading = true;
  location.reload();
  return true;
}

/**
 * Vite dispatches `vite:preloadError` when a dynamic import or its CSS fails to load. Reload once
 * instead of letting the import reject (preventDefault swallows the error while the page reloads);
 * when the guard refuses, the error propagates to the nearest ErrorBoundary as usual.
 */
export function installChunkReload(target: Window = window): void {
  target.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewDeploy()) event.preventDefault();
  });
}
