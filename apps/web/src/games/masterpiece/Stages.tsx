/**
 * Round intro card, round standings and the voting meter.
 */
import { useEffect, useMemo } from 'react';
import { Avatar, PixelArt, PixelIcon, cx } from '@dascade/ui';
import { MP_PROMPT_TYPE_INFO, MP_VOTE_KIND_INFO, type MasterpiecePublicState, type MpVoteKind } from '@dascade/shared/games/masterpiece';
import type { PlayerView } from '@dascade/shared';
import { sfx } from '../../audio/audio.ts';
import { Leaderboard, usePartyFx } from '../_party/index.ts';
import { MP_ART, THEME_ICON } from './art.tsx';
import { useHall } from './hooks.ts';

export function RoundIntro({ state, isWriter }: { state: MasterpiecePublicState; isWriter: boolean }) {
  const fx = usePartyFx();
  const theme = state.roundType || 'caption';
  const info = MP_PROMPT_TYPE_INFO[theme];
  const kind = (state.roundKind || 'favourite') as MpVoteKind;
  const final = state.round === state.totalRounds && state.totalRounds > 1;
  useEffect(() => {
    sfx('start');
  }, [state.round]);
  return (
    <section className={cx('mp-intro', fx.motion && 'mp-intro--animate')} key={state.round} aria-live="polite">
      <p className="mp-intro__kicker">
        {final ? 'Final exhibition' : 'Exhibition'} <span className="dc-num">{state.round}</span> of <span className="dc-num">{state.totalRounds}</span>
      </p>
      <div className="mp-intro__frame" data-part="interstitial">
        <span className="mp-intro__icon" aria-hidden="true">
          <PixelIcon name={THEME_ICON[theme]} />
        </span>
        <h1 className="mp-intro__title">{info.label}</h1>
        <p className="mp-intro__blurb">{info.instruction}</p>
      </div>
      <div className="mp-intro__meta">
        <span className="mp-intro__chip">
          <PixelIcon name="check" size={12} /> {MP_VOTE_KIND_INFO[kind].label} voting
        </span>
        {state.multiplier > 1 ? (
          <span className="mp-intro__chip mp-intro__chip--gold">
            <PixelIcon name="star" size={12} /> Double points
          </span>
        ) : null}
        {isWriter && state.perWriter > 1 ? (
          <span className="mp-intro__chip">
            <PixelIcon name="pencil" size={12} /> You answer <span className="dc-num">{state.perWriter}</span> prompts
          </span>
        ) : null}
      </div>
      <p className="mp-intro__how">{MP_VOTE_KIND_INFO[kind].blurb}</p>
    </section>
  );
}

export function RoundScores({ state, players, meId }: { state: MasterpiecePublicState; players: PlayerView[]; meId: string | null }) {
  const hall = useHall(state.hallJson);
  const best = useMemo(() => {
    const round = hall.filter((h) => h.round === state.round);
    return round.sort((a, b) => b.points - a.points || Number(b.sweep) - Number(a.sweep))[0] ?? null;
  }, [hall, state.round]);
  const author = best ? players.find((p) => p.id === best.authorId) : undefined;
  const last = state.round >= state.totalRounds;
  useEffect(() => {
    sfx('whoosh');
  }, [state.scoreSeq]);
  return (
    <div className="mp-scores" data-part="score-reveal">
      <header className="mp-scores__head">
        <span className="dc-label">{last ? 'Final tally' : `After exhibition ${state.round}`}</span>
        <h2 className="mp-scores__title">{last ? 'And the gallery’s verdict is…' : 'The critics have spoken'}</h2>
      </header>
      {best ? (
        <figure className="mp-best" data-part="winner-card">
          <PixelArt rows={MP_ART.ribbon} className="mp-best__ribbon" />
          <figcaption className="mp-best__label">Best in show</figcaption>
          <p className="mp-best__prompt">{best.prompt}</p>
          <blockquote className="mp-best__text">{best.text}</blockquote>
          <p className="mp-best__author">
            {author ? <Avatar avatar={author.avatar} color={author.color} size={22} /> : null}
            <strong style={author ? { color: author.color } : undefined}>{best.authorName}</strong>
            <span className="dc-num">+{best.points.toLocaleString('en-US')}</span>
            {best.sweep ? <span className="mp-badge mp-badge--sweep">Sweep</span> : null}
          </p>
        </figure>
      ) : null}
      <Leaderboard players={players} seats={state.seats} scoreSeq={state.scoreSeq} meId={meId} limit={12} title="Standings" />
    </div>
  );
}

/** Aggregate voting progress — never who voted (see the room header on anonymity). */
export function VoteMeter({ state }: { state: MasterpiecePublicState }) {
  if (state.stage === 'reveal') {
    return (
      <div className="mp-meter" data-part="vote-meter" role="status">
        <PixelIcon name="check" size={12} /> Votes counted
        {state.audienceOpen && state.audienceIn > 0 ? (
          <span className="mp-meter__aud">
            · <span className="dc-num">{state.audienceIn}</span> from the audience
          </span>
        ) : null}
      </div>
    );
  }
  const expected = Math.max(state.votersExpected, state.votesIn);
  const pct = expected > 0 ? Math.min(1, state.votesIn / expected) : 0;
  return (
    <div className="mp-meter" data-part="vote-meter" role="status" aria-label={`${state.votesIn} of ${expected} votes in`}>
      <span className="mp-meter__count dc-num" aria-hidden="true">
        {state.votesIn}
        <span className="mp-meter__of">/{expected}</span>
      </span>
      <span className="mp-meter__label" aria-hidden="true">
        votes in
      </span>
      <span className="mp-meter__track" aria-hidden="true">
        <span className="mp-meter__fill" style={{ transform: `scaleX(${pct})` }} />
      </span>
      {state.audienceOpen ? (
        <span className="mp-meter__aud" aria-hidden="true">
          <PixelIcon name="users" size={12} /> <span className="dc-num">{state.audienceIn}</span> audience
        </span>
      ) : null}
    </div>
  );
}
