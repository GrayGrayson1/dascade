/**
 * DASwords game view: party-kit stage chrome (round counter, timer, host bar, rules) around the
 * mode's play screen, the host review, reveals and final results.
 */
import type { CSSProperties } from 'react';
import type { PlayerView } from '@dascade/shared';
import { WORDS_MODE_INFO, WORDS_MODES, type WordsMode, type WordsPublicState, type WordsRoundReveal } from '@dascade/shared/games/words';
import { Avatar, Spinner, cx } from '@dascade/ui';
import { GameStage } from '../../shell/common.tsx';
import {
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
  TeamBadge,
  TeamBoard,
  TimerBar,
  useMediaQuery,
  useTimerTicks,
  type RulesSection,
} from '../_party/index.ts';
import { AnagramPlay, ChainPlay, ForbiddenPlay, GridPlay } from './Play.tsx';
import { ReviewStage } from './Review.tsx';
import { RoundReveal } from './Reveal.tsx';
import { RoundIntro } from './Intro.tsx';
import { WordsResults } from './Results.tsx';
import { useJson, useWordsGame, useWordsPrivate } from './hooks.ts';
import { useVerdictSounds, useWordsSounds } from './sounds.ts';

const RULES: RulesSection[] = [
  ...WORDS_MODES.map((m) => ({ title: WORDS_MODE_INFO[m].title, items: WORDS_MODE_INFO[m].rules })),
  {
    title: 'The dictionary',
    items: [
      'Every word is checked on the server against DASwords’ built-in dictionary (≈169,000 words, British and American spellings). No external lookups.',
      'Proper nouns, abbreviations and offensive words are not accepted.',
      'Duplicates and late words don’t count. Your words stay private until the reveal.',
    ],
  },
];

function skipLabel(state: WordsPublicState): string | null {
  switch (state.stage) {
    case 'intro':
      return 'Start now';
    case 'play':
      return 'End round';
    case 'review':
      return 'Finish review';
    case 'linkReveal':
      return 'Next link';
    case 'reveal':
      return state.round >= state.totalRounds ? 'Final results' : 'Next round';
    default:
      return null;
  }
}

export function WordsView() {
  const game = useWordsGame();
  useWordsSounds();
  if (!game) {
    return (
      <GameStage gameId="words">
        <div className="center-screen">
          <Spinner label="Loading DASwords" />
        </div>
      </GameStage>
    );
  }
  if (game.phase === 'RESULTS' || game.state.stage === 'final') return <WordsResults state={game.state} meId={game.playerId} />;
  return <WordsTable />;
}

function WordsTable() {
  const game = useWordsGame();
  const state = game?.state;
  const priv = useWordsPrivate(state?.round ?? 0);
  useVerdictSounds(priv);
  useTimerTicks(state?.stage === 'play' || state?.stage === 'link' || state?.stage === 'review', 5);
  const compact = useMediaQuery(PARTY_COMPACT_QUERY);
  const reveal = useJson<WordsRoundReveal | null>(state?.revealJson, null);
  if (!game || !state) return null;

  const { settings, playerId: meId, players, isHost, isSpectator } = game;
  const mode = (state.mode || settings.mode) as WordsMode;
  const stage = state.stage;
  const myTeam = meId ? state.seats[meId]?.teamId : '';
  const playing = stage === 'play' || stage === 'link' || stage === 'linkReveal' || stage === 'review';
  const props = { state, priv, meId, players, spectator: isSpectator, settings };

  let body;
  if (stage === 'intro') body = <RoundIntro state={state} settings={settings} />;
  else if (stage === 'play' && mode === 'grid') body = <GridPlay {...props} />;
  else if (stage === 'play' && mode === 'anagram') body = <AnagramPlay {...props} />;
  else if (stage === 'play' && mode === 'forbidden') body = <ForbiddenPlay {...props} />;
  else if (stage === 'link' || stage === 'linkReveal') body = <ChainPlay {...props} />;
  else if (stage === 'review') body = <ReviewStage state={state} isHost={isHost} priv={priv} />;
  else if (stage === 'reveal' && reveal) body = <RoundReveal state={state} reveal={reveal} players={players} meId={meId} uniqueOnly={settings.uniqueOnly} />;
  else body = <Interstitial icon="sparkle" kicker="DASwords" title="Get ready…" />;

  const side =
    stage === 'intro' || stage === 'reveal' || !compact ? (
      <>
        {state.teamMode ? <TeamBoard teams={state.teams} scoring={state.teamScoring} scoreSeq={state.scoreSeq} /> : null}
        <Leaderboard players={players} seats={state.seats} scoreSeq={state.scoreSeq} meId={meId} teamMode={state.teamMode} dense limit={compact ? 5 : 10} />
      </>
    ) : null;

  return (
    <PartyStage
      gameId="words"
      className={cx('wd-stage', `wd-stage--${mode}`)}
      stage={stage}
      sideOnCompact={stage === 'reveal' || stage === 'intro'}
      top={
        <>
          <PartyTopBar
            left={
              <>
                <RoundCounter round={Math.max(1, state.round)} total={Math.max(1, state.totalRounds)} />
                {compact ? <StageTimer size={40} /> : null}
                {compact && isHost ? null : <StageChip color="var(--accent)">{WORDS_MODE_INFO[mode].title}</StageChip>}
                {state.teamMode && myTeam ? <TeamBadge teamId={myTeam} size="sm" short /> : null}
              </>
            }
            timer={compact ? undefined : <StageTimer size={56} />}
            right={
              <>
                <HostBar skipLabel={skipLabel(state)} compact={compact} canPause={stage !== 'reveal'} />
                <RulesDrawer title="How DASwords works" sections={RULES} highlight={WORDS_MODE_INFO[mode].title} compact={compact} />
              </>
            }
          />
          {playing ? <TimerBar className="wd-timerbar" /> : null}
          <PausedBanner />
        </>
      }
      side={side ?? undefined}
      bottom={stage === 'play' && mode !== 'chain' ? <ProgressStrip state={state} players={players} meId={meId} /> : undefined}
    >
      <div className="wd-body">{body}</div>
    </PartyStage>
  );
}

/** Everyone's live word count (never which words). */
function ProgressStrip({ state, players, meId }: { state: WordsPublicState; players: PlayerView[]; meId: string | null }) {
  const seated = players.filter((p) => !p.spectator);
  if (seated.length < 2) return null;
  return (
    <ul className="wd-progress" aria-label="Words found so far">
      {seated.map((p) => {
        const found = state.progress[p.id]?.found ?? 0;
        return (
          <li key={p.id} className={cx('wd-progress__item', p.id === meId && 'is-me', !p.connected && 'is-offline')} style={{ '--player': p.color } as CSSProperties} aria-label={`${p.name}: ${found} words`}>
            <Avatar avatar={p.avatar} color={p.color} size={24} offline={!p.connected} />
            <span className="wd-progress__name">{p.name}</span>
            <span className="wd-progress__count dc-num">{found}</span>
          </li>
        );
      })}
    </ul>
  );
}
