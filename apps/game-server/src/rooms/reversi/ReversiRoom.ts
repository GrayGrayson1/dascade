/**
 * DAS Reversi — ten variants of the disc-flipping game on the DAS Boardroom kit.
 *
 * The kit owns sides (tournament sides, casual side mode, colours swapped on rematch), the server
 * clock, resign / draw offers / take-backs / rematches, abandonment and forfeits, and the ending
 * (result state, reportOutcome → ratings/stats/tournaments, endMatch). This room owns the rules:
 *
 *  - The variant comes from the lobby settings (tournaments: the organizer's gameSettings) and is
 *    fixed when the countdown sets the board up; rematches replay it. In the lobby the state shows
 *    the variant's start (Blockers without its blocks, Random Start from the usual centre); the
 *    countdown draws the random setups with the room's crypto RNG.
 *  - `reversi:move { cell, ply }` — the only game message. The kit's `guardTurn` checks phase,
 *    seat, flag, turn and that `ply` matches (stale/duplicate submissions are refused); the pure
 *    engine (`@dascade/game-core/reversi`) validates the placement, flips and settles the turn.
 *  - A player who can't move is skipped automatically: the room completes a skipped turn for them
 *    right after the move (the ply goes up by two), so the kit's clocks, offers and take-backs see
 *    ordinary turns. The game ends when neither side can move and the disc count decides.
 *  - Take-backs replay the remaining plies from the game's start; one that would land right before
 *    a skipped turn is refused (that position has no move to play).
 *
 * Side 'first' is Black and moves first. Only Classic games are rated.
 */
import { RATE, type CreateOptions } from '@dascade/shared';
import type { BoardSide } from '@dascade/shared/games/boardroom';
import {
  DEFAULT_REVERSI_SETTINGS,
  REVERSI_MSG,
  REVERSI_REASONS,
  REVERSI_SIDE_LABEL,
  REVERSI_VARIANT_INFO,
  ReversiMoveSchema,
  ReversiSettingsSchema,
  isRatedReversiVariant,
  reversiVariantOf,
  type ReversiMoveEvent,
  type ReversiMovePayload,
  type ReversiSettings,
  type ReversiVariant,
} from '@dascade/shared/games/reversi';
import { fromPlies, mustPass, newGame, playMove, randomSetup, type ReversiGame, type ReversiRefusal } from '@dascade/game-core/reversi';
import type { PlayerRecord } from '../BaseGameRoom.ts';
import { BoardGameRoom, type BoardResult } from '../boardroom/index.ts';
import { ReversiHistoryItem, ReversiState } from './ReversiState.ts';

/** Longest move record included in the outcome details (Grand: 100 squares plus skipped turns). */
const MAX_DETAIL_PLIES = 250;

const REFUSALS: Record<ReversiRefusal, string> = {
  over: 'The game is over.',
  off_board: 'That square is not on this board.',
  occupied: 'That square is taken.',
  hole: 'That square is out of play.',
  centre: 'The first four discs go on the four centre squares.',
  no_flip: 'That move flips nothing — trap at least one of your opponent’s discs.',
  no_discs: 'You have no discs left.',
};

export class ReversiRoom extends BoardGameRoom<ReversiState, ReversiSettings> {
  readonly gameId = 'reversi' as const;
  protected readonly settingsSchema = ReversiSettingsSchema;

  private variant: ReversiVariant = 'classic';
  private game: ReversiGame = newGame('classic');

  protected defaultSettings(): ReversiSettings {
    return structuredClone(DEFAULT_REVERSI_SETTINGS);
  }

  protected createState(): ReversiState {
    return new ReversiState();
  }

  protected sideName(side: BoardSide): string {
    return REVERSI_SIDE_LABEL[side];
  }

  protected override onBoardCreated(_options: CreateOptions): void {
    this.handle(REVERSI_MSG.move, ReversiMoveSchema, (player, payload) => this.onMove(player, payload), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: RATE.action,
    });
    this.resetGame();
  }

  protected onBoardSetup(): void {
    this.variant = reversiVariantOf(this.settings);
    this.game = newGame(this.variant, randomSetup(this.variant, this.rng));
    this.publish();
  }

  protected override onBoardReset(): void {
    this.resetGame();
  }

  protected override onSettingsChanged(prev: ReversiSettings, next: ReversiSettings): void {
    super.onSettingsChanged(prev, next);
    if (this.phase === 'LOBBY' && prev.variant !== next.variant) this.resetGame();
  }

  protected override isRatedMatch(): boolean {
    return super.isRatedMatch() && isRatedReversiVariant(reversiVariantOf(this.settings));
  }

  protected override supportsUndo(): boolean {
    return true;
  }

  protected override takeBack(plies: number): boolean {
    const keep = this.game.plies.length - plies;
    if (plies < 1 || keep < 0) return false;
    let game: ReversiGame;
    try {
      game = fromPlies(
        this.variant,
        this.game.plies.slice(0, keep).map((p) => p.cell),
        this.game.start.board,
      );
    } catch {
      return false;
    }
    if (game.result || mustPass(game.position)) return false;
    this.game = game;
    this.publish();
    return true;
  }

  protected override defaultResultText(result: BoardResult): string {
    const score = this.game.result?.score;
    if (score && result.reason === REVERSI_REASONS.tie) return `Draw — ${score[0]} discs each`;
    if (score && result.reason === REVERSI_REASONS.discs && result.winner !== 'draw') {
      const mine = score[result.winner === 'first' ? 0 : 1];
      const theirs = score[result.winner === 'first' ? 1 : 0];
      const winner = this.sideName(result.winner);
      if (REVERSI_VARIANT_INFO[this.variant].goal === 'fewest') return `${winner} wins with fewer discs, ${mine}–${theirs}`;
      return theirs === 0 ? `${winner} wins ${mine}–0 — a wipeout` : `${winner} wins ${mine}–${theirs}`;
    }
    return super.defaultResultText(result);
  }

  protected override resultDetails(): Record<string, unknown> {
    const plies = this.game.plies;
    const moves = plies.length <= MAX_DETAIL_PLIES ? plies.map((p) => p.notation).join(' ') : undefined;
    const [black, white] = this.game.result?.score ?? [0, 0];
    return { variant: this.variant, ...(this.game.result ? { black, white } : {}), ...(moves !== undefined ? { moves } : {}) };
  }

  // ---------------------------------------------------------------------------

  /** A fresh start position in the variant of the current settings (no random setup in the lobby). */
  private resetGame(): void {
    this.variant = reversiVariantOf(this.settings);
    this.game = newGame(this.variant);
    this.publish();
  }

  private onMove(player: PlayerRecord, payload: ReversiMovePayload): void {
    const side = this.guardTurn(player, REVERSI_MSG.move, payload.ply);
    if (!side) return;
    if (this.game.position.turn !== side) {
      // Engine and kit disagree: never happens unless a hook failed; refuse rather than guess.
      return this.reject(player, REVERSI_MSG.move, 'not_your_turn', 'Wait for your turn.');
    }
    const played = playMove(this.game, payload.cell);
    if (!played.ok) return this.reject(player, REVERSI_MSG.move, 'not_allowed', REFUSALS[played.reason]);

    this.game = played.game;
    this.publish();
    this.completeTurn(side);
    if (played.passed) this.completeTurn(played.passed, true);
    const event: ReversiMoveEvent = {
      ply: this.state.ply,
      side,
      notation: played.ply.notation,
      cell: played.ply.cell,
      flips: played.ply.flips,
      passed: played.passed ?? '',
    };
    this.broadcast(REVERSI_MSG.moved, event);
    const result = played.game.result;
    if (result) this.finish({ winner: result.winner ?? 'draw', reason: result.reason });
  }

  /** Mirror the engine record into synchronized state. */
  private publish(): void {
    const game = this.game;
    const s = this.state;
    s.variant = this.variant;
    s.size = REVERSI_VARIANT_INFO[this.variant].size;
    s.board = game.position.board;
    const plies = game.plies;
    const tail = plies[plies.length - 1];
    const placed = tail && tail.cell < 0 ? plies[plies.length - 2] : tail;
    s.lastCell = placed ? placed.cell : -1;
    s.lastPassed = tail && tail.cell < 0 ? tail.side : '';
    s.lastFlips.clear();
    if (placed?.flips.length) s.lastFlips.push(...placed.flips);
    s.supply.clear();
    if (game.position.supply) s.supply.push(...game.position.supply);
    const history = s.history;
    const n = plies.length;
    if (history.length > n) history.splice(n, history.length - n);
    for (let i = 0; i < history.length; i++) {
      // A take-back followed by another move can replace the tail: keep entries exact.
      const notation = plies[i]!.notation;
      if (history[i]!.notation !== notation) history[i]!.notation = notation;
    }
    for (let i = history.length; i < n; i++) history.push(new ReversiHistoryItem({ notation: plies[i]!.notation }));
  }
}
