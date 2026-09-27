/**
 * Showdown stage: anonymous framed "exhibits" to vote on, then the reveal (votes, points,
 * winner, sweep stamp, audience pick and — only now — the authors).
 *
 * Favourite / head-to-head: tap an exhibit, then "Vote for B". Ranked: tap exhibits in order for
 * gold, silver and bronze. Votes lock when cast unless the host allows changes until lock-in.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Avatar, Button, PixelArt, PixelIcon, cx } from '@dascade/ui';
import {
  MASTERPIECE_MSG,
  MP_LIMITS,
  MP_VOTE_KIND_INFO,
  type MasterpiecePublicState,
  type MpAnswerView,
  type MpPrivate,
  type MpVoteKind,
} from '@dascade/shared/games/masterpiece';
import type { PlayerView } from '@dascade/shared';
import { session } from '../../net/hooks.ts';
import { sfx } from '../../audio/audio.ts';
import { LockNote, usePartyFx } from '../_party/index.ts';
import { MP_ART } from './art.tsx';
import { RANK_NAMES, exhibitLetter } from './hooks.ts';
import { PromptPlacard } from './Write.tsx';

export function ShowdownStage({ state, priv, players, meId, allowChange }: { state: MasterpiecePublicState; priv: MpPrivate | null; players: PlayerView[]; meId: string | null; allowChange: boolean }) {
  // Remount per showdown so local picks never leak between prompts.
  return <Showdown key={state.showdownId} state={state} priv={priv} players={players} meId={meId} allowChange={allowChange} />;
}

function Showdown({ state, priv, players, meId, allowChange }: { state: MasterpiecePublicState; priv: MpPrivate | null; players: PlayerView[]; meId: string | null; allowChange: boolean }) {
  const revealed = state.stage === 'reveal';
  const kind = (state.voteKind || state.roundKind || 'favourite') as MpVoteKind;
  const mine = priv && priv.showdownId === state.showdownId ? priv : null;
  const ownIds = mine?.ownAnswerIds ?? [];
  const ballot = mine?.ballot ?? null;
  const canVote = Boolean(mine?.canVote) && state.stage === 'vote';
  const locked = Boolean(ballot?.locked);
  const need = kind === 'ranked' ? Math.max(1, Math.min(MP_LIMITS.rankedPicks, state.answers.length - ownIds.length)) : 1;
  const [picks, setPicks] = useState<string[]>(() => ballot?.picks ?? []);
  const fx = usePartyFx();

  // Server ballot wins (reconnect, lock).
  const ballotKey = ballot ? `${ballot.picks.join(',')}:${ballot.locked}` : '';
  useEffect(() => {
    if (ballot) setPicks(ballot.picks);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the ballot's content
  }, [ballotKey]);

  const answers = state.answers;
  const sweep = revealed && answers.some((a) => a.sweep);
  const walkover = state.walkover;
  useEffect(() => {
    if (revealed) sfx(sweep ? 'bigwin' : walkover ? 'ding' : 'flip');
  }, [revealed, sweep, walkover]);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const maxVotes = Math.max(1, ...answers.map((a) => a.votes));

  const toggle = (id: string) => {
    if (!canVote || locked || ownIds.includes(id)) return;
    sfx('select');
    if (kind === 'ranked') {
      setPicks((cur) => (cur.includes(id) ? cur.filter((p) => p !== id) : cur.length < need ? [...cur, id] : cur));
    } else setPicks([id]);
  };

  const cast = () => {
    if (picks.length !== need) return;
    sfx('ding');
    session.send(MASTERPIECE_MSG.vote, { showdownId: state.showdownId, picks });
  };
  const lockIn = () => {
    sfx('ready');
    session.send(MASTERPIECE_MSG.lock, { showdownId: state.showdownId });
  };

  const changed = ballot ? ballot.picks.join(',') !== picks.join(',') : true;
  const pickedLetters = picks.map((id) => exhibitLetter(answers.findIndex((a) => a.id === id)));

  return (
    <div className="mp-showdown" data-kind={kind} data-revealed={revealed ? 'true' : undefined}>
      <header className="mp-showdown__head">
        <span className="mp-showdown__count">
          {state.walkover ? 'Unopposed' : MP_VOTE_KIND_INFO[kind].label}
          <span className="dc-num">
            {' '}
            · {state.showdownIndex + 1}/{state.showdownCount}
          </span>
        </span>
        {state.promptType ? <PromptPlacard type={state.promptType} prompt={state.prompt} compact /> : null}
      </header>

      {sweep ? (
        <div className={cx('mp-stamp', fx.motion && 'mp-stamp--animate')} role="status">
          <span>It’s a</span> <strong>DASterpiece!</strong>
        </div>
      ) : null}

      <ol
        className={cx('mp-wall', answers.length === 2 && 'mp-wall--duel', answers.length === 3 && 'mp-wall--trio', answers.length > 4 && 'mp-wall--many')}
        data-part="vote-grid"
        aria-label="Exhibits"
      >
        {answers.map((a, i) => (
          <Exhibit
            key={a.id}
            answer={a}
            index={i}
            kind={kind}
            revealed={revealed}
            own={ownIds.includes(a.id)}
            rank={picks.indexOf(a.id)}
            votedRank={ballot ? ballot.picks.indexOf(a.id) : -1}
            interactive={canVote && !locked && !ownIds.includes(a.id)}
            author={a.authorId ? byId.get(a.authorId) : undefined}
            share={a.votes / maxVotes}
            isMe={Boolean(meId && a.authorId === meId)}
            onToggle={() => toggle(a.id)}
          />
        ))}
      </ol>

      {!revealed ? (
        <VoteActions
          kind={kind}
          mine={mine}
          canVote={canVote}
          locked={locked}
          ballotCast={Boolean(ballot)}
          allowChange={allowChange}
          ready={picks.length === need}
          changed={changed}
          need={need}
          pickedLetters={pickedLetters}
          onCast={cast}
          onLock={lockIn}
          onClear={() => setPicks([])}
        />
      ) : null}
    </div>
  );
}

function Exhibit({
  answer,
  index,
  kind,
  revealed,
  own,
  rank,
  votedRank,
  interactive,
  author,
  share,
  isMe,
  onToggle,
}: {
  answer: MpAnswerView;
  index: number;
  kind: MpVoteKind;
  revealed: boolean;
  own: boolean;
  rank: number;
  votedRank: number;
  interactive: boolean;
  author: PlayerView | undefined;
  share: number;
  isMe: boolean;
  onToggle: () => void;
}) {
  const letter = exhibitLetter(index);
  const picked = rank >= 0;
  const body = answer.blank ? (
    <p className="mp-exhibit__blank">
      <PixelIcon name="clock" size={14} /> Lost in the mail — nothing was handed in.
    </p>
  ) : (
    <p className="mp-exhibit__text">{answer.text}</p>
  );
  const label = `Exhibit ${letter}: ${answer.blank ? 'no answer' : answer.text}`;
  return (
    <li
      className={cx('mp-exhibit', revealed && answer.winner && 'is-winner', revealed && answer.sweep && 'is-sweep', own && 'is-own', picked && !revealed && 'is-picked', answer.blank && 'is-blank')}
      style={{ '--delay': `${index * 90}ms`, '--share': share } as CSSProperties}
      data-slot={index % 6}
    >
      <div className="mp-exhibit__frame" data-part="answer-card">
        <span className="mp-exhibit__letter" aria-hidden="true">
          {letter}
        </span>
        {interactive ? (
          <button type="button" className="mp-exhibit__hit" aria-pressed={picked} aria-label={`${kind === 'ranked' ? 'Rank' : 'Pick'} ${label}`} onClick={onToggle}>
            {body}
          </button>
        ) : (
          <div className="mp-exhibit__hit" aria-label={label} role="group">
            {body}
          </div>
        )}
        {picked && !revealed ? (
          <span className="mp-exhibit__pick" data-rank={rank}>
            {kind === 'ranked' ? (
              <>
                <span className="dc-num">{rank + 1}</span> {RANK_NAMES[rank]}
              </>
            ) : (
              <>
                <PixelIcon name="check" size={12} /> Your pick
              </>
            )}
          </span>
        ) : null}
        {own && !revealed ? <span className="mp-exhibit__own">Your answer</span> : null}
      </div>
      {revealed && answer.winner ? <PixelArt rows={MP_ART.ribbon} className="mp-exhibit__ribbon" title="Winner" /> : null}
      {revealed ? (
        <div className="mp-exhibit__plate">
          <div className="mp-exhibit__stats">
            {!answer.blank ? (
              <span className="mp-exhibit__votes dc-num">
                {answer.votes} vote{answer.votes === 1 ? '' : 's'}
                {kind === 'ranked' && answer.firsts > 0 ? ` · ${answer.firsts} gold` : ''}
              </span>
            ) : null}
            {answer.points > 0 ? <span className="mp-exhibit__points dc-num">+{answer.points.toLocaleString('en-US')}</span> : null}
            <span className="mp-exhibit__bar" aria-hidden="true" />
          </div>
          <div className="mp-exhibit__badges">
            {answer.sweep ? <span className="mp-badge mp-badge--sweep">Sweep</span> : null}
            {answer.audiencePick ? (
              <span className="mp-badge mp-badge--audience">
                <PixelIcon name="users" size={11} /> Audience pick · <span className="dc-num">{answer.audienceVotes}</span>
              </span>
            ) : null}
            {votedRank >= 0 ? <span className="mp-badge mp-badge--mine">{kind === 'ranked' ? `Your ${RANK_NAMES[votedRank]?.toLowerCase()}` : 'Your vote'}</span> : null}
          </div>
          {answer.authorId || answer.authorName ? (
            <p className={cx('mp-exhibit__author', isMe && 'is-me')}>
              {author ? <Avatar avatar={author.avatar} color={author.color} size={22} /> : null}
              <span>
                <span className="mp-exhibit__by">by</span> <strong style={author ? { color: author.color } : undefined}>{answer.authorName}</strong>
                {isMe ? <span className="mp-exhibit__you"> (you!)</span> : null}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function VoteActions({
  kind,
  mine,
  canVote,
  locked,
  ballotCast,
  allowChange,
  ready,
  changed,
  need,
  pickedLetters,
  onCast,
  onLock,
  onClear,
}: {
  kind: MpVoteKind;
  mine: MpPrivate | null;
  canVote: boolean;
  locked: boolean;
  ballotCast: boolean;
  allowChange: boolean;
  ready: boolean;
  changed: boolean;
  need: number;
  pickedLetters: string[];
  onCast: () => void;
  onLock: () => void;
  onClear: () => void;
}) {
  if (mine?.voteBlock === 'author') {
    return (
      <div className="mp-voteline mp-voteline--author" data-part="vote-bar" role="status">
        <PixelIcon name="star" />
        <span>
          <strong>Your answer is on stage!</strong> Everyone else is voting — act natural.
        </span>
      </div>
    );
  }
  if (mine?.voteBlock === 'spectator') return <LockNote>Audience voting is off in this room — enjoy the show.</LockNote>;
  if (mine?.voteBlock === 'device') return <LockNote>This device is already playing or voting in this match — one audience vote per device.</LockNote>;
  if (!canVote) return <LockNote>You’ll vote from the next showdown.</LockNote>;
  if (locked) return <LockNote tone="success">Vote locked in — waiting for everyone else.</LockNote>;

  const audience = mine?.role === 'audience';
  const castLabel = kind === 'ranked' ? (ready ? 'Submit ranking' : `Pick ${need - pickedLetters.length} more`) : ready ? `Vote for ${pickedLetters[0]}` : 'Tap your favourite';
  return (
    <div className="mp-voteline" data-part="vote-bar" data-audience={audience ? 'true' : undefined}>
      <p className="mp-voteline__hint">
        {audience ? (
          <>
            <PixelIcon name="users" size={12} /> Audience vote — your favourite earns a crowd bonus.{' '}
          </>
        ) : null}
        {kind === 'ranked' ? (
          <>
            Tap three exhibits in order: <strong>gold</strong>, <strong>silver</strong>, <strong>bronze</strong>.
            {pickedLetters.length ? (
              <span className="mp-voteline__picks dc-num"> {pickedLetters.map((l, i) => `${RANK_NAMES[i]}: ${l}`).join(' · ')}</span>
            ) : null}
          </>
        ) : ballotCast ? (
          'Vote cast. Change your mind, or lock it in.'
        ) : (
          'Pick the answer you love most.'
        )}
      </p>
      <div className="mp-voteline__actions">
        {kind === 'ranked' && pickedLetters.length > 0 ? (
          <Button variant="ghost" size="md" onClick={onClear}>
            Clear
          </Button>
        ) : null}
        {ballotCast && allowChange ? (
          <>
            <Button variant="secondary" size="lg" onClick={onCast} disabled={!ready || !changed}>
              Change vote
            </Button>
            <Button variant="primary" size="lg" icon="lock" onClick={onLock}>
              Lock in
            </Button>
          </>
        ) : (
          <Button variant="primary" size="lg" icon={ready ? 'check' : undefined} onClick={onCast} disabled={!ready} className="mp-voteline__cast">
            {castLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
