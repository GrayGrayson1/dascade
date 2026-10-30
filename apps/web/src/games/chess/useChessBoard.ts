/**
 * DAS Chess — board interaction controller: selection, legal targets, click/drag moves, promotion
 * choice, one queued premove, optimistic display of the move just sent, move review and sounds.
 * The server stays authoritative: a rejected move snaps back, a premove is re-validated against
 * the new position before it is sent (and dropped if it became illegal).
 *
 * Variants: the game engine comes from createChessGame(variant) (chess.js for Standard). Crazyhouse
 * drops are picked from the pocket (`pickDrop`) and placed with a tap on a highlighted square;
 * Chess960 castles by moving the king onto the rook; review replays from the game's own start.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHESS_MSG, type ChessMoveView, type ChessPublicState, type ChessVariant } from '@dascade/shared/games/chess';
import type { BoardEvent, BoardSide } from '@dascade/shared/games/boardroom';
import {
  createChessGame,
  moveInputFromUci,
  premoveTargets,
  sideColor,
  squareAt,
  squareCoords,
  type ChessColor,
  type ChessGameApi,
  type DropPiece,
  type PromotionChoice,
} from '@dascade/game-core/chess';
import { session, useRoomMessage } from '../../net/hooks.ts';
import { boardSounds, type BoardAnimation, type TargetKind } from '../_boardroom/index.ts';
import { chessSounds } from './sounds.ts';
import { variantOf } from './variants.tsx';

export interface PendingPromotion {
  from: string;
  to: string;
}

interface SentMove {
  from?: string;
  to: string;
  promotion?: PromotionChoice;
  drop?: DropPiece;
  ply: number;
}

export interface ChessBoardController {
  variant: ChessVariant;
  /** FEN currently displayed (review, optimistic or live). */
  fen: string;
  game: ChessGameApi;
  selected: string | null;
  targets: Record<string, TargetKind>;
  premove: { from: string; to: string } | null;
  lastMove: string[];
  /** Atomic: squares cleared by the explosion of the move shown last. */
  exploded: string[];
  check: string | null;
  animation: BoardAnimation | null;
  interactive: boolean;
  canPick: (sq: string) => boolean;
  onSelect: (sq: string | null) => void;
  onMove: (from: string, to: string, via: 'click' | 'drag') => void;
  /** A tap on a square that is neither a piece to pick nor a move target (Crazyhouse drops land here). */
  onSquareClick: (sq: string) => void;
  promotion: PendingPromotion | null;
  choosePromotion: (piece: PromotionChoice | null) => void;
  /** Crazyhouse: the pocket piece picked for a drop. */
  drop: DropPiece | null;
  /** Pick (or put back, with null) a pocket piece — only on your own turn. */
  pickDrop: ((piece: DropPiece | null) => void) | null;
  /** Ply index being reviewed (null = live). */
  review: number | null;
  setReview: (ply: number | null) => void;
  cancelPremove: () => void;
  /** Visible moves (SAN) — includes the optimistic one. */
  sans: string[];
}

const CASTLE_ROOK: Record<string, [string, string]> = {
  g1: ['h1', 'f1'],
  c1: ['a1', 'd1'],
  g8: ['h8', 'f8'],
  c8: ['a8', 'd8'],
};

/** A game of `variant` at `fen` (the variant's start if missing or unreadable). */
function gameAt(variant: ChessVariant, fen: string | undefined): ChessGameApi {
  try {
    return createChessGame(variant, fen || undefined);
  } catch {
    return createChessGame(variant);
  }
}

/** Position after each ply, replayed locally from the game's start (for review). */
function replay(variant: ChessVariant, startFen: string, moves: readonly ChessMoveView[], upTo: number): string {
  const g = gameAt(variant, startFen);
  for (let i = 0; i <= upTo && i < moves.length; i++) {
    const m = moves[i]!;
    g.move(moveInputFromUci(m.uci) ?? { from: m.from, to: m.to, promotion: m.promotion || undefined });
  }
  return g.fen;
}

/** The rook's path of a castling move ([] if none). Chess960's UCI is king → rook. */
function rookPath(variant: ChessVariant, m: { castle: string; to: string; uci: string }): string[] {
  if (!m.castle) return [];
  if (variant !== 'chess960') return CASTLE_ROOK[m.to] ?? [];
  return [m.uci.slice(2, 4), `${m.castle === 'k' ? 'f' : 'd'}${m.to[1]}`];
}

interface Soundable {
  captured: string;
  castle: string;
  promotion: string;
  check: boolean;
  mate: boolean;
  drop?: string;
  exploded?: string | readonly string[];
}

function soundFor(m: Soundable): void {
  if (m.exploded && m.exploded.length) chessSounds.explode();
  if (m.check || m.mate) boardSounds.check();
  else if (m.promotion) boardSounds.promote();
  else if (m.castle) boardSounds.castle();
  else if (m.drop) chessSounds.drop();
  else if (m.captured) boardSounds.capture();
  else boardSounds.move();
}

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
 * Variant premove geometry: where the piece on `from` might go after the opponent's reply (pieces
 * slide through everything; validated again when played). Castling: the king's g/c squares, or in
 * Chess960 its own rooks on the back rank.
 */
function variantPremoveTargets(variant: ChessVariant, game: ChessGameApi, from: string): string[] {
  const piece = game.piece(from);
  if (!piece) return [];
  const [f, r] = squareCoords(from);
  const out = new Set<string>();
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
      // Second-rank pawns (and Horde's first-rank ones) may step twice.
      if ((piece.color === 'w' && r <= 1) || (piece.color === 'b' && r >= 6)) add(0, 2 * dir);
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
      const back = piece.color === 'w' ? 0 : 7;
      if (r === back && variant !== 'antichess' && variant !== 'racingkings') {
        if (variant === 'chess960') {
          for (let file = 0; file < 8; file++) {
            const sq = squareAt(file, back)!;
            const p = game.piece(sq);
            if (p && p.type === 'r' && p.color === piece.color) out.add(sq);
          }
        } else if (f === 4) {
          add(2, 0);
          add(-2, 0);
        }
      }
      break;
    }
  }
  out.delete(from);
  return [...out];
}

export function useChessBoard(state: ChessPublicState, mySide: BoardSide | null, live: boolean): ChessBoardController {
  const variant = variantOf(state);
  const myColor: ChessColor | null = mySide ? sideColor(mySide) : null;
  const [selected, setSelected] = useState<string | null>(null);
  const [premove, setPremove] = useState<{ from: string; to: string } | null>(null);
  const [promotion, setPromotion] = useState<PendingPromotion | null>(null);
  const [sent, setSent] = useState<SentMove | null>(null);
  const [review, setReview] = useState<number | null>(null);
  const [drop, setDrop] = useState<DropPiece | null>(null);

  const serverPly = state.ply;
  const moves = state.moves;

  // The optimistic move is dropped as soon as the server publishes a newer ply (or refuses it).
  const pending = sent && sent.ply === serverPly ? sent : null;
  useEffect(() => {
    if (sent && sent.ply !== serverPly) setSent(null);
  }, [sent, serverPly]);
  useRoomMessage<{ type?: string }>('sys:error', (e) => {
    if (e?.type !== CHESS_MSG.move) return;
    setSent(null);
    // A premove queued behind a refused move was planned for a position that never happened.
    setPremove(null);
    boardSounds.illegal();
  });
  // A move lost in a network drop is never confirmed: fall back to the server position so the
  // player can move again instead of watching their clock run behind a phantom move.
  useEffect(() => {
    if (!sent) return;
    const id = window.setTimeout(() => setSent((cur) => (cur === sent ? null : cur)), 5000);
    return () => window.clearTimeout(id);
  }, [sent]);
  // A take-back changes the position under the player's plans: drop the premove and selection.
  useRoomMessage<BoardEvent>(CHESS_MSG.event, (e) => {
    if (e?.type !== 'undo') return;
    setSent(null);
    setPremove(null);
    setSelected(null);
    setPromotion(null);
    setDrop(null);
  });

  // Live position (+ optimistic move).
  const liveGame = useMemo(() => {
    const g = gameAt(variant, state.fen);
    if (pending) g.move(pending);
    return g;
  }, [variant, state.fen, pending]);

  const reviewing = review !== null && review < moves.length - 1;
  const game = useMemo(
    () => (reviewing ? gameAt(variant, replay(variant, state.startFen, moves, review!)) : liveGame),
    [reviewing, variant, state.startFen, moves, review, liveGame],
  );
  const fen = game.fen;
  const myTurnNow = live && myColor !== null && liveGame.turn === myColor && !pending;
  const interactive = live && myColor !== null && !reviewing;

  // Leave review automatically when the game moves on? No — but do exit review when the game ends/restarts.
  useEffect(() => {
    if (moves.length === 0) setReview(null);
  }, [moves.length]);

  // Last move / animation.
  const last = useMemo(() => {
    const rec = pending ? liveGame.history.at(-1) : undefined;
    if (rec) return { ...rec, exploded: rec.exploded?.join(' ') ?? '', drop: rec.drop ?? '' };
    return reviewing ? moves[review!] : moves.at(-1);
  }, [pending, liveGame, reviewing, moves, review]);
  const lastPly = pending ? serverPly + 1 : reviewing ? review! + 1 : moves.length;
  const lastMove = last ? (last.drop ? [last.to] : [last.from, last.to]) : [];
  const lastExploded = last?.exploded ?? '';
  const exploded = useMemo(() => (lastExploded ? lastExploded.split(' ') : []), [lastExploded]);
  const animation = useMemo<BoardAnimation | null>(() => {
    if (!last || last.drop) return null;
    const paths: string[][] = [[last.from, last.to]];
    const rook = rookPath(variant, last);
    if (rook.length === 2 && rook[0] !== rook[1]) paths.push(rook);
    return { key: `${lastPly}:${last.from}${last.to}`, paths };
  }, [last, lastPly, variant]);

  const check = game.inCheck() ? game.kingSquare(game.turn) : null;

  // Clear selection/promotion when the game stops being interactive; a drop is only picked on your turn.
  useEffect(() => {
    if (!interactive) {
      setSelected(null);
      setPromotion(null);
    }
  }, [interactive]);
  useEffect(() => {
    if (!myTurnNow) setDrop(null);
  }, [myTurnNow]);
  useEffect(() => {
    if (!live) setPremove(null);
  }, [live]);

  const send = useCallback(
    (move: Omit<SentMove, 'ply'>) => {
      setSent({ ...move, ply: serverPly });
      session.send(CHESS_MSG.move, { ...move, ply: serverPly });
    },
    [serverPly],
  );

  // Play a queued premove when the turn comes back (after re-validating it).
  useEffect(() => {
    if (!premove || !myTurnNow) return;
    const g = gameAt(variant, state.fen);
    const promo: PromotionChoice | undefined = g.isPromotion(premove.from, premove.to) ? 'q' : undefined;
    setPremove(null);
    if (g.isLegal({ from: premove.from, to: premove.to, promotion: promo })) send({ from: premove.from, to: premove.to, promotion: promo });
    else boardSounds.illegal();
  }, [premove, myTurnNow, variant, state.fen, send]);

  // Move sounds for moves that arrive from the server (own optimistic moves sound immediately).
  const lastSounded = useRef<number>(moves.length);
  const soundedOwn = useRef<string>('');
  useEffect(() => {
    if (moves.length > lastSounded.current) {
      const m = moves.at(-1)!;
      const key = `${moves.length}:${m.uci}`;
      if (soundedOwn.current !== key) soundFor(m);
    }
    lastSounded.current = moves.length;
  }, [moves]);

  const premoveSquares = useCallback(
    (from: string): string[] =>
      variant === 'standard' ? premoveTargets(liveGame.fen, from) : variantPremoveTargets(variant, liveGame, from),
    [variant, liveGame],
  );

  const canPick = useCallback(
    (sq: string) => {
      if (!interactive || !myColor) return false;
      const p = liveGame.piece(sq);
      return Boolean(p && p.color === myColor);
    },
    [interactive, myColor, liveGame],
  );

  const targets = useMemo<Record<string, TargetKind>>(() => {
    const out: Record<string, TargetKind> = {};
    if (!interactive) return out;
    if (drop && myTurnNow) {
      for (const sq of liveGame.dropTargets(drop)) out[sq] = 'move';
      return out;
    }
    if (!selected) return out;
    if (myTurnNow) {
      for (const m of liveGame.legalMoves(selected)) out[m.to] = m.capture ? 'capture' : 'move';
    } else {
      for (const sq of premoveSquares(selected)) out[sq] = 'move';
    }
    return out;
  }, [selected, drop, interactive, myTurnNow, liveGame, premoveSquares]);

  const onSelect = useCallback(
    (sq: string | null) => {
      setSelected(sq);
      if (sq === null) return;
      setDrop(null);
      if (premove) setPremove(null);
    },
    [premove],
  );

  const onMove = useCallback(
    (from: string, to: string) => {
      if (!interactive || !myColor) return;
      const piece = liveGame.piece(from);
      if (!piece || piece.color !== myColor) return;
      if (!myTurnNow) {
        // Premove (one at a time).
        if (premoveSquares(from).some((sq) => sq === to)) {
          setPremove({ from, to });
          boardSounds.premove();
        }
        setSelected(null);
        return;
      }
      let dest = to;
      // King onto its own rook = castle on that side (Chess960 sends the rook square itself).
      const target = liveGame.piece(to);
      if (piece.type === 'k' && target?.type === 'r' && target.color === myColor && !liveGame.isLegal({ from, to })) {
        const [ff] = squareCoords(from);
        const [tf] = squareCoords(to);
        const castleTo = `${tf > ff ? 'g' : 'c'}${from[1]}`;
        if (liveGame.isLegal({ from, to: castleTo })) dest = castleTo;
      }
      if (liveGame.isPromotion(from, dest)) {
        setPromotion({ from, to: dest });
        setSelected(null);
        return;
      }
      if (!liveGame.isLegal({ from, to: dest })) {
        if (target && target.color === myColor) setSelected(to);
        else {
          setSelected(null);
          boardSounds.illegal();
        }
        return;
      }
      const rec = gameAt(variant, liveGame.fen).move({ from, to: dest });
      if (rec) {
        soundedOwn.current = `${serverPly + 1}:${rec.uci}`;
        soundFor(rec);
      }
      setSelected(null);
      send({ from, to: dest });
    },
    [interactive, myColor, liveGame, myTurnNow, send, serverPly, premoveSquares, variant],
  );

  const onSquareClick = useCallback(
    (sq: string) => {
      if (!drop || !myTurnNow) return;
      if (!liveGame.isLegal({ to: sq, drop })) {
        if (!liveGame.piece(sq)) boardSounds.illegal();
        return;
      }
      const rec = gameAt(variant, liveGame.fen).move({ to: sq, drop });
      if (rec) {
        soundedOwn.current = `${serverPly + 1}:${rec.uci}`;
        soundFor(rec);
      }
      setDrop(null);
      send({ to: sq, drop });
    },
    [drop, myTurnNow, liveGame, variant, serverPly, send],
  );

  const pickDrop = useMemo(() => {
    if (variant !== 'crazyhouse' || !myTurnNow) return null;
    return (piece: DropPiece | null) => {
      setDrop(piece);
      setSelected(null);
      setPremove(null);
    };
  }, [variant, myTurnNow]);

  const choosePromotion = useCallback(
    (piece: PromotionChoice | null) => {
      const p = promotion;
      setPromotion(null);
      if (!p || !piece) return;
      soundedOwn.current = `${serverPly + 1}:${p.from}${p.to}${piece}`;
      boardSounds.promote();
      send({ from: p.from, to: p.to, promotion: piece });
    },
    [promotion, send, serverPly],
  );

  const sans = useMemo(() => {
    const list = moves.map((m) => m.san);
    if (pending) {
      const rec = liveGame.history.at(-1);
      if (rec) list.push(rec.san);
    }
    return list;
  }, [moves, pending, liveGame]);

  return {
    variant,
    fen,
    game,
    selected,
    targets,
    premove,
    lastMove,
    exploded,
    check,
    animation,
    interactive,
    canPick,
    onSelect,
    onMove,
    onSquareClick,
    promotion,
    choosePromotion,
    drop,
    pickDrop,
    review: reviewing ? review : null,
    setReview,
    cancelPremove: () => setPremove(null),
    sans,
  };
}
