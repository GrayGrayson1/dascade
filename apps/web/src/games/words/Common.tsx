/**
 * DASwords shared pieces: letter tiles, the word form, my word list, verdict line, scoring legend.
 */
import { forwardRef, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ANAGRAM_BONUS,
  CHAIN_BONUS,
  FORBIDDEN_POINTS,
  WORDS_REJECT_TEXT,
  WORD_LENGTH_POINTS,
  tileLabel,
  type WordsEntry,
  type WordsMode,
  type WordsPrivate,
} from '@dascade/shared/games/words';
import { Button, PixelArt, cx } from '@dascade/ui';
import { MODE_ART } from './art.ts';
import { lettersOnly } from './hooks.ts';

// ---------------------------------------------------------------------------
// Letter tile (presentational)
// ---------------------------------------------------------------------------

export function LetterTile({ letter, size = 'md', state, className, style }: { letter: string; size?: 'sm' | 'md' | 'lg' | 'xl'; state?: 'on' | 'used' | 'good' | 'bad' | 'ban'; className?: string; style?: CSSProperties }) {
  const label = tileLabel(letter);
  return (
    <span className={cx('wd-tile', `wd-tile--${size}`, className)} data-part="tile" data-state={state} data-long={label.length > 1 ? 'true' : undefined} style={style} aria-hidden="true">
      <span className="wd-tile__face">{label}</span>
    </span>
  );
}

/** A word spelled in small tiles (reveals, chain trail). */
export function TileWord({ word, size = 'sm', highlightFrom, className }: { word: string; size?: 'sm' | 'md' | 'lg'; highlightFrom?: number; className?: string }) {
  const letters = word.split('');
  return (
    <span className={cx('wd-tileword', className)} role="img" aria-label={word.toUpperCase()}>
      {letters.map((l, i) => (
        <LetterTile key={i} letter={l} size={size} state={highlightFrom !== undefined && i >= highlightFrom ? 'on' : undefined} />
      ))}
    </span>
  );
}

export function ModeGlyph({ mode, className }: { mode: WordsMode; className?: string }) {
  return <PixelArt rows={MODE_ART[mode]} className={cx('wd-glyph', className)} />;
}

// ---------------------------------------------------------------------------
// Word form
// ---------------------------------------------------------------------------

export interface WordFormProps {
  label: string;
  placeholder?: string;
  disabled?: boolean;
  /** Pre-fill (e.g. the chain link letters); re-applied when `resetKey` changes. */
  initial?: string;
  resetKey?: string | number;
  /** Letter that must not be typed (highlighted live; submit blocked). */
  forbidden?: string;
  /** Allow spaces (multi-word answers). */
  phrase?: boolean;
  maxLength?: number;
  submitLabel?: string;
  onSubmit: (text: string) => void;
  /** Live value callback (e.g. highlight a path on the grid). */
  onChange?: (text: string) => void;
  autoFocus?: boolean;
  hint?: ReactNode;
}

export const WordForm = forwardRef<HTMLInputElement, WordFormProps>(function WordForm(
  { label, placeholder, disabled, initial = '', resetKey, forbidden, phrase, maxLength = 32, submitLabel = 'Submit', onSubmit, onChange, autoFocus, hint },
  ref,
) {
  const [value, setValue] = useState(initial);
  const inner = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    setValue(initial);
    onChange?.(initial);
    // Only when the prompt changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  const clean = phrase ? value.replace(/\s+/g, ' ').trim() : lettersOnly(value);
  const hasBanned = Boolean(forbidden && lettersOnly(value).includes(forbidden));
  const send = () => {
    if (!clean || disabled || hasBanned) return;
    onSubmit(clean);
    setValue(initial);
    onChange?.(initial);
    inner.current?.focus();
  };
  return (
    <form
      className="wd-form"
      data-banned={hasBanned ? 'true' : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label className="visually-hidden" htmlFor={`wd-input-${label.replace(/\W+/g, '-')}`}>
        {label}
      </label>
      <div className="wd-form__field">
        <input
          id={`wd-input-${label.replace(/\W+/g, '-')}`}
          ref={(el) => {
            inner.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) ref.current = el;
          }}
          className="wd-form__input"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="send"
          autoFocus={autoFocus}
          aria-invalid={hasBanned || undefined}
          onChange={(e) => {
            const next = phrase ? e.currentTarget.value.replace(/[^\p{L}\s'-]/gu, '') : e.currentTarget.value.replace(/[^\p{L}]/gu, '');
            setValue(next);
            onChange?.(next);
          }}
        />
        {forbidden ? <ForbiddenPreview value={value} letter={forbidden} /> : null}
      </div>
      <Button type="submit" variant="primary" size="lg" icon="arrow-right" disabled={disabled || !clean || hasBanned} className="wd-form__send">
        {submitLabel}
      </Button>
      {hasBanned ? (
        <p className="wd-form__warn" role="alert">
          That uses the forbidden letter {forbidden?.toUpperCase()}.
        </p>
      ) : hint ? (
        <p className="wd-form__hint">{hint}</p>
      ) : null}
    </form>
  );
});

/** Mirrors the typed text with every forbidden letter marked (visual only; the input stays editable). */
function ForbiddenPreview({ value, letter }: { value: string; letter: string }) {
  if (!value) return null;
  const chars = Array.from(value);
  return (
    <span className="wd-form__mirror" aria-hidden="true">
      {chars.map((ch, i) => (
        <span key={i} data-bad={lettersOnly(ch) === letter ? 'true' : undefined}>
          {ch}
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Verdict line + my entries
// ---------------------------------------------------------------------------

/** The latest verdict ("+5 QUEST" / "ZORP — not in the dictionary"). Announced politely. */
export function VerdictLine({ priv, idle }: { priv: WordsPrivate | null; idle?: ReactNode }) {
  const last = priv?.last ?? null;
  return (
    <p className="wd-verdict" data-tone={!last ? 'idle' : last.ok ? (last.pending ? 'pending' : 'good') : 'bad'} aria-live="polite" key={priv?.seq ?? 0}>
      {!last ? (
        <span className="wd-verdict__idle">{idle}</span>
      ) : last.ok ? (
        last.pending ? (
          <>
            <strong>{last.word.toUpperCase()}</strong> is valid — the host will check it fits.
          </>
        ) : (
          <>
            <span className="wd-verdict__pts dc-num">+{last.points}</span> <strong>{last.word.toUpperCase()}</strong>
          </>
        )
      ) : (
        <>
          <strong>{last.word.toUpperCase()}</strong> — {last.reason ? WORDS_REJECT_TEXT[last.reason] : 'Not accepted'}
        </>
      )}
    </p>
  );
}

const STATUS_TEXT = { ok: 'Accepted', pending: 'Waiting for the host', rejected: 'Not accepted' } as const;

/** My words this round: accepted first (newest first), then the latest rejections. */
export function EntryList({ entries, title = 'Your words', empty, onHover, compact }: { entries: WordsEntry[]; title?: string; empty?: ReactNode; onHover?: (e: WordsEntry | null) => void; compact?: boolean }) {
  const good = entries.filter((e) => e.status !== 'rejected').reverse();
  const bad = entries.filter((e) => e.status === 'rejected').reverse().slice(0, 6);
  const total = good.reduce((n, e) => n + (e.status === 'ok' ? e.points : 0), 0);
  return (
    <section className={cx('wd-entries', compact && 'wd-entries--compact')} data-part="word-list" aria-label={title}>
      <header className="wd-entries__head">
        <h3 className="wd-entries__title">{title}</h3>
        <span className="wd-entries__sum">
          <span className="dc-num">{good.length}</span> {good.length === 1 ? 'word' : 'words'} · <span className="dc-num">{total}</span> pts
        </span>
      </header>
      {good.length === 0 && bad.length === 0 ? <p className="wd-entries__empty">{empty ?? 'Nothing yet — get typing!'}</p> : null}
      <ul className="wd-entries__list">
        {good.map((e) => (
          <li
            key={e.id}
            className="wd-chip"
            data-status={e.status}
            onPointerEnter={onHover ? (ev) => ev.pointerType === 'mouse' && onHover(e) : undefined}
            onPointerLeave={onHover ? () => onHover(null) : undefined}
            aria-label={`${e.word}, ${STATUS_TEXT[e.status]}${e.status === 'ok' ? `, ${e.points} points` : ''}${e.known ? ', auto-approved' : ''}`}
          >
            <span className="wd-chip__word">{e.word}</span>
            {e.full ? <span className="wd-chip__tag" data-tag="full">ALL</span> : null}
            {e.rare ? <span className="wd-chip__tag" data-tag="rare">RARE</span> : null}
            {e.status === 'pending' ? <span className="wd-chip__tag" data-tag="pending">?</span> : <span className="wd-chip__pts dc-num">{e.points}</span>}
          </li>
        ))}
        {bad.map((e) => (
          <li key={e.id} className="wd-chip" data-status="rejected" aria-label={`${e.word}, not accepted: ${e.reason ? WORDS_REJECT_TEXT[e.reason] : ''}`}>
            <span className="wd-chip__word">{e.word}</span>
            <span className="wd-chip__why">{e.reason ? WORDS_REJECT_TEXT[e.reason] : '✕'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Scoring legend
// ---------------------------------------------------------------------------

export function ScoreLegend({ mode, uniqueOnly }: { mode: WordsMode; uniqueOnly?: boolean }) {
  if (mode === 'forbidden') {
    return (
      <div className="wd-legend" aria-label="Scoring">
        <span className="wd-legend__item">
          Approved answer <b className="dc-num">{FORBIDDEN_POINTS.answer}</b>
        </span>
        <span className="wd-legend__item">
          Nobody else said it <b className="dc-num">+{FORBIDDEN_POINTS.unique}</b>
        </span>
      </div>
    );
  }
  return (
    <div className="wd-legend" aria-label="Scoring">
      <span className="wd-legend__label">Letters → points</span>
      {WORD_LENGTH_POINTS.map((r) => (
        <span key={r.length} className="wd-legend__item">
          <span className="dc-num">{r.label}</span>
          <b className="dc-num">{r.points}</b>
        </span>
      ))}
      {mode === 'anagram' ? (
        <>
          <span className="wd-legend__item">
            Rare <b className="dc-num">+{ANAGRAM_BONUS.rare}</b>
          </span>
          <span className="wd-legend__item">
            Every letter <b className="dc-num">+{ANAGRAM_BONUS.fullRack}</b>
          </span>
          <span className="wd-legend__item">
            Only you <b className="dc-num">×{ANAGRAM_BONUS.uniqueMultiplier}</b>
          </span>
        </>
      ) : null}
      {mode === 'chain' ? (
        <>
          <span className="wd-legend__item">
            Link maker <b className="dc-num">+{CHAIN_BONUS.link}</b>
          </span>
          <span className="wd-legend__item">
            Survivor <b className="dc-num">+{CHAIN_BONUS.survivor}</b>
          </span>
        </>
      ) : null}
      {mode === 'grid' && uniqueOnly ? <span className="wd-legend__item wd-legend__item--warn">Shared words score 0</span> : null}
    </div>
  );
}
