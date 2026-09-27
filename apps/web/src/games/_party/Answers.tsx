/**
 * Party kit — answering UI: big answer buttons, typed answers with lock-in, the
 * "who has answered" strip (never what) and the vote grid.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import type { PlayerView } from '@dascade/shared';
import type { PartySeatView } from '@dascade/shared/party';
import { Avatar, Button, PixelIcon, TextInput, cx } from '@dascade/ui';

// ---------------------------------------------------------------------------
// Slot identity: letter + shape + colour (never colour alone)
// ---------------------------------------------------------------------------

export const SLOT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
const SLOT_SHAPES = ['triangle', 'diamond', 'circle', 'square', 'star', 'hex'] as const;
type SlotShapeName = (typeof SLOT_SHAPES)[number];

const SHAPE_POINTS: Record<SlotShapeName, string> = {
  triangle: '8,2 14,13 2,13',
  diamond: '8,1 15,8 8,15 1,8',
  circle: '5,1 11,1 15,5 15,11 11,15 5,15 1,11 1,5',
  square: '2,2 14,2 14,14 2,14',
  star: '8,1 10,6 15,6 11,9 13,15 8,11 3,15 5,9 1,6 6,6',
  hex: '4,1 12,1 15,8 12,15 4,15 1,8',
};

/** Small pixel shape glyph for answer slot `index`. */
export function SlotShape({ index, size = 16 }: { index: number; size?: number }) {
  const shape = SLOT_SHAPES[index % SLOT_SHAPES.length] as SlotShapeName;
  return (
    <svg className="pk-shape" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" shapeRendering="crispEdges">
      <polygon points={SHAPE_POINTS[shape]} fill="currentColor" />
    </svg>
  );
}

export type AnswerState = 'idle' | 'selected' | 'locked' | 'correct' | 'wrong' | 'missed' | 'dim';

export interface AnswerButtonProps {
  index: number;
  label: ReactNode;
  /** Accessible text (defaults to "A: <label>" when label is a string). */
  ariaLabel?: string;
  state?: AnswerState;
  disabled?: boolean;
  /** Reveal: answers for this option and the total (draws a bar + count). */
  count?: number;
  total?: number;
  onClick?: () => void;
}

/** One big game-show answer button (≥ 56px tall on phones). */
export function AnswerButton({ index, label, ariaLabel, state = 'idle', disabled, count, total, onClick }: AnswerButtonProps) {
  const letter = SLOT_LETTERS[index] ?? String(index + 1);
  const share = count !== undefined && total ? count / total : 0;
  const status =
    state === 'correct'
      ? ', correct answer'
      : state === 'wrong'
        ? ', your answer, incorrect'
        : state === 'locked' || state === 'selected'
          ? ', your answer'
          : '';
  return (
    <button
      type="button"
      className="pk-answer"
      data-slot={index % 6}
      data-state={state}
      disabled={disabled}
      aria-pressed={state === 'selected' || state === 'locked' ? true : undefined}
      aria-label={`${ariaLabel ?? `${letter}: ${typeof label === 'string' ? label : ''}`}${status}${count !== undefined ? `, ${count} answer${count === 1 ? '' : 's'}` : ''}`}
      onClick={onClick}
      style={{ '--share': share } as CSSProperties}
    >
      <span className="pk-answer__badge" aria-hidden="true">
        <SlotShape index={index} size={14} />
        <span className="pk-answer__letter">{letter}</span>
      </span>
      <span className="pk-answer__label">{label}</span>
      {count !== undefined ? (
        <span className="pk-answer__count dc-num" aria-hidden="true">
          {count}
        </span>
      ) : null}
      {state === 'correct' ? <PixelIcon name="check" className="pk-answer__mark" /> : null}
      {state === 'wrong' ? <PixelIcon name="close" className="pk-answer__mark" /> : null}
      {state === 'locked' ? <PixelIcon name="lock" className="pk-answer__mark" /> : null}
      {count !== undefined ? <span className="pk-answer__bar" aria-hidden="true" /> : null}
    </button>
  );
}

export interface AnswerGridProps {
  options: ReactNode[];
  /** Accessible labels per option (when options are not plain strings). */
  labels?: string[];
  /** Index this player picked (locked or selected). */
  picked?: number | null;
  /** Picked answer is locked (no more changes). */
  locked?: boolean;
  /** Reveal: the correct option. */
  correctIndex?: number | null;
  /** Reveal: answers per option. */
  distribution?: number[] | null;
  disabled?: boolean;
  onPick?: (index: number) => void;
  /** Two columns on wide screens (default) or a single column. */
  columns?: 1 | 2;
  label?: string;
}

/** Grid of answer buttons with pick / lock / reveal (correct + distribution) states. */
export function AnswerGrid({
  options,
  labels,
  picked = null,
  locked,
  correctIndex = null,
  distribution = null,
  disabled,
  onPick,
  columns = 2,
  label = 'Answers',
}: AnswerGridProps) {
  const revealed = correctIndex !== null && correctIndex !== undefined;
  const total = distribution ? distribution.reduce((a, b) => a + b, 0) : 0;
  return (
    <div
      className={cx('pk-answers', columns === 1 && 'pk-answers--single', options.length > 4 && 'pk-answers--many')}
      role="group"
      aria-label={label}
    >
      {options.map((opt, i) => {
        let state: AnswerState = 'idle';
        if (revealed) {
          if (i === correctIndex) state = 'correct';
          else if (i === picked) state = 'wrong';
          else state = 'dim';
        } else if (i === picked) state = locked ? 'locked' : 'selected';
        else if (picked !== null && locked) state = 'dim';
        return (
          <AnswerButton
            key={i}
            index={i}
            label={opt}
            ariaLabel={labels?.[i] ? `${SLOT_LETTERS[i] ?? i + 1}: ${labels[i]}` : undefined}
            state={state}
            disabled={disabled || revealed || (locked && picked !== null)}
            count={distribution ? (distribution[i] ?? 0) : undefined}
            total={total}
            onClick={onPick ? () => onPick(i) : undefined}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Typed answers
// ---------------------------------------------------------------------------

export interface TypedAnswerProps {
  /** Accessible label for the input. */
  label: string;
  placeholder?: string;
  maxLength?: number;
  /** 'numeric' shows a number keyboard on phones (still a text input so "1,234" works). */
  mode?: 'text' | 'numeric';
  /** Already locked: show this value instead of the input. */
  lockedValue?: string | null;
  disabled?: boolean;
  submitLabel?: string;
  /** Return an error message to keep the input open (client-side validation hint). */
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
  /** Unit shown after the input (e.g. "km"). */
  suffix?: string;
  autoFocus?: boolean;
}

/** Text / number entry with a big lock-in button. Enter submits. */
export function TypedAnswer({
  label,
  placeholder,
  maxLength = 60,
  mode = 'text',
  lockedValue,
  disabled,
  submitLabel = 'Lock in',
  validate,
  onSubmit,
  suffix,
  autoFocus,
}: TypedAnswerProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  useEffect(() => {
    if (autoFocus && !lockedValue && !disabled && matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, [autoFocus, lockedValue, disabled]);

  if (lockedValue !== null && lockedValue !== undefined) {
    return (
      <div className="pk-typed pk-typed--locked" role="status">
        <PixelIcon name="lock" />
        <span className="pk-typed__locked-label">Locked in:</span>
        <strong className="pk-typed__locked-value">
          {lockedValue}
          {suffix ? ` ${suffix}` : ''}
        </strong>
      </div>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    const problem = validate?.(v) ?? null;
    setError(problem);
    if (problem) return;
    onSubmit(v);
  };
  return (
    <form className="pk-typed" onSubmit={submit}>
      <div className="pk-typed__row">
        <div className="pk-typed__field">
          <TextInput
            ref={inputRef}
            className="pk-typed__input"
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-label={label}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            inputMode={mode === 'numeric' ? 'decimal' : 'text'}
            enterKeyHint="done"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize={mode === 'numeric' ? 'off' : 'sentences'}
            spellCheck={false}
            disabled={disabled}
            onChange={(e) => {
              setValue(e.currentTarget.value);
              if (error) setError(null);
            }}
          />
          {suffix ? <span className="pk-typed__suffix">{suffix}</span> : null}
        </div>
        <Button type="submit" variant="primary" size="lg" icon="lock" disabled={disabled || !value.trim()} className="pk-typed__submit">
          {submitLabel}
        </Button>
      </div>
      {error ? (
        <p id={errorId} className="pk-typed__error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Who has answered
// ---------------------------------------------------------------------------

export interface AnsweredStripProps {
  players: PlayerView[];
  seats: Record<string, PartySeatView> | undefined;
  meId?: string | null;
  /** Verb for the count, e.g. "locked in", "voted", "submitted". */
  verb?: string;
  /** Max avatars before "+N". */
  max?: number;
}

/** Avatars of eligible players with a check once they answered — never what they answered. */
export function AnsweredStrip({ players, seats, meId, verb = 'locked in', max = 16 }: AnsweredStripProps) {
  const eligible = players.filter((p) => !p.spectator && seats?.[p.id]?.eligible);
  const answered = eligible.filter((p) => seats?.[p.id]?.answered);
  // Answered first so the strip fills up left to right as people lock in.
  const ordered = [...answered, ...eligible.filter((p) => !seats?.[p.id]?.answered)];
  const shown = ordered.slice(0, max);
  const extra = ordered.length - shown.length;
  return (
    <div className="pk-strip" aria-label={`${answered.length} of ${eligible.length} ${verb}`} role="status">
      <span className="pk-strip__count dc-num" aria-hidden="true">
        {answered.length}
        <span className="pk-strip__of">/{eligible.length}</span>
      </span>
      <span className="pk-strip__verb" aria-hidden="true">
        {verb}
      </span>
      <ul className="pk-strip__list" aria-hidden="true">
        {shown.map((p) => {
          const done = Boolean(seats?.[p.id]?.answered);
          return (
            <li
              key={p.id}
              className={cx('pk-strip__item', done && 'is-done', p.id === meId && 'is-me', !p.connected && 'is-offline')}
              title={`${p.name}${done ? ` — ${verb}` : ''}`}
            >
              <Avatar avatar={p.avatar} color={p.color} size={28} offline={!p.connected} />
              {done ? (
                <span className="pk-strip__check">
                  <PixelIcon name="check" size={10} />
                </span>
              ) : null}
            </li>
          );
        })}
        {extra > 0 ? <li className="pk-strip__more dc-num">+{extra}</li> : null}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

export interface VoteEntry {
  /** Opaque option id. */
  id: string;
  content: ReactNode;
  /** Accessible text of the entry. */
  label: string;
  /** Reveal: votes and (optionally) the author. */
  votes?: number;
  author?: ReactNode;
  winner?: boolean;
}

export interface VoteGridProps {
  entries: VoteEntry[];
  /** Option ids this player can't pick (their own entries). */
  ownIds?: string[];
  selected?: string | null;
  locked?: boolean;
  disabled?: boolean;
  revealed?: boolean;
  onVote?: (id: string) => void;
  label?: string;
  voteLabel?: string;
}

/** Cards to vote on (own entries disabled and badged). Reveal mode shows votes + authors. */
export function VoteGrid({
  entries,
  ownIds = [],
  selected = null,
  locked,
  disabled,
  revealed,
  onVote,
  label = 'Entries',
  voteLabel = 'Vote',
}: VoteGridProps) {
  const maxVotes = Math.max(1, ...entries.map((e) => e.votes ?? 0));
  return (
    <ul className={cx('pk-votes', entries.length > 4 && 'pk-votes--many')} aria-label={label}>
      {entries.map((e, i) => {
        const own = ownIds.includes(e.id);
        const picked = selected === e.id;
        return (
          <li
            key={e.id}
            className="pk-vote"
            data-own={own ? 'true' : undefined}
            data-picked={picked ? 'true' : undefined}
            data-winner={revealed && e.winner ? 'true' : undefined}
            data-slot={i % 6}
          >
            <div className="pk-vote__content">{e.content}</div>
            {revealed ? (
              <div className="pk-vote__reveal">
                <span className="pk-vote__bar" style={{ '--share': (e.votes ?? 0) / maxVotes } as CSSProperties} aria-hidden="true" />
                <span className="pk-vote__votes dc-num">
                  {e.votes ?? 0} vote{e.votes === 1 ? '' : 's'}
                </span>
                {e.author ? <span className="pk-vote__author">{e.author}</span> : null}
                {e.winner ? <PixelIcon name="crown" title="Winner" className="pk-vote__crown" /> : null}
              </div>
            ) : own ? (
              <span className="pk-vote__own">Your entry</span>
            ) : (
              <Button
                size="md"
                variant={picked ? 'primary' : 'secondary'}
                icon={picked ? (locked ? 'lock' : 'check') : undefined}
                disabled={disabled || (locked && !picked)}
                aria-pressed={picked}
                aria-label={`${voteLabel}: ${e.label}`}
                onClick={() => onVote?.(e.id)}
              >
                {picked ? (locked ? 'Locked' : 'Picked') : voteLabel}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Small status line under an answer area ("Locked in — waiting for 4 players"). */
export function LockNote({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'success' | 'warning' }) {
  return (
    <p className="pk-locknote" data-tone={tone} role="status">
      {tone === 'success' ? <PixelIcon name="check" /> : tone === 'warning' ? <PixelIcon name="clock" /> : <PixelIcon name="lock" />}
      <span>{children}</span>
    </p>
  );
}
