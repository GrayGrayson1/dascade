import type { CSSProperties } from 'react';
import { Avatar, PixelIcon, cx } from '@dascade/ui';
import type { DasinoPublicState } from '@dascade/shared/games/dasino';
import { ResultsActions } from '../../shell/common.tsx';
import { fmt, signed } from './ui.ts';

const PODIUM_ORDER = [1, 0, 2];

export function Results({ state, playerId }: { state: DasinoPublicState; playerId: string | null }) {
  const rows = state.results;
  const podium = PODIUM_ORDER.map((i) => rows[i]).filter(Boolean);
  const mine = rows.find((r) => r.playerId === playerId);
  return (
    <div className="dn-results">
      <header className="dn-floor__sign">
        <h1 className="dn-sign dn-sign--small" aria-label="Floor closed">
          <span>FLOOR</span> <em>CLOSED</em>
        </h1>
        <p className="dn-floor__tag">Final standings by net winnings · virtual chips only</p>
      </header>

      {podium.length ? (
        <ol className="dn-podium" aria-label="Top three">
          {podium.map((r) => (
            <li key={r!.playerId} data-place={r!.placement} style={{ '--c': r!.color } as CSSProperties}>
              <Avatar avatar={r!.avatar} color={r!.color} size={r!.placement === 1 ? 64 : 48} />
              <span className="dn-podium__name">{r!.name}</span>
              <span className={cx('dn-podium__net dc-num', r!.net > 0 && 'is-up', r!.net < 0 && 'is-down')}>{signed(r!.net)}</span>
              <span className="dn-podium__block">
                {r!.placement === 1 ? <PixelIcon name="crown" /> : null}
                <b>{r!.placement}</b>
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {mine ? (
        <p className="dn-results__you">
          You finished <b>#{mine.placement}</b> with <b className="dc-num">{fmt(mine.balance)}</b> chips ({signed(mine.net)}).
        </p>
      ) : null}

      <div className="dn-glass dn-results__table">
        <table className="dn-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Player</th>
              <th scope="col">Net</th>
              <th scope="col">Chips</th>
              <th scope="col">Best round</th>
              <th scope="col" className="dn-col-opt">
                Wagered
              </th>
              <th scope="col" className="dn-col-opt">
                Refills
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.playerId} className={r.playerId === playerId ? 'is-me' : undefined}>
                <td className="dc-num">{r.placement}</td>
                <th scope="row">
                  <span className="dn-sym">
                    <Avatar avatar={r.avatar} color={r.color} size={24} />
                    <span>{r.name}</span>
                  </span>
                </th>
                <td className={cx('dc-num', r.net > 0 && 'is-up', r.net < 0 && 'is-down')}>{signed(r.net)}</td>
                <td className="dc-num">{fmt(r.balance)}</td>
                <td className="dc-num">{r.biggestWin > 0 ? `+${fmt(r.biggestWin)}` : '—'}</td>
                <td className="dc-num dn-col-opt">{fmt(r.wagered)}</td>
                <td className="dc-num dn-col-opt">{r.refills}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="dn-muted">
                  No one played this session.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <ResultsActions />
    </div>
  );
}
