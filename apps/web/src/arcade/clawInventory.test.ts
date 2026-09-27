import { describe, expect, it } from 'vitest';
import {
  MAX_PILE,
  RESTOCK_BELOW,
  STOCK,
  freshInventory,
  needsRestock,
  parseInventory,
  pileToToys,
  shelfTotal,
  toysToPile,
  useClaw,
} from './clawInventory.ts';
import { BOX, TOY_COLORS, stockToys } from './clawPhysics.ts';

const valid = () => JSON.stringify(freshInventory(3));

describe('parseInventory', () => {
  it('round-trips a stored machine', () => {
    const inv = freshInventory(3);
    inv.shelf.star = 4;
    inv.colors.star = 2;
    inv.won = 4;
    inv.misses = 2;
    expect(parseInventory(JSON.stringify(inv), null, 1)).toEqual(inv);
  });

  it('stocks a fresh machine when there is nothing (or nothing usable) stored', () => {
    for (const raw of [null, '', 'not json', '{', '[]', 'null', '42', '{"v":1}', '{"v":2}', '{"v":2,"pile":"x"}', '{"v":3,"pile":[]}']) {
      const inv = parseInventory(raw, null, 9);
      expect(inv.v).toBe(2);
      expect(inv.pile).toHaveLength(STOCK);
      expect(shelfTotal(inv.shelf)).toBe(0);
      expect(inv.won).toBe(0);
    }
  });

  it('rejects a pile with bad toys or too many', () => {
    const base = JSON.parse(valid());
    const bad = [
      [{ k: 'dragon', c: 0, x: 10, z: 10 }],
      [{ k: 'blob', c: 99, x: 10, z: 10 }],
      [{ k: 'blob', c: 1.5, x: 10, z: 10 }],
      [{ k: 'blob', c: 0, x: 'a', z: 10 }],
      [{ k: 'blob', c: 0, x: 10, z: null }],
      [null],
      Array.from({ length: MAX_PILE + 1 }, () => ({ k: 'blob', c: 0, x: 10, z: 10 })),
    ];
    for (const pile of bad) {
      const inv = parseInventory(JSON.stringify({ ...base, pile }), null, 4);
      expect(inv.pile).toHaveLength(STOCK);
    }
  });

  it('clamps positions into the glass and bounds the counts', () => {
    const base = JSON.parse(valid());
    const inv = parseInventory(
      JSON.stringify({
        ...base,
        pile: [{ k: 'bot', c: 1, x: -40, z: 9e9 }],
        shelf: { blob: -3, bunny: 2.5, star: 1e12, bot: 'x' },
        colors: { blob: 99, bunny: -1, star: 3, bot: null },
        won: -1,
        misses: 1e9,
        seed: 'nope',
      }),
      null,
      5,
    );
    expect(inv.pile).toEqual([{ k: 'bot', c: 1, x: 0, z: BOX.d }]);
    expect(inv.shelf).toEqual({ blob: 0, bunny: 0, star: 99_999, bot: 0 });
    expect(inv.won).toBe(99_999);
    expect(inv.misses).toBe(999);
    expect(inv.seed).toBe(5);
    for (const c of Object.values(inv.colors)) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(TOY_COLORS);
    }
  });

  it('migrates the v1 prize count onto the shelf (they were all blobs)', () => {
    const inv = parseInventory(null, '{"won":5}', 2);
    expect(inv.shelf.blob).toBe(5);
    expect(inv.won).toBe(5);
    expect(inv.pile).toHaveLength(STOCK);
    for (const legacy of ['{"won":-2}', '{"won":"7"}', 'garbage', '{"won":1.5}']) expect(parseInventory(null, legacy, 2).won).toBe(0);
    // a v2 record wins over a leftover v1 one
    expect(parseInventory(valid(), '{"won":5}', 2).won).toBe(0);
  });
});

describe('the pile in storage', () => {
  it('stores bottom-first and rebuilds the same heap', () => {
    const toys = stockToys(8, 20);
    const pile = toysToPile(toys);
    expect(pile).toHaveLength(20);
    const rebuilt = pileToToys(pile);
    expect(rebuilt).toHaveLength(20);
    // positions survive (a perched toy may settle a touch further); the stack heights come back close
    pile.forEach((p, i) => {
      const t = rebuilt.find((r) => r.id === i + 1)!;
      expect(t.kind).toBe(p.k);
      expect(Math.hypot(t.x - p.x, t.z - p.z)).toBeLessThan(2);
    });
    const maxY = (ts: { y: number }[]) => Math.max(...ts.map((t) => t.y));
    expect(Math.abs(maxY(rebuilt) - maxY(toys))).toBeLessThan(6);
  });

  it('restocks below the threshold', () => {
    const inv = freshInventory(1);
    expect(needsRestock(inv)).toBe(false);
    inv.pile = inv.pile.slice(0, RESTOCK_BELOW - 1);
    expect(needsRestock(inv)).toBe(true);
  });
});

describe('the store', () => {
  it('saves a try and puts a prize on the shelf once', () => {
    const toys = stockToys(4, 12);
    const before = useClaw.getState().inv.won;
    useClaw.getState().commit(toys, 0, 11, { kind: 'star', color: 3 });
    const s = useClaw.getState();
    expect(s.inv.won).toBe(before + 1);
    expect(s.inv.shelf.star).toBeGreaterThanOrEqual(1);
    expect(s.inv.colors.star).toBe(3);
    expect(s.inv.pile).toHaveLength(12);
    expect(s.floor).toBe('won');
    // a plain save (the end of the same try) doesn't count it again
    useClaw.getState().commit(toys, 0, 12);
    expect(useClaw.getState().inv.won).toBe(before + 1);
  });

  it('opens once, closes cleanly', () => {
    useClaw.getState().openCloseup({ from: 'quick', el: null, rect: null });
    const first = useClaw.getState().open;
    useClaw.getState().openCloseup({ from: 'floor', el: null, rect: null });
    expect(useClaw.getState().open).toBe(first);
    useClaw.getState().closeCloseup();
    expect(useClaw.getState().open).toBeNull();
  });
});
