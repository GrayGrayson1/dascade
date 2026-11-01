/** Match report: winner banner, final standings (score, battle wins, KOs, damage), rematch. */
import { useEffect, type CSSProperties } from 'react';
import { ordinal } from '@dascade/shared';
import {
  PERSONA_INFO,
  TANKS_MSG,
  TEAM_NAMES,
  type FleetView,
  type TankView,
  type TanksPublicState,
  type TanksSettings,
} from '@dascade/shared/games/tanks';
import { Badge, Button, PixelIcon, cx } from '@dascade/ui';
import { useGame } from '../../net/hooks.ts';
import { session } from '../../net/session.ts';
import { sfx } from '../../audio/audio.ts';
import { ResultsActions } from '../../shell/common.tsx';
import { TEAM_TINT } from './art/themes.ts';
import { rankPlaces, sortStandings, teamScores } from './shop/helpers.ts';

const REASONS: Record<string, string> = {
  last_standing: 'Last tank standing',
  team_win: 'The other team was wiped out',
  draw: 'Dead even — nobody pulled ahead',
  round_limit: 'Round limit reached — most armor left wins',
  forfeit: 'The other side abandoned the battlefield',
  points: 'Most points across the match',
};

type Row = Pick<FleetView, 'id' | 'name' | 'color' | 'team' | 'cpu' | 'persona' | 'score' | 'wins' | 'kills' | 'damage' | 'place' | 'gone'>;

/** Standings rows: the match fleet, or — for an older single-battle state — the tanks. */
function standingsRows(state: TanksPublicState): Row[] {
  const fleet = Object.values(state.fleet ?? {});
  if (fleet.length) return fleet;
  return Object.values(state.tanks ?? {}).map((t: TankView) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    team: t.team,
    cpu: t.cpu,
    persona: '' as const,
    score: t.damage,
    wins: t.place === 1 ? 1 : 0,
    kills: t.kills,
    damage: t.damage,
    place: t.place,
    gone: t.gone,
  }));
}

export function Results() {
  const game = useGame<TanksPublicState, TanksSettings>();
  const me = game?.playerId ?? null;
  const winners = (game?.state.battle?.winners ?? '').split(',').filter(Boolean);
  const iWon = Boolean(me && winners.includes(me));
  const inMatch = Boolean(me && (game?.state.fleet?.[me] || game?.state.tanks?.[me]));
  useEffect(() => {
    if (!inMatch) return;
    sfx(iWon ? 'bigwin' : 'lose');
  }, [iWon, inMatch]);
  if (!game) return null;
  const { state, isHost } = game;
  const b = state.battle;
  const rows = sortStandings(standingsRows(state));
  const places = rankPlaces(rows);
  const team = b?.winnerTeam ?? -1;
  const teams = b?.mode === 'teams';
  const totals = teams ? teamScores(rows) : null;
  const battles = b?.battles ?? 1;
  const title =
    b?.reason === 'draw'
      ? 'Draw'
      : team >= 0
        ? `Team ${TEAM_NAMES[team]} wins`
        : iWon
          ? 'Victory!'
          : `${rows.find((r) => winners.includes(r.id))?.name ?? rows[0]?.name ?? 'Winner'} wins`;
  const subtitle = REASONS[b?.reason ?? ''] ?? '';
  // A rematch needs two tanks: players still seated here plus the CPU tanks from the settings.
  const cpuTanks = Math.max(game.settings.cpu ?? 0, state.locked && state.maxPlayers === 1 ? 1 : 0);
  const canRematch = isHost && game.seated.length + cpuTanks >= 2;
  return (
    <div className="tk-results">
      <section className="tk-results__card tk-glass" data-part="results" aria-labelledby="tk-results-title">
        <header className="tk-results__head" style={{ '--win': team >= 0 ? TEAM_TINT[team] : 'var(--accent-2)' } as CSSProperties}>
          <PixelIcon name={b?.reason === 'draw' ? 'flag' : 'trophy'} size={40} className="tk-results__icon" />
          <h1 id="tk-results-title" className="tk-results__title">
            {title}
          </h1>
          <p className="tk-results__sub">
            {subtitle}
            {battles > 1 ? ` · ${battles} battles` : state.round ? ` · ${state.round} round${state.round === 1 ? '' : 's'}` : ''}
          </p>
          {totals ? (
            <div className="tk-teamscore tk-teamscore--big">
              {[0, 1].map((t) => (
                <span key={t} style={{ '--team': TEAM_TINT[t] } as CSSProperties}>
                  {TEAM_NAMES[t]} <b className="tk-num">{totals[t]}</b>
                </span>
              ))}
            </div>
          ) : null}
        </header>
        <table className="tk-standings" data-part="standings">
          <caption className="visually-hidden">Final standings</caption>
          <thead>
            <tr>
              <th scope="col">Place</th>
              <th scope="col">Crew</th>
              <th scope="col">Score</th>
              <th scope="col">Wins</th>
              <th scope="col">KOs</th>
              <th scope="col">Damage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => {
              const place = places[i] ?? i + 1;
              const persona = t.persona ? PERSONA_INFO[t.persona]?.label : '';
              return (
                <tr key={t.id} className={cx(t.id === me && 'is-me', winners.includes(t.id) && 'is-winner')}>
                  <td className="tk-standings__place" data-place={place}>
                    {place === 1 ? <PixelIcon name="crown" size={14} /> : null}
                    {ordinal(place)}
                  </td>
                  <td className="tk-standings__tank">
                    <span className="tk-standings__chip" style={{ background: t.color }} aria-hidden />
                    <span className="tk-standings__name">{t.name}</span>
                    {t.id === me ? <Badge color="var(--accent-2)">you</Badge> : null}
                    {t.cpu ? <Badge>{persona || 'CPU'}</Badge> : null}
                    {t.team >= 0 ? <Badge color={TEAM_TINT[t.team]}>{TEAM_NAMES[t.team]}</Badge> : null}
                    {t.gone ? <Badge color="var(--text-3)">left</Badge> : null}
                  </td>
                  <td className="tk-num tk-standings__score">{t.score}</td>
                  <td className="tk-num">{t.wins}</td>
                  <td className="tk-num">{t.kills}</td>
                  <td className="tk-num">{t.damage}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <footer className="tk-results__actions">
          <ResultsActions
            extra={
              canRematch ? (
                <Button variant="gold" size="lg" icon="play" onClick={() => session.send(TANKS_MSG.rematch, {})}>
                  Rematch
                </Button>
              ) : null
            }
          />
        </footer>
      </section>
    </div>
  );
}
