/**
 * DASCADE player stats & ratings — shared vocabulary for the stats service
 * (apps/game-server/src/platform/stats.ts) and the profile Stats tab.
 *
 * Stats are collected from reported game outcomes (BaseGameRoom.reportOutcome). Games can add
 * per-player extras through `outcome.details.playerStats` (see PlayerStatsDetails) — every value
 * is a finite number and the key's prefix decides how it aggregates across games:
 *   - `max…` / `best…`   → keep the highest value  (e.g. `maxCombo`, `bestStreak`)
 *   - `min…` / `fewest…` → keep the lowest value   (e.g. `minHoleStrokes`, `fewestMoves`)
 *   - anything else      → summed                  (e.g. `correctAnswers`, `eliminations`)
 *
 * The DASCADE rating is an internal Elo-style rating. It is NOT a FIDE (or any federation) rating.
 */
import { z } from 'zod';
import type { GameId } from './catalog.ts';
import { formatRaceTime } from './format.ts';
import { GUEST_ID_PATTERN } from './protocol.ts';

/** Per-player numeric extras a game may attach to an outcome: `details.playerStats[playerId][key] = n`. */
export type PlayerStatsDetails = Record<string, Record<string, number>>;

/** Bounds applied to game-supplied extras (defence in depth: rooms are trusted, but keep rows tiny). */
export const STAT_LIMITS = {
  /** Max distinct extra keys kept per game line. */
  extrasPerGame: 24,
  /** Max key length. */
  keyLength: 40,
  /** Absolute value cap for any single stat value. */
  maxValue: 1_000_000_000,
} as const;

export const STAT_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*$/;

export type StatAggregation = 'sum' | 'max' | 'min';

export function statAggregation(key: string): StatAggregation {
  if (/^(max|best)[A-Z0-9]/.test(key)) return 'max';
  if (/^(min|fewest)[A-Z0-9]/.test(key)) return 'min';
  return 'sum';
}

/** Merge one game's extras into running totals (pure; returns a new object). */
export function mergeStatExtras(total: Readonly<Record<string, number>>, add: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = { ...total };
  for (const [key, raw] of Object.entries(add)) {
    if (!STAT_KEY_PATTERN.test(key) || key.length > STAT_LIMITS.keyLength) continue;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const value = Math.max(-STAT_LIMITS.maxValue, Math.min(STAT_LIMITS.maxValue, raw));
    const prev = out[key];
    if (prev === undefined) {
      if (Object.keys(out).length >= STAT_LIMITS.extrasPerGame) continue;
      out[key] = value;
      continue;
    }
    const mode = statAggregation(key);
    out[key] =
      mode === 'max'
        ? Math.max(prev, value)
        : mode === 'min'
          ? Math.min(prev, value)
          : Math.max(-STAT_LIMITS.maxValue, Math.min(STAT_LIMITS.maxValue, prev + value));
  }
  return out;
}

/** Human labels for well-known extras (others are humanised from camelCase). */
export const STAT_EXTRA_LABELS: Record<string, string> = {
  correctAnswers: 'Correct answers',
  eliminations: 'Eliminations',
  kills: 'Eliminations',
  holesInOne: 'Holes in one',
  minHoleStrokes: 'Best hole (strokes)',
  minCourseStrokes: 'Best round (strokes)',
  minCourseToPar: 'Best round (to par)',
  bestHoleToPar: 'Best hole (to par)',
  maxCombo: 'Best combo',
  maxLevel: 'Highest level',
  maxLines: 'Most lines',
  bestStreak: 'Best streak',
  shipsSunk: 'Ships sunk',
  wordsFound: 'Words found',
  roundsWon: 'Rounds won',
  checkmates: 'Checkmates',
  captures: 'Captures',
  kings: 'Kings crowned',
  birdies: 'Birdies',
  damage: 'Damage dealt',
  shots: 'Shots fired',
  hits: 'Hits',
  shotsFired: 'Shots fired',
  shotsHit: 'Hits',
  maxHitStreak: 'Best hit streak',
  // DASketch
  correctGuesses: 'Words guessed',
  drawingsGuessed: 'Drawings guessed',
  minGuessMs: 'Fastest guess',
  // Hold'em, DASjack 21, DASino
  handsWon: 'Hands won',
  handsPlayed: 'Hands played',
  bestPot: 'Biggest pot',
  blackjacks: 'Blackjacks',
  bestWin: 'Biggest win',
  chipsWagered: 'Chips wagered',
  // Bingo
  bingos: 'Bingos',
  // DASh Circuit
  minLapMs: 'Best lap',
  fastestLaps: 'Fastest laps',
  // DASphalt GP (also minLapMs, fastestLaps)
  itemHits: 'Item hits',
  maxCupPoints: 'Best cup score',
  // DASQuest
  questsCompleted: 'Quests completed',
  checksPassed: 'Checks passed',
  crits: 'Critical rolls',
};

/** Extras whose key ends in `Ms` are durations in milliseconds (e.g. `minLapMs`). */
export function isDurationStat(key: string): boolean {
  return /[a-z]Ms$/.test(key);
}

/** A duration stat for display: "12.34 s" under a minute, otherwise "m:ss.mmm". */
export function formatStatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '–';
  return ms < 60_000 ? `${(ms / 1000).toFixed(2)} s` : formatRaceTime(ms);
}

/** How a game's stat card reads on the Stats tab (defaults: "Best score", a plain number, W/D/L shown). */
export interface StatGameDisplay {
  /** Label for the best single-game score. */
  scoreLabel?: string;
  /** 'ms': scores are times in milliseconds. */
  scoreFormat?: 'ms';
  /** Co-operative game: the party shares every result, so wins/draws/losses aren't shown. */
  coop?: boolean;
}

export const STAT_GAME_DISPLAY: Partial<Record<GameId, StatGameDisplay>> = {
  holdem: { scoreLabel: 'Best final stack' },
  blackjack: { scoreLabel: 'Best final balance' },
  dasino: { scoreLabel: 'Best final balance' },
  circuit: { scoreLabel: 'Best race time', scoreFormat: 'ms' },
  kart: { scoreLabel: 'Best race time', scoreFormat: 'ms' },
  quest: { scoreLabel: 'Best party score', coop: true },
};

export function statExtraLabel(key: string): string {
  const known = STAT_EXTRA_LABELS[key];
  if (known) return known;
  const words = key
    .replace(/^(max|best|min|fewest)(?=[A-Z0-9])/, (m) => (m === 'max' || m === 'best' ? 'Best ' : 'Fewest '))
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** Aggregated stats for one player in one game. */
export interface GameStatLine {
  gameId: GameId;
  /** Finished games reported for this player. */
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Top-three finishes in games with three or more players. */
  podiums: number;
  /** Best single-game score (highest, or lowest when `lowerIsBetter`), null when the game has no scores. */
  bestScore: number | null;
  lowerIsBetter: boolean;
  /** Sum of reported scores (for averages). */
  totalScore: number;
  /** Games that had a score (denominator for averages). */
  scoredGames: number;
  /** Games played as part of a Tournament Center match. */
  tournamentGames: number;
  /** Server epoch ms of the most recent game. */
  lastPlayedAt: number;
  /** Game-specific extras (see the aggregation rules at the top of this file). */
  extras: Record<string, number>;
}

/** One DASCADE rating (internal Elo — not FIDE). */
export interface RatingLine {
  gameId: GameId;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Fewer than the provisional threshold of rated games: the rating is still settling. */
  provisional: boolean;
}

/** GET /api/stats/me response. */
export interface PlayerStatsResponse {
  /** Whose stats these are: a verified account, the browser's guest id, or nobody (no id sent). */
  identity: 'account' | 'guest' | 'none';
  games: GameStatLine[];
  ratings: RatingLine[];
  /** True when stats are also saved to the database (Supabase configured on the server). */
  persisted: boolean;
}

/** Query accepted by GET /api/stats/me (the access token travels in the Authorization header). */
export const StatsQuerySchema = z.object({
  guestId: z.string().min(4).max(64).regex(GUEST_ID_PATTERN).optional(),
});

export const STATS_ROUTE = '/api/stats/me';
