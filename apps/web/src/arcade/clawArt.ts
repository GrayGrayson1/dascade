/**
 * The claw machine's plushies — our own pixel designs, one sprite per kind, shared by the floor machine
 * (SVG paths) and the close-up (canvas) — and the colours inside its glass. Fixed art like the cabinets'
 * printed art (themes restyle the machine's body), with one documented exception: a skin may dress the
 * machine up with a costume (ThemeSkin.claw). A costume keeps the same four kinds at the same sprite
 * sizes, so the pile, the physics and saved prize shelves never see it — only how they're drawn and
 * named. This file is the one place that decides what they look like.
 *
 * Sprite letters: a body · d body shade · e light (inner ears, belly) · w eye white · k pupil · p cheek.
 */
import { KINDS, TOY_COLORS, TOY_KINDS, type ToyKind } from './clawPile.ts';

export const PLUSH_COLORS = ['#ff4fd8', '#22d3ee', '#ffd23f', '#2de38f', '#a78bfa', '#ff8a3d'] as const;
export const PLUSH_SHADES = ['#b82f9b', '#1592a8', '#c49a1c', '#1f9e63', '#7155c4', '#c2601f'] as const;
export const PLUSH_LIGHTS = ['#ffc2f2', '#b6f3fb', '#fff1b0', '#b9f7d9', '#ddd2ff', '#ffd2b0'] as const;

// prettier-ignore
export const SPRITES: Record<ToyKind, readonly string[]> = {
  // A round blob with nubby ears.
  blob: [
    '..aa....aa..',
    '.aeaa..aaea.',
    '.aaaaaaaaaa.',
    'aaaaaaaaaaaa',
    'aawkaaaawkaa',
    'apaaaddaaapa',
    'daaaaaaaaaad',
    '.ddaaaaaadd.',
  ],
  // A tall bunny: long ears, round body.
  bunny: [
    '.aa....aa.',
    '.ae....ea.',
    '.ae....ea.',
    '.ae....ea.',
    '.aa....aa.',
    '.aaaaaaaa.',
    'aaaaaaaaaa',
    'awkaaaawka',
    'apaaddaapa',
    'aaaaaaaaaa',
    'daaeeeeaad',
    'daaeeeeaad',
    '.daaaaaad.',
    '.dd.aa.dd.',
  ],
  // A flat five-point star, seen from above the glass.
  star: [
    '......aa......',
    '.....aeea.....',
    'aaaaaaaaaaaaaa',
    '.aaawkaawkaaa.',
    '..aapaddaapa..',
    '..aaaa..aaaa..',
    '.dda......add.',
  ],
  // A little cube bot: antenna, screen face.
  bot: [
    '.....e.....',
    '.....a.....',
    '..aaaaaaa..',
    '.aaaaaaaaa.',
    '.akkkkkkka.',
    '.akwkkkwka.',
    '.akkkeekka.',
    '.aaaaaaaaa.',
    '.ddaaaaadd.',
    '.dd.....dd.',
  ],
};

/** The fixed letters (eye white, pupil, cheek). */
const INK: Readonly<Record<'w' | 'k' | 'p', string>> = { w: '#ffffff', k: '#1a1030', p: '#ff9fb8' };

// ---------------------------------------------------------------------------------------------------
// Costumes (ThemeSkin.claw)

/** One kind's look in a costume. Fields left out (or invalid) keep the machine's own art. */
export interface PlushCostume {
  /** Sprite rows: EXACTLY the base sprite's width × height and visible bounding box; letters `. a d e w k p`. */
  rows?: readonly string[];
  /** Body / shade / light colours: exactly TOY_COLORS (6) entries each (stored colour indexes are 0–5). */
  colors?: readonly string[];
  shades?: readonly string[];
  lights?: readonly string[];
  /** Per-kind override of the fixed letters (eye white, pupil, cheek). */
  ink?: Partial<Record<'w' | 'k' | 'p', string>>;
  /** Lower-case display name for status/LED/shelf text ("ghost" → "You won a ghost plush!"). */
  name?: string;
}

/**
 * A costume for the plushies and the inside of the glass (ThemeSkin.claw): the same four kinds at the
 * same sprite sizes, so saved prize shelves, the pile and the physics never see it.
 */
export interface ClawCostume {
  /** Cache key (use the theme id). */
  id: string;
  plush?: Partial<Record<ToyKind, PlushCostume>>;
  /** Close-up backdrop and floor-machine glass colours (#rrggbb) and the neon sign's text. */
  interior?: {
    /** The machine's neon (wall print, sign, chute rim, claw trim). */
    neon?: string;
    /** The case, top to bottom. */
    bg?: readonly [string, string, string];
    /** The back wall, top to bottom. */
    wall?: readonly [string, string];
    /** The felt floor, back to front. */
    floor?: readonly [string, string];
    /** The back wall's neon sign (capitals, at most 14 characters; shrinks to fit the wall). */
    sign?: string;
    /** Cobwebs in the back wall's top corners. */
    webs?: boolean;
    /** The interior light's tint, and its tint on a win. */
    light?: string;
    winLight?: string;
    /** The floor machine's glass, top to bottom. */
    glass?: readonly [string, string];
  };
  /** Flavour text (functional labels such as "INSERT TOKEN" stay plain). */
  copy?: { plate?: string; restock?: string; floorWon?: string };
}

/** One kind's resolved look: the machine's own art, or a costume's. */
export interface PlushArt {
  /** Cache-key prefix: '' for the machine's own art (so its cache keys never change). */
  key: string;
  rows: readonly string[];
  colors: readonly string[];
  shades: readonly string[];
  lights: readonly string[];
  ink: Readonly<Record<'w' | 'k' | 'p', string>>;
  /** Display name for status, LED and shelf text. */
  name: string;
}

/** The inside of the glass, resolved (the machine's own literals, or a costume's). */
export interface ClawInterior {
  /** Cache-key prefix: '' for the machine's own interior. */
  key: string;
  neon: string;
  /** `r,g,b` of the neon, for rgba() strings. */
  neonRgb: string;
  bg: readonly [string, string, string];
  wall: readonly [string, string];
  side: readonly [string, string];
  floor: readonly [string, string];
  sign: string;
  /** Costume signs shrink to fit the back wall (the machine's own sign is drawn exactly as it always was). */
  signFit: boolean;
  signGlow: string;
  signCore: string;
  rim: string;
  chutePanel: string;
  webs: boolean;
  light: string;
  winLight: string;
  glass: readonly [string, string];
}

export interface ClawCopy {
  plate: string;
  restock: string;
  floorWon: string;
}

const baseArt = (kind: ToyKind): PlushArt => ({
  key: '',
  rows: SPRITES[kind],
  colors: PLUSH_COLORS,
  shades: PLUSH_SHADES,
  lights: PLUSH_LIGHTS,
  ink: INK,
  name: KINDS[kind].name,
});
const BASE_ART: Record<ToyKind, PlushArt> = { blob: baseArt('blob'), bunny: baseArt('bunny'), star: baseArt('star'), bot: baseArt('bot') };

const BASE_INTERIOR: ClawInterior = {
  key: '',
  neon: '#ff4fd8',
  neonRgb: '255,79,216',
  bg: ['#1b2360', '#0f1440', '#070a22'],
  wall: ['#2a1d5c', '#171046'],
  side: ['rgba(8,10,36,0.95)', 'rgba(30,26,80,0.9)'],
  floor: ['#2b1450', '#40195e'],
  sign: 'PLUSH PARADE',
  signFit: false,
  signGlow: 'rgba(255,120,230,0.55)',
  signCore: 'rgba(255,220,250,0.55)',
  rim: 'rgba(255,120,230,0.8)',
  chutePanel: 'rgba(255,170,240,0.16)',
  webs: false,
  light: '#ffe9b0',
  winLight: '#ffd23f',
  glass: ['#141b4a', '#070a22'],
};

const BASE_COPY: ClawCopy = { plate: 'PLUSH!', restock: 'FRESH PLUSHIES!', floorWon: 'You won a plush!' };

const HEX = /^#[0-9a-f]{6}$/i;
const SPRITE_LETTERS = /^[.adewkp]+$/;
/** Reads right after "a" ("You won a … plush!"): lower case, no leading vowel, at most 10 characters. */
const NAME = /^(?![aeiou])[a-z][a-z ]{0,9}$/;
const SIGN = /^[A-Z0-9][A-Z0-9 !?'&.-]{0,13}$/;
const LIMITS: Readonly<Record<keyof ClawCopy, number>> = { plate: 6, restock: 15, floorWon: 18 };

const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);
const isColors = (v: readonly unknown[] | undefined, n: number): v is readonly string[] => !!v && v.length === n && v.every(isHex);
const isPalette = (v: readonly unknown[] | undefined): v is readonly string[] => isColors(v, TOY_COLORS);

/** A sprite's visible bounding box `[x0, y0, x1, y1]` (inclusive), or null when it has no pixels. */
export function spriteBounds(rows: readonly string[]): readonly [number, number, number, number] | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '.') continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  });
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

/** Costume rows fit a kind: its exact size, its visible bounds, sprite letters only. */
function fitsKind(kind: ToyKind, rows: readonly string[] | undefined): rows is readonly string[] {
  const base = SPRITES[kind];
  const w = base[0]!.length;
  if (!rows || rows.length !== base.length || rows.some((r) => typeof r !== 'string' || r.length !== w || !SPRITE_LETTERS.test(r))) return false;
  const a = spriteBounds(rows);
  const b = spriteBounds(base)!;
  return !!a && a.every((v, i) => v === b[i]);
}

const arts = new WeakMap<ClawCostume, Partial<Record<ToyKind, PlushArt>>>();

/** What a plush of `kind` looks like: the costume's art where it's valid (per field), else the machine's own. */
export function plushArt(kind: ToyKind, costume?: ClawCostume | null): PlushArt {
  const look = costume?.plush?.[kind];
  if (!costume || !look) return BASE_ART[kind];
  let per = arts.get(costume);
  if (!per) arts.set(costume, (per = {}));
  const hit = per[kind];
  if (hit) return hit;
  const base = BASE_ART[kind];
  const ink: Record<'w' | 'k' | 'p', string> = { ...INK };
  for (const ch of ['w', 'k', 'p'] as const) {
    const v = look.ink?.[ch];
    if (isHex(v)) ink[ch] = v;
  }
  const art: PlushArt = {
    key: `${costume.id}:`,
    rows: fitsKind(kind, look.rows) ? look.rows : base.rows,
    colors: isPalette(look.colors) ? look.colors : base.colors,
    shades: isPalette(look.shades) ? look.shades : base.shades,
    lights: isPalette(look.lights) ? look.lights : base.lights,
    ink,
    name: typeof look.name === 'string' && NAME.test(look.name) ? look.name : base.name,
  };
  per[kind] = art;
  return art;
}

/** A kind's display name in status, LED and shelf text ("blob", or a costume's "ghost"). */
export function plushName(kind: ToyKind, costume?: ClawCostume | null): string {
  return plushArt(kind, costume).name;
}

const interiors = new WeakMap<ClawCostume, ClawInterior>();

/** The inside of the glass: the costume's colours where they're valid, else the machine's own literals. */
export function interiorOf(costume?: ClawCostume | null): ClawInterior {
  const c = costume?.interior;
  if (!costume || !c) return BASE_INTERIOR;
  const hit = interiors.get(costume);
  if (hit) return hit;
  const neon = isHex(c.neon) ? c.neon : BASE_INTERIOR.neon;
  const bg = isColors(c.bg, 3) ? (c.bg as ClawInterior['bg']) : null;
  const glow = rgbOf(mix(neon, '#ffffff', 0.3));
  const sign = typeof c.sign === 'string' && SIGN.test(c.sign) ? c.sign : null;
  const out: ClawInterior = {
    key: `${costume.id}:`,
    neon,
    neonRgb: rgbOf(neon),
    bg: bg ?? BASE_INTERIOR.bg,
    wall: isColors(c.wall, 2) ? (c.wall as ClawInterior['wall']) : BASE_INTERIOR.wall,
    // The mirror side panels: the case's own colour, darker.
    side: bg ? [`rgba(${rgbOf(mix(bg[2], '#000000', 0.3))},0.95)`, `rgba(${rgbOf(bg[0])},0.9)`] : BASE_INTERIOR.side,
    floor: isColors(c.floor, 2) ? (c.floor as ClawInterior['floor']) : BASE_INTERIOR.floor,
    sign: sign ?? BASE_INTERIOR.sign,
    signFit: sign !== null,
    signGlow: `rgba(${glow},0.55)`,
    signCore: `rgba(${rgbOf(mix(neon, '#ffffff', 0.8))},0.55)`,
    rim: `rgba(${glow},0.8)`,
    chutePanel: `rgba(${rgbOf(mix(neon, '#ffffff', 0.55))},0.16)`,
    webs: c.webs === true,
    light: isHex(c.light) ? c.light : BASE_INTERIOR.light,
    winLight: isHex(c.winLight) ? c.winLight : BASE_INTERIOR.winLight,
    glass: isColors(c.glass, 2) ? (c.glass as ClawInterior['glass']) : BASE_INTERIOR.glass,
  };
  interiors.set(costume, out);
  return out;
}

/** The machine's flavour text (the plate, the restock LED line, the floor tag after a win). */
export function clawCopy(costume?: ClawCostume | null): ClawCopy {
  const c = costume?.copy;
  if (!c) return BASE_COPY;
  const pick = (k: keyof ClawCopy) => {
    const v = c[k];
    return typeof v === 'string' && v.trim() && v.length <= LIMITS[k] ? v : BASE_COPY[k];
  };
  return { plate: pick('plate'), restock: pick('restock'), floorWon: pick('floorWon') };
}

/** Every problem with a costume (empty = valid). The renderer falls back per field; tests use this. */
export function clawCostumeProblems(c: ClawCostume): string[] {
  const out: string[] = [];
  if (typeof c.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(c.id)) out.push('id must be a kebab-case key (the theme id)');
  for (const [kind, look] of Object.entries(c.plush ?? {})) {
    if (!(TOY_KINDS as readonly string[]).includes(kind)) {
      out.push(`plush.${kind}: unknown kind (never add kinds: saved prize shelves would be lost)`);
      continue;
    }
    const k = kind as ToyKind;
    if (!look) continue;
    if (look.rows !== undefined) {
      const { w, h } = spriteSize(k);
      if (!fitsKind(k, look.rows)) out.push(`plush.${k}.rows must be ${w}×${h} with the ${k} sprite's visible bounds, letters . a d e w k p`);
      else if (!look.rows.some((r) => r.includes('w'))) out.push(`plush.${k}.rows need an eye row (w) to blink`);
    }
    for (const p of ['colors', 'shades', 'lights'] as const) {
      if (look[p] !== undefined && !isPalette(look[p])) out.push(`plush.${k}.${p} must be ${TOY_COLORS} #rrggbb colours`);
    }
    for (const [ch, v] of Object.entries(look.ink ?? {})) {
      if (!['w', 'k', 'p'].includes(ch) || !isHex(v)) out.push(`plush.${k}.ink.${ch} must be a #rrggbb colour for w, k or p`);
    }
    if (look.name !== undefined && !NAME.test(look.name)) out.push(`plush.${k}.name must be lower case, start with a consonant, ≤ 10 characters`);
  }
  const i = c.interior;
  if (i) {
    for (const key of ['neon', 'light', 'winLight'] as const) if (i[key] !== undefined && !isHex(i[key])) out.push(`interior.${key} must be #rrggbb`);
    if (i.bg !== undefined && !isColors(i.bg, 3)) out.push('interior.bg must be 3 #rrggbb colours');
    for (const key of ['wall', 'floor', 'glass'] as const) {
      if (i[key] !== undefined && !isColors(i[key], 2)) out.push(`interior.${key} must be 2 #rrggbb colours`);
    }
    if (i.sign !== undefined && !SIGN.test(i.sign)) out.push('interior.sign must be 1–14 capitals');
  }
  for (const [key, v] of Object.entries(c.copy ?? {})) {
    const max = LIMITS[key as keyof ClawCopy];
    if (max === undefined) out.push(`copy.${key}: unknown text`);
    else if (typeof v !== 'string' || !v.trim() || v.length > max) out.push(`copy.${key} must be 1–${max} characters`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Drawing helpers

export function spriteColor(ch: string, color: number, art: PlushArt = BASE_ART.blob): string | null {
  const n = art.colors.length;
  const i = ((color % n) + n) % n;
  switch (ch) {
    case 'a':
      return art.colors[i]!;
    case 'd':
      return art.shades[i]!;
    case 'e':
      return art.lights[i]!;
    case 'w':
    case 'k':
    case 'p':
      return art.ink[ch];
    default:
      return null;
  }
}

/** One SVG path per sprite letter (1 unit a pixel). */
export function spritePaths(kind: ToyKind, rows: readonly string[] = SPRITES[kind]): { ch: string; d: string }[] {
  const out = new Map<string, string>();
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch === '.') continue;
      out.set(ch, (out.get(ch) ?? '') + `M${x} ${y}h1v1h-1z`);
    }
  });
  return [...out].map(([ch, d]) => ({ ch, d }));
}

export function spriteSize(kind: ToyKind): { w: number; h: number } {
  const rows = SPRITES[kind];
  return { w: rows[0]!.length, h: rows.length };
}

function rgbOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** `a` moved `t` of the way to `b` (#rrggbb). */
function mix(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((x >> s) & 255) + (((y >> s) & 255) - ((x >> s) & 255)) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}
