/**
 * DAS Chess engine — a thin, typed, never-throwing wrapper around chess.js (BSD-2-Clause) for move
 * legality, plus the DASCADE-specific rules on top:
 *  - game end detection in a fixed order (checkmate → stalemate → dead position → threefold → 50-move);
 *  - draw policy: threefold repetition and the fifty-move rule end the game AUTOMATICALLY (no claim
 *    needed), like the major online servers;
 *  - "can this side still checkmate?" for timeouts (flag vs. no mating material = draw);
 *  - premove destinations (geometry only, validated again when the premove is played);
 *  - material balance, PGN export with headers and %clk comments.
 * Pure and isomorphic (server + browser). No randomness.
 */
import { Chess, type Move, type Square } from 'chess.js';

export type ChessColor = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PromotionPiece = 'q' | 'r' | 'b' | 'n';
export type ChessSquare = Square;

export const PROMOTION_PIECES: readonly PromotionPiece[] = ['q', 'r', 'b', 'n'];
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const FILES = 'abcdefgh';
export const PIECE_VALUES: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export type ChessEndReason = 'checkmate' | 'stalemate' | 'insufficient' | 'repetition' | 'fifty_moves';

export interface ChessEnd {
  /** null = draw. */
  winner: ChessColor | null;
  reason: ChessEndReason;
}

export interface MoveInput {
  from: string;
  to: string;
  promotion?: string;
}

export interface ChessMoveRecord {
  san: string;
  /** Long algebraic, e.g. "e2e4", "e7e8q". */
  uci: string;
  from: ChessSquare;
  to: ChessSquare;
  color: ChessColor;
  piece: PieceType;
  /** Captured piece type ('' if none). */
  captured: PieceType | '';
  promotion: PromotionPiece | '';
  /** '' | 'k' (O-O) | 'q' (O-O-O). */
  castle: '' | 'k' | 'q';
  enPassant: boolean;
  check: boolean;
  mate: boolean;
  fenAfter: string;
}

export interface LegalMove {
  from: ChessSquare;
  to: ChessSquare;
  san: string;
  capture: boolean;
  promotion: PromotionPiece | '';
  castle: '' | 'k' | 'q';
}

const SQUARE_RE = /^[a-h][1-8]$/;

export function isSquare(value: string): value is ChessSquare {
  return SQUARE_RE.test(value);
}

export function isPromotionPiece(value: string): value is PromotionPiece {
  return value === 'q' || value === 'r' || value === 'b' || value === 'n';
}

/** Board side ('first' moves first) → chess colour. */
export function sideColor(side: 'first' | 'second'): ChessColor {
  return side === 'first' ? 'w' : 'b';
}

export function colorSide(color: ChessColor): 'first' | 'second' {
  return color === 'w' ? 'first' : 'second';
}

export function colorName(color: ChessColor): 'White' | 'Black' {
  return color === 'w' ? 'White' : 'Black';
}

/** 'e4' → [file 0..7, rank 0..7]. */
export function squareCoords(sq: string): [number, number] {
  return [sq.charCodeAt(0) - 97, sq.charCodeAt(1) - 49];
}

export function squareAt(file: number, rank: number): ChessSquare | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${FILES[file]}${rank + 1}` as ChessSquare;
}

/** Light or dark square ("a1" is dark). */
export function squareShade(sq: string): 'light' | 'dark' {
  const [f, r] = squareCoords(sq);
  return (f + r) % 2 === 0 ? 'dark' : 'light';
}

/** Position identity for repetition: placement, side to move, castling, en passant (only when capturable). */
export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

function toRecord(m: Move): ChessMoveRecord {
  const castle = m.isKingsideCastle() ? 'k' : m.isQueensideCastle() ? 'q' : '';
  return {
    san: m.san,
    uci: m.lan,
    from: m.from,
    to: m.to,
    color: m.color,
    piece: m.piece,
    captured: m.captured ?? '',
    promotion: (m.promotion as PromotionPiece | undefined) ?? '',
    castle,
    enPassant: m.isEnPassant(),
    check: m.san.includes('+') || m.san.includes('#'),
    mate: m.san.includes('#'),
    fenAfter: m.after,
  };
}

/** A chess game: current position plus full history (repetition counts need the history). */
export class ChessGame {
  private readonly chess: Chess;
  private readonly records: ChessMoveRecord[] = [];
  private readonly positions = new Map<string, number>();
  readonly startFen: string;

  constructor(fen: string = START_FEN) {
    this.chess = new Chess(fen);
    this.startFen = this.chess.fen();
    this.bump(this.startFen, 1);
  }

  get fen(): string {
    return this.chess.fen();
  }

  get turn(): ChessColor {
    return this.chess.turn();
  }

  get history(): readonly ChessMoveRecord[] {
    return this.records;
  }

  get ply(): number {
    return this.records.length;
  }

  inCheck(): boolean {
    return this.chess.inCheck();
  }

  /** Square of `color`'s king (null only on malformed test positions). */
  kingSquare(color: ChessColor = this.turn): ChessSquare | null {
    return this.chess.findPiece({ type: 'k', color })[0] ?? null;
  }

  piece(square: string): { type: PieceType; color: ChessColor } | null {
    if (!isSquare(square)) return null;
    return this.chess.get(square) ?? null;
  }

  legalMoves(from?: string): LegalMove[] {
    if (from !== undefined && !isSquare(from)) return [];
    const moves = from ? this.chess.moves({ square: from as ChessSquare, verbose: true }) : this.chess.moves({ verbose: true });
    return moves.map((m) => ({
      from: m.from,
      to: m.to,
      san: m.san,
      capture: m.isCapture(),
      promotion: (m.promotion as PromotionPiece | undefined) ?? '',
      castle: m.isKingsideCastle() ? 'k' : m.isQueensideCastle() ? 'q' : '',
    }));
  }

  /** Distinct destination squares for the piece on `from` (promotions collapse to one square). */
  legalTargets(from: string): ChessSquare[] {
    return [...new Set(this.legalMoves(from).map((m) => m.to))];
  }

  /** Is from→to a legal pawn promotion (so a piece must be chosen)? */
  isPromotion(from: string, to: string): boolean {
    return this.legalMoves(from).some((m) => m.to === to && m.promotion !== '');
  }

  /** Is from→to legal (any promotion piece)? */
  isLegal(input: MoveInput): boolean {
    return this.check(input) !== null;
  }

  /**
   * Play a move. Returns null (and changes nothing) when it is illegal, when a promotion piece is
   * missing for a promotion, or when one is given for a non-promotion move.
   */
  move(input: MoveInput): ChessMoveRecord | null {
    const normalized = this.check(input);
    if (!normalized) return null;
    let played: Move;
    try {
      played = this.chess.move(normalized);
    } catch {
      return null;
    }
    const record = toRecord(played);
    this.records.push(record);
    this.bump(this.chess.fen(), 1);
    return record;
  }

  /** Take back the last move. */
  undo(): ChessMoveRecord | null {
    if (this.records.length === 0) return null;
    const fenBefore = this.chess.fen();
    const undone = this.chess.undo();
    if (!undone) return null;
    this.bump(fenBefore, -1);
    return this.records.pop() ?? null;
  }

  /** How many times the current position has occurred (1 = first time). */
  repetitionCount(): number {
    return this.positions.get(positionKey(this.chess.fen())) ?? 0;
  }

  /** Half-moves since the last capture or pawn move (the fifty-move rule counts to 100). */
  halfmoveClock(): number {
    return Number(this.chess.fen().split(' ')[4] ?? 0);
  }

  /** Why the game is over, or null. Checkmate takes precedence over every automatic draw. */
  status(): ChessEnd | null {
    const c = this.chess;
    if (c.isCheckmate()) return { winner: c.turn() === 'w' ? 'b' : 'w', reason: 'checkmate' };
    if (c.isStalemate()) return { winner: null, reason: 'stalemate' };
    if (c.isInsufficientMaterial()) return { winner: null, reason: 'insufficient' };
    if (this.repetitionCount() >= 3) return { winner: null, reason: 'repetition' };
    if (this.halfmoveClock() >= 100) return { winner: null, reason: 'fifty_moves' };
    return null;
  }

  /** Could `color` checkmate by some sequence of legal moves (used when the opponent's flag falls)? */
  canMate(color: ChessColor): boolean {
    return hasMatingMaterial(
      this.chess
        .board()
        .flat()
        .filter((p) => p !== null),
      color,
    );
  }

  /** Material balance for display (lichess style). */
  material(): MaterialBalance {
    return materialBalance(this.chess.fen());
  }

  private check(input: MoveInput): { from: ChessSquare; to: ChessSquare; promotion?: PromotionPiece } | null {
    if (!isSquare(input.from) || !isSquare(input.to)) return null;
    const promo = input.promotion ? input.promotion.toLowerCase() : '';
    if (promo && !isPromotionPiece(promo)) return null;
    const candidates = this.legalMoves(input.from).filter((m) => m.to === input.to);
    if (candidates.length === 0) return null;
    const needsPromotion = candidates.some((m) => m.promotion !== '');
    if (needsPromotion !== Boolean(promo)) return null;
    return promo ? { from: input.from, to: input.to, promotion: promo as PromotionPiece } : { from: input.from, to: input.to };
  }

  private bump(fen: string, delta: number): void {
    const key = positionKey(fen);
    const next = (this.positions.get(key) ?? 0) + delta;
    if (next <= 0) this.positions.delete(key);
    else this.positions.set(key, next);
  }
}

// ---------------------------------------------------------------------------
// Mating material (timeouts)
// ---------------------------------------------------------------------------

interface BoardPiece {
  square: ChessSquare;
  type: PieceType;
  color: ChessColor;
}

/**
 * Whether `color` has material that could ever checkmate, given the opponent's pieces (helpmates count):
 *  - king alone: never;
 *  - any pawn, rook or queen: yes;
 *  - two or more minor pieces (knights and/or bishops on both colours): yes;
 *  - a single knight: only if the opponent has a pawn, knight, bishop or rook to block their own king;
 *  - bishops all on one square colour: only if the opponent has a knight, a pawn or a bishop on the other colour.
 * (Same rules as the major servers' "insufficient material to win on time".)
 */
export function hasMatingMaterial(pieces: readonly BoardPiece[], color: ChessColor): boolean {
  const own = pieces.filter((p) => p.color === color && p.type !== 'k');
  const opp = pieces.filter((p) => p.color !== color && p.type !== 'k');
  if (own.length === 0) return false;
  if (own.some((p) => p.type === 'p' || p.type === 'r' || p.type === 'q')) return true;
  const knights = own.filter((p) => p.type === 'n').length;
  const bishops = own.filter((p) => p.type === 'b');
  if (knights >= 2 || (knights >= 1 && bishops.length >= 1)) return true;
  if (knights === 1) return opp.some((p) => p.type === 'p' || p.type === 'n' || p.type === 'b' || p.type === 'r');
  const shades = new Set(bishops.map((b) => squareShade(b.square)));
  if (shades.size > 1) return true;
  const shade = [...shades][0];
  return opp.some((p) => p.type === 'n' || p.type === 'p' || (p.type === 'b' && squareShade(p.square) !== shade));
}

// ---------------------------------------------------------------------------
// Material balance
// ---------------------------------------------------------------------------

export interface MaterialBalance {
  /** Extra pieces each colour has over the other, by type (e.g. white up a knight → w.n = 1). */
  w: Partial<Record<PieceType, number>>;
  b: Partial<Record<PieceType, number>>;
  /** White points minus black points (P1 N3 B3 R5 Q9). */
  score: number;
}

export function materialBalance(fen: string): MaterialBalance {
  const placement = fen.split(' ')[0] ?? '';
  const count: Record<ChessColor, Record<PieceType, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  };
  for (const ch of placement) {
    const lower = ch.toLowerCase();
    if (!'pnbrqk'.includes(lower)) continue;
    count[ch === lower ? 'b' : 'w'][lower as PieceType]++;
  }
  const out: MaterialBalance = { w: {}, b: {}, score: 0 };
  for (const t of ['q', 'r', 'b', 'n', 'p'] as const) {
    const d = count.w[t] - count.b[t];
    if (d > 0) out.w[t] = d;
    if (d < 0) out.b[t] = -d;
    out.score += d * PIECE_VALUES[t];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Premoves (geometry only — the move is validated again when it is played)
// ---------------------------------------------------------------------------

const KNIGHT_STEPS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
] as const;
const KING_STEPS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const;
const ROOK_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const BISHOP_DIRS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * Squares the piece on `from` might be able to reach after the opponent's reply: pieces slide
 * through everything (the board will have changed), pawns may push or capture diagonally, the king
 * may castle when it still has the right. Own-piece squares are included (they may be captured first).
 */
export function premoveTargets(fen: string, from: string): ChessSquare[] {
  if (!isSquare(from)) return [];
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }
  const piece = chess.get(from);
  if (!piece) return [];
  const [f, r] = squareCoords(from);
  const out = new Set<ChessSquare>();
  const add = (df: number, dr: number) => {
    const sq = squareAt(f + df, r + dr);
    if (sq) out.add(sq);
  };
  const slide = (dirs: ReadonlyArray<readonly [number, number]>) => {
    for (const [df, dr] of dirs) for (let i = 1; i < 8; i++) add(df * i, dr * i);
  };
  switch (piece.type) {
    case 'p': {
      const dir = piece.color === 'w' ? 1 : -1;
      add(0, dir);
      if ((piece.color === 'w' && r === 1) || (piece.color === 'b' && r === 6)) add(0, 2 * dir);
      add(-1, dir);
      add(1, dir);
      break;
    }
    case 'n':
      for (const [df, dr] of KNIGHT_STEPS) add(df, dr);
      break;
    case 'b':
      slide(BISHOP_DIRS);
      break;
    case 'r':
      slide(ROOK_DIRS);
      break;
    case 'q':
      slide([...ROOK_DIRS, ...BISHOP_DIRS]);
      break;
    case 'k': {
      for (const [df, dr] of KING_STEPS) add(df, dr);
      const rights = chess.getCastlingRights(piece.color);
      const home = piece.color === 'w' ? 'e1' : 'e8';
      if (from === home) {
        const rank = piece.color === 'w' ? '1' : '8';
        if (rights.k) out.add(`g${rank}` as ChessSquare);
        if (rights.q) out.add(`c${rank}` as ChessSquare);
      }
      break;
    }
  }
  out.delete(from as ChessSquare);
  return [...out];
}

// ---------------------------------------------------------------------------
// PGN
// ---------------------------------------------------------------------------

export type PgnResult = '1-0' | '0-1' | '1/2-1/2' | '*';

export interface PgnInput {
  /** Tags in order. The Seven Tag Roster (Event, Site, Date, Round, White, Black, Result) is filled in when missing. */
  headers: Array<[string, string]>;
  sans: readonly string[];
  result: PgnResult;
  /** Remaining clock (ms) after each move, for [%clk] comments (omit for untimed games). */
  clocksMs?: ReadonlyArray<number | null>;
  /** FEN the game started from, when not the standard start. */
  startFen?: string;
}

function escapeTag(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n\t]+/g, ' ');
}

/** "0:04:59" (h:mm:ss, rounded down to whole seconds, per the %clk convention). */
export function pgnClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** PGN date "YYYY.MM.DD" (UTC). */
export function pgnDate(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Standard-conforming PGN: tag pairs, a blank line, movetext wrapped at 80 columns, result token. */
export function buildPgn(input: PgnInput): string {
  const roster: Array<[string, string]> = [
    ['Event', '?'],
    ['Site', '?'],
    ['Date', '????.??.??'],
    ['Round', '-'],
    ['White', '?'],
    ['Black', '?'],
    ['Result', input.result],
  ];
  const given = new Map(input.headers);
  const tags: Array<[string, string]> = roster.map(([k, v]) => [k, k === 'Result' ? input.result : (given.get(k) ?? v)]);
  for (const [k, v] of input.headers) if (!roster.some(([rk]) => rk === k) && /^[A-Za-z0-9_]+$/.test(k)) tags.push([k, v]);
  let firstColor: ChessColor = 'w';
  let firstNumber = 1;
  if (input.startFen && input.startFen !== START_FEN) {
    tags.push(['SetUp', '1'], ['FEN', input.startFen]);
    const parts = input.startFen.split(' ');
    firstColor = parts[1] === 'b' ? 'b' : 'w';
    firstNumber = Math.max(1, Number(parts[5] ?? 1) || 1);
  }
  const header = tags.map(([k, v]) => `[${k} "${escapeTag(v)}"]`).join('\n');

  const tokens: string[] = [];
  input.sans.forEach((san, i) => {
    const color: ChessColor = (i % 2 === 0) === (firstColor === 'w') ? 'w' : 'b';
    const moveNo = firstNumber + Math.floor((i + (firstColor === 'b' ? 1 : 0)) / 2);
    if (color === 'w') tokens.push(`${moveNo}.`);
    else if (i === 0) tokens.push(`${moveNo}...`);
    tokens.push(san);
    const clk = input.clocksMs?.[i];
    if (clk !== undefined && clk !== null) tokens.push(`{[%clk ${pgnClock(clk)}]}`);
  });
  tokens.push(input.result);

  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    if (line && line.length + 1 + token.length > 80) {
      lines.push(line);
      line = token;
    } else line = line ? `${line} ${token}` : token;
  }
  if (line) lines.push(line);
  return `${header}\n\n${lines.join('\n')}\n`;
}

/** 1-0 / 0-1 / 1/2-1/2 from a board result. */
export function pgnResultFor(winner: ChessColor | 'draw' | null | ''): PgnResult {
  if (winner === 'w') return '1-0';
  if (winner === 'b') return '0-1';
  if (winner === 'draw') return '1/2-1/2';
  return '*';
}

/** Parse a PGN's movetext back into SAN moves (used by tests and imports). Throws on invalid PGN. */
export function sansFromPgn(pgn: string): string[] {
  const chess = new Chess();
  chess.loadPgn(pgn);
  return chess.history();
}

// ---------------------------------------------------------------------------
// Game records (shared by the server's final PGN and the client's live "Copy PGN")
// ---------------------------------------------------------------------------

export interface GamePgnInfo {
  event: string;
  site: string;
  /** Game start (epoch ms). */
  startedAt: number;
  round: string;
  white: string;
  black: string;
  result: PgnResult;
  /** PGN TimeControl value ("300+2", "-" when untimed). */
  timeControl: string;
  /** Board result reason ('checkmate', 'timeout', 'abandoned'…), '' while in progress. */
  reason: string;
  moves: ReadonlyArray<{ san: string; clockMs?: number }>;
  /** Add [%clk] comments. */
  timed: boolean;
  startFen?: string;
}

/** PGN Termination tag value for a board result reason. */
export function pgnTermination(reason: string): string {
  if (!reason) return 'unterminated';
  if (reason === 'timeout' || reason === 'timeout_insufficient') return 'time forfeit';
  if (reason === 'abandoned' || reason === 'forfeit') return 'abandoned';
  return 'normal';
}

export function buildGamePgn(info: GamePgnInfo): string {
  const d = new Date(info.startedAt || Date.now());
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
  return buildPgn({
    headers: [
      ['Event', info.event],
      ['Site', info.site],
      ['Date', pgnDate(d.getTime())],
      ['Round', info.round],
      ['White', info.white],
      ['Black', info.black],
      ['UTCDate', pgnDate(d.getTime())],
      ['UTCTime', time],
      ['TimeControl', info.timeControl],
      ['Termination', pgnTermination(info.reason)],
    ],
    sans: info.moves.map((m) => m.san),
    clocksMs: info.timed ? info.moves.map((m) => m.clockMs ?? null) : undefined,
    result: info.result,
    startFen: info.startFen,
  });
}
