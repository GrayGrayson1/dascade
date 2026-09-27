/**
 * DAS Boardroom kit — in-game actions: resign (two-step confirm), draw offers, take-back requests,
 * board flip and a slot for game extras (PGN…). Incoming offers render as a prompt with
 * Accept / Decline. Spectators only get the flip and the extras.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { boardMsg, otherSide, type BoardRoomView, type BoardSide } from '@dascade/shared/games/boardroom';
import { Button, IconButton, PixelIcon, cx, type IconName } from '@dascade/ui';
import { useCountdown } from '../../net/hooks.ts';
import type { Boardroom } from './useBoardroom.ts';

export interface BoardActionBarProps<S extends BoardRoomView> {
  room: Boardroom<S, unknown>;
  sideLabel: (side: BoardSide) => string;
  onFlip: () => void;
  /** Extra buttons (Copy PGN…). */
  extra?: ReactNode;
  /** Icon-only buttons (phones). */
  compact?: boolean;
  /** Icon-only flip button while the game actions keep their labels (portrait phones). */
  iconTools?: boolean;
  className?: string;
}

export function BoardActionBar<S extends BoardRoomView>({
  room,
  sideLabel,
  onFlip,
  extra,
  compact,
  iconTools,
  className,
}: BoardActionBarProps<S>) {
  const { state, mySide, live, offer, resign } = room;
  const [confirmResign, setConfirmResign] = useState(false);
  const [waitingFrom, setWaitingFrom] = useState(0);

  useEffect(() => {
    if (!confirmResign) return;
    const id = window.setTimeout(() => setConfirmResign(false), 5000);
    return () => window.clearTimeout(id);
  }, [confirmResign]);
  useEffect(() => {
    if (!live) setConfirmResign(false);
  }, [live]);

  const offers = state.offers;
  const opp = mySide ? otherSide(mySide) : null;
  const incomingDraw = live && opp !== null && offers.drawBy === opp;
  const incomingUndo = live && opp !== null && offers.undoBy === opp;
  const myDraw = live && mySide !== null && offers.drawBy === mySide;
  const myUndo = live && mySide !== null && offers.undoBy === mySide;
  const myMoves = mySide === 'first' ? Math.ceil(state.ply / 2) : mySide === 'second' ? Math.floor(state.ply / 2) : 0;
  const oppName = opp ? (room.seat(opp)?.name ?? sideLabel(opp)) : '';
  // Untimed games: once the side to move has been idle long enough, the waiting player may claim the win.
  const idleWatch = live && mySide !== null && !state.clock.enabled && state.idleClaimAt > 0;
  const claimIn = useCountdown(idleWatch ? state.idleClaimAt : 0);
  const claimable = idleWatch && claimIn === 0;
  const canClaim = claimable && state.turn !== mySide && waitingFrom !== state.idleClaimAt;
  const beingClaimed = claimable && state.turn === mySide;

  const btn = (props: {
    icon: IconName;
    label: string;
    onClick: () => void;
    variant?: 'ghost' | 'secondary' | 'danger' | 'success' | 'primary';
    disabled?: boolean;
    pressed?: boolean;
  }) =>
    compact ? (
      <IconButton
        key={props.label}
        icon={props.icon}
        label={props.label}
        size="sm"
        variant={props.variant ?? 'ghost'}
        onClick={props.onClick}
        disabled={props.disabled}
        aria-pressed={props.pressed}
      />
    ) : (
      <Button
        key={props.label}
        icon={props.icon}
        size="sm"
        variant={props.variant ?? 'ghost'}
        onClick={props.onClick}
        disabled={props.disabled}
        aria-pressed={props.pressed}
      >
        {props.label}
      </Button>
    );

  return (
    <div className={cx('br-actions', compact && 'br-actions--compact', className)}>
      {canClaim ? (
        <div className="br-prompt" role="alert">
          <PixelIcon name="clock" />
          <span className="br-prompt__text">{oppName} has not moved for a while</span>
          <span className="br-prompt__buttons">
            <Button size="sm" variant="primary" icon="trophy" onClick={() => room.game.send(boardMsg(state.gameId, 'claim'), {})}>
              Claim win
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setWaitingFrom(state.idleClaimAt)}>
              Keep waiting
            </Button>
          </span>
        </div>
      ) : null}
      {beingClaimed ? (
        <p className="br-actions__pending br-actions__pending--warn" role="status">
          <PixelIcon name="warning" /> Your opponent can now claim the win — make your move.
        </p>
      ) : null}
      {incomingDraw || incomingUndo ? (
        <div className="br-prompt" role="alert">
          <PixelIcon name={incomingDraw ? 'star' : 'arrow-left'} />
          <span className="br-prompt__text">
            {incomingDraw
              ? `${oppName} offers a draw`
              : `${oppName} asks to take back ${offers.undoPlies === 2 ? 'the last two moves' : 'their last move'}`}
          </span>
          <span className="br-prompt__buttons">
            <Button size="sm" variant="success" icon="check" onClick={() => offer(incomingDraw ? 'draw' : 'undo', 'accept')}>
              {incomingDraw ? 'Accept draw' : 'Accept take-back'}
            </Button>
            <Button size="sm" variant="ghost" icon="close" onClick={() => offer(incomingDraw ? 'draw' : 'undo', 'decline')}>
              Decline
            </Button>
          </span>
        </div>
      ) : null}

      <div className="br-actions__row" role="toolbar" aria-label="Game actions">
        {mySide && live ? (
          confirmResign ? (
            <span className="br-actions__confirm" role="group" aria-label="Confirm resignation">
              <Button size="sm" variant="danger" icon="flag" onClick={() => resign()}>
                Confirm resign
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmResign(false)}>
                Keep playing
              </Button>
            </span>
          ) : (
            btn({ icon: 'flag', label: 'Resign', onClick: () => setConfirmResign(true) })
          )
        ) : null}

        {mySide && live && state.drawOffersAllowed && !confirmResign
          ? myDraw
            ? btn({ icon: 'close', label: 'Cancel draw offer', onClick: () => offer('draw', 'cancel'), pressed: true })
            : incomingDraw
              ? null
              : btn({ icon: 'star', label: 'Offer draw', onClick: () => offer('draw', 'offer') })
          : null}

        {mySide && live && state.undoAllowed && !confirmResign
          ? myUndo
            ? btn({ icon: 'close', label: 'Cancel take-back', onClick: () => offer('undo', 'cancel'), pressed: true })
            : incomingUndo
              ? null
              : btn({ icon: 'arrow-left', label: 'Take back', onClick: () => offer('undo', 'offer'), disabled: myMoves < 1 })
          : null}

        <span className="br-actions__spacer" />
        <span className="br-actions__tools">
          {extra}
          {iconTools && !compact ? (
            <IconButton icon="refresh" label="Flip board" size="sm" onClick={onFlip} />
          ) : (
            btn({ icon: 'refresh', label: 'Flip board', onClick: onFlip })
          )}
        </span>
      </div>

      {myDraw || myUndo ? (
        <p className="br-actions__pending" role="status">
          <PixelIcon name="clock" /> {myDraw ? 'Draw offered — waiting for an answer' : 'Take-back requested — waiting for an answer'}
        </p>
      ) : null}
    </div>
  );
}
