/** End-of-game leaderboard (virtual chips) and the awards: most hands won, biggest pot. */
import type { CSSProperties } from 'react';
import type { PlayerView } from '@dascade/shared';
import type { HoldemAwardPlayer, HoldemAwardsPayload, HoldemPublicState } from '@dascade/shared/games/holdem';
import { Avatar, Panel, PixelIcon, cx, type IconName } from '@dascade/ui';
import { ResultsActions } from '../../shell/common.tsx';
import { fmt } from './helpers.ts';

/** "Ada", "Ada & Bo", "Ada, Bo & Cy". */
function joinNames(players: readonly HoldemAwardPlayer[]): string {
  const names = players.map((p) => p.name);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`;
}

function Award({ icon, label, players, value, detail, playerId, delay }: {
  icon: IconName;
  label: string;
  players: readonly HoldemAwardPlayer[];
  value: string;
  detail?: string;
  playerId: string | null;
  delay: number;
}) {
  return (
    <div className="hd-award" data-me={players.some((p) => p.playerId === playerId) ? 'true' : undefined} style={{ '--delay': `${delay}ms` } as CSSProperties}>
      <PixelIcon name={icon} className="hd-award__icon" />
      <span className="hd-award__body">
        <span className="dc-label">{label}</span>
        <strong className="hd-award__name">{joinNames(players)}</strong>
        <span className="hd-award__value">{value}</span>
        {detail ? <span className="hd-award__detail">{detail}</span> : null}
      </span>
    </div>
  );
}

/** The awards for this game (a previous game's, still cached, never match its hand count). */
function Awards({ awards, hands, playerId }: { awards: HoldemAwardsPayload | undefined; hands: number; playerId: string | null }) {
  if (!awards || awards.hands !== hands || (!awards.mostHands && !awards.biggestPot)) return null;
  const { mostHands, biggestPot } = awards;
  const pot = biggestPot?.players.length === 1 ? biggestPot.players[0]! : null;
  return (
    <section className="hd-awards" aria-label="Awards" data-part="awards">
      {mostHands ? (
        <Award
          icon="trophy"
          label="Most hands won"
          players={mostHands.players}
          value={`${mostHands.count} hand${mostHands.count === 1 ? '' : 's'}${mostHands.players.length > 1 ? ' each' : ''}`}
          playerId={playerId}
          delay={0}
        />
      ) : null}
      {biggestPot ? (
        <Award
          icon="chip"
          label="Biggest pot"
          players={biggestPot.players}
          value={`${fmt(biggestPot.amount)}${pot ? '' : ' each'}`}
          detail={pot ? `Hand #${pot.handNumber} · ${pot.description || 'no showdown'}` : undefined}
          playerId={playerId}
          delay={80}
        />
      ) : null}
    </section>
  );
}

export function Results({
  state,
  players,
  playerId,
  awards,
}: {
  state: HoldemPublicState;
  players: Record<string, PlayerView>;
  playerId: string | null;
  awards?: HoldemAwardsPayload;
}) {
  const rows = state.standings;
  const champ = rows[0];
  return (
    <div className="hd-results">
      <header className="hd-results__head">
        <span className="dc-label">
          Final chip counts · {state.handNumber} hand{state.handNumber === 1 ? '' : 's'} played
        </span>
        <h1 className="dc-title hd-results__title">{champ && champ.net > 0 ? `${champ.name} takes the table` : 'Game over'}</h1>
        <p className="dc-muted">Virtual chips only — no real money, no cash value. The glory, however, is very real.</p>
      </header>
      <Awards awards={awards} hands={state.handNumber} playerId={playerId} />
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
