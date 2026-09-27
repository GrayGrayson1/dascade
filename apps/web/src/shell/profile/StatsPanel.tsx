/**
 * Profile → Stats: the player's DASCADE ratings (internal Elo, not FIDE; provisional flagged) and
 * per-game stats collected from finished games (wins/draws/losses, best score, podiums, tournament
 * games and game-specific extras).
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { GAME_CATALOG, isGameId } from '@dascade/shared';
import {
  STAT_GAME_DISPLAY,
  formatStatDuration,
  isDurationStat,
  statExtraLabel,
  type GameStatLine,
  type PlayerStatsResponse,
  type RatingLine,
} from '@dascade/shared/stats';
import { Badge, Button, IconButton, PixelIcon, Spinner } from '@dascade/ui';
import { useApp } from '../../app/store.ts';
import { fetchMyStats } from './api.ts';
import './profile.css';

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; data: PlayerStatsResponse };

const PROVISIONAL_GAMES = 10;

function ago(ms: number): string {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1);
}

export function StatsPanel() {
  const guestId = useApp((s) => s.profile.guestId);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setLoad((l) => (l.kind === 'ok' ? l : { kind: 'loading' }));
      try {
        setLoad({ kind: 'ok', data: await fetchMyStats(guestId, signal) });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setLoad({ kind: 'error' });
      }
    },
    [guestId],
  );
  useEffect(() => {
    const ctrl = new AbortController();
    void refresh(ctrl.signal);
    return () => ctrl.abort();
  }, [refresh]);

  if (load.kind === 'loading') {
    return (
      <div className="ps-state">
        <Spinner label="Loading your stats" />
      </div>
    );
  }
  if (load.kind === 'error') {
    return (
      <div className="ps-state" role="alert">
        <PixelIcon name="wifi-off" className="ps-state__icon" />
        <p>Couldn’t reach the arcade server for your stats.</p>
        <Button variant="secondary" icon="refresh" onClick={() => void refresh()}>
          Try again
        </Button>
      </div>
    );
  }
  const { data } = load;
  const games = data.games.filter((g) => isGameId(g.gameId));
  const ratings = data.ratings.filter((r) => isGameId(r.gameId));
  return (
    <div className="ps">
      <div className="ps-bar">
        <Badge color={data.identity === 'account' ? 'var(--green)' : 'var(--cyan)'} icon="user">
          {data.identity === 'account' ? 'Your account' : 'This browser'}
        </Badge>
        <span className="ps-bar__note">
          {data.identity === 'account' ? 'Stats follow your account.' : 'Guest stats live with this browser.'}
        </span>
        <IconButton icon="refresh" label="Refresh stats" size="sm" onClick={() => void refresh()} />
      </div>

      <section className="ps-section" aria-labelledby="ps-ratings">
        <h3 id="ps-ratings" className="ps-h">
          DASCADE ratings
        </h3>
        {ratings.length === 0 ? (
          <p className="dc-muted ps-empty">No rated games yet. Tournament matches (and rated rooms) of chess and checkers count.</p>
        ) : (
          <ul className="ps-ratings">
            {ratings.map((r) => (
              <RatingCard key={r.gameId} r={r} />
            ))}
          </ul>
        )}
        <p className="dc-field__hint">
          An internal DASCADE rating (Elo-style) — not a FIDE rating or any federation’s. It is provisional for your first{' '}
          {PROVISIONAL_GAMES} rated games and moves faster while it settles.
        </p>
      </section>

      <section className="ps-section" aria-labelledby="ps-games">
        <h3 id="ps-games" className="ps-h">
          Game stats
        </h3>
        {games.length === 0 ? (
          <div className="ps-state ps-state--inline">
            <PixelIcon name="star" className="ps-state__icon" />
            <p>No finished games on record yet.</p>
            <p className="dc-muted">Finish a game at any cabinet — your wins, best scores and highlights show up here.</p>
          </div>
        ) : (
          <ul className="ps-games">
            {games.map((g) => (
              <GameCard key={g.gameId} g={g} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RatingCard({ r }: { r: RatingLine }) {
  const game = GAME_CATALOG[r.gameId];
  return (
    <li className="ps-rating" style={{ '--g': game.accent.primary } as CSSProperties}>
      <span className="ps-rating__game">{game.title}</span>
      <span className="ps-rating__value dc-num" aria-label={`Rating ${r.rating}${r.provisional ? ', provisional' : ''}`}>
        {r.rating}
      </span>
      {r.provisional ? (
        <Badge color="var(--yellow)" title={`Settles after ${PROVISIONAL_GAMES} rated games`}>
          Provisional
        </Badge>
      ) : (
        <Badge color="var(--green)">Established</Badge>
      )}
      <span className="ps-rating__record">
        <span className="dc-num">{r.games}</span> rated · <span className="dc-num">{r.wins}</span>W{' '}
        <span className="dc-num">{r.draws}</span>D <span className="dc-num">{r.losses}</span>L
      </span>
    </li>
  );
}

function GameCard({ g }: { g: GameStatLine }) {
  const game = GAME_CATALOG[g.gameId];
  const display = STAT_GAME_DISPLAY[g.gameId] ?? {};
  // Co-op games share every result with the party, so a win/draw/loss record means nothing there.
  const decided = display.coop ? 0 : g.wins + g.losses + g.draws;
  const winRate = decided > 0 ? Math.round((g.wins / decided) * 100) : null;
  const extras = Object.entries(g.extras);
  return (
    <li className="ps-game" style={{ '--g': game.accent.primary } as CSSProperties}>
      <header className="ps-game__head">
        <span className="ps-game__title">{game.title}</span>
        <span className="ps-game__when">{ago(g.lastPlayedAt)}</span>
      </header>
      <dl className="ps-game__stats">
        <div>
          <dt>Played</dt>
          <dd className="dc-num">{g.games}</dd>
        </div>
        {decided > 0 ? (
          <>
            <div>
              <dt>Won</dt>
              <dd className="dc-num">{g.wins}</dd>
            </div>
            <div>
              <dt>Drawn</dt>
              <dd className="dc-num">{g.draws}</dd>
            </div>
            <div>
              <dt>Lost</dt>
              <dd className="dc-num">{g.losses}</dd>
            </div>
          </>
        ) : null}
        {winRate !== null ? (
          <div>
            <dt>Win rate</dt>
            <dd className="dc-num">{winRate}%</dd>
          </div>
        ) : null}
        {g.podiums > 0 ? (
          <div>
            <dt>Podiums</dt>
            <dd className="dc-num">{g.podiums}</dd>
          </div>
        ) : null}
        {g.bestScore !== null ? (
          <div>
            <dt>{display.scoreLabel ?? (g.lowerIsBetter ? 'Best (lowest)' : 'Best score')}</dt>
            <dd className="dc-num">{display.scoreFormat === 'ms' ? formatStatDuration(g.bestScore) : fmt(g.bestScore)}</dd>
          </div>
        ) : null}
        {g.tournamentGames > 0 ? (
          <div>
            <dt>Tournament games</dt>
            <dd className="dc-num">{g.tournamentGames}</dd>
          </div>
        ) : null}
        {extras.map(([k, v]) => (
          <div key={k}>
            <dt>{statExtraLabel(k)}</dt>
            <dd className="dc-num">{isDurationStat(k) ? formatStatDuration(v) : fmt(v)}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}
