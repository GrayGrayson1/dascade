/**
 * DAS Tic-Tac-Toe marks: hand-drawn X and O strokes (SVG, drawn in when they appear), the Numbers
 * digits, Nesting's three piece sizes, Four in a Row's discs and the side swatches for player cards. Colours come from
 * --tt-* custom properties in tictactoe.css; X and O keep their colours in every theme (they mean
 * the players), Notakto's shared X uses the ink colour.
 */
import { memo } from 'react';
import type { BoardSide } from '@dascade/shared/games/boardroom';
import { TTT_SIZE_LABEL, TTT_VARIANT_INFO, type TttMark, type TttSize, type TttVariant } from '@dascade/shared/games/tictactoe';
import { markOf, topOf } from '@dascade/game-core/tictactoe';
import { cx } from '@dascade/ui';

export const Glyph = memo(function Glyph({ mark, ink, className }: { mark: TttMark; ink?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={cx('tt-glyph', `tt-glyph--${mark}`, ink && 'tt-glyph--ink', className)}
      aria-hidden
      focusable="false"
    >
      {mark === 'x' ? (
        <>
          <path className="tt-stroke" d="M26 26 L74 74" pathLength={1} />
          <path className="tt-stroke tt-stroke--late" d="M74 26 L26 74" pathLength={1} />
        </>
      ) : (
        <circle className="tt-stroke" cx="50" cy="50" r="25" pathLength={1} transform="rotate(-80 50 50)" />
      )}
    </svg>
  );
});

/** Nesting: a piece seen from above — a disc sized by its size with its owner's mark on top. */
export const Piece = memo(function Piece({ owner, size, className }: { owner: TttMark; size: TttSize; className?: string }) {
  return (
    <span className={cx('tt-piece', `tt-piece--${owner}`, className)} data-size={size} aria-hidden>
      <Glyph mark={owner} />
    </span>
  );
});

/** Four in a Row: a disc in its player's colour, embossed with the player's mark (colour is never the only cue). */
export const Disc = memo(function Disc({ mark, className }: { mark: TttMark; className?: string }) {
  return (
    <span className={cx('tt-disc', `tt-disc--${mark}`, className)} aria-hidden>
      <Glyph mark={mark} />
    </span>
  );
});

/** Four in a Row: "Pink disc" / "Blue disc". */
function discName(mark: string): string {
  return `${TTT_VARIANT_INFO.gravity.sides[mark === 'o' ? 1 : 0]} disc`;
}

/** Nesting: the pieces under the visible one, smallest last. */
function covered(stack: string): Array<{ owner: TttMark; size: TttSize }> {
  const out: Array<{ owner: TttMark; size: TttSize }> = [];
  for (let i = 0; i + 2 <= stack.length - 2; i += 2) out.push({ owner: stack[i] as TttMark, size: Number(stack[i + 1]) as TttSize });
  return out.reverse();
}

/** What a cell shows for its token. */
export function CellContent({ variant, token }: { variant: TttVariant; token: string }) {
  if (!token) return null;
  if (variant === 'numbers') {
    const n = Number(token);
    return <span className={cx('tt-number', n % 2 ? 'tt-number--odd' : 'tt-number--even')}>{token}</span>;
  }
  if (variant === 'nesting') {
    const top = topOf(token);
    if (!top) return null;
    const under = covered(token);
    return (
      <>
        <Piece owner={top.owner} size={top.size} />
        {under.length ? (
          <span className="tt-under" aria-hidden>
            {under.map((p, i) => (
              <span key={i} className={cx('tt-under__dot', `tt-under__dot--${p.owner}`)} data-size={p.size} />
            ))}
          </span>
        ) : null}
      </>
    );
  }
  if (variant === 'gravity') return <Disc mark={token as TttMark} />;
  return <Glyph mark={token as TttMark} ink={variant === 'notakto'} />;
}

/** Accessible description of a cell's token. */
export function describeToken(variant: TttVariant, token: string): string {
  if (!token) return 'empty';
  if (variant === 'numbers') return token;
  if (variant === 'gravity') return discName(token);
  if (variant === 'nesting') {
    const top = topOf(token);
    if (!top) return 'empty';
    const under = covered(token);
    const desc = `${TTT_SIZE_LABEL[top.size].toLowerCase()} ${top.owner.toUpperCase()}`;
    return under.length
      ? `${desc}, covering ${under.map((p) => `${TTT_SIZE_LABEL[p.size].toLowerCase()} ${p.owner.toUpperCase()}`).join(' and ')}`
      : desc;
  }
  return token.toUpperCase();
}

/** The little marker on a player card and in the result card. */
export function SideSwatch({ variant, side, className }: { variant: TttVariant; side: BoardSide; className?: string }) {
  if (variant === 'numbers') {
    return (
      <span className={cx('tt-swatch', 'tt-swatch--num', side === 'first' ? 'tt-number--odd' : 'tt-number--even', className)}>
        {side === 'first' ? '1' : '2'}
      </span>
    );
  }
  if (variant === 'wild' || variant === 'notakto' || variant === 'orderchaos') {
    return (
      <span className={cx('tt-swatch', 'tt-swatch--seat', className)} data-side={side}>
        {variant === 'orderchaos' ? (side === 'first' ? 'O' : 'C') : side === 'first' ? '1' : '2'}
      </span>
    );
  }
  return (
    <span className={cx('tt-swatch', className)}>
      {variant === 'gravity' ? <Disc mark={markOf(variant, side)} /> : <Glyph mark={markOf(variant, side)} />}
    </span>
  );
}
