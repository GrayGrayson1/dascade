/**
 * DAS Checkers — twelve draughts variants on the DAS Boardroom kit (American checkers by default).
 *
 * The kit owns sides (tournament sides, casual side mode, colour swap on rematch), the server
 * clock, resign / draw offers / take-backs / rematches, abandonment and forfeits, and the ending
 * (result state, reportOutcome → ratings/stats/tournaments, endMatch). This room owns the rules:
 *
 *  - The variant comes from the lobby settings (tournaments: the organizer's gameSettings). In the
 *    lobby the board follows the setting, so everyone sees the chosen variant's starting position;
 *    `onBoardSetup` locks it for the game (rematches replay it).
 *  - `checkers:move { path, ply }` — the only game message. The kit's `guardTurn` checks phase,
 *    seat, flag, turn and that `ply` matches (stale/duplicate submissions are refused); the pure
 *    engine (`checkersEngine(variant)` from `@dascade/game-core/checkers`) resolves the path against
 *    the legal moves (mandatory captures and the variant's capture priority, complete multi-jumps,
 *    promotion) and applies it. American checkers plays on the original engine, unchanged.
 *  - Endings from the board: no pieces / no legal move (a loss — a win in Giveaway and
 *    Antidraughts), Breakthrough's first king, threefold repetition and the variant's move-limit and
 *    endgame draws. See game-core/checkers/variants/game.ts.
 *  - Only American checkers is rated; the other variants play casual and tournament games unrated.
 *  - Take-backs restore the engine record from a short per-ply stack (replaying the game when a
 *    take-back goes deeper than the stack, e.g. several in a row).
 *
 * Side 'first' plays the colour that moves first in the variant (Dark in American, Giveaway and
 * Pool; Light in the others), 'second' the other.
 */
import { RATE } from '@dascade/shared';
import { BOARD_REASONS, type BoardSide } from '@dascade/shared/games/boardroom';
import {
  CHECKERS_COLOR_LABEL,
  CHECKERS_MSG,
  CHECKERS_VARIANT_INFO,
  CheckersMoveSchema,
  CheckersSettingsSchema,
  DEFAULT_CHECKERS_SETTINGS,
  checkersColorOf,
  checkersSideOf,
  checkersVariantOf,
  isRatedCheckersVariant,
  type CheckersMoveEvent,
  type CheckersMovePayload,
  type CheckersSettings,
  type CheckersVariant,
} from '@dascade/shared/games/checkers';
import {
  checkersEngine,
  describeVariantResult,
  positionKey,
  replayVariant,
  type CheckersEngine,
  type CheckersMove,
  type DraughtsGame,
  type DraughtsResult,
} from '@dascade/game-core/checkers';
import type { PlayerRecord } from '../BaseGameRoom.ts';
import { BoardGameRoom, type BoardResult } from '../boardroom/index.ts';
import { CheckersHistoryItem, CheckersState } from './CheckersState.ts';

/**
 * Engine records kept for take-backs. The kit undoes at most 2 plies, and each record carries the
 * whole ply list, so an unbounded stack would grow quadratically over a (deliberately) long game.
 */
const MAX_RECORDS = 4;
/** Longest move record included in the outcome details (a normal game is far shorter). */
const MAX_DETAIL_PLIES = 400;
/** Results the board decides (their text comes from the engine). */
const BOARD_ENDINGS = new Set(['no_pieces', 'no_moves', 'breakthrough', 'repetition', 'forty_moves', 'move_limit', 'endgame']);

/** Why a move was refused while a capture is available, in the variant's terms. */
function captureRefusal(engine: CheckersEngine, legal: readonly CheckersMove[]): string {
  const most = legal.reduce((n, m) => Math.max(n, m.captures.length), 0);
  const pieces = `${most} ${most === 1 ? 'piece' : 'pieces'}`;
  switch (engine.rules.capture) {
    case 'max':
      return `You must take the most pieces you can (${pieces}).`;
    case 'spanish':
      return `You must take the most pieces you can (${pieces}), then the most kings.`;
    case 'italian':
      return `You must play the strongest capture: the most pieces (${pieces}), with a king if you can, then the most kings.`;
    case 'czech':
      return 'A capture is available — you must jump, with a king whenever a king can capture.';
    default:
      return 'A capture is available — you must jump, and finish the whole capture.';
  }
}

export class CheckersRoom extends BoardGameRoom<CheckersState, CheckersSettings> {
  readonly gameId = 'checkers' as const;
  protected readonly settingsSchema = CheckersSettingsSchema;

  private variant: CheckersVariant = 'american';
  private engine: CheckersEngine = checkersEngine('american');
  /** The most recent engine records (last = current position). Take-backs pop from the end. */
  private records: DraughtsGame[] = [this.engine.newGame()];

  protected defaultSettings(): CheckersSettings {
    return structuredClone(DEFAULT_CHECKERS_SETTINGS);
  }

  protected createState(): CheckersState {
    return new CheckersState();
  }

  protected sideName(side: BoardSide): string {
    return CHECKERS_COLOR_LABEL[checkersColorOf(side, this.variant)];
  }

  protected override onBoardCreated(): void {
    this.handle(CHECKERS_MSG.move, CheckersMoveSchema, (player, payload) => this.onMove(player, payload), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: RATE.action,
    });
  }

  protected onBoardSetup(): void {
    this.resetGame();
  }

  protected override onBoardReset(): void {
    this.resetGame();
  }

  protected override onSettingsChanged(prev: CheckersSettings, next: CheckersSettings): void {
    super.onSettingsChanged(prev, next);
    if (this.phase === 'LOBBY' && checkersVariantOf(prev) !== checkersVariantOf(next)) this.resetGame();
  }

  /** Only American checkers changes ratings (decided before the board is set up, so from the settings). */
  protected override isRatedMatch(): boolean {
    return super.isRatedMatch() && isRatedCheckersVariant(checkersVariantOf(this.settings));
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
      // point, which rebuilds the repetition table and the draw counters exactly.
      const keep = this.current.plies.length - plies;
      if (keep < 0) return false;
      const game = replayVariant(
        this.variant,
        this.current.plies.slice(0, keep).map((p) => p.path),
      );
      if (!game) return false;
      this.records = [game];
    }
    this.publish();
    return true;
  }

  protected override defaultResultText(result: BoardResult): string {
    const engineResult = this.current.result;
    if (BOARD_ENDINGS.has(result.reason) && engineResult?.reason === result.reason)
      return describeVariantResult(this.variant, engineResult);
    return super.defaultResultText(result);
  }

  protected override resultDetails(): Record<string, unknown> {
    const game = this.current;
    const stats: Record<string, { kings: number; captures: number }> = {};
    for (const side of ['first', 'second'] as const) {
      const id = this.seatFor(side).playerId;
      if (!id) continue;
      const color = checkersColorOf(side, this.variant);
      const mine = game.plies.filter((p) => p.color === color);
      stats[id] = {
        kings: mine.filter((p) => p.crowned).length,
        captures: mine.reduce((n, p) => n + p.captures.length, 0),
      };
    }
    const moves = game.plies.length <= MAX_DETAIL_PLIES ? game.plies.map((p) => p.notation).join(' ') : undefined;
    return { variant: this.variant, ...(moves !== undefined ? { moves } : {}), playerStats: stats };
  }

  // ---------------------------------------------------------------------------

  private get current(): DraughtsGame {
    return this.records[this.records.length - 1]!;
  }

  /** A fresh board in the variant of the current settings. */
  private resetGame(): void {
    this.variant = checkersVariantOf(this.settings);
    this.engine = checkersEngine(this.variant);
    this.records = [this.engine.newGame()];
    this.publish();
  }

  private onMove(player: PlayerRecord, { path, ply }: CheckersMovePayload): void {
    // The schema admits every board size; this board has `squares` squares and a capture can take
    // at most every enemy piece.
    const { squares } = this.engine.geometry;
    if (path.some((sq) => sq > squares) || path.length > CHECKERS_VARIANT_INFO[this.variant].pieces + 1) {
      return this.reject(player, CHECKERS_MSG.move, 'invalid_payload', 'That path doesn’t fit this board.');
    }
    const side = this.guardTurn(player, CHECKERS_MSG.move, ply);
    if (!side) return;
    const game = this.current;
    if (checkersSideOf(game.position.turn, this.variant) !== side) {
      // Engine and kit disagree: never happens unless a hook failed; refuse rather than guess.
      return this.reject(player, CHECKERS_MSG.move, 'not_your_turn', 'Wait for your turn.');
    }
    const played = this.engine.playMove(game, path);
    if (!played.ok) {
      const legal = game.result === null ? this.engine.legalMoves(game.position) : [];
      const capture = legal.some((m) => m.captures.length > 0);
      return this.reject(
        player,
        CHECKERS_MSG.move,
        'not_allowed',
        capture ? captureRefusal(this.engine, legal) : 'That move is not legal.',
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

  private toBoardResult(result: DraughtsResult): BoardResult {
    if (result.winner === null) {
      return { winner: 'draw', reason: result.reason === 'agreement' ? BOARD_REASONS.agreement : result.reason };
    }
    return { winner: checkersSideOf(result.winner, this.variant), reason: result.reason };
  }

  /** Mirror the current engine record into synchronized state. */
  private publish(): void {
    const game = this.current;
    const s = this.state;
    s.variant = this.variant;
    s.board = game.position.board;
    s.quietPlies = Math.min(255, game.quietPlies);
    s.endgamePlies = Math.min(255, game.endgamePlies);
    s.repetitions = Math.min(255, game.seen[positionKey(game.position)] ?? 0);
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
