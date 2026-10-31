/**
 * DAS Reversi board — a Reversi adapter over the Boardroom kit's <SquareBoard> for 6×6, 8×8 and
 * 10×10 boards.
 *
 * Mapping: cells are numbered from the top-left (a1) like a printed Reversi diagram, so the kit's
 * rank 0 (its bottom row) is the last row; the board is never flipped — both players read the same
 * coordinates. Squares out of play ('#': Octagon's corners, Blockers) are the kit's unplayable
 * squares: plain decoration, skipped by the keyboard.
 *
 * Input: a tap (or Enter) on a marked square places a disc; anything else is a soft "nope". While
 * it's your turn, pointing at (or focusing) a legal square previews the move: a ghost disc and the
 * discs it would flip. The server validates every placement.
 */
import { memo, useCallback, useMemo, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import type { BoardSide } from '@dascade/shared/games/boardroom';
import { REVERSI_SIDE_LABEL, REVERSI_VARIANT_INFO, type ReversiVariant } from '@dascade/shared/games/reversi';
import { cellName, flipsAt, sideOfDisc, type ReversiPosition } from '@dascade/game-core/reversi';
import { cx } from '@dascade/ui';
import { SquareBoard, type TargetKind } from '../_boardroom/index.ts';
import { Disc, colorOf } from './Disc.tsx';
import { cellOf, flipDelays, squareIdOf } from './position.ts';

const FILES = 'abcdefghij'.split('');
const NEVER_DARK = () => false;

export interface ReversiBoardProps {
  variant: ReversiVariant;
  board: string;
  /** The position the hints and the preview are computed on (null: no hints). */
  position: ReversiPosition | null;
  /** Squares the viewer may play now (empty when it isn't their turn). */
  moves: readonly number[];
  /** Whose disc the preview shows. */
  mover: BoardSide;
  lastCell: number;
  lastFlips: readonly number[];
  onMove: (cell: number) => void;
  /** A tap on a square that isn't a legal move (for a soft "nope" sound). */
  onIllegal?: () => void;
  reducedMotion: boolean;
  label: string;
  className?: string;
}

export const ReversiBoard = memo(function ReversiBoard(props: ReversiBoardProps) {
  const { variant, board, position, moves, mover, lastCell, lastFlips, onMove, onIllegal, reducedMotion, label, className } = props;
  const size = REVERSI_VARIANT_INFO[variant].size;
  const [hover, setHover] = useState(-1);

  const squareId = useCallback((file: number, rank: number) => squareIdOf(size, file, rank), [size]);
  // Stable while the squares out of play stay the same (the kit rebuilds its cells when it changes).
  const holes = useMemo(() => board.replace(/[bw]/g, '.'), [board]);
  const playable = useCallback((file: number, rank: number) => holes[(size - 1 - rank) * size + file] !== '#', [holes, size]);
  const rankLabels = useMemo(() => Array.from({ length: size }, (_, rank) => String(size - rank)), [size]);

  const legal = useMemo(() => new Set(moves), [moves]);
  const interactive = legal.size > 0;
  const previewCell = interactive && legal.has(hover) ? hover : -1;
  const previewFlips = useMemo(() => (position && previewCell >= 0 ? flipsAt(position, previewCell) : []), [position, previewCell]);

  const delays = useMemo(
    () => (reducedMotion ? new Map<number, number>() : flipDelays(variant, lastCell, lastFlips)),
    [reducedMotion, variant, lastCell, lastFlips],
  );

  const pieces = useMemo(() => {
    const out: Record<string, ReactNode> = {};
    for (let cell = 0; cell < board.length; cell++) {
      const token = board[cell];
      if (token === 'b' || token === 'w') out[String(cell)] = <Disc color={token} delayMs={delays.get(cell) ?? 0} />;
    }
    if (previewCell >= 0) out[String(previewCell)] = <Disc color={colorOf(mover)} ghost />;
    return out;
  }, [board, delays, previewCell, mover]);

  const targets = useMemo(() => {
    const out: Record<string, TargetKind> = {};
    for (const cell of moves) out[String(cell)] = 'move';
    return out;
  }, [moves]);

  const marks = useMemo(() => {
    const out: Record<string, string> = {};
    for (const cell of lastFlips) out[String(cell)] = 'flipped';
    for (const cell of previewFlips) out[String(cell)] = 'preview';
    if (previewCell >= 0) out[String(previewCell)] = 'ghost';
    return out;
  }, [lastFlips, previewFlips, previewCell]);

  const lastMove = useMemo(() => (lastCell >= 0 ? [String(lastCell)] : []), [lastCell]);

  const onSquareClick = useCallback(
    (id: string) => {
      const cell = cellOf(size, id);
      if (cell >= 0 && legal.has(cell)) onMove(cell);
      else onIllegal?.();
    },
    [size, legal, onMove, onIllegal],
  );

  const squareName = useCallback(
    (id: string) => {
      const cell = cellOf(size, id);
      if (cell < 0) return id;
      const side = sideOfDisc(board[cell]);
      const parts = [cellName(size, cell), side ? `${REVERSI_SIDE_LABEL[side]} disc` : 'empty'];
      if (legal.has(cell) && position) {
        const n = flipsAt(position, cell).length;
        parts.push(n > 0 ? `legal move, flips ${n}` : 'legal move');
      }
      if (cell === lastCell) parts.push('last move');
      return parts.join(', ');
    },
    [size, board, legal, position, lastCell],
  );

  // The preview follows the pointer and the keyboard focus (both bubble up from the squares).
  const track = useCallback(
    (e: PointerEvent<HTMLDivElement> | FocusEvent<HTMLDivElement>) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-sq]')?.dataset.sq;
      setHover(cellOf(size, id));
    },
    [size],
  );
  const clear = useCallback(() => setHover(-1), []);

  return (
    <div className="rv-board-host" onPointerOver={track} onPointerLeave={clear} onFocus={track} onBlur={clear}>
      <SquareBoard
        className={cx('rv-board', className)}
        files={size}
        ranks={size}
        squareId={squareId}
        isDark={NEVER_DARK}
        playable={playable}
        pieces={pieces}
        targets={targets}
        lastMove={lastMove}
        marks={marks}
        coordinates="edge"
        fileLabels={FILES}
        rankLabels={rankLabels}
        squareName={squareName}
        interactive={interactive}
        onSquareClick={onSquareClick}
        reducedMotion={reducedMotion}
        label={label}
      />
    </div>
  );
});
