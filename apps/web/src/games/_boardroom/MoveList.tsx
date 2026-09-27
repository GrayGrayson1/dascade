/**
 * DAS Boardroom kit — move list. Fed pre-formatted per-ply strings ("e4", "Nf3+", "11-15", "15x22x29").
 * 'table' = numbered pairs (desktop side panel); 'strip' = one horizontally scrolling row (phones).
 * Optional review: clicking a move calls onSelect(plyIndex); onSelect(null) returns to the live position.
 */
import { useEffect, useRef } from 'react';
import { cx } from '@dascade/ui';

export interface MoveListProps {
  moves: readonly string[];
  /** Labels for the first and second side (for accessible names). */
  sideLabels: readonly [string, string];
  /** Ply index being reviewed (null = live, the last move is highlighted). */
  current?: number | null;
  onSelect?: (ply: number | null) => void;
  layout?: 'table' | 'strip';
  /** Shown when there are no moves yet. */
  emptyText?: string;
  className?: string;
  /** Accessible label. */
  label?: string;
}

export function MoveList({
  moves,
  sideLabels,
  current = null,
  onSelect,
  layout = 'table',
  emptyText = 'No moves yet',
  className,
  label = 'Moves',
}: MoveListProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const active = current ?? moves.length - 1;

  // Keep the active move in view (latest by default).
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    const list = listRef.current;
    if (!el || !list) return;
    if (layout === 'strip') list.scrollTo({ left: el.offsetLeft - list.clientWidth / 2 + el.clientWidth / 2, behavior: 'auto' });
    else {
      const top = el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2;
      list.scrollTo({ top, behavior: 'auto' });
    }
  }, [active, moves.length, layout]);

  const rows: Array<{ n: number; plies: number[] }> = [];
  for (let i = 0; i < moves.length; i += 2) rows.push({ n: i / 2 + 1, plies: [i, i + 1].filter((p) => p < moves.length) });

  const cell = (ply: number) => {
    const text = moves[ply]!;
    const side = sideLabels[ply % 2];
    const isActive = ply === active;
    const name = `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '…'} ${side} ${text}`;
    return onSelect ? (
      <button
        key={ply}
        type="button"
        className="br-moves__move"
        data-active={isActive || undefined}
        aria-current={isActive ? 'step' : undefined}
        aria-label={name}
        onClick={() => onSelect(ply === moves.length - 1 ? null : ply)}
      >
        {text}
      </button>
    ) : (
      <span key={ply} className="br-moves__move" data-active={isActive || undefined} aria-label={name}>
        {text}
      </span>
    );
  };

  return (
    <div className={cx('br-moves', `br-moves--${layout}`, className)} data-part="move-list">
      {moves.length === 0 ? (
        <p className="br-moves__empty">{emptyText}</p>
      ) : (
        <ol ref={listRef} className="br-moves__list" aria-label={label}>
          {rows.map((row) => (
            <li key={row.n} className="br-moves__row">
              <span className="br-moves__num br-num" aria-hidden>
                {row.n}.
              </span>
              {row.plies.map(cell)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
