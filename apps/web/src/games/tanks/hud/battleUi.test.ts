import { describe, expect, it } from 'vitest';
import { describeScript, normalizeUi } from './battleUi.ts';

const names: Record<string, string> = { a: 'Ada', b: 'Bea', c: 'Cy' };
const nameOf = (id: string) => names[id] ?? '';

describe('normalizeUi', () => {
  it('reads the v2 presenter shape', () => {
    const ui = normalizeUi({
      version: 4,
      hp: { a: 50 },
      alive: { a: true },
      shield: { a: 30 },
      playing: true,
      lastShot: { seq: 2, kind: 'volley', shooters: ['a', 'b'], damage: { a: 40, b: 0 }, kills: [{ by: 'a', id: 'c' }] },
    });
    expect(ui.version).toBe(4);
    expect(ui.shield.a).toBe(30);
    expect(ui.playing).toBe(true);
    expect(ui.lastShot).toEqual({ seq: 2, kind: 'volley', shooters: ['a', 'b'], damage: { a: 40, b: 0 }, kills: [{ by: 'a', id: 'c' }] });
  });

  it('tolerates the older single-shooter shape and missing fields', () => {
    const ui = normalizeUi({
      version: 1,
      hp: {},
      alive: {},
      playing: false,
      lastShot: { seq: 9, shooterId: 'a', damage: 25, kills: ['b'] },
    });
    expect(ui.shield).toEqual({});
    expect(ui.lastShot).toEqual({ seq: 9, kind: 'shot', shooters: ['a'], damage: { a: 25 }, kills: [{ by: 'a', id: 'b' }] });
    expect(normalizeUi(null).lastShot).toBeNull();
  });
});

describe('describeScript', () => {
  it('summarizes single shots', () => {
    expect(describeScript({ seq: 1, kind: 'shot', shooters: ['a'], damage: { a: 45 }, kills: [] }, nameOf)).toEqual({
      text: 'Ada dealt 45 damage',
      tone: 'hit',
    });
    expect(describeScript({ seq: 1, kind: 'shot', shooters: ['a'], damage: {}, kills: [] }, nameOf).tone).toBe('miss');
    expect(describeScript({ seq: 1, kind: 'shot', shooters: ['a'], damage: { a: 80 }, kills: [{ by: 'a', id: 'b' }] }, nameOf).text).toBe(
      'Ada destroyed Bea!',
    );
  });

  it('summarizes volleys and hazards', () => {
    const v = describeScript(
      { seq: 1, kind: 'volley', shooters: ['a', 'b'], damage: { a: 30, b: 20 }, kills: [{ by: 'b', id: 'c' }] },
      nameOf,
    );
    expect(v.text).toBe('Volley: 2 shots · 50 damage · Cy destroyed');
    expect(v.tone).toBe('ko');
    expect(describeScript({ seq: 1, kind: 'volley', shooters: [], damage: {}, kills: [] }, nameOf).text).toMatch(/Nobody locked in/);
    expect(describeScript({ seq: 1, kind: 'hazard', shooters: [], damage: { '': 12 }, kills: [] }, nameOf).text).toMatch(/Hazard strike/);
  });
});
