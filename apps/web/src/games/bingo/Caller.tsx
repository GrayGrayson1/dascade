/**
 * The caller: an animated ball that rolls in with every call, the call plaque,
 * recent balls and the lit call board.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { BINGO_BALLS } from '@dascade/shared/games/bingo';
import { Badge, PixelIcon, TextInput, cx } from '@dascade/ui';
import { BINGO_LETTERS, LETTER_COLORS, tokenColor, tokenLabel, tokenLetter, tokenText } from './util.ts';

// ---------------------------------------------------------------------------
// Ball
// ---------------------------------------------------------------------------

export function Ball({
  token,
  mode,
  items,
  size = 'lg',
  animate = true,
  className,
}: {
  token: number | null;
  mode: 'numbers' | 'text';
  items: readonly string[];
  size?: 'xs' | 'sm' | 'md' | 'lg';
  animate?: boolean;
  className?: string;
}) {
  if (token === null) {
    return (
      <div className={cx('bg-ball', `bg-ball--${size}`, 'bg-ball--empty', className)} aria-hidden>
        <span className="bg-ball__face">
          <span className="bg-ball__letter">DAS</span>
          <span className="bg-ball__num">?</span>
        </span>
      </div>
    );
  }
  const color = tokenColor(mode, token);
  const num = mode === 'numbers' ? String(token) : String(token + 1);
  return (
    <div
      className={cx('bg-ball', `bg-ball--${size}`, animate && 'bg-ball--roll', className)}
      style={{ '--ball': color } as CSSProperties}
      role="img"
      aria-label={tokenLabel(mode, token, items)}
    >
      <span className="bg-ball__face">
        <span className="bg-ball__letter">{tokenLetter(mode, token)}</span>
        <span className="bg-ball__num" data-digits={num.length}>
          {num}
        </span>
      </span>
    </div>
  );
}

/** Ring that drains until the next automatic call (remount with a new key per call). */
export function CallTimer({ remainingMs, intervalMs }: { remainingMs: number; intervalMs: number }) {
  if (remainingMs <= 0) return null;
  const start = Math.min(1, Math.max(0, 1 - remainingMs / Math.max(1, intervalMs)));
  return (
    <svg className="bg-timer" viewBox="0 0 100 100" aria-hidden>
      <circle className="bg-timer__track" cx="50" cy="50" r="46" />
      <circle className="bg-timer__bar" cx="50" cy="50" r="46" pathLength={100} style={{ animationDuration: `${remainingMs}ms`, '--start': start } as CSSProperties} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Call board
// ---------------------------------------------------------------------------

export function NumberBoard({
  called,
  latest,
  onPick,
  compact,
}: {
  called: ReadonlySet<number>;
  latest: number | null;
  onPick?: (token: number) => void;
  compact?: boolean;
}) {
  return (
    <div className={cx('bg-board', compact && 'bg-board--compact')} role="group" aria-label={`Call board: ${called.size} of ${BINGO_BALLS} called`}>
      {BINGO_LETTERS.map((letter, row) => (
        <div key={letter} className="bg-board__row" style={{ '--tone': LETTER_COLORS[row] } as CSSProperties}>
          <span className="bg-board__letter">{letter}</span>
          {Array.from({ length: 15 }, (_, i) => {
            const n = row * 15 + i + 1;
            const on = called.has(n);
            const cls = cx('bg-board__cell', on && 'is-on', latest === n && 'is-latest');
            return onPick && !on ? (
              <button key={n} type="button" className={cx(cls, 'is-pickable')} onClick={() => onPick(n)} aria-label={`Call ${letter} ${n}`}>
                {n}
              </button>
            ) : (
              <span key={n} className={cls} aria-label={`${letter} ${n}${on ? ' called' : ''}`}>
                {n}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function TextBoard({
  items,
  calls,
  latest,
  onPick,
}: {
  items: readonly string[];
  calls: readonly number[];
  latest: number | null;
  onPick?: (token: number) => void;
}) {
  const [query, setQuery] = useState('');
  const called = useMemo(() => new Set(calls), [calls]);
  const recent = useMemo(() => [...calls].reverse(), [calls]);
  const remaining = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.map((text, token) => ({ text, token })).filter((it) => !called.has(it.token) && (!q || it.text.toLowerCase().includes(q)));
  }, [items, called, query]);
  return (
    <div className="bg-tboard">
      <div className="bg-tboard__meta">
        <Badge color="var(--accent)">
          {calls.length} / {items.length} called
        </Badge>
      </div>
      {recent.length === 0 ? <p className="bg-empty-note">No calls yet — the first square is on its way.</p> : null}
      <ol className="bg-tboard__list" aria-label="Called squares, newest first">
        {recent.map((token, i) => (
          <li key={token} className={cx('bg-tboard__item', token === latest && 'is-latest')} style={{ '--tone': tokenColor('text', token) } as CSSProperties}>
            <span className="bg-tboard__no">{calls.length - i}</span>
            <span className="bg-tboard__text">{tokenText('text', token, items)}</span>
          </li>
        ))}
      </ol>
      {onPick ? (
        <div className="bg-tboard__pick">
          <span className="dc-label">Call a specific square</span>
          <TextInput value={query} placeholder="Search remaining squares…" aria-label="Search remaining squares" onChange={(e) => setQuery(e.currentTarget.value)} />
          <div className="bg-tboard__options">
            {remaining.slice(0, 40).map((it) => (
              <button key={it.token} type="button" className="bg-chip" onClick={() => onPick(it.token)} aria-label={`Call ${it.text}`}>
                <PixelIcon name="plus" /> {it.text}
              </button>
            ))}
            {remaining.length === 0 ? <span className="dc-muted">Nothing matches.</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
