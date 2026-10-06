import { describe, expect, it } from 'vitest';
import {
  PLUSH_COLORS,
  PLUSH_LIGHTS,
  PLUSH_SHADES,
  SPRITES,
  clawCopy,
  clawCostumeProblems,
  interiorOf,
  plushArt,
  plushName,
  spriteBounds,
  spriteColor,
  spritePaths,
  spriteSize,
  type ClawCostume,
} from './clawArt.ts';
import { freshInventory, parseInventory } from './clawInventory.ts';
import { TOY_COLORS, TOY_KINDS } from './clawPile.ts';
import { HALLOWEEN_CLAW } from '../themes/halloween-night/claw.ts';

const LETTERS = ['a', 'd', 'e', 'w', 'k', 'p'];
const opaque = (rows: readonly string[]) => rows.join('').replace(/\./g, '').length;
/** What the close-up's renderer does to blink (clawRender.ts faceRows). */
const blink = (rows: readonly string[]) => rows.map((r) => (r.includes('w') ? r.replace(/[wk]/g, 'd') : r));

describe('the machine’s own art (no costume)', () => {
  it('draws exactly as before', () => {
    for (const kind of TOY_KINDS) {
      const art = plushArt(kind);
      expect(art).toBe(plushArt(kind, null));
      expect(art.key).toBe('');
      expect(art.rows).toBe(SPRITES[kind]);
      expect(spritePaths(kind, art.rows)).toEqual(spritePaths(kind));
      for (let c = -2; c < TOY_COLORS + 2; c++) {
        const i = ((c % 6) + 6) % 6;
        expect(spriteColor('a', c)).toBe(PLUSH_COLORS[i]);
        expect(spriteColor('d', c)).toBe(PLUSH_SHADES[i]);
        expect(spriteColor('e', c)).toBe(PLUSH_LIGHTS[i]);
        for (const ch of [...LETTERS, '.', 'x']) expect(spriteColor(ch, c, art)).toBe(spriteColor(ch, c));
      }
    }
    expect(spriteColor('w', 0)).toBe('#ffffff');
    expect(spriteColor('k', 0)).toBe('#1a1030');
    expect(spriteColor('p', 0)).toBe('#ff9fb8');
    expect(spriteColor('.', 0)).toBeNull();
    expect(TOY_KINDS.map((k) => plushName(k))).toEqual(['blob', 'bunny', 'star', 'cube bot']);
  });

  it('keeps the inside of the glass and the flavour text as they were', () => {
    expect(interiorOf()).toEqual({
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
    });
    expect(interiorOf(null)).toBe(interiorOf());
    expect(interiorOf({ id: 'bare' })).toBe(interiorOf());
    expect(clawCopy()).toEqual({ plate: 'PLUSH!', restock: 'FRESH PLUSHIES!', floorWon: 'You won a plush!' });
  });
});

describe('Halloween Night’s costume', () => {
  it('is valid and dresses up every kind (and only the four kinds)', () => {
    expect(clawCostumeProblems(HALLOWEEN_CLAW)).toEqual([]);
    expect(Object.keys(HALLOWEEN_CLAW.plush ?? {}).sort()).toEqual([...TOY_KINDS].sort());
    expect(TOY_KINDS.map((k) => plushName(k, HALLOWEEN_CLAW))).toEqual(['ghost', 'black cat', 'candy', 'pumpkin']);
  });

  for (const kind of TOY_KINDS) {
    it(`${kind}: same size, same visible bounds, close in weight, and it still blinks`, () => {
      const art = plushArt(kind, HALLOWEEN_CLAW);
      const look = HALLOWEEN_CLAW.plush![kind]!;
      expect(art.rows, 'the costume rows are used').toBe(look.rows);
      const { w, h } = spriteSize(kind);
      expect(art.rows).toHaveLength(h);
      for (const row of art.rows) {
        expect(row).toHaveLength(w);
        expect(row).toMatch(/^[.adewkp]+$/);
      }
      // The renderer sizes a sprite from its kind's physical radius: the footprint must not change.
      expect(spriteBounds(art.rows)).toEqual(spriteBounds(SPRITES[kind]));
      const base = opaque(SPRITES[kind]);
      expect(Math.abs(opaque(art.rows) - base) / base).toBeLessThanOrEqual(0.2);
      expect(art.rows.some((r) => r.includes('w'))).toBe(true);
      expect(blink(art.rows)).not.toEqual(art.rows);
      expect(blink(art.rows).join('')).not.toMatch(/w/);
    });
  }

  it('has six colours per palette, and every stored colour index renders every letter', () => {
    for (const kind of TOY_KINDS) {
      const art = plushArt(kind, HALLOWEEN_CLAW);
      for (const pal of [art.colors, art.shades, art.lights]) {
        expect(pal).toHaveLength(TOY_COLORS);
        for (const c of pal) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      }
      const used = new Set(art.rows.join('').replace(/\./g, ''));
      for (let c = 0; c < TOY_COLORS; c++) for (const ch of used) expect(spriteColor(ch, c, art)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('names read right in "You won a … plush!" and fit the LED line', () => {
    for (const kind of TOY_KINDS) {
      const name = plushName(kind, HALLOWEEN_CLAW);
      expect(name).toMatch(/^[a-z][a-z ]*$/);
      expect(name).not.toMatch(/^[aeiou]/);
      expect(name.length).toBeLessThanOrEqual(10);
    }
  });

  it('resolves its glass, sign and copy, cached per costume', () => {
    const inside = interiorOf(HALLOWEEN_CLAW);
    expect(inside).toBe(interiorOf(HALLOWEEN_CLAW));
    expect(inside.key).toBe('halloween-night:');
    expect(inside.sign).toBe('SPOOKY CUTIES');
    expect(inside.signFit).toBe(true);
    expect(inside.webs).toBe(true);
    expect(inside.neonRgb).toBe('255,122,46');
    expect(inside.side[0]).toMatch(/^rgba\(\d+,\d+,\d+,0\.95\)$/);
    expect(clawCopy(HALLOWEEN_CLAW)).toEqual({ plate: 'TREAT!', restock: 'FRESH TREATS!', floorWon: 'You won a treat!' });
    for (const kind of TOY_KINDS) {
      expect(plushArt(kind, HALLOWEEN_CLAW)).toBe(plushArt(kind, HALLOWEEN_CLAW));
      // Its sprites get their own cache keys (the machine's own keep '').
      expect(plushArt(kind, HALLOWEEN_CLAW).key).toBe('halloween-night:');
    }
  });
});

describe('a broken costume falls back field by field', () => {
  const broken = {
    id: 'Bad Id',
    plush: {
      blob: { rows: ['aaaa'], colors: ['#fff', '#000000'], name: 'owl', ink: { w: 'red' } },
      bunny: { rows: SPRITES.bunny.map((r) => r.replace(/a/g, 'z')) },
      dragon: { name: 'dragon' },
    },
    interior: { neon: 'pink', bg: ['#000000'], sign: 'way too long for the wall', glass: ['#000000', '#111111'] },
    copy: { plate: 'MUCH TOO LONG', restock: '' },
  } as unknown as ClawCostume;

  it('reports every problem', () => {
    const problems = clawCostumeProblems(broken).join('\n');
    expect(problems).toMatch(/^id /m);
    expect(problems).toMatch(/plush\.blob\.rows/);
    expect(problems).toMatch(/plush\.blob\.colors/);
    expect(problems).toMatch(/plush\.blob\.ink\.w/);
    expect(problems).toMatch(/plush\.blob\.name/);
    expect(problems).toMatch(/plush\.bunny\.rows/);
    expect(problems).toMatch(/plush\.dragon: unknown kind/);
    expect(problems).toMatch(/interior\.neon/);
    expect(problems).toMatch(/interior\.bg/);
    expect(problems).toMatch(/interior\.sign/);
    expect(problems).toMatch(/copy\.plate/);
    expect(problems).toMatch(/copy\.restock/);
  });

  it('draws the machine’s own art wherever the costume is invalid', () => {
    const blob = plushArt('blob', broken);
    expect(blob.rows).toBe(SPRITES.blob);
    expect(blob.colors).toBe(PLUSH_COLORS);
    expect(blob.ink.w).toBe('#ffffff');
    expect(blob.name).toBe('blob');
    expect(plushArt('bunny', broken).rows).toBe(SPRITES.bunny);
    const inside = interiorOf(broken);
    expect(inside.neon).toBe('#ff4fd8');
    expect(inside.bg).toEqual(interiorOf().bg);
    expect(inside.side).toEqual(interiorOf().side);
    expect(inside.sign).toBe('PLUSH PARADE');
    expect(inside.signFit).toBe(false);
    expect(inside.glass).toEqual(['#000000', '#111111']);
    expect(clawCopy(broken)).toEqual({ plate: 'PLUSH!', restock: 'FRESH PLUSHIES!', floorWon: 'You won a plush!' });
  });
});

describe('costumes never reach the pile or the prize shelf', () => {
  it('stored machines round-trip unchanged (kinds stay the four kinds)', () => {
    const inv = freshInventory(7);
    inv.shelf.bunny = 2;
    inv.colors.bunny = 4;
    inv.won = 2;
    expect(parseInventory(JSON.stringify(inv), null, 1)).toEqual(inv);
    for (const e of inv.pile) expect(TOY_KINDS).toContain(e.k);
    expect(TOY_KINDS).toEqual(['blob', 'bunny', 'star', 'bot']);
  });
});
