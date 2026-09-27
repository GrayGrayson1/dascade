/**
 * Carries a cabinet variant (e.g. the DASino table picked on the floor) from a
 * title screen into the room it creates or joins. Stored per room code in
 * sessionStorage and consumed once by the game client, so a refresh inside the
 * room never re-applies it (the server-remembered table wins). Fail-safe: bad
 * or unavailable storage simply means "no request".
 */
import type { GameId } from '@dascade/shared';

const KEY = 'dascade:variant:v1';
const MAX_AGE_MS = 30 * 60 * 1000;

interface VariantRequest {
  code: string;
  gameId: GameId;
  variant: string;
  at: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): StorageLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function read(s: StorageLike | null): VariantRequest | null {
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<VariantRequest>;
    if (typeof v.code !== 'string' || typeof v.gameId !== 'string' || typeof v.variant !== 'string' || typeof v.at !== 'number')
      return null;
    return v as VariantRequest;
  } catch {
    return null;
  }
}

/** Remembers that the room `code` was entered from a title screen for `gameId`'s `variant`. */
export function requestVariant(
  code: string,
  gameId: GameId,
  variant: string | null | undefined,
  s: StorageLike | null = storage(),
  now = Date.now(),
): void {
  if (!s) return;
  try {
    if (!variant) {
      s.removeItem(KEY);
      return;
    }
    s.setItem(KEY, JSON.stringify({ code: code.toUpperCase(), gameId, variant: variant.slice(0, 24), at: now } satisfies VariantRequest));
  } catch {
    /* storage full / blocked: the player simply starts on the floor */
  }
}

/**
 * Returns (and clears) the pending variant for this room + game, if any.
 * `allowed` lists the variants the caller understands.
 */
export function takeVariantRequest<T extends string>(
  code: string | null | undefined,
  gameId: GameId,
  allowed: readonly T[],
  s: StorageLike | null = storage(),
  now = Date.now(),
): T | null {
  const req = read(s);
  if (!req || !code) return null;
  if (req.code !== code.toUpperCase() || req.gameId !== gameId) return null;
  try {
    s?.removeItem(KEY);
  } catch {
    /* ignore */
  }
  if (now - req.at > MAX_AGE_MS || now < req.at - 60_000) return null;
  return (allowed as readonly string[]).includes(req.variant) ? (req.variant as T) : null;
}

/** Drops any pending request (e.g. the room turned out to be something else). */
export function clearVariantRequest(s: StorageLike | null = storage()): void {
  try {
    s?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
