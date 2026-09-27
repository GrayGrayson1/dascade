/**
 * Brick Blitz levels: eight hand-designed layouts, then seeded procedural ones.
 *
 * Grid: 12 columns × up to 14 rows. Characters:
 *   .  empty          N  normal (1 hit)        A  armored (2 hits, 3 from level 9)
 *   X  explosive (blasts its 8 neighbours)     S  steel (indestructible, not required)
 *   P  power brick (always drops a capsule)    M  mover (slides along its row; rows with M hold only M and .)
 * Normal brick colours come from the row (a rainbow band per level palette).
 */
import { substream } from '../classics/shared/index.ts';

export const COLS = 12;
export const MAX_ROWS = 14;

export type BrickKind = 'N' | 'A' | 'X' | 'S' | 'P' | 'M';

export interface LevelDef {
  name: string;
  rows: string[];
}

export const LEVELS: LevelDef[] = [
  {
    name: 'Warm Up',
    rows: [
      '............',
      '.NNNNNNNNNN.',
      '.NNNNPNNNNN.',
      '.NNNNNNNNNN.',
      '.NNNNNNPNNN.',
      '.NNNNNNNNNN.',
    ],
  },
  {
    name: 'Armor Plate',
    rows: [
      '............',
      'AAAAAAAAAAAA',
      'NNNNNNNNNNNN',
      'NNANNPPNNANN',
      'NNNNNNNNNNNN',
      '..NNNNNNNN..',
      '....AAAA....',
    ],
  },
  {
    name: 'Fuse Box',
    rows: [
      '............',
      'NNNNNNNNNNNN',
      'NXNNNXXNNNXN',
      'NNNNPNNPNNNN',
      'NNXNNNNNNXNN',
      'NNNNNXXNNNNN',
      'ANNNNNNNNNNA',
      'AAANNNNNNAAA',
    ],
  },
  {
    name: 'Sliders',
    rows: [
      '............',
      'NNNNNNNNNNNN',
      '..MMM...MMM.',
      'NNNNNPPNNNNN',
      '.MMM...MMM..',
      'ANNNNNNNNNNA',
      '...MMMMMM...',
    ],
  },
  {
    name: 'Steel Garden',
    rows: [
      '............',
      'NNNPNNNNPNNN',
      'SSNNSSSSNNSS',
      'NNNNNXXNNNNN',
      'NNSSNNNNSSNN',
      'NNNNNNNNNNNN',
      'SNNNNAANNNNS',
      '.SNNNNNNNNS.',
    ],
  },
  {
    name: 'Pyramid',
    rows: [
      '.....PP.....',
      '....NNNN....',
      '...NNXXNN...',
      '..NNNAANNN..',
      '.NNNAXXANNN.',
      'NNNNAAAANNNN',
      'NNNXNNNNXNNN',
      'SSNNNNNNNNSS',
    ],
  },
  {
    name: 'Checker Storm',
    rows: [
      '............',
      'ANANANANANAN',
      'NXNANXNANXNA',
      'ANANAPANANAN',
      'NANXNANXNANA',
      '.MMMM..MMMM.',
      'ANANANANANAN',
      'NPNANANANAPN',
    ],
  },
  {
    name: 'Reactor Core',
    rows: [
      '............',
      'NNNNNNNNNNNN',
      'NSSSSSSSSSSN',
      'NS.XXXXXX.SN',
      'NS.XAPPAX.SN',
      'NS.XXXXXX.SN',
      'NSSSSS.SSSSN',
      'NNNNNN.NNNNN',
      '..MMMM..MMM.',
    ],
  },
];

/**
 * Procedural level `index` (0-based; used after the hand-made ones): a mirrored layout drawn
 * from the run seed, harder as it goes (more armor/steel/explosives, occasional mover rows).
 */
export function generateLevel(seed: string, index: number): LevelDef {
  const rng = substream(seed, `level-${index}`);
  const depth = index - LEVELS.length; // 0, 1, 2…
  const rowsCount = Math.min(MAX_ROWS - 2, 7 + Math.min(4, Math.floor(depth / 2)) + rng.int(2));
  const armorPct = Math.min(38, 12 + depth * 3);
  const steelPct = Math.min(12, 3 + depth);
  const blastPct = Math.min(14, 5 + depth);
  const rows: string[] = ['............'];
  let moverRows = 0;
  for (let r = 0; r < rowsCount; r++) {
    if (r > 1 && moverRows < 2 && rng.int(100) < 14 + depth) {
      moverRows++;
      const start = rng.int(3);
      const len = 2 + rng.int(4 - start);
      const half = ('.'.repeat(start) + 'M'.repeat(len)).padEnd(COLS / 2, '.');
      rows.push(half + [...half].reverse().join(''));
      continue;
    }
    const half: string[] = [];
    const shape = rng.int(4); // 0 full, 1 hollow edge, 2 staggered, 3 centre gap
    for (let c = 0; c < COLS / 2; c++) {
      let empty = false;
      if (shape === 1 && c === 0 && r % 2 === 1) empty = true;
      if (shape === 2 && (r + c) % 4 === 3) empty = true;
      if (shape === 3 && c === 5 && r % 3 !== 0) empty = true;
      if (empty) {
        half.push('.');
        continue;
      }
      const roll = rng.int(100);
      if (roll < steelPct && r > 0) half.push('S');
      else if (roll < steelPct + blastPct) half.push('X');
      else if (roll < steelPct + blastPct + armorPct) half.push('A');
      else if (roll < steelPct + blastPct + armorPct + 4) half.push('P');
      else half.push('N');
    }
    rows.push(half.join('') + [...half].reverse().join(''));
  }
  // Guarantee plenty of breakable bricks.
  const breakable = rows.join('').replace(/[.S]/g, '').length;
  if (breakable < 24) rows.push('NNNNNNNNNNNN', 'NNNPNNNNPNNN');
  return { name: `Sector ${depth + 1}`, rows };
}

export function levelDef(seed: string, index: number): LevelDef {
  return index < LEVELS.length ? LEVELS[index]! : generateLevel(seed, index);
}
