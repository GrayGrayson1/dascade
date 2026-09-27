/** Final standings: podium, full classification, fastest lap and time-trial medal. */
import { useEffect, useState } from 'react';
import {
  CIRCUIT_MSG,
  circuitBestKey,
  type CarLookView,
  type CircuitBestDoc,
  type CircuitPublicState,
  type CircuitTrackId,
  type RacerView,
} from '@dascade/shared/games/circuit';
import { formatRaceTime, ordinal } from '@dascade/shared';
import { parseBestDoc } from './bestDoc.ts';
import { TRACK_DEFS } from '@dascade/game-core/circuit';
import { Badge, Button, Panel, PixelIcon, cx } from '@dascade/ui';
import { useGame } from '../../net/hooks.ts';
import { session } from '../../net/session.ts';
import { persistence } from '../../persistence/index.ts';
import { ResultsActions } from '../../shell/common.tsx';
import { CarThumb } from './CarThumb.tsx';

const FALLBACK_LOOK: CarLookView = {
  chassis: 'volt',
  primary: '#8f88b3',
  secondary: '#3a3552',
  decal: 'none',
  wheels: 'spoke',
  number: 0,
  nameplate: 'RACER',
};

interface Row {
  id: string;
  r: RacerView;
  look: CarLookView;
}

function medal(bestLapMs: number, parMs: number): { name: string; color: string } | null {
  if (!bestLapMs) return null;
  if (bestLapMs <= parMs) return { name: 'Gold', color: '#ffd23f' };
  if (bestLapMs <= parMs * 1.08) return { name: 'Silver', color: '#c9cbe0' };
  if (bestLapMs <= parMs * 1.18) return { name: 'Bronze', color: '#d08a4a' };
  return null;
}

export function Results() {
  const game = useGame<CircuitPublicState>();
  const [pb, setPb] = useState<CircuitBestDoc | null>(null);
  const trackId = (game?.state.race?.trackId ?? 'neon-loop') as CircuitTrackId;
  useEffect(() => {
    let alive = true;
    persistence()
      .loadDoc<unknown>(circuitBestKey(trackId))
      .then((doc) => alive && setPb(parseBestDoc(doc, trackId)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [trackId]);
  if (!game) return null;
  const { state, playerId, isHost } = game;
  const race = state.race;
  const def = TRACK_DEFS[trackId];
  const rows: Row[] = Object.entries(state.racers ?? {})
    .map(([id, r]) => ({ id, r, look: state.cars?.[id] ?? FALLBACK_LOOK }))
    .sort((a, b) => {
      if (a.r.finishOrder && b.r.finishOrder) return a.r.finishOrder - b.r.finishOrder;
      if (a.r.finishOrder) return -1;
      if (b.r.finishOrder) return 1;
      return a.r.position - b.r.position;
    });
  const winner = rows.find((x) => x.r.finished);
  const solo = race.solo;
  const mine = rows.find((x) => x.id === playerId);
  const podium = rows.filter((x) => x.r.finished).slice(0, 3);
  const podiumOrder = [podium[1], podium[0], podium[2]].filter(Boolean) as Row[];
  const earned = solo && mine ? medal(mine.r.bestLapMs, def.parLapMs) : null;

  return (
    <div className="ci-results" role="dialog" aria-labelledby="ci-results-title">
      <Panel brackets glow className="ci-results__panel" padded={false}>
        <header className="ci-results__head">
          <span className="dc-label">
            {def.name} · {race.laps} {race.laps === 1 ? 'lap' : 'laps'}
          </span>
          <h2 id="ci-results-title" className="dc-title">
            {solo ? 'Time trial complete' : winner ? `${winner.look.nameplate || winner.r.name} wins!` : 'Race over'}
          </h2>
        </header>

        <div className="ci-results__scroll">
          {solo && mine ? (
            <div className="ci-results__solo">
              <div className="ci-stat">
                <span className="dc-label">Total</span>
                <b>{mine.r.finished ? formatRaceTime(mine.r.finishMs) : 'DNF'}</b>
              </div>
              <div className="ci-stat">
                <span className="dc-label">Best lap</span>
                <b>{formatRaceTime(mine.r.bestLapMs)}</b>
              </div>
              <div className="ci-stat">
                <span className="dc-label">Personal best</span>
                <b>{pb ? formatRaceTime(pb.lapMs) : '--:--.---'}</b>
                {pb && mine.r.bestLapMs && mine.r.bestLapMs <= pb.lapMs ? (
                  <Badge color="var(--purple)" icon="star">
                    New record
                  </Badge>
                ) : null}
              </div>
              <div className="ci-stat">
                <span className="dc-label">Par {formatRaceTime(def.parLapMs)}</span>
                {earned ? (
                  <b style={{ color: earned.color }}>
                    <PixelIcon name="trophy" /> {earned.name}
                  </b>
                ) : (
                  <b className="dc-muted">Keep pushing</b>
                )}
              </div>
            </div>
          ) : podiumOrder.length ? (
            <div className="ci-podium" aria-label="Podium">
              {podiumOrder.map((row) => {
                const place = row.r.finishOrder;
                return (
                  <div key={row.id} className={cx('ci-podium__step', `ci-podium__step--${place}`)}>
                    <CarThumb look={row.look} size={place === 1 ? 84 : 64} label={`${row.look.nameplate} car`} />
                    <span className="ci-podium__name">{row.look.nameplate || row.r.name}</span>
                    <span className="ci-podium__time">{formatRaceTime(row.r.finishMs)}</span>
                    <div className="ci-podium__block">
                      <span>{ordinal(place)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="ci-results__table" role="table" aria-label="Final standings">
            <div className="ci-results__row ci-results__row--head" role="row">
              <span role="columnheader">Pos</span>
              <span role="columnheader">Driver</span>
              <span role="columnheader">Time</span>
              <span role="columnheader">Best lap</span>
            </div>
            {rows.map((row, i) => {
              const fastest = race.fastestLapBy === row.id && race.fastestLapMs > 0;
              const gap =
                row.r.finished && winner && row.id !== winner.id ? `+${((row.r.finishMs - winner.r.finishMs) / 1000).toFixed(3)}` : null;
              return (
                <div key={row.id} role="row" className={cx('ci-results__row', row.id === playerId && 'is-me')}>
                  <span role="cell" className="ci-results__pos">
                    {row.r.finished ? row.r.finishOrder : i + 1}
                  </span>
                  <span role="cell" className="ci-results__driver">
                    <CarThumb look={row.look} size={34} label={`${row.look.nameplate} car`} />
                    <span>
                      <b>{row.look.nameplate || row.r.name}</b>
                      <small>
                        #{row.look.number} · {row.r.name}
                      </small>
                    </span>
                  </span>
                  <span role="cell" className="ci-results__time">
                    {row.r.finished ? (
                      (gap ?? formatRaceTime(row.r.finishMs))
                    ) : (
                      <Badge color="var(--red)">{row.r.active ? 'DNF' : 'Retired'}</Badge>
                    )}
                  </span>
                  <span role="cell" className={cx('ci-results__best', fastest && 'is-fastest')}>
                    {fastest ? <PixelIcon name="bolt" title="Fastest lap" /> : null}
                    {formatRaceTime(row.r.bestLapMs)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <footer className="ci-results__actions">
          <ResultsActions
            extra={
              isHost ? (
                <Button variant="secondary" size="lg" icon="flag" onClick={() => session.send(CIRCUIT_MSG.rematch, {})}>
                  {solo ? 'Retry' : 'Rematch'}
                </Button>
              ) : null
            }
          />
        </footer>
      </Panel>
    </div>
  );
}
