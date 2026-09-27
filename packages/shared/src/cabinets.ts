/**
 * The DASCADE arcade lineup: cabinets group one or more games.
 *
 * - A single-game cabinet opens its game's title screen directly (/play/<gameId>).
 * - A multi-game cabinet opens an in-world picker (/cabinet/<cabinetId>) listing its games.
 * Games (rooms, rules, lobbies) are defined in catalog.ts; this file is pure navigation metadata.
 */
import type { GameAccent, GameId } from './catalog.ts';
import { GAME_CATALOG } from './catalog.ts';

export const CABINET_IDS = [
  'dasketch',
  'bingo',
  'wheel',
  'dasino',
  'boardroom',
  'stravaganza',
  'putt',
  'tanks',
  'classics',
  'circuit',
  'quest',
] as const;

export type CabinetId = (typeof CABINET_IDS)[number];

export function isCabinetId(value: unknown): value is CabinetId {
  return typeof value === 'string' && (CABINET_IDS as readonly string[]).includes(value);
}

export interface CabinetGame {
  /** Unique within the cabinet (stable; used in URLs and tests). */
  key: string;
  gameId: GameId;
  /** Optional sub-mode opened inside the game's room, e.g. a DASino floor table ('roulette'). */
  variant?: string;
  title: string;
  /** One line shown in the cabinet picker. */
  blurb: string;
}

export interface CabinetDef {
  id: CabinetId;
  title: string;
  /** Marquee text (uppercase styling is applied by the renderer). */
  marquee: string;
  /** Game-family descriptor shown under the marquee, e.g. "Cards & Casino". */
  family: string;
  tagline: string;
  description: string;
  accent: GameAccent;
  games: CabinetGame[];
}

const g = (gameId: GameId, blurb?: string, key: string = gameId, title?: string, variant?: string): CabinetGame => ({
  key,
  gameId,
  title: title ?? GAME_CATALOG[gameId].title,
  blurb: blurb ?? GAME_CATALOG[gameId].tagline,
  ...(variant ? { variant } : {}),
});

export const CABINETS: Record<CabinetId, CabinetDef> = {
  dasketch: {
    id: 'dasketch',
    title: 'DASketch',
    marquee: 'DASKETCH',
    family: 'Draw & Guess',
    tagline: GAME_CATALOG.dasketch.tagline,
    description: GAME_CATALOG.dasketch.description,
    accent: GAME_CATALOG.dasketch.accent,
    games: [g('dasketch')],
  },
  bingo: {
    id: 'bingo',
    title: 'DAS Bingo',
    marquee: 'DAS BINGO',
    family: 'Bingo Hall',
    tagline: GAME_CATALOG.bingo.tagline,
    description: GAME_CATALOG.bingo.description,
    accent: GAME_CATALOG.bingo.accent,
    games: [g('bingo')],
  },
  wheel: {
    id: 'wheel',
    title: 'Wheel of DAStiny',
    marquee: 'WHEEL OF DASTINY',
    family: 'Prize Wheel',
    tagline: GAME_CATALOG.wheel.tagline,
    description: GAME_CATALOG.wheel.description,
    accent: GAME_CATALOG.wheel.accent,
    games: [g('wheel')],
  },
  dasino: {
    id: 'dasino',
    title: 'DASino',
    marquee: 'DASINO',
    family: 'Cards & Casino',
    tagline: 'Five tables, one neon casino floor. Virtual chips only.',
    description:
      "Texas Hold'em, blackjack, European roulette, an original slot machine and high/low dice. Every chip is virtual and worthless — no real money, purchases or cash-out, ever.",
    accent: { primary: '#c084fc', secondary: '#ffd23f', deep: '#1c0b2e' },
    games: [
      g('holdem', 'No-limit poker for 2–10 seats with side pots and spectators.', 'holdem', "Texas Hold'em"),
      g('blackjack', 'Beat the dealer with splits, doubles and insurance.', 'blackjack', 'Blackjack'),
      g('dasino', 'European single-zero wheel with a shared betting window.', 'roulette', 'Roulette', 'roulette'),
      g('dasino', 'An original DASCADE slot machine with a full paytable.', 'slots', 'Slots', 'slots'),
      g('dasino', 'Call the next roll higher or lower. Quick and streaky.', 'highlow', 'High/Low', 'dice'),
    ],
  },
  boardroom: {
    id: 'boardroom',
    title: 'DAS Boardroom',
    marquee: 'DAS BOARDROOM',
    family: 'Strategy & Board Games',
    tagline: 'Chess, checkers and a hidden-fleet duel. Tournament ready.',
    description:
      'The executive strategy lounge: real-time chess with clocks, American checkers and DAS Ships, an original hidden-fleet duel. Every board runs in the Tournament Center.',
    accent: { primary: '#e8c07d', secondary: '#38bdf8', deep: '#141008' },
    games: [g('chess'), g('checkers'), g('ships')],
  },
  stravaganza: {
    id: 'stravaganza',
    title: 'DAStravaganza',
    marquee: 'DASTRAVAGANZA',
    family: 'Party Games',
    tagline: 'Five party games for three to thirty players.',
    description:
      'The game-night machine: a trivia show, a social-deduction thriller, a comedy writing contest, word games and a survey of your own group. Works for a small team or the whole office.',
    accent: { primary: '#ff4f81', secondary: '#ffd23f', deep: '#2a0718' },
    games: [g('trivia'), g('deception'), g('masterpiece'), g('words'), g('survey')],
  },
  putt: {
    id: 'putt',
    title: 'DAS Putt',
    marquee: 'DAS PUTT',
    family: 'Mini Golf',
    tagline: GAME_CATALOG.putt.tagline,
    description: GAME_CATALOG.putt.description,
    accent: GAME_CATALOG.putt.accent,
    games: [g('putt')],
  },
  tanks: {
    id: 'tanks',
    title: 'DAS Tanks',
    marquee: 'DAS TANKS',
    family: 'Artillery Battle',
    tagline: GAME_CATALOG.tanks.tagline,
    description: GAME_CATALOG.tanks.description,
    accent: GAME_CATALOG.tanks.accent,
    games: [g('tanks')],
  },
  classics: {
    id: 'classics',
    title: 'DAScade Classics',
    marquee: 'DASCADE CLASSICS',
    family: 'Arcade Classics',
    tagline: 'Six original arcade quick-plays with high scores.',
    description:
      'Paddle duels, a neon snake arena, brick breaking, an asteroid run, a memory gauntlet and a falling-block puzzle. Play solo for a high score or challenge the office.',
    accent: { primary: '#7cf5ff', secondary: '#ff4fd8', deep: '#050b1f' },
    games: [g('paddle'), g('snake'), g('bricks'), g('asteroids'), g('memory'), g('blocks')],
  },
  circuit: {
    id: 'circuit',
    title: 'DAS Raceway',
    marquee: 'DAS RACEWAY',
    family: 'Racing',
    tagline: 'Two racers, one cabinet: DASh Circuit and DASphalt GP.',
    description:
      'Top-down neon racing in DASh Circuit, or kart racing with drifts, items and Grand Prix cups in DASphalt GP. Race friends, race bots, or race the clock.',
    accent: GAME_CATALOG.circuit.accent,
    games: [g('circuit', 'Top-down neon racing. Build your car, then chase the lap record.'), g('kart', 'Kart racing with drift boosts, items, bots and Grand Prix cups.')],
  },
  quest: {
    id: 'quest',
    title: 'DASQuest',
    marquee: 'DASQUEST',
    family: 'Co-op Adventure',
    tagline: GAME_CATALOG.quest.tagline,
    description: GAME_CATALOG.quest.description,
    accent: GAME_CATALOG.quest.accent,
    games: [g('quest')],
  },
};

export const CABINET_LIST: CabinetDef[] = CABINET_IDS.map((id) => CABINETS[id]);

export function isMultiGameCabinet(cabinet: CabinetDef): boolean {
  return cabinet.games.length > 1;
}

/** The cabinet a game lives in (the first cabinet listing it). */
export function cabinetForGame(gameId: GameId): CabinetDef | undefined {
  return CABINET_LIST.find((c) => c.games.some((game) => game.gameId === gameId));
}

/** Where opening a cabinet goes: its picker, or straight to its only game. */
export function cabinetPath(cabinet: CabinetDef): string {
  const only = cabinet.games[0];
  return cabinet.games.length === 1 && only ? playPath(only) : `/cabinet/${cabinet.id}`;
}

/** Title-screen path for one cabinet entry (a variant is carried as ?table=). */
export function playPath(game: Pick<CabinetGame, 'gameId' | 'variant'>): string {
  return `/play/${game.gameId}${game.variant ? `?table=${encodeURIComponent(game.variant)}` : ''}`;
}

/** "1–30 players" style label across every game in a cabinet. */
export function cabinetPlayersLabel(cabinet: CabinetDef): string {
  let min = Infinity;
  let max = 0;
  for (const game of cabinet.games) {
    const cap = GAME_CATALOG[game.gameId].capacity;
    min = Math.min(min, cap.minPlayers);
    max = Math.max(max, cap.maxPlayersLimit);
  }
  if (!Number.isFinite(min)) return '';
  return min === max ? `${min} player${min === 1 ? '' : 's'}` : `${min}–${max} players`;
}
