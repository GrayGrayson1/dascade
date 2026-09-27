/**
 * The DASCADE game catalog. Pure metadata shared by the arcade, lobby and game server.
 * Adding a game = add an entry here + a server room + a client module, then list it in a
 * cabinet (cabinets.ts). Every Colyseus room type is named after its GameId.
 */
import type { CabinetId } from './cabinets.ts';
import type { TournamentCapability } from './tournament.ts';

export const GAME_IDS = [
  'dasketch',
  'holdem',
  'blackjack',
  'bingo',
  'wheel',
  'dasino',
  'circuit',
  'quest',
  // DAS Boardroom
  'chess',
  'checkers',
  'ships',
  // DAStravaganza
  'trivia',
  'deception',
  'masterpiece',
  'words',
  'survey',
  // Standalone cabinets
  'putt',
  'tanks',
  // DAScade Classics
  'paddle',
  'snake',
  'bricks',
  'asteroids',
  'memory',
  'blocks',
  // Platform kiosk (not a cabinet game)
  'tournament',
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
  category: 'party' | 'casino' | 'racing' | 'adventure' | 'strategy' | 'sports' | 'action' | 'puzzle' | 'meta';
  /** Cabinet the game lives in (null for platform rooms such as the Tournament Center kiosk). */
  cabinet: CabinetId | null;
  /** Present when the Tournament Center can run this game (formats, series lengths, field size). */
  tournament?: TournamentCapability;
  /** Head-to-head games that keep an internal DASCADE rating (not an official rating of any federation). */
  rated?: boolean;
  /** Seconds a dropped player keeps their live session (long, thoughtful games get more). Default RECONNECT_GRACE_SECONDS. */
  reconnectGraceSeconds?: number;
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
    cabinet: 'dasketch',
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
    cabinet: 'dasino',
    reconnectGraceSeconds: 90,
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
    cabinet: 'dasino',
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
    cabinet: 'bingo',
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
    cabinet: 'wheel',
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
    cabinet: 'dasino',
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
    cabinet: 'circuit',
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
    cabinet: 'quest',
    reconnectGraceSeconds: 120,
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
  chess: {
    id: 'chess',
    title: 'DAS Chess',
    marquee: 'DAS CHESS',
    tagline: 'Real-time chess with clocks, premoves and a DASCADE rating.',
    description:
      'Standard chess with every rule enforced by the server: castling, en passant, promotion, draws by repetition, the fifty-move rule and insufficient material. Server-owned clocks from bullet to classical, spectators and PGN export.',
    category: 'strategy',
    cabinet: 'boardroom',
    accent: { primary: '#e8c07d', secondary: '#38bdf8', deep: '#141008' },
    capacity: {
      minPlayers: 2,
      defaultMaxPlayers: 2,
      maxPlayersLimit: 2,
      maxRoomSize: 40,
      supportsSpectators: true,
      lateJoinAsPlayer: false,
      supportsSolo: false,
    },
    controls: ['Click or drag a piece to move', 'Resign, offer a draw or flip the board from the side panel'],
    howToPlay: [
      'White moves first. Checkmate the enemy king to win.',
      'Legal moves are highlighted when you pick up a piece — illegal moves are impossible.',
      'Each side has a clock; run out of time and you lose (unless your opponent cannot checkmate).',
      'Offer a draw, resign, or export the game as PGN when it ends.',
    ],
    virtualChips: false,
    prefersLandscape: false,
    tournament: { formats: ['single_elimination', 'double_elimination', 'round_robin', 'swiss'], bestOf: [1, 2, 3, 5], maxField: 64, draws: true, sides: true },
    rated: true,
    reconnectGraceSeconds: 120,
  },
  checkers: {
    id: 'checkers',
    title: 'DAS Checkers',
    marquee: 'DAS CHECKERS',
    tagline: 'American checkers with forced captures and multi-jumps.',
    description:
      'Standard 8×8 American checkers: diagonal moves, mandatory captures, multi-jump chains and kings. Server-validated moves, clocks, spectators and rematches.',
    category: 'strategy',
    cabinet: 'boardroom',
    accent: { primary: '#ff5a5f', secondary: '#ffd23f', deep: '#1a0808' },
    capacity: {
      minPlayers: 2,
      defaultMaxPlayers: 2,
      maxPlayersLimit: 2,
      maxRoomSize: 40,
      supportsSpectators: true,
      lateJoinAsPlayer: false,
      supportsSolo: false,
    },
    controls: ['Click or drag a piece, then its destination', 'Captures are highlighted when they are required'],
    howToPlay: [
      'Pieces move diagonally forward one square. Dark moves first.',
      'Captures are mandatory: jump an adjacent enemy piece into the empty square behind it.',
      'Keep jumping while you can — a multi-jump is one turn.',
      'Reach the far row to crown a king, which moves and captures backwards too.',
      'Win by capturing every enemy piece or leaving your opponent with no legal move.',
      'Automatic draw: the same position three times, or 40 moves each without a capture or a man moving.',
    ],
    virtualChips: false,
    prefersLandscape: false,
    tournament: { formats: ['single_elimination', 'double_elimination', 'round_robin', 'swiss'], bestOf: [1, 2, 3, 5], maxField: 64, draws: true, sides: true },
    rated: true,
    reconnectGraceSeconds: 120,
  },
  ships: {
    id: 'ships',
    title: 'DAS Ships',
    marquee: 'DAS SHIPS',
    tagline: 'Hide your fleet. Hunt theirs.',
    description:
      'An original hidden-fleet duel. Secretly place your vessels, then trade shots across the grid. The server keeps every fleet hidden and calls every hit, miss and sinking.',
    category: 'strategy',
    cabinet: 'boardroom',
    accent: { primary: '#38bdf8', secondary: '#ff8a3d', deep: '#03121f' },
    capacity: {
      minPlayers: 2,
      defaultMaxPlayers: 2,
      maxPlayersLimit: 2,
      maxRoomSize: 30,
      supportsSpectators: true,
      lateJoinAsPlayer: false,
      supportsSolo: false,
    },
    controls: [
      'Drag a vessel onto your grid, or tap it and then a square · R or Rotate turns it',
      'Click a square to fire · on touch screens tap to aim, tap again to fire',
      'Arrow keys move around a grid · Enter fires · F fires a salvo',
    ],
    howToPlay: [
      'Deploy your fleet on your grid — nobody else can see it.',
      'Take turns firing at a square on the enemy grid.',
      'A hit is just “hit” — a vessel is only named once it sinks.',
      'Salvo mode: fire one shot for every vessel you still have afloat.',
      'Sink the entire enemy fleet to win. Both fleets are revealed at the end.',
    ],
    virtualChips: false,
    prefersLandscape: false,
    // Sides: 'first' fires the first shot of the battle (alternates every game of a series).
    tournament: { formats: ['single_elimination', 'double_elimination', 'round_robin', 'swiss'], bestOf: [1, 3, 5], maxField: 64, draws: false, sides: true },
    reconnectGraceSeconds: 90,
  },
  trivia: {
    id: 'trivia',
    title: 'DAStravaganza Trivia',
    marquee: 'TRIVIA',
    tagline: 'A game-show trivia night for the whole team.',
    description:
      'Multiple choice, true/false, typed answers and closest-number questions across original categories. Free-for-all or teams, speed and streak bonuses, custom packs and a final wager round.',
    category: 'party',
    cabinet: 'stravaganza',
    accent: { primary: '#ffd23f', secondary: '#ff4f81', deep: '#1f1403' },
    capacity: {
      minPlayers: 1,
      defaultMaxPlayers: 30,
      maxPlayersLimit: 30,
      maxRoomSize: 50,
      supportsSpectators: true,
      lateJoinAsPlayer: true,
      supportsSolo: true,
    },
    controls: ['Tap an answer or type it in', 'Lock in before the timer runs out'],
    howToPlay: [
      'Each question has a timer. Answer privately and lock it in.',
      'Correct answers score points — faster answers score more when speed bonus is on.',
      'Numeric questions reward the closest guess.',
      'The highest score (or team) after the final question wins.',
    ],
    virtualChips: false,
    prefersLandscape: false,
  },
  deception: {
    id: 'deception',
    title: 'DASception',
    marquee: 'DASCEPTION',
    tagline: 'Someone on the network is a Glitch.',
    description:
      'An original social-deduction thriller. Most players are loyal Sysops; a hidden few are Glitches who know each other. Use your role, talk it out and vote — before the Glitches take over the network.',
    category: 'party',
    cabinet: 'stravaganza',
    accent: { primary: '#a78bfa', secondary: '#ff5a5f', deep: '#120a24' },
    capacity: {
      minPlayers: 4,
      defaultMaxPlayers: 12,
      maxPlayersLimit: 20,
      maxRoomSize: 40,
      supportsSpectators: true,
      lateJoinAsPlayer: false,
      supportsSolo: false,
    },
    controls: ['Tap a player, then lock in your night ability', 'Tap a player and confirm to vote — or skip'],
    howToPlay: [
      'Everyone secretly gets a role. Glitches know each other; Sysops do not.',
      'At night the Glitches pick a player to corrupt while special roles act in secret. At dawn the system log shows what happened.',
      'Discuss by day, then vote in secret to disconnect a suspect. Votes are revealed together.',
      'Sysops win by disconnecting every Glitch. Glitches win once they equal the Sysops.',
    ],
    virtualChips: false,
    prefersLandscape: false,
    reconnectGraceSeconds: 90,
  },
  masterpiece: {
    id: 'masterpiece',
    title: 'DASterpiece',
    marquee: 'DASTERPIECE',
    tagline: 'Write the funniest answer. Win the room.',
    description:
      'A comedy writing contest: answer ridiculous prompts, then everyone votes on the anonymous entries. Captions, terrible advice, fake definitions, product pitches and head-to-head showdowns.',
    category: 'party',
    cabinet: 'stravaganza',
    accent: { primary: '#fb7185', secondary: '#fde047', deep: '#2a0a10' },
    capacity: {
      minPlayers: 3,
      defaultMaxPlayers: 16,
      maxPlayersLimit: 30,
      maxRoomSize: 50,
      supportsSpectators: true,
      lateJoinAsPlayer: false,
      supportsSolo: false,
    },
    controls: ['Type your answer and hand it in', 'Tap an exhibit, then cast your vote'],
    howToPlay: [
      'Each exhibition has a theme. Everyone gets a private prompt and writes an answer.',
      'Answers go up anonymously in a random order — vote for your favourite (never your own).',
      'Head-to-head rounds pit two answers against each other; the authors sit out the vote.',
      'Votes, wins and sweeps earn points. Authors are revealed only after the votes are counted.',
      'Most points after the final exhibition wins.',
    ],
    virtualChips: false,
    prefersLandscape: false,
  },
  words: {
    id: 'words',
    title: 'DASwords',
    marquee: 'DASWORDS',
    tagline: 'Four fast word games. One dictionary. No mercy.',
    description:
      'Letter Grid, Anagram Sprint, Word Chain and Forbidden Letter. The server checks every word against a built-in dictionary — no external lookups, no arguing.',
    category: 'party',
    cabinet: 'stravaganza',
    accent: { primary: '#2de38f', secondary: '#ffd23f', deep: '#04200f' },
    capacity: {
      minPlayers: 1,
      defaultMaxPlayers: 20,
      maxPlayersLimit: 30,
      maxRoomSize: 50,
      supportsSpectators: true,
      lateJoinAsPlayer: true,
      supportsSolo: true,
    },
    controls: ['Type words and press Enter', 'Drag across the grid in Letter Grid'],
    howToPlay: [
      'Pick a mode: Letter Grid, Anagram Sprint, Word Chain or Forbidden Letter.',
      'Submit as many valid words as you can before the timer ends.',
      'Longer and rarer words score more. Duplicates and invalid words score nothing.',
    ],
    virtualChips: false,
    prefersLandscape: false,
  },
  survey: {
    id: 'survey',
    title: 'DAS Survey',
    marquee: 'DAS SURVEY',
    tagline: 'How well do you know this room?',
    description:
      'Answer anonymous questions, then predict how your own group answered. Majority Mind, Rank the Room, Guess the Percentage and custom surveys written by the host.',
    category: 'party',
    cabinet: 'stravaganza',
    accent: { primary: '#60a5fa', secondary: '#f472b6', deep: '#081530' },
    capacity: {
      minPlayers: 3,
      defaultMaxPlayers: 30,
      maxPlayersLimit: 30,
      maxRoomSize: 50,
      supportsSpectators: true,
      lateJoinAsPlayer: true,
      supportsSolo: false,
    },
    controls: ['Tap your answer', 'Then predict what the group said'],
    howToPlay: [
      'Everyone answers the question anonymously.',
      'Then predict the group: the majority pick, the ranking or the percentage.',
      'Closer predictions score more. Individual answers stay anonymous.',
    ],
    virtualChips: false,
    prefersLandscape: false,
  },
  putt: {
    id: 'putt',
    title: 'DAS Putt',
    marquee: 'DAS PUTT',
    tagline: 'Nine neon holes of arcade mini golf.',
    description:
      'Multiplayer mini golf on an original nine-hole course with slopes, sand, water, bumpers, moving obstacles and teleport tunnels. The server simulates every stroke.',
    category: 'sports',
    cabinet: 'putt',
    accent: { primary: '#a3e635', secondary: '#fde047', deep: '#0a1f06' },
    capacity: {
      minPlayers: 1,
      defaultMaxPlayers: 8,
      maxPlayersLimit: 12,
      maxRoomSize: 30,
      supportsSpectators: true,
      lateJoinAsPlayer: false,
      supportsSolo: true,
    },
    controls: ['Drag back anywhere on the course like a slingshot, release to putt', '← → aim · ↑ ↓ power · Space to putt'],
    howToPlay: [
      'Pull back anywhere on the course: the ball goes the opposite way, and a longer pull hits harder. Release to putt.',
      'Sink the ball in as few strokes as possible. Water and out of bounds add a penalty stroke and return the ball.',
      'Every putt has a shot clock and every hole a stroke limit, so nobody gets stuck.',
      'Classic mode takes turns; Party mode lets everyone putt at once. Lowest total wins.',
    ],
    virtualChips: false,
    prefersLandscape: false,
    tournament: { formats: ['single_elimination', 'double_elimination', 'round_robin', 'swiss'], bestOf: [1, 3], maxField: 32, draws: true, sides: false },
    reconnectGraceSeconds: 90,
  },
  tanks: {
    id: 'tanks',
    title: 'DAS Tanks',
    marquee: 'DAS TANKS',
    tagline: 'Turn-based artillery with destructible terrain.',
    description:
      'Angle, power, wind — fire. Side-view artillery for two to eight tanks, free-for-all or teams, with destructible terrain, a focused six-weapon arsenal and CPU gunners to fill the field. The server simulates every shell.',
    category: 'action',
    cabinet: 'tanks',
    accent: { primary: '#ff8a3d', secondary: '#fde047', deep: '#1f0e04' },
    capacity: {
      minPlayers: 1,
      defaultMaxPlayers: 4,
      maxPlayersLimit: 8,
      maxRoomSize: 30,
      supportsSpectators: true,
      lateJoinAsPlayer: false,
      supportsSolo: true,
    },
    controls: ['←/→ aim · ↑/↓ power · A/D drive', 'Tab weapon · Space fire', 'Touch: drag to aim, tap FIRE'],
    howToPlay: [
      'On your turn, aim your turret, set the power and pick a weapon — then fire.',
      'Mind the wind (shown at the top): it pushes every shell, and it changes each turn.',
      'Shells blast craters: tanks fall into holes and take fall damage. Drive a little each turn to find cover.',
      'Specials are limited: Heavy, Cluster, Airburst, Driller and Dirt Mound. Last tank (or team) standing wins.',
    ],
    virtualChips: false,
    prefersLandscape: true,
    reconnectGraceSeconds: 90,
  },
  paddle: {
    id: 'paddle',
    title: 'Pixel Paddle',
    marquee: 'PIXEL PADDLE',
    tagline: 'A one-on-one paddle duel.',
    description: 'An original paddle-and-ball duel. Practice against the house paddle or challenge a coworker over the network.',
    category: 'action',
    cabinet: 'classics',
    accent: { primary: '#22d3ee', secondary: '#ff4fd8', deep: '#041820' },
    capacity: {
      minPlayers: 1,
      defaultMaxPlayers: 2,
      maxPlayersLimit: 2,
      maxRoomSize: 30,
      supportsSpectators: true,
      lateJoinAsPlayer: false,
      supportsSolo: true,
    },
    controls: ['Mouse, touch drag or W/S · Arrow keys'],
    howToPlay: ['Keep the ball out of your goal.', 'Where the ball hits your paddle sets its angle.', 'First to the target score wins.'],
    virtualChips: false,
    prefersLandscape: true,
    // Sides: 'first' plays the left paddle and serves first (sides alternate every game of a series).
    tournament: { formats: ['single_elimination', 'double_elimination', 'round_robin', 'swiss'], bestOf: [1, 3, 5], maxField: 64, draws: false, sides: true },
  },
  snake: {
    id: 'snake',
    title: 'Neon Snake',
    marquee: 'NEON SNAKE',
    tagline: 'Eat, grow, and don’t hit anybody.',
    description: 'A modern multiplayer snake arena. Collect energy to grow, trap your rivals and survive. Solo score attack or arena battles.',
    category: 'action',
    cabinet: 'classics',
    accent: { primary: '#2de38f', secondary: '#a78bfa', deep: '#031a0e' },
    capacity: {
      minPlayers: 1,
      defaultMaxPlayers: 8,
      maxPlayersLimit: 12,
      maxRoomSize: 30,
      supportsSpectators: true,
      lateJoinAsPlayer: false,
      supportsSolo: true,
    },
    controls: ['Arrow keys / WASD or swipe to turn'],
    howToPlay: ['Steer your snake to collect energy and grow.', 'Hitting a wall, yourself or another snake ends your run.', 'Last snake alive (or highest score) wins.'],
    virtualChips: false,
    prefersLandscape: false,
    tournament: { formats: ['single_elimination', 'double_elimination', 'round_robin', 'swiss'], bestOf: [1, 3, 5], maxField: 64, draws: true, sides: false },
  },
  bricks: {
    id: 'bricks',
    title: 'Brick Blitz',
    marquee: 'BRICK BLITZ',
    tagline: 'Break every brick. Catch every power-up.',
    description: 'An original brick breaker with armored, exploding and moving bricks plus power-ups. Chase a high score solo or race coworkers on the same levels.',
    category: 'action',
    cabinet: 'classics',
    accent: { primary: '#ff8a3d', secondary: '#22d3ee', deep: '#1f0d03' },
    capacity: {
      minPlayers: 1,
      defaultMaxPlayers: 4,
      maxPlayersLimit: 8,
      maxRoomSize: 30,
      supportsSpectators: true,
      lateJoinAsPlayer: false,
      supportsSolo: true,
    },
    controls: ['Mouse, touch drag or ←/→ to move', 'Space or tap to launch'],
    howToPlay: ['Bounce the ball off your paddle to break bricks.', 'Catch falling power-ups; don’t let the ball fall.', 'Clear the level to advance.'],
    virtualChips: false,
    prefersLandscape: false,
  },
  asteroids: {
    id: 'asteroids',
    title: 'Asteroid Run',
    marquee: 'ASTEROID RUN',
    tagline: 'Survive the belt. Alone or together.',
    description: 'An original top-down space survival game with procedural waves. Fly solo or with up to three co-pilots.',
    category: 'action',
    cabinet: 'classics',
    accent: { primary: '#c4b5fd', secondary: '#22d3ee', deep: '#0b0820' },
    capacity: {
      minPlayers: 1,
      defaultMaxPlayers: 4,
      maxPlayersLimit: 4,
      maxRoomSize: 30,
      supportsSpectators: true,
      lateJoinAsPlayer: false,
      supportsSolo: true,
    },
    controls: ['WASD / arrows to fly, Space to fire', 'On-screen stick and fire button on touch'],
    howToPlay: ['Blast rocks before they hit you — big ones split.', 'Waves get harder. Shields recharge slowly.', 'Survive as long as you can and rack up points.'],
    virtualChips: false,
    prefersLandscape: true,
  },
  memory: {
    id: 'memory',
    title: 'Memory Matrix',
    marquee: 'MEMORY MATRIX',
    tagline: 'Watch the pattern. Repeat it. Faster.',
    description: 'A fast visual memory and reaction challenge. Play solo for a high score or race everyone through the same synchronized rounds.',
    category: 'puzzle',
    cabinet: 'classics',
    accent: { primary: '#f472b6', secondary: '#7cf5ff', deep: '#200818' },
    capacity: {
      minPlayers: 1,
      defaultMaxPlayers: 12,
      maxPlayersLimit: 30,
      maxRoomSize: 40,
      supportsSpectators: true,
      lateJoinAsPlayer: false,
      supportsSolo: true,
    },
    controls: ['Tap or click the tiles', 'Number keys 1–9 on a 3×3 grid'],
    howToPlay: [
      'Watch the tiles light up — one after another (Sequence) or all at once (Flash).',
      'Repeat it: sequences in order, flashes in any order. Faster answers score more.',
      'Each round gets longer and faster and the grid grows. A miss costs a life — or ends your run in Sudden Death.',
    ],
    virtualChips: false,
    prefersLandscape: false,
    tournament: { formats: ['single_elimination', 'double_elimination', 'round_robin', 'swiss'], bestOf: [1, 3, 5], maxField: 64, draws: true, sides: false },
  },
  blocks: {
    id: 'blocks',
    title: 'Block Drop',
    marquee: 'BLOCK DROP',
    tagline: 'Stack, clear, survive.',
    description: 'An original falling-block puzzle. Clear lines, chain combos and climb the high-score board — solo or in a synchronized score race.',
    category: 'puzzle',
    cabinet: 'classics',
    accent: { primary: '#facc15', secondary: '#60a5fa', deep: '#1c1603' },
    capacity: {
      minPlayers: 1,
      defaultMaxPlayers: 8,
      maxPlayersLimit: 16,
      maxRoomSize: 30,
      supportsSpectators: true,
      lateJoinAsPlayer: false,
      supportsSolo: true,
    },
    controls: ['←/→ move · ↑ rotate · ↓ soft drop · Space hard drop', 'Swipe and tap on touch'],
    howToPlay: ['Move and rotate falling blocks.', 'Fill a row completely to clear it.', 'The game ends when the stack reaches the top.'],
    virtualChips: false,
    prefersLandscape: false,
  },
  tournament: {
    id: 'tournament',
    title: 'Tournament Center',
    marquee: 'TOURNAMENTS',
    tagline: 'Brackets, Swiss and round robins for any head-to-head game.',
    description:
      'Run a tournament for chess, checkers, ships, putt and head-to-head classics: registration, check-in, seeding, automatic pairings and a live bracket everyone can follow.',
    category: 'meta',
    cabinet: null,
    accent: { primary: '#ffd23f', secondary: '#22d3ee', deep: '#1a1405' },
    capacity: {
      minPlayers: 1,
      defaultMaxPlayers: 100,
      maxPlayersLimit: 100,
      maxRoomSize: 120,
      supportsSpectators: true,
      lateJoinAsPlayer: true,
      supportsSolo: false,
    },
    controls: ['Register, check in, then launch your match from the bracket'],
    howToPlay: [
      'The organizer creates a tournament and shares its code.',
      'Register, then check in when the organizer opens check-in.',
      'When your match is ready, launch it straight from the bracket. Results advance automatically.',
    ],
    virtualChips: false,
    prefersLandscape: false,
    reconnectGraceSeconds: 300,
  },
};

export const GAME_LIST: GameCatalogEntry[] = GAME_IDS.map((id) => GAME_CATALOG[id]);

/** Games that appear in cabinets (excludes platform rooms such as the Tournament Center kiosk). */
export const PLAYABLE_GAME_LIST: GameCatalogEntry[] = GAME_LIST.filter((game) => game.cabinet !== null);

/** Games the Tournament Center can run. */
export const TOURNAMENT_GAME_LIST: GameCatalogEntry[] = GAME_LIST.filter((game) => game.tournament !== undefined);
