import { describe, expect, it } from 'vitest';
import type { RoomLookup } from '@dascade/shared';
import {
  MAX_LOOKUPS,
  SEAT_TTL_MS,
  dismissSeat,
  dismissedSeat,
  findResumable,
  isDismissedBy,
  storedSeats,
  type StoredSeatView,
} from './resumeSeat.ts';

class MemoryStorage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

const NOW = 1_800_000_000_000;
function seat(code: string, gameId: string, agoMs: number, extra: Record<string, unknown> = {}) {
  return [`dascade:seat:${code}`, JSON.stringify({ code, gameId, seatToken: 'tok', savedAt: NOW - agoMs, ...extra })] as const;
}

describe('storedSeats', () => {
  it('lists unexpired, well-formed seats, newest first', () => {
    const s = new MemoryStorage();
    s.setItem(...seat('ABCDE', 'chess', 60_000));
    s.setItem(...seat('FGHJK', 'trivia', 10_000));
    s.setItem(...seat('MNPQR', 'blocks', SEAT_TTL_MS + 1)); // expired
    s.setItem(...seat('STUVW', 'not-a-game', 1_000));
    s.setItem('dascade:seat:XYZ23', JSON.stringify({ code: 'OTHER', gameId: 'chess', seatToken: 't', savedAt: NOW })); // key mismatch
    s.setItem('dascade:seat:23456', '{not json');
    s.setItem(...seat('ABCDF', 'chess', 5_000, { seatToken: '' })); // no token
    s.setItem('dascade:v1:settings', '{}');
    expect(storedSeats(s, NOW).map((x) => x.code)).toEqual(['FGHJK', 'ABCDE']);
    expect(storedSeats(s, NOW)[0]).toEqual({ code: 'FGHJK', gameId: 'trivia', savedAt: NOW - 10_000 });
  });
});

describe('findResumable', () => {
  const seats: StoredSeatView[] = [
    { code: 'AAAAA', gameId: 'chess', savedAt: 5 },
    { code: 'BBBBB', gameId: 'trivia', savedAt: 4 },
    { code: 'CCCCC', gameId: 'words', savedAt: 3 },
    { code: 'DDDDD', gameId: 'snake', savedAt: 2 },
  ];
  const open = (code: string, gameId: string, extra: Partial<RoomLookup> = {}): RoomLookup => ({ exists: true, code, gameId, ...extra });

  it('offers the newest seat whose room is still open with the same game', async () => {
    const asked: string[] = [];
    const found = await findResumable(seats, async (code) => {
      asked.push(code);
      if (code === 'AAAAA') return { exists: false, code };
      if (code === 'BBBBB') return open(code, 'chess'); // the code now belongs to another game
      return open(code, code === 'CCCCC' ? 'words' : 'snake', { roomName: 'Friday words' });
    });
    expect(found).toEqual({ code: 'CCCCC', gameId: 'words', savedAt: 3, roomName: 'Friday words' });
    expect(asked).toEqual(['AAAAA', 'BBBBB', 'CCCCC']);
  });

  it(`asks about at most ${MAX_LOOKUPS} seats, and stops when the server can't answer`, async () => {
    const asked: string[] = [];
    expect(await findResumable(seats, async (code) => (asked.push(code), { exists: false, code }))).toBeNull();
    expect(asked).toHaveLength(MAX_LOOKUPS);
    const once: string[] = [];
    expect(await findResumable(seats, async (code) => (once.push(code), null))).toBeNull();
    expect(once).toEqual(['AAAAA']);
  });

  it('skips a dismissed seat until a newer one is saved', async () => {
    const s = new MemoryStorage();
    dismissSeat(s, seats[0]!);
    const dismissed = isDismissedBy(dismissedSeat(s));
    expect(dismissed(seats[0]!)).toBe(true);
    expect(dismissed({ ...seats[0]!, savedAt: 6 })).toBe(false);
    expect(dismissed(seats[1]!)).toBe(false);
    const found = await findResumable(seats, async (code) => open(code, seats.find((x) => x.code === code)!.gameId), dismissed);
    expect(found?.code).toBe('BBBBB');
  });
});
