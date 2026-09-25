/**
 * The DASCADE cabinet catalog. Pure metadata shared by the arcade floor, lobby
 * and game server. Adding a game = add an entry here + a server room + a client module.
 */

export const GAME_IDS = [
  'dasketch',
  'holdem',
  'blackjack',
  'bingo',
  'wheel',
  'dasino',
  'circuit',
  'quest',
] as const;

export type GameId = (typeof GAME_IDS)[number];

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && (GAME_IDS as readonly string[]).includes(value);
}

export interface GameAccent {
  /** Primary neon accent (hex). */
  primary: string;
  /** Secondary accent used for gradients / highlights. */
  secondary: string;
  /** Deep background tint for the game's environment. */
  deep: string;
}

export interface GameCapacity {
  /** Minimum active (non-spectator) players needed to start. */
  minPlayers: number;
  /** Default active-player limit for a new room. */
  defaultMaxPlayers: number;
  /** Hard ceiling for active players that a host may configure. */
  maxPlayersLimit: number;
  /** Hard ceiling for total room population (players + spectators). */
  maxRoomSize: number;
  supportsSpectators: boolean;
  /** Whether people joining mid-match can play immediately (otherwise they spectate until the next round/hand/race). */
  lateJoinAsPlayer: boolean;
  /** Game can be played alone (time trial, solo casino, etc.). */
  supportsSolo: boolean;
}

export interface GameCatalogEntry {
  id: GameId;
  title: string;
  /** Short marquee text (may differ in casing/spacing from title). */
  marquee: string;
  tagline: string;
  description: string;
  category: 'party' | 'casino' | 'racing' | 'adventure';
  accent: GameAccent;
  capacity: GameCapacity;
  /** One-line control hints for the cabinet plaque. */
  controls: string[];
  /** Plain-language quick rules shown in help. */
  howToPlay: string[];
  /** Virtual-chip games show the no-real-money notice. */
  virtualChips: boolean;
  /** Game prefers landscape on phones. */
  prefersLandscape: boolean;
}

export const GAME_CATALOG: Record<GameId, GameCatalogEntry> = {
  dasketch: {
    id: 'dasketch',
    title: 'DASketch',
    marquee: 'DASKETCH',
    tagline: 'Draw it. Guess it. Get the glory.',
    description:
      'One artist draws a secret word while everyone races to guess it in chat. Faster guesses score more — and the artist earns points for every correct guess.',
    category: 'party',
    accent: { primary: '#ff4fd8', secondary: '#ffd23f', deep: '#2a0b2e' },
    capacity: {
      minPlayers: 2,
      defaultMaxPlayers: 12,
      maxPlayersLimit: 30,
      maxRoomSize: 40,
      supportsSpectators: true,
      lateJoinAsPlayer: true,
      supportsSolo: false,
    },
    controls: ['Draw with mouse, pen or finger', 'Type guesses in chat'],
    howToPlay: [
      'Each round, every player takes a turn as the artist.',
      'The artist picks one of three secret words and draws it — no letters or numbers!',
      'Everyone else types guesses. Correct guesses are hidden from players still guessing.',
      'Guess faster for more points. The artist scores for every player who gets it.',
    ],
    virtualChips: false,
    prefersLandscape: false,
  },
  holdem: {
    id: 'holdem',
    title: "DAS Hold'em",
    marquee: "DAS HOLD'EM",
    tagline: 'No-limit Texas Hold’em. Virtual chips, real bragging rights.',
    description:
      'Full no-limit Texas Hold’em for 2–10 seats with blinds, side pots, showdowns and spectators. Chips are virtual and worthless — the glory is not.',
    category: 'casino',
    accent: { primary: '#2de38f', secondary: '#ffd23f', deep: '#06261a' },
    capacity: {
      minPlayers: 2,
      defaultMaxPlayers: 8,
      maxPlayersLimit: 10,
      maxRoomSize: 30,
      supportsSpectators: true,
      lateJoinAsPlayer: false,
      supportsSolo: false,
    },
    controls: ['Fold / Check / Call / Raise buttons', 'Raise slider with pot presets'],
    howToPlay: [
      'Everyone gets two private hole cards; five community cards are dealt in stages.',
      'Make the best five-card hand from your two cards and the board.',
      'Bet, call, raise or fold each round. Any amount up to your stack — it’s no-limit.',
      'Best hand at showdown (or last player standing) wins the pot.',
    ],
    virtualChips: true,
    prefersLandscape: false,
  },
  blackjack: {
    id: 'blackjack',
    title: 'DASjack 21',
    marquee: 'DASJACK 21',
    tagline: 'Beat the dealer. Not your coworkers.',
    description:
      'Multiplayer blackjack against the house with splits, doubles, insurance and configurable table rules. Everyone plays their hands at the same time.',
    category: 'casino',
    accent: { primary: '#ff5a5f', secondary: '#ffd23f', deep: '#2b0a0f' },
    capacity: {
      minPlayers: 1,
      defaultMaxPlayers: 6,
      maxPlayersLimit: 7,
      maxRoomSize: 30,
      supportsSpectators: true,
      lateJoinAsPlayer: false,
      supportsSolo: true,
    },
    controls: ['Place bets with chips', 'Hit / Stand / Double / Split'],
    howToPlay: [
      'Place a bet, then get two cards. Get closer to 21 than the dealer without going over.',
      'Face cards are 10, aces are 1 or 11.',
      'Hit to take a card, stand to hold, double to double your bet for one card, split pairs.',
      'Blackjack (an ace and a ten-value card) pays extra.',
    ],
    virtualChips: true,
    prefersLandscape: false,
  },
  bingo: {
    id: 'bingo',
    title: 'DAS Bingo',
    marquee: 'DAS BINGO',
    tagline: 'Classic 75-ball or your own custom squares.',
    description:
      'Deeply customizable bingo: classic numbers or custom text squares, a visual pattern editor, automatic or manual calling, and server-verified BINGO claims.',
    category: 'party',
    accent: { primary: '#38bdf8', secondary: '#a78bfa', deep: '#071a2e' },
    capacity: {
      minPlayers: 1,
      defaultMaxPlayers: 30,
      maxPlayersLimit: 60,
      maxRoomSize: 64,
      supportsSpectators: true,
      lateJoinAsPlayer: true,
      supportsSolo: true,
    },
    controls: ['Tap squares to mark', 'Hit BINGO when your pattern is complete'],
    howToPlay: [
      'Everyone gets a unique card. The caller draws numbers (or custom squares).',
      'Mark called squares on your card — or let auto-mark do it.',
      'Complete the pattern shown at the top of the screen, then press BINGO!',
      'The server checks every claim, so no fibbing.',
    ],
    virtualChips: false,
    prefersLandscape: false,
  },
  wheel: {
    id: 'wheel',
    title: 'Wheel of DAStiny',
    marquee: 'WHEEL OF DASTINY',
    tagline: 'Let fate decide. Everyone watches.',
    description:
      'A shared, fully customizable prize wheel. Build segments with weights, colors and emoji, then spin together — every screen lands on the same result.',
    category: 'party',
    accent: { primary: '#ffb020', secondary: '#ff4f81', deep: '#2a1405' },
    capacity: {
      minPlayers: 1,
      defaultMaxPlayers: 30,
      maxPlayersLimit: 60,
      maxRoomSize: 64,
      supportsSpectators: true,
      lateJoinAsPlayer: true,
      supportsSolo: true,
    },
    controls: ['Edit segments in the side panel', 'Press SPIN'],
    howToPlay: [
      'The host builds the wheel: labels, weights, colors and emoji.',
      'Hit SPIN — the server picks the result and every screen animates to the same winner.',
      'Optionally remove winners after each spin or block immediate repeats.',
    ],
    virtualChips: false,
    prefersLandscape: false,
  },
  dasino: {
    id: 'dasino',
    title: 'DASino',
    marquee: 'DASINO',
    tagline: 'Roulette, slots and dice on the arcade floor.',
    description:
      'A casino-floor trio: European roulette with a shared wheel, an original DASCADE slot machine, and a quick high/low dice game. Virtual chips only.',
    category: 'casino',
    accent: { primary: '#c084fc', secondary: '#ffd23f', deep: '#1c0b2e' },
    capacity: {
      minPlayers: 1,
      defaultMaxPlayers: 20,
      maxPlayersLimit: 30,
      maxRoomSize: 40,
      supportsSpectators: true,
      lateJoinAsPlayer: true,
      supportsSolo: true,
    },
    controls: ['Pick a table', 'Place chips, then spin or roll'],
    howToPlay: [
      'Choose Roulette, Slots or Dice from the floor.',
      'Roulette: place chips during the betting window, then watch the shared wheel.',
      'Slots: pick your bet and spin — check the paytable for winning lines.',
      'Dice: guess whether the next roll is higher or lower.',
    ],
    virtualChips: true,
    prefersLandscape: false,
  },
  circuit: {
    id: 'circuit',
    title: 'DASh Circuit',
    marquee: 'DASH CIRCUIT',
    tagline: 'Top-down neon racing for up to 20 drivers.',
    description:
      'Customize your car, hit the grid, and drift your way through neon circuits. Race friends in multiplayer or chase the clock in solo time trials.',
    category: 'racing',
    accent: { primary: '#22d3ee', secondary: '#f97316', deep: '#04161f' },
    capacity: {
      minPlayers: 1,
      defaultMaxPlayers: 12,
      maxPlayersLimit: 20,
      maxRoomSize: 30,
      supportsSpectators: true,
      lateJoinAsPlayer: false,
      supportsSolo: true,
    },
    controls: ['WASD / Arrows to drive', 'Space to drift · Shift to boost', 'Touch controls on mobile'],
    howToPlay: [
      'Accelerate, brake and steer around the circuit through every checkpoint.',
      'Hold drift through corners to charge boost, then fire it on the straights.',
      'Staying off the track slows you down. First across the line after the final lap wins.',
    ],
    virtualChips: false,
    prefersLandscape: true,
  },
  quest: {
    id: 'quest',
    title: 'DASQuest',
    marquee: 'DASQUEST',
    tagline: 'A cooperative adventure beneath the office.',
    description:
      'Pick a hero, vote on choices, roll skill checks and survive THE GLITCH BENEATH DELTA ALPHA — a branching, co-op, choose-your-own-adventure.',
    category: 'adventure',
    accent: { primary: '#a3e635', secondary: '#22d3ee', deep: '#0d1a05' },
    capacity: {
      minPlayers: 1,
      defaultMaxPlayers: 6,
      maxPlayersLimit: 12,
      maxRoomSize: 30,
      supportsSpectators: true,
      lateJoinAsPlayer: false,
      supportsSolo: true,
    },
    controls: ['Choose a hero', 'Vote on choices', 'Roll when a check is called'],
    howToPlay: [
      'Each player picks a hero archetype with its own strengths.',
      'The party reads each scene together and votes on what to do.',
      'Risky choices call for skill checks — the server rolls the dice.',
      'Manage health and items. Different choices lead to very different endings.',
    ],
    virtualChips: false,
    prefersLandscape: false,
  },
};

export const GAME_LIST: GameCatalogEntry[] = GAME_IDS.map((id) => GAME_CATALOG[id]);
