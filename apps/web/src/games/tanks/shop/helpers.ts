/**
 * Pure helpers for the shop, the intermission splashes, the HUD and the results: basket
 * parsing, stock and affordability, category groups, standings order and earnings rows.
 * No React, no network — unit tested in helpers.test.ts.
 */
import {
  CATEGORY_LABEL,
  ITEM_IDS,
  MAX_STOCK,
  WEAPONS,
  WEAPON_CATEGORIES,
  WEAPON_IDS,
  isItemId,
  shopInfo,
  type Ammo,
  type FleetView,
  type ItemId,
  type Items,
  type ShopId,
  type WeaponCategory,
  type WeaponId,
} from '@dascade/shared/games/tanks';

export type ShopGroupKey = WeaponCategory | 'defense';

export interface ShopGroup {
  key: ShopGroupKey;
  label: string;
  ids: ShopId[];
}

/** Shop tabs: the six weapon categories (shell excluded — it's free) then Defense. */
export function shopGroups(): ShopGroup[] {
  const groups: ShopGroup[] = WEAPON_CATEGORIES.map((key) => ({
    key,
    label: CATEGORY_LABEL[key],
    ids: WEAPON_IDS.filter((w) => w !== 'shell' && WEAPONS[w].category === key) as ShopId[],
  }));
  groups.push({ key: 'defense', label: CATEGORY_LABEL.defense, ids: [...ITEM_IDS] });
  return groups;
}

/** "heavy:2,shield:1" → { heavy: 2, shield: 1 } (unknown ids and junk are dropped). */
export function parseBasket(basket: string | undefined | null): Partial<Record<ShopId, number>> {
  const out: Partial<Record<ShopId, number>> = {};
  if (!basket) return out;
  for (const part of basket.split(',')) {
    const [id, n] = part.split(':');
    const count = Number(n);
    if (!id || !Number.isFinite(count) || count <= 0) continue;
    if (id === 'shell' || !(isItemId(id) || (WEAPON_IDS as readonly string[]).includes(id))) continue;
    out[id as ShopId] = (out[id as ShopId] ?? 0) + Math.floor(count);
  }
  return out;
}

/** Bundles of `id` that can be sold back (bought during this shop visit). */
export function basketCount(basket: string | undefined | null, id: ShopId): number {
  return parseBasket(basket)[id] ?? 0;
}

/** Units owned of a weapon or item (-1 = unlimited, for the shell). */
export function stockOf(inv: { ammo?: Partial<Ammo>; items?: Partial<Items> } | null | undefined, id: ShopId | WeaponId): number {
  if (!inv) return 0;
  if (isItemId(id)) return inv.items?.[id] ?? 0;
  return inv.ammo?.[id as WeaponId] ?? (id === 'shell' ? -1 : 0);
}

export type BuyBlock = 'credits' | 'full' | 'driving';

export interface BuyCheck {
  ok: boolean;
  reason: BuyBlock | null;
  /** Short human reason for a disabled Buy button. */
  text: string;
}

/** Can this crew buy one more bundle of `id`? */
export function buyCheck(credits: number, stock: number, id: ShopId, opts: { drivingOff?: boolean } = {}): BuyCheck {
  const info = shopInfo(id);
  if (id === 'fuel' && opts.drivingOff) return { ok: false, reason: 'driving', text: 'Driving is off' };
  if (stock >= MAX_STOCK) return { ok: false, reason: 'full', text: `Full (${MAX_STOCK} max)` };
  if (credits < info.price) return { ok: false, reason: 'credits', text: `Need ${formatCredits(info.price - credits)} more` };
  return { ok: true, reason: null, text: '' };
}

const NUMBER = new Intl.NumberFormat('en-US');

/** 12500 → "12,500". */
export function formatCredits(n: number): string {
  return NUMBER.format(Math.round(n || 0));
}

/** Signed credit delta: +3,000 / −400 (true minus sign). */
export function formatDelta(n: number): string {
  const v = Math.round(n || 0);
  return `${v < 0 ? '−' : '+'}${NUMBER.format(Math.abs(v))}`;
}

/** Weapons the tank can fire right now, in tray order (shell always first). */
export function ownedWeapons(ammo: Partial<Ammo> | null | undefined): WeaponId[] {
  return WEAPON_IDS.filter((w) => w === 'shell' || (ammo?.[w] ?? 0) !== 0);
}

/** Owned weapons grouped by category (empty categories dropped). */
export function ownedByCategory(ammo: Partial<Ammo> | null | undefined): Array<{ key: WeaponCategory; label: string; ids: WeaponId[] }> {
  const owned = ownedWeapons(ammo);
  return WEAPON_CATEGORIES.map((key) => ({
    key,
    label: CATEGORY_LABEL[key],
    ids: owned.filter((w) => WEAPONS[w].category === key),
  })).filter((g) => g.ids.length > 0);
}

/** Match standings: final place when decided, else score ↓, battle wins ↓, damage ↓, kills ↓, name. */
export function sortStandings<T extends Pick<FleetView, 'id' | 'name' | 'score' | 'wins' | 'damage' | 'kills' | 'place'>>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const pa = a.place || 0;
    const pb = b.place || 0;
    if (pa && pb && pa !== pb) return pa - pb;
    if (pa && !pb) return -1;
    if (pb && !pa) return 1;
    return (
      b.score - a.score ||
      b.wins - a.wins ||
      b.damage - a.damage ||
      b.kills - a.kills ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
    );
  });
}

/** 1-based places by score with ties sharing a place (standings already sorted). */
export function rankPlaces<T extends Pick<FleetView, 'score' | 'place'>>(sorted: readonly T[]): number[] {
  const out: number[] = [];
  sorted.forEach((r, i) => {
    if (r.place) out.push(r.place);
    else if (i > 0 && sorted[i - 1]!.score === r.score && !sorted[i - 1]!.place) out.push(out[i - 1]!);
    else out.push(i + 1);
  });
  return out;
}

export interface EarnRow {
  key: 'base' | 'damage' | 'kills' | 'survive' | 'win' | 'penalty';
  label: string;
  amount: number;
}

/** Last battle's credit breakdown (zero lines dropped; the penalty is negative). */
export function earningsRows(
  f: Pick<FleetView, 'earnBase' | 'earnDamage' | 'earnKills' | 'earnSurvive' | 'earnWin' | 'earnPenalty'>,
): EarnRow[] {
  const rows: EarnRow[] = [
    { key: 'base', label: 'Showed up', amount: f.earnBase },
    { key: 'damage', label: 'Damage dealt', amount: f.earnDamage },
    { key: 'kills', label: 'Knockouts', amount: f.earnKills },
    { key: 'survive', label: 'Survived', amount: f.earnSurvive },
    { key: 'win', label: 'Battle win', amount: f.earnWin },
    { key: 'penalty', label: 'Friendly fire', amount: -Math.abs(f.earnPenalty) },
  ];
  return rows.filter((r) => r.amount !== 0);
}

/** Team score totals (teams mode): [team 0, team 1]. */
export function teamScores(rows: ReadonlyArray<Pick<FleetView, 'team' | 'score'>>): [number, number] {
  const out: [number, number] = [0, 0];
  for (const r of rows) if (r.team === 0 || r.team === 1) out[r.team] += r.score;
  return out;
}

/** The best shield the crew owns (key S): heavy shield, then deflector, then shield. */
export function bestShield(items: Partial<Items> | null | undefined): Extract<ItemId, 'shield' | 'heavyshield' | 'deflector'> | null {
  for (const id of ['heavyshield', 'deflector', 'shield'] as const) if ((items?.[id] ?? 0) > 0) return id;
  return null;
}

/** "Unit-7" → "U7"-style two-letter monogram for tight chips. */
export function monogram(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
