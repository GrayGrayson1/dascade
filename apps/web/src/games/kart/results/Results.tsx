/**
 * Results: a real podium moment (portraits rise onto a stepped podium, confetti when effects
 * allow), then the full classification. Time trial shows the run vs the personal best and the
 * medal; the end of a Grand Prix shows the cup podium and the final points table.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  KART_CUPS,
  KART_GP_POINTS,
  KART_MSG,
  KART_TRACKS,
  type KartPublicState,
  type KartRacerId,
  type KartBodyId,
} from '@dascade/shared/games/kart';
import { formatRaceTime, ordinal } from '@dascade/shared';
import { KART_TRACK_DEFS } from '@dascade/game-core/kart';
import { Badge, Button, Panel, PixelIcon, cx } from '@dascade/ui';
import { useApp } from '../../../app/store.ts';
import { useGame } from '../../../net/hooks.ts';
import { session } from '../../../net/session.ts';
import { ResultsActions } from '../../../shell/common.tsx';
import { Portrait } from '../lobby/Portrait.tsx';
import { kartSfx } from '../audio/sounds.ts';
import { loadBest, type KartBestDoc } from '../docs.ts';
import { classify, racerSubtitle, gpStandings, medalFor, type Medal } from './order.ts';
import type { KartController } from '../race/controller.ts';

const MEDAL_LABEL: Record<Exclude<Medal, null>, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };

export interface PodiumEntry {
  key: string;
  place: number;
  name: string;
  racer: KartRacerId;
  body: KartBodyId;
  paint: string;
  detail: string;
  me: boolean;
}

export function Confetti({ count = 60 }: { count?: number }) {
  const fx = useApp((s) => s.settings.fx);
  const reduced = useApp((s) => s.settings.reducedMotion);
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: (i * 37) % 100,
        delay: ((i * 53) % 100) / 60,
        dur: 2.4 + ((i * 29) % 100) / 60,
        hue: ['#ffd23f', '#ff4fd8', '#22d3ee', '#2de38f', '#f97316', '#a78bfa'][i % 6],
        rot: (i * 47) % 360,
        drift: ((i * 31) % 60) - 30,
      })),
    [count],
  );
  if (fx === 'off' || reduced) return null;
  const n = fx === 'low' ? Math.ceil(count / 3) : count;
  return (
    <div className="kr-confetti" aria-hidden>
      {pieces.slice(0, n).map((p, i) => (
        <i
          key={i}
          style={
            {
              left: `${p.left}%`,
              background: p.hue,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.dur}s`,
              '--rot': `${p.rot}deg`,
              '--drift': `${p.drift}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

export function Podium({ entries, label }: { entries: PodiumEntry[]; label: string }) {
  const order = [entries.find((e) => e.place === 2), entries.find((e) => e.place === 1), entries.find((e) => e.place === 3)].filter(
    Boolean,
  ) as PodiumEntry[];
  if (!order.length) return null;
  return (
    <ol className="kr-podium" aria-label={label}>
      {order.map((e) => (
        <li
          key={e.key}
          className={cx('kr-podium__step', `kr-podium__step--${e.place}`, e.me && 'is-me')}
          aria-label={`${ordinal(e.place)}: ${e.name}, ${e.detail}`}
        >
          <Portrait racer={e.racer} body={e.body} paint={e.paint} size={e.place === 1 ? 132 : 104} className="kr-podium__portrait" />
          <span className="kr-podium__name">{e.name}</span>
          <span className="kr-podium__detail kh-num">{e.detail}</span>
          <div className="kr-podium__block">
            <span className="kh-num">{e.place}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Results({ ctrl }: { ctrl: KartController }) {
  const game = useGame<KartPublicState>();
  const [pb, setPb] = useState<KartBestDoc | null>(null);
  const trackId = game?.state.race?.trackId ?? 'pixel-plaza';
  const tt = game?.state.race?.mode === 'timetrial';
  useEffect(() => {
    let alive = true;
    // Give the controller a moment to merge + save this run first.
    const t = setTimeout(() => void loadBest(trackId).then((d) => alive && setPb(d)), 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [trackId]);

  const me = game?.playerId;
  const myPlace = me ? (game?.state.racers?.[me]?.finishOrder ?? 0) : 0;
  useEffect(() => {
    kartSfx.results(myPlace > 0 && myPlace <= 3);
  }, [myPlace]);

  if (!game) return null;
  const { state, playerId, isHost } = game;
  const race = state.race;
  const track = KART_TRACKS[trackId];
  const gp = race.mode === 'gp';
  const rows = classify(state.racers ?? {});
  const winner = rows.find((x) => x.r.finishOrder === 1);
  const mine = rows.find((x) => x.id === playerId);
  const par = KART_TRACK_DEFS[trackId]?.parLapMs ?? 0;

  const standings = gp ? gpStandings(state.gp ?? {}, race.rounds || 4, KART_GP_POINTS) : [];
  const champion = standings[0];
  const podium: PodiumEntry[] = gp
    ? standings
        .filter((s) => s.rank <= 3)
        .slice(0, 3)
        .map((s, i) => ({
          key: s.id,
          place: i + 1,
          name: s.e.name,
          racer: s.e.racer,
          body: state.racers?.[s.id]?.body ?? 'buggy',
          paint: s.e.paint,
          detail: `${s.e.points} pts`,
          me: s.id === playerId,
        }))
    : rows
        .filter((x) => x.r.finishOrder > 0 && x.r.finishOrder <= 3)
        .map((x) => ({
          key: x.id,
          place: x.r.finishOrder,
          name: x.r.name,
          racer: x.r.racer,
          body: x.r.body,
          paint: x.r.paint,
          detail: formatRaceTime(x.r.finishMs),
          me: x.id === playerId,
        }));

  const title = tt
    ? 'Time trial complete'
    : gp
      ? champion
        ? `${champion.e.name} wins the ${KART_CUPS[race.cup].name}!`
        : `${KART_CUPS[race.cup].name} complete`
      : winner
        ? `${winner.r.name} wins!`
        : 'Race over';

  const racePb = pb && mine?.r.finished ? pb.race[String(race.laps)] : undefined;
  const isRacePb = Boolean(mine?.r.finished && racePb && mine.r.finishMs <= racePb);
  const isLapPb = Boolean(mine?.r.bestLapMs && pb?.lapMs && mine.r.bestLapMs <= pb.lapMs);
  const medal = tt && mine ? medalFor(mine.r.bestLapMs, par) : null;
  const pbInfo = ctrl.lastPb;

  return (
    <div className="kr-results" data-part="results" role="dialog" aria-modal="false" aria-labelledby="kr-results-title">
      {(myPlace > 0 && myPlace <= 3) || (gp && champion?.id === playerId) || isRacePb ? <Confetti /> : null}
      <Panel brackets glow className="kr-results__panel" padded={false}>
        <header className="kr-results__head">
          <span className="kr-results__kicker">
            {gp ? `${KART_CUPS[race.cup].name} · final standings` : `${track.name} · ${race.laps} ${race.laps === 1 ? 'lap' : 'laps'}`}
          </span>
          <h2 id="kr-results-title" className="kr-results__title">
            {title}
          </h2>
        </header>

        <div className="kr-results__scroll">
          {tt && mine ? (
            <div className="kr-tt">
              <Portrait racer={mine.r.racer} body={mine.r.body} paint={mine.r.paint} size={120} className="kr-tt__portrait" />
              <div className="kr-tt__stats">
                <div className="kr-stat">
                  <span className="kr-stat__label">Total</span>
                  <b className="kh-num">{mine.r.finished ? formatRaceTime(mine.r.finishMs) : 'DNF'}</b>
                  {isRacePb ? (
                    <Badge color="var(--mat-gold, #ffd23f)" icon="star">
                      New record
                    </Badge>
                  ) : racePb ? (
                    <span className="kr-stat__sub kh-num">
                      PB {formatRaceTime(racePb)} ({mine.r.finishMs > racePb ? '+' : '−'}
                      {(Math.abs(mine.r.finishMs - racePb) / 1000).toFixed(3)})
                    </span>
                  ) : null}
                </div>
                <div className="kr-stat">
                  <span className="kr-stat__label">Best lap</span>
                  <b className="kh-num">{formatRaceTime(mine.r.bestLapMs)}</b>
                  {isLapPb ? (
                    <Badge color="var(--purple, #a78bfa)" icon="bolt">
                      Best ever lap
                    </Badge>
                  ) : pb?.lapMs ? (
                    <span className="kr-stat__sub kh-num">PB {formatRaceTime(pb.lapMs)}</span>
                  ) : null}
                </div>
                <div className="kr-stat">
                  <span className="kr-stat__label">
                    Par <span className="kh-num">{formatRaceTime(par)}</span>
                  </span>
                  {medal ? (
                    <b className={cx('kr-medal', `kr-medal--${medal}`)}>
                      <PixelIcon name="trophy" /> {MEDAL_LABEL[medal]}
                    </b>
                  ) : (
                    <b className="kr-stat__muted">Keep pushing</b>
                  )}
                </div>
              </div>
              {pbInfo?.ghostSaved ? (
                <p className="kr-tt__ghost">
                  <PixelIcon name="star" /> Ghost saved — race it next time.
                </p>
              ) : null}
            </div>
          ) : (
            <Podium entries={podium} label={gp ? 'Cup podium' : 'Podium'} />
          )}

          {gp ? (
            <table className="kr-table" aria-label="Grand Prix final standings">
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Racer</th>
                  {Array.from({ length: race.rounds || 4 }, (_, i) => (
                    <th scope="col" key={i} className="kr-table__round" title={KART_TRACKS[KART_CUPS[race.cup].tracks[i] ?? trackId]?.name}>
                      R{i + 1}
                    </th>
                  ))}
                  <th scope="col" className="kr-table__pts-h">
                    Points
                  </th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s) => (
                  <tr key={s.id} className={cx(s.id === playerId && 'is-me')}>
                    <td className="kr-table__pos kh-num">{s.rank}</td>
                    <td>
                      <span className="kr-table__racer">
                        <Portrait racer={s.e.racer} paint={s.e.paint} size={30} view="face" />
                        <span>
                          <b>{s.e.name}</b>
                          <small>{racerSubtitle(s.e.name, s.e.racer, s.e.bot)}</small>
                        </span>
                      </span>
                    </td>
                    {Array.from({ length: race.rounds || 4 }, (_, i) => (
                      <td key={i} className="kr-table__round kh-num">
                        {s.e.places[i] ? ordinal(s.e.places[i]!) : '—'}
                      </td>
                    ))}
                    <td className="kr-table__pts kh-num">{s.e.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="kr-table" aria-label="Race classification">
              <thead>
                <tr>
                  <th scope="col">Pos</th>
                  <th scope="col">Racer</th>
                  <th scope="col">Time</th>
                  <th scope="col">Best lap</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const fastest = race.fastestLapBy === row.id && race.fastestLapMs > 0;
                  const gap =
                    row.r.finished && winner && row.id !== winner.id
                      ? `+${((row.r.finishMs - winner.r.finishMs) / 1000).toFixed(3)}`
                      : null;
                  return (
                    <tr key={row.id} className={cx(row.id === playerId && 'is-me', !row.r.finished && 'is-out')}>
                      <td className="kr-table__pos kh-num">{row.r.finishOrder || i + 1}</td>
                      <td>
                        <span className="kr-table__racer">
                          <Portrait racer={row.r.racer} body={row.r.body} paint={row.r.paint} size={30} view="face" />
                          <span>
                            <b>{row.r.name}</b>
                            <small>{racerSubtitle(row.r.name, row.r.racer, row.r.bot)}</small>
                          </span>
                        </span>
                      </td>
                      <td className="kh-num">
                        {row.r.finished ? (
                          (gap ?? formatRaceTime(row.r.finishMs))
                        ) : (
                          <Badge color="var(--danger)">{row.r.active ? 'DNF' : 'Retired'}</Badge>
                        )}
                      </td>
                      <td className={cx('kh-num', fastest && 'kr-table__fastest')}>
                        {fastest ? <PixelIcon name="bolt" title="Fastest lap" /> : null}
                        {formatRaceTime(row.r.bestLapMs)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <footer className="kr-results__actions">
          <ResultsActions
            extra={
              isHost ? (
                <Button variant="secondary" size="lg" icon="flag" onClick={() => session.send(KART_MSG.next, {})}>
                  {tt ? 'Retry' : gp ? 'New cup' : 'Rematch'}
                </Button>
              ) : null
            }
          />
        </footer>
      </Panel>
    </div>
  );
}
