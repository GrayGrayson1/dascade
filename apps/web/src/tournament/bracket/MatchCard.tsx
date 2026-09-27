import type { CSSProperties } from 'react';
import { formatPoints } from '@dascade/shared';
import { PixelIcon, cx } from '@dascade/ui';
import type { MatchVM, SlotVM } from './types.ts';

const STATUS_TEXT: Record<MatchVM['status'], string> = {
  waiting: 'Waiting',
  ready: 'Ready',
  live: 'Live',
  done: 'Final',
  forfeit: 'Forfeit',
  void: 'Void',
  bye: 'Bye',
};

function slotText(s: SlotVM): string {
  if (s.placeholder || !s.participantId) return s.name;
  return `${s.seed ? `seed ${s.seed} ` : ''}${s.name}${s.score !== null ? ` ${formatPoints(s.score)}` : ''}${s.isWinner ? ' (won)' : ''}`;
}

/** Plain-language summary used as the card's accessible name. */
export function matchSummary(m: MatchVM): string {
  const [a, b] = m.slots;
  const status = m.status === 'live' ? `live, game ${m.gameNumber} of ${m.bestOf}` : STATUS_TEXT[m.status].toLowerCase();
  return `${m.code}, ${m.roundLabel}: ${slotText(a)} versus ${slotText(b)}. ${status}${m.note ? `, ${m.note}` : ''}${m.involvesMe ? '. Your match' : ''}`;
}

function Slot({ slot, showScore }: { slot: SlotVM; showScore: boolean }) {
  return (
    <span
      className="tc-slot"
      data-winner={slot.isWinner || undefined}
      data-loser={slot.isLoser || undefined}
      data-placeholder={slot.placeholder || undefined}
      data-bye={slot.isBye || undefined}
      data-me={slot.isMe || undefined}
    >
      <span className="tc-slot__seed" aria-hidden>
        {slot.seed ?? ''}
      </span>
      {slot.side ? (
        <i className="tc-slot__side" data-side={slot.side} aria-hidden title={slot.side === 'first' ? 'Moves first' : 'Moves second'} />
      ) : null}
      <span className="tc-slot__name">{slot.name}</span>
      {slot.isMe ? <span className="tc-slot__you">You</span> : null}
      <span className="tc-slot__score" aria-hidden>
        {showScore && slot.score !== null ? formatPoints(slot.score) : slot.isWinner ? <PixelIcon name="check" size={10} /> : ''}
      </span>
    </span>
  );
}

export function MatchCard({
  match,
  onSelect,
  style,
  className,
  fluid,
}: {
  match: MatchVM;
  onSelect?: (id: string) => void;
  style?: CSSProperties;
  className?: string;
  /** Fill the container width (rounds list) instead of the fixed canvas size. */
  fluid?: boolean;
}) {
  const showScore = match.status !== 'waiting' && match.status !== 'bye';
  return (
    <button
      type="button"
      className={cx('tc-match', fluid && 'tc-match--fluid', className)}
      data-status={match.status}
      data-mine={match.involvesMe || undefined}
      style={style}
      aria-label={matchSummary(match)}
      onClick={() => onSelect?.(match.id)}
    >
      <span className="tc-match__code" aria-hidden>
        {match.code}
      </span>
      {match.status === 'live' ? (
        <span className="tc-match__tag tc-match__tag--live" aria-hidden>
          <i /> Live{match.bestOf > 1 ? ` · G${match.gameNumber}` : ''}
        </span>
      ) : match.note ? (
        <span className="tc-match__tag" aria-hidden>
          {match.note}
        </span>
      ) : match.status === 'ready' && match.involvesMe ? (
        <span className="tc-match__tag tc-match__tag--go" aria-hidden>
          Your match
        </span>
      ) : null}
      <Slot slot={match.slots[0]} showScore={showScore} />
      <span className="tc-match__rule" aria-hidden />
      <Slot slot={match.slots[1]} showScore={showScore} />
    </button>
  );
}
