/**
 * DAS Tic-Tac-Toe — thirteen variants of noughts and crosses on the DAS Boardroom kit.
 *
 * The kit owns sides (tournament sides, casual side mode, sides swapped on rematch), the server
 * clock, resign / draw offers / take-backs / rematches, abandonment and forfeits, and the ending
 * (result state, reportOutcome → stats/tournaments, endMatch). This room owns the rules:
 *
 *  - The variant comes from the lobby settings (tournaments: the organizer's gameSettings) and is
 *    fixed when the countdown sets the board up; rematches replay it. In the lobby the state
 *    follows the setting, so everyone sees the chosen variant's empty board.
 *  - `tictactoe:move { cell, mark?, num?, size?, from?, ply }` — the only game message. The kit's
 *    `guardTurn` checks phase, seat, flag, turn and that `ply` matches (stale/duplicate submissions
 *    are refused); the pure engine (`@dascade/game-core/tictactoe`) resolves the move against the
 *    position (Gravity's landing cell, Ultimate's sent-to board, Nesting's sizes…) and decides the
 *    game: lines, full boards, Misère, Order & Chaos, Notakto's last board, repetitions.
 *  - Take-backs replay the remaining moves from the start (games are short: at most 225 plies).
 *
 * Side 'first' moves first: X (Order in Order & Chaos, Odds in Numbers, First in Wild and Notakto).
 * Not rated (the catalog has no `rated`): perfect play draws Classic.
 */
import { RATE, type CreateOptions } from '@dascade/shared';
import { otherSide, type BoardSide } from '@dascade/shared/games/boardroom';
import {
  DEFAULT_TICTACTOE_SETTINGS,
  TTT_MSG,
  TTT_REASONS,
  TTT_VARIANT_INFO,
  TicTacToeSettingsSchema,
  TttMoveSchema,
  type TicTacToeSettings,
  type TttMoveEvent,
  type TttMovePayload,
  type TttVariant,
} from '@dascade/shared/games/tictactoe';
import {
  dropCell,
  fadingCells,
  newGame,
  numbersLeft,
  playMove,
  repetitionCount,
  replay,
  topOf,
  type TttGame,
  type TttMove,
  type TttPosition,
} from '@dascade/game-core/tictactoe';
import type { PlayerRecord } from '../BaseGameRoom.ts';
import { BoardGameRoom, type BoardResult } from '../boardroom/index.ts';
import { TicTacToeState, TttHistoryItem } from './TicTacToeState.ts';

/** Longest move record included in the outcome details (Gomoku's full board is 225). */
const MAX_DETAIL_PLIES = 400;

const IN_A_ROW = ['', 'one', 'two', 'three', 'four', 'five'] as const;

/** Mirror `values` into a synchronized array, touching only the entries that changed. */
function syncArray<T>(target: { length: number; clear(): void; push(...items: T[]): number; [n: number]: T }, values: readonly T[]): void {
  if (target.length !== values.length) {
    target.clear();
    if (values.length) target.push(...values);
    return;
  }
  for (let i = 0; i < values.length; i++) if (target[i] !== values[i]) target[i] = values[i]!;
}

export class TicTacToeRoom extends BoardGameRoom<TicTacToeState, TicTacToeSettings> {
  readonly gameId = 'tictactoe' as const;
  protected readonly settingsSchema = TicTacToeSettingsSchema;

  private variant: TttVariant = 'classic';
  private game: TttGame = newGame('classic');

  protected defaultSettings(): TicTacToeSettings {
    return structuredClone(DEFAULT_TICTACTOE_SETTINGS);
  }

  protected createState(): TicTacToeState {
    return new TicTacToeState();
  }

  protected sideName(side: BoardSide): string {
    return TTT_VARIANT_INFO[this.variant].sides[side === 'first' ? 0 : 1];
  }

  protected override onBoardCreated(_options: CreateOptions): void {
    this.handle(TTT_MSG.move, TttMoveSchema, (player, payload) => this.onMove(player, payload), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: RATE.action,
    });
    this.resetGame();
  }

  protected onBoardSetup(): void {
    this.resetGame();
  }

  protected override onBoardReset(): void {
    this.resetGame();
  }

  protected override onSettingsChanged(prev: TicTacToeSettings, next: TicTacToeSettings): void {
    super.onSettingsChanged(prev, next);
    if (this.phase === 'LOBBY' && prev.variant !== next.variant) this.resetGame();
  }

  protected override supportsUndo(): boolean {
    return true;
  }

  protected override takeBack(plies: number): boolean {
    const keep = this.game.plies.length - plies;
    if (plies < 1 || keep < 0) return false;
    try {
      this.game = replay(
        this.variant,
        this.game.plies.slice(0, keep).map((p) => p.move),
      );
    } catch {
      return false;
    }
    this.publish();
    return true;
  }

  protected override defaultResultText(result: BoardResult): string {
    const info = TTT_VARIANT_INFO[this.variant];
    if (result.winner === 'draw') {
      if (result.reason === TTT_REASONS.full)
        return this.variant === 'ultimate' ? 'Draw — every small board is decided' : 'Draw — the board is full';
      if (result.reason === TTT_REASONS.repetition) return 'Draw by threefold repetition';
      if (result.reason === TTT_REASONS.moveLimit) return 'Draw — move limit reached';
      return super.defaultResultText(result);
    }
    const winner = this.sideName(result.winner);
    const loser = this.sideName(otherSide(result.winner));
    const wins = `${winner} ${this.plural() ? 'win' : 'wins'}`;
    switch (result.reason) {
      case TTT_REASONS.line:
        return `${wins} — ${IN_A_ROW[info.inARow] ?? info.inARow} in a row`;
      case TTT_REASONS.misere:
        return `${wins} — ${loser} made three in a row`;
      case TTT_REASONS.sum:
        return `${wins} — a line adding up to 15`;
      case TTT_REASONS.uncovered:
        return `${wins} — ${loser} uncovered ${winner}’s line`;
      case TTT_REASONS.boards:
        return `${wins} — three boards in a row`;
      case TTT_REASONS.lastBoard:
        return `${wins} — ${loser} killed the last board`;
      case TTT_REASONS.chaos:
        return `${wins} — the board filled up`;
    }
    const text = super.defaultResultText(result);
    return this.plural() ? text.replace(`${winner} wins`, `${winner} win`) : text;
  }

  protected override finish(result: BoardResult): void {
    // "Odds win", "Evens win": the kit's own sentences (resign, forfeit…) say "wins".
    const text = result.text && this.plural() ? result.text.replace(/^(Odds|Evens) wins\b/, '$1 win') : result.text;
    super.finish(text === undefined ? result : { ...result, text });
  }

  protected override resultDetails(): Record<string, unknown> {
    const plies = this.game.plies;
    const moves = plies.length <= MAX_DETAIL_PLIES ? plies.map((p) => p.notation).join(' ') : undefined;
    return { variant: this.variant, ...(moves !== undefined ? { moves } : {}) };
  }

  // ---------------------------------------------------------------------------

  /** "Odds" and "Evens" take a plural verb. */
  private plural(): boolean {
    return this.variant === 'numbers';
  }

  /** A fresh board in the variant of the current settings. */
  private resetGame(): void {
    this.variant = this.settings.variant;
    this.game = newGame(this.variant);
    this.publish();
  }

  private onMove(player: PlayerRecord, payload: TttMovePayload): void {
    const side = this.guardTurn(player, TTT_MSG.move, payload.ply);
    if (!side) return;
    const position = this.game.position;
    if (position.turn !== side) {
      // Engine and kit disagree: never happens unless a hook failed; refuse rather than guess.
      return this.reject(player, TTT_MSG.move, 'not_your_turn', 'Wait for your turn.');
    }
    const move: TttMove = { cell: payload.cell };
    if (payload.mark !== undefined) move.mark = payload.mark;
    if (payload.num !== undefined) move.num = payload.num;
    if (payload.size !== undefined) move.size = payload.size as TttMove['size'];
    if (payload.from !== undefined) move.from = payload.from;
    const played = playMove(this.game, move);
    if (!played.ok) return this.reject(player, TTT_MSG.move, 'not_allowed', this.whyRefused(position, move));

    this.game = played.game;
    this.publish();
    this.completeTurn(side);
    const result = played.game.result;
    const event: TttMoveEvent = {
      ply: this.state.ply,
      side,
      notation: played.ply.notation,
      cell: played.ply.move.cell,
      from: played.ply.move.from ?? -1,
      removed: played.ply.removed,
      board: played.ply.board,
      line: result?.line ?? [],
    };
    this.broadcast(TTT_MSG.moved, event);
    if (result) this.finish({ winner: result.winner ?? 'draw', reason: result.reason });
  }

  /** A helpful sentence for a refused move. */
  private whyRefused(position: TttPosition, move: TttMove): string {
    const { variant, cells } = position;
    if (move.cell >= cells.length) return 'That square is not on this board.';
    switch (variant) {
      case 'gravity':
        return dropCell(position, move.cell) < 0 ? 'That column is full.' : 'That move is not legal.';
      case 'wild':
      case 'orderchaos':
        if (move.mark === undefined) return 'Choose X or O first.';
        break;
      case 'numbers':
        if (move.num === undefined || !numbersLeft(position).includes(move.num)) return 'Pick one of your numbers first.';
        break;
      case 'ultimate': {
        const board = Math.floor(move.cell / 9);
        if (position.boards[board] !== '.') return 'That board is already decided — play in the highlighted board.';
        if (position.active >= 0 && position.active !== board) return 'Play in the highlighted board.';
        break;
      }
      case 'notakto':
        if (position.boards[Math.floor(move.cell / 9)] !== '.') return 'That board is dead — play on a live one.';
        break;
      case 'nesting': {
        if (move.from !== undefined) {
          const piece = topOf(cells[move.from] ?? '');
          if (!piece || piece.owner !== (position.turn === 'first' ? 'x' : 'o')) return 'Move one of your own pieces.';
          return 'That piece can’t go there.';
        }
        if (move.size === undefined) return 'Pick a piece first.';
        const left = position.hands[(position.turn === 'first' ? 0 : 3) + move.size - 1] ?? 0;
        if (left <= 0) return 'You have no pieces of that size left.';
        return 'That piece can’t go there.';
      }
    }
    return cells[move.cell] ? 'That square is taken.' : 'That move is not legal.';
  }

  /** Mirror the engine record into synchronized state. */
  private publish(): void {
    const game = this.game;
    const s = this.state;
    const p = game.position;
    s.variant = this.variant;
    syncArray(s.cells, p.cells);
    s.boards = p.boards;
    s.active = p.active;
    syncArray(s.winLine, game.result?.line ?? []);
    const last = game.plies[game.plies.length - 1];
    s.lastCell = last ? last.move.cell : -1;
    s.lastFrom = last?.move.from ?? -1;
    s.lastRemoved = last ? last.removed : -1;
    const fading = fadingCells(game);
    syncArray(s.fading, this.variant === 'vanishing' ? [fading.first, fading.second] : []);
    syncArray(s.hands, p.hands);
    s.repetitions = Math.min(255, repetitionCount(game));
    const history = s.history;
    const n = game.plies.length;
    if (history.length > n) history.splice(n, history.length - n);
    for (let i = 0; i < history.length; i++) {
      // A take-back followed by another move can replace the tail: keep entries exact.
      const notation = game.plies[i]!.notation;
      if (history[i]!.notation !== notation) history[i]!.notation = notation;
    }
    for (let i = history.length; i < n; i++) history.push(new TttHistoryItem({ notation: game.plies[i]!.notation }));
  }
}
