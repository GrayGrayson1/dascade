import { describe, expect, it } from 'vitest';
import { clearVariantRequest, requestVariant, takeVariantRequest } from './variantRequest.ts';

class FakeStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}
const TABLES = ['floor', 'roulette', 'slots', 'dice'] as const;

describe('variant requests', () => {
  it('delivers the requested table once for the matching room', () => {
    const s = new FakeStorage();
    requestVariant('abcde', 'dasino', 'roulette', s, 1000);
    expect(takeVariantRequest('ABCDE', 'dasino', TABLES, s, 2000)).toBe('roulette');
    // consumed: a refresh inside the room does not re-apply it
    expect(takeVariantRequest('ABCDE', 'dasino', TABLES, s, 3000)).toBeNull();
  });

  it('ignores other rooms and other games (and leaves the request for its own room)', () => {
    const s = new FakeStorage();
    requestVariant('ABCDE', 'dasino', 'slots', s, 1000);
    expect(takeVariantRequest('ZZZZZ', 'dasino', TABLES, s, 1100)).toBeNull();
    expect(takeVariantRequest('ABCDE', 'holdem', TABLES, s, 1100)).toBeNull();
    expect(takeVariantRequest('ABCDE', 'dasino', TABLES, s, 1200)).toBe('slots');
  });

  it('rejects unknown variants and stale requests', () => {
    const s = new FakeStorage();
    requestVariant('ABCDE', 'dasino', 'baccarat', s, 0);
    expect(takeVariantRequest('ABCDE', 'dasino', TABLES, s, 10)).toBeNull();
    requestVariant('ABCDE', 'dasino', 'dice', s, 0);
    expect(takeVariantRequest('ABCDE', 'dasino', TABLES, s, 31 * 60 * 1000)).toBeNull();
  });

  it('a request without a variant clears any pending one', () => {
    const s = new FakeStorage();
    requestVariant('ABCDE', 'dasino', 'dice', s, 0);
    requestVariant('ABCDE', 'dasino', null, s, 5);
    expect(takeVariantRequest('ABCDE', 'dasino', TABLES, s, 10)).toBeNull();
  });

  it('survives corrupt or missing storage', () => {
    const s = new FakeStorage();
    s.setItem('dascade:variant:v1', '{nope');
    expect(takeVariantRequest('ABCDE', 'dasino', TABLES, s)).toBeNull();
    expect(takeVariantRequest('ABCDE', 'dasino', TABLES, null)).toBeNull();
    expect(() => requestVariant('ABCDE', 'dasino', 'dice', null)).not.toThrow();
    expect(() => clearVariantRequest(null)).not.toThrow();
    expect(takeVariantRequest(null, 'dasino', TABLES, s)).toBeNull();
  });
});
