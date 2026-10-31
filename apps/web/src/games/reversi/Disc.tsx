/**
 * DAS Reversi discs: a two-faced disc (Black on one side, White on the other) that turns over in 3D
 * when its colour changes — the same element stays on its square, so the change of `color` plays
 * the flip (after `delayMs`, for the outward stagger). Reduced motion swaps the face instantly.
 *
 * Colours come from CSS custom properties declared once in reversi.css (`--rv-black-*`,
 * `--rv-white-*`) so a theme can restyle the set without touching this file.
 */
import { memo, type CSSProperties } from 'react';
import type { BoardSide } from '@dascade/shared/games/boardroom';
import { cx } from '@dascade/ui';

export type DiscColor = 'b' | 'w';

export function colorOf(side: BoardSide): DiscColor {
  return side === 'first' ? 'b' : 'w';
}

export const Disc = memo(function Disc({
  color,
  delayMs = 0,
  ghost = false,
  className,
}: {
  color: DiscColor;
  delayMs?: number;
  /** The hover preview of a move (translucent). */
  ghost?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx('rv-disc', ghost && 'is-ghost', className)}
      data-color={color}
      style={{ '--rv-delay': `${delayMs}ms` } as CSSProperties}
      aria-hidden
    >
      <span className="rv-disc__body">
        <span className="rv-disc__face rv-disc__face--b" />
        <span className="rv-disc__face rv-disc__face--w" />
      </span>
    </span>
  );
});

/** Small inline swatch for player cards, the status line and results ("Black", "White"). */
export function DiscSwatch({ side, className }: { side: BoardSide; className?: string }) {
  return (
    <span className={cx('rv-swatch', className)} data-side={side}>
      <Disc color={colorOf(side)} />
    </span>
  );
}
