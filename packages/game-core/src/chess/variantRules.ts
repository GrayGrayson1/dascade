/**
 * DAS Chess variant rules — a small, pure, deterministic chess move generator for the lichess
 * variants that chess.js can't play: Chess960 castling, King of the Hill, Three-Check, Antichess,
 * Atomic, Horde, Racing Kings and Crazyhouse ('standard' rules are here too, so the generator can be
 * checked move for move against chess.js; real Standard games still run on chess.js).
 *
 * Squares are 0–63, a1 = 0, b1 = 1 … h8 = 63. Positions are immutable: `play` returns a new one.
 * Castling is encoded internally as "king takes own rook" (from = king, to = rook), so Chess960 needs
 * no special cases. Rules follow lichess (scalachess/chessops) — see docs/CHESS_VARIANTS.md.
 */
import type { ChessVariant } from '@dascade/shared/games/chess';

export type VColor = 'w' | 'b';
export type VRole = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PocketRole = 'p' | 'n' | 'b' | 'r' | 'q';
/** Pocket pieces in display order. */
export const POCKET_ROLES: readonly PocketRole[] = ['q', 'r', 'b', 'n', 'p'];

export interface VPiece {
  readonly color: VColor;
  readonly role: VRole;
  /** Crazyhouse: a promoted piece goes back to the pocket as a pawn. */
  readonly promoted?: boolean;
}

export type Pocket = Record<PocketRole, number>;

export interface VPosition {
  readonly board: ReadonlyArray<VPiece | null>;
  readonly turn: VColor;
  /** Squares of the rooks that may still castle (white ones on rank 1, black ones on rank 8). */
  readonly castling: readonly number[];
  /** En-passant target square after a double pawn step (−1 when none); only legal captures show in FENs. */
  readonly ep: number;
  readonly halfmoves: number;
  readonly fullmoves: number;
  /** Crazyhouse pockets (null in other variants). */
  readonly pockets: { readonly w: Pocket; readonly b: Pocket } | null;
  /** Three-Check: checks given by each side (null in other variants). */
  readonly checks: { readonly w: number; readonly b: number } | null;
}

export interface VMove {
  /** Origin square (−1 for a drop). Castling: the king's square. */
  from: number;
  /** Destination. Castling: the square of the rook the king castles with. */
  to: number;
  promotion?: VRole;
  drop?: PocketRole;
}

export interface VRules {
  variant: ChessVariant;
  castling: boolean;
  /** Antichess: no check, captures are compulsory, pawns may promote to a king. */
  anti: boolean;
  /** Atomic: captures explode, kings can't capture. */
  atomic: boolean;
  /** Racing Kings: moves that give check are illegal. */
  noGivingCheck: boolean;
  /** Crazyhouse pockets and drops. */
  drops: boolean;
  /** Three-Check: checks needed to win (0 = not counted). */
  checksToWin: number;
  hill: boolean;
  race: boolean;
  horde: boolean;
}

export function rulesFor(variant: ChessVariant): VRules {
  return {
    variant,
    castling: variant !== 'antichess' && variant !== 'racingkings',
    anti: variant === 'antichess',
    atomic: variant === 'atomic',
    noGivingCheck: variant === 'racingkings',
    drops: variant === 'crazyhouse',
    checksToWin: variant === 'threecheck' ? 3 : 0,
    hill: variant === 'kingofthehill',
    race: variant === 'racingkings',
    horde: variant === 'horde',
  };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export const FILE_CHARS = 'abcdefgh';

export function squareName(sq: number): string {
  return `${FILE_CHARS[sq & 7]}${(sq >> 3) + 1}`;
}

export function parseSquare(name: string | undefined): number {
  if (typeof name !== 'string' || !/^[a-h][1-8]$/.test(name)) return -1;
  return name.charCodeAt(0) - 97 + 8 * (name.charCodeAt(1) - 49);
}

export function other(color: VColor): VColor {
  return color === 'w' ? 'b' : 'w';
}

type Delta = readonly [number, number];
const KNIGHT_D: readonly Delta[] = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
const KING_D: readonly Delta[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
const ROOK_D: readonly Delta[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const BISHOP_D: readonly Delta[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function stepTable(deltas: readonly Delta[]): number[][] {
  const out: number[][] = [];
  for (let sq = 0; sq < 64; sq++) {
    const f = sq & 7;
    const r = sq >> 3;
    const list: number[] = [];
    for (const [df, dr] of deltas) {
      const nf = f + df;
      const nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) list.push(nr * 8 + nf);
    }
    out.push(list);
  }
  return out;
}

function rayTable(deltas: readonly Delta[]): number[][][] {
  const out: number[][][] = [];
  for (let sq = 0; sq < 64; sq++) {
    const rays: number[][] = [];
    for (const [df, dr] of deltas) {
      const ray: number[] = [];
      let f = (sq & 7) + df;
      let r = (sq >> 3) + dr;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        ray.push(r * 8 + f);
        f += df;
        r += dr;
      }
      if (ray.length) rays.push(ray);
    }
    out.push(rays);
  }
  return out;
}

const KNIGHT = stepTable(KNIGHT_D);
/** The eight neighbours of each square (king steps, explosion radius). */
export const NEIGHBOURS = stepTable(KING_D);
const ROOK_RAYS = rayTable(ROOK_D);
const BISHOP_RAYS = rayTable(BISHOP_D);

/** King of the Hill: d4, e4, d5, e5. */
export const HILL_SQUARES: readonly number[] = [27, 28, 35, 36];

export function adjacent(a: number, b: number): boolean {
  return a !== b && Math.abs((a & 7) - (b & 7)) <= 1 && Math.abs((a >> 3) - (b >> 3)) <= 1;
}

/** Light or dark square (a1 is dark). */
export function isLightSquare(sq: number): boolean {
  return ((sq & 7) + (sq >> 3)) % 2 === 1;
}

// ---------------------------------------------------------------------------
// Attacks and check
// ---------------------------------------------------------------------------

/** Is `target` attacked by a piece of colour `by`? `kings`: count the enemy king's attacks too. */
export function isAttacked(board: ReadonlyArray<VPiece | null>, target: number, by: VColor, kings = true): boolean {
  const f = target & 7;
  const r = target >> 3;
  const pr = by === 'w' ? r - 1 : r + 1;
  if (pr >= 0 && pr < 8) {
    for (const pf of [f - 1, f + 1]) {
      if (pf < 0 || pf > 7) continue;
      const p = board[pr * 8 + pf];
      if (p && p.color === by && p.role === 'p') return true;
    }
  }
  for (const s of KNIGHT[target]!) {
    const p = board[s];
    if (p && p.color === by && p.role === 'n') return true;
  }
  if (kings) {
    for (const s of NEIGHBOURS[target]!) {
      const p = board[s];
      if (p && p.color === by && p.role === 'k') return true;
    }
  }
  for (const ray of ROOK_RAYS[target]!) {
    for (const s of ray) {
      const p = board[s];
      if (!p) continue;
      if (p.color === by && (p.role === 'r' || p.role === 'q')) return true;
      break;
    }
  }
  for (const ray of BISHOP_RAYS[target]!) {
    for (const s of ray) {
      const p = board[s];
      if (!p) continue;
      if (p.color === by && (p.role === 'b' || p.role === 'q')) return true;
      break;
    }
  }
  return false;
}

/** Square of a king of `color` (the first one; −1 when there is none). */
export function kingOf(board: ReadonlyArray<VPiece | null>, color: VColor): number {
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (p && p.color === color && p.role === 'k') return sq;
  }
  return -1;
}

/**
 * Would a king of `color` standing on `sq` be attacked? Atomic: kings don't attack, and a king
 * touching the enemy king can't be attacked at all (capturing it would blow up the capturer's king).
 */
function kingSquareAttacked(rules: VRules, board: ReadonlyArray<VPiece | null>, sq: number, color: VColor): boolean {
  const them = other(color);
  if (rules.atomic) {
    const theirs = kingOf(board, them);
    if (theirs >= 0 && adjacent(theirs, sq)) return false;
    return isAttacked(board, sq, them, false);
  }
  return isAttacked(board, sq, them, true);
}

/** Is the side to move in check? (Never in Antichess; never for Horde's kingless White.) */
export function inCheck(rules: VRules, pos: VPosition, color: VColor = pos.turn): boolean {
  if (rules.anti) return false;
  const king = kingOf(pos.board, color);
  if (king < 0) return false;
  if (rules.atomic && kingOf(pos.board, other(color)) < 0) return false;
  return kingSquareAttacked(rules, pos.board, king, color);
}

// ---------------------------------------------------------------------------
// Move generation
// ---------------------------------------------------------------------------

const PROMOTIONS: readonly VRole[] = ['q', 'r', 'b', 'n'];
const ANTI_PROMOTIONS: readonly VRole[] = ['q', 'r', 'b', 'n', 'k'];

export function isCastle(pos: VPosition, move: VMove): boolean {
  if (move.from < 0) return false;
  const piece = pos.board[move.from];
  const target = pos.board[move.to];
  return Boolean(piece && piece.role === 'k' && target && target.color === piece.color && target.role === 'r');
}

export function isCapture(pos: VPosition, move: VMove): boolean {
  if (move.from < 0) return false;
  const piece = pos.board[move.from];
  const target = pos.board[move.to];
  if (target) return target.color !== piece?.color;
  return piece?.role === 'p' && move.to === pos.ep && (move.to & 7) !== (move.from & 7);
}

/** Where the king and rook end after castling with the rook on `rook`. */
export function castleTargets(king: number, rook: number): { kingTo: number; rookTo: number; side: 'k' | 'q' } {
  const back = king & ~7;
  const kingside = (rook & 7) > (king & 7);
  return { kingTo: back + (kingside ? 6 : 2), rookTo: back + (kingside ? 5 : 3), side: kingside ? 'k' : 'q' };
}

function epCapturable(pos: VPosition, color: VColor): boolean {
  if (pos.ep < 0) return false;
  const victim = pos.ep + (color === 'w' ? -8 : 8);
  const p = pos.board[victim];
  return Boolean(p && p.role === 'p' && p.color !== color && !pos.board[pos.ep]);
}

function pseudoMoves(rules: VRules, pos: VPosition): VMove[] {
  const out: VMove[] = [];
  const us = pos.turn;
  const board = pos.board;
  const promos = rules.anti ? ANTI_PROMOTIONS : PROMOTIONS;
  const epOk = epCapturable(pos, us);
  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (!piece || piece.color !== us) continue;
    switch (piece.role) {
      case 'p': {
        const dir = us === 'w' ? 8 : -8;
        const last = us === 'w' ? 7 : 0;
        const one = from + dir;
        if (one < 0 || one > 63) break;
        const add = (to: number) => {
          if (to >> 3 === last) for (const role of promos) out.push({ from, to, promotion: role });
          else out.push({ from, to });
        };
        if (!board[one]) {
          add(one);
          // Pawns on their first two ranks may step twice (Horde: white pawns on the first rank too).
          const canDouble = us === 'w' ? from < 16 : from >= 48;
          const two = one + dir;
          if (canDouble && two >= 0 && two < 64 && !board[two]) out.push({ from, to: two });
        }
        const f = from & 7;
        for (const df of [-1, 1]) {
          if (f + df < 0 || f + df > 7) continue;
          const to = one + df;
          const target = board[to];
          if (target && target.color !== us) add(to);
          else if (!target && epOk && to === pos.ep) out.push({ from, to });
        }
        break;
      }
      case 'n':
        for (const to of KNIGHT[from]!) {
          const t = board[to];
          if (!t || t.color !== us) out.push({ from, to });
        }
        break;
      case 'k':
        for (const to of NEIGHBOURS[from]!) {
          const t = board[to];
          // Atomic kings never capture (the explosion would take them too).
          if (!t || (t.color !== us && !rules.atomic)) out.push({ from, to });
        }
        break;
      default: {
        const rays =
          piece.role === 'r' ? ROOK_RAYS[from]! : piece.role === 'b' ? BISHOP_RAYS[from]! : [...ROOK_RAYS[from]!, ...BISHOP_RAYS[from]!];
        for (const ray of rays) {
          for (const to of ray) {
            const t = board[to];
            if (!t) out.push({ from, to });
            else {
              if (t.color !== us) out.push({ from, to });
              break;
            }
          }
        }
      }
    }
  }
  if (rules.castling && pos.castling.length) castlingMoves(rules, pos, out);
  if (rules.drops && pos.pockets) {
    const pocket = pos.pockets[us];
    for (const role of POCKET_ROLES) {
      if (pocket[role] <= 0) continue;
      for (let to = 0; to < 64; to++) {
        if (board[to]) continue;
        if (role === 'p' && (to < 8 || to > 55)) continue;
        out.push({ from: -1, to, drop: role });
      }
    }
  }
  return out;
}

function castlingMoves(rules: VRules, pos: VPosition, out: VMove[]): void {
  const us = pos.turn;
  const back = us === 'w' ? 0 : 7;
  const king = kingOf(pos.board, us);
  if (king < 0 || king >> 3 !== back) return;
  if (inCheck(rules, pos)) return;
  for (const rook of pos.castling) {
    if (rook >> 3 !== back) continue;
    const r = pos.board[rook];
    if (!r || r.color !== us || r.role !== 'r') continue;
    const { kingTo, rookTo } = castleTargets(king, rook);
    // Every square the king and rook cross or land on must be empty (apart from the two of them).
    const lo = Math.min(king, rook, kingTo, rookTo);
    const hi = Math.max(king, rook, kingTo, rookTo);
    let clear = true;
    for (let s = lo; s <= hi && clear; s++) if (s !== king && s !== rook && pos.board[s]) clear = false;
    if (!clear) continue;
    // The king may not pass through an attacked square (its landing square is checked by legality).
    const without = pos.board.slice();
    without[king] = null;
    const step = kingTo > king ? 1 : -1;
    let safe = true;
    for (let s = king; s !== kingTo && safe; s += step) if (s !== king && kingSquareAttacked(rules, without, s, us)) safe = false;
    if (safe) out.push({ from: king, to: rook });
  }
}

/** The position after a pseudo-legal move (not validated). */
export interface PlayInfo {
  pos: VPosition;
  captured: VPiece | null;
  /** Atomic: squares emptied by the explosion (capture square first). */
  exploded: number[];
  castle: '' | 'k' | 'q';
  enPassant: boolean;
}

export function play(rules: VRules, pos: VPosition, move: VMove): PlayInfo {
  const board = pos.board.slice();
  const us = pos.turn;
  const backOf = (c: VColor) => (c === 'w' ? 0 : 7);
  let castling = pos.castling.slice();
  const pockets = pos.pockets ? { w: { ...pos.pockets.w }, b: { ...pos.pockets.b } } : null;
  let halfmoves = pos.halfmoves + 1;
  let ep = -1;
  let captured: VPiece | null = null;
  const exploded: number[] = [];
  let castle: '' | 'k' | 'q' = '';
  let enPassant = false;

  if (move.drop) {
    board[move.to] = { color: us, role: move.drop };
    if (pockets) pockets[us][move.drop]--;
    if (move.drop === 'p') halfmoves = 0;
  } else {
    const piece = board[move.from]!;
    const target = board[move.to];
    if (piece.role === 'k' && target && target.color === us && target.role === 'r') {
      const t = castleTargets(move.from, move.to);
      board[move.from] = null;
      board[move.to] = null;
      board[t.kingTo] = piece;
      board[t.rookTo] = target;
      castle = t.side;
      castling = castling.filter((r) => r >> 3 !== backOf(us));
    } else {
      board[move.from] = null;
      if (piece.role === 'p' && !target && move.to === pos.ep && (move.to & 7) !== (move.from & 7)) {
        const victim = move.to + (us === 'w' ? -8 : 8);
        captured = board[victim] ?? null;
        board[victim] = null;
        enPassant = true;
      } else captured = target ?? null;
      board[move.to] = move.promotion ? { color: us, role: move.promotion, ...(rules.drops ? { promoted: true } : {}) } : piece;
      if (piece.role === 'p') {
        halfmoves = 0;
        // Double steps from the second rank allow en passant (Horde's first-rank double steps don't).
        if (Math.abs(move.to - move.from) === 16 && move.from >= 8 && move.from <= 55) ep = (move.from + move.to) >> 1;
      }
      if (piece.role === 'k') castling = castling.filter((r) => r >> 3 !== backOf(us));
      if (captured) {
        halfmoves = 0;
        if (pockets) {
          const role: VRole = captured.promoted ? 'p' : captured.role;
          if (role !== 'k') pockets[us][role]++;
        }
        if (rules.atomic) {
          board[move.to] = null;
          exploded.push(move.to);
          for (const s of NEIGHBOURS[move.to]!) {
            const p = board[s];
            if (p && p.role !== 'p') {
              board[s] = null;
              exploded.push(s);
            }
          }
        }
      }
      castling = castling.filter((r) => r !== move.from && r !== move.to && !exploded.includes(r));
      if (exploded.length) {
        for (const c of ['w', 'b'] as const) if (kingOf(board, c) < 0) castling = castling.filter((r) => r >> 3 !== backOf(c));
      }
    }
  }

  let next: VPosition = {
    board,
    turn: other(us),
    castling,
    ep,
    halfmoves,
    fullmoves: pos.fullmoves + (us === 'b' ? 1 : 0),
    pockets,
    checks: pos.checks,
  };
  if (rules.checksToWin && pos.checks && inCheck(rules, next)) {
    next = { ...next, checks: { ...pos.checks, [us]: pos.checks[us] + 1 } };
  }
  return { pos: next, captured, exploded, castle, enPassant };
}

/** May the mover leave the board like this? */
function legalAfter(rules: VRules, after: VPosition, mover: VColor): boolean {
  if (rules.anti) return true;
  const them = other(mover);
  const own = kingOf(after.board, mover);
  if (rules.atomic) {
    if (own < 0) return false;
    const theirs = kingOf(after.board, them);
    if (theirs < 0) return true;
    if (adjacent(own, theirs)) return true;
    return !isAttacked(after.board, own, them, false);
  }
  if (own >= 0 && isAttacked(after.board, own, them, true)) return false;
  if (rules.noGivingCheck) {
    const theirs = kingOf(after.board, them);
    if (theirs >= 0 && isAttacked(after.board, theirs, mover, true)) return false;
  }
  return true;
}

/** Every legal move for the side to move. */
export function legalMoves(rules: VRules, pos: VPosition): VMove[] {
  const legal = pseudoMoves(rules, pos).filter((m) => legalAfter(rules, play(rules, pos, m).pos, pos.turn));
  if (rules.anti) {
    const captures = legal.filter((m) => isCapture(pos, m));
    if (captures.length) return captures;
  }
  return legal;
}

/** Does the side to move have any legal move? (Cheaper than generating them all.) */
export function hasLegalMove(rules: VRules, pos: VPosition): boolean {
  for (const m of pseudoMoves(rules, pos)) if (legalAfter(rules, play(rules, pos, m).pos, pos.turn)) return true;
  return false;
}

/** Leaf count of the move tree to `depth` (move-generator self-test). */
export function perft(rules: VRules, pos: VPosition, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(rules, pos);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(rules, play(rules, pos, m).pos, depth - 1);
  return n;
}

// ---------------------------------------------------------------------------
// Game end
// ---------------------------------------------------------------------------

export type VEndReason =
  'checkmate' | 'stalemate' | 'insufficient' | 'hill' | 'three_checks' | 'race' | 'explosion' | 'no_pieces' | 'no_moves' | 'horde_captured';

export interface VOutcome {
  /** null = draw. */
  winner: VColor | null;
  reason: VEndReason;
}

function pieceCount(board: ReadonlyArray<VPiece | null>, color: VColor): number {
  let n = 0;
  for (const p of board) if (p && p.color === color) n++;
  return n;
}

/**
 * Endings decided by the variant's own goal (hill, checks, race, explosion, …), checked before mate.
 * `legal` lazily provides the legal moves of `pos` (Racing Kings' last-chance rule needs them).
 */
export function variantEnd(rules: VRules, pos: VPosition, legal: () => readonly VMove[]): VOutcome | null {
  const board = pos.board;
  if (rules.atomic) {
    if (kingOf(board, 'w') < 0) return { winner: 'b', reason: 'explosion' };
    if (kingOf(board, 'b') < 0) return { winner: 'w', reason: 'explosion' };
  }
  if (rules.hill) {
    for (const sq of HILL_SQUARES) {
      const p = board[sq];
      if (p && p.role === 'k') return { winner: p.color, reason: 'hill' };
    }
  }
  if (rules.checksToWin && pos.checks) {
    if (pos.checks.w >= rules.checksToWin) return { winner: 'w', reason: 'three_checks' };
    if (pos.checks.b >= rules.checksToWin) return { winner: 'b', reason: 'three_checks' };
  }
  if (rules.race) {
    const w = kingOf(board, 'w');
    const b = kingOf(board, 'b');
    const wIn = w >= 0 && w >> 3 === 7;
    const bIn = b >= 0 && b >> 3 === 7;
    if (wIn && bIn) return { winner: null, reason: 'race' };
    if (bIn) return { winner: 'b', reason: 'race' };
    if (wIn) {
      // Black gets one more move: if its king can reach the 8th rank too, play on (for the draw).
      if (pos.turn === 'b' && legal().some((m) => m.from === b && m.to >> 3 === 7)) return null;
      return { winner: 'w', reason: 'race' };
    }
  }
  if (rules.anti && pieceCount(board, pos.turn) === 0) return { winner: pos.turn, reason: 'no_pieces' };
  if (rules.horde && pieceCount(board, 'w') === 0) return { winner: 'b', reason: 'horde_captured' };
  return null;
}

/** Draw by insufficient material (per variant; lichess conventions, simplified where noted). */
export function insufficientMaterial(rules: VRules, pos: VPosition): boolean {
  const pieces: Array<{ sq: number; p: VPiece }> = [];
  pos.board.forEach((p, sq) => {
    if (p) pieces.push({ sq, p });
  });
  switch (rules.variant) {
    case 'standard':
    case 'chess960': {
      // Same as chess.js: K v K, K+minor v K, or kings + bishops all on one square colour.
      if (pieces.length === 2) return true;
      const bishops = pieces.filter((x) => x.p.role === 'b');
      const knights = pieces.filter((x) => x.p.role === 'n');
      if (pieces.length === 3 && (bishops.length === 1 || knights.length === 1)) return true;
      if (pieces.length === bishops.length + 2) {
        const light = bishops.filter((x) => isLightSquare(x.sq)).length;
        return light === 0 || light === bishops.length;
      }
      return false;
    }
    case 'threecheck':
    case 'atomic':
      // Neither side has anything but its king: no check (or explosion) can ever happen.
      return pieces.every((x) => x.p.role === 'k');
    case 'antichess': {
      // Only bishops, each side's on the other colour from the opponent's: they can never meet.
      if (!pieces.length || !pieces.every((x) => x.p.role === 'b')) return false;
      const shades = (c: VColor) => new Set(pieces.filter((x) => x.p.color === c).map((x) => isLightSquare(x.sq)));
      const w = shades('w');
      const b = shades('b');
      if (!w.size || !b.size) return false;
      return [...w].every((s) => !b.has(s));
    }
    default:
      return false;
  }
}

/** Every board-decided ending except repetition and the fifty-move rule (the game record adds those). */
export function outcome(rules: VRules, pos: VPosition, knownLegal?: readonly VMove[]): VOutcome | null {
  const memo: { moves: readonly VMove[] | null } = { moves: knownLegal ?? null };
  const legal = () => (memo.moves ??= legalMoves(rules, pos));
  const v = variantEnd(rules, pos, legal);
  if (v) return v;
  const any = memo.moves ? memo.moves.length > 0 : hasLegalMove(rules, pos);
  if (!any) {
    if (rules.anti) return { winner: pos.turn, reason: 'no_moves' };
    if (inCheck(rules, pos)) return { winner: other(pos.turn), reason: 'checkmate' };
    return { winner: null, reason: 'stalemate' };
  }
  if (insufficientMaterial(rules, pos)) return { winner: null, reason: 'insufficient' };
  return null;
}

// ---------------------------------------------------------------------------
// Notation
// ---------------------------------------------------------------------------

/** SAN without the check suffix: O-O, Nbd7, exd6, e8=Q, N@f3 (pawn drops: P@e4). */
export function sanWithoutSuffix(pos: VPosition, move: VMove, legal: readonly VMove[]): string {
  if (move.drop) return `${move.drop.toUpperCase()}@${squareName(move.to)}`;
  const piece = pos.board[move.from]!;
  if (isCastle(pos, move)) return (move.to & 7) > (move.from & 7) ? 'O-O' : 'O-O-O';
  const capture = isCapture(pos, move);
  const to = squareName(move.to);
  const promo = move.promotion ? `=${move.promotion.toUpperCase()}` : '';
  if (piece.role === 'p') return `${capture ? `${FILE_CHARS[move.from & 7]}x` : ''}${to}${promo}`;
  let ambiguities = 0;
  let sameRank = 0;
  let sameFile = 0;
  for (const m of legal) {
    if (m.from < 0 || m.from === move.from || m.to !== move.to) continue;
    const p = pos.board[m.from];
    if (!p || p.role !== piece.role || isCastle(pos, m)) continue;
    ambiguities++;
    if (m.from >> 3 === move.from >> 3) sameRank++;
    if ((m.from & 7) === (move.from & 7)) sameFile++;
  }
  let dis = '';
  if (ambiguities > 0) {
    if (sameRank > 0 && sameFile > 0) dis = squareName(move.from);
    else if (sameFile > 0) dis = String((move.from >> 3) + 1);
    else dis = FILE_CHARS[move.from & 7]!;
  }
  return `${piece.role.toUpperCase()}${dis}${capture ? 'x' : ''}${to}${promo}`;
}

/** UCI: e2e4, e7e8q, N@f3 (drops); castling as king → rook in Chess960, king → g/c file otherwise. */
export function moveUci(rules: VRules, pos: VPosition, move: VMove): string {
  if (move.drop) return `${move.drop.toUpperCase()}@${squareName(move.to)}`;
  if (isCastle(pos, move) && rules.variant !== 'chess960') {
    return `${squareName(move.from)}${squareName(castleTargets(move.from, move.to).kingTo)}`;
  }
  return `${squareName(move.from)}${squareName(move.to)}${move.promotion ?? ''}`;
}

// ---------------------------------------------------------------------------
// FEN
// ---------------------------------------------------------------------------

const ROLES = 'pnbrqk';

/** Parses a FEN for `rules` (X-FEN/Shredder castling, Crazyhouse "[…]" pockets and "~" promotions, Three-Check "3+3" or "+0+0"). Null when invalid. */
export function parseFen(rules: VRules, fen: string): VPosition | null {
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 2) return null;
  let placement = fields[0]!;
  let pocketText = '';
  const bracket = placement.match(/^(.*)\[([A-Za-z]*)\]$/);
  if (bracket) {
    placement = bracket[1]!;
    pocketText = bracket[2]!;
  } else if (placement.split('/').length === 9) {
    const ranks = placement.split('/');
    pocketText = ranks.pop()!;
    placement = ranks.join('/');
  }
  const ranks = placement.split('/');
  if (ranks.length !== 8) return null;
  const board: Array<VPiece | null> = new Array<VPiece | null>(64).fill(null);
  for (let i = 0; i < 8; i++) {
    const r = 7 - i;
    let f = 0;
    const text = ranks[i]!;
    for (let j = 0; j < text.length; j++) {
      const ch = text[j]!;
      if (ch >= '1' && ch <= '8') {
        f += Number(ch);
        continue;
      }
      const role = ch.toLowerCase();
      if (!ROLES.includes(role) || f > 7) return null;
      const promoted = text[j + 1] === '~';
      if (promoted) j++;
      board[r * 8 + f] = { color: ch === role ? 'b' : 'w', role: role as VRole, ...(promoted && rules.drops ? { promoted: true } : {}) };
      f++;
    }
    if (f !== 8) return null;
  }
  const turn = fields[1];
  if (turn !== 'w' && turn !== 'b') return null;

  const castling: number[] = [];
  const rights = fields[2] ?? '-';
  if (rights !== '-' && rules.castling) {
    for (const ch of rights) {
      const color: VColor = ch === ch.toUpperCase() ? 'w' : 'b';
      const back = color === 'w' ? 0 : 7;
      const king = kingOf(board, color);
      if (king < 0 || king >> 3 !== back) continue;
      const isRook = (sq: number) => board[sq]?.color === color && board[sq]?.role === 'r';
      const c = ch.toLowerCase();
      let rook = -1;
      if (c === 'k') {
        for (let f = 7; f > (king & 7); f--)
          if (isRook(back * 8 + f)) {
            rook = back * 8 + f;
            break;
          }
      } else if (c === 'q') {
        for (let f = 0; f < (king & 7); f++)
          if (isRook(back * 8 + f)) {
            rook = back * 8 + f;
            break;
          }
      } else if (c >= 'a' && c <= 'h') {
        const sq = back * 8 + (c.charCodeAt(0) - 97);
        if (isRook(sq)) rook = sq;
      } else return null;
      if (rook >= 0 && !castling.includes(rook)) castling.push(rook);
    }
  }
  let ep = parseSquare(fields[3]);
  if (ep >= 0 && ep >> 3 !== (turn === 'w' ? 5 : 2)) ep = -1;

  const rest = fields.slice(4);
  let checks: { w: number; b: number } | null = rules.checksToWin ? { w: 0, b: 0 } : null;
  const remaining = rest[0]?.match(/^(\d)\+(\d)$/);
  if (remaining) {
    rest.shift();
    if (checks) checks = { w: Math.max(0, 3 - Number(remaining[1])), b: Math.max(0, 3 - Number(remaining[2])) };
  }
  const given = rest[rest.length - 1]?.match(/^\+(\d)\+(\d)$/);
  if (given) {
    rest.pop();
    if (checks) checks = { w: Number(given[1]), b: Number(given[2]) };
  }
  const halfmoves = Math.max(0, Number(rest[0] ?? 0) || 0);
  const fullmoves = Math.max(1, Number(rest[1] ?? 1) || 1);

  let pockets: VPosition['pockets'] = null;
  if (rules.drops) {
    const empty = (): Pocket => ({ p: 0, n: 0, b: 0, r: 0, q: 0 });
    pockets = { w: empty(), b: empty() };
    for (const ch of pocketText) {
      const role = ch.toLowerCase();
      if (!'pnbrq'.includes(role)) return null;
      pockets[ch === role ? 'b' : 'w'][role as PocketRole]++;
    }
  }
  return { board, turn, castling, ep, halfmoves, fullmoves, pockets, checks };
}

function placementOf(rules: VRules, pos: VPosition): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pos.board[r * 8 + f];
      if (!p) {
        empty++;
        continue;
      }
      if (empty) row += String(empty);
      empty = 0;
      row += p.color === 'w' ? p.role.toUpperCase() : p.role;
      if (p.promoted && rules.drops) row += '~';
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  let text = rows.join('/');
  if (rules.drops && pos.pockets) {
    let pocket = '';
    for (const c of ['w', 'b'] as const) {
      for (const role of POCKET_ROLES) pocket += (c === 'w' ? role.toUpperCase() : role).repeat(pos.pockets[c][role]);
    }
    text += `[${pocket}]`;
  }
  return text;
}

/** X-FEN castling: K/Q for the outermost rook on that side, the rook's file letter otherwise. */
function castlingField(pos: VPosition): string {
  let out = '';
  for (const color of ['w', 'b'] as const) {
    const back = color === 'w' ? 0 : 7;
    const king = kingOf(pos.board, color);
    const mine = pos.castling.filter((r) => r >> 3 === back).sort((a, b) => b - a);
    for (const rook of mine) {
      const kingside = king >= 0 && (rook & 7) > (king & 7);
      let outermost = true;
      for (let f = kingside ? (rook & 7) + 1 : 0; f < (kingside ? 8 : rook & 7); f++) {
        const p = pos.board[back * 8 + f];
        if (p && p.color === color && p.role === 'r') outermost = false;
      }
      const ch = outermost ? (kingside ? 'k' : 'q') : FILE_CHARS[rook & 7]!;
      out += color === 'w' ? ch.toUpperCase() : ch;
    }
  }
  return out || '-';
}

/** The en-passant square, only when a legal en-passant capture exists (as chess.js and lichess print it). */
export function legalEpSquare(rules: VRules, pos: VPosition): number {
  if (!epCapturable(pos, pos.turn)) return -1;
  const ok = legalMoves(rules, pos).some(
    (m) => m.to === pos.ep && m.from >= 0 && pos.board[m.from]?.role === 'p' && (m.from & 7) !== (m.to & 7),
  );
  return ok ? pos.ep : -1;
}

export function makeFen(rules: VRules, pos: VPosition): string {
  const ep = legalEpSquare(rules, pos);
  const parts = [placementOf(rules, pos), pos.turn, castlingField(pos), ep >= 0 ? squareName(ep) : '-'];
  if (rules.checksToWin && pos.checks) parts.push(`${Math.max(0, 3 - pos.checks.w)}+${Math.max(0, 3 - pos.checks.b)}`);
  parts.push(String(pos.halfmoves), String(pos.fullmoves));
  return parts.join(' ');
}

/** Position identity for repetition: the FEN without the move counters. */
export function repetitionKey(rules: VRules, pos: VPosition): string {
  return makeFen(rules, pos).split(' ').slice(0, -2).join(' ');
}

// ---------------------------------------------------------------------------
// Start positions
// ---------------------------------------------------------------------------

export const STANDARD_START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Chess960 starting position number 518 is the standard one. */
export const CHESS960_STANDARD_ID = 518;

/** Back rank (white, a→h) of Chess960 position `id` (0–959, Scharnagl numbering). */
export function chess960BackRank(id: number): string {
  let n = ((Math.floor(id) % 960) + 960) % 960;
  const rank: Array<string | null> = new Array<string | null>(8).fill(null);
  rank[(n % 4) * 2 + 1] = 'B';
  n = Math.floor(n / 4);
  rank[(n % 4) * 2] = 'B';
  n = Math.floor(n / 4);
  const free = () => rank.flatMap((p, i) => (p === null ? [i] : []));
  rank[free()[n % 6]!] = 'Q';
  n = Math.floor(n / 6);
  const KNIGHTS: ReadonlyArray<readonly [number, number]> = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [1, 2],
    [1, 3],
    [1, 4],
    [2, 3],
    [2, 4],
    [3, 4],
  ];
  const [a, b] = KNIGHTS[n]!;
  const left = free();
  rank[left[a]!] = 'N';
  rank[left[b]!] = 'N';
  const last = free();
  rank[last[0]!] = 'R';
  rank[last[1]!] = 'K';
  rank[last[2]!] = 'R';
  return rank.join('');
}

export function chess960Fen(id: number): string {
  const back = chess960BackRank(id);
  return `${back.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${back} w KQkq - 0 1`;
}

const START: Record<ChessVariant, string> = {
  standard: STANDARD_START,
  chess960: chess960Fen(CHESS960_STANDARD_ID),
  kingofthehill: STANDARD_START,
  threecheck: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 3+3 0 1',
  antichess: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1',
  atomic: STANDARD_START,
  horde: 'rnbqkbnr/pppppppp/8/1PP2PP1/PPPPPPPP/PPPPPPPP/PPPPPPPP/PPPPPPPP w kq - 0 1',
  racingkings: '8/8/8/8/8/8/krbnNBRK/qrbnNBRQ w - - 0 1',
  crazyhouse: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[] w KQkq - 0 1',
};

/** The usual starting FEN of a variant (Chess960: position 518 — the room draws a random one per game). */
export function variantStartFen(variant: ChessVariant): string {
  return START[variant];
}
