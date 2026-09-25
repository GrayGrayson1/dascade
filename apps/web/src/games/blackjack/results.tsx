/**
 * RESULTS: the final leaderboard, ranked by chips won or lost this game.
 */
import type { CSSProperties } from 'react';
import { formatChips } from '@dascade/shared';
import type { BlackjackPublicState } from '@dascade/shared/games/blackjack';
import { Avatar, PixelIcon } from '@dascade/ui';
import { GameStage, ResultsActions } from '../../shell/common.tsx';
import { signed } from './util.ts';

export function ResultsView({ state, playerId }: { state: BlackjackPublicState; playerId: string | null }) {
  const rows = Object.values(state.seats)
    .map((s) => ({ seat: s, player: state.players[s.playerId], net: s.balance - s.bought }))
    .sort((a, b) => b.net - a.net || b.seat.balance - a.seat.balance);
  const best = rows[0];
  return (
    <GameStage gameId="blackjack" className="bj-stage bj-results-stage">
      <div className="bj-results">
        <header className="bj-results__head">
          <span className="dc-label">DASjack 21 · Final standings</span>
          <h1 className="dc-title">Table closed</h1>
          <p className="dc-muted">
            {state.round} round{state.round === 1 ? '' : 's'} dealt
            {best && best.net > 0 ? ` · ${best.player?.name ?? best.seat.name} leaves up ${formatChips(best.net)}` : ''} · virtual chips only
          </p>
        </header>
        {rows.length === 0 ? (
          <p className="dc-muted bj-results__empty">Nobody stayed to the end of this table.</p>
        ) : (
          <ol className="bj-board">
            {rows.map(({ seat, player, net }, i) => (
              <li
                key={seat.playerId}
                className="bj-board__row"
                data-me={seat.playerId === playerId ? 'true' : undefined}
                data-rank={i + 1}
                style={{ '--delay': `${i * 90}ms` } as CSSProperties}
              >
                <span className="bj-board__rank dc-display">{i === 0 && net > 0 ? <PixelIcon name="crown" title="Top of the table" /> : i + 1}</span>
                <Avatar avatar={player?.avatar ?? 'rocket'} color={player?.color ?? '#9d95c4'} size={40} offline={!player} />
                <span className="bj-board__who">
                  <span className="bj-board__name">
                    {player?.name ?? seat.name}
                    {seat.playerId === playerId ? <span className="bj-plate__you">You</span> : null}
                  </span>
                  <span className="bj-board__stats">
                    {seat.handsPlayed} hands · {seat.handsWon} won · {seat.blackjacks} blackjack{seat.blackjacks === 1 ? '' : 's'}
                    {seat.biggestWin > 0 ? ` · best round +${formatChips(seat.biggestWin)}` : ''}
                    {seat.refills > 0 ? ` · ${seat.refills} refill${seat.refills === 1 ? '' : 's'}` : ''}
                  </span>
                </span>
                <span className="bj-board__chips dc-num">
                  <span className="dc-label">Chips</span>
                  {formatChips(seat.balance)}
                </span>
                <span className="bj-board__net dc-num" data-tone={net > 0 ? 'win' : net < 0 ? 'lose' : 'push'}>
                  {signed(net)}
                </span>
              </li>
            ))}
          </ol>
        )}
        <ResultsActions />
      </div>
    </GameStage>
  );
}
