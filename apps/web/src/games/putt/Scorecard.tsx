/** The scorecard table (hole-by-hole strokes, par row, totals, to par). */
import { puttScoreLabel, type PuttPublicState } from '@dascade/shared/games/putt';
import { cx } from '@dascade/ui';
import { formatToPar, holeAt, rows, scoreTone } from './helpers.ts';

export function Scorecard({ state, playerId, highlight }: { state: PuttPublicState; playerId: string | null; highlight?: number }) {
  const route = state.route ?? [];
  const list = rows(state);
  const regulation = state.regulation || route.length;
  const parTotal = route.slice(0, regulation).reduce((s, _n, i) => s + (holeAt(state, i)?.par ?? 0), 0);
  return (
    <div className="pt-card-scroll">
      <table className="pt-scorecard">
        <caption className="visually-hidden">Scorecard</caption>
        <thead>
          <tr>
            <th scope="col" className="pt-scorecard__name">
              Hole
            </th>
            {route.map((n, i) => (
              <th key={i} scope="col" className={cx(i === highlight && 'is-current', i >= regulation && 'is-playoff')}>
                {i >= regulation ? <abbr title={`Playoff hole ${n}`}>P{n}</abbr> : n}
              </th>
            ))}
            <th scope="col">Tot</th>
            <th scope="col">+/−</th>
          </tr>
          <tr className="pt-scorecard__par">
            <th scope="row" className="pt-scorecard__name">
              Par
            </th>
            {route.map((_n, i) => (
              <td key={i} className={cx(i === highlight && 'is-current')}>
                {holeAt(state, i)?.par ?? ''}
              </td>
            ))}
            <td>{parTotal}</td>
            <td />
          </tr>
        </thead>
        <tbody>
          {list.map(({ id, g, toPar, thru }) => (
            <tr key={id} className={cx(id === playerId && 'is-me', g.retired && 'is-retired')}>
              <th scope="row" className="pt-scorecard__name">
                <i className="pt-dot" style={{ background: g.color }} aria-hidden />
                <span className="pt-scorecard__player">{g.name}</span>
                {g.retired ? <span className="pt-tag">Left</span> : null}
              </th>
              {route.map((_n, i) => {
                const v = g.card?.[i] ?? 0;
                const par = holeAt(state, i)?.par ?? 3;
                const tone = scoreTone(v, par);
                return (
                  <td key={i} className={cx('pt-score', `pt-score--${tone}`, i === highlight && 'is-current')} title={v ? puttScoreLabel(v, par) : 'Not played yet'}>
                    {v ? <span>{v}</span> : <span aria-label="not played">·</span>}
                  </td>
                );
              })}
              <td className="pt-num">{g.total || (thru ? g.total : '–')}</td>
              <td className="pt-num pt-topar">{thru ? formatToPar(toPar) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
