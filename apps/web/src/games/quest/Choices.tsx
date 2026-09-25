/**
 * Choice cards with live public vote counts, voter portraits, check info
 * (stat, difficulty, and exact DC/odds when an Analyst is conscious), availability
 * reasons and private Signal Seer omens — plus the vote status bar.
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import { Badge, Button, IconButton, PixelArt, PixelIcon, TimerRing, cx } from '@dascade/ui';
import { QUEST_STAT_INFO, type QuestChoiceView, type QuestHeroView } from '@dascade/shared/games/quest';
import { PORTRAITS, UNKNOWN_PORTRAIT } from './art.ts';
import { pct, questSound } from './util.ts';

export interface ChoiceListProps {
  choices: QuestChoiceView[];
  votes: Record<string, string>;
  heroesById: Map<string, QuestHeroView>;
  myVote: string | null;
  eligible: number;
  canVote: boolean;
  tied: string[] | null;
  canBreakTie: boolean;
  omens: Map<string, string>;
  reveal: boolean;
  onVote: (choiceId: string) => void;
  onTiebreak: (choiceId: string) => void;
}

export function ChoiceList(props: ChoiceListProps) {
  const { choices, votes, heroesById, myVote, eligible, canVote, tied, canBreakTie, omens, reveal, onVote, onTiebreak } = props;
  const counts = new Map<string, string[]>();
  for (const [pid, cid] of Object.entries(votes)) counts.set(cid, [...(counts.get(cid) ?? []), pid]);
  const listRef = useRef<HTMLOListElement>(null);

  // Number keys vote quickly (1–8) when focus isn't in a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > choices.length) return;
      const c = choices[n - 1]!;
      if (tied && canBreakTie && tied.includes(c.id)) onTiebreak(c.id);
      else if (canVote && c.available && !tied) onVote(c.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choices, canVote, tied, canBreakTie, onVote, onTiebreak]);

  return (
    <ol ref={listRef} className={cx('qs-choices', reveal && 'is-revealed', choices.length <= 2 && 'qs-choices--few')} aria-label="Choices">
      {choices.map((c, i) => {
        const voters = counts.get(c.id) ?? [];
        const mine = myVote === c.id;
        const isTied = tied?.includes(c.id) ?? false;
        const disabled = tied ? !(canBreakTie && isTied) : !c.available || !canVote;
        const share = eligible > 0 ? voters.length / eligible : 0;
        const omen = omens.get(c.id);
        const descId = `qs-choice-${c.id}-desc`;
        return (
          <li key={c.id} style={{ '--i': i } as CSSProperties}>
            <button
              type="button"
              className={cx('qs-choice', mine && 'is-mine', !c.available && 'is-locked', isTied && 'is-tied', c.secret && 'is-secret')}
              aria-pressed={tied ? undefined : mine}
              aria-label={tied && canBreakTie && isTied ? `Break the tie: ${c.label}` : c.label}
              aria-describedby={descId}
              aria-keyshortcuts={String(i + 1)}
              disabled={disabled}
              onClick={() => {
                if (tied) onTiebreak(c.id);
                else onVote(c.id);
              }}
              style={{ '--share': `${share * 100}%` } as CSSProperties}
            >
              <span className="qs-choice__key" aria-hidden>
                {i + 1}
              </span>
              <span className="qs-choice__body">
                <span className="qs-choice__label">{c.label}</span>
                <span id={descId} className="qs-choice__desc">
                  {c.flavor ? <span className="qs-choice__flavor">{c.flavor}</span> : null}
                  <span className="qs-choice__meta">
                    {c.check ? <CheckInfo check={c.check} /> : <span className="qs-chip qs-chip--safe">No roll</span>}
                    {c.secret ? (
                      <Badge color="var(--cyan)" icon="eye">
                        Scout spotted
                      </Badge>
                    ) : null}
                    {!c.available && c.reason ? (
                      <span className="qs-choice__reason">
                        <PixelIcon name="lock" /> {c.reason}
                      </span>
                    ) : null}
                  </span>
                  {omen ? (
                    <span className="qs-choice__omen">
                      <PixelIcon name="sparkle" /> {omen}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="qs-choice__votes" aria-label={`${voters.length} vote${voters.length === 1 ? '' : 's'}`}>
                <span className="qs-choice__count dc-num">{voters.length}</span>
                <span className="qs-choice__voters" aria-hidden>
                  {voters.slice(0, 6).map((pid) => {
                    const h = heroesById.get(pid);
                    return <PixelArt key={pid} rows={h?.archetype ? PORTRAITS[h.archetype] : UNKNOWN_PORTRAIT} mainColor={h?.color ?? '#8f88b3'} className="qs-voter" />;
                  })}
                  {voters.length > 6 ? <span className="qs-voter qs-voter--more">+{voters.length - 6}</span> : null}
                </span>
              </span>
              {mine ? <span className="qs-choice__mine">Your vote</span> : null}
              {isTied && canBreakTie ? <span className="qs-choice__mine">Pick to break the tie</span> : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function CheckInfo({ check }: { check: NonNullable<QuestChoiceView['check']> }) {
  const stat = QUEST_STAT_INFO[check.stat];
  return (
    <>
      <span className="qs-chip" style={{ '--chip': stat.color } as CSSProperties} title={stat.description}>
        <PixelIcon name="dice" /> {stat.name}
      </span>
      <span className="qs-chip qs-chip--plain" data-difficulty={check.difficulty}>
        {check.difficulty}
        {check.dc !== undefined ? ` · DC ${check.dc}` : ''}
      </span>
      {check.odds !== undefined ? (
        <span className="qs-chip qs-chip--odds" title="Party odds, computed by your Analyst">
          {pct(check.odds)}
        </span>
      ) : null}
      {check.advantage ? <span className="qs-chip qs-chip--adv">Advantage</span> : null}
      {check.rollerName ? <span className="qs-choice__roller">{check.rollerName}</span> : null}
    </>
  );
}

export interface VoteBarProps {
  stage: string;
  remainingMs: number;
  totalMs: number;
  votedCount: number;
  eligible: number;
  waitingNames: string[];
  myVoteLabel: string | null;
  isHost: boolean;
  isSpectator: boolean;
  paused: boolean;
  onDecide: () => void;
  onClear: () => void;
  onOpen?: (panel: 'bag' | 'log') => void;
}

export function VoteBar(p: VoteBarProps) {
  const seconds = Math.ceil(p.remainingMs / 1000);
  const allIn = p.eligible > 0 && p.votedCount >= p.eligible;
  const lastTick = useRef(-1);
  useEffect(() => {
    if (p.stage === 'voting' && seconds > 0 && seconds <= 5 && seconds !== lastTick.current && !allIn) {
      lastTick.current = seconds;
      questSound.tick();
    }
  }, [seconds, p.stage, allIn]);

  let status: string;
  if (p.stage === 'rolling') status = 'The dice are rolling…';
  else if (p.stage === 'tiebreak') status = p.isHost ? 'It’s a tie — pick the winning choice.' : 'It’s a tie — the host is deciding…';
  else if (p.paused) status = 'Paused — waiting for the party to reconnect';
  else if (allIn) status = 'All votes are in — locking…';
  else if (p.waitingNames.length === 1) status = `Waiting for ${p.waitingNames[0]}`;
  else if (p.waitingNames.length > 1) status = `Waiting for ${p.waitingNames.length} more`;
  else status = 'Vote for what happens next';

  return (
    <div className="qs-votebar" data-stage={p.stage} role="status" aria-live="polite">
      {p.stage === 'voting' || p.stage === 'tiebreak' ? (
        <TimerRing seconds={p.paused ? 0 : seconds} progress={p.totalMs > 0 ? p.remainingMs / p.totalMs : 0} size={46} label={p.stage === 'tiebreak' ? 'Tie-break time' : 'Vote time'} />
      ) : (
        <span className="qs-votebar__dice" aria-hidden>
          <PixelIcon name="dice" />
        </span>
      )}
      <div className="qs-votebar__text">
        <strong>{status}</strong>
        <span className="qs-votebar__sub">
          <span className="dc-num">
            {p.votedCount}/{p.eligible}
          </span>{' '}
          voted
          {p.myVoteLabel ? (
            <>
              {' · '}you chose <b className="qs-votebar__mine">{p.myVoteLabel}</b>
            </>
          ) : p.isSpectator ? (
            ' · you are spectating'
          ) : null}
        </span>
      </div>
      <div className="qs-votebar__actions">
        {p.myVoteLabel && p.stage === 'voting' ? <IconButton icon="close" label="Clear my vote" size="sm" onClick={p.onClear} /> : null}
        {p.onOpen ? (
          <>
            <Button className="qs-votebar__mobile" size="sm" variant="ghost" aria-label="Open party bag" onClick={() => p.onOpen?.('bag')}>
              Bag
            </Button>
            <Button className="qs-votebar__mobile" size="sm" variant="ghost" aria-label="Open adventure log" onClick={() => p.onOpen?.('log')}>
              Log
            </Button>
          </>
        ) : null}
        {p.isHost && p.stage === 'voting' ? (
          <Button size="sm" variant="secondary" icon="bolt" onClick={p.onDecide}>
            Decide now
          </Button>
        ) : null}
      </div>
    </div>
  );
}
