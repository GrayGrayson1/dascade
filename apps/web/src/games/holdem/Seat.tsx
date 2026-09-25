/** One seat on the rail: cards, avatar pod with the action clock, and status badge. */
import { memo, type CSSProperties } from 'react';
import type { PlayerView } from '@dascade/shared';
import type { HoldemSeatView } from '@dascade/shared/games/holdem';
import { Avatar, PixelIcon, PlayingCard, cx } from '@dascade/ui';
import { useCountdown } from '../../net/hooks.ts';
import { actionLabel, fmt, fmtShort } from './helpers.ts';
import type { Point, TableGeometry } from './geometry.ts';

export interface SeatProps {
  seat: HoldemSeatView;
  player: PlayerView | undefined;
  pos: Point;
  geo: TableGeometry;
  isMe: boolean;
  /** Hero's own hole cards (only for the viewer's seat). */
  heroCards: string[];
  /** Show the hero's cards at the table (desktop). On compact layouts they live in the dock. */
  heroCardsAtTable: boolean;
  acting: boolean;
  deadline: number;
  actionMs: number;
  handNumber: number;
  /** Order in which this seat received cards (deal animation stagger). */
  dealOrder: number;
  wonAmount: number;
  highlightCards: string[];
  showdown: boolean;
  /** A hand is in progress (vs. between hands). */
  live: boolean;
  isHost: boolean;
  canSit: boolean;
  onSit: (index: number) => void;
}

/** "Full House, Kings over Sevens" → "Full House" (compact badges). */
function shortHand(label: string): string {
  return label.split(/[,(]/)[0]!.trim();
}

function Clock({ deadline, actionMs }: { deadline: number; actionMs: number }) {
  const remaining = useCountdown(deadline, true);
  const p = actionMs > 0 ? Math.max(0, Math.min(1, remaining / actionMs)) : 0;
  const urgent = remaining > 0 && remaining <= 5000;
  return (
    <span className="hd-clock" data-urgent={urgent ? 'true' : undefined} style={{ '--p': p } as CSSProperties} role="timer" aria-label={`${Math.ceil(remaining / 1000)} seconds to act`}>
      <span className="hd-clock__bar" />
    </span>
  );
}

export const Seat = memo(function Seat(props: SeatProps) {
  const { seat, player, pos, geo, isMe, acting, handNumber, live } = props;
  const style = { left: pos.x, top: pos.y, '--pod-w': `${geo.podW}px`, '--pod-h': `${geo.podH}px` } as CSSProperties;

  if (!seat.playerId) {
    return (
      <div className="hd-seat hd-seat--empty" style={style} data-compact={geo.compact ? 'true' : undefined}>
        {props.canSit ? (
          <button type="button" className="hd-seat__sit" onClick={() => props.onSit(seat.index)} aria-label={`Sit in seat ${seat.index + 1}`}>
            <PixelIcon name="plus" />
            <span>Sit</span>
          </button>
        ) : (
          <span className="hd-seat__open" aria-label={`Seat ${seat.index + 1} is open`}>
            {seat.index + 1}
          </span>
        )}
      </div>
    );
  }

  const connected = player?.connected ?? false;
  const winner = props.wonAmount > 0;
  const label = actionLabel(seat);
  const shown = seat.shownCards.length === 2 ? seat.shownCards : null;
  const heroFaces = isMe && props.heroCards.length === 2 && props.heroCardsAtTable && seat.inHand && !seat.folded ? props.heroCards : null;
  const faces = shown ?? heroFaces;
  // On compact layouts the hero's cards live in the dock: no backs at the seat.
  const showBacks = seat.hasCards && !(isMe && props.heroCards.length === 2 && !props.heroCardsAtTable);
  const heroBig = Boolean(faces && isMe && props.heroCardsAtTable);
  const cardW = heroBig ? geo.heroCardW : faces ? Math.round(geo.seatCardW * 1.35) : geo.seatCardW;
  const dealFrom = { '--deal-x': `${geo.cx - pos.x}px`, '--deal-y': `${geo.cy - pos.y}px` } as CSSProperties;
  const playing = seat.inHand && live;
  const state = seat.left
    ? 'left'
    : seat.folded && seat.inHand
      ? 'folded'
      : seat.sittingOut && !playing
        ? 'out'
        : seat.busted && !playing
          ? 'busted'
          : undefined;

  let status: { text: string; tone: string } | null = null;
  if (winner) status = { text: `Wins ${fmtShort(props.wonAmount)}`, tone: 'win' };
  else if (seat.left) status = { text: 'Left', tone: 'muted' };
  else if (props.showdown && seat.handLabel && !seat.folded) status = { text: geo.compact ? shortHand(seat.handLabel) : seat.handLabel, tone: 'hand' };
  else if (seat.allIn && playing && !seat.folded) status = { text: 'All-in', tone: 'allin' };
  else if (playing && label) status = label;
  else if (seat.waiting) status = { text: 'Next hand', tone: 'muted' };
  else if (seat.busted && !playing) status = { text: 'Busted', tone: 'muted' };
  else if (seat.sittingOut && !playing) status = { text: seat.sitOutReason === 'away' ? 'Away' : 'Sitting out', tone: 'muted' };
  else if (seat.inHand && seat.folded) status = label;

  const name = seat.name || player?.name || 'Player';
  return (
    <div
      className={cx('hd-seat', isMe && 'hd-seat--me')}
      style={style}
      data-state={state}
      data-acting={acting ? 'true' : undefined}
      data-winner={winner ? 'true' : undefined}
      data-compact={geo.compact ? 'true' : undefined}
      data-hero-cards={heroBig ? 'true' : undefined}
      aria-label={`${name}${isMe ? ' (you)' : ''}, ${fmt(seat.stack)} chips${acting ? ', to act' : ''}${seat.folded ? ', folded' : ''}`}
      role="group"
    >
      {faces || showBacks ? (
        <div className="hd-seat__cards" key={`${handNumber}-${faces ? 'f' : 'b'}`} style={{ '--card-w': `${cardW}px` } as CSSProperties}>
          {(faces ?? [null, null]).map((code, i) => (
            <PlayingCard
              key={i}
              code={code}
              faceDown={!code}
              width={cardW}
              deal={!shown}
              highlight={Boolean(code && props.highlightCards.includes(code))}
              dim={Boolean(props.showdown && code && props.highlightCards.length > 0 && !props.highlightCards.includes(code) && winner)}
              className="hd-seat__card"
              style={{ ...dealFrom, animationDelay: `${(props.dealOrder + i * 4) * 60}ms` }}
            />
          ))}
        </div>
      ) : null}

      <div className="hd-pod">
        <span className="hd-pod__avatar">
          <Avatar avatar={player?.avatar ?? 'ghost'} color={player?.color ?? '#8f88b3'} size={geo.compact ? 24 : 34} offline={!connected} />
          {!connected && !seat.left ? <PixelIcon name="wifi-off" className="hd-pod__offline" title="Disconnected" /> : null}
        </span>
        <span className="hd-pod__info">
          <span className="hd-pod__name">
            {props.isHost && !geo.compact ? <PixelIcon name="crown" className="hd-pod__crown" title="Host" /> : null}
            <span className="hd-pod__name-text">{name}</span>
          </span>
          <span className="hd-pod__stack">{seat.allIn && seat.stack === 0 && playing ? 'All-in' : geo.compact ? fmtShort(seat.stack) : fmt(seat.stack)}</span>
        </span>
        {isMe ? <span className="hd-pod__you">You</span> : null}
        {acting ? <Clock deadline={props.deadline} actionMs={props.actionMs} /> : null}
      </div>

      {status ? (
        <span className="hd-seat__status" data-tone={status.tone}>
          {status.text}
        </span>
      ) : null}
    </div>
  );
});
