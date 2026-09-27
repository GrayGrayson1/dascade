import { describe, expect, it } from 'vitest';
import {
  LEGACY_KEY,
  MEMORY_KEY,
  gameKeyFor,
  migrateLegacyValue,
  readMemory,
  rememberCabinet,
  rememberGame,
  sanitizeMemory,
  type StorageLike,
} from './transition.ts';

class FakeStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new Error('SecurityError');
  }
  setItem(): void {
    throw new Error('QuotaExceededError');
  }
  removeItem(): void {
    throw new Error('SecurityError');
  }
}

const fresh = () => ({ local: new FakeStorage(), session: new FakeStorage() });

describe('arcade memory migration', () => {
  it('maps legacy game ids to their cabinet', () => {
    expect(migrateLegacyValue('holdem')).toBe('dasino');
    expect(migrateLegacyValue('blackjack')).toBe('dasino');
    expect(migrateLegacyValue('dasino')).toBe('dasino');
    expect(migrateLegacyValue('dasketch')).toBe('dasketch');
    expect(migrateLegacyValue('chess')).toBe('boardroom');
    expect(migrateLegacyValue('snake')).toBe('classics');
    expect(migrateLegacyValue('boardroom')).toBe('boardroom');
  });

  it('rejects unknown and non-string values', () => {
    expect(migrateLegacyValue('pinball')).toBeNull();
    expect(migrateLegacyValue(null)).toBeNull();
    expect(migrateLegacyValue(42)).toBeNull();
    expect(migrateLegacyValue({ id: 'wheel' })).toBeNull();
    // The Tournament Center kiosk is not a cabinet.
    expect(migrateLegacyValue('tournament')).toBeNull();
  });

  it('migrates the legacy sessionStorage key once and removes it', () => {
    const s = fresh();
    s.session.setItem(LEGACY_KEY, 'blackjack');
    expect(readMemory(s).cabinet).toBe('dasino');
    expect(s.session.getItem(LEGACY_KEY)).toBeNull();
    expect(JSON.parse(s.local.getItem(MEMORY_KEY)!)).toEqual({ v: 2, cabinet: 'dasino', games: {} });
    // Second read comes from the v2 key.
    expect(readMemory(s).cabinet).toBe('dasino');
  });

  it('drops a legacy value it cannot map without writing anything', () => {
    const s = fresh();
    s.session.setItem(LEGACY_KEY, 'not-a-game');
    expect(readMemory(s).cabinet).toBeNull();
    expect(s.session.getItem(LEGACY_KEY)).toBeNull();
    expect(s.local.getItem(MEMORY_KEY)).toBeNull();
  });

  it('prefers the v2 key over any legacy value', () => {
    const s = fresh();
    s.local.setItem(MEMORY_KEY, JSON.stringify({ v: 2, cabinet: 'putt', games: {} }));
    s.session.setItem(LEGACY_KEY, 'wheel');
    expect(readMemory(s).cabinet).toBe('putt');
  });

  it('survives corrupt JSON and resets the key', () => {
    const s = fresh();
    s.local.setItem(MEMORY_KEY, '{not json');
    expect(readMemory(s)).toEqual({ v: 2, cabinet: null, games: {} });
    expect(s.local.getItem(MEMORY_KEY)).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    const broken = { local: new ThrowingStorage(), session: new ThrowingStorage() };
    expect(readMemory(broken)).toEqual({ v: 2, cabinet: null, games: {} });
    expect(() => rememberGame('chess', null, broken)).not.toThrow();
    expect(() => rememberCabinet('tanks', broken)).not.toThrow();
    expect(readMemory({ local: null, session: null }).cabinet).toBeNull();
  });

  it('sanitizes unknown cabinets and game keys', () => {
    expect(
      sanitizeMemory({ v: 2, cabinet: 'nope', games: { dasino: 'roulette', boardroom: 'backgammon', fake: 'x', classics: 7 } }),
    ).toEqual({
      v: 2,
      cabinet: null,
      games: { dasino: 'roulette' },
    });
    expect(sanitizeMemory('string')).toEqual({ v: 2, cabinet: null, games: {} });
    expect(sanitizeMemory(null)).toEqual({ v: 2, cabinet: null, games: {} });
  });
});

describe('remembering games', () => {
  it('resolves DASino tables by variant', () => {
    expect(gameKeyFor('dasino', 'roulette')).toEqual({ cabinet: 'dasino', key: 'roulette' });
    expect(gameKeyFor('dasino', 'dice')).toEqual({ cabinet: 'dasino', key: 'highlow' });
    expect(gameKeyFor('dasino', 'slots')).toEqual({ cabinet: 'dasino', key: 'slots' });
    // The bare DASino floor is not a single picker entry.
    expect(gameKeyFor('dasino')).toEqual({ cabinet: 'dasino', key: null });
    expect(gameKeyFor('holdem')).toEqual({ cabinet: 'dasino', key: 'holdem' });
    expect(gameKeyFor('chess')).toEqual({ cabinet: 'boardroom', key: 'chess' });
    expect(gameKeyFor('wheel')).toEqual({ cabinet: 'wheel', key: 'wheel' });
    expect(gameKeyFor('tournament')).toBeNull();
  });

  it('stores the cabinet and the per-cabinet game', () => {
    const s = fresh();
    rememberGame('checkers', null, s);
    rememberGame('dasino', 'slots', s);
    const m = readMemory(s);
    expect(m.cabinet).toBe('dasino');
    expect(m.games).toEqual({ boardroom: 'checkers', dasino: 'slots' });
    rememberCabinet('quest', s);
    expect(readMemory(s)).toEqual({ v: 2, cabinet: 'quest', games: { boardroom: 'checkers', dasino: 'slots' } });
  });

  it('does not store a game key for single-game cabinets', () => {
    const s = fresh();
    rememberGame('wheel', null, s);
    expect(readMemory(s)).toEqual({ v: 2, cabinet: 'wheel', games: {} });
  });
});
