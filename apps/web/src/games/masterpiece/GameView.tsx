/**
 * DASterpiece game view: the party-kit stage (top bar with exhibition counter, theme chip, timer,
 * host controls and rules; leaderboard rail on desktop; status strip at the bottom) around the
 * current stage — intro, write, vote/reveal, scores — and the results screen.
 */
import { useEffect, useRef } from 'react';
import { Badge, Spinner } from '@dascade/ui';
import { MASTERPIECE_MSG, MP_PROMPT_TYPE_INFO, type MasterpiecePublicState, type MpGameEvent, type MpStage } from '@dascade/shared/games/masterpiece';
import { GameStage } from '../../shell/common.tsx';
import { useRoomMessage } from '../../net/hooks.ts';
import { sfx } from '../../audio/audio.ts';
import {
  AnsweredStrip,
  HostBar,
  Interstitial,
  Leaderboard,
  PARTY_COMPACT_QUERY,
  PartyStage,
  PartyTopBar,
  PausedBanner,
  RoundCounter,
  RulesDrawer,
  StageChip,
  StageTimer,
  useMediaQuery,
  useTimerTicks,
} from '../_party/index.ts';
import { THEME_ICON } from './art.tsx';
import { useMpGame, useMpPrivate } from './hooks.ts';
import { MpResults } from './Results.tsx';
import { RULES_TITLE, RULE_SECTIONS } from './rules.tsx';
import { ShowdownStage } from './Showdown.tsx';
import { RoundIntro, RoundScores, VoteMeter } from './Stages.tsx';
import { WriteStage } from './Write.tsx';

const SKIP_LABEL: Partial<Record<MpStage, string>> = {
  intro: 'Start writing',
  write: 'End writing',
  vote: 'Close voting',
  reveal: 'Next',
  scores: 'Continue',
};

const RULES_FOR_STAGE: Partial<Record<MpStage, string>> = { intro: 'Write', write: 'Write', vote: 'Vote', reveal: 'Reveal', scores: 'Score' };

export function MasterpieceGameView() {
  const game = useMpGame();
  useMpSounds(game?.playerId ?? null);
  if (!game) {
    return (
      <GameStage gameId="masterpiece" className="pk-stage">
        <div className="center-screen">
          <Spinner label="Opening the gallery" />
        </div>
      </GameStage>
    );
  }
  if (game.phase === 'RESULTS' || game.state.stage === 'final') return <MpResults state={game.state} players={game.players} meId={game.playerId} />;
  return <MpTable />;
}

function MpTable() {
  const game = useMpGame();
  const state = game?.state as MasterpiecePublicState | undefined;
  const priv = useMpPrivate(state?.round ?? 0);
  const compact = useMediaQuery(PARTY_COMPACT_QUERY);
  const stage = (state?.stage ?? 'idle') as MpStage;
  useTimerTicks(stage === 'write' || stage === 'vote', 5);
  if (!game || !state) return null;

  const meId = game.playerId;
  const isWriter = Boolean(meId && state.written && meId in state.written);
  const theme = state.roundType || null;
  const settings = game.settings;

  let main: React.ReactNode;
  if (game.phase === 'COUNTDOWN' || stage === 'idle') {
    main = (
      <Interstitial icon="sparkle" kicker="DASterpiece" title="The gallery is opening…">
        Sharpen your wit. Prompts are dealt privately — answers go up anonymously.
      </Interstitial>
    );
  } else if (stage === 'intro') main = <RoundIntro state={state} isWriter={isWriter} />;
  else if (stage === 'write') main = <WriteStage state={state} priv={priv} />;
  else if (stage === 'vote' || stage === 'reveal') {
    main = <ShowdownStage state={state} priv={priv} players={game.players} meId={meId} allowChange={Boolean(settings?.allowVoteChange)} />;
  } else if (stage === 'scores') main = <RoundScores state={state} players={game.players} meId={meId} />;
  else main = null;

  const top = (
    <PartyTopBar
      left={
        <>
          <RoundCounter label="Exhibition" round={Math.max(1, state.round)} total={Math.max(1, state.totalRounds)} />
          {compact ? <RulesDrawer title={RULES_TITLE} sections={RULE_SECTIONS} highlight={RULES_FOR_STAGE[stage]} compact /> : null}
          {theme && !compact ? (
            <StageChip icon={THEME_ICON[theme]} title="Round theme">
              {MP_PROMPT_TYPE_INFO[theme].label}
            </StageChip>
          ) : null}
          {state.multiplier > 1 ? (
            <StageChip icon="star" color="var(--yellow)" title="Final exhibition">
              ×2 points
            </StageChip>
          ) : null}
          {game.isSpectator ? (
            <Badge color="var(--purple)" icon="eye">
              {state.audienceOpen ? 'Audience' : 'Spectating'}
            </Badge>
          ) : null}
        </>
      }
      timer={<StageTimer size={compact ? 48 : 56} label={stage === 'write' ? 'Writing time left' : stage === 'vote' ? 'Voting time left' : 'Time left'} />}
      right={
        <>
          <HostBar skipLabel={SKIP_LABEL[stage] ?? null} compact={compact} />
          {compact ? null : <RulesDrawer title={RULES_TITLE} sections={RULE_SECTIONS} highlight={RULES_FOR_STAGE[stage]} />}
        </>
      }
    />
  );

  let bottom: React.ReactNode = null;
  if (stage === 'write') bottom = <AnsweredStrip players={game.players} seats={state.seats} meId={meId} verb="handed in" max={compact ? 10 : 18} />;
  else if (stage === 'vote' || stage === 'reveal') bottom = <VoteMeter state={state} />;

  const side = stage === 'scores' ? null : <Leaderboard players={game.players} seats={state.seats} scoreSeq={state.scoreSeq} meId={meId} limit={10} dense animate={false} title="Standings" />;

  return (
    <PartyStage gameId="masterpiece" className="mp-stage" stage={stage} top={top} side={side} bottom={bottom}>
      <PausedBanner />
      {main}
    </PartyStage>
  );
}

/** Light sound design on public events (respects mute/volume through sfx()). */
function useMpSounds(meId: string | null) {
  const me = useRef(meId);
  useEffect(() => {
    me.current = meId;
  }, [meId]);
  useRoomMessage<MpGameEvent>(MASTERPIECE_MSG.event, (e) => {
    if (e.type === 'write') sfx('go');
    else if (e.type === 'submitted' && e.playerId !== me.current && e.done) sfx('pop', 250);
    else if (e.type === 'vote') sfx('whoosh');
  });
}
