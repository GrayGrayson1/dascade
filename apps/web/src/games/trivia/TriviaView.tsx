/**
 * DAStravaganza Trivia game view: intro → question → reveal → scores (→ wager → final) → results.
 * Built from the party kit (PartyStage, PromptCard, AnswerGrid, Leaderboard, PartyResults…).
 */
import { useMemo, type CSSProperties } from 'react';
import {
  TRIVIA_CATEGORIES,
  TRIVIA_TYPE_LABEL,
  type TriviaAnyCategoryId,
  type TriviaPublicState,
  type TriviaQuestionView,
  type TriviaSettings,
} from '@dascade/shared/games/trivia';
import { partyTeam } from '@dascade/shared/party';
import { Badge, PixelIcon, Spinner } from '@dascade/ui';
import { GameStage } from '../../shell/common.tsx';
import {
  AnsweredStrip,
  HostBar,
  Interstitial,
  Leaderboard,
  PartyResults,
  PartyStage,
  PartyTopBar,
  PausedBanner,
  PromptCard,
  RoundCounter,
  RulesDrawer,
  StageChip,
  StageTimer,
  TeamBadge,
  TeamBoard,
  TimerBar,
  parseJson,
  useMediaQuery,
  usePodium,
  PARTY_COMPACT_QUERY,
} from '../_party/index.ts';
import type { GameContext } from '../../net/hooks.ts';
import { LiveAnswer, MyResult, RevealAnswer } from './AnswerArea.tsx';
import { WagerPanel } from './Wager.tsx';
import { RULES_STAGE_TITLE, triviaRules } from './rules.ts';
import { useQuestionView, useRevealView, useTriviaGame, useTriviaPrivate, useTriviaSounds } from './hooks.ts';

type Game = GameContext<TriviaPublicState, TriviaSettings>;

export function TriviaView() {
  const game = useTriviaGame();
  if (!game) {
    return (
      <GameStage gameId="trivia" className="pk-stage">
        <div className="center-screen">
          <Spinner label="Loading trivia" />
        </div>
      </GameStage>
    );
  }
  if (game.phase === 'RESULTS' || (game.state.stage === 'final' && game.state.podiumJson)) return <TriviaResults game={game} />;
  return <TriviaShow game={game} />;
}

const SKIP_LABEL: Record<string, string> = {
  intro: 'Start now',
  question: 'Reveal now',
  reveal: 'Next',
  scores: 'Next question',
  wager: 'Close wagers',
};

function CategoryChip({ category }: { category: string }) {
  const meta = TRIVIA_CATEGORIES[category as TriviaAnyCategoryId] ?? TRIVIA_CATEGORIES.custom;
  return (
    <StageChip icon={meta.icon} color={meta.color}>
      {meta.short}
    </StageChip>
  );
}

function TriviaShow({ game }: { game: Game }) {
  const { state, settings, playerId, isSpectator, players } = game;
  const stage = game.phase === 'COUNTDOWN' ? 'intro' : state.stage;
  const view = useQuestionView(state.questionJson);
  const reveal = useRevealView(state.revealJson);
  const priv = useTriviaPrivate(view ? view.seq : -1);
  const wagerPriv = useTriviaPrivate(undefined);
  const compact = useMediaQuery(PARTY_COMPACT_QUERY);
  const seat = playerId ? state.seats?.[playerId] : undefined;
  const canAnswer = Boolean(!isSpectator && seat?.eligible);
  const locked = Boolean(priv?.answer);
  useTriviaSounds({ stage, seq: view?.seq, locked, canAnswer, priv: stage === 'reveal' ? priv : null });

  const rules = useMemo(() => triviaRules(settings), [settings]);
  const total = state.totalRounds || view?.total || settings.questionCount;
  const isFinal = Boolean(view?.isFinal) || stage === 'wager';

  const top = (
    <PartyTopBar
      left={
        <>
          {stage === 'intro' ? (
            <StageChip icon="sparkle">Get ready</StageChip>
          ) : (
            <RoundCounter label={isFinal ? 'Final' : 'Question'} round={Math.max(1, state.round)} total={total} />
          )}
          {view && (stage === 'question' || stage === 'reveal') ? <CategoryChip category={view.category} /> : null}
          {stage === 'wager' && state.finalCategory ? <CategoryChip category={state.finalCategory} /> : null}
          {state.teamMode && seat?.teamId ? <TeamBadge teamId={seat.teamId} size="sm" short={compact} /> : null}
          {isSpectator ? (
            <Badge color="var(--purple)" icon="eye">
              Spectating
            </Badge>
          ) : null}
        </>
      }
      timer={stage === 'question' || stage === 'wager' ? <StageTimer size={compact ? 48 : 58} /> : null}
      right={
        <>
          <HostBar skipLabel={SKIP_LABEL[stage] ?? null} compact={compact} />
          <RulesDrawer title="Trivia rules" sections={rules} highlight={RULES_STAGE_TITLE[stage]} compact={compact} />
        </>
      }
    />
  );

  const side = (
    <>
      {state.teamMode ? <TeamBoard teams={state.teams} scoring={state.teamScoring} scoreSeq={state.scoreSeq} /> : null}
      <Leaderboard
        players={players}
        seats={state.seats}
        scoreSeq={state.scoreSeq}
        meId={playerId}
        limit={8}
        teamMode={state.teamMode}
        animate={false}
        dense
        title="Scores"
      />
    </>
  );

  let main: React.ReactNode;
  let bottom: React.ReactNode = null;
  if (stage === 'intro' || stage === 'idle') {
    main = <IntroCard game={game} />;
  } else if (stage === 'wager') {
    main = (
      <WagerPanel
        key={`${wagerPriv?.seq ?? 0}:${wagerPriv?.wager?.max ?? 0}`}
        category={state.finalCategory}
        priv={wagerPriv?.wager ? wagerPriv : null}
        canWager={canAnswer}
        score={game.me?.score ?? 0}
      />
    );
    bottom = <AnsweredStrip players={players} seats={state.seats} meId={playerId} verb="wagered" />;
  } else if (stage === 'question' && view) {
    main = (
      <>
        <QuestionPrompt view={view} />
        <TimerBar />
        <LiveAnswer
          key={view.seq}
          view={view}
          priv={priv}
          canAnswer={canAnswer}
          blockedText={isSpectator ? 'You’re spectating — enjoy the show!' : 'You joined mid-question — you’re in from the next one.'}
          answeredCount={state.answeredCount}
          eligibleCount={state.eligibleCount}
        />
      </>
    );
    bottom = <AnsweredStrip players={players} seats={state.seats} meId={playerId} />;
  } else if (stage === 'reveal' && view && reveal && reveal.seq === view.seq) {
    main = (
      <>
        <QuestionPrompt view={view} size="md" />
        <RevealAnswer view={view} reveal={reveal} priv={priv} meId={playerId} />
        <div className="tv-reveal-foot">
          {!isSpectator ? <MyResult reveal={reveal} meId={playerId} isFinal={view.isFinal} /> : null}
          {reveal.explanation ? (
            <p className="tv-explain">
              <PixelIcon name="info" />
              <span>{reveal.explanation}</span>
            </p>
          ) : null}
        </div>
      </>
    );
  } else if (stage === 'scores') {
    main = (
      <div className="tv-scores">
        <h2 className="tv-scores__title">
          {state.round >= total - 1 && settings.finalWager && total >= 2
            ? 'Before the final…'
            : `After question ${state.round} of ${total}`}
        </h2>
        {state.teamMode ? <TeamBoard teams={state.teams} scoring={state.teamScoring} scoreSeq={state.scoreSeq} /> : null}
        <Leaderboard
          players={players}
          seats={state.seats}
          scoreSeq={state.scoreSeq}
          meId={playerId}
          limit={compact ? 6 : 10}
          teamMode={state.teamMode}
        />
      </div>
    );
  } else {
    main = (
      <Interstitial icon="clock" title="Next question coming up…" animKey={state.stageSeq}>
        Hang tight.
      </Interstitial>
    );
  }

  return (
    <PartyStage gameId="trivia" className="tv-stage" stage={stage} top={top} side={stage === 'scores' ? undefined : side} bottom={bottom}>
      <PausedBanner />
      {main}
    </PartyStage>
  );
}

function QuestionPrompt({ view, size = 'lg' }: { view: TriviaQuestionView; size?: 'md' | 'lg' }) {
  return (
    <PromptCard
      animKey={`${view.seq}:${size}`}
      size={size}
      tone={view.isFinal ? 'final' : 'default'}
      kicker={view.isFinal ? `Final question · ${TRIVIA_TYPE_LABEL[view.type]}` : TRIVIA_TYPE_LABEL[view.type]}
      meta={
        <>
          <StageChip icon="star">{view.difficulty[0]!.toUpperCase() + view.difficulty.slice(1)}</StageChip>
          {!view.isFinal ? <StageChip icon="trophy">{view.points.toLocaleString('en-US')} pts</StageChip> : null}
        </>
      }
    >
      {view.prompt}
    </PromptCard>
  );
}

function IntroCard({ game }: { game: Game }) {
  const { state, settings, playerId, seated } = game;
  const team = playerId ? partyTeam(state.seats?.[playerId]?.teamId ?? '') : undefined;
  const cats = settings.categories.length === 0 ? 'All categories' : settings.categories.map((c) => TRIVIA_CATEGORIES[c].short).join(' · ');
  return (
    <Interstitial icon="star" kicker="DAStravaganza Trivia" title="Get ready!" animKey={state.stageSeq}>
      <ul className="tv-intro">
        <li>
          <PixelIcon name="flag" /> <span className="dc-num">{state.totalRounds || settings.questionCount}</span> questions ·{' '}
          {settings.answerSeconds}s each
        </li>
        <li>
          <PixelIcon name="star" />{' '}
          {settings.pack === 'custom' ? 'Custom pack' : settings.pack === 'mixed' ? `Starter + custom · ${cats}` : cats}
        </li>
        <li>
          <PixelIcon name="users" /> {settings.mode === 'teams' ? `${settings.teamCount} teams` : 'Free-for-all'} · {seated.length} player
          {seated.length === 1 ? '' : 's'}
        </li>
        {settings.finalWager ? (
          <li>
            <PixelIcon name="chip" /> Final wager round
          </li>
        ) : null}
      </ul>
      {team ? (
        <p className="tv-intro__team" style={{ '--team': team.color } as CSSProperties}>
          You’re on <TeamBadge teamId={team.id} />
        </p>
      ) : null}
    </Interstitial>
  );
}

function TriviaResults({ game }: { game: Game }) {
  const podium = usePodium();
  const correct = useMemo(() => parseJson<Record<string, number>>(game.state.correctJson, {}), [game.state.correctJson]);
  const total = game.state.totalRounds;
  if (!podium) {
    return (
      <GameStage gameId="trivia" className="pk-stage">
        <div className="center-screen">
          <Spinner label="Tallying scores" />
        </div>
      </GameStage>
    );
  }
  return (
    <PartyResults
      gameId="trivia"
      kicker="DAStravaganza Trivia · Final standings"
      podium={podium}
      meId={game.playerId}
      statFor={(p) => `${correct[p.id] ?? 0}/${total} correct`}
    />
  );
}
