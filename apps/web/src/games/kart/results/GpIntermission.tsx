/**
 * Between Grand Prix races (INTERMISSION): this race's top three, the cup standings with the
 * points each racer just gained (counted up) and rank movement, and the next track. The host can
 * start the next race now; otherwise it starts automatically.
 */
import { useEffect, useRef, useState } from 'react';
import { KART_CUPS, KART_GP_POINTS, KART_MSG, KART_RACERS, KART_TRACKS, type KartPublicState } from '@dascade/shared/games/kart';
import { formatRaceTime, ordinal } from '@dascade/shared';
import { Button, Panel, PixelIcon, cx } from '@dascade/ui';
import { useApp } from '../../../app/store.ts';
import { useCountdown, useGame } from '../../../net/hooks.ts';
import { session } from '../../../net/session.ts';
import { Portrait } from '../lobby/Portrait.tsx';
import { TrackThumb } from '../lobby/TrackThumb.tsx';
import { kartSfx } from '../audio/sounds.ts';
import { classify, gpStandings } from './order.ts';
import { BIOME_LABEL, trackBiome } from '../trackInfo.ts';

/** Counts 0 → value over ~0.9 s (instantly with reduced motion). */
function CountUp({ value, delay = 0, sound = false }: { value: number; delay?: number; sound?: boolean }) {
  const reduced = useApp((s) => s.settings.reducedMotion);
  const [shown, setShown] = useState(reduced ? value : 0);
  const raf = useRef(0);
  useEffect(() => {
    if (reduced || value <= 0) {
      setShown(value);
      return;
    }
    let start = 0;
    let last = -1;
    const step = (t: number) => {
      if (!start) start = t + delay;
      const k = Math.max(0, Math.min(1, (t - start) / 900));
      const v = Math.round(value * (1 - (1 - k) * (1 - k)));
      if (v !== last) {
        // Only your own row ticks, every other point (a whole table ticking is noise).
        if (sound && v > 0 && v % 2 === 0) kartSfx.points();
        last = v;
        setShown(v);
      }
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, delay, reduced, sound]);
  return <>{shown}</>;
}

export function GpIntermission() {
  const game = useGame<KartPublicState>();
  const left = useCountdown(game?.state.phaseEndsAt);
  if (!game) return null;
  const { state, playerId, isHost } = game;
  const race = state.race;
  const cup = KART_CUPS[race.cup];
  const round = race.round || 1;
  const rows = classify(state.racers ?? {});
  // This race's top three: finishers first, then the classified order (the finish window can close
  // before everyone crosses; the server still ranks them by distance).
  const top = rows.slice(0, 3).map((r, i) => ({ ...r, place: state.gp?.[r.id]?.places[round - 1] || r.r.finishOrder || i + 1 }));
  const standings = gpStandings(state.gp ?? {}, round, KART_GP_POINTS);
  const nextId = cup.tracks[round];
  const next = nextId ? KART_TRACKS[nextId] : null;
  const secs = Math.ceil(left / 1000);

  return (
    <div className="kr-results kr-gp" data-part="gp-standings" role="dialog" aria-modal="false" aria-labelledby="kr-gp-title">
      <Panel brackets glow className="kr-results__panel" padded={false}>
        <header className="kr-results__head">
          <span className="kr-results__kicker">
            {cup.name} · Race <span className="kh-num">{round}</span>/<span className="kh-num">{race.rounds || 4}</span> complete
          </span>
          <h2 id="kr-gp-title" className="kr-results__title">
            Cup standings
          </h2>
        </header>
        <div className="kr-results__scroll kr-gp__body">
          <section className="kr-gp__race" aria-label={`${KART_TRACKS[race.trackId].name} result`}>
            <h3 className="kr-gp__h">{KART_TRACKS[race.trackId].name}</h3>
            <ol className="kr-gp__top">
              {top.map((r) => (
                <li key={r.id} className={cx(r.id === playerId && 'is-me')} data-place={r.place}>
                  <span className="kr-gp__place kh-num">{ordinal(r.place)}</span>
                  <Portrait racer={r.r.racer} body={r.r.body} paint={r.r.paint} size={40} view="face" />
                  <span className="kr-gp__who">
                    <b>{r.r.name}</b>
                    <small className="kh-num">{r.r.finished ? formatRaceTime(r.r.finishMs) : 'Classified'}</small>
                  </span>
                </li>
              ))}
            </ol>
            {next ? (
              <div className="kr-gp__next" data-biome={trackBiome(nextId!)}>
                <span className="kr-results__kicker">Next · race {round + 1}</span>
                <TrackThumb trackId={nextId!} />
                <b>{next.name}</b>
                <small>{BIOME_LABEL[trackBiome(nextId!)]}</small>
              </div>
            ) : null}
          </section>

          <table className="kr-table kr-gp__table" aria-label="Grand Prix standings">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Racer</th>
                <th scope="col">This race</th>
                <th scope="col">Points</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s, i) => {
                const moved = s.prevRank ? s.prevRank - s.rank : 0;
                return (
                  <tr key={s.id} className={cx(s.id === playerId && 'is-me')} style={{ animationDelay: `${i * 40}ms` }}>
                    <td className="kr-table__pos kh-num">
                      {s.rank}
                      {moved > 0 ? (
                        <span className="kr-move kr-move--up" aria-label={`up ${moved}`}>
                          ▲{moved}
                        </span>
                      ) : moved < 0 ? (
                        <span className="kr-move kr-move--down" aria-label={`down ${-moved}`}>
                          ▼{-moved}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <span className="kr-table__racer">
                        <Portrait racer={s.e.racer} paint={s.e.paint} size={30} view="face" />
                        <span>
                          <b>{s.e.name}</b>
                          <small>{s.e.bot ? `CPU · ${KART_RACERS[s.e.racer].name}` : KART_RACERS[s.e.racer].name}</small>
                        </span>
                      </span>
                    </td>
                    <td className="kh-num">
                      {s.e.places[round - 1] ? ordinal(s.e.places[round - 1]!) : '—'}
                      {s.gained ? (
                        <span className="kr-gain">
                          +<CountUp value={s.gained} delay={200 + i * 40} sound={s.id === playerId} />
                        </span>
                      ) : null}
                    </td>
                    <td className="kr-table__pts kh-num">{s.e.points}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <footer className="kr-results__actions kr-gp__actions">
          <span className="kr-gp__auto" aria-live="polite">
            <PixelIcon name="clock" />{' '}
            {secs > 0 ? (
              <>
                Next race in <span className="kh-num">{secs}</span>s
              </>
            ) : (
              'Starting…'
            )}
          </span>
          {isHost ? (
            <Button variant="primary" size="lg" icon="flag" onClick={() => session.send(KART_MSG.next, {})}>
              Next race
            </Button>
          ) : null}
        </footer>
      </Panel>
    </div>
  );
}
