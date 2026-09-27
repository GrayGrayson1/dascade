/**
 * DAS Checkers — standard American/English checkers on the DAS Boardroom kit.
 *
 * The kit owns sides (tournament sides, casual side mode, colour swap on rematch), the server
 * clock, resign / draw offers / take-backs / rematches, abandonment and forfeits, and the ending
 * (result state, reportOutcome → ratings/stats/tournaments, endMatch). This room owns the rules:
 *
 *  - `checkers:move { path, ply }` — the only game message. The kit's `guardTurn` checks phase,
 *    seat, flag, turn and that `ply` matches (stale/duplicate submissions are refused); the pure
 *    engine (`@dascade/game-core/checkers`) resolves the path against the legal moves (mandatory
 *    captures, complete multi-jumps, crowning ends the move) and applies it.
 *  - Endings from the board: no pieces / no legal move (loss for the side to move), threefold
 *    repetition and the 40-move rule (automatic draws). See game-core/checkers/game.ts.
 *  - Take-backs restore the engine record from a short per-ply stack (replaying the game when a
 *    take-back goes deeper than the stack, e.g. several in a row).
 *
 * Side 'first' = Dark (moves first), 'second' = Light.
 */
import { RATE } from '@dascade/shared';
import { BOARD_REASONS, type BoardSide } from '@dascade/shared/games/boardroom';
import {
  CHECKERS_MSG,
  CheckersMoveSchema,
  CheckersSettingsSchema,
  DEFAULT_CHECKERS_SETTINGS,
  checkersColorOf,
  checkersSideOf,
  type CheckersMoveEvent,
  type CheckersMovePayload,
  type CheckersSettings,
} from '@dascade/shared/games/checkers';
import { hasCapture, newGame, playMove, repetitionCount, type CheckersGame, type CheckersResult } from '@dascade/game-core/checkers';
import type { PlayerRecord } from '../BaseGameRoom.ts';
import { BoardGameRoom, type BoardResult } from '../boardroom/index.ts';
import { CheckersHistoryItem, CheckersState } from './CheckersState.ts';

const SIDE_NAME: Record<BoardSide, string> = { first: 'Dark', second: 'Light' };
/**
 * Engine records kept for take-backs. The kit undoes at most 2 plies, and each record carries the
 * whole ply list, so an unbounded stack would grow quadratically over a (deliberately) long game.
 */
const MAX_RECORDS = 4;
/** Longest move record included in the outcome details (a normal game is far shorter). */
const MAX_DETAIL_PLIES = 400;

export class CheckersRoom extends BoardGameRoom<CheckersState, CheckersSettings> {
  readonly gameId = 'checkers' as const;
  protected readonly settingsSchema = CheckersSettingsSchema;

  /** The most recent engine records (last = current position). Take-backs pop from the end. */
  private records: CheckersGame[] = [newGame()];

  protected defaultSettings(): CheckersSettings {
    return structuredClone(DEFAULT_CHECKERS_SETTINGS);
  }

  protected createState(): CheckersState {
    return new CheckersState();
  }

  protected sideName(side: BoardSide): string {
    return SIDE_NAME[side];
  }

  protected override onBoardCreated(): void {
    this.handle(CHECKERS_MSG.move, CheckersMoveSchema, (player, payload) => this.onMove(player, payload), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: RATE.action,
    });
  }

  protected onBoardSetup(): void {
    this.records = [newGame()];
    this.publish();
  }

  protected override onBoardReset(): void {
    this.records = [newGame()];
    this.publish();
  }

  protected override supportsUndo(): boolean {
    return true;
  }

  protected override takeBack(plies: number): boolean {
    if (plies < 1) return false;
    if (plies < this.records.length) {
      this.records.splice(this.records.length - plies);
    } else {
      // Deeper than the kept records (e.g. several take-backs in a row): replay the game up to that
      // point, which rebuilds the repetition table and the 40-move counter exactly.
      const keep = this.current.plies.length - plies;
      if (keep < 0) return false;
      let game = newGame();
      for (const ply of this.current.plies.slice(0, keep)) {
        const next = playMove(game, ply.path);
        if (!next.ok) return false;
        game = next.game;
      }
      this.records = [game];
    }
    this.publish();
    return true;
  }

  protected override defaultResultText(result: BoardResult): string {
    if (result.winner !== 'draw') {
      const winner = SIDE_NAME[result.winner];
      const loser = SIDE_NAME[result.winner === 'first' ? 'second' : 'first'];
      if (result.reason === 'no_pieces') return `${winner} wins — ${loser} has no pieces left`;
      if (result.reason === 'no_moves') return `${winner} wins — ${loser} has no legal move`;
    } else {
      if (result.reason === 'repetition') return 'Draw by threefold repetition';
      if (result.reason === 'forty_moves') return 'Draw — 40 moves each without a capture or a man move';
    }
    return super.defaultResultText(result);
  }

  protected override resultDetails(): Record<string, unknown> {
    const game = this.current;
    const stats: Record<string, { kings: number; captures: number }> = {};
    for (const side of ['first', 'second'] as const) {
      const id = this.seatFor(side).playerId;
      if (!id) continue;
      const color = checkersColorOf(side);
      const mine = game.plies.filter((p) => p.color === color);
      stats[id] = {
        kings: mine.filter((p) => p.crowned).length,
        captures: mine.reduce((n, p) => n + p.captures.length, 0),
      };
    }
    const moves = game.plies.length <= MAX_DETAIL_PLIES ? game.plies.map((p) => p.notation).join(' ') : undefined;
    return { ...(moves !== undefined ? { moves } : {}), playerStats: stats };
  }

  // ---------------------------------------------------------------------------

  private get current(): CheckersGame {
    return this.records[this.records.length - 1]!;
  }

  private onMove(player: PlayerRecord, { path, ply }: CheckersMovePayload): void {
    const side = this.guardTurn(player, CHECKERS_MSG.move, ply);
    if (!side) return;
    const game = this.current;
    if (checkersSideOf(game.position.turn) !== side) {
      // Engine and kit disagree: never happens unless a hook failed; refuse rather than guess.
      return this.reject(player, CHECKERS_MSG.move, 'not_your_turn', 'Wait for your turn.');
    }
    const played = playMove(game, path);
    if (!played.ok) {
      const capture = game.result === null && hasCapture(game.position);
      return this.reject(
        player,
        CHECKERS_MSG.move,
        'not_allowed',
        capture ? 'A capture is available — you must jump.' : 'That move is not legal.',
      );
    }
    this.records.push(played.game);
    if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
    this.publish();
    this.completeTurn(side);
    const event: CheckersMoveEvent = {
      ply: this.state.ply,
      side,
      notation: played.ply.notation,
      path: played.ply.path,
      captures: played.ply.captures,
      crowned: played.ply.crowned,
    };
    this.broadcast(CHECKERS_MSG.moved, event);
    if (played.game.result) this.finish(this.toBoardResult(played.game.result));
  }

  private toBoardResult(result: CheckersResult): BoardResult {
    if (result.winner === null) {
      return { winner: 'draw', reason: result.reason === 'agreement' ? BOARD_REASONS.agreement : result.reason };
    }
    return { winner: checkersSideOf(result.winner), reason: result.reason };
  }

  /** Mirror the current engine record into synchronized state. */
  private publish(): void {
    const game = this.current;
    const s = this.state;
    s.board = game.position.board;
    s.quietPlies = Math.min(255, game.quietPlies);
    s.repetitions = Math.min(255, repetitionCount(game));
    const history = s.history;
    const n = game.plies.length;
    if (history.length > n) history.splice(n, history.length - n);
    for (let i = history.length; i < n; i++) {
      const p = game.plies[i]!;
      history.push(new CheckersHistoryItem({ notation: p.notation, captures: p.captures.length, crowned: p.crowned }));
    }
    const last = game.plies[n - 1];
    s.lastPath.clear();
    s.lastCaptures.clear();
    if (last) {
      s.lastPath.push(...last.path);
      s.lastCaptures.push(...last.captures);
    }
  }
}
