/**
 * The claw machine's contents and your prize shelf, kept in this browser (localStorage) — pure helpers
 * (unit tested in clawInventory.test.ts) plus a tiny store shared by the floor machine and the close-up,
 * so a plush won in the close-up is missing from the floor machine too.
 *
 * Storage: `dascade:v2:claw` = { v: 2, pile: [{k, c, x, z}], shelf: {blob, bunny, star, bot}, won,
 * misses, seed }. Everything read back is validated and bounded; anything malformed falls back to a
 * fresh machine. The v1 key (`{ won }`, a count of the old blob plushies) migrates onto the shelf.
 *
 * No money anywhere: tokens are free, prizes have no value, nothing leaves the browser.
 */
import { create } from 'zustand';
import { KINDS, PILE_AREA, TOY_COLORS, TOY_KINDS, settleFully, stockToys, type ClawToy, type ToyKind } from './clawPile.ts';

export const CLAW_KEY = 'dascade:v2:claw';
export const LEGACY_CLAW_KEY = 'dascade:v1:claw';
/** A full machine, and the level at which the attendant tops it up on your next visit. */
export const STOCK = 22;
export const RESTOCK_BELOW = 10;
export const MAX_PILE = 28;
const MAX_COUNT = 99_999;

export interface PileEntry {
  k: ToyKind;
  c: number;
  x: number;
  z: number;
}
export type Shelf = Record<ToyKind, number>;

export interface Inventory {
  v: 2;
  pile: PileEntry[];
  shelf: Shelf;
  /** The colour of the last plush of each kind you won (the shelf shows it). */
  colors: Shelf;
  won: number;
  /** Tries in a row without a win (the machine's payout setting reads it). */
  misses: number;
  seed: number;
}

const emptyShelf = (): Shelf => ({ blob: 0, bunny: 0, star: 0, bot: 0 });
const count = (v: unknown, max = MAX_COUNT): number => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? Math.min(v, max) : 0);
const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;
const round1 = (v: number) => Math.round(v * 10) / 10;

export function freshInventory(seed: number): Inventory {
  return { v: 2, pile: toysToPile(stockToys(seed, STOCK)), shelf: emptyShelf(), colors: emptyShelf(), won: 0, misses: 0, seed: seed | 0 };
}

function parsePile(v: unknown): PileEntry[] | null {
  if (!Array.isArray(v) || v.length > MAX_PILE) return null;
  const out: PileEntry[] = [];
  for (const e of v) {
    if (!e || typeof e !== 'object') return null;
    const o = e as Record<string, unknown>;
    if (typeof o.k !== 'string' || !(TOY_KINDS as readonly string[]).includes(o.k)) return null;
    const c = typeof o.c === 'number' && Number.isInteger(o.c) && o.c >= 0 && o.c < TOY_COLORS ? o.c : null;
    const x = num(o.x, PILE_AREA.x0, PILE_AREA.x1);
    const z = num(o.z, PILE_AREA.z0, PILE_AREA.z1);
    if (c === null || x === null || z === null) return null;
    out.push({ k: o.k as ToyKind, c, x, z });
  }
  return out;
}

/**
 * Reads the stored machine (validated), migrating the v1 prize count. `seed` stocks a fresh machine
 * when there's nothing usable.
 */
export function parseInventory(raw: string | null, legacy: string | null, seed: number): Inventory {
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (data && typeof data === 'object' && (data as { v?: unknown }).v === 2) {
    const o = data as Record<string, unknown>;
    const pile = parsePile(o.pile);
    if (pile) {
      const shelfIn = o.shelf && typeof o.shelf === 'object' ? (o.shelf as Record<string, unknown>) : {};
      const shelf = emptyShelf();
      for (const k of TOY_KINDS) shelf[k] = count(shelfIn[k]);
      const total = TOY_KINDS.reduce((s, k) => s + shelf[k], 0);
      const colorsIn = o.colors && typeof o.colors === 'object' ? (o.colors as Record<string, unknown>) : {};
      const colors = emptyShelf();
      for (const k of TOY_KINDS) colors[k] = Math.min(TOY_COLORS - 1, count(colorsIn[k], TOY_COLORS - 1));
      return {
        v: 2,
        pile,
        shelf,
        colors,
        won: Math.max(count(o.won), Math.min(total, MAX_COUNT)),
        misses: count(o.misses, 999),
        seed: typeof o.seed === 'number' && Number.isInteger(o.seed) ? o.seed | 0 : seed | 0,
      };
    }
  }
  // v1 kept only a count of won plushies (all blobs): they go on the new shelf.
  const inv = freshInventory(seed);
  try {
    const old = legacy ? (JSON.parse(legacy) as { won?: unknown } | null) : null;
    const won = count(old && typeof old === 'object' ? old.won : undefined);
    inv.shelf.blob = won;
    inv.won = won;
  } catch {
    /* unreadable: a fresh start */
  }
  return inv;
}

export function toysToPile(toys: readonly ClawToy[]): PileEntry[] {
  // Bottom of the heap first, so a reload stacks it the same way.
  return [...toys]
    .sort((a, b) => a.y - b.y || a.id - b.id)
    .slice(0, MAX_PILE)
    .map((t) => ({ k: t.kind, c: t.color, x: round1(t.x), z: round1(t.z) }));
}

/** The pile as settled toys (ids from 1). */
export function pileToToys(pile: readonly PileEntry[]): ClawToy[] {
  const toys: ClawToy[] = pile.map((p, i) => ({
    id: i + 1,
    kind: p.k,
    color: p.c,
    x: p.x,
    z: p.z,
    // Stack in stored order so a reload rebuilds the same heap.
    y: i * 0.01,
    mode: 'pile',
    vx: 0,
    vy: 0,
    vz: 0,
    tilt: 0,
  }));
  settleFully(toys);
  return toys;
}

export function needsRestock(inv: Inventory): boolean {
  return inv.pile.length < RESTOCK_BELOW;
}

export function shelfTotal(shelf: Shelf): number {
  return TOY_KINDS.reduce((s, k) => s + shelf[k], 0);
}

export function kindName(kind: ToyKind): string {
  return KINDS[kind].name;
}

// ---------------------------------------------------------------------------------------------------
// The store

/** `?clawSeed=<int>` pins the machine's randomness (tests, and sharing a funny pile). */
export function urlClawSeed(): number | null {
  try {
    const v = new URLSearchParams(window.location.search).get('clawSeed');
    const n = v === null || v === '' ? NaN : Number(v);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

function readStorage(): Inventory {
  const seed = urlClawSeed() ?? (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) | 0;
  try {
    return parseInventory(localStorage.getItem(CLAW_KEY), localStorage.getItem(LEGACY_CLAW_KEY), seed);
  } catch {
    return freshInventory(seed);
  }
}

function writeStorage(inv: Inventory): void {
  try {
    localStorage.setItem(CLAW_KEY, JSON.stringify(inv));
    localStorage.removeItem(LEGACY_CLAW_KEY);
  } catch {
    /* private mode / storage off: this visit just isn't kept */
  }
}

/** What opened the close-up, and where it was on screen (the close-up grows out of it). */
export interface ClawOpener {
  from: 'floor' | 'quick';
  rect: { left: number; top: number; width: number; height: number } | null;
  el: HTMLElement | null;
}

/** The floor machine's marquee between visits. */
export type ClawFloorState = 'idle' | 'playing' | 'won';

interface ClawStore {
  inv: Inventory;
  open: ClawOpener | null;
  floor: ClawFloorState;
  /** The last prize (shown at the floor machine's prize door for a moment). */
  lastPrize: { kind: ToyKind; color: number; at: number } | null;
  openCloseup: (opener: ClawOpener) => void;
  closeCloseup: () => void;
  /** The floor machine's WINNER! lights go back to idle. */
  settleFloor: () => void;
  /** Saves the machine after a try (and a win's prize). */
  /** `lost`: this try missed — the floor's WINNER! lights (and the last prize at its door) go out. */
  commit: (toys: readonly ClawToy[], misses: number, seed: number, prize?: { kind: ToyKind; color: number }, lost?: boolean) => void;
  /** The attendant tops the machine up. */
  restocked: (toys: readonly ClawToy[], seed: number) => void;
}

export const useClaw = create<ClawStore>((set, get) => ({
  inv: readStorage(),
  open: null,
  floor: 'idle',
  lastPrize: null,
  openCloseup: (opener) => {
    if (get().open) return;
    set({ open: opener, floor: 'playing' });
  },
  closeCloseup: () => set((s) => ({ open: null, floor: s.floor === 'playing' ? 'idle' : s.floor })),
  settleFloor: () => set({ floor: 'idle' }),
  commit: (toys, misses, seed, prize, lost = false) => {
    const prev = get().inv;
    const shelf = { ...prev.shelf };
    const colors = { ...prev.colors };
    if (prize) {
      shelf[prize.kind] = Math.min(MAX_COUNT, shelf[prize.kind] + 1);
      colors[prize.kind] = Math.max(0, Math.min(TOY_COLORS - 1, prize.color | 0));
    }
    const inv: Inventory = {
      v: 2,
      pile: toysToPile(toys),
      shelf,
      colors,
      won: Math.min(MAX_COUNT, prev.won + (prize ? 1 : 0)),
      misses: Math.min(999, Math.max(0, misses)),
      seed: seed | 0,
    };
    writeStorage(inv);
    if (prize) set({ inv, floor: 'won', lastPrize: { ...prize, at: Date.now() } });
    else if (lost) set((st) => ({ inv, floor: st.open ? 'playing' : 'idle', lastPrize: null }));
    else set({ inv });
  },
  restocked: (toys, seed) => {
    const inv = { ...get().inv, pile: toysToPile(toys), seed: seed | 0 };
    writeStorage(inv);
    set({ inv });
  },
}));
