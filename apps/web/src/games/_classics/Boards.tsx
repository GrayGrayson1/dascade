/** High-score board (server-verified) and live multiplayer standings. */
import { PixelIcon, Spinner, cx } from '@dascade/ui';
import type { HighScoreBoardView } from '@dascade/shared/games/classics';
import { formatScore } from './Hud.tsx';
import type { StandingRow } from './useClassics.ts';

const STATUS_LABEL: Record<string, string> = {
  idle: 'Waiting',
  ready: 'Ready',
  playing: 'Playing',
  over: 'Finished',
  out: 'Left',
};

export function HighScoreBoard({
  data,
  loading,
  error,
  highlightId,
  statLabel,
  compact,
  title = 'High scores',
}: {
  data: HighScoreBoardView | null;
  loading?: boolean;
  error?: boolean;
  highlightId?: string | null;
  statLabel?: string;
  compact?: boolean;
  title?: string;
}) {
  const entries = data?.entries ?? [];
  const label = statLabel || data?.statLabel || '';
  return (
    <section className={cx('cl-board', compact && 'cl-board--compact')} data-part="scoreboard" aria-label={title}>
      <header className="cl-board__head">
        <PixelIcon name="trophy" size={14} />
        <h3 className="cl-board__title">{title}</h3>
        <span className="cl-board__tag">Verified</span>
      </header>
      {loading && !data ? (
        <div className="cl-board__empty">
          <Spinner label="Loading high scores" />
        </div>
      ) : error && !data ? (
        <p className="cl-board__empty">High scores are unavailable right now.</p>
      ) : entries.length === 0 ? (
        <p className="cl-board__empty">No scores yet — yours could be the first.</p>
      ) : (
        <ol className="cl-board__list">
          {entries.map((e, i) => (
            <li key={e.id} className={cx('cl-board__row', e.id === highlightId && 'is-you', i < 3 && `is-top${i + 1}`)}>
              <span className="cl-board__rank">{i + 1}</span>
              <span className="cl-board__name">
                {e.name}
                {e.id === highlightId ? <span className="cl-board__you">You</span> : null}
              </span>
              {!compact && label ? (
                <span className="cl-board__stat" title={label}>
                  {e.stat.toLocaleString('en-US')} <small>{label}</small>
                </span>
              ) : null}
              <span className="cl-board__score">{formatScore(e.score)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function StandingsPanel({
  rows,
  me,
  statLabel,
  variant = 'rail',
  title = 'Standings',
}: {
  rows: StandingRow[];
  me: string | null;
  statLabel: string;
  variant?: 'rail' | 'strip' | 'table';
  title?: string;
}) {
  if (variant === 'strip') {
    return (
      <ol className="cl-strip" data-part="standings" aria-label={title}>
        {rows.map((r, i) => (
          <li key={r.id} className={cx('cl-strip__item', r.id === me && 'is-you', r.status !== 'playing' && 'is-done')} style={{ ['--pc' as string]: r.color }}>
            <span className="cl-strip__rank">{r.rank || i + 1}</span>
            <span className="cl-strip__name">{r.id === me ? 'You' : r.name}</span>
            <span className="cl-strip__score">{formatScore(r.score)}</span>
            {r.status === 'over' || r.status === 'out' ? <PixelIcon name={r.status === 'out' ? 'leave' : 'flag'} size={10} aria-label={STATUS_LABEL[r.status]} /> : null}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <section className={cx('cl-standings', variant === 'table' && 'cl-standings--table')} data-part="standings" aria-label={title}>
      <header className="cl-board__head">
        <PixelIcon name="users" size={14} />
        <h3 className="cl-board__title">{title}</h3>
      </header>
      <ol className="cl-standings__list">
        {rows.map((r, i) => (
          <li key={r.id} className={cx('cl-standings__row', r.id === me && 'is-you', `is-${r.status}`)} style={{ ['--pc' as string]: r.color }}>
            <span className="cl-standings__rank">{r.rank || i + 1}</span>
            <span className="cl-standings__who">
              <span className="cl-standings__name">
                {r.name}
                {r.id === me ? <span className="cl-board__you">You</span> : null}
              </span>
              <span className="cl-standings__meta">
                {STATUS_LABEL[r.status] ?? r.status}
                {variant === 'table' && r.level > 0 ? ` · Lv ${r.level}` : ''}
                {statLabel ? ` · ${r.stat.toLocaleString('en-US')} ${(r.stat === 1 ? statLabel.replace(/s$/i, '') : statLabel).toLowerCase()}` : ''}
              </span>
            </span>
            <span className="cl-standings__score">{formatScore(r.score)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
