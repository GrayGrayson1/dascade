/**
 * DAS Chess — authoritative chess room on the DAS Boardroom kit.
 *
 * The server's ChessGame (chess.js) is the single source of truth: clients send move intents
 * (from, to, promotion, ply) and the room validates turn, ply and legality before anything changes.
 * Chess has no hidden information, so everything lives in public state (spectators see it all but
 * can't act). The kit handles sides, clocks, draw offers, take-backs, resign, rematch, abandonment,
 * ratings and reportOutcome.
 *
 * Draw policy (documented in the kit notes and the client help): stalemate, dead positions
 * (insufficient material), threefold repetition and the fifty-move rule end the game
 * AUTOMATICALLY, the moment they occur — nobody has to claim them. Checkmate always takes
 * precedence. A flag against a side whose opponent has no mating material is a draw.
 *
 * Variants: the lobby picks one (tournaments: the organizer's gameSettings); the board follows it
 * in the lobby and it is locked when the game is set up. Standard runs on chess.js and is the only
 * rated variant; the others run on the variant engine (createChessGame) and are always casual —
 * tournaments included. Chess960 draws its back rank with the room's crypto RNG for every game.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { timeControlPgn, type BoardSide } from '@dascade/shared/games/boardroom';
import {
  CHESS_MSG,
  CHESS_VARIANT_INFO,
  ChessMoveSchema,
  ChessSettingsSchema,
  DEFAULT_CHESS_SETTINGS,
  isChessVariant,
  type ChessMovePayload,
  type ChessSettings,
  type ChessVariant,
} from '@dascade/shared/games/chess';
import {
  buildGamePgn,
  chess960Fen,
  colorSide,
  createChessGame,
  pgnResultFor,
  sideColor,
  type ChessGameApi,
  type ChessMoveRecord,
} from '@dascade/game-core/chess';
import type { PlayerRecord } from '../BaseGameRoom.ts';
import { BoardGameRoom, BoardRoomState, type BoardResult } from '../boardroom/index.ts';

export const ChessMoveEntry = schema(
  {
    san: t.string().default(''),
    uci: t.string().default(''),
    from: t.string().default(''),
    to: t.string().default(''),
    color: t.string().default('w'),
    piece: t.string().default(''),
    captured: t.string().default(''),
    promotion: t.string().default(''),
    castle: t.string().default(''),
    enPassant: t.boolean().default(false),
    check: t.boolean().default(false),
    mate: t.boolean().default(false),
    clockMs: t.float64().default(0),
    drop: t.string().default(''),
    exploded: t.string().default(''),
  },
  'ChessMoveEntry',
);
export type ChessMoveEntry = SchemaType<typeof ChessMoveEntry>;

export const ChessState = BoardRoomState.extend(
  {
    variant: t.string().default('standard'),
    fen: t.string().default(''),
    startFen: t.string().default(''),
    moves: t.array(ChessMoveEntry),
    inCheck: t.boolean().default(false),
    checkSquare: t.string().default(''),
    repetition: t.uint8().default(1),
    halfmoveClock: t.uint16().default(0),
    pgn: t.string().default(''),
    startedAt: t.float64().default(0),
  },
  'ChessState',
);
export type ChessState = SchemaType<typeof ChessState>;

/** Result texts by reason (`winner` is '' for a draw). */
const END_TEXT: Record<string, (winner: string) => string> = {
  checkmate: (w) => `${w} wins by checkmate`,
  stalemate: () => 'Draw by stalemate',
  insufficient: () => 'Draw — insufficient material',
  repetition: () => 'Draw by threefold repetition',
  fifty_moves: () => 'Draw by the fifty-move rule',
  hill: (w) => `${w} wins — king reached the hill`,
  three_checks: (w) => `${w} wins by giving check three times`,
  race: (w) => (w ? `${w} wins the race to the 8th rank` : 'Draw — both kings reached the 8th rank'),
  explosion: (w) => `${w} wins — the enemy king exploded`,
  no_pieces: (w) => `${w} wins by losing every piece`,
  no_moves: (w) => `${w} wins — no legal move left`,
  horde_captured: () => 'Black wins — the horde is wiped out',
};

export class ChessRoom extends BoardGameRoom<ChessState, ChessSettings> {
  readonly gameId = 'chess' as const;
  protected readonly settingsSchema = ChessSettingsSchema;

  /** The variant of the current game (follows the lobby setting until the game is set up). */
  private variant: ChessVariant = 'standard';
  private game: ChessGameApi = createChessGame('standard');

  protected defaultSettings(): ChessSettings {
    return structuredClone(DEFAULT_CHESS_SETTINGS);
  }

  protected createState(): ChessState {
    const state = new ChessState();
    state.variant = this.variant;
    state.fen = this.game.fen;
    state.startFen = this.game.startFen;
    return state;
  }

  protected sideName(side: BoardSide): string {
    return side === 'first' ? 'White' : 'Black';
  }

  protected override defaultResultText(result: BoardResult): string {
    const custom = END_TEXT[result.reason];
    if (custom) return custom(result.winner === 'draw' ? '' : this.sideName(result.winner));
    return super.defaultResultText(result);
  }

  protected override onBoardCreated(): void {
    // Moves alternate with the opponent's, so a player can't legitimately exceed a few per second
    // (premoves included); the bucket only stops floods.
    this.handle(CHESS_MSG.move, ChessMoveSchema, (p, payload) => this.onMove(p, payload), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: { burst: 12, perSecond: 5 },
    });
    // The room may be created with a variant already chosen (e.g. a tournament match).
    this.resetPosition();
  }

  protected onBoardSetup(): void {
    this.resetPosition(true);
  }

  protected override onBoardStart(): void {
    this.state.startedAt = Date.now();
  }

  protected override onBoardReset(): void {
    this.resetPosition();
    this.state.startedAt = 0;
  }

  protected override onSettingsChanged(prev: ChessSettings, next: ChessSettings): void {
    super.onSettingsChanged(prev, next);
    if (this.phase === 'LOBBY' && prev.variant !== next.variant) this.resetPosition();
  }

  /** Only Standard changes ratings; the variants are casual (tournaments included). */
  protected override isRatedMatch(): boolean {
    return super.isRatedMatch() && this.settingsVariant() === 'standard';
  }

  protected override supportsUndo(): boolean {
    return true;
  }

  protected override takeBack(plies: number): boolean {
    if (plies > this.game.ply) return false;
    // (The variant engine's undo restores pockets, check counts and exploded pieces too.)
    for (let i = 0; i < plies; i++) {
      if (!this.game.undo()) return false;
      this.state.moves.pop();
    }
    this.publishPosition();
    return true;
  }

  protected override canWinOnTime(side: BoardSide): boolean {
    return this.game.canMate(sideColor(side));
  }

  protected override resultDetails(result: BoardResult): Record<string, unknown> {
    const details: Record<string, unknown> = { variant: this.variant, moves: this.game.ply, fullMoves: Math.ceil(this.game.ply / 2) };
    if (result.reason === 'checkmate' && result.winner !== 'draw') {
      const winner = this.seatFor(result.winner).playerId;
      if (winner) details.playerStats = { [winner]: { checkmates: 1 } };
    }
    return details;
  }

  protected override onBoardEnd(result: BoardResult): void {
    this.state.pgn = this.pgn(result);
  }

  // ===========================================================================

  private onMove(player: PlayerRecord, payload: ChessMovePayload): void {
    const type = CHESS_MSG.move;
    const side = this.guardTurn(player, type, payload.ply);
    if (!side) return;
    if (sideColor(side) !== this.game.turn) {
      // Defensive: the kit's turn and the engine must always agree.
      this.reject(player, type, 'not_your_turn', 'Wait for your turn.');
      return;
    }
    if (payload.from && this.game.isPromotion(payload.from, payload.to) && !payload.promotion) {
      this.reject(player, type, 'not_allowed', 'Choose a piece to promote to.');
      return;
    }
    const record = this.game.move(payload);
    if (!record) {
      const text = payload.drop
        ? 'You can’t drop that piece there.'
        : this.game.mustCapture()
          ? 'You must capture.'
          : 'That move is not legal.';
      this.reject(player, type, 'not_allowed', text);
      return;
    }
    this.completeTurn(side);
    this.pushMove(record, side);
    this.publishPosition();

    const end = this.game.status();
    if (end) {
      this.finish({ winner: end.winner ? colorSide(end.winner) : 'draw', reason: end.reason });
    }
  }

  private settingsVariant(): ChessVariant {
    const v: unknown = this.getSettings().variant;
    return isChessVariant(v) ? v : 'standard';
  }

  /** A fresh game of the lobby's variant. `forGame`: Chess960 draws its starting position now. */
  private resetPosition(forGame = false): void {
    this.variant = this.settingsVariant();
    const fen = forGame && this.variant === 'chess960' ? chess960Fen(this.rng.int(960)) : undefined;
    this.game = createChessGame(this.variant, fen);
    this.state.variant = this.variant;
    this.state.moves.clear();
    this.state.startFen = this.game.startFen;
    this.state.pgn = '';
    this.publishPosition();
  }

  private pushMove(record: ChessMoveRecord, side: BoardSide): void {
    const clock = this.state.clock;
    this.state.moves.push(
      new ChessMoveEntry({
        san: record.san,
        uci: record.uci,
        from: record.from,
        to: record.to,
        color: record.color,
        piece: record.piece,
        captured: record.captured,
        promotion: record.promotion,
        castle: record.castle,
        enPassant: record.enPassant,
        check: record.check,
        mate: record.mate,
        clockMs: clock.enabled ? (side === 'first' ? clock.firstMs : clock.secondMs) : 0,
        drop: record.drop ?? '',
        exploded: record.exploded?.join(' ') ?? '',
      }),
    );
  }

  private publishPosition(): void {
    const g = this.game;
    this.state.fen = g.fen;
    const check = g.inCheck();
    this.state.inCheck = check;
    this.state.checkSquare = check ? (g.kingSquare(g.turn) ?? '') : '';
    this.state.repetition = Math.min(255, g.repetitionCount());
    this.state.halfmoveClock = Math.min(65_535, g.halfmoveClock());
  }

  private pgn(result: BoardResult): string {
    const t = this.tournamentMatch;
    const white = this.seatFor('first');
    const black = this.seatFor('second');
    return buildGamePgn({
      event: t ? `DASCADE — ${t.tournamentName}` : 'DASCADE',
      site: `DASCADE room ${this.state.code}`,
      startedAt: this.state.startedAt || this.matchStartedAt || Date.now(),
      round: t ? `${t.roundLabel} · game ${t.gameNumber}` : String(this.state.gameNumber || 1),
      white: white.name || 'White',
      black: black.name || 'Black',
      result: pgnResultFor(result.winner === 'draw' ? 'draw' : sideColor(result.winner)),
      timeControl: timeControlPgn(this.state.clock.enabled ? this.getSettings().timeControl : { baseMinutes: 0, incrementSeconds: 0 }),
      reason: result.reason,
      moves: this.state.moves.map((m) => ({ san: m.san, clockMs: m.clockMs })),
      timed: this.state.clock.enabled,
      variant: this.variant === 'standard' ? undefined : CHESS_VARIANT_INFO[this.variant].title,
      startFen: this.variant === 'chess960' ? this.game.startFen : undefined,
    });
  }
}
