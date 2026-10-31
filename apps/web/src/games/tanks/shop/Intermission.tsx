/**
 * Between-turns splashes: the "BATTLE 2 OF 5" intro over the fresh battlefield (terrain,
 * walls, gravity, wind) and the battle-over card (who won the battle and what every crew
 * earned for it). The match-over banner lives in the HUD.
 */
import { useMemo, type CSSProperties } from 'react';
import { GRAVITY_LABEL, TEAM_NAMES, TERRAIN_LABEL, WALL_LABEL, type FleetView, type TanksPublicState } from '@dascade/shared/games/tanks';
import { PixelIcon, cx } from '@dascade/ui';
import { useRoomSelector } from '../../../net/hooks.ts';
import { getStateSnapshot, useSessionStore } from '../../../net/session.ts';
import { useApp } from '../../../app/store.ts';
import { TEAM_TINT } from '../art/themes.ts';
import { formatCredits, formatDelta, sortStandings } from './helpers.ts';

const WALL_HINT: Record<string, string> = {
  open: 'Shells that leave the field are lost',
  wrap: 'Shells fly off one side and in the other',
  bounce: 'Shells bounce off the edges',
  concrete: 'Shells burst on the edges',
};

export function Intermission() {
  const stage = useRoomSelector((s: TanksPublicState) => s.battle?.stage ?? '');
  if (stage === 'intro') return <IntroSplash />;
  if (stage === 'battle_over') return <BattleOverSplash />;
  return null;
}

function IntroSplash() {
  const reduced = useApp((s) => s.settings.reducedMotion);
  const b = useRoomSelector((s: TanksPublicState) => ({
    battleNo: s.battle?.battleNo ?? 1,
    battles: s.battle?.battles ?? 1,
    style: s.battle?.style ?? 'hills',
    walls: s.battle?.walls ?? 'open',
    gravity: s.battle?.gravity ?? 'normal',
    wind: s.battle?.wind ?? 0,
    volley: s.battle?.turnMode === 'volley',
    serial: s.battle?.battleSerial ?? 0,
  }));
  if (!b) return null;
  const last = b.battles > 1 && b.battleNo === b.battles;
  return (
    <div className={cx('tk-intro', reduced && 'is-still')} data-part="intro" role="status" aria-live="polite" key={b.serial}>
      <span className="tk-intro__kicker">
        {last ? 'Final battle' : b.battles > 1 ? `Battle ${b.battleNo} of ${b.battles}` : 'One battle'}
      </span>
      <span className="tk-intro__title">{b.battles > 1 ? `BATTLE ${b.battleNo}` : 'BATTLE'}</span>
      <span className="tk-intro__chips">
        <span className="tk-chip">
          <PixelIcon name="flag" size={11} /> {TERRAIN_LABEL[b.style]}
        </span>
        <span className="tk-chip" title={WALL_HINT[b.walls]}>
          {WALL_LABEL[b.walls]} walls
        </span>
        <span className="tk-chip">{GRAVITY_LABEL[b.gravity]} gravity</span>
        {b.volley ? <span className="tk-chip tk-chip--hot">Volley: everyone fires at once</span> : null}
      </span>
      <span className="tk-intro__hint">{WALL_HINT[b.walls]}</span>
    </div>
  );
}

function BattleOverSplash() {
  const me = useSessionStore((s) => s.playerId);
  const reduced = useApp((s) => s.settings.reducedMotion);
  const v = useRoomSelector((s: TanksPublicState) => ({
    battleNo: s.battle?.battleNo ?? 1,
    battles: s.battle?.battles ?? 1,
    winners: s.battle?.winners ?? '',
    team: s.battle?.winnerTeam ?? -1,
    reason: s.battle?.reason ?? '',
    economy: s.battle?.economy ?? 'shop',
    fleetKey: Object.values(s.fleet ?? {})
      .map((f) => `${f.id}:${f.earned}:${f.battleScore}:${f.score}:${f.gone ? 1 : 0}`)
      .join('|'),
  }));
  const rows = useMemo(() => {
    const s = getStateSnapshot<TanksPublicState>();
    return sortStandings(Object.values(s?.fleet ?? {}).filter((f) => !f.gone)) as FleetView[];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed when the fleet key changes
  }, [v?.fleetKey]);
  if (!v) return null;
  const s = getStateSnapshot<TanksPublicState>();
  const ids = v.winners.split(',').filter(Boolean);
  const names = ids.map((id) => s?.fleet?.[id]?.name ?? s?.tanks?.[id]?.name ?? '').filter(Boolean);
  const iWon = Boolean(me && ids.includes(me));
  const title =
    v.reason === 'draw' || ids.length === 0
      ? 'Draw!'
      : v.team >= 0
        ? `Team ${TEAM_NAMES[v.team]} takes it`
        : iWon
          ? 'You win the battle!'
          : `${names.join(' & ')} win${names.length === 1 ? 's' : ''}`;
  const sub =
    v.reason === 'round_limit'
      ? 'Round limit — most armor left'
      : v.reason === 'forfeit'
        ? 'The other side abandoned the field'
        : v.reason === 'draw'
          ? 'Mutual destruction'
          : 'Last one standing';
  const more = v.battleNo < v.battles;
  return (
    <div className="tk-over-wrap" role="status" aria-live="polite">
      <section
        className={cx('tk-over tk-glass', iWon && 'is-mine', reduced && 'is-still')}
        data-part="battle-over"
        aria-labelledby="tk-over-title"
        style={{ '--win': v.team >= 0 ? TEAM_TINT[v.team] : 'var(--accent-2)' } as CSSProperties}
      >
        <header className="tk-over__head">
          <span className="tk-over__kicker">
            Battle {v.battleNo}
            {v.battles > 1 ? ` of ${v.battles}` : ''} over
          </span>
          <h2 id="tk-over-title" className="tk-over__title">
            <PixelIcon name={v.reason === 'draw' ? 'flag' : 'trophy'} size={22} /> {title}
          </h2>
          <span className="tk-over__sub">{sub}</span>
        </header>
        <ol className="tk-over__list">
          {rows.map((f) => (
            <li key={f.id} className={cx('tk-over__row', f.id === me && 'is-me', ids.includes(f.id) && 'is-winner')}>
              <span className="tk-board__chip" style={{ background: f.color }} aria-hidden />
              <span className="tk-over__name">{f.name}</span>
              <span className="tk-over__pts tk-num" aria-label={`${f.battleScore} points this battle`}>
                {formatDelta(f.battleScore)} pts
              </span>
              {v.economy === 'shop' ? (
                <span className="tk-over__cr tk-num" aria-label={`${formatCredits(f.earned)} credits earned`}>
                  {formatDelta(f.earned)} ¢
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        <p className="tk-over__next">
          {more ? (v.economy === 'shop' ? 'To the armory…' : `Battle ${v.battleNo + 1} next…`) : 'Final scores coming up…'}
        </p>
      </section>
    </div>
  );
}
