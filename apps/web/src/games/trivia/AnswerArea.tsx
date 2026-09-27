/**
 * Answer input per question type (live) and the revealed answer (after lock-out).
 */
import { useState, type CSSProperties } from 'react';
import { SYS } from '@dascade/shared';
import {
  TRIVIA_LIMITS,
  TRIVIA_MSG,
  formatTriviaNumber,
  type TriviaAnswerInput,
  type TriviaPrivate,
  type TriviaQuestionView,
  type TriviaRevealView,
} from '@dascade/shared/games/trivia';
import { parseNumberAnswer } from '@dascade/game-core/party';
import { Button, PixelIcon, cx } from '@dascade/ui';
import { session, useRoomMessage } from '../../net/hooks.ts';
import { AnswerGrid, LockNote, TypedAnswer } from '../_party/index.ts';

function send(seq: number, answer: TriviaAnswerInput) {
  session.send(TRIVIA_MSG.answer, { seq, answer });
}

// ---------------------------------------------------------------------------
// Live answer area
// ---------------------------------------------------------------------------

export interface LiveAnswerProps {
  view: TriviaQuestionView;
  priv: TriviaPrivate | null;
  /** Can this player answer (seated + eligible + not spectating)? */
  canAnswer: boolean;
  /** Reason shown instead of inputs when they can't. */
  blockedText?: string;
  answeredCount: number;
  eligibleCount: number;
}

export function LiveAnswer({ view, priv, canAnswer, blockedText, answeredCount, eligibleCount }: LiveAnswerProps) {
  // Optimistic pick (until the private echo arrives), keyed by question. A refused answer (e.g. the
  // host paused the game) is rolled back so it can be sent again.
  const [pending, setPending] = useState<{ seq: number; answer: TriviaAnswerInput } | null>(null);
  useRoomMessage<{ type?: string }>(SYS.error, (e) => {
    if (e?.type === TRIVIA_MSG.answer) setPending(null);
  });
  const locked = priv?.answer ?? (pending?.seq === view.seq ? pending.answer : null);
  const submit = (answer: TriviaAnswerInput) => {
    if (locked || !canAnswer) return;
    setPending({ seq: view.seq, answer });
    send(view.seq, answer);
  };
  const waiting = Math.max(0, eligibleCount - answeredCount);
  const note = !canAnswer ? (
    <LockNote tone="warning">{blockedText ?? 'You’re watching this one.'}</LockNote>
  ) : locked ? (
    <LockNote tone="success">
      Locked in! {waiting > 0 ? `Waiting for ${waiting} more player${waiting === 1 ? '' : 's'}…` : 'Revealing…'}
    </LockNote>
  ) : null;

  if (view.type === 'mc' || view.type === 'tf') {
    const picked = locked ? (locked.kind === 'mc' ? locked.index : locked.kind === 'tf' ? (locked.value ? 0 : 1) : null) : null;
    return (
      <div className="tv-answer">
        <AnswerGrid
          options={view.options ?? []}
          labels={view.options}
          picked={picked}
          locked={Boolean(locked)}
          disabled={!canAnswer}
          columns={view.type === 'tf' ? 2 : 2}
          onPick={(i) => submit(view.type === 'tf' ? { kind: 'tf', value: i === 0 } : { kind: 'mc', index: i })}
          label="Answer options"
        />
        {note}
      </div>
    );
  }
  if (view.type === 'text') {
    return (
      <div className="tv-answer">
        {canAnswer ? (
          <TypedAnswer
            key={view.seq}
            label="Your answer"
            placeholder="Type your answer…"
            maxLength={TRIVIA_LIMITS.typed}
            lockedValue={locked?.kind === 'text' ? locked.text : null}
            onSubmit={(text) => submit({ kind: 'text', text })}
            autoFocus
          />
        ) : null}
        {note}
      </div>
    );
  }
  if (view.type === 'number') {
    return (
      <div className="tv-answer">
        {canAnswer ? (
          <TypedAnswer
            key={view.seq}
            label="Your number"
            placeholder="Your best guess…"
            mode="numeric"
            maxLength={24}
            suffix={view.unit}
            lockedValue={locked?.kind === 'number' ? formatTriviaNumber(locked.value) : null}
            validate={(v) => (parseNumberAnswer(v) === null ? 'Enter a number like 1969 or 3.5' : null)}
            onSubmit={(v) => {
              const n = parseNumberAnswer(v);
              if (n !== null) submit({ kind: 'number', value: n });
            }}
            autoFocus
          />
        ) : null}
        {canAnswer && !locked ? <p className="tv-hint">Closest guess wins — ties share the points.</p> : null}
        {note}
      </div>
    );
  }
  return (
    <div className="tv-answer">
      <OrderAnswer
        key={view.seq}
        view={view}
        locked={locked?.kind === 'order' ? locked.order : null}
        disabled={!canAnswer}
        onSubmit={(order) => submit({ kind: 'order', order })}
      />
      {note}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Put in order: tap items from one end to the other
// ---------------------------------------------------------------------------

function OrderAnswer({
  view,
  locked,
  disabled,
  onSubmit,
}: {
  view: TriviaQuestionView;
  locked: number[] | null;
  disabled: boolean;
  onSubmit: (order: number[]) => void;
}) {
  const items = view.items ?? [];
  const [seqd, setSeqd] = useState<number[]>([]);
  const chosen = locked ?? seqd;
  const [first, last] = view.ends ?? ['First', 'Last'];
  const done = chosen.length === items.length;
  return (
    <div className="tv-order">
      <p className="tv-order__help">
        Tap the items from <strong>{first}</strong> to <strong>{last}</strong>.
      </p>
      <ol className="tv-order__slots" data-part="order-slots" aria-label={`Your order, ${first} to ${last}`}>
        {items.map((_, pos) => {
          const idx = chosen[pos];
          return (
            <li key={pos} className={cx('tv-order__slot', idx !== undefined && 'is-filled')}>
              <span className="tv-order__pos dc-num">{pos + 1}</span>
              {idx !== undefined ? (
                <button
                  type="button"
                  className="tv-order__placed"
                  data-part="answer-card"
                  disabled={Boolean(locked) || disabled}
                  aria-label={`Position ${pos + 1}: ${items[idx]}. Tap to remove.`}
                  onClick={() => setSeqd((s) => s.filter((x) => x !== idx))}
                >
                  <span>{items[idx]}</span>
                  {!locked ? <PixelIcon name="close" size={12} /> : null}
                </button>
              ) : (
                <span className="tv-order__empty">{pos === 0 ? first : pos === items.length - 1 ? last : '…'}</span>
              )}
            </li>
          );
        })}
      </ol>
      {!locked ? (
        <>
          <div className="tv-order__pool" data-part="answer-grid" role="group" aria-label="Items to place">
            {items.map((item, i) =>
              seqd.includes(i) ? null : (
                <button
                  key={i}
                  type="button"
                  className="tv-order__item"
                  data-part="answer-card"
                  data-slot={i % 6}
                  disabled={disabled}
                  onClick={() => setSeqd((s) => [...s, i])}
                >
                  {item}
                </button>
              ),
            )}
          </div>
          <div className="tv-order__actions">
            <Button variant="ghost" icon="refresh" disabled={disabled || seqd.length === 0} onClick={() => setSeqd([])}>
              Reset
            </Button>
            <Button variant="primary" size="lg" icon="lock" disabled={disabled || !done} onClick={() => onSubmit(seqd)}>
              Lock in order
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------------------

export function RevealAnswer({
  view,
  reveal,
  priv,
  meId,
}: {
  view: TriviaQuestionView;
  reveal: TriviaRevealView;
  priv: TriviaPrivate | null;
  meId: string | null;
}) {
  const mine = meId ? reveal.results[meId] : undefined;
  const my = priv?.answer ?? null;
  if (view.type === 'mc' || view.type === 'tf') {
    const picked = my ? (my.kind === 'mc' ? my.index : my.kind === 'tf' ? (my.value ? 0 : 1) : null) : null;
    return (
      <div className="tv-answer">
        <AnswerGrid
          options={view.options ?? []}
          labels={view.options}
          picked={picked}
          locked
          correctIndex={reveal.correctIndex ?? null}
          distribution={reveal.distribution ?? null}
          label="Answers with results"
        />
      </div>
    );
  }
  if (view.type === 'order') {
    const items = view.items ?? [];
    const correct = reveal.correctOrder ?? [];
    const myOrder = my?.kind === 'order' ? my.order : null;
    return (
      <ol className="tv-order__slots tv-order__slots--reveal" data-part="order-slots" aria-label="Correct order">
        {correct.map((idx, pos) => {
          const hit = myOrder ? myOrder[pos] === idx : null;
          return (
            <li key={pos} className={cx('tv-order__slot', 'is-filled', hit === true && 'is-hit', hit === false && 'is-miss')}>
              <span className="tv-order__pos dc-num">{pos + 1}</span>
              <span className="tv-order__placed tv-order__placed--static" data-part="answer-card">
                <span>{items[idx]}</span>
                {hit === true ? (
                  <PixelIcon name="check" size={14} title="You had this right" />
                ) : hit === false ? (
                  <span className="tv-order__yours">you: {items[myOrder![pos]!] ?? '—'}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    );
  }
  // text / number
  const closest = reveal.closest;
  return (
    <div className="tv-bigreveal" data-part="reveal-card" data-correct={mine?.correct ? 'true' : undefined}>
      <span className="tv-bigreveal__label">{view.type === 'number' ? 'The answer' : 'Correct answer'}</span>
      <strong className="tv-bigreveal__value">{reveal.correctText}</strong>
      {reveal.alsoAccepted?.length ? <span className="tv-bigreveal__also">Also accepted: {reveal.alsoAccepted.join(', ')}</span> : null}
      {view.type === 'number' ? (
        <span className="tv-bigreveal__also">
          {closest ? (
            <>
              Closest guess: <strong className="dc-num">{formatTriviaNumber(closest.value, view.unit)}</strong> (
              {closest.distance === 0 ? 'spot on!' : `off by ${formatTriviaNumber(closest.distance)}`})
              {closest.ids.length > 1 ? ` — ${closest.ids.length} players tied` : ''}
            </>
          ) : (
            'Nobody guessed.'
          )}
        </span>
      ) : (
        <span className="tv-bigreveal__also dc-num">
          {reveal.correctCount} of {reveal.answeredCount} got it
        </span>
      )}
      {mine?.answered ? (
        <span className="tv-bigreveal__yours">
          You said: <strong>{mine.answerText}</strong>
        </span>
      ) : null}
    </div>
  );
}

/** Your result for the question: verdict + points breakdown. */
export function MyResult({ reveal, meId, isFinal }: { reveal: TriviaRevealView; meId: string | null; isFinal: boolean }) {
  const r = meId ? reveal.results[meId] : undefined;
  if (!r) return null;
  const verdict = !r.answered ? 'No answer' : r.correct ? 'Correct!' : r.partial ? 'Partly right' : 'Not quite';
  const tone = r.correct ? 'good' : r.partial ? 'partial' : 'bad';
  return (
    <div className="tv-result" data-part="result" data-tone={tone} role="status" style={{ '--delay': '0.2s' } as CSSProperties}>
      <span className="tv-result__icon" aria-hidden="true">
        <PixelIcon name={r.correct ? 'check' : r.partial ? 'star' : !r.answered ? 'clock' : 'close'} />
      </span>
      <span className="tv-result__verdict">{verdict}</span>
      <span className="tv-result__points dc-num">
        {r.points > 0 ? '+' : r.points < 0 ? '−' : ''}
        {Math.abs(r.points).toLocaleString('en-US')}
      </span>
      <span className="tv-result__detail">
        {isFinal
          ? `Wager ${r.wager.toLocaleString('en-US')}`
          : [r.speedBonus ? `speed +${r.speedBonus}` : null, r.streakBonus ? `streak +${r.streakBonus}` : null]
              .filter(Boolean)
              .join(' · ') || (r.correct ? 'base points' : '')}
      </span>
    </div>
  );
}
