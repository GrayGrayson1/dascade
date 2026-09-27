/** INTERMISSION card: how everyone did on the hole just played, running totals, and what's next. */
import { useEffect, useRef } from 'react';
import { puttScoreLabel, type PuttPublicState } from '@dascade/shared/games/putt';
import { PixelIcon, ProgressBar, cx } from '@dascade/ui';
import { useCountdown, useRoomSelector } from '../../net/hooks.ts';
import { useSessionStore } from '../../net/session.ts';
import { formatToPar, holeAt, rows, scoreTone } from './helpers.ts';
import { drawHoleThumb } from './game/thumb.ts';

function Thumb({ holeNo }: { holeNo: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hole = holeAt({ route: [holeNo] }, 0);
  useEffect(() => {
    if (ref.current && hole) drawHoleThumb(ref.current, hole, 168, 96);
  }, [hole]);
  return <canvas ref={ref} className="pt-thumb" aria-hidden width={168} height={96} style={{ width: 168, height: 96 }} />;
}

export function HoleSummary() {
  const state = useRoomSelector<PuttPublicState, PuttPublicState>((s) => s, (a, b) => a === b);
  const me = useSessionStore((s) => s.playerId);
  const left = useCountdown(state?.phaseEndsAt ?? null);
  if (!state) return null;
  const done = Math.max(0, state.holeIndex - 1);
  const played = holeAt(state, done);
  const next = holeAt(state, state.holeIndex);
  if (!played) return null;
  const list = rows(state);
  const nextPlayoff = state.holeIndex >= state.regulation;
  const total = 5500;
  return (
    <div className="pt-overlay" role="dialog" aria-labelledby="pt-summary-title">
      <section className="pt-summary dc-panel dc-panel--brackets">
        <header className="pt-summary__head">
          <span className="pt-summary__kicker">Hole {played.number} complete</span>
          <h2 id="pt-summary-title" className="pt-summary__title">
            {played.name}
          </h2>
          <span className="pt-summary__par">
            Par <b className="pt-num">{played.par}</b>
          </span>
        </header>
        <ol className="pt-summary__list">
          {list.map(({ id, g, toPar }) => {
            const s = g.card?.[done] ?? 0;
            const tone = scoreTone(s, played.par);
            const sitting = nextPlayoff && state.playoffIds.length > 0 && !state.playoffIds.includes(id) && done >= state.regulation;
            return (
              <li key={id} className={cx('pt-summary__row', id === me && 'is-me', g.retired && 'is-out')}>
                <i className="pt-dot" style={{ background: g.color }} aria-hidden />
                <span className="pt-summary__name">{g.name}</span>
                <span className={cx('pt-summary__score', `pt-score--${tone}`)}>
                  <b className="pt-num">{s || '–'}</b>
                  <span className="pt-summary__label">
                    {g.retired ? 'Left' : sitting ? 'Watching' : s >= played.par + state.maxOverPar ? 'Stroke limit' : s ? puttScoreLabel(s, played.par) : ''}
                  </span>
                </span>
                <span className="pt-summary__total pt-num" title="Total to par">
                  {formatToPar(toPar)}
                </span>
              </li>
            );
          })}
        </ol>
        {next ? (
          <footer className="pt-summary__next">
            <Thumb holeNo={next.number} />
            <div className="pt-summary__nextmeta">
              <span className="pt-summary__kicker">
                <PixelIcon name="arrow-right" /> {nextPlayoff ? 'Sudden-death playoff' : 'Up next'}
              </span>
              <b>
                Hole <span className="pt-num">{next.number}</span> · {next.name}
              </b>
              <span className="pt-summary__par">
                Par <b className="pt-num">{next.par}</b> · starts in <span className="pt-num">{Math.ceil(left / 1000)}</span>s
              </span>
              <ProgressBar value={1 - left / total} label="Next hole" />
            </div>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
