/**
 * Arcade memory + cabinet ⇄ screen transitions.
 *
 * Memory: the arcade remembers the last cabinet you opened (so the lineup comes
 * back centred on it) and, per multi-game cabinet, the last game you picked (so
 * the picker comes back focused on it). Stored under a versioned key in
 * localStorage. Older builds stored a bare GameId in sessionStorage
 * ('dascade:arcade:last'); it is migrated once (holdem / blackjack / dasino →
 * the DASino cabinet). Every read and write is fail-safe: bad JSON, unknown ids
 * or unavailable storage never throw.
 *
 * Transitions use the View Transitions API when the browser has it (the
 * cabinet screen morphs into the next screen), otherwise the caller falls back
 * to a short CSS zoom. Always instant with reduced motion.
 */
import { CABINETS, cabinetForGame, isCabinetId, isGameId, type CabinetId, type GameId } from '@dascade/shared';

export const MEMORY_KEY = 'dascade:arcade:v2';
export const LEGACY_KEY = 'dascade:arcade:last';

export interface ArcadeMemory {
  v: 2;
  /** Last cabinet opened from the lineup (or the cabinet of the last game played). */
  cabinet: CabinetId | null;
  /** Last game key picked inside each multi-game cabinet. */
  games: Partial<Record<CabinetId, string>>;
}

/** Minimal Storage surface (lets tests pass a fake). */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const EMPTY: ArcadeMemory = { v: 2, cabinet: null, games: {} };

function safeStorage(kind: 'local' | 'session'): StorageLike | null {
  try {
    const s = kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
    return s ?? null;
  } catch {
    return null; // access can throw (blocked cookies, sandboxed frames)
  }
}

function read(s: StorageLike | null, key: string): string | null {
  if (!s) return null;
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
}

function write(s: StorageLike | null, key: string, value: string): void {
  if (!s) return;
  try {
    s.setItem(key, value);
  } catch {
    /* quota / private mode — memory is a convenience, never required */
  }
}

function remove(s: StorageLike | null, key: string): void {
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Maps a legacy stored value (a GameId, or already a CabinetId) to a cabinet. */
export function migrateLegacyValue(value: unknown): CabinetId | null {
  if (isCabinetId(value)) return value;
  if (isGameId(value)) return cabinetForGame(value)?.id ?? null;
  return null;
}

/** Validates an unknown parsed value into a clean ArcadeMemory (drops anything unknown). */
export function sanitizeMemory(value: unknown): ArcadeMemory {
  if (!value || typeof value !== 'object') return { ...EMPTY, games: {} };
  const raw = value as { v?: unknown; cabinet?: unknown; games?: unknown };
  const cabinet = isCabinetId(raw.cabinet) ? raw.cabinet : null;
  const games: Partial<Record<CabinetId, string>> = {};
  if (raw.games && typeof raw.games === 'object') {
    for (const [id, key] of Object.entries(raw.games as Record<string, unknown>)) {
      if (!isCabinetId(id) || typeof key !== 'string') continue;
      if (CABINETS[id].games.some((g) => g.key === key)) games[id] = key;
    }
  }
  return { v: 2, cabinet, games };
}

/**
 * Reads the arcade memory, migrating the legacy key on first read.
 * `storages` is injectable for tests; by default localStorage (+ the legacy sessionStorage key).
 */
export function readMemory(
  storages: { local: StorageLike | null; session: StorageLike | null } = { local: safeStorage('local'), session: safeStorage('session') },
): ArcadeMemory {
  const { local, session } = storages;
  const stored = read(local, MEMORY_KEY);
  if (stored !== null) {
    try {
      return sanitizeMemory(JSON.parse(stored));
    } catch {
      remove(local, MEMORY_KEY);
      return { ...EMPTY, games: {} };
    }
  }
  // One-time migration from the GameId-based key (either storage).
  const legacy = read(session, LEGACY_KEY) ?? read(local, LEGACY_KEY);
  const memory: ArcadeMemory = { v: 2, cabinet: migrateLegacyValue(legacy), games: {} };
  if (legacy !== null) {
    remove(session, LEGACY_KEY);
    remove(local, LEGACY_KEY);
    if (memory.cabinet) write(local, MEMORY_KEY, JSON.stringify(memory));
  }
  return memory;
}

function update(mutator: (m: ArcadeMemory) => void, storages?: { local: StorageLike | null; session: StorageLike | null }): void {
  const s = storages ?? { local: safeStorage('local'), session: safeStorage('session') };
  const memory = readMemory(s);
  mutator(memory);
  write(s.local, MEMORY_KEY, JSON.stringify(memory));
}

/** The cabinet the lineup should centre on (null → default). */
export function lastCabinet(): CabinetId | null {
  return readMemory().cabinet;
}

export function rememberCabinet(id: CabinetId, storages?: { local: StorageLike | null; session: StorageLike | null }): void {
  if (!isCabinetId(id)) return;
  update((m) => {
    m.cabinet = id;
  }, storages);
}

/** Finds the cabinet entry key for a game (+ optional variant such as a DASino table). */
export function gameKeyFor(gameId: GameId, variant?: string | null): { cabinet: CabinetId; key: string | null } | null {
  const cabinet = cabinetForGame(gameId);
  if (!cabinet) return null;
  const entries = cabinet.games.filter((g) => g.gameId === gameId);
  const match =
    entries.find((g) => (g.variant ?? null) === (variant ?? null)) ?? (variant ? undefined : entries.length === 1 ? entries[0] : undefined);
  return { cabinet: cabinet.id, key: match?.key ?? null };
}

/** Remembers a game (its cabinet becomes the last cabinet; in multi-game cabinets, the game is focused next time). */
export function rememberGame(
  gameId: GameId,
  variant?: string | null,
  storages?: { local: StorageLike | null; session: StorageLike | null },
): void {
  const found = gameKeyFor(gameId, variant);
  if (!found) return;
  update((m) => {
    m.cabinet = found.cabinet;
    if (found.key && CABINETS[found.cabinet].games.length > 1) m.games[found.cabinet] = found.key;
  }, storages);
}

/** Last game key picked in a cabinet (validated), or null. */
export function lastGameKey(cabinet: CabinetId): string | null {
  return readMemory().games[cabinet] ?? null;
}

// ---------------------------------------------------------------------------
// View transitions
// ---------------------------------------------------------------------------
type ViewTransitionDoc = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => { finished: Promise<void>; ready: Promise<void> };
};

export function supportsViewTransitions(): boolean {
  return typeof (document as ViewTransitionDoc).startViewTransition === 'function';
}

/** Resolves once `selector` matches (or after `timeout` ms). Uses timers: rendering is paused inside a view transition. */
export function waitForElement(selector: string, timeout = 800): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const check = () => {
      if (document.querySelector(selector) || performance.now() - start > timeout) resolve();
      else setTimeout(check, 16);
    };
    check();
  });
}

/**
 * Runs `update` (a route change) inside a view transition tagged with
 * `html[data-vt=<kind>]`, waiting for `readySelector` before the new snapshot.
 * Returns false when view transitions aren't available.
 */
export function runViewTransition(kind: 'enter' | 'exit', update: () => void, readySelector: string): boolean {
  const doc = document as ViewTransitionDoc;
  if (typeof doc.startViewTransition !== 'function') return false;
  const root = document.documentElement;
  root.dataset.vt = kind;
  try {
    const vt = doc.startViewTransition(async () => {
      update();
      await waitForElement(readySelector);
    });
    const clear = () => {
      if (root.dataset.vt === kind) delete root.dataset.vt;
    };
    vt.finished.then(clear, clear);
  } catch {
    delete root.dataset.vt;
    update();
  }
  return true;
}
