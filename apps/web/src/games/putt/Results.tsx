/** RESULTS: podium, full scorecard, personal bests (solo), rematch / play again / leave. */
import { useEffect, useState } from 'react';
import { COURSE_NAME } from '@dascade/game-core/putt';
import { PUTT_BEST_DOC, PUTT_MSG, type PuttBestDoc, type PuttPublicState } from '@dascade/shared/games/putt';
import { Badge, Button, PixelIcon, cx } from '@dascade/ui';
import { useRoomSelector } from '../../net/hooks.ts';
import { session, useSessionStore } from '../../net/session.ts';
import { persistence } from '../../persistence/index.ts';
import { ResultsActions } from '../../shell/common.tsx';
import { finalPlaces, formatToPar, holeAt, ordinal } from './helpers.ts';
import { Scorecard } from './Scorecard.tsx';

export function Results() {
  const state = useRoomSelector<PuttPublicState, PuttPublicState>((s) => s, (a, b) => a === b);
  const me = useSessionStore((s) => s.playerId);
  const [best, setBest] = useState<{ prev: PuttBestDoc | null; record: boolean } | null>(null);
  const places = state ? finalPlaces(state) : [];
  const mine = places.find((p) => p.id === me);
  const fullRound = Boolean(state && state.regulation === 9);
  const solo = Boolean(state?.solo);

  // Solo personal bests (local / profile storage; never gameplay).
  useEffect(() => {
    if (!state || !solo || !mine || mine.g.retired) return;
    let alive = true;
    void (async () => {
      const store = persistence();
      const prev = await store.loadDoc<PuttBestDoc>(PUTT_BEST_DOC).catch(() => null);
      const next: PuttBestDoc = { holes: { ...(prev?.holes ?? {}) }, full: prev?.full, savedAt: Date.now() };
      let record = false;
      state.route.slice(0, state.regulation).forEach((n, i) => {
        const s = mine.g.card?.[i] ?? 0;
        if (s > 0 && (!next.holes[n] || s < next.holes[n]!)) {
          next.holes[n] = s;
          record = true;
        }
      });
      if (fullRound && mine.g.total > 0 && (!next.full || mine.g.total < next.full)) {
        next.full = mine.g.total;
        record = true;
      }
      if (record) await store.saveDoc(PUTT_BEST_DOC, next).catch(() => undefined);
      if (alive) setBest({ prev, record });
    })();
    return () => {
      alive = false;
    };
    // Once per results screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solo, mine?.id]);

  if (!state) return null;
  const hostId = state.hostId;
  const isHost = Boolean(me && me === hostId);
  const par = state.route.slice(0, state.regulation).reduce((s, _n, i) => s + (holeAt(state, i)?.par ?? 0), 0);
  const winners = places.filter((p) => p.place === 1);
  const podium = places.filter((p) => p.place <= 3 && !p.g.retired).slice(0, 3);
  const order = [podium[1], podium[0], podium[2]].filter(Boolean) as typeof podium;
  const title = solo
    ? 'Round complete'
    : winners.length > 1
      ? 'A shared victory!'
      : winners[0]
        ? winners[0].id === me
          ? 'You win!'
          : `${winners[0].g.name} wins!`
        : 'Round complete';
  return (
    <div className="pt-overlay pt-overlay--results" role="dialog" aria-labelledby="pt-results-title">
      <section className="pt-results dc-panel dc-panel--brackets dc-panel--glow" data-part="results">
        <header className="pt-results__head">
          <span className="pt-summary__kicker">
            {COURSE_NAME} · {state.regulation === 9 ? 'Full course' : `${state.regulation} ${state.regulation === 1 ? 'hole' : 'holes'}`} · Par <span className="pt-num">{par}</span>
            {state.tournament ? ' · Tournament match' : ''}
          </span>
          <h2 id="pt-results-title" className="pt-results__title">
            {title}
          </h2>
          {mine ? (
            <p className="pt-results__me">
              {solo ? 'You shot' : `You finished ${ordinal(mine.place)} with`} <b className="pt-num">{mine.g.total}</b> ({formatToPar(mine.g.total - mine.g.parPlayed)})
              {mine.g.holesInOne > 0 ? (
                <Badge color="var(--yellow)" icon="star">
                  {mine.g.holesInOne} hole{mine.g.holesInOne > 1 ? 's' : ''} in one
                </Badge>
              ) : null}
              {best?.record ? (
                <Badge color="var(--purple)" icon="trophy">
                  New personal best
                </Badge>
              ) : null}
            </p>
          ) : null}
        </header>
        {!solo && order.length > 1 ? (
          <ol className="pt-podium" aria-label="Podium">
            {order.map((p) => (
              <li key={p.id} className={cx('pt-podium__step', `is-p${p.place}`, p.id === me && 'is-me')}>
                <span className="pt-podium__name">
                  <i className="pt-dot" style={{ background: p.g.color }} aria-hidden /> {p.g.name}
                </span>
                <span className="pt-podium__score pt-num">
                  {p.g.total} <small>({formatToPar(p.g.total - p.g.parPlayed)})</small>
                </span>
                <span className="pt-podium__block">
                  {p.place === 1 ? <PixelIcon name="trophy" /> : null}
                  <b className="pt-num">{ordinal(p.place)}</b>
                </span>
              </li>
            ))}
          </ol>
        ) : null}
        <Scorecard state={state} playerId={me} />
        {solo && best?.prev?.full && fullRound ? (
          <p className="pt-results__pb">
            Personal best (full course): <b className="pt-num">{Math.min(best.prev.full, mine?.g.total ?? Infinity)}</b>
          </p>
        ) : null}
        <footer className="pt-results__actions">
          <ResultsActions
            extra={
              isHost && !state.tournament ? (
                <Button variant="secondary" size="lg" icon="play" onClick={() => session.send(PUTT_MSG.rematch, {})}>
                  Rematch now
                </Button>
              ) : undefined
            }
          />
        </footer>
      </section>
    </div>
  );
}
