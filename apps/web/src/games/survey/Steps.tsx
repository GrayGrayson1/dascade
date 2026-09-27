/**
 * The answer → predict flow for one question. Answering is one tap (it locks immediately and
 * stays anonymous); predictions use the tool that fits the question: big buttons (majority),
 * tap-to-order (ranking) or a percentage dial.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { SYS } from '@dascade/shared';
import {
  SURVEY_MSG,
  type SurveyPrediction,
  type SurveyPrivate,
  type SurveyPublicState,
  type SurveyQuestion,
} from '@dascade/shared/games/survey';
import { Button, IconButton, PixelIcon, Slider, cx } from '@dascade/ui';
import { session, useRoomMessage } from '../../net/hooks.ts';
import { sfx } from '../../audio/audio.ts';
import { AnswerGrid, LockNote, SLOT_LETTERS, SlotShape } from '../_party/index.ts';
import { useOwnAnswer } from './hooks.ts';

type Step = 'answer' | 'predict' | 'done';

/** Local optimistic lock (cleared if the server refuses, or when the question changes). */
function usePending<T>(q: number): [T | null, (v: T | null) => void] {
  const [pending, setPending] = useState<{ q: number; value: T } | null>(null);
  useRoomMessage<{ type?: string }>(SYS.error, (e) => {
    if (e?.type === SURVEY_MSG.answer || e?.type === SURVEY_MSG.predict) setPending(null);
  });
  const value = pending && pending.q === q ? pending.value : null;
  return [value, (v) => setPending(v === null ? null : { q, value: v })];
}

export function QuestionSteps({
  state,
  question,
  priv,
}: {
  state: SurveyPublicState;
  question: SurveyQuestion;
  priv: SurveyPrivate | null;
}) {
  const q = state.q;
  const [pendingAnswer, setPendingAnswer] = usePending<number | 'skip'>(q);
  const [pendingPrediction, setPendingPrediction] = usePending<SurveyPrediction>(q);
  const own = useOwnAnswer(q);

  const answered = Boolean(priv?.answered) || pendingAnswer !== null;
  const prediction = priv?.prediction ?? pendingPrediction;
  const answersOpen = state.stage === 'answer';
  const myAnswer: number | 'skip' | null =
    priv && priv.answered && !priv.sealed ? (priv.skipped ? 'skip' : priv.answer) : (pendingAnswer ?? own);

  const step: Step = prediction ? 'done' : answersOpen && !answered ? 'answer' : 'predict';

  const sendAnswer = (option: number | 'skip') => {
    if (answered || !answersOpen) return;
    setPendingAnswer(option);
    sfx(option === 'skip' ? 'click' : 'select');
    session.send(SURVEY_MSG.answer, option === 'skip' ? { q, skip: true } : { q, option });
  };
  const sendPrediction = (p: SurveyPrediction) => {
    if (prediction) return;
    setPendingPrediction(p);
    sfx('pop');
    session.send(SURVEY_MSG.predict, { q, ...p });
  };

  return (
    <div className="sv-steps" data-step={step}>
      <StepTrack step={step} answered={answered} />
      {step === 'answer' ? (
        <AnswerStep question={question} onAnswer={sendAnswer} />
      ) : (
        <AnswerSummary question={question} answer={myAnswer} answered={answered} answersOpen={answersOpen} />
      )}
      {step === 'predict' ? <PredictStep key={q} question={question} onPredict={sendPrediction} /> : null}
      {step === 'done' && prediction ? (
        <>
          <PredictionSummary question={question} prediction={prediction} />
          <LockNote tone="success">
            {state.stage === 'answer'
              ? `All set! Waiting for the room to answer — ${state.answersIn} in so far.`
              : `All set! Waiting for the last predictions — ${state.predictionsIn} in so far.`}
          </LockNote>
        </>
      ) : null}
    </div>
  );
}

function StepTrack({ step, answered }: { step: Step; answered: boolean }) {
  const items: Array<{ id: string; label: string; state: 'done' | 'now' | 'next' }> = [
    { id: 'answer', label: 'Answer', state: step === 'answer' ? 'now' : answered ? 'done' : 'next' },
    { id: 'predict', label: 'Predict', state: step === 'predict' ? 'now' : step === 'done' ? 'done' : 'next' },
    { id: 'reveal', label: 'Reveal', state: 'next' },
  ];
  return (
    <ol className="sv-track" data-part="steps" aria-label="Question steps">
      {items.map((it, i) => (
        <li key={it.id} className="sv-track__item" data-state={it.state} aria-current={it.state === 'now' ? 'step' : undefined}>
          <span className="sv-track__num dc-num" aria-hidden="true">
            {it.state === 'done' ? <PixelIcon name="check" size={10} /> : i + 1}
          </span>
          <span className="sv-track__label">{it.label}</span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Answer
// ---------------------------------------------------------------------------

const ANSWER_HEADINGS: Record<SurveyQuestion['mode'], { title: string; hint: string }> = {
  majority: { title: 'Your answer', hint: 'Which would YOU pick? Tap to lock it in.' },
  rank: { title: 'Your vote', hint: 'Tap your favourite. The room’s votes set the ranking.' },
  percent: { title: 'Your answer', hint: 'Answer for yourself. Tap to lock it in.' },
};

function AnswerStep({ question, onAnswer }: { question: SurveyQuestion; onAnswer: (option: number | 'skip') => void }) {
  const h = ANSWER_HEADINGS[question.mode];
  return (
    <section className="sv-step sv-step--answer" aria-labelledby="sv-answer-title">
      <header className="sv-step__head">
        <h3 id="sv-answer-title" className="sv-step__title">
          {h.title}
        </h3>
        <span className="sv-step__private">
          <PixelIcon name="lock" size={11} /> Only you see this
        </span>
      </header>
      <p className="sv-step__hint">{h.hint}</p>
      <AnswerGrid options={question.options} label="Your answer" onPick={(i) => onAnswer(i)} />
      <div className="sv-step__skip">
        <Button variant="ghost" size="sm" onClick={() => onAnswer('skip')}>
          Rather not say
        </Button>
      </div>
    </section>
  );
}

function AnswerSummary({
  question,
  answer,
  answered,
  answersOpen,
}: {
  question: SurveyQuestion;
  answer: number | 'skip' | null;
  answered: boolean;
  answersOpen: boolean;
}) {
  if (!answered) {
    return (
      <p className="sv-summary sv-summary--missed" role="status">
        <PixelIcon name="clock" size={12} />
        <span>{answersOpen ? 'Answer first, then predict.' : 'Answers are closed — you can still predict!'}</span>
      </p>
    );
  }
  const text = answer === 'skip' ? 'You passed on this one' : typeof answer === 'number' ? question.options[answer] : 'Locked in';
  return (
    <p className="sv-summary" role="status">
      <PixelIcon name="lock" size={12} />
      <span className="sv-summary__label">{answer === 'skip' ? '' : 'Your answer:'}</span>
      <strong className="sv-summary__value">
        {typeof answer === 'number' ? (
          <span className="sv-letter" aria-hidden="true">
            {SLOT_LETTERS[answer]}
          </span>
        ) : null}
        {text}
      </strong>
      <span className="sv-summary__anon">anonymous</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Predict
// ---------------------------------------------------------------------------

function predictHeading(question: SurveyQuestion): { title: string; hint: string } {
  switch (question.mode) {
    case 'majority':
      return { title: 'Predict the majority', hint: 'Which answer did MOST of the room pick?' };
    case 'rank':
      return { title: 'Predict the ranking', hint: 'Tap the options in order — most votes first.' };
    case 'percent': {
      const target = question.options[question.target ?? 0] ?? '';
      return { title: 'Guess the percentage', hint: `What % of the room said “${target}”?` };
    }
  }
}

function PredictStep({ question, onPredict }: { question: SurveyQuestion; onPredict: (p: SurveyPrediction) => void }) {
  const h = predictHeading(question);
  return (
    <section className="sv-step sv-step--predict" data-part="predict" aria-labelledby="sv-predict-title" data-mode={question.mode}>
      <header className="sv-step__head">
        <h3 id="sv-predict-title" className="sv-step__title">
          <PixelIcon name="eye" size={14} /> {h.title}
        </h3>
      </header>
      <p className="sv-step__hint sv-step__hint--big">{h.hint}</p>
      {question.mode === 'majority' ? (
        <AnswerGrid options={question.options} label="Predict the majority" onPick={(option) => onPredict({ kind: 'majority', option })} />
      ) : question.mode === 'rank' ? (
        <RankPicker options={question.options} onLock={(order) => onPredict({ kind: 'rank', order })} />
      ) : (
        <PercentDial target={question.options[question.target ?? 0] ?? ''} onLock={(percent) => onPredict({ kind: 'percent', percent })} />
      )}
    </section>
  );
}

/** Tap-to-order ranking: tap options from most votes to fewest; tap again to take one back. */
export function RankPicker({ options, onLock }: { options: string[]; onLock: (order: number[]) => void }) {
  const [order, setOrder] = useState<number[]>([]);
  const n = options.length;
  // With one option left its place is obvious: fill it in.
  const complete = useMemo(
    () => (order.length >= n - 1 ? [...order, ...options.map((_, i) => i).filter((i) => !order.includes(i))] : null),
    [order, n, options],
  );
  const toggle = (i: number) => {
    sfx('click');
    setOrder((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]));
  };
  const shown = complete ?? order;
  return (
    <div className="sv-rankpick">
      <ul className="sv-rankpick__options" data-part="answer-grid" aria-label="Options">
        {options.map((opt, i) => {
          const pos = shown.indexOf(i);
          const placed = pos >= 0;
          const auto = placed && !order.includes(i);
          return (
            <li key={i}>
              <button
                type="button"
                className="sv-rankpick__opt"
                data-part="answer-card"
                data-slot={i % 6}
                data-placed={placed ? 'true' : undefined}
                data-auto={auto ? 'true' : undefined}
                onClick={() => (auto ? undefined : toggle(i))}
                aria-disabled={auto || undefined}
                aria-label={
                  placed
                    ? `${opt}: predicted ${pos + 1} of ${n}${auto ? '' : '. Tap to remove'}`
                    : `${opt}: tap to place ${order.length + 1} of ${n}`
                }
              >
                <span className="sv-rankpick__badge" aria-hidden="true">
                  {placed ? <span className="dc-num">{pos + 1}</span> : <SlotShape index={i} size={14} />}
                </span>
                <span className="sv-rankpick__label">{opt}</span>
                <span className="sv-rankpick__state" aria-hidden="true">
                  {placed ? auto ? 'last' : <PixelIcon name="close" size={10} /> : <PixelIcon name="plus" size={10} />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="sv-rankpick__actions">
        <Button variant="ghost" size="md" icon="refresh" disabled={order.length === 0} onClick={() => setOrder([])}>
          Reset
        </Button>
        <Button variant="primary" size="lg" icon="lock" disabled={!complete} onClick={() => complete && onLock(complete)}>
          {complete ? 'Lock in order' : `Place ${n - 1 - order.length} more`}
        </Button>
      </div>
    </div>
  );
}

/** Percentage dial: big number, a row of pixel people, a slider and ±1 / ±5 nudges. */
export function PercentDial({ target, onLock }: { target: string; onLock: (percent: number) => void }) {
  const [value, setValue] = useState(50);
  const set = (v: number) => setValue(Math.max(0, Math.min(100, Math.round(v))));
  return (
    <div className="sv-dial" data-part="dial">
      <div className="sv-dial__readout">
        <output className="sv-dial__value dc-num" aria-live="polite" htmlFor="sv-dial-slider">
          {value}
          <span className="sv-dial__pct">%</span>
        </output>
        <span className="sv-dial__caption">said “{target}”</span>
      </div>
      <PeopleRow percent={value} />
      <div className="sv-dial__controls">
        <IconButton icon="minus" label="Decrease by 5" variant="secondary" onClick={() => set(value - 5)} className="sv-dial__nudge" />
        <IconButton icon="chevron-down" label="Decrease by 1" variant="ghost" onClick={() => set(value - 1)} className="sv-dial__nudge" />
        <Slider
          id="sv-dial-slider"
          className="sv-dial__slider"
          min={0}
          max={100}
          value={value}
          onChange={set}
          aria-label={`Percentage who said ${target}`}
        />
        <IconButton icon="chevron-up" label="Increase by 1" variant="ghost" onClick={() => set(value + 1)} className="sv-dial__nudge" />
        <IconButton icon="plus" label="Increase by 5" variant="secondary" onClick={() => set(value + 5)} className="sv-dial__nudge" />
      </div>
      <div className="sv-dial__presets" role="group" aria-label="Quick picks">
        {[0, 25, 50, 75, 100].map((p) => (
          <button key={p} type="button" className="sv-dial__preset dc-num" aria-pressed={value === p} onClick={() => set(p)}>
            {p}%
          </button>
        ))}
      </div>
      <Button variant="primary" size="lg" icon="lock" block onClick={() => onLock(value)}>
        Lock in {value}%
      </Button>
    </div>
  );
}

/** Ten pixel people, filled left to right to show a percentage (decorative). */
export function PeopleRow({ percent, tone = 'accent' }: { percent: number; tone?: 'accent' | 'muted' }) {
  return (
    <div className={cx('sv-people', `sv-people--${tone}`)} aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => {
        const fill = Math.max(0, Math.min(1, percent / 10 - i));
        return (
          <span key={i} className="sv-person" style={{ '--fill': fill } as CSSProperties}>
            <svg viewBox="0 0 8 12" shapeRendering="crispEdges">
              <path d="M2 0h4v4H2zM1 5h6v4H1zM2 9h1v3H2zM5 9h1v3H5z" className="sv-person__base" />
            </svg>
            <span className="sv-person__fill">
              <svg viewBox="0 0 8 12" shapeRendering="crispEdges">
                <path d="M2 0h4v4H2zM1 5h6v4H1zM2 9h1v3H2zM5 9h1v3H5z" />
              </svg>
            </span>
          </span>
        );
      })}
    </div>
  );
}

function PredictionSummary({ question, prediction }: { question: SurveyQuestion; prediction: SurveyPrediction }) {
  let content: ReactNode;
  if (prediction.kind === 'majority') content = question.options[prediction.option];
  else if (prediction.kind === 'percent') content = <span className="dc-num">{prediction.percent}%</span>;
  else {
    content = (
      <ol className="sv-summary__order">
        {prediction.order.map((o, i) => (
          <li key={o}>
            <span className="dc-num">{i + 1}</span> {question.options[o]}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="sv-summary sv-summary--prediction" role="status">
      <PixelIcon name="eye" size={12} />
      <span className="sv-summary__label">Your prediction:</span>
      <strong className="sv-summary__value">{content}</strong>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spectators
// ---------------------------------------------------------------------------

export function SpectatorOptions({ question }: { question: SurveyQuestion }) {
  return (
    <section className="sv-step sv-step--spectate" aria-label="Options">
      <AnswerGrid options={question.options} disabled label="Options" />
      <p className="sv-step__hint">
        <PixelIcon name="eye" size={12} /> You’re spectating. Players are answering anonymously — the room’s results appear after everyone
        predicts.
      </p>
    </section>
  );
}
