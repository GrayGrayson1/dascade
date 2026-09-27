/** Results: winner, how it ended, both fleets revealed with every shot, stats, rematch / lobby / leave. */
import type { CSSProperties } from 'react';
import { SHIPS_MSG, type ShipsPublicState, type ShipsSideView } from '@dascade/shared/games/ships';
import { Badge, Button, PixelIcon, cx } from '@dascade/ui';
import { session } from '../../net/hooks.ts';
import { LeaveButton } from '../../shell/common.tsx';
import { Board, type VesselDraw } from './Board.tsx';
import { endReasonText } from './Battle.tsx';
import { useElementSize, useGlow, useViewportSize } from './hooks.ts';

export function Results({ state, playerId }: { state: ShipsPublicState; playerId: string | null }) {
  const glow = useGlow();
  const [ref, size] = useElementSize<HTMLDivElement>();
  const viewport = useViewportSize();
  const isCaptain = Boolean(playerId && state.sides.some((s) => s.playerId === playerId));
  const won = isCaptain && state.winnerId === playerId;
  const nameOf = (id: string) => state.sides.find((s) => s.playerId === id)?.name ?? state.players[id]?.name ?? 'A captain';
  const winnerName = nameOf(state.winnerId);
  const title = !state.winnerId ? 'Battle over' : !isCaptain ? `${winnerName} wins` : won ? 'Victory' : 'Defeat';
  const isHost = Boolean(playerId && state.hostId === playerId);
  const inTournament = Boolean(state.tournamentJson);

  const n = state.gridSize;
  // Two fleets side by side (small on phones — it's a summary), capped for big screens.
  const twoUp = size.w >= 300;
  const sea = Math.max(
    110,
    Math.floor(
      Math.min(
        twoUp ? (size.w - (size.w < 620 ? 12 : 24)) / 2 - (size.w < 620 ? 32 : 46) : size.w - 34,
        340,
        // Keep the summary on screen in short landscape.
        Math.max(160, viewport.h - 250),
      ),
    ),
  );

  // Order: you first (or the winner first for spectators).
  const sides = [...state.sides].sort((a, b) => {
    if (isCaptain) return a.playerId === playerId ? -1 : b.playerId === playerId ? 1 : 0;
    return a.playerId === state.winnerId ? -1 : b.playerId === state.winnerId ? 1 : 0;
  });

  return (
    <section className={cx('sh-results', won ? 'is-win' : isCaptain ? 'is-loss' : 'is-neutral')} aria-labelledby="sh-results-title">
      <header className="sh-results__head">
        <PixelIcon name={won || !isCaptain ? 'trophy' : 'flag'} className="sh-results__icon" />
        <h1 id="sh-results-title" className="dc-title sh-results__title">
          {title}
        </h1>
        <p className="sh-results__sub">{endReasonText(state, nameOf)}</p>
      </header>

      <div className="sh-results__boards" ref={ref} data-two={twoUp ? 'true' : undefined}>
        {size.w > 0
          ? sides.map((side) => (
              <figure key={side.playerId} className={cx('sh-results__fleet', side.playerId === state.winnerId && 'is-winner')}>
                <figcaption>
                  <span className="sh-results__name">
                    {side.name}
                    {side.playerId === playerId ? <span className="sh-captain__you">You</span> : null}
                  </span>
                  {side.playerId === state.winnerId ? (
                    <Badge color="var(--yellow)" icon="crown">
                      Winner
                    </Badge>
                  ) : null}
                </figcaption>
                <Board
                  n={n}
                  px={sea}
                  label={`${side.name}’s fleet, revealed`}
                  variant="reveal"
                  shots={side.board}
                  vessels={revealDraw(side)}
                  glow={glow}
                  cell={(x, y) => ({ label: `${String.fromCharCode(65 + x)}${y + 1}`, disabled: true })}
                />
              </figure>
            ))
          : null}
      </div>

      <table className="sh-stats">
        <caption className="visually-hidden">Battle statistics</caption>
        <thead>
          <tr>
            <th scope="col">Captain</th>
            <th scope="col">Shots</th>
            <th scope="col">Hits</th>
            <th scope="col">
              <abbr title="Accuracy">Acc.</abbr>
            </th>
            <th scope="col">Sunk</th>
            <th scope="col">
              <abbr title="Best hit streak">Streak</abbr>
            </th>
          </tr>
        </thead>
        <tbody>
          {sides.map((s) => (
            <tr key={s.playerId} data-winner={s.playerId === state.winnerId ? 'true' : undefined}>
              <th scope="row">{s.name}</th>
              <td>{s.shots}</td>
              <td>{s.hits}</td>
              <td>{s.shots ? Math.round((s.hits / s.shots) * 100) : 0}%</td>
              <td>{s.sunk}</td>
              <td>{s.bestStreak}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="sh-results__actions">
        {inTournament ? (
          <p className="dc-muted sh-results__note">Tournament game complete — the Tournament Center schedules what’s next.</p>
        ) : isCaptain ? (
          <RematchButton state={state} playerId={playerId!} nameOf={nameOf} />
        ) : null}
        {isHost && !inTournament ? (
          <Button variant="ghost" icon="gear" onClick={() => session.lobby.toLobby()}>
            Back to lobby
          </Button>
        ) : null}
        <LeaveButton size="md" />
      </footer>
    </section>
  );
}

function revealDraw(side: ShipsSideView): VesselDraw[] {
  const sunk = new Set(side.sunkVessels.map((v) => v.id));
  const fleet = side.revealed.length ? side.revealed : side.sunkVessels;
  return fleet.map((v) => ({ ...v, tone: sunk.has(v.id) ? 'sunk' : 'live' }));
}

function RematchButton({ state, playerId, nameOf }: { state: ShipsPublicState; playerId: string; nameOf: (id: string) => string }) {
  const opp = state.sides.find((s) => s.playerId !== playerId);
  const oppHere = Boolean(opp && state.players[opp.playerId] && !state.players[opp.playerId]!.spectator);
  const mine = state.rematch.includes(playerId);
  const theirs = Boolean(opp && state.rematch.includes(opp.playerId));
  if (!oppHere) {
    return (
      <Button variant="secondary" icon="refresh" disabled>
        Opponent left
      </Button>
    );
  }
  if (mine) {
    return (
      <span className="sh-rematch" style={{ '--x': 1 } as CSSProperties}>
        <span className="dc-muted">Waiting for {nameOf(opp!.playerId)}…</span>
        <Button variant="ghost" size="sm" onClick={() => session.send(SHIPS_MSG.rematch, { want: false })}>
          Cancel
        </Button>
      </span>
    );
  }
  return (
    <span className="sh-rematch">
      {theirs ? <span className="sh-rematch__ask">{nameOf(opp!.playerId)} wants a rematch!</span> : null}
      <Button
        variant="primary"
        size="lg"
        icon="refresh"
        className={theirs ? 'sh-pulse' : undefined}
        onClick={() => session.send(SHIPS_MSG.rematch, { want: true })}
      >
        {theirs ? 'Accept rematch' : 'Rematch'}
      </Button>
    </span>
  );
}
