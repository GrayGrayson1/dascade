/**
 * DAS Checkers board — a checkers adapter over the Boardroom kit's <SquareBoard>.
 *
 * Mapping: the kit's (file, rank) is seen from the FIRST side (Dark) — rank 0 is Dark's back row.
 * Standard numbering puts Dark's back row (1–4) at the top of the diagram, so
 * diagram row = rank and diagram column = 7 − file. Square ids are the numbers "1"…"32";
 * light (unplayable) squares get ids like "x03".
 *
 * Input: the kit reports taps/drags; this adapter keeps the partial path of a multi-jump. After an
 * intermediate landing the piece shows as a ghost there with the jumped piece marked, and the next
 * landings light up. Forced continuations complete themselves; a final destination further down the
 * chain can be tapped directly. The server validates every submitted path.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cellAt, isKing, jumpedSquare, pieceColor, rcToSquare, type CheckersMove } from '@dascade/game-core/checkers';
import { cx } from '@dascade/ui';
import { SquareBoard, type BoardAnimation, type TargetKind } from '../_boardroom/index.ts';
import { PieceArt } from './Piece.tsx';
import { clickSquare, destinationsFor, movablePieces, targetsFor } from './selection.ts';

/** Kit hop timing (SquareBoard animates 150 ms + 110 ms per hop). */
export function hopDurationMs(pathLength: number): number {
  return 150 + 110 * Math.max(1, pathLength - 1);
}

const squareId = (file: number, rank: number): string => {
  const sq = rcToSquare(rank, 7 - file);
  return sq ? String(sq) : `x${file}${rank}`;
};
const isDark = (file: number, rank: number): boolean => rcToSquare(rank, 7 - file) !== 0;
const toSq = (id: string | null | undefined): number => {
  const n = Number(id);
  return Number.isInteger(n) && n >= 1 && n <= 32 ? n : 0;
};

export interface CheckersBoardProps {
  board: string;
  ply: number;
  lastPath: readonly number[];
  lastCaptures: readonly number[];
  /** The last move crowned a man (glint on its landing square). */
  lastCrowned: boolean;
  /** Dark (first side) at the bottom unless flipped. */
  flipped: boolean;
  /** Legal moves the viewer may play now (empty when it isn't their turn). */
  moves: readonly CheckersMove[];
  /** The side to move must capture (pieces that can jump pulse for the mover). */
  mustCapture: boolean;
  onMove: (move: CheckersMove) => void;
  /** A drop/tap that isn't a legal continuation (for a soft "nope" sound). */
  onIllegal?: () => void;
  reducedMotion: boolean;
  showNumbers: boolean;
  label: string;
  className?: string;
}

export const CheckersBoard = memo(function CheckersBoard(props: CheckersBoardProps) {
  const { board, ply, lastPath, lastCaptures, lastCrowned, flipped, moves, mustCapture, onMove, onIllegal, reducedMotion, showNumbers, label, className } = props;
  const [path, setPath] = useState<number[]>([]);
  const interactive = moves.length > 0;

  // A new position (or losing the turn) cancels a half-built move.
  useEffect(() => setPath([]), [ply, interactive]);

  // Remember the board before the last move so captured pieces can fade out where they stood.
  const history = useRef<{ ply: number; board: string; prev: string | null }>({ ply, board, prev: null });
  if (history.current.ply !== ply || history.current.board !== board) {
    history.current = { ply, board, prev: history.current.ply === ply - 1 ? history.current.board : null };
  }
  const prevBoard = history.current.prev;

  const movable = useMemo(() => movablePieces(moves), [moves]);
  const end = path[path.length - 1];

  const targets = useMemo(() => {
    const out: Record<string, TargetKind> = {};
    if (end === undefined) return out;
    for (const t of targetsFor(moves, path)) out[String(t)] = jumpedSquare(end, t) ? 'capture' : 'move';
    return out;
  }, [moves, path, end]);

  const marks = useMemo(() => {
    const out: Record<string, string> = {};
    if (interactive && mustCapture && path.length === 0) for (const sq of movable) out[String(sq)] = 'must';
    if (end !== undefined) {
      for (const t of targetsFor(moves, path)) {
        const j = jumpedSquare(end, t);
        if (j) out[String(j)] = 'threat';
      }
      for (const d of destinationsFor(moves, path)) if (!(String(d) in targets)) out[String(d)] = 'dest';
    }
    for (let i = 0; i + 1 < path.length; i++) {
      const j = jumpedSquare(path[i]!, path[i + 1]!);
      if (j) out[String(j)] = 'jumped';
    }
    if (path.length > 1) out[String(path[0])] = 'origin';
    return out;
  }, [interactive, mustCapture, movable, moves, path, end, targets]);

  const pieces = useMemo(() => {
    const out: Record<string, ReactNode> = {};
    const to = lastPath[lastPath.length - 1];
    for (let sq = 1; sq <= 32; sq++) {
      const cell = cellAt(board, sq);
      const color = pieceColor(cell);
      if (!color) continue;
      out[String(sq)] = (
        <CheckersPiece
          color={color}
          king={isKing(cell)}
          crowned={lastCrowned && sq === to}
          crownDelayMs={hopDurationMs(lastPath.length)}
          dim={path.length > 1 && sq === path[0]}
          mark={marks[String(sq)]}
        />
      );
    }
    // Captured pieces fade out on their squares as the jumper passes.
    if (prevBoard) {
      lastCaptures.forEach((sq, i) => {
        const cell = cellAt(prevBoard, sq);
        const color = pieceColor(cell);
        if (!color || pieceColor(cellAt(board, sq))) return;
        out[String(sq)] = <CheckersPiece color={color} king={isKing(cell)} fading fadeDelayMs={150 + 110 * i + 60} />;
      });
    }
    // Mid-chain: show the moving piece as a ghost on its current landing.
    if (path.length > 1 && end !== undefined) {
      const cell = cellAt(board, path[0]!);
      const color = pieceColor(cell);
      if (color) out[String(end)] = <CheckersPiece color={color} king={isKing(cell)} ghost />;
    }
    return out;
  }, [board, lastPath, lastCaptures, lastCrowned, prevBoard, path, end, marks]);

  const animation = useMemo<BoardAnimation | null>(
    () => (lastPath.length >= 2 ? { key: ply, paths: [lastPath.map(String)] } : null),
    [ply, lastPath],
  );

  const canPick = useCallback((id: string) => {
    const sq = toSq(id);
    return movable.has(sq) || (path.length > 1 && sq === end);
  }, [movable, path.length, end]);

  const apply = useCallback(
    (result: ReturnType<typeof clickSquare>, fallback: number[] | null) => {
      switch (result.kind) {
        case 'move':
          setPath([]);
          onMove(result.move);
          return;
        case 'select':
          setPath(result.path);
          return;
        default:
          if (fallback) setPath(fallback);
          else if (result.kind === 'clear') setPath([]);
      }
    },
    [onMove],
  );

  const onSelect = useCallback(
    (id: string | null) => {
      const sq = toSq(id);
      if (!sq) return setPath([]);
      if (movable.has(sq)) return setPath([sq]);
      // Tapping the ghost on the current landing keeps the chain.
    },
    [movable],
  );

  const onBoardMove = useCallback(
    (fromId: string, toId: string, via: 'click' | 'drag') => {
      const from = toSq(fromId);
      const to = toSq(toId);
      if (!from || !to) return;
      const base = path.length > 0 && path[path.length - 1] === from ? path : movable.has(from) ? [from] : null;
      if (!base) return;
      // An illegal drop snaps back with the piece still selected.
      const result = clickSquare(moves, base, to);
      if (via === 'drag' && (result.kind === 'clear' || result.kind === 'none')) onIllegal?.();
      apply(result, via === 'drag' ? base : null);
    },
    [path, movable, moves, apply, onIllegal],
  );

  const onSquareClick = useCallback(
    (id: string) => {
      const sq = toSq(id);
      if (!sq || path.length === 0) return;
      const result = clickSquare(moves, path, sq);
      if (result.kind === 'move') apply(result, null);
    },
    [path, moves, apply],
  );

  const squareName = useCallback(
    (id: string) => {
      const sq = toSq(id);
      if (!sq) return 'Light square';
      const cell = cellAt(board, sq);
      const color = pieceColor(cell);
      const parts = [`Square ${sq}`, color ? `${color === 'dark' ? 'Dark' : 'Light'} ${isKing(cell) ? 'king' : 'man'}` : 'empty'];
      if (path[0] === sq) parts.push('selected');
      else if (interactive && movable.has(sq)) parts.push(mustCapture ? 'must capture' : 'can move');
      if (id in targets || marks[id] === 'dest') parts.push('legal destination');
      if (marks[id] === 'jumped' || marks[id] === 'threat') parts.push('can be captured');
      return parts.join(', ');
    },
    [board, path, interactive, movable, mustCapture, targets, marks],
  );

  const squareLabel = useCallback((id: string) => (showNumbers && toSq(id) ? id : null), [showNumbers]);

  return (
    <SquareBoard
      className={cx('ck-board', className)}
      squareId={squareId}
      isDark={isDark}
      playable={isDark}
      flipped={flipped}
      pieces={pieces}
      selected={end === undefined ? null : String(end)}
      targets={targets}
      lastMove={lastPath.map(String)}
      captured={lastCaptures.map(String)}
      marks={marks}
      coordinates="none"
      squareLabel={squareLabel}
      squareName={squareName}
      interactive={interactive}
      canPick={canPick}
      onSelect={onSelect}
      onMove={onBoardMove}
      onSquareClick={onSquareClick}
      animation={animation}
      reducedMotion={reducedMotion}
      label={label}
    />
  );
});

const CheckersPiece = memo(function CheckersPiece({
  color,
  king,
  crowned = false,
  crownDelayMs = 0,
  dim = false,
  ghost = false,
  fading = false,
  fadeDelayMs = 0,
  mark,
}: {
  color: 'dark' | 'light';
  king: boolean;
  crowned?: boolean;
  crownDelayMs?: number;
  dim?: boolean;
  ghost?: boolean;
  fading?: boolean;
  fadeDelayMs?: number;
  mark?: string;
}) {
  return (
    <span
      className={cx('ck-piece', `ck-piece--${color}`, king && 'is-king', crowned && 'is-crowned', dim && 'is-dim', ghost && 'is-ghost', fading && 'is-captured')}
      style={{ '--ck-crown-delay': `${crownDelayMs}ms`, '--ck-delay': `${fadeDelayMs}ms` } as CSSProperties}
      data-mark={mark}
    >
      <PieceArt tone={color} king={king} className="ck-piece__art" />
      {mark && mark !== 'dest' && mark !== 'origin' ? <span className="ck-piece__mark" aria-hidden /> : null}
    </span>
  );
});
