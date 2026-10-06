/**
 * The claw machine's plushies — our own pixel designs, one sprite per kind, shared by the floor machine
 * (SVG paths) and the close-up (canvas). Fixed art colours like the cabinets' printed art (themes only
 * restyle the machine's body).
 *
 * Sprite letters: a body · d body shade · e light (inner ears, belly) · w eye white · k pupil · p cheek.
 */
import type { ToyKind } from './clawPile.ts';

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

export function spriteColor(ch: string, color: number): string | null {
  const i = ((color % PLUSH_COLORS.length) + PLUSH_COLORS.length) % PLUSH_COLORS.length;
  switch (ch) {
    case 'a':
      return PLUSH_COLORS[i]!;
    case 'd':
      return PLUSH_SHADES[i]!;
    case 'e':
      return PLUSH_LIGHTS[i]!;
    case 'w':
      return '#ffffff';
    case 'k':
      return '#1a1030';
    case 'p':
      return '#ff9fb8';
    default:
      return null;
  }
}

/** One SVG path per sprite letter (1 unit a pixel). */
export function spritePaths(kind: ToyKind): { ch: string; d: string }[] {
  const rows = SPRITES[kind];
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

/** One kind's look in a costume. Fields left out keep the machine's own art. */
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
    neon?: string;
    bg?: readonly [string, string, string];
    wall?: readonly [string, string];
    floor?: readonly [string, string];
    sign?: string;
    light?: string;
    winLight?: string;
    glass?: readonly [string, string];
  };
  /** Flavour text (functional labels such as "INSERT TOKEN" stay plain). */
  copy?: { plate?: string; restock?: string; floorWon?: string };
}
