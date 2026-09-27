/**
 * DAS Chess — board interaction controller: selection, legal targets, click/drag moves, promotion
 * choice, one queued premove, optimistic display of the move just sent, move review and sounds.
 * The server stays authoritative: a rejected move snaps back, a premove is re-validated against
 * the new position before it is sent (and dropped if it became illegal).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHESS_MSG, type ChessMoveView, type ChessPublicState } from '@dascade/shared/games/chess';
import type { BoardEvent, BoardSide } from '@dascade/shared/games/boardroom';
import { ChessGame, premoveTargets, sideColor, squareCoords, type ChessColor, type PromotionPiece } from '@dascade/game-core/chess';
import { session, useRoomMessage } from '../../net/hooks.ts';
import { boardSounds, type BoardAnimation, type TargetKind } from '../_boardroom/index.ts';

export interface PendingPromotion {
  from: string;
  to: string;
}

interface SentMove {
  from: string;
  to: string;
  promotion?: PromotionPiece;
  ply: number;
}

export interface ChessBoardController {
  /** FEN currently displayed (review, optimistic or live). */
  fen: string;
  game: ChessGame;
  selected: string | null;
  targets: Record<string, TargetKind>;
  premove: { from: string; to: string } | null;
  lastMove: string[];
  check: string | null;
  animation: BoardAnimation | null;
  interactive: boolean;
  canPick: (sq: string) => boolean;
  onSelect: (sq: string | null) => void;
  onMove: (from: string, to: string, via: 'click' | 'drag') => void;
  promotion: PendingPromotion | null;
  choosePromotion: (piece: PromotionPiece | null) => void;
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

/** Positions after each ply, replayed locally (for review). */
function replay(moves: readonly ChessMoveView[], upTo: number): string {
  const g = new ChessGame();
  for (let i = 0; i <= upTo && i < moves.length; i++) {
    const m = moves[i]!;
    g.move({ from: m.from, to: m.to, promotion: m.promotion || undefined });
  }
  return g.fen;
}

function soundFor(m: { captured: string; castle: string; promotion: string; check: boolean; mate: boolean }): void {
  if (m.check || m.mate) boardSounds.check();
  else if (m.promotion) boardSounds.promote();
  else if (m.castle) boardSounds.castle();
  else if (m.captured) boardSounds.capture();
  else boardSounds.move();
}

export function useChessBoard(state: ChessPublicState, mySide: BoardSide | null, live: boolean): ChessBoardController {
  const myColor: ChessColor | null = mySide ? sideColor(mySide) : null;
  const [selected, setSelected] = useState<string | null>(null);
  const [premove, setPremove] = useState<{ from: string; to: string } | null>(null);
  const [promotion, setPromotion] = useState<PendingPromotion | null>(null);
  const [sent, setSent] = useState<SentMove | null>(null);
  const [review, setReview] = useState<number | null>(null);

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
  });

  // Live position (+ optimistic move).
  const liveGame = useMemo(() => {
    const g = new ChessGame(state.fen || undefined);
    if (pending) g.move(pending);
    return g;
  }, [state.fen, pending]);

  const reviewing = review !== null && review < moves.length - 1;
  const game = useMemo(() => (reviewing ? new ChessGame(replay(moves, review!)) : liveGame), [reviewing, moves, review, liveGame]);
  const fen = game.fen;
  const myTurnNow = live && myColor !== null && liveGame.turn === myColor && !pending;
  const interactive = live && myColor !== null && !reviewing;

  // Leave review automatically when the game moves on? No — but do exit review when the game ends/restarts.
  useEffect(() => {
    if (moves.length === 0) setReview(null);
  }, [moves.length]);

  // Last move / animation.
  const last = pending ? liveGame.history.at(-1) : reviewing ? moves[review!] : moves.at(-1);
  const lastPly = pending ? serverPly + 1 : reviewing ? review! + 1 : moves.length;
  const lastMove = last ? [last.from, last.to] : [];
  const animation = useMemo<BoardAnimation | null>(() => {
    if (!last) return null;
    const paths: string[][] = [[last.from, last.to]];
    if (last.castle) {
      const rook = CASTLE_ROOK[last.to];
      if (rook) paths.push(rook);
    }
    return { key: `${lastPly}:${last.from}${last.to}`, paths };
  }, [last, lastPly]);

  const check = game.inCheck() ? game.kingSquare(game.turn) : null;

  // Clear selection/promotion when the game stops being interactive.
  useEffect(() => {
    if (!interactive) {
      setSelected(null);
      setPromotion(null);
    }
  }, [interactive]);
  useEffect(() => {
    if (!live) setPremove(null);
  }, [live]);

  const send = useCallback(
    (from: string, to: string, promo?: PromotionPiece) => {
      const move: SentMove = { from, to, promotion: promo, ply: serverPly };
      setSent(move);
      session.send(CHESS_MSG.move, { from, to, promotion: promo, ply: serverPly });
    },
    [serverPly],
  );

  // Play a queued premove when the turn comes back (after re-validating it).
  useEffect(() => {
    if (!premove || !myTurnNow) return;
    const g = new ChessGame(state.fen);
    const promo: PromotionPiece | undefined = g.isPromotion(premove.from, premove.to) ? 'q' : undefined;
    setPremove(null);
    if (g.isLegal({ from: premove.from, to: premove.to, promotion: promo })) send(premove.from, premove.to, promo);
    else boardSounds.illegal();
  }, [premove, myTurnNow, state.fen, send]);

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
    if (!selected || !interactive) return out;
    if (myTurnNow) {
      for (const m of liveGame.legalMoves(selected)) out[m.to] = m.capture ? 'capture' : 'move';
    } else {
      for (const sq of premoveTargets(liveGame.fen, selected)) out[sq] = 'move';
    }
    return out;
  }, [selected, interactive, myTurnNow, liveGame]);

  const onSelect = useCallback(
    (sq: string | null) => {
      setSelected(sq);
      if (sq === null) return;
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
        if (premoveTargets(liveGame.fen, from).some((sq) => sq === to)) {
          setPremove({ from, to });
          boardSounds.premove();
        }
        setSelected(null);
        return;
      }
      let dest = to;
      // King onto its own rook = castle on that side.
      const target = liveGame.piece(to);
      if (piece.type === 'k' && target?.type === 'r' && target.color === myColor) {
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
      const preview = new ChessGame(liveGame.fen);
      const rec = preview.move({ from, to: dest });
      if (rec) {
        soundedOwn.current = `${serverPly + 1}:${rec.uci}`;
        soundFor(rec);
      }
      setSelected(null);
      send(from, dest);
    },
    [interactive, myColor, liveGame, myTurnNow, send, serverPly],
  );

  const choosePromotion = useCallback(
    (piece: PromotionPiece | null) => {
      const p = promotion;
      setPromotion(null);
      if (!p || !piece) return;
      soundedOwn.current = `${serverPly + 1}:${p.from}${p.to}${piece}`;
      boardSounds.promote();
      send(p.from, p.to, piece);
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
    fen,
    game,
    selected,
    targets,
    premove,
    lastMove,
    check,
    animation,
    interactive,
    canPick,
    onSelect,
    onMove,
    promotion,
    choosePromotion,
    review: reviewing ? review : null,
    setReview,
    cancelPremove: () => setPremove(null),
    sans,
  };
}
