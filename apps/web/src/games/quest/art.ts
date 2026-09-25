/**
 * Original pixel art for DASQuest: 16×16 hero portraits (composed from a shared
 * head-and-shoulders base plus an archetype overlay) and 10×10 item glyphs.
 * Grids use the design-system palette letters; 'a' is drawn in the player's color.
 *   '.' keep base / transparent, '_' erase, k ink, s skin, b hair, w white, y yellow,
 *   c cyan, p pink, r red, o orange, g green, n grey-violet.
 */
import type { QuestArchetypeId } from '@dascade/shared/games/quest';

const BASE = [
  '................',
  '................',
  '................',
  '.....kkkkkk.....',
  '....kssssssk....',
  '....kssssssk....',
  '....kskssksk....',
  '....kssssssk....',
  '....ksskkssk....',
  '.....kssssk.....',
  '......kssk......',
  '...kkkaaaakkk...',
  '..kaaaaaaaaaak..',
  '.kaaaaaaaaaaaak.',
  '.kaaaaaaaaaaaak.',
  '.kkkkkkkkkkkkkk.',
];

const OVERLAYS: Record<QuestArchetypeId, string[]> = {
  guardian: [
    '................',
    '.....kkkkkk.....',
    '....kaaaaaak....',
    '...kaaaaaaaak...',
    '...kaaaaaaaak...',
    '...kaaaaaaaak...',
    '...kkcccccckk...',
    '...kk......kk...',
    '...ka......ak...',
    '................',
    '................',
    'kkkkkk....kkkkkk',
    'kaaaaak..kaaaaak',
    'kaaaaak..kaaaaak',
    'kwaaaak..kaaaawk',
    'kkkkkkkkkkkkkkkk',
  ],
  scout: [
    '................',
    '......kkkk......',
    '....kkaaaakk....',
    '...kaakkkkaak...',
    '...kakcyycckak..',
    '...ka......ak...',
    '...ka......ak...',
    '...ka......ak...',
    '...kka....akk...',
    '....kka..akk....',
    '....krrrrrrk....',
    '...krrrrrrrrk...',
    '..kaaarraaaaak..',
    '................',
    '................',
    '................',
  ],
  tinker: [
    '....b..b..b.....',
    '....bbbbbbbb....',
    '...bbbbbbbbbb...',
    '...bkkkkkkkkb...',
    '...byycyycyyb...',
    '...b........b...',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '..kanaaaaaanak..',
    '.kaanaaaaaanaak.',
    '.kaanaaaaaanwwk.',
    '................',
  ],
  trickster: [
    '................',
    '.....kkkkkk.....',
    '....kaaaaaak....',
    '....kkkkkkkk....',
    '..kkkkkkkkkkkk..',
    '................',
    '....kskkskkk....',
    '................',
    '....kskkkksk....',
    '................',
    '................',
    '...kkkwwwwkkk...',
    '..kaaaappaaaak..',
    '.kaaaaawwaaaaak.',
    '.kaaaaawwaaaaak.',
    '................',
  ],
  analyst: [
    '................',
    '................',
    '....kkkkkkkk....',
    '...kkkkkkkkkk...',
    '...kkksssssk....',
    '....k......k....',
    '...wwwwwwwwww...',
    '....kw.kk.wk....',
    '................',
    '................',
    '................',
    '...kkkwaawkkk...',
    '..kaaaawaawaak..',
    '.kaaaaawaawaaak.',
    '.kaaaaaawwaaaak.',
    '................',
  ],
  seer: [
    '.......yy.......',
    '.......kk.......',
    '.....kkaakk.....',
    '....kaaaaaak....',
    '...kaakkkkaak...',
    '...kak....kak...',
    '...kaksckcsak...',
    '...kak....kak...',
    '...kaak..kaak...',
    '...kaaakkaaak...',
    '..kaaaakkaaaak..',
    '..kaaaaaaaaaak..',
    '.kaaaaayyaaaaak.',
    '.kaaaaaayaaaaak.',
    '................',
    '................',
  ],
};

function compose(base: string[], overlay: string[]): string[] {
  return base.map((row, y) => {
    const o = overlay[y] ?? '';
    let out = '';
    for (let x = 0; x < row.length; x++) {
      const ch = o[x] ?? '.';
      out += ch === '.' ? row[x] : ch === '_' ? '.' : ch;
    }
    return out;
  });
}

export const PORTRAITS: Record<QuestArchetypeId, string[]> = {
  guardian: compose(BASE, OVERLAYS.guardian),
  scout: compose(BASE, OVERLAYS.scout),
  tinker: compose(BASE, OVERLAYS.tinker),
  trickster: compose(BASE, OVERLAYS.trickster),
  analyst: compose(BASE, OVERLAYS.analyst),
  seer: compose(BASE, OVERLAYS.seer),
};

/** A "who's this?" portrait for empty seats. */
export const UNKNOWN_PORTRAIT = compose(BASE, [
  '................',
  '................',
  '................',
  '.....nnnnnn.....',
  '....nnnnnnnn....',
  '....nnnnnnnn....',
  '....nnwwnnnn....',
  '....nnnnwnnn....',
  '....nnnwnnnn....',
  '.....nnnnnn.....',
  '......nwnn......',
  '...nnnnnnnnnn...',
  '..nnnnnnnnnnnn..',
  '.nnnnnnnnnnnnnn.',
  '.nnnnnnnnnnnnnn.',
  '.nnnnnnnnnnnnnn.',
]);

// ---------------------------------------------------------------------------
// Item glyphs (10×10)
// ---------------------------------------------------------------------------

export const GLYPHS: Record<string, string[]> = {
  keycard: ['..........', '.kkkkkkkk.', '.kwwwwwwk.', '.kwaawwwk.', '.kwaawnnk.', '.kwwwwwwk.', '.kwnnnnwk.', '.kwwwwwwk.', '.kkkkkkkk.', '..........'],
  map: ['..........', 'kkkkkkkkk.', 'kwwwawwwk.', 'kwwaawwwk.', 'kwaawwrwk.', 'kaawwwwwk.', 'kwwwwaawk.', 'kwwwaawwk.', 'kkkkkkkkk.', '..........'],
  cup: ['..w..w....', '...w..w...', '..........', '.kkkkkkk..', '.kwwwwwkkk', '.kbbbbbk.k', '.kwwwwwkkk', '.kwwwwwk..', '..kkkkk...', '..........'],
  kit: ['...kkkk...', '..k....k..', 'kkkkkkkkkk', 'krrrrrrrrk', 'krrrwwrrrk', 'krrwwwwrrk', 'krrrwwrrrk', 'krrrrrrrrk', 'kkkkkkkkkk', '..........'],
  bar: ['..........', '..........', '.kkkkkkkk.', 'kyyyyyyyyk', 'kbbbbbbbbk', 'kyykyykyyk', 'kbbbbbbbbk', '.kkkkkkkk.', '..........', '..........'],
  candy: ['..........', '..k....k..', '.kgk..kgk.', '.kggkkggk.', '..kgwwgk..', '..kgggak..', '.kggkkggk.', '.kgk..kgk.', '..k....k..', '..........'],
  tape: ['..........', '..kkkkkk..', '.knnnnnnk.', 'knnkkkknnk', 'knk....knk', 'knk....knk', 'knnkkkknnk', '.knnnnnnk.', '..kkkkkkww', '........ww'],
  flashlight: ['..........', 'y.........', '.y..kkk...', 'yy.kyyyk..', '...kyyyykk', '...kyyykaa', '...kyyykaa', '...kyyyykk', '....kkkk..', '..........'],
  notes: ['..........', '.kkkkkkkk.', '.kyyyyyyk.', '.kykkkkyk.', '.kyyyyyyk.', '.kykkkyyk.', '.kyyyyyyk.', '.kyyyyykk.', '.kkkkkkk..', '..........'],
  stapler: ['..........', '..........', '.kkkkkkkk.', 'kaaaaaaaak', 'kkkkkkkkak', '.knnnnnnk.', 'kkkkkkkkkk', 'knnnnnnnnk', 'kkkkkkkkkk', '..........'],
  hook: ['......kkk.', '.....knnk.', '....knnk..', '...knnk...', '..kaakk...', '.kaaak....', 'kaaak.....', 'kwwk......', '.kk.......', '..........'],
  usb: ['...kkkk...', '...kwwk...', '...kkkk...', '..kkkkkk..', '..kbbbbk..', '..kbbbbk..', '..kbabbk..', '..kbbbbk..', '..kkkkkk..', '..........'],
  lanyard: ['.a......a.', '..a....a..', '...a..a...', '....aa....', '..kkkkkk..', '..kwwwwk..', '..kwaawk..', '..kwwwwk..', '..kkkkkk..', '..........'],
  duck: ['..........', '....kkk...', '...kyyyk..', '...kykyk..', '..kyyyyoo.', '.kyyyyyk..', 'kyyyyyyyk.', 'kyyyyyyyk.', '.kkkkkkk..', '..........'],
  charm: ['....a.....', '...aoa....', '..a.o.a...', '....o.....', '...ooo....', '..o.o.o...', '....o.....', '...kkk....', '..kccck...', '...kkk....'],
  pass: ['..........', '....kk....', '.kkkkkkkk.', '.kwwwwwwk.', '.kwaawwwk.', '.kwaawnnk.', '.kwwwwwwk.', '.kgggggwk.', '.kkkkkkkk.', '..........'],
  pizza: ['..........', 'kkkkkkkkkk', 'kwwwwwwwwk', 'kooroooook', 'kooooorook', 'koroooroook'.slice(0, 10), 'kooooooook', 'kkkkkkkkkk', '..........', '..........'],
  token: ['..........', '...kkkk...', '..kyyyyk..', '.kyykkyyk.', '.kykyykyk.', '.kykyykyk.', '.kyykkyyk.', '..kyyyyk..', '...kkkk...', '..........'],
  'star-token': ['....y.....', '...kkkk...', '..kyyyyk..', '.kyywyyyk.', 'ykyyyyyyky', '.kyyyyyyk.', '.kyyyyyyk.', '..kyyyyk..', '...kkkk...', '....y.....'],
  lens: ['..........', '..kkkk....', '.kccwck...', 'kccccwck..', 'kccccccck.', 'kccccccck.', '.kccccck..', '..kkkkkkk.', '.......kk.', '........k.'],
  box: ['..........', '.kkkkkkkk.', '.knnnnnnk.', '.kkkkkkkk.', '.kbbbbbbk.', '.kbbkkbbk.', '.kbbbbbbk.', '.kbbbbbbk.', '.kkkkkkkk.', '..........'],
};

export function glyph(icon: string): string[] {
  return GLYPHS[icon] ?? GLYPHS.box!;
}

// ---------------------------------------------------------------------------
// The pixel d20 (drawn at 24×24 inside the dice overlay SVG)
// ---------------------------------------------------------------------------

/** Outer hexagon + inner triangle of an icosahedron silhouette, in a 24×24 box. */
export const D20_OUTER = '12,1 22,6.5 22,17.5 12,23 2,17.5 2,6.5';
export const D20_INNER = '12,5 19,16.5 5,16.5';
