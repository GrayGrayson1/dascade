/** DAS Boardroom kit — a player's plate: avatar, name, DASCADE rating, side, status, captured slot, clock slot. */
import type { ReactNode } from 'react';
import type { BoardSeatView } from '@dascade/shared/games/boardroom';
import { Avatar, PixelIcon, cx } from '@dascade/ui';
import { useCountdown } from '../../net/hooks.ts';

export interface PlayerCardProps {
  seat: BoardSeatView | undefined;
  /** "White", "Dark"… */
  sideLabel: string;
  /** Small side marker (e.g. a mini piece). */
  swatch?: ReactNode;
  /** It's this player's turn. */
  active?: boolean;
  isYou?: boolean;
  connected?: boolean;
  /** Show the rating change (after a rated game). */
  showDelta?: boolean;
  /** Captured material / counts. */
  captured?: ReactNode;
  /** Usually a <BoardClock>. */
  clock?: ReactNode;
  /** Where the card sits relative to the board (styling). */
  position?: 'top' | 'bottom';
  compact?: boolean;
  className?: string;
}

function RatingTag({ seat, showDelta }: { seat: BoardSeatView; showDelta?: boolean }) {
  const delta = seat.ratingDelta;
  return (
    <span className="br-card__rating" title="DASCADE rating — an internal DASCADE rating, not FIDE or any federation's.">
      <span className="visually-hidden">DASCADE rating </span>
      <span className="br-num">{seat.rating}</span>
      {seat.provisional ? (
        <span className="br-card__prov" aria-label="provisional">
          ?
        </span>
      ) : null}
      {showDelta && delta !== 0 ? (
        <span className="br-card__delta br-num" data-tone={delta > 0 ? 'up' : 'down'}>
          {delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}
        </span>
      ) : null}
    </span>
  );
}

function AwayTimer({ deadline }: { deadline: number }) {
  const ms = useCountdown(deadline);
  const s = Math.ceil(ms / 1000);
  return (
    <span className="br-card__away" role="status">
      <PixelIcon name="wifi-off" /> Reconnecting · forfeits in{' '}
      <span className="br-num">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>
    </span>
  );
}

export function PlayerCard({
  seat,
  sideLabel,
  swatch,
  active,
  isYou,
  connected = true,
  showDelta,
  captured,
  clock,
  position = 'bottom',
  compact,
  className,
}: PlayerCardProps) {
  const name = seat?.name || 'Waiting…';
  return (
    <section
      className={cx('br-card', compact && 'br-card--compact', className)}
      data-part="player-card"
      data-active={active || undefined}
      data-position={position}
      data-offline={!connected || undefined}
      aria-label={`${sideLabel}: ${name}${isYou ? ' (you)' : ''}`}
    >
      <div className="br-card__avatar">
        <Avatar avatar={seat?.avatar ?? 'ghost'} color={seat?.color ?? 'var(--text-2)'} size={compact ? 30 : 38} offline={!connected} />
        {swatch ? <span className="br-card__swatch">{swatch}</span> : null}
      </div>
      <div className="br-card__who">
        <div className="br-card__line">
          <span className="br-card__name">{name}</span>
          {isYou ? <span className="br-card__you">You</span> : null}
        </div>
        <div className="br-card__meta">
          <span className="br-card__side">{sideLabel}</span>
          {seat?.playerId ? <RatingTag seat={seat} showDelta={showDelta} /> : null}
          {seat && seat.awayDeadline > 0 && !connected ? <AwayTimer deadline={seat.awayDeadline} /> : null}
          {active ? (
            <span className="br-card__turn">
              <span className="br-card__turn-dot" aria-hidden /> To move
            </span>
          ) : null}
        </div>
        {captured ? <div className="br-card__captured">{captured}</div> : null}
      </div>
      {clock ? <div className="br-card__clock">{clock}</div> : null}
    </section>
  );
}
