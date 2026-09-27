/**
 * Standings (round robin / Swiss) with tiebreak columns and a plain-language explanation of each
 * tiebreak, plus the round-robin crosstable. Tables scroll sideways inside their own box on phones
 * (player column pinned) — the page itself never scrolls horizontally.
 */
import { FINAL_TIEBREAK_TEXT, formatPoints } from '@dascade/shared';
import { cx } from '@dascade/ui';
import type { CrossCellVM, StandingVM, TiebreakVM } from './types.ts';

function fmtTiebreak(v: number | undefined): string {
  if (v === undefined) return '–';
  return Number.isInteger(v * 2) ? formatPoints(v) : v.toFixed(1);
}

export function StandingsTable({
  rows,
  tiebreaks,
  caption,
  showByes,
}: {
  rows: StandingVM[];
  tiebreaks: TiebreakVM[];
  caption: string;
  showByes?: boolean;
}) {
  if (rows.length === 0) return <p className="dc-muted tc-empty">Standings appear once the first round is played.</p>;
  return (
    <div className="tc-standings">
      <div className="tc-table-wrap" role="region" aria-label={caption} tabIndex={0}>
        <table className="tc-table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="tc-table__rank">
                #
              </th>
              <th scope="col" className="tc-table__name">
                Player
              </th>
              <th scope="col" className="tc-table__pts">
                <abbr title="Points (win 1, draw ½)">Pts</abbr>
              </th>
              <th scope="col">
                <abbr title="Matches played">P</abbr>
              </th>
              <th scope="col">
                <abbr title="Wins">W</abbr>
              </th>
              <th scope="col">
                <abbr title="Draws">D</abbr>
              </th>
              <th scope="col">
                <abbr title="Losses">L</abbr>
              </th>
              {showByes ? (
                <th scope="col">
                  <abbr title="Byes">Bye</abbr>
                </th>
              ) : null}
              {tiebreaks.map((t) => (
                <th key={t.id} scope="col" className="tc-table__tb">
                  <abbr title={t.name}>{t.short}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.participantId}
                data-me={r.isMe || undefined}
                data-inactive={r.inactive || undefined}
                data-top={r.rank > 0 && r.rank <= 3 ? r.rank : undefined}
              >
                <td className="tc-table__rank dc-num">{r.rank > 0 ? `${r.shared ? '=' : ''}${r.rank}` : '–'}</td>
                <th scope="row" className="tc-table__name">
                  <span className="tc-table__player">
                    {r.seed ? <span className="tc-seed">{r.seed}</span> : null}
                    <span className="tc-table__pname">{r.name}</span>
                    {r.isMe ? <span className="tc-you">You</span> : null}
                    {r.inactive ? <span className="tc-table__out">out</span> : null}
                  </span>
                </th>
                <td className="tc-table__pts dc-num">{formatPoints(r.points)}</td>
                <td className="dc-num">{r.played}</td>
                <td className="dc-num">{r.wins}</td>
                <td className="dc-num">{r.draws}</td>
                <td className="dc-num">{r.losses}</td>
                {showByes ? <td className="dc-num">{r.byes}</td> : null}
                {tiebreaks.map((t) => (
                  <td key={t.id} className="dc-num tc-table__tb">
                    {fmtTiebreak(r.tiebreaks[t.id])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tiebreaks.length > 0 ? <TiebreakHelp tiebreaks={tiebreaks} /> : null}
    </div>
  );
}

export function TiebreakHelp({ tiebreaks }: { tiebreaks: TiebreakVM[] }) {
  return (
    <details className="tc-tiebreaks">
      <summary>How ties are broken</summary>
      <p className="dc-muted">Players on the same points are separated by these tiebreaks, in this order:</p>
      <ol>
        {tiebreaks.map((t) => (
          <li key={t.id}>
            <b>
              {t.name} <span className="tc-tiebreaks__short">({t.short})</span>
            </b>
            <span>{t.explanation}</span>
          </li>
        ))}
      </ol>
      <p className="dc-field__hint">{FINAL_TIEBREAK_TEXT}</p>
    </details>
  );
}

const RESULT_TEXT: Record<'W' | 'L' | 'D', string> = { W: 'won', L: 'lost', D: 'drew' };

export function Crosstable({
  ids,
  names,
  cells,
  points,
  me,
  onSelect,
  showSeries,
}: {
  /** Best-of-N > 1: show the series score under the result. */
  showSeries?: boolean;
  ids: string[];
  names: Map<string, string>;
  cells: Map<string, CrossCellVM>;
  points: Map<string, number>;
  me: string | null;
  onSelect: (matchId: string) => void;
}) {
  if (ids.length === 0) return <p className="dc-muted tc-empty">The crosstable fills in as matches finish.</p>;
  return (
    <div className="tc-table-wrap tc-table-wrap--fit" role="region" aria-label="Crosstable" tabIndex={0}>
      <table className="tc-cross">
        <caption className="visually-hidden">Crosstable: each row shows that player’s result against the player in each column.</caption>
        <thead>
          <tr>
            <th scope="col" className="tc-cross__corner">
              <span className="visually-hidden">Player</span>
            </th>
            {ids.map((id, i) => (
              <th key={id} scope="col" className="tc-cross__col" title={names.get(id)}>
                <span className="dc-num">{i + 1}</span>
              </th>
            ))}
            <th scope="col" className="tc-cross__pts">
              Pts
            </th>
          </tr>
        </thead>
        <tbody>
          {ids.map((row, i) => (
            <tr key={row} data-me={row === me || undefined}>
              <th scope="row" className="tc-cross__name">
                <span className="dc-num tc-cross__idx">{i + 1}</span>
                <span className="tc-cross__pname">{names.get(row) ?? 'Unknown'}</span>
              </th>
              {ids.map((col) => {
                if (row === col) return <td key={col} className="tc-cross__self" aria-label="—" />;
                const c = cells.get(`${row}|${col}`);
                const label = c?.result
                  ? `${names.get(row)} ${RESULT_TEXT[c.result]} against ${names.get(col)}${c.score ? `, ${c.score}` : ''}`
                  : c?.status === 'live'
                    ? `${names.get(row)} versus ${names.get(col)}: live`
                    : c
                      ? `${names.get(row)} versus ${names.get(col)}: round ${c.round}, not played yet`
                      : `${names.get(row)} versus ${names.get(col)}: not scheduled`;
                return (
                  <td key={col} className={cx('tc-cross__cell')} data-result={c?.result ?? undefined} data-status={c?.status ?? undefined}>
                    {c?.matchId ? (
                      <button type="button" className="tc-cross__btn" aria-label={label} onClick={() => onSelect(c.matchId!)}>
                        {c.result ? (
                          c.result === 'W' ? (
                            '1'
                          ) : c.result === 'L' ? (
                            '0'
                          ) : (
                            '½'
                          )
                        ) : c.status === 'live' ? (
                          <span className="tc-cross__live">Live</span>
                        ) : (
                          <span className="tc-cross__round">R{c.round}</span>
                        )}
                        {showSeries && c.score && c.result ? <small>{c.score}</small> : null}
                      </button>
                    ) : null}
                  </td>
                );
              })}
              <td className="tc-cross__pts dc-num">{formatPoints(points.get(row) ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
