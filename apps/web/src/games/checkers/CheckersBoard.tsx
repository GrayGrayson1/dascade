/**
 * DAS Checkers board — a checkers adapter over the Boardroom kit's <SquareBoard>, for 8×8, 10×10
 * and 12×12 boards.
 *
 * Mapping: the kit's (file, rank) is seen from Dark — rank 0 is Dark's back row. Standard numbering
 * puts Dark's back row (1, 2, …) at the top of the diagram, so diagram row = rank and diagram
 * column = size − 1 − file; `flipped` (Light at the bottom) shows the diagram the right way up.
 * Square ids are the numbers "1"…"32" / "50" / "72"; light (unplayable) squares get ids like "x0-3".
 *
 * Input: the kit reports taps/drags; this adapter keeps the partial path of a multi-jump. After an
 * intermediate landing the piece shows as a ghost there with the jumped piece marked, and the next
 * landings light up. Forced continuations complete themselves; a final destination further down the
 * chain can be tapped directly. The server validates every submitted path.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cellAt, geometryFor, isKing, pieceColor, rcSquare, type BoardGeometry, type CheckersMove } from '@dascade/game-core/checkers';
import { cx } from '@dascade/ui';
import { SquareBoard, type BoardAnimation, type TargetKind } from '../_boardroom/index.ts';
import { PieceArt } from './Piece.tsx';
import { clickSquare, destinationsFor, jumpedAlong, jumpedOnHop, movablePieces, targetsFor } from './selection.ts';

/** Kit hop timing (SquareBoard animates 150 ms + 110 ms per hop). */
export function hopDurationMs(pathLength: number): number {
  return 150 + 110 * Math.max(1, pathLength - 1);
}

/** Square ids, colours and id → number for one board size (stable functions per size). */
interface BoardMap {
  geo: BoardGeometry;
  squareId: (file: number, rank: number) => string;
  isDark: (file: number, rank: number) => boolean;
  toSq: (id: string | null | undefined) => number;
}
const maps = new Map<number, BoardMap>();
function boardMap(size: number): BoardMap {
  let map = maps.get(size);
  if (!map) {
    const geo = geometryFor(size);
    const at = (file: number, rank: number) => rcSquare(geo, rank, size - 1 - file);
    map = {
      geo,
      squareId: (file, rank) => {
        const sq = at(file, rank);
        return sq ? String(sq) : `x${file}-${rank}`;
      },
      isDark: (file, rank) => at(file, rank) !== 0,
      toSq: (id) => {
        const n = Number(id);
        return Number.isInteger(n) && n >= 1 && n <= geo.squares ? n : 0;
      },
    };
    maps.set(size, map);
  }
  return map;
}

export interface CheckersBoardProps {
  /** Board edge: 8, 10 or 12 (the board string has size² / 2 squares). */
  size: number;
  board: string;
  ply: number;
  lastPath: readonly number[];
  lastCaptures: readonly number[];
  /** The last move crowned a man (glint on its landing square). */
  lastCrowned: boolean;
  /** Dark at the bottom unless flipped (Light at the bottom). */
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
  const { size, board, ply, lastPath, lastCaptures, lastCrowned, flipped, moves, mustCapture, onMove, onIllegal, reducedMotion, showNumbers, label, className } = props;
  const { geo, squareId, isDark, toSq } = boardMap(size);
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
    for (const t of targetsFor(moves, path)) out[String(t)] = jumpedOnHop(moves, path, t) ? 'capture' : 'move';
    return out;
  }, [moves, path, end]);

  const marks = useMemo(() => {
    const out: Record<string, string> = {};
    if (interactive && mustCapture && path.length === 0) for (const sq of movable) out[String(sq)] = 'must';
    if (end !== undefined) {
      for (const t of targetsFor(moves, path)) {
        const j = jumpedOnHop(moves, path, t);
        if (j) out[String(j)] = 'threat';
      }
      for (const d of destinationsFor(moves, path)) if (!(String(d) in targets)) out[String(d)] = 'dest';
    }
    for (const j of jumpedAlong(moves, path)) out[String(j)] = 'jumped';
    if (path.length > 1) out[String(path[0])] = 'origin';
    return out;
  }, [interactive, mustCapture, movable, moves, path, end, targets]);

  const pieces = useMemo(() => {
    const out: Record<string, ReactNode> = {};
    const to = lastPath[lastPath.length - 1];
    for (let sq = 1; sq <= geo.squares; sq++) {
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
  }, [geo.squares, board, lastPath, lastCaptures, lastCrowned, prevBoard, path, end, marks]);

  const animation = useMemo<BoardAnimation | null>(
    () => (lastPath.length >= 2 ? { key: ply, paths: [lastPath.map(String)] } : null),
    [ply, lastPath],
  );

  const canPick = useCallback((id: string) => {
    const sq = toSq(id);
    return movable.has(sq) || (path.length > 1 && sq === end);
  }, [toSq, movable, path.length, end]);

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
    [toSq, movable],
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
    [toSq, path, movable, moves, apply, onIllegal],
  );

  const onSquareClick = useCallback(
    (id: string) => {
      const sq = toSq(id);
      if (!sq || path.length === 0) return;
      const result = clickSquare(moves, path, sq);
      if (result.kind === 'move') apply(result, null);
    },
    [toSq, path, moves, apply],
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
    [toSq, board, path, interactive, movable, mustCapture, targets, marks],
  );

  const squareLabel = useCallback((id: string) => (showNumbers && toSq(id) ? id : null), [toSq, showNumbers]);

  return (
    <SquareBoard
      className={cx('ck-board', className)}
      files={size}
      ranks={size}
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
