/**
 * Card-shaped visuals: the bingo card, daub splats and pattern mini-grids.
 */
import { memo, type CSSProperties, type ReactNode } from 'react';
import { BINGO_FREE } from '@dascade/shared/games/bingo';
import { PixelArt, PixelIcon, cx } from '@dascade/ui';
import { BINGO_LETTERS, LETTER_COLORS, maskOf, textFit, tokenColor, tokenLabel, tokenText, useCycle } from './util.ts';

// ---------------------------------------------------------------------------
// Daub (pixel splat stamp)
// ---------------------------------------------------------------------------
const SPLATS: readonly (readonly string[])[] = [
  [
    '....##..#...',
    '..#.#####...',
    '...########.',
    '.#########..',
    '..##########',
    '.##########.',
    '###########.',
    '.##########.',
    '..#########.',
    '.#..######..',
    '.....##..#..',
    '............',
  ],
  [
    '.....#......',
    '..#.####.#..',
    '.#########..',
    '..#########.',
    '.##########.',
    '###########.',
    '.###########',
    '.##########.',
    '..########..',
    '.#.######.#.',
    '....#..##...',
    '............',
  ],
  [
    '...#...#....',
    '..########..',
    '.##########.',
    '###########.',
    '.###########',
    '.##########.',
    '############',
    '.##########.',
    '..#########.',
    '...######.#.',
    '.#...##.....',
    '............',
  ],
];

export const Daub = memo(function Daub({ color, variant = 0 }: { color: string; variant?: number }) {
  const rows = SPLATS[Math.abs(variant) % SPLATS.length]!;
  return (
    <span className="bg-daub" style={{ '--daub': color } as CSSProperties} aria-hidden>
      <PixelArt rows={rows} mainColor={color} />
    </span>
  );
});

// ---------------------------------------------------------------------------
// Pattern mini grid
// ---------------------------------------------------------------------------

export function PatternGrid({
  size,
  mask,
  freeIndex = null,
  className,
  label,
  tone,
}: {
  size: number;
  mask: readonly boolean[];
  freeIndex?: number | null;
  className?: string;
  label?: string;
  tone?: string;
}) {
  return (
    <div
      className={cx('bg-pgrid', className)}
      style={{ '--n': size, ...(tone ? { '--tone': tone } : {}) } as CSSProperties}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {Array.from({ length: size * size }, (_, i) => (
        <i key={i} data-on={mask[i] ? 'true' : undefined} data-free={i === freeIndex ? 'true' : undefined} />
      ))}
    </div>
  );
}

/** A pattern (possibly a family) shown as an animated mini grid that cycles through its variants. */
export function PatternCycler({
  size,
  masks,
  freeIndex,
  className,
  label,
  ms = 900,
}: {
  size: number;
  masks: readonly string[];
  freeIndex: number | null;
  className?: string;
  label: string;
  ms?: number;
}) {
  const i = useCycle(masks.length, ms);
  const mask = maskOf(masks[i] ?? '');
  return <PatternGrid size={size} mask={mask} freeIndex={freeIndex} className={className} label={label} />;
}

// ---------------------------------------------------------------------------
// Bingo card
// ---------------------------------------------------------------------------

export interface CardViewProps {
  size: number;
  cells: readonly number[];
  mode: 'numbers' | 'text';
  items: readonly string[];
  called: ReadonlySet<number>;
  /** Daubed cell indices. */
  marks: ReadonlySet<number>;
  /** Manual daubing: show "called but not daubed" hints. */
  hints?: boolean;
  /** Winning mask (gold). */
  highlight?: readonly boolean[] | null;
  /** Closest pattern (faint outline). */
  target?: readonly boolean[] | null;
  /** Token of the latest call (flashes on the card). */
  latest?: number | null;
  onCellClick?: (index: number) => void;
  serial?: number;
  compact?: boolean;
  title?: ReactNode;
  className?: string;
  label?: string;
}

export const BingoCardView = memo(function BingoCardView({
  size,
  cells,
  mode,
  items,
  called,
  marks,
  hints,
  highlight,
  target,
  latest,
  onCellClick,
  serial,
  compact,
  title,
  className,
  label = 'Bingo card',
}: CardViewProps) {
  const interactive = Boolean(onCellClick);
  return (
    <div
      className={cx('bg-card', compact && 'bg-card--compact', mode === 'text' && 'bg-card--text', className)}
      style={{ '--n': size } as CSSProperties}
      role="group"
      aria-label={label}
    >
      <div className="bg-card__inner">
      <div className="bg-card__head">
        {mode === 'numbers' && size === 5 ? (
          BINGO_LETTERS.map((l, i) => (
            <span key={l} className="bg-card__letter" style={{ '--tone': LETTER_COLORS[i] } as CSSProperties}>
              {l}
            </span>
          ))
        ) : (
          <span className="bg-card__title">{title ?? 'DAS BINGO'}</span>
        )}
      </div>
      <div className="bg-card__grid">
        {cells.map((token, i) => {
          const free = token === BINGO_FREE;
          const isCalled = free || called.has(token);
          const marked = free || marks.has(i);
          const text = free ? '' : tokenText(mode, token, items);
          const col = i % size;
          const color = free ? 'var(--accent)' : mode === 'numbers' ? (LETTER_COLORS[col] as string) : tokenColor(mode, token);
          const aria = free
            ? 'Free square'
            : `${tokenLabel(mode, token, items)}${isCalled ? ', called' : ''}${marked ? ', daubed' : ''}${highlight?.[i] ? ', winning square' : ''}`;
          const common = {
            className: 'bg-cell',
            'data-free': free ? 'true' : undefined,
            'data-called': isCalled ? 'true' : undefined,
            'data-marked': marked ? 'true' : undefined,
            'data-hint': hints && isCalled && !marked ? 'true' : undefined,
            'data-win': highlight?.[i] ? 'true' : undefined,
            'data-target': target?.[i] && !marked && !(hints && isCalled) ? 'true' : undefined,
            'data-latest': latest !== null && latest !== undefined && token === latest ? 'true' : undefined,
            style: { '--fit': mode === 'text' ? textFit(text) : undefined, '--tone': color } as CSSProperties,
          };
          const inner = (
            <>
              {marked ? <Daub color={color} variant={i * 7 + (free ? 1 : token)} /> : null}
              {free ? (
                <span className="bg-cell__free">
                  <PixelIcon name="star" />
                  <span>FREE</span>
                </span>
              ) : (
                <span className="bg-cell__text">{text}</span>
              )}
              {hints && isCalled && !marked ? <span className="bg-cell__hint" aria-hidden /> : null}
            </>
          );
          return interactive && !free ? (
            <button key={i} type="button" {...common} aria-label={aria} aria-pressed={marked} onClick={() => onCellClick?.(i)}>
              {inner}
            </button>
          ) : (
            <div key={i} {...common} role="img" aria-label={aria}>
              {inner}
            </div>
          );
        })}
      </div>
      {serial ? <div className="bg-card__serial">Card #{String(serial).padStart(4, '0')}</div> : null}
      </div>
    </div>
  );
});
