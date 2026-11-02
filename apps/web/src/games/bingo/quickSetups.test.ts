import { describe, expect, it } from 'vitest';
import { BingoSettingsSchema, DEFAULT_BINGO_SETTINGS, sanitizeBingoItems } from '@dascade/shared/games/bingo';
import { itemsPerCard, boardSpec, setupProblems } from '@dascade/game-core/bingo';
import { HOLIDAY_ITEMS, OFFICE_ITEMS, PARTY_ITEMS, QUICK_SETUPS, THANKSGIVING_ITEMS } from './quickSetups.ts';

describe('bingo quick setups', () => {
  it('have unique ids and labels, and keep the names the e2e and players know', () => {
    expect(new Set(QUICK_SETUPS.map((q) => q.id)).size).toBe(QUICK_SETUPS.length);
    expect(new Set(QUICK_SETUPS.map((q) => q.label)).size).toBe(QUICK_SETUPS.length);
    expect(QUICK_SETUPS.map((q) => q.label)).toEqual(
      expect.arrayContaining(['Classic 75-ball', 'Meeting buzzwords', 'Quick 3×3 party', 'Holiday party', 'Thanksgiving dinner']),
    );
  });

  for (const q of QUICK_SETUPS) {
    it(`"${q.label}" loads as valid settings with no setup problems`, () => {
      // The panel applies a setup over the defaults (text setups bring their own items).
      const parsed = BingoSettingsSchema.safeParse({ ...DEFAULT_BINGO_SETTINGS, items: OFFICE_ITEMS, ...q.settings });
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      expect(setupProblems(parsed.data!)).toEqual([]);
    });
  }

  it.each([
    ['party', PARTY_ITEMS, 24],
    ['holiday', HOLIDAY_ITEMS, 24],
    ['thanksgiving', THANKSGIVING_ITEMS, 24],
    ['office', OFFICE_ITEMS, 24],
  ] as const)('the %s list has enough distinct squares and survives the server cleaning unchanged', (id, items, min) => {
    expect(items.length).toBeGreaterThanOrEqual(min);
    expect(sanitizeBingoItems(items)).toEqual([...items]);
    const setup = QUICK_SETUPS.find((q) => q.id === id)!;
    const spec = boardSpec({ ...DEFAULT_BINGO_SETTINGS, ...setup.settings });
    expect(items.length).toBeGreaterThanOrEqual(itemsPerCard(spec));
  });

  it('the seasonal lists are full 5×5 cards with room to spare, and stay secular', () => {
    for (const id of ['holiday', 'thanksgiving']) {
      const q = QUICK_SETUPS.find((s) => s.id === id)!;
      expect(q.settings).toMatchObject({ mode: 'text', size: 5, freeCenter: true });
      expect(q.settings.items!.length).toBeGreaterThan(24);
    }
    const text = [...HOLIDAY_ITEMS, ...THANKSGIVING_ITEMS].join(' | ');
    expect(text).not.toMatch(/\b(christmas|xmas|santa|elf|elves|reindeer|mistletoe|nativity|hanukkah|menorah|kwanzaa|church|prayer|pray|grace|blessing|beer|wine|drunk|shots?)\b/i);
  });
});
