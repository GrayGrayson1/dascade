/**
 * DAS Survey game view. One screen per question with three beats:
 *   answer (anonymous) → predict (majority / ranking / percentage) → reveal (animated results + points)
 * Desktop: question in the centre, live leaderboard on the right, "who's done" strip at the bottom.
 * Phones: single column; the leaderboard appears under the reveal.
 */
import type { CSSProperties, ReactNode } from 'react';
import { SURVEY_MODE_INFO, type SurveyQuestion, type SurveyQuestionMode } from '@dascade/shared/games/survey';
import { Badge, PixelIcon, Spinner } from '@dascade/ui';
import { GameStage } from '../../shell/common.tsx';
import {
  AnsweredStrip,
  HostBar,
  Interstitial,
  Leaderboard,
  PARTY_COMPACT_QUERY,
  PartyStage,
  PartyTopBar,
  PausedBanner,
  PromptCard,
  RoundCounter,
  RulesDrawer,
  StageTimer,
  TimerBar,
  useMediaQuery,
  useTimerTicks,
} from '../_party/index.ts';
import { MODE_COLOR, MODE_ICON, useQuestion, useResult, useSurveyGame, useSurveyPrivate } from './hooks.ts';
import { SURVEY_RULES } from './rules.ts';
import { QuestionSteps, SpectatorOptions } from './Steps.tsx';
import { RevealView } from './Reveal.tsx';
import { SurveyResults } from './Results.tsx';
import { useSurveySounds } from './sounds.ts';

export function SurveyGameView() {
  const game = useSurveyGame();
  useSurveySounds(game?.playerId ?? null);
  if (!game) {
    return (
      <GameStage gameId="survey" className="sv-stage">
        <div className="center-screen">
          <Spinner label="Loading DAS Survey" />
        </div>
      </GameStage>
    );
  }
  if (game.phase === 'RESULTS' || game.state.stage === 'final') return <SurveyResults />;
  return <SurveyTable />;
}

/** Mode chip: icon + name + colour (never colour alone). */
export function ModeChip({ mode, short }: { mode: SurveyQuestionMode; short?: boolean }) {
  const info = SURVEY_MODE_INFO[mode];
  return (
    <span className="sv-mode" style={{ '--mode': MODE_COLOR[mode] } as CSSProperties}>
      <PixelIcon name={MODE_ICON[mode]} size={12} />
      <span>{short ? info.short : info.title}</span>
    </span>
  );
}

function SurveyTable() {
  const game = useSurveyGame();
  const state = game?.state;
  const question = useQuestion(state?.questionJson);
  const result = useResult(state?.resultJson);
  const priv = useSurveyPrivate(state?.q ?? 0);
  const compact = useMediaQuery(PARTY_COMPACT_QUERY);
  const stage = state?.stage ?? 'idle';
  useTimerTicks(stage === 'answer' || stage === 'predict');
  if (!game || !state) return null;

  const meId = game.playerId;
  const collecting = (stage === 'answer' || stage === 'predict') && question !== null;
  const revealing = stage === 'reveal' && question !== null && result !== null && result.q === state.q;
  const isLast = state.round >= state.totalRounds;
  const skipLabel =
    stage === 'answer'
      ? 'Close answers'
      : stage === 'predict'
        ? 'Reveal now'
        : stage === 'reveal'
          ? isLast
            ? 'Final results'
            : 'Next question'
          : null;

  const rules = (
    <RulesDrawer
      title="How DAS Survey works"
      sections={SURVEY_RULES}
      highlight={question ? SURVEY_MODE_INFO[question.mode].title : undefined}
      compact={compact}
    />
  );
  const top = (
    <PartyTopBar
      left={
        <>
          {state.totalRounds > 0 && state.round > 0 ? (
            <RoundCounter label="Question" round={state.round} total={state.totalRounds} />
          ) : null}
          {question ? <ModeChip mode={question.mode} short={compact} /> : null}
          {/* Phones: the spectator note lives in the body so the bar stays on one row. */}
          {game.isSpectator && !compact ? (
            <Badge color="var(--purple)" icon="eye">
              Spectating
            </Badge>
          ) : null}
        </>
      }
      timer={collecting || revealing ? <StageTimer size={compact ? 44 : 54} /> : null}
      right={
        <>
          <HostBar skipLabel={skipLabel} compact={compact} />
          {rules}
        </>
      }
    />
  );

  const board = (
    <Leaderboard
      players={game.players}
      seats={state.seats}
      scoreSeq={state.scoreSeq}
      meId={meId}
      limit={compact ? 5 : 8}
      dense
      title="Standings"
    />
  );

  let body: ReactNode;
  if (revealing) {
    body = (
      <RevealView
        state={state}
        question={question}
        result={result}
        priv={priv}
        meId={meId}
        spectator={game.isSpectator}
        players={game.players}
        board={compact ? board : null}
      />
    );
  } else if (collecting) {
    body = (
      <>
        <QuestionPrompt question={question} q={state.q} compact={Boolean(priv?.answered) || stage === 'predict'} />
        <TimerBar />
        {game.isSpectator ? <SpectatorOptions question={question} /> : <QuestionSteps state={state} question={question} priv={priv} />}
      </>
    );
  } else {
    body = <GetReady question={question} round={state.round} total={state.totalRounds} />;
  }

  return (
    <PartyStage
      gameId="survey"
      className="sv-stage"
      stage={stage}
      top={top}
      side={compact ? undefined : board}
      bottom={
        collecting ? (
          <AnsweredStrip
            players={game.players}
            seats={state.seats}
            meId={meId}
            verb={stage === 'predict' ? 'predicted' : 'answered'}
            max={compact ? 9 : 18}
          />
        ) : undefined
      }
    >
      <PausedBanner />
      <div className="sv-main" data-stage={stage}>
        {body}
      </div>
    </PartyStage>
  );
}

function QuestionPrompt({ question, q, compact }: { question: SurveyQuestion; q: number; compact: boolean }) {
  return (
    <PromptCard
      animKey={q}
      size={compact ? 'md' : 'lg'}
      kicker={
        <span className="sv-kicker">
          <PixelIcon name={MODE_ICON[question.mode]} size={12} /> {SURVEY_MODE_INFO[question.mode].title}
        </span>
      }
      meta={
        compact ? undefined : (
          <span className="sv-anon">
            <PixelIcon name="lock" size={12} /> Answers are anonymous
          </span>
        )
      }
    >
      {question.prompt}
    </PromptCard>
  );
}

function GetReady({ question, round, total }: { question: SurveyQuestion | null; round: number; total: number }) {
  return (
    <Interstitial
      icon={question ? MODE_ICON[question.mode] : 'sparkle'}
      kicker={total > 0 ? `Question ${Math.max(1, round)} of ${total}` : 'DAS Survey'}
      title={question ? SURVEY_MODE_INFO[question.mode].title : 'How well do you know this room?'}
    >
      <p>Answer anonymously, then predict how the room answered. Closer predictions score more.</p>
    </Interstitial>
  );
}
