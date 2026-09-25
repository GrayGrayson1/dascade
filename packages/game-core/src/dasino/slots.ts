/**
 * DASino "Neon 7s" slot machine — an original 3-reel × 3-row machine.
 *
 * Model (fully transparent, shown on the in-game info screen):
 *  - Three explicit reel strips of 32 stops each. The server picks each reel's
 *    stop independently and uniformly with its crypto RNG (32³ = 32,768
 *    equally likely outcomes).
 *  - The window shows, for reel r with stop s: top = strip[s−1], middle =
 *    strip[s], bottom = strip[s+1] (wrapping around the strip).
 *  - Five paylines (1 = middle, 2 = top, 3 = bottom, 4 = "V" diagonal from top-left,
 *    5 = "Λ" diagonal from bottom-left). The player picks 1, 3 or 5 lines and a
 *    line bet; total bet = line bet × lines.
 *  - Each line is read left to right. DAS (wild) substitutes for every symbol,
 *    and three DAS pay their own jackpot. A line pays only its single highest
 *    combination, in multiples of the line bet.
 *  - Because every reel stop is uniform and the reels are independent, every
 *    payline has the same distribution, so the RTP does not depend on how many
 *    lines are played. It is computed exactly by enumerating all 32,768 stop
 *    combinations (see slotStats and the unit tests).
 */
import type { Rng } from '@dascade/shared';

export const SLOT_SYMBOLS = ['cherry', 'joystick', 'floppy', 'bell', 'coin', 'rocket', 'seven', 'das'] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];

export const SLOT_WILD: SlotSymbol = 'das';
export const SLOT_REEL_COUNT = 3;
export const SLOT_ROWS = 3;
export const SLOT_STRIP_LENGTH = 32;

export const SLOT_SYMBOL_NAMES: Readonly<Record<SlotSymbol, string>> = {
  cherry: 'Pixel Cherry',
  joystick: 'Joystick',
  floppy: 'Floppy Disk',
  bell: 'Neon Bell',
  coin: 'Arcade Coin',
  rocket: 'Rocket',
  seven: 'Lucky 7-bit',
  das: 'DAS Wild',
};

/** Line pays in multiples of the line bet, keyed by how many matching symbols run from the left reel. */
export const SLOT_PAYTABLE: Readonly<Record<SlotSymbol, Readonly<Partial<Record<1 | 2 | 3, number>>>>> = {
  das: { 3: 300 },
  seven: { 3: 100, 2: 5 },
  rocket: { 3: 40 },
  coin: { 3: 20 },
  bell: { 3: 12 },
  floppy: { 3: 8 },
  joystick: { 3: 6 },
  cherry: { 3: 5, 2: 2, 1: 1 },
};

/** Reel strips (32 stops each). Index = stop; the stop is shown on the middle row. */
export const SLOT_REELS: readonly (readonly SlotSymbol[])[] = [
  [
    'das', 'coin', 'floppy', 'seven', 'bell', 'cherry', 'rocket', 'joystick',
    'coin', 'joystick', 'floppy', 'joystick', 'bell', 'cherry', 'joystick', 'floppy',
    'das', 'rocket', 'coin', 'seven', 'bell', 'floppy', 'cherry', 'joystick',
    'cherry', 'coin', 'joystick', 'rocket', 'bell', 'floppy', 'joystick', 'cherry',
  ],
  [
    'rocket', 'floppy', 'joystick', 'bell', 'joystick', 'das', 'coin', 'floppy',
    'seven', 'cherry', 'rocket', 'cherry', 'bell', 'joystick', 'coin', 'floppy',
    'joystick', 'bell', 'cherry', 'joystick', 'floppy', 'das', 'rocket', 'coin',
    'seven', 'bell', 'floppy', 'cherry', 'joystick', 'cherry', 'coin', 'bell',
  ],
  [
    'cherry', 'rocket', 'cherry', 'joystick', 'coin', 'bell', 'floppy', 'joystick',
    'cherry', 'joystick', 'bell', 'das', 'coin', 'floppy', 'seven', 'floppy',
    'cherry', 'rocket', 'bell', 'cherry', 'coin', 'floppy', 'joystick', 'bell',
    'cherry', 'joystick', 'floppy', 'joystick', 'coin', 'bell', 'seven', 'floppy',
  ],
];

/** Row (0 = top, 1 = middle, 2 = bottom) used on each reel by each payline. */
export const SLOT_PAYLINES: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [0, 0, 0],
  [2, 2, 2],
  [0, 1, 2],
  [2, 1, 0],
];

export const SLOT_PAYLINE_NAMES = ['Middle', 'Top', 'Bottom', 'Diagonal ↘', 'Diagonal ↗'] as const;

/** Lines a player may play (always the first N paylines). */
export const SLOT_LINE_OPTIONS = [1, 3, 5] as const;

export type SlotStops = [number, number, number];
/** grid[reel][row] */
export type SlotGrid = SlotSymbol[][];

export interface SlotLineWin {
  /** Payline index 0–4. */
  line: number;
  symbol: SlotSymbol;
  /** Matching symbols from the left (1–3). */
  count: number;
  /** Multiple of the line bet. */
  multiplier: number;
  /** Chips won on this line. */
  pay: number;
  /** [reel, row] cells that form the win. */
  cells: Array<[number, number]>;
}

export interface SlotSpinOutcome {
  stops: SlotStops;
  grid: SlotGrid;
  lines: number;
  lineBet: number;
  totalBet: number;
  wins: SlotLineWin[];
  totalWin: number;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function isValidStops(stops: readonly number[]): stops is SlotStops {
  return (
    stops.length === SLOT_REEL_COUNT &&
    stops.every((s, i) => Number.isInteger(s) && s >= 0 && s < (SLOT_REELS[i]?.length ?? 0))
  );
}

/** The 3×3 window for a set of stops: grid[reel][row]. */
export function slotWindow(stops: SlotStops): SlotGrid {
  return SLOT_REELS.map((strip, r) => {
    const s = stops[r] as number;
    return [strip[mod(s - 1, strip.length)]!, strip[mod(s, strip.length)]!, strip[mod(s + 1, strip.length)]!];
  });
}

/** Best pay for three symbols on one line (left to right). Null when the line doesn't pay. */
export function evaluateLine(symbols: readonly SlotSymbol[]): { symbol: SlotSymbol; count: number; multiplier: number } | null {
  let best: { symbol: SlotSymbol; count: number; multiplier: number } | null = null;
  const consider = (symbol: SlotSymbol, count: number) => {
    const multiplier = SLOT_PAYTABLE[symbol][count as 1 | 2 | 3] ?? 0;
    if (multiplier > 0 && (!best || multiplier > best.multiplier)) best = { symbol, count, multiplier };
  };
  if (symbols.every((s) => s === SLOT_WILD)) consider(SLOT_WILD, symbols.length);
  for (const symbol of SLOT_SYMBOLS) {
    if (symbol === SLOT_WILD) continue;
    let run = 0;
    while (run < symbols.length && (symbols[run] === symbol || symbols[run] === SLOT_WILD)) run++;
    if (run > 0) consider(symbol, run);
  }
  return best;
}

export function isValidSlotBet(lineBet: number, lines: number): boolean {
  return Number.isInteger(lineBet) && lineBet > 0 && (SLOT_LINE_OPTIONS as readonly number[]).includes(lines);
}

/** Evaluate a spin for the given stops and bet. Pure: the server decides the stops. */
export function evaluateSpin(stops: SlotStops, lineBet: number, lines: number): SlotSpinOutcome {
  if (!isValidStops(stops)) throw new RangeError(`Invalid stops: ${String(stops)}`);
  if (!isValidSlotBet(lineBet, lines)) throw new RangeError(`Invalid bet: ${lineBet} × ${lines}`);
  const grid = slotWindow(stops);
  const wins: SlotLineWin[] = [];
  for (let line = 0; line < lines; line++) {
    const rows = SLOT_PAYLINES[line]!;
    const symbols = rows.map((row, reel) => grid[reel]![row]!);
    const hit = evaluateLine(symbols);
    if (!hit) continue;
    wins.push({
      line,
      symbol: hit.symbol,
      count: hit.count,
      multiplier: hit.multiplier,
      pay: hit.multiplier * lineBet,
      cells: rows.slice(0, hit.count).map((row, reel) => [reel, row] as [number, number]),
    });
  }
  return {
    stops: [...stops] as SlotStops,
    grid,
    lines,
    lineBet,
    totalBet: lineBet * lines,
    wins,
    totalWin: wins.reduce((s, w) => s + w.pay, 0),
  };
}

/** Server-side spin: each reel's stop is drawn independently and uniformly. */
export function spinSlotStops(rng: Rng): SlotStops {
  return SLOT_REELS.map((strip) => rng.int(strip.length)) as SlotStops;
}

export function spinSlots(rng: Rng, lineBet: number, lines: number): SlotSpinOutcome {
  return evaluateSpin(spinSlotStops(rng), lineBet, lines);
}

/** How many of each symbol sit on each reel. */
export function slotStripComposition(): Array<Record<SlotSymbol, number>> {
  return SLOT_REELS.map((strip) => {
    const counts = Object.fromEntries(SLOT_SYMBOLS.map((s) => [s, 0])) as Record<SlotSymbol, number>;
    for (const s of strip) counts[s]++;
    return counts;
  });
}

export interface SlotStats {
  /** Number of equally likely stop combinations enumerated. */
  combinations: number;
  /** Return to player (0–1) for any number of lines. */
  rtp: number;
  /** Probability that a single line pays anything. */
  lineHitRate: number;
  /** Probability that a 5-line spin pays anything. */
  spinHitRate: number;
  /** Probability that a 5-line spin pays at least 10× the total bet. */
  bigWinRate: number;
  /** Total line-bet multiples returned over every combination × 5 lines (exact numerator of the RTP). */
  totalReturn: number;
  /** Per-symbol probability of a 3-of-a-kind (wild-assisted included) on one line. */
  threeOfAKind: Record<SlotSymbol, number>;
}

let cachedStats: SlotStats | null = null;

/** Exact statistics by exhaustive enumeration of every stop combination (32,768 spins × 5 lines). */
export function slotStats(): SlotStats {
  if (cachedStats) return cachedStats;
  const [a, b, c] = SLOT_REELS as [readonly SlotSymbol[], readonly SlotSymbol[], readonly SlotSymbol[]];
  const lines = SLOT_PAYLINES.length;
  let combinations = 0;
  let totalReturn = 0;
  let lineHits = 0;
  let spinHits = 0;
  let bigWins = 0;
  const three = Object.fromEntries(SLOT_SYMBOLS.map((s) => [s, 0])) as Record<SlotSymbol, number>;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      for (let k = 0; k < c.length; k++) {
        const outcome = evaluateSpin([i, j, k], 1, lines);
        combinations++;
        totalReturn += outcome.totalWin;
        lineHits += outcome.wins.length;
        if (outcome.totalWin > 0) spinHits++;
        if (outcome.totalWin >= 10 * lines) bigWins++;
        for (const w of outcome.wins) if (w.count === 3) three[w.symbol]++;
      }
    }
  }
  const lineSpins = combinations * lines;
  cachedStats = {
    combinations,
    rtp: totalReturn / lineSpins,
    lineHitRate: lineHits / lineSpins,
    spinHitRate: spinHits / combinations,
    bigWinRate: bigWins / combinations,
    totalReturn,
    threeOfAKind: Object.fromEntries(SLOT_SYMBOLS.map((s) => [s, three[s] / lineSpins])) as Record<SlotSymbol, number>,
  };
  return cachedStats;
}
