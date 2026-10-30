/**
 * Game records for every checkers variant, behind one engine interface (`checkersEngine`).
 *
 * American checkers runs on the original engine (../game.ts, ../moves.ts) unchanged; every other
 * variant runs on the rules-driven engine in this folder. Both produce the same record shape, so
 * the room and the client don't care which one plays.
 *
 * Endings decided by the board (checked after every move, wins first):
 *  - breakthrough — Breakthrough only: the move crowned a king, the mover wins;
 *  - no_pieces / no_moves — the side to move has no pieces / no legal move: it loses (Giveaway
 *    and Antidraughts: it WINS);
 *  - repetition — the same position (board + side to move) for the third time: draw;
 *  - move_limit / forty_moves — the variant's run of plies without a capture or a man move: draw
 *    (American keeps its "forty_moves" reason);
 *  - endgame — one of the variant's endgame rules (./rules.ts) ran out its moves: draw.
 */
import { CHECKERS_VARIANT_INFO, type CheckersVariant } from '@dascade/shared/games/checkers';
import { material, opponent, positionKey, type Color, type Position } from '../board.ts';
import {
  newGame as newAmericanGame,
  playMove as playAmericanMove,
  type CheckersDrawReason,
  type CheckersGame,
  type CheckersPly,
  type CheckersWinReason,
} from '../game.ts';
import {
  applyMove as applyAmericanMove,
  hasCapture as americanHasCapture,
  legalMoves as americanLegalMoves,
  moveNotation,
  type CheckersMove,
} from '../moves.ts';
import { geometryFor, startingBoard, type BoardGeometry } from './geometry.ts';
import { resolveVariantMove, variantApplyMove, variantHasCapture, variantLegalMoves } from './moves.ts';
import { rulesFor, type DraughtsRules, type EndgameDrawRule } from './rules.ts';

export type DraughtsWinReason = CheckersWinReason | 'breakthrough';
export type DraughtsDrawReason = CheckersDrawReason | 'move_limit' | 'endgame';
export type DraughtsEndReason = DraughtsWinReason | DraughtsDrawReason;

export interface DraughtsResult {
  /** Winning colour, or null for a draw. */
  winner: Color | null;
  reason: DraughtsEndReason;
  /** Endgame draws: the rule that ended the game (see ./rules.ts). */
  rule?: string;
}

export interface DraughtsGame extends Omit<CheckersGame, 'result'> {
  variant: CheckersVariant;
  /** Plies since the material last changed (capture or crowning) — the endgame draw rules count them. */
  endgamePlies: number;
  result: DraughtsResult | null;
}

export type DraughtsPlayResult =
  { ok: true; game: DraughtsGame; move: CheckersMove; ply: CheckersPly } | { ok: false; error: 'game_over' | 'illegal_move' };

export interface CheckersEngine {
  variant: CheckersVariant;
  rules: DraughtsRules;
  geometry: BoardGeometry;
  /** The starting position. */
  start(): Position;
  /** A new game from the starting position (or `from`, for tests and puzzles). */
  newGame(from?: Position): DraughtsGame;
  /** Plays a path (the full path, or from→to when unambiguous). Never mutates the input. */
  playMove(game: DraughtsGame, path: readonly number[]): DraughtsPlayResult;
  legalMoves(pos: Position): CheckersMove[];
  hasCapture(pos: Position): boolean;
  applyMove(pos: Position, move: CheckersMove): Position;
}

// ---------------------------------------------------------------------------
// Endings
// ---------------------------------------------------------------------------

/** The endgame draw rule in force for this material, if any (the shortest when several apply). */
export function endgameRuleFor(rules: DraughtsRules, board: string): EndgameDrawRule | null {
  const dark = material(board, 'dark');
  const light = material(board, 'light');
  let best: EndgameDrawRule | null = null;
  for (const rule of rules.endgame) if (rule.applies(dark, light) && (!best || rule.moves < best.moves)) best = rule;
  return best;
}

function variantResult(rules: DraughtsRules, game: DraughtsGame): DraughtsResult | null {
  const pos = game.position;
  const toMove = pos.turn;
  const last = game.plies[game.plies.length - 1];
  if (rules.goal === 'breakthrough' && last?.crowned) return { winner: last.color, reason: 'breakthrough' };
  const giveaway = rules.goal === 'giveaway';
  const ends = (reason: 'no_pieces' | 'no_moves'): DraughtsResult => ({ winner: giveaway ? toMove : opponent(toMove), reason });
  if (material(pos.board, toMove).total === 0) return ends('no_pieces');
  if (variantLegalMoves(rules, pos).length === 0) return ends('no_moves');
  if ((game.seen[positionKey(pos)] ?? 0) >= 3) return { winner: null, reason: 'repetition' };
  if (rules.quietPlies > 0 && game.quietPlies >= rules.quietPlies) return { winner: null, reason: 'move_limit' };
  const rule = endgameRuleFor(rules, pos.board);
  if (rule && game.endgamePlies >= rule.moves * 2) return { winner: null, reason: 'endgame', rule: rule.id };
  return null;
}

/** What the next automatic draw is and how far away (for hints), or null when none is close to counting. */
export function drawCountdown(
  variant: CheckersVariant,
  board: string,
  quietPlies: number,
  endgamePlies: number,
): { kind: 'move_limit'; movesLeft: number; limit: number } | { kind: 'endgame'; movesLeft: number; label: string } | null {
  const rules = rulesFor(variant);
  const rule = endgameRuleFor(rules, board);
  const endgameLeft = rule ? Math.max(0, Math.ceil((rule.moves * 2 - endgamePlies) / 2)) : Infinity;
  const quietLeft = rules.quietPlies > 0 ? Math.max(0, Math.ceil((rules.quietPlies - quietPlies) / 2)) : Infinity;
  if (rule && endgameLeft <= quietLeft) return { kind: 'endgame', movesLeft: endgameLeft, label: rule.label };
  if (quietLeft !== Infinity) return { kind: 'move_limit', movesLeft: quietLeft, limit: rules.quietPlies / 2 };
  return null;
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

function variantGame(variant: CheckersVariant, rules: DraughtsRules, start: Position): DraughtsGame {
  const game: DraughtsGame = {
    variant,
    position: { ...start },
    plies: [],
    quietPlies: 0,
    endgamePlies: 0,
    seen: { [positionKey(start)]: 1 },
    result: null,
  };
  game.result = variantResult(rules, game);
  return game;
}

function makeVariantEngine(variant: CheckersVariant): CheckersEngine {
  const rules = rulesFor(variant);
  const geo = geometryFor(rules.size);
  const start = (): Position => ({ board: startingBoard(geo, rules.rows), turn: rules.first });
  return {
    variant,
    rules,
    geometry: geo,
    start,
    newGame: (from) => variantGame(variant, rules, from ?? start()),
    legalMoves: (pos) => variantLegalMoves(rules, pos),
    hasCapture: (pos) => variantHasCapture(rules, pos),
    applyMove: variantApplyMove,
    playMove(game, path) {
      if (game.result) return { ok: false, error: 'game_over' };
      const move = resolveVariantMove(geo, variantLegalMoves(rules, game.position), path);
      if (!move) return { ok: false, error: 'illegal_move' };
      const mover = game.position.turn;
      const piece = game.position.board[move.path[0]! - 1];
      const movedMan = piece === 'd' || piece === 'l';
      const irreversible = move.captures.length > 0 || movedMan;
      const materialChanged = move.captures.length > 0 || move.crowned;
      const position = variantApplyMove(game.position, move);
      const key = positionKey(position);
      const ply: CheckersPly = {
        notation: moveNotation(move),
        color: mover,
        path: [...move.path],
        captures: [...move.captures],
        crowned: move.crowned,
      };
      const next: DraughtsGame = {
        variant,
        position,
        plies: [...game.plies, ply],
        quietPlies: irreversible ? 0 : game.quietPlies + 1,
        endgamePlies: materialChanged ? 0 : game.endgamePlies + 1,
        seen: irreversible ? { [key]: 1 } : { ...game.seen, [key]: (game.seen[key] ?? 0) + 1 },
        result: null,
      };
      next.result = variantResult(rules, next);
      return { ok: true, game: next, move, ply };
    },
  };
}

/** American checkers: the original engine, wrapped in the common interface. */
function makeAmericanEngine(): CheckersEngine {
  const rules = rulesFor('american');
  const wrap = (g: CheckersGame, endgamePlies = 0): DraughtsGame => ({ ...g, variant: 'american', endgamePlies });
  return {
    variant: 'american',
    rules,
    geometry: geometryFor(8),
    start: () => newAmericanGame().position,
    newGame: (from) => wrap(newAmericanGame(from)),
    legalMoves: americanLegalMoves,
    hasCapture: americanHasCapture,
    applyMove: applyAmericanMove,
    playMove(game, path) {
      const played = playAmericanMove({ ...game, result: game.result as CheckersGame['result'] }, path);
      if (!played.ok) return played;
      const materialChanged = played.move.captures.length > 0 || played.move.crowned;
      return { ...played, game: wrap(played.game, materialChanged ? 0 : game.endgamePlies + 1) };
    },
  };
}

const engines = new Map<CheckersVariant, CheckersEngine>();

/** The rules engine of a variant (cached). */
export function checkersEngine(variant: CheckersVariant): CheckersEngine {
  let engine = engines.get(variant);
  if (!engine) {
    engine = variant === 'american' ? makeAmericanEngine() : makeVariantEngine(variant);
    engines.set(variant, engine);
  }
  return engine;
}

/** Replays a game from the start (take-backs, tests). Returns null if a path is illegal. */
export function replayVariant(variant: CheckersVariant, paths: ReadonlyArray<readonly number[]>): DraughtsGame | null {
  const engine = checkersEngine(variant);
  let game = engine.newGame();
  for (const path of paths) {
    const played = engine.playMove(game, path);
    if (!played.ok) return null;
    game = played.game;
  }
  return game;
}

// ---------------------------------------------------------------------------
// Result text
// ---------------------------------------------------------------------------

const NAME: Record<Color, string> = { dark: 'Dark', light: 'Light' };

/** Player-facing text for a result (no trailing full stop). */
export function describeVariantResult(variant: CheckersVariant, result: DraughtsResult): string {
  const rules = rulesFor(variant);
  const winner = result.winner ? NAME[result.winner] : '';
  const loser = result.winner ? NAME[opponent(result.winner)] : '';
  const giveaway = rules.goal === 'giveaway';
  switch (result.reason) {
    case 'breakthrough':
      return `${winner} wins — first to crown a king`;
    case 'no_pieces':
      return giveaway ? `${winner} wins — gave away every piece` : `${winner} wins — ${loser} has no pieces left`;
    case 'no_moves':
      return giveaway ? `${winner} wins — no piece left that can move` : `${winner} wins — ${loser} has no legal move`;
    case 'resign':
      return `${winner} wins — ${loser} resigned`;
    case 'timeout':
      return `${winner} wins on time`;
    case 'forfeit':
      return `${winner} wins by forfeit`;
    case 'repetition':
      return 'Draw by threefold repetition';
    case 'forty_moves':
      return 'Draw — 40 moves each without a capture or a man move';
    case 'move_limit':
      return `Draw — ${rules.quietPlies / 2} moves each without a capture or a man move`;
    case 'endgame': {
      const rule = rules.endgame.find((r) => r.id === result.rule);
      return rule ? `Draw — ${rule.label}, ${rule.moves} moves each` : 'Draw by the endgame rule';
    }
    case 'agreement':
      return 'Draw by agreement';
  }
}

/** The colour that moves first in a variant. */
export function firstColor(variant: CheckersVariant): Color {
  return CHECKERS_VARIANT_INFO[variant].first;
}
