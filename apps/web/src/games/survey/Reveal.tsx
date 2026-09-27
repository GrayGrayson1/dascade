/**
 * Reveal screens: the room's anonymous totals, animated (bars grow, rankings shuffle into place,
 * the percentage needle sweeps in), your own points, and anonymity notes. With reduced motion
 * or effects off everything appears in its final state.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { PlayerView } from '@dascade/shared';
import {
  SURVEY_LIMITS,
  formatPercent,
  type SurveyPlayerScore,
  type SurveyPrivate,
  type SurveyPublicState,
  type SurveyQuestion,
  type SurveyResult,
} from '@dascade/shared/games/survey';
import { PixelIcon, cx } from '@dascade/ui';
import { DeltaChip, Interstitial, PromptCard, SLOT_LETTERS, SlotShape, useCountUp, usePartyFx } from '../_party/index.ts';
import { MODE_ICON, rankLabel, useOwnAnswer } from './hooks.ts';
import { PeopleRow } from './Steps.tsx';

/** True once the entry animation should show final values (immediately without motion). */
function useSettled(key: unknown, delayMs = 120): boolean {
  const { motion } = usePartyFx();
  const [settled, setSettled] = useState(!motion);
  useEffect(() => {
    if (!motion) {
      setSettled(true);
      return;
    }
    setSettled(false);
    const t = setTimeout(() => setSettled(true), delayMs);
    return () => clearTimeout(t);
  }, [key, motion, delayMs]);
  return settled;
}

export interface RevealViewProps {
  state: SurveyPublicState;
  question: SurveyQuestion;
  result: SurveyResult;
  priv: SurveyPrivate | null;
  meId: string | null;
  spectator: boolean;
  players: PlayerView[];
  /** Leaderboard rendered under the reveal on compact layouts. */
  board: ReactNode;
}

export function RevealView({ question, result, priv, meId, spectator, players, board }: RevealViewProps) {
  const own = useOwnAnswer(result.q);
  const myAnswer = typeof own === 'number' ? own : null;
  const mine = meId ? result.scores.find((s) => s.playerId === meId) : undefined;
  const prediction = priv?.q === result.q ? priv.prediction : null;
  return (
    <div className="sv-reveal" data-part="reveal" data-mode={question.mode} data-voided={result.voided ? 'true' : undefined}>
      <PromptCard
        animKey={`r${result.q}`}
        size="md"
        tone="reveal"
        kicker={
          <span className="sv-kicker">
            <PixelIcon name={MODE_ICON[question.mode]} size={12} /> The room says…
          </span>
        }
      >
        {question.prompt}
      </PromptCard>
      {result.voided ? (
        <Interstitial icon="lock" kicker="Question skipped" title="Too few answers to stay anonymous">
          <p>
            <span className="dc-num">{result.respondents}</span> of <span className="dc-num">{result.seated}</span> answered. Results need
            at least <span className="dc-num">{SURVEY_LIMITS.minRespondents}</span> answers, so nobody can be singled out — no points this
            time.
          </p>
        </Interstitial>
      ) : (
        <>
          {question.mode === 'majority' ? (
            <MajorityReveal
              question={question}
              result={result}
              myAnswer={myAnswer}
              myPick={prediction?.kind === 'majority' ? prediction.option : null}
            />
          ) : null}
          {question.mode === 'rank' ? (
            <RankReveal
              question={question}
              result={result}
              myAnswer={myAnswer}
              myOrder={prediction?.kind === 'rank' ? prediction.order : null}
            />
          ) : null}
          {question.mode === 'percent' ? (
            <PercentReveal
              question={question}
              result={result}
              myAnswer={myAnswer}
              myGuess={prediction?.kind === 'percent' ? prediction.percent : null}
              players={players}
            />
          ) : null}
          <AnonNote respondents={result.respondents} />
        </>
      )}
      {!spectator && !result.voided ? <MyPoints result={result} mine={mine} /> : null}
      {board ? <div className="sv-reveal__board">{board}</div> : null}
    </div>
  );
}

function AnonNote({ respondents }: { respondents: number }) {
  const small = respondents < SURVEY_LIMITS.smallRoomNote;
  return (
    <p className={cx('sv-anonnote', small && 'sv-anonnote--small')} role="note">
      <PixelIcon name="lock" size={12} />
      <span>
        <span className="dc-num">{respondents}</span> anonymous answer{respondents === 1 ? '' : 's'}.{' '}
        {small
          ? 'Small room: only totals are shown, never names — no guessing who said what!'
          : 'Only totals are shown — never who picked what.'}
      </span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Majority Mind
// ---------------------------------------------------------------------------

function MajorityReveal({
  question,
  result,
  myAnswer,
  myPick,
}: {
  question: SurveyQuestion;
  result: SurveyResult;
  myAnswer: number | null;
  myPick: number | null;
}) {
  const settled = useSettled(result.q);
  const tie = result.leaders.length > 1;
  const predictors = result.predictionCounts.reduce((a, b) => a + b, 0);
  return (
    <section className="sv-bars" data-part="bar-chart" aria-label="Results">
      {tie ? (
        <p className="sv-tie" role="status">
          <PixelIcon name="users" size={12} /> Tie for the lead — every tied option counts as the majority.
        </p>
      ) : null}
      <ol className="sv-bars__list">
        {question.options.map((opt, i) => {
          const leader = result.leaders.includes(i);
          const pct = result.percents[i] ?? 0;
          const votes = result.counts[i] ?? 0;
          const called = result.predictionCounts[i] ?? 0;
          return (
            <li
              key={i}
              className="sv-bar"
              data-part="answer-card"
              data-slot={i % 6}
              data-leader={leader ? 'true' : undefined}
              style={{ '--share': settled ? pct / 100 : 0, '--delay': `${i * 90}ms` } as CSSProperties}
              aria-label={`${opt}: ${formatPercent(pct)}, ${votes} vote${votes === 1 ? '' : 's'}${leader ? (tie ? ', tied for the majority' : ', the majority') : ''}${myPick === i ? ', your prediction' : ''}`}
            >
              <div className="sv-bar__head" aria-hidden="true">
                <span className="sv-bar__badge">
                  <SlotShape index={i} size={12} />
                  {SLOT_LETTERS[i]}
                </span>
                <span className="sv-bar__label">{opt}</span>
                <span className="sv-bar__pct dc-num">{formatPercent(pct)}</span>
              </div>
              <div className="sv-bar__track" aria-hidden="true">
                <span className="sv-bar__fill" />
              </div>
              <div className="sv-bar__meta" aria-hidden="true">
                {leader ? (
                  <span className="sv-tag sv-tag--lead">
                    <PixelIcon name="crown" size={10} /> {tie ? 'Tied lead' : 'Majority'}
                  </span>
                ) : null}
                <span className="dc-num">
                  {votes} vote{votes === 1 ? '' : 's'}
                </span>
                {predictors > 0 ? (
                  <span className="sv-bar__called">
                    <PixelIcon name="eye" size={10} /> <span className="dc-num">{called}</span> predicted this
                  </span>
                ) : null}
                {myPick === i ? <span className={cx('sv-tag', leader ? 'sv-tag--hit' : 'sv-tag--miss')}>Your call</span> : null}
                {myAnswer === i ? <span className="sv-tag sv-tag--you">You picked</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rank the Room
// ---------------------------------------------------------------------------

function RankReveal({
  question,
  result,
  myAnswer,
  myOrder,
}: {
  question: SurveyQuestion;
  result: SurveyResult;
  myAnswer: number | null;
  myOrder: number[] | null;
}) {
  const { motion } = usePartyFx();
  // Rows start in the question's order, then slide into the room's ranking.
  const settled = useSettled(result.q, motion ? 700 : 0);
  const n = question.options.length;
  const maxVotes = Math.max(1, ...result.counts);
  return (
    <section className="sv-rankrev" data-part="bar-chart" aria-label="Final ranking">
      <ol className="sv-rankrev__list" style={{ '--rows': n } as CSSProperties} data-settled={settled ? 'true' : undefined}>
        {question.options.map((opt, i) => {
          const at = result.ranking.findIndex((s) => s.option === i);
          const slot = result.ranking[at] ?? { option: i, lo: i + 1, hi: i + 1 };
          const votes = result.counts[i] ?? 0;
          const predicted = myOrder ? myOrder.indexOf(i) + 1 : 0;
          const off = predicted ? (predicted < slot.lo ? slot.lo - predicted : predicted > slot.hi ? predicted - slot.hi : 0) : 0;
          return (
            <li
              key={i}
              className="sv-rankrow"
              data-part="answer-card"
              data-slot={i % 6}
              data-top={settled && slot.lo === 1 ? 'true' : undefined}
              style={{ '--pos': settled ? at : i, '--share': settled ? votes / maxVotes : 0 } as CSSProperties}
              aria-label={`${rankLabel(slot.lo, slot.hi)}: ${opt}, ${votes} vote${votes === 1 ? '' : 's'}${predicted ? `, you predicted ${predicted}${off ? `, ${off} off` : ', correct'}` : ''}`}
            >
              <span className="sv-rankrow__place dc-num" aria-hidden="true">
                {settled ? rankLabel(slot.lo, slot.hi) : '?'}
              </span>
              <span className="sv-rankrow__body" aria-hidden="true">
                <span className="sv-rankrow__label">
                  {opt}
                  {myAnswer === i ? <span className="sv-tag sv-tag--you sv-rankrow__mine">Your vote</span> : null}
                </span>
                <span className="sv-rankrow__bar">
                  <span />
                </span>
              </span>
              <span className="sv-rankrow__side" aria-hidden="true">
                <span className="sv-rankrow__votes dc-num">{votes}</span>
                {predicted ? (
                  <span className={cx('sv-tag', off === 0 ? 'sv-tag--hit' : 'sv-tag--miss')}>
                    You: <span className="dc-num">{predicted}</span>
                    {off === 0 ? <PixelIcon name="check" size={10} /> : <span className="dc-num"> ({off} off)</span>}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
      {result.ranking.some((s) => s.lo !== s.hi) ? (
        <p className="sv-tie" role="note">
          <PixelIcon name="users" size={12} /> Options tied on votes share their places — either order counts as correct.
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Guess the Percentage
// ---------------------------------------------------------------------------

function PercentReveal({
  question,
  result,
  myAnswer,
  myGuess,
  players,
}: {
  question: SurveyQuestion;
  result: SurveyResult;
  myAnswer: number | null;
  myGuess: number | null;
  players: PlayerView[];
}) {
  const settled = useSettled(result.q, 350);
  const target = question.target ?? 0;
  const targetText = question.options[target] ?? '';
  const shown = useCountUp(settled ? Math.round(result.actual * 10) : 0, 0, 1100, `${result.q}:${settled}`) / 10;
  // Stack identical guesses into columns of dots.
  const columns = new Map<number, number>();
  for (const p of result.predictedPercents) columns.set(p, (columns.get(p) ?? 0) + 1);
  let mineMarked = false;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'Player';
  const closestScore = result.scores.find((s) => s.playerId === result.closest[0]);
  return (
    <section className="sv-meter" data-part="meter" aria-label="Percentage result">
      <div className="sv-meter__headline">
        <span className="sv-meter__big dc-num" aria-hidden="true">
          {formatPercent(shown)}
        </span>
        <span className="sv-meter__said">
          said “<strong>{targetText}</strong>”
        </span>
        <span className="visually-hidden">
          {formatPercent(result.actual)} of the room said {targetText}
        </span>
      </div>
      <div className="sv-meter__track" style={{ '--actual': settled ? result.actual / 100 : 0 } as CSSProperties} aria-hidden="true">
        <span className="sv-meter__fill" />
        {[...columns.entries()].map(([value, count]) =>
          Array.from({ length: Math.min(count, 6) }, (_, k) => {
            const isMine = !mineMarked && myGuess === value && k === 0;
            if (isMine) mineMarked = true;
            return (
              <span
                key={`${value}-${k}`}
                className={cx('sv-dot', isMine && 'sv-dot--mine')}
                style={{ '--x': value / 100, '--k': k, '--d': `${(value % 17) * 25}ms` } as CSSProperties}
                data-shown={settled ? 'true' : undefined}
              />
            );
          }),
        )}
        <span className="sv-meter__needle">
          <span className="sv-meter__needle-label dc-num">{formatPercent(result.actual)}</span>
        </span>
        {[0, 25, 50, 75, 100].map((t) => (
          <span key={t} className="sv-meter__tick dc-num" style={{ '--x': t / 100 } as CSSProperties}>
            {t}
          </span>
        ))}
      </div>
      <PeopleRow percent={settled ? result.actual : 0} tone="muted" />
      <div className="sv-meter__facts">
        {myGuess !== null ? (
          <span className="sv-tag sv-tag--you">
            Your guess: <span className="dc-num">{myGuess}%</span>
          </span>
        ) : null}
        {result.closest.length > 0 && closestScore ? (
          <span className="sv-tag sv-tag--hit">
            <PixelIcon name="star" size={10} /> {result.closest.length > 1 ? 'Closest (tie)' : 'Closest'}:{' '}
            {result.closest.map(nameOf).join(', ')} · <span className="dc-num">{closestScore.off}</span> off
          </span>
        ) : null}
        {myAnswer !== null ? <span className="sv-tag">You said “{question.options[myAnswer]}”</span> : null}
      </div>
      {question.options.length > 2 ? (
        <ul className="sv-meter__shares">
          {question.options.map((opt, i) => (
            <li key={i} data-target={i === target ? 'true' : undefined}>
              <span>{opt}</span> <span className="dc-num">{formatPercent(result.percents[i] ?? 0)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Your points
// ---------------------------------------------------------------------------

function verdict(
  result: SurveyResult,
  mine: SurveyPlayerScore | undefined,
): { title: string; line: string; tone: 'hit' | 'miss' | 'none' } {
  if (!mine) return { title: 'No prediction', line: 'You didn’t predict this one — no points.', tone: 'none' };
  switch (result.question.mode) {
    case 'majority':
      return mine.hit
        ? {
            title: mine.bonus ? 'Called it!' : 'You read the room!',
            line: mine.bonus ? 'Right — and most of the room missed it.' : 'You predicted the majority.',
            tone: 'hit',
          }
        : { title: 'Not this time', line: 'The room went another way.', tone: 'miss' };
    case 'rank':
      return mine.off === 0
        ? { title: 'Perfect order!', line: 'Every option in its place.', tone: 'hit' }
        : {
            title: `${mine.off} spot${mine.off === 1 ? '' : 's'} off`,
            line: 'Closer orders score more.',
            tone: mine.points > 0 ? 'hit' : 'miss',
          };
    case 'percent':
      return mine.off === 0
        ? { title: 'Bullseye!', line: 'Exactly right.', tone: 'hit' }
        : {
            title: `${mine.off} point${mine.off === 1 ? '' : 's'} off`,
            line: mine.bonusLabel ? 'The closest guess in the room!' : 'Closer guesses score more.',
            tone: mine.points > 0 ? 'hit' : 'miss',
          };
  }
}

function MyPoints({ result, mine }: { result: SurveyResult; mine: SurveyPlayerScore | undefined }) {
  const settled = useSettled(result.q, 900);
  const points = useCountUp(settled ? (mine?.points ?? 0) : 0, 0, 800, `${result.q}:${settled}`);
  const v = verdict(result, mine);
  return (
    <section className="sv-mine" data-part="score-reveal" data-tone={v.tone} data-shown={settled ? 'true' : undefined} aria-label="Your points">
      <div className="sv-mine__points dc-num" aria-hidden="true">
        +{points.toLocaleString('en-US')}
      </div>
      <div className="sv-mine__text">
        <strong className="sv-mine__title">{v.title}</strong>
        <span className="sv-mine__line">{v.line}</span>
      </div>
      {mine && mine.bonus > 0 ? (
        <span className="sv-mine__bonus">
          <PixelIcon name="star" size={10} /> {mine.bonusLabel} <DeltaChip delta={mine.bonus} />
        </span>
      ) : null}
      <span className="visually-hidden">
        You scored {mine?.points ?? 0} points. {v.title}
      </span>
    </section>
  );
}
