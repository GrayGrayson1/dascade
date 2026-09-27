/**
 * DAS Boardroom kit — end-of-game card: headline, reason, both players with score and rating change,
 * rematch negotiation (not in tournaments), host "Back to lobby", Leave, and an extras slot (PGN…).
 * "View board" collapses it to a slim bar so the final position can be studied.
 */
import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { otherSide, type BoardRoomView, type BoardSide } from '@dascade/shared/games/boardroom';
import { Avatar, Button, IconButton, PixelIcon, cx } from '@dascade/ui';
import { session } from '../../net/hooks.ts';
import { LeaveButton } from '../../shell/common.tsx';
import type { Boardroom } from './useBoardroom.ts';

export interface ResultBannerProps<S extends BoardRoomView> {
  room: Boardroom<S, unknown>;
  sideLabel: (side: BoardSide) => string;
  swatch?: (side: BoardSide) => ReactNode;
  extra?: ReactNode;
  /** Small boards (phones): side-by-side players, icon-only secondary actions. */
  compact?: boolean;
  className?: string;
}

function scoreText(winner: string, side: BoardSide): string {
  if (winner === 'draw') return '½';
  return winner === side ? '1' : '0';
}

export function ResultBanner<S extends BoardRoomView>({ room, sideLabel, swatch, extra, compact, className }: ResultBannerProps<S>) {
  const { state, mySide, game, tournament, offer } = room;
  const [collapsed, setCollapsed] = useState(false);
  const titleId = useId();
  const result = state.result;
  if (!result.over) return null;
  const winner = result.winner as BoardSide | 'draw' | '';
  const iWon = mySide !== null && winner === mySide;
  const iLost = mySide !== null && winner !== 'draw' && winner !== '' && winner !== mySide;
  const title = winner === 'draw' ? 'Draw' : mySide ? (iWon ? 'You win!' : 'You lost') : `${sideLabel(winner as BoardSide)} wins`;
  const tone = winner === 'draw' ? 'draw' : iWon ? 'win' : iLost ? 'loss' : 'neutral';
  const opp = mySide ? otherSide(mySide) : null;
  const oppSeat = opp ? room.seat(opp) : undefined;
  const oppPlayer = oppSeat ? game.state.players[oppSeat.playerId] : undefined;
  const votes = state.offers.rematch;
  const iVoted = mySide !== null && votes.includes(mySide);
  const theyVoted = opp !== null && votes.includes(opp);
  const inResults = state.phase === 'RESULTS';

  if (collapsed) {
    return (
      <div className={cx('br-result br-result--bar', className)} data-part="result" data-tone={tone} role="status">
        <span className="br-result__bar-title">{title}</span>
        <span className="br-result__bar-text">{result.text}</span>
        <Button size="sm" variant="secondary" icon="chevron-up" onClick={() => setCollapsed(false)}>
          Show result
        </Button>
      </div>
    );
  }

  return (
    <section className={cx('br-result', compact && 'br-result--compact', className)} data-part="result" data-tone={tone} aria-labelledby={titleId}>
      <header className="br-result__head">
        <span className="br-result__eyebrow">
          {tournament
            ? `${tournament.roundLabel} · Game ${tournament.gameNumber} of ${tournament.bestOf}`
            : `Game over${state.gameNumber > 1 ? ` · Game ${state.gameNumber}` : ''}${compact ? (state.rated ? ' · Rated' : ' · Casual') : ''}`}
        </span>
        <h2 id={titleId} className="br-result__title">
          {tone === 'win' ? <PixelIcon name="trophy" /> : null}
          {title}
        </h2>
        <p className="br-result__reason">{result.text}</p>
      </header>

      <ul className="br-result__players">
        {(['first', 'second'] as const).map((side, i) => {
          const seat = room.seat(side);
          if (!seat) return null;
          return (
            <li key={side} className="br-result__player" data-winner={winner === side || undefined} style={{ '--i': i } as CSSProperties}>
              {compact ? null : <Avatar avatar={seat.avatar} color={seat.color} size={30} />}
              {swatch ? <span className="br-result__swatch">{swatch(side)}</span> : null}
              <span className="br-result__name">
                <span className="br-result__nm">{seat.name}</span>
                <span className="br-result__side">{sideLabel(side)}</span>
              </span>
              {state.rated ? (
                <span className="br-result__rating br-num" title="DASCADE rating (internal — not FIDE)">
                  {seat.rating + seat.ratingDelta}
                  {seat.ratingDelta !== 0 ? (
                    <span className="br-card__delta" data-tone={seat.ratingDelta > 0 ? 'up' : 'down'}>
                      {seat.ratingDelta > 0 ? `+${seat.ratingDelta}` : `−${Math.abs(seat.ratingDelta)}`}
                    </span>
                  ) : null}
                </span>
              ) : null}
              <span className="br-result__score br-num" aria-label={`score ${scoreText(winner, side)}`}>
                {scoreText(winner, side)}
              </span>
            </li>
          );
        })}
      </ul>
      {compact ? null : state.rated ? (
        <p className="br-result__note">Rated game · DASCADE rating (internal, not FIDE)</p>
      ) : (
        <p className="br-result__note">Casual game · ratings unchanged</p>
      )}

      {inResults && mySide && !tournament ? (
        <div className="br-result__rematch" role="group" aria-label="Rematch">
          {theyVoted && !iVoted ? (
            <>
              <span className="br-result__rematch-text">{oppSeat?.name ?? 'Your opponent'} wants a rematch</span>
              <Button variant="primary" icon="refresh" onClick={() => offer('rematch', 'accept')}>
                Accept rematch
              </Button>
              <Button variant="ghost" onClick={() => offer('rematch', 'decline')}>
                Decline
              </Button>
            </>
          ) : iVoted ? (
            <>
              <span className="br-result__rematch-text">
                <PixelIcon name="clock" /> Rematch offered — waiting for {oppSeat?.name ?? 'your opponent'}
              </span>
              <Button variant="ghost" onClick={() => offer('rematch', 'cancel')}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="primary" icon="refresh" onClick={() => offer('rematch', 'offer')} disabled={!oppPlayer?.connected}>
              Rematch{opp ? ` (you play ${sideLabel(opp)})` : ''}
            </Button>
          )}
          {!oppPlayer?.connected && !iVoted ? <span className="br-result__rematch-text">Your opponent left.</span> : null}
        </div>
      ) : null}
      {tournament?.decider === 'armageddon' && winner === 'draw' ? (
        <p className="br-result__note">Armageddon decider — a draw counts as a win for {sideLabel('second')}.</p>
      ) : null}
      {tournament ? <p className="br-result__note">Tournament match — the Tournament Center schedules what comes next.</p> : null}

      <footer className="br-result__actions">
        {extra}
        {compact ? (
          <IconButton icon="eye" label="View board" size="sm" onClick={() => setCollapsed(true)} />
        ) : (
          <Button variant="ghost" size="sm" icon="eye" onClick={() => setCollapsed(true)}>
            View board
          </Button>
        )}
        {inResults && game.isHost && !tournament ? (
          compact ? (
            <IconButton icon="arrow-left" label="Back to lobby" size="sm" variant="secondary" onClick={() => session.lobby.toLobby()} />
          ) : (
            <Button variant="secondary" size="sm" icon="arrow-left" onClick={() => session.lobby.toLobby()}>
              Back to lobby
            </Button>
          )
        ) : null}
        <LeaveButton size="sm" compact={compact} />
      </footer>
    </section>
  );
}
