/**
 * Structured result of ONE finished game, reported by a game room with
 * `this.reportOutcome(...)`. The platform uses it for tournament advancement,
 * DASCADE ratings and stats. Rooms never accept outcomes from clients.
 */
export interface GameOutcome {
  /**
   * Room player ids grouped by finishing place, best first: [[winner], [runnerUp], ...].
   * A drawn head-to-head game is a single group: [[a, b]].
   * Players who left mid-game may be omitted; forfeits list the forfeiting player last.
   */
  placements: string[][];
  /** Final score per player id, when the game has scores (strokes, points, chips...). */
  scores?: Record<string, number>;
  /** Lower score is better (golf strokes). Defaults to false. */
  lowerIsBetter?: boolean;
  /** Short machine reason: 'checkmate', 'resign', 'timeout', 'stalemate', 'fleet_destroyed', 'forfeit'... */
  reason?: string;
  /** Small, JSON-safe game-specific extras (e.g. PGN length, course par). */
  details?: Record<string, unknown>;
}
