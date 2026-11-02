/**
 * Profile → Stats numbers that are derived on the client: the per-game average score and the
 * overall summary across every game. Pure (unit tested in statsSummary.test.ts).
 */
import type { GameId } from '@dascade/shared';
import type { GameStatLine, StatGameDisplay } from '@dascade/shared/stats';

/** Averages need at least this many scored games (one game's average is just its score). */
export const AVERAGE_MIN_GAMES = 2;

/** Average score over the games that had one, or null when there aren't enough. */
export function averageScore(line: Pick<GameStatLine, 'totalScore' | 'scoredGames'>): number | null {
  if (line.scoredGames < AVERAGE_MIN_GAMES || !Number.isFinite(line.totalScore)) return null;
  return line.totalScore / line.scoredGames;
}

/** "Best race time" → "Average race time"; the plain cards read "Average score". */
export function averageLabel(display: StatGameDisplay, lowerIsBetter: boolean): string {
  const best = display.scoreLabel;
  if (best && /^Best /.test(best)) return best.replace(/^Best /, 'Average ');
  return lowerIsBetter ? 'Average (lower is better)' : 'Average score';
}

/** Averages read as whole numbers from 100 up, otherwise to one decimal. */
export function formatAverage(n: number): string {
  const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export interface StatsSummary {
  /** Finished games across every game. */
  games: number;
  /** How many different games have a record. */
  kinds: number;
  /** The most played game (ties: the most recently played), or null with no games. */
  mostPlayed: { gameId: GameId; games: number } | null;
  /** Wins across games with a win/loss record (co-op games excluded). */
  wins: number;
}

export function summarize(lines: readonly GameStatLine[], coop: (gameId: GameId) => boolean = () => false): StatsSummary {
  let games = 0;
  let wins = 0;
  let mostPlayed: StatsSummary['mostPlayed'] = null;
  let mostAt = 0;
  for (const line of lines) {
    games += line.games;
    if (!coop(line.gameId)) wins += line.wins;
    if (
      line.games > 0 &&
      (!mostPlayed || line.games > mostPlayed.games || (line.games === mostPlayed.games && line.lastPlayedAt > mostAt))
    ) {
      mostPlayed = { gameId: line.gameId, games: line.games };
      mostAt = line.lastPlayedAt;
    }
  }
  return { games, kinds: lines.filter((l) => l.games > 0).length, mostPlayed, wins };
}
