/**
 * Coming back after a server restart (a deploy or a crash ends every room in memory).
 *
 * - A **black box** is a room snapshot the server sealed (encrypted and authenticated; this device
 *   can't read it) and handed to one trusted client — e.g. a Survey Showdown event room's presenter
 *   console. After a restart that client hands it back (`session.restoreRoom`) and the server
 *   recreates the room under its old code.
 * - A **recoverable** room is one whose players should wait for that restore instead of giving up:
 *   their screen keeps looking for the room and rejoins their own seat (seat token) when it's back.
 *
 * Both are per room code, kept 24 hours in localStorage (a reloaded tab still knows), and never sent
 * anywhere but back to the server they came from.
 */
const BOX_KEY = (code: string) => `dascade:blackbox:${code}`;
const RECOVER_KEY = (code: string) => `dascade:recoverable:${code}`;
const TTL_MS = 24 * 3600_000;

export interface BlackBox {
  code: string;
  gameId: string;
  takenAt: number;
  blob: string;
}

const memory = new Map<string, BlackBox>();

export function saveBlackBox(box: BlackBox): void {
  memory.set(box.code, box);
  try {
    localStorage.setItem(BOX_KEY(box.code), JSON.stringify(box));
  } catch {
    /* storage full or unavailable: the in-memory copy still covers a live tab */
  }
}

export function loadBlackBox(code: string): BlackBox | null {
  let box = memory.get(code) ?? null;
  if (!box) {
    try {
      const raw = JSON.parse(localStorage.getItem(BOX_KEY(code)) ?? 'null') as Partial<BlackBox> | null;
      if (raw && typeof raw.blob === 'string' && typeof raw.gameId === 'string' && typeof raw.takenAt === 'number' && raw.code === code) {
        box = raw as BlackBox;
      }
    } catch {
      box = null;
    }
  }
  if (!box || Date.now() - box.takenAt > TTL_MS) return null;
  return box;
}

export function clearBlackBox(code: string): void {
  memory.delete(code);
  try {
    localStorage.removeItem(BOX_KEY(code));
  } catch {
    /* ignore */
  }
}

/** This room is worth waiting for after a restart (an event room). */
export function markRecoverable(code: string, gameId: string): void {
  try {
    localStorage.setItem(RECOVER_KEY(code), JSON.stringify({ gameId, savedAt: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function isRecoverable(code: string): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem(RECOVER_KEY(code)) ?? 'null') as { savedAt?: unknown } | null;
    return Boolean(raw && typeof raw.savedAt === 'number' && Date.now() - raw.savedAt < TTL_MS);
  } catch {
    return false;
  }
}

export function forgetRecoverable(code: string): void {
  try {
    localStorage.removeItem(RECOVER_KEY(code));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// The recovery in progress (one room at a time): the screen stays up through its own join/restore
// attempts, and the give-up clock survives a remount.
// ---------------------------------------------------------------------------

let recovering: { code: string; startedAt: number } | null = null;
const recoveryListeners = new Set<() => void>();
const giveUpListeners = new Set<(code: string) => void>();

function emitRecovery(): void {
  for (const l of [...recoveryListeners]) l();
}

/** Starts (or continues) recovering a room; returns when this recovery began. */
export function beginRecovery(code: string): number {
  if (recovering?.code !== code) {
    recovering = { code, startedAt: Date.now() };
    emitRecovery();
  }
  return recovering.startedAt;
}

export function endRecovery(code: string): void {
  if (recovering?.code !== code) return;
  recovering = null;
  emitRecovery();
}

export function recoveringCode(): string | null {
  return recovering?.code ?? null;
}

export function subscribeRecovery(fn: () => void): () => void {
  recoveryListeners.add(fn);
  return () => recoveryListeners.delete(fn);
}

/** Recovery was abandoned (the player stopped waiting, or it failed): games tidy up (e.g. a held window). */
export function onRecoveryGiveUp(fn: (code: string) => void): () => void {
  giveUpListeners.add(fn);
  return () => giveUpListeners.delete(fn);
}

export function giveUpRecovery(code: string): void {
  endRecovery(code);
  for (const l of [...giveUpListeners]) l(code);
}

/** Leaving a room on purpose (or being removed): nothing of it is worth bringing back. */
export function forgetRoom(code: string): void {
  clearBlackBox(code);
  forgetRecoverable(code);
}
