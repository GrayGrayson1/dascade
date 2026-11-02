/**
 * "Back to your room" on the floor: a read-only view of the seats net/session.ts keeps in localStorage
 * (frozen contract 2: key `dascade:seat:<code>`, JSON `{ code, gameId, seatToken, ticket?, savedAt }`,
 * 12 h). Never imports net/session.ts (it pulls in the Colyseus client): the floor only reads the
 * entries, asks GET /api/rooms/:code whether the room is still open, and links to /room/<code>, where
 * the session rejoins the seat. A seat that is still stored means the player didn't leave on purpose:
 * leaving, being removed or the room closing clears it.
 */
import { isGameId, isValidRoomCode, type GameId, type RoomLookup } from '@dascade/shared';

export const SEAT_PREFIX = 'dascade:seat:';
export const SEAT_TTL_MS = 12 * 3600_000;
/** At most this many seats are looked up per visit (newest first): the lookup is rate limited per IP. */
export const MAX_LOOKUPS = 3;
const DISMISS_KEY = 'dascade:floor:resume-dismissed';

export interface StoredSeatView {
  code: string;
  gameId: GameId;
  savedAt: number;
}

type ReadableStorage = Pick<Storage, 'length' | 'key' | 'getItem'>;

/** Unexpired, well-formed seat entries, newest first. */
export function storedSeats(storage: ReadableStorage, now = Date.now()): StoredSeatView[] {
  const out: StoredSeatView[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(SEAT_PREFIX)) continue;
    try {
      const seat = JSON.parse(storage.getItem(key) ?? 'null') as (Partial<StoredSeatView> & { seatToken?: unknown }) | null;
      if (!seat || typeof seat.code !== 'string' || key !== SEAT_PREFIX + seat.code) continue;
      if (!isValidRoomCode(seat.code) || typeof seat.gameId !== 'string' || !isGameId(seat.gameId)) continue;
      if (typeof seat.seatToken !== 'string' || !seat.seatToken) continue;
      if (typeof seat.savedAt !== 'number' || now - seat.savedAt > SEAT_TTL_MS || seat.savedAt > now + 60_000) continue;
      out.push({ code: seat.code, gameId: seat.gameId, savedAt: seat.savedAt });
    } catch {
      /* unreadable entry */
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export interface ResumableRoom extends StoredSeatView {
  roomName?: string;
}

/**
 * The newest seat whose room is still open (the lookup's game must match the seat's), or null.
 * `lookup` returns null when the server can't be asked (offline, rate limited): we stop asking then.
 */
export async function findResumable(
  seats: readonly StoredSeatView[],
  lookup: (code: string) => Promise<RoomLookup | null>,
  isDismissed: (seat: StoredSeatView) => boolean = () => false,
): Promise<ResumableRoom | null> {
  let asked = 0;
  for (const seat of seats) {
    if (isDismissed(seat)) continue;
    if (asked++ >= MAX_LOOKUPS) break;
    const room = await lookup(seat.code);
    if (room === null) return null;
    if (room.exists && room.gameId === seat.gameId) return { ...seat, ...(room.roomName ? { roomName: room.roomName } : {}) };
  }
  return null;
}

/** Dismissing hides the chip for that seat; a newer seat (another room, or a later save) shows again. */
export function dismissedSeat(storage: Pick<Storage, 'getItem'>): { code: string; savedAt: number } | null {
  try {
    const v = JSON.parse(storage.getItem(DISMISS_KEY) ?? 'null') as { code?: unknown; savedAt?: unknown } | null;
    return v && typeof v.code === 'string' && typeof v.savedAt === 'number' ? { code: v.code, savedAt: v.savedAt } : null;
  } catch {
    return null;
  }
}

export function dismissSeat(storage: Pick<Storage, 'setItem'>, seat: StoredSeatView): void {
  try {
    storage.setItem(DISMISS_KEY, JSON.stringify({ code: seat.code, savedAt: seat.savedAt }));
  } catch {
    /* storage unavailable: it just shows again next visit */
  }
}

export function isDismissedBy(dismissed: { code: string; savedAt: number } | null): (seat: StoredSeatView) => boolean {
  return (seat) => dismissed !== null && dismissed.code === seat.code && dismissed.savedAt >= seat.savedAt;
}
