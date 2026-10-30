/**
 * DAS Chess — a game record on the variant engine (./variantRules.ts) behind the same API as the
 * chess.js-backed Standard game: legal moves with SAN, move/undo, repetition counts, game-end status,
 * "can this side still win" for timeouts, Crazyhouse pockets and Three-Check counts.
 *
 * Endings, in order: the variant's own goal (hill, third check, race, explosion, Antichess no
 * pieces/no moves, Horde wiped out) → checkmate → stalemate → insufficient material → threefold
 * repetition → fifty-move rule. Like Standard, the draws are automatic.
 */
import type { ChessVariant } from '@dascade/shared/games/chess';
import type {
  ChessColor,
  ChessEnd,
  ChessGameApi,
  ChessMoveRecord,
  ChessPocket,
  ChessSquare,
  DropPiece,
  LegalMove,
  MaterialBalance,
  MoveInput,
  PieceType,
  PromotionChoice,
} from './index.ts';
import {
  castleTargets,
  inCheck,
  isCapture,
  isCastle,
  isLightSquare,
  legalMoves,
  makeFen,
  moveUci,
  outcome,
  parseFen,
  parseSquare,
  play,
  repetitionKey,
  rulesFor,
  sanWithoutSuffix,
  squareName,
  variantStartFen,
  kingOf,
  type VMove,
  type VPiece,
  type VPosition,
  type VRules,
} from './variantRules.ts';

const PROMOTIONS: readonly PromotionChoice[] = ['q', 'r', 'b', 'n'];
const ANTI_PROMOTIONS: readonly PromotionChoice[] = ['q', 'r', 'b', 'n', 'k'];
const VALUES: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** King of the Hill's centre squares. */
export const HILL: readonly ChessSquare[] = ['d4', 'e4', 'd5', 'e5'];

interface Entry {
  pos: VPosition;
  key: string;
  fen: string;
}

export class VariantChessGame implements ChessGameApi {
  readonly variant: ChessVariant;
  readonly startFen: string;
  private readonly rules: VRules;
  private readonly entries: Entry[];
  private readonly records: ChessMoveRecord[] = [];
  private readonly counts = new Map<string, number>();
  private legalCache: { ply: number; moves: VMove[] } | null = null;
  private statusCache: { ply: number; end: ChessEnd | null } | null = null;

  constructor(variant: ChessVariant, fen?: string) {
    this.variant = variant;
    this.rules = rulesFor(variant);
    const pos = parseFen(this.rules, fen ?? variantStartFen(variant));
    if (!pos) throw new Error(`Invalid ${variant} FEN: ${fen ?? ''}`);
    const entry = this.entryFor(pos);
    this.entries = [entry];
    this.startFen = entry.fen;
    this.bump(entry.key, 1);
  }

  get fen(): string {
    return this.current.fen;
  }

  get turn(): ChessColor {
    return this.current.pos.turn;
  }

  get history(): readonly ChessMoveRecord[] {
    return this.records;
  }

  get ply(): number {
    return this.records.length;
  }

  /** The engine position (for tests and tools). */
  get position(): VPosition {
    return this.current.pos;
  }

  inCheck(): boolean {
    return inCheck(this.rules, this.current.pos);
  }

  kingSquare(color: ChessColor = this.turn): ChessSquare | null {
    const sq = kingOf(this.current.pos.board, color);
    return sq < 0 ? null : (squareName(sq) as ChessSquare);
  }

  piece(square: string): { type: PieceType; color: ChessColor } | null {
    const sq = parseSquare(square);
    const p = sq < 0 ? null : this.current.pos.board[sq];
    return p ? { type: p.role, color: p.color } : null;
  }

  legalMoves(from?: string): LegalMove[] {
    const pos = this.current.pos;
    const all = this.legal();
    const origin = from === undefined ? null : parseSquare(from);
    if (origin !== null && origin < 0) return [];
    const out: LegalMove[] = [];
    for (const m of all) {
      if (m.from < 0) continue;
      if (origin !== null && m.from !== origin) continue;
      const castle = isCastle(pos, m);
      const side = castle ? castleTargets(m.from, m.to).side : '';
      out.push({
        from: squareName(m.from) as ChessSquare,
        to: squareName(castle ? this.castleShownTo(m) : m.to) as ChessSquare,
        san: this.sanFor(m, all),
        capture: isCapture(pos, m),
        promotion: (m.promotion as PromotionChoice | undefined) ?? '',
        castle: side,
      });
    }
    return out;
  }

  legalTargets(from: string): ChessSquare[] {
    return [...new Set(this.legalMoves(from).map((m) => m.to))];
  }

  isPromotion(from: string, to: string): boolean {
    const f = parseSquare(from);
    const t = parseSquare(to);
    return this.legal().some((m) => m.from === f && m.to === t && Boolean(m.promotion));
  }

  promotionChoices(): readonly PromotionChoice[] {
    return this.rules.anti ? ANTI_PROMOTIONS : PROMOTIONS;
  }

  isLegal(input: MoveInput): boolean {
    return this.resolve(input) !== null;
  }

  move(input: MoveInput): ChessMoveRecord | null {
    const m = this.resolve(input);
    if (!m) return null;
    const pos = this.current.pos;
    const all = this.legal();
    const san = this.sanFor(m, all);
    const info = play(this.rules, pos, m);
    const entry = this.entryFor(info.pos);
    const castle = isCastle(pos, m) ? castleTargets(m.from, m.to) : null;
    const piece = m.drop ? m.drop : pos.board[m.from]!.role;
    const record: ChessMoveRecord = {
      san,
      uci: moveUci(this.rules, pos, m),
      from: squareName(m.drop ? m.to : m.from) as ChessSquare,
      to: squareName(castle ? castle.kingTo : m.to) as ChessSquare,
      color: pos.turn,
      piece,
      captured: info.captured ? info.captured.role : '',
      promotion: (m.promotion as PromotionChoice | undefined) ?? '',
      castle: castle ? castle.side : '',
      enPassant: info.enPassant,
      check: san.endsWith('+') || san.endsWith('#'),
      mate: san.endsWith('#'),
      fenAfter: entry.fen,
      ...(m.drop ? { drop: m.drop } : {}),
      ...(info.exploded.length ? { exploded: info.exploded.map((s) => squareName(s) as ChessSquare) } : {}),
      ...(castle ? { rook: [squareName(m.to) as ChessSquare, squareName(castle.rookTo) as ChessSquare] } : {}),
    };
    this.entries.push(entry);
    this.records.push(record);
    this.bump(entry.key, 1);
    return record;
  }

  undo(): ChessMoveRecord | null {
    if (this.records.length === 0) return null;
    const entry = this.entries.pop()!;
    this.bump(entry.key, -1);
    return this.records.pop() ?? null;
  }

  repetitionCount(): number {
    return this.counts.get(this.current.key) ?? 0;
  }

  halfmoveClock(): number {
    return this.current.pos.halfmoves;
  }

  status(): ChessEnd | null {
    if (this.statusCache?.ply === this.ply) return this.statusCache.end;
    const end = this.computeStatus();
    this.statusCache = { ply: this.ply, end };
    return end;
  }

  canMate(color: ChessColor): boolean {
    const board = this.current.pos.board;
    const own: Array<{ sq: number; p: VPiece }> = [];
    const opp: Array<{ sq: number; p: VPiece }> = [];
    board.forEach((p, sq) => {
      if (p && p.role !== 'k') (p.color === color ? own : opp).push({ sq, p });
    });
    switch (this.variant) {
      case 'chess960':
        return matingMaterial(own, opp);
      case 'threecheck':
      case 'atomic':
        // A lone king can never give check (or set off an explosion).
        return own.length > 0;
      case 'horde':
        return color === 'w' ? own.length > 0 || kingOf(board, 'w') >= 0 : true;
      default:
        // King of the Hill (the king can walk to the centre), Racing Kings, Antichess, Crazyhouse.
        return true;
    }
  }

  material(): MaterialBalance {
    const count: Record<ChessColor, Record<PieceType, number>> = {
      w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
      b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    };
    for (const p of this.current.pos.board) if (p) count[p.color][p.role]++;
    const out: MaterialBalance = { w: {}, b: {}, score: 0 };
    for (const t of ['q', 'r', 'b', 'n', 'p'] as const) {
      const d = count.w[t] - count.b[t];
      if (d > 0) out.w[t] = d;
      if (d < 0) out.b[t] = -d;
      out.score += d * VALUES[t];
    }
    return out;
  }

  pocket(color: ChessColor): ChessPocket {
    const pockets = this.current.pos.pockets;
    return pockets ? { ...pockets[color] } : { p: 0, n: 0, b: 0, r: 0, q: 0 };
  }

  dropTargets(piece: DropPiece): ChessSquare[] {
    return this.legal()
      .filter((m) => m.drop === piece)
      .map((m) => squareName(m.to) as ChessSquare);
  }

  checksGiven(color: ChessColor): number {
    return this.current.pos.checks?.[color] ?? 0;
  }

  mustCapture(): boolean {
    if (!this.rules.anti) return false;
    const pos = this.current.pos;
    const moves = this.legal();
    return moves.length > 0 && moves.every((m) => isCapture(pos, m));
  }

  // ---------------------------------------------------------------------------

  private get current(): Entry {
    return this.entries[this.entries.length - 1]!;
  }

  private entryFor(pos: VPosition): Entry {
    const fen = makeFen(this.rules, pos);
    return { pos, fen, key: repetitionKey(this.rules, pos) };
  }

  private legal(): VMove[] {
    if (this.legalCache?.ply === this.ply) return this.legalCache.moves;
    const moves = legalMoves(this.rules, this.current.pos);
    this.legalCache = { ply: this.ply, moves };
    return moves;
  }

  /** The square a castling move shows as its target: the rook in Chess960, the king's landing square elsewhere. */
  private castleShownTo(m: VMove): number {
    return this.variant === 'chess960' ? m.to : castleTargets(m.from, m.to).kingTo;
  }

  private sanFor(m: VMove, all: readonly VMove[]): string {
    const pos = this.current.pos;
    const base = sanWithoutSuffix(pos, m, all);
    const next = play(this.rules, pos, m).pos;
    const end = outcome(this.rules, next);
    if (end?.winner) return `${base}#`;
    return inCheck(this.rules, next) ? `${base}+` : base;
  }

  /**
   * The legal move an input means: a drop; from → to (with the promotion piece when, and only when,
   * it promotes); castling as king → rook, or king → its landing square when that is two or more
   * files away (never ambiguous with a king step).
   */
  private resolve(input: MoveInput): VMove | null {
    const all = this.legal();
    const to = parseSquare(input.to);
    if (to < 0) return null;
    if (input.drop !== undefined) {
      if (input.from !== undefined || input.promotion) return null;
      return all.find((m) => m.drop === input.drop && m.to === to) ?? null;
    }
    const from = parseSquare(input.from);
    if (from < 0) return null;
    const pos = this.current.pos;
    const candidates = all.filter((m) => {
      if (m.from !== from) return false;
      if (isCastle(pos, m)) {
        if (m.to === to) return true;
        const kingTo = castleTargets(m.from, m.to).kingTo;
        return kingTo === to && Math.abs((kingTo & 7) - (from & 7)) >= 2;
      }
      return m.to === to;
    });
    if (candidates.length === 0) return null;
    const promo = input.promotion ? input.promotion.toLowerCase() : '';
    const promotes = candidates.some((m) => m.promotion);
    if (promotes !== Boolean(promo)) return null;
    if (!promo) return candidates[0]!;
    return candidates.find((m) => m.promotion === promo) ?? null;
  }

  private computeStatus(): ChessEnd | null {
    const end = outcome(this.rules, this.current.pos, this.legal());
    if (end) return { winner: end.winner, reason: end.reason };
    if (this.repetitionCount() >= 3) return { winner: null, reason: 'repetition' };
    if (this.halfmoveClock() >= 100) return { winner: null, reason: 'fifty_moves' };
    return null;
  }

  private bump(key: string, delta: number): void {
    const next = (this.counts.get(key) ?? 0) + delta;
    if (next <= 0) this.counts.delete(key);
    else this.counts.set(key, next);
  }
}

/** Same rules as Standard's "insufficient material to win on time" (see hasMatingMaterial). */
function matingMaterial(own: ReadonlyArray<{ sq: number; p: VPiece }>, opp: ReadonlyArray<{ sq: number; p: VPiece }>): boolean {
  if (own.length === 0) return false;
  if (own.some((x) => x.p.role === 'p' || x.p.role === 'r' || x.p.role === 'q')) return true;
  const knights = own.filter((x) => x.p.role === 'n').length;
  const bishops = own.filter((x) => x.p.role === 'b');
  if (knights >= 2 || (knights >= 1 && bishops.length >= 1)) return true;
  if (knights === 1) return opp.some((x) => x.p.role === 'p' || x.p.role === 'n' || x.p.role === 'b' || x.p.role === 'r');
  const shades = new Set(bishops.map((x) => isLightSquare(x.sq)));
  if (shades.size > 1) return true;
  const shade = [...shades][0];
  return opp.some((x) => x.p.role === 'n' || x.p.role === 'p' || (x.p.role === 'b' && isLightSquare(x.sq) !== shade));
}

/** Parses a UCI move (e2e4, e7e8q, N@f3) into a move input. */
export function moveInputFromUci(uci: string): MoveInput | null {
  const drop = uci.match(/^([PNBRQ])@([a-h][1-8])$/);
  if (drop) return { to: drop[2]!, drop: drop[1]!.toLowerCase() };
  const m = uci.match(/^([a-h][1-8])([a-h][1-8])([qrbnk])?$/);
  if (!m) return null;
  return m[3] ? { from: m[1]!, to: m[2]!, promotion: m[3] } : { from: m[1]!, to: m[2]! };
}
