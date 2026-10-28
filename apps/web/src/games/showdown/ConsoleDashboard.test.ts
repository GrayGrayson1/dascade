import { describe, expect, it } from 'vitest';
import { DASHBOARD_COLUMN_MIN, arrangeColumns, columnsFor } from './ConsoleDashboard.tsx';

describe('the console Dashboard', () => {
  it('fits as many tool columns as the width allows, never fewer than one', () => {
    expect(columnsFor(0)).toBe(1);
    expect(columnsFor(DASHBOARD_COLUMN_MIN)).toBe(1);
    expect(columnsFor(DASHBOARD_COLUMN_MIN * 2 + 12)).toBe(2);
    expect(columnsFor(1237)).toBe(3);
  });

  it('keeps every tool, in order, each in the shortest column so far — the same every time', () => {
    const ids = ['lead', 'picker', 'sound', 'cards', 'cinema', 'awards', 'preflight'];
    const three = arrangeColumns(ids, 3);
    expect(three).toEqual([
      ['lead', 'awards'],
      ['picker', 'cards', 'preflight'],
      ['sound', 'cinema'],
    ]);
    expect(arrangeColumns(ids, 3)).toEqual(three);
    expect(arrangeColumns(ids, 1)).toEqual([ids]);
    expect(arrangeColumns(ids, 0)).toEqual([ids]);
    expect(arrangeColumns(ids, 2).flat().sort()).toEqual([...ids].sort());
  });
});
