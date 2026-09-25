/** End-of-game leaderboard (virtual chips). */
import type { CSSProperties } from 'react';
import type { PlayerView } from '@dascade/shared';
import type { HoldemPublicState } from '@dascade/shared/games/holdem';
import { Avatar, Panel, PixelIcon, cx } from '@dascade/ui';
import { ResultsActions } from '../../shell/common.tsx';
import { fmt } from './helpers.ts';

export function Results({ state, players, playerId }: { state: HoldemPublicState; players: Record<string, PlayerView>; playerId: string | null }) {
  const rows = state.standings;
  const champ = rows[0];
  return (
    <div className="hd-results">
      <header className="hd-results__head">
        <span className="dc-label">Final chip counts · {state.handNumber} hands played</span>
        <h1 className="dc-title hd-results__title">{champ && champ.net > 0 ? `${champ.name} takes the table` : 'Game over'}</h1>
        <p className="dc-muted">Virtual chips only — no real money, no cash value. The glory, however, is very real.</p>
      </header>
      <Panel brackets glow className="hd-results__board" title="Leaderboard" padded={false}>
        <ol className="hd-standings">
          {rows.map((r) => {
            const p = players[r.playerId];
            const tone = r.net > 0 ? 'up' : r.net < 0 ? 'down' : 'even';
            return (
              <li key={r.playerId} className={cx('hd-standing', r.playerId === playerId && 'hd-standing--me')} data-rank={r.rank} style={{ '--delay': `${r.rank * 80}ms` } as CSSProperties}>
                <span className="hd-standing__rank" aria-label={`Rank ${r.rank}`}>
                  {r.rank === 1 ? <PixelIcon name="trophy" /> : `#${r.rank}`}
                </span>
                <Avatar avatar={p?.avatar ?? 'ghost'} color={p?.color ?? '#8f88b3'} size={34} />
                <span className="hd-standing__who">
                  <span className="hd-standing__name">
                    {r.name}
                    {r.playerId === playerId ? <span className="hd-standing__you">You</span> : null}
                  </span>
                  <span className="hd-standing__meta">
                    {r.handsWon} hand{r.handsWon === 1 ? '' : 's'} won{r.bestPot > 0 ? ` · best pot ${fmt(r.bestPot)}` : ''}
                  </span>
                </span>
                <span className="hd-standing__stack">
                  <span className="dc-label">Stack</span>
                  {fmt(r.stack)}
                </span>
                <span className="hd-standing__net" data-tone={tone}>
                  <span className="dc-label">Net</span>
                  {r.net > 0 ? '+' : r.net < 0 ? '−' : '±'}
                  {fmt(Math.abs(r.net))}
                </span>
              </li>
            );
          })}
          {rows.length === 0 ? <li className="hd-standing hd-standing--empty">Nobody stayed to the end.</li> : null}
        </ol>
      </Panel>
      <ResultsActions />
    </div>
  );
}
