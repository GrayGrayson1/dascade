import { describe, expect, it } from 'vitest';
import { ITEM_IDS, MAX_STOCK, SHOP_IDS, WEAPONS, emptyAmmo, emptyItems } from '@dascade/shared/games/tanks';
import {
  basketCount,
  bestShield,
  buyCheck,
  earningsRows,
  formatCredits,
  formatDelta,
  monogram,
  ownedByCategory,
  ownedWeapons,
  parseBasket,
  rankPlaces,
  shopGroups,
  sortStandings,
  stockOf,
  teamScores,
} from './helpers.ts';
import { ITEM_ART, WEAPON_ART, shopArt } from '../hud/weaponArt.ts';

const row = (
  id: string,
  score: number,
  extra: Partial<{ wins: number; damage: number; kills: number; place: number; name: string }> = {},
) => ({
  id,
  name: extra.name ?? id,
  score,
  wins: extra.wins ?? 0,
  damage: extra.damage ?? 0,
  kills: extra.kills ?? 0,
  place: extra.place ?? 0,
});

describe('shop helpers', () => {
  it('groups every shop entry exactly once, shell excluded, defense last', () => {
    const groups = shopGroups();
    const ids = groups.flatMap((g) => g.ids);
    expect(ids).toHaveLength(SHOP_IDS.length);
    expect(new Set(ids)).toEqual(new Set(SHOP_IDS));
    expect(ids).not.toContain('shell');
    expect(groups.at(-1)?.key).toBe('defense');
    expect(groups.at(-1)?.ids).toEqual([...ITEM_IDS]);
    for (const g of groups.slice(0, -1)) for (const id of g.ids) expect(WEAPONS[id as keyof typeof WEAPONS].category).toBe(g.key);
  });

  it('parses the basket and ignores junk', () => {
    expect(parseBasket('heavy:2,shield:1')).toEqual({ heavy: 2, shield: 1 });
    expect(parseBasket('heavy:1,heavy:2')).toEqual({ heavy: 3 });
    expect(parseBasket('')).toEqual({});
    expect(parseBasket(undefined)).toEqual({});
    expect(parseBasket('shell:4,bogus:2,nuke:x,mirv:0,napalm:-1,warp:1')).toEqual({ warp: 1 });
    expect(basketCount('nuke:1', 'nuke')).toBe(1);
    expect(basketCount('nuke:1', 'mirv')).toBe(0);
  });

  it('reads stock for weapons and items', () => {
    const inv = { ammo: { ...emptyAmmo(), heavy: 4 }, items: { ...emptyItems(), battery: 2 } };
    expect(stockOf(inv, 'heavy')).toBe(4);
    expect(stockOf(inv, 'battery')).toBe(2);
    expect(stockOf(inv, 'shell')).toBe(-1);
    expect(stockOf(null, 'nuke')).toBe(0);
  });

  it('explains why a bundle cannot be bought', () => {
    expect(buyCheck(20_000, 0, 'heavy')).toEqual({ ok: true, reason: null, text: '' });
    const poor = buyCheck(1000, 0, 'nuke');
    expect(poor.ok).toBe(false);
    expect(poor.reason).toBe('credits');
    expect(poor.text).toBe('Need 11,000 more');
    expect(buyCheck(99_999, MAX_STOCK, 'tracer').reason).toBe('full');
    expect(buyCheck(99_999, 0, 'fuel', { drivingOff: true }).reason).toBe('driving');
    expect(buyCheck(99_999, 0, 'fuel', { drivingOff: false }).ok).toBe(true);
  });

  it('formats credits and deltas', () => {
    expect(formatCredits(12500)).toBe('12,500');
    expect(formatCredits(0)).toBe('0');
    expect(formatDelta(3000)).toBe('+3,000');
    expect(formatDelta(-400)).toBe('−400');
  });

  it('lists owned weapons in tray order with the shell first', () => {
    const ammo = { ...emptyAmmo(), nuke: 1, heavy: 2 };
    expect(ownedWeapons(ammo)).toEqual(['shell', 'heavy', 'nuke']);
    expect(ownedWeapons(null)).toEqual(['shell']);
    const groups = ownedByCategory({ ...emptyAmmo(), napalm: 3 });
    expect(groups.map((g) => g.key)).toEqual(['blast', 'fire']);
  });

  it('sorts standings by place, then score, wins and damage', () => {
    const sorted = sortStandings([row('a', 100), row('b', 300), row('c', 300, { wins: 1 }), row('d', 50, { damage: 9 })]);
    expect(sorted.map((r) => r.id)).toEqual(['c', 'b', 'a', 'd']);
    const placed = sortStandings([row('x', 999, { place: 2 }), row('y', 10, { place: 1 })]);
    expect(placed.map((r) => r.id)).toEqual(['y', 'x']);
  });

  it('shares places on equal scores', () => {
    const sorted = sortStandings([row('a', 200), row('b', 200), row('c', 100)]);
    expect(rankPlaces(sorted)).toEqual([1, 1, 3]);
    expect(rankPlaces([row('a', 5, { place: 1 }), row('b', 5, { place: 2 })])).toEqual([1, 2]);
  });

  it('builds earnings rows without zero lines and with a negative penalty', () => {
    const rows = earningsRows({ earnBase: 1500, earnDamage: 2000, earnKills: 0, earnSurvive: 1500, earnWin: 0, earnPenalty: 400 });
    expect(rows.map((r) => [r.key, r.amount])).toEqual([
      ['base', 1500],
      ['damage', 2000],
      ['survive', 1500],
      ['penalty', -400],
    ]);
  });

  it('totals team scores and picks the best shield', () => {
    expect(
      teamScores([
        { team: 0, score: 10 },
        { team: 1, score: 5 },
        { team: 0, score: 1 },
        { team: -1, score: 99 },
      ]),
    ).toEqual([11, 5]);
    expect(bestShield({ shield: 1, deflector: 1 })).toBe('deflector');
    expect(bestShield({ shield: 1, heavyshield: 1 })).toBe('heavyshield');
    expect(bestShield({})).toBeNull();
  });

  it('makes monograms', () => {
    expect(monogram('Unit-7')).toBe('U7');
    expect(monogram('Mortar Mo')).toBe('MM');
    expect(monogram('Ada')).toBe('AD');
    expect(monogram('')).toBe('?');
  });

  it('has a 10×10 glyph for every weapon and item', () => {
    for (const art of [...Object.values(WEAPON_ART), ...Object.values(ITEM_ART)]) {
      expect(art).toHaveLength(10);
      for (const r of art) expect(r).toHaveLength(10);
      for (const r of art) expect(r).toMatch(/^[.wkyrogcpnbs]+$/);
    }
    for (const id of SHOP_IDS) expect(shopArt(id)).toBeTruthy();
  });
});
