/**
 * Corrupted localStorage never breaks the arcade: a bad guest id is replaced (every join carries it),
 * and a mangled preset list degrades to its valid entries instead of throwing on list/save/delete.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalPersistence, getOrCreateGuestId } from './local.ts';

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const g = globalThis as { localStorage?: unknown };
let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  g.localStorage = storage;
});
afterEach(() => {
  delete g.localStorage;
});

describe('guest id', () => {
  it('keeps a valid stored id (existing players keep their identity)', () => {
    storage.setItem('dascade:v1:guestId', JSON.stringify('g_0123456789abcdef01234567'));
    expect(getOrCreateGuestId()).toBe('g_0123456789abcdef01234567');
  });

  it.each([['12345'], ['{"a":1}'], ['null'], ['{bad json'], [JSON.stringify('x'.repeat(65))], [JSON.stringify('has spaces')]])(
    'replaces a corrupted id %s with a fresh valid one, once',
    (raw) => {
      storage.setItem('dascade:v1:guestId', raw);
      const id = getOrCreateGuestId();
      expect(id).toMatch(/^g_[0-9a-f]{24}$/);
      expect(getOrCreateGuestId()).toBe(id);
    },
  );
});

describe('presets', () => {
  const p = new LocalPersistence();
  const good = { id: 'a1', kind: 'wheel', name: 'Lunch', data: { n: 1 }, updatedAt: 5 };

  it.each([['{"a":1}'], ['"str"'], ['42'], ['{bad json']])('a non-list %s reads as empty and can be saved over', async (raw) => {
    storage.setItem('dascade:v1:presets:wheel', raw);
    await expect(p.listPresets('wheel')).resolves.toEqual([]);
    const saved = await p.savePreset('wheel', 'Fresh', { n: 2 });
    await expect(p.listPresets('wheel')).resolves.toEqual([saved]);
    await p.deletePreset('wheel', saved.id);
    await expect(p.listPresets('wheel')).resolves.toEqual([]);
  });

  it('drops junk entries but keeps valid ones, newest first', async () => {
    const newer = { ...good, id: 'b2', name: 'Dinner', updatedAt: 9 };
    storage.setItem('dascade:v1:presets:wheel', JSON.stringify([null, 3, { id: 'x' }, good, 'str', newer]));
    await expect(p.listPresets('wheel')).resolves.toEqual([newer, good]);
    await p.deletePreset('wheel', 'a1');
    await expect(p.listPresets('wheel')).resolves.toEqual([newer]);
  });
});
