/**
 * Battle HUD: whose turn it is (with the turn timer and round), the wind gauge, the
 * roster of tanks with live hit points, turn/round banners, shot callouts and the
 * victory banner. Hit points come from the presenter so they drop when the shell lands,
 * not when the server resolved it.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { TEAM_NAMES, WIND_MAX, type TanksPublicState, type TanksSettings, type TankView } from '@dascade/shared/games/tanks';
import { IconButton, PixelIcon, TimerRing, cx } from '@dascade/ui';
import { useCountdown, useRoomSelector, useSettings } from '../../../net/hooks.ts';
import { getStateSnapshot, useSessionStore } from '../../../net/session.ts';
import { useApp } from '../../../app/store.ts';
import { TEAM_TINT } from '../art/themes.ts';
import { tankSfx } from '../audio.ts';
import { useTanks } from '../context.ts';

type TurnInfo = {
  stage: string;
  activeId: string;
  name: string;
  color: string;
  team: number;
  cpu: boolean;
  turnEndsAt: number;
  round: number;
  maxRounds: number;
  turnId: number;
};

function useTurn(): TurnInfo | null {
  return useRoomSelector((s: TanksPublicState) => {
    const b = s.battle;
    if (!b) return null;
    const t = s.tanks?.[b.activeId];
    return {
      stage: b.stage,
      activeId: b.activeId,
      name: t?.name ?? '',
      color: t?.color ?? '#ffffff',
      team: t?.team ?? -1,
      cpu: t?.cpu ?? false,
      turnEndsAt: b.turnEndsAt,
      round: s.round,
      maxRounds: b.maxRounds,
      turnId: b.turnId,
    };
  });
}

export function Hud() {
  return (
    <div className="tk-hud">
      <TurnCard />
      <WindGauge />
      <Roster />
      <TurnBanner />
      <ShotCallout />
      <VictoryBanner />
    </div>
  );
}

function TurnCard() {
  const turn = useTurn();
  const me = useSessionStore((s) => s.playerId);
  const settings = useSettings<TanksSettings>();
  const remaining = useCountdown(turn?.turnEndsAt || 0);
  const { presenter } = useTanks();
  const ui = useSyncExternalStore(presenter.subscribeUi, presenter.getUi, presenter.getUi);
  if (!turn) return null;
  const mine = turn.activeId === me && Boolean(me);
  const total = (settings?.turnSeconds ?? 30) * 1000;
  const flying = turn.stage === 'resolving' || ui.playing;
  const status = turn.stage === 'over'
    ? 'Battle over'
    : flying
      ? 'Shot in flight…'
      : turn.stage === 'aim'
        ? mine
          ? 'Aim, set power, fire!'
          : turn.cpu
            ? 'CPU gunner is aiming…'
            : 'Aiming…'
        : 'Next turn…';
  return (
    <section className={cx('tk-turn tk-glass', mine && 'is-mine')} aria-label="Turn" style={{ '--tank': turn.color } as CSSProperties}>
      <span className="tk-turn__chip" aria-hidden />
      <div className="tk-turn__text">
        <span className="tk-turn__who" aria-live="polite">
          {turn.stage === 'over' ? 'Game over' : !turn.activeId ? 'Get ready' : mine ? 'Your turn' : `${turn.name}${turn.cpu ? ' (CPU)' : ''}`}
        </span>
        <span className="tk-turn__status">{status}</span>
        <span className="tk-turn__round">
          Round <b>{Math.max(1, turn.round)}</b>/{turn.maxRounds}
          {turn.team >= 0 && turn.activeId ? (
            <em style={{ color: TEAM_TINT[turn.team] }}> · Team {TEAM_NAMES[turn.team]}</em>
          ) : null}
        </span>
      </div>
      {turn.stage === 'aim' && turn.turnEndsAt ? (
        <TimerRing seconds={remaining / 1000} progress={remaining / total} urgentAt={5} size={46} label="Turn time" />
      ) : null}
    </section>
  );
}

export function WindGauge() {
  const wind = useRoomSelector((s: TanksPublicState) => s.battle?.wind ?? 0) ?? 0;
  const settings = useSettings<TanksSettings>();
  const max = Math.max(1, WIND_MAX[settings?.wind ?? 'normal'] || 15);
  const abs = Math.abs(wind);
  const dir = wind > 0 ? 'right' : wind < 0 ? 'left' : 'none';
  const k = abs / 15;
  const level = abs === 0 ? 'calm' : k < 0.34 ? 'light' : k < 0.67 ? 'fresh' : 'strong';
  const label = abs === 0 ? 'Wind: calm' : `Wind: ${abs} to the ${dir}${level === 'strong' ? ' (strong)' : ''}`;
  const segs = Math.max(5, max);
  return (
    <div className="tk-wind tk-glass" role="img" aria-label={label} data-level={level} data-dir={dir}>
      <span className="tk-wind__label">
        <PixelIcon name="flag" size={12} /> WIND
      </span>
      <div className="tk-wind__meter" aria-hidden>
        <div className="tk-wind__half tk-wind__half--left">
          {Array.from({ length: segs }, (_, i) => (
            <i key={i} data-on={wind < 0 && segs - 1 - i < abs ? 'true' : undefined} />
          ))}
        </div>
        <span className="tk-wind__hub" />
        <div className="tk-wind__half">
          {Array.from({ length: segs }, (_, i) => (
            <i key={i} data-on={wind > 0 && i < abs ? 'true' : undefined} />
          ))}
        </div>
      </div>
      <span className="tk-wind__value" aria-hidden>
        {wind < 0 ? <PixelIcon name="arrow-left" size={14} /> : null}
        <b>{abs === 0 ? 'CALM' : abs}</b>
        {wind > 0 ? <PixelIcon name="arrow-right" size={14} /> : null}
      </span>
    </div>
  );
}

function Roster() {
  const me = useSessionStore((s) => s.playerId);
  const { presenter } = useTanks();
  const ui = useSyncExternalStore(presenter.subscribeUi, presenter.getUi, presenter.getUi);
  const key = useRoomSelector((s: TanksPublicState) =>
    Object.values(s.tanks ?? {})
      .map((t) => `${t.id}:${t.slot}:${t.name}:${t.color}:${t.team}:${t.cpu ? 1 : 0}:${t.gone ? 1 : 0}:${t.maxHp}:${t.hp}:${t.alive ? 1 : 0}`)
      .join('|'),
  );
  const activeId = useRoomSelector((s: TanksPublicState) => s.battle?.activeId ?? '');
  const compactDefault = typeof window !== 'undefined' && (window.innerHeight < 560 || window.innerWidth < 700);
  const [open, setOpen] = useState(!compactDefault);
  const rows = useMemo(() => {
    const s = getStateSnapshot<TanksPublicState>();
    if (!s || !key) return [] as TankView[];
    return Object.values(s.tanks ?? {}).sort((a, b) => (a.team - b.team) * 100 + (a.slot - b.slot));
  }, [key]);
  if (rows.length === 0) return null;
  const aliveCount = rows.filter((t) => ui.alive[t.id] ?? t.alive).length;
  return (
    <section className={cx('tk-roster tk-glass', !open && 'is-collapsed')} aria-label="Tanks">
      <button type="button" className="tk-roster__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <PixelIcon name="users" size={14} /> Tanks <b>{aliveCount}</b>/{rows.length}
        <PixelIcon name={open ? 'chevron-up' : 'chevron-down'} size={12} />
      </button>
      {open ? (
        <ol className="tk-roster__list">
          {rows.map((t) => {
            const hp = ui.hp[t.id] ?? t.hp;
            const alive = ui.alive[t.id] ?? t.alive;
            const k = Math.max(0, Math.min(1, hp / Math.max(1, t.maxHp)));
            return (
              <li key={t.id} className={cx('tk-roster__row', t.id === me && 'is-me', !alive && 'is-out', t.id === activeId && 'is-active')}>
                <span className="tk-roster__chip" style={{ background: t.color }} aria-hidden>
                  {t.team >= 0 ? TEAM_NAMES[t.team]?.[0] : ''}
                </span>
                <span className="tk-roster__name">
                  {t.id === activeId ? <PixelIcon name="play" size={10} className="tk-roster__turn" /> : null}
                  <span className="tk-roster__label">{t.name}</span>
                  {t.id === me ? <small>(you)</small> : null}
                  {t.cpu ? <small className="tk-cpu">CPU</small> : null}
                </span>
                <span className="tk-roster__hp" aria-label={alive ? `${hp} of ${t.maxHp} armor` : t.gone ? 'left the battle' : 'destroyed'}>
                  {alive ? (
                    <>
                      <span className="tk-hpbar" data-level={k > 0.5 ? 'ok' : k > 0.25 ? 'warn' : 'low'}>
                        <i style={{ width: `${k * 100}%` }} />
                      </span>
                      <b>{hp}</b>
                    </>
                  ) : (
                    <em>{t.gone ? 'LEFT' : 'K.O.'}</em>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}

function TurnBanner() {
  const turn = useTurn();
  const me = useSessionStore((s) => s.playerId);
  const reduced = useApp((s) => s.settings.reducedMotion);
  const [banner, setBanner] = useState<{ key: number; text: string; sub: string; mine: boolean; color: string } | null>(null);
  const lastTurn = useRef(-1);
  useEffect(() => {
    if (!turn || turn.stage !== 'aim' || !turn.activeId || turn.turnId === lastTurn.current) return;
    lastTurn.current = turn.turnId;
    const mine = turn.activeId === me;
    if (mine) tankSfx.yourTurn();
    setBanner({
      key: turn.turnId,
      text: mine ? 'YOUR TURN' : `${turn.name.toUpperCase()}${turn.cpu ? ' · CPU' : ''}`,
      sub: `Round ${turn.round} of ${turn.maxRounds}`,
      mine,
      color: turn.color,
    });
    const id = setTimeout(() => setBanner(null), mine ? 1500 : 1100);
    return () => clearTimeout(id);
  }, [turn, me]);
  if (!banner) return null;
  return (
    <div className={cx('tk-banner', banner.mine && 'is-mine', reduced && 'is-still')} key={banner.key} role="status" style={{ '--tank': banner.color } as CSSProperties}>
      <span className="tk-banner__text">{banner.text}</span>
      <span className="tk-banner__sub">{banner.sub}</span>
    </div>
  );
}

function ShotCallout() {
  const { presenter } = useTanks();
  const ui = useSyncExternalStore(presenter.subscribeUi, presenter.getUi, presenter.getUi);
  const [shown, setShown] = useState<{ seq: number; text: string; tone: 'hit' | 'miss' | 'ko' } | null>(null);
  const last = ui.lastShot;
  useEffect(() => {
    if (!last) return;
    const s = getStateSnapshot<TanksPublicState>();
    const shooter = s?.tanks?.[last.shooterId];
    const name = shooter?.name ?? 'Someone';
    const kos = last.kills.map((id) => s?.tanks?.[id]?.name ?? '').filter(Boolean);
    const text = kos.length
      ? `${name} destroyed ${kos.join(' & ')}!`
      : last.damage > 0
        ? `${name} dealt ${last.damage} damage`
        : `${name} missed`;
    setShown({ seq: last.seq, text, tone: kos.length ? 'ko' : last.damage > 0 ? 'hit' : 'miss' });
    const id = setTimeout(() => setShown(null), 2600);
    return () => clearTimeout(id);
  }, [last]);
  if (!shown) return null;
  return (
    <div className="tk-callout tk-glass" data-tone={shown.tone} role="status" key={shown.seq}>
      <PixelIcon name={shown.tone === 'ko' ? 'warning' : shown.tone === 'hit' ? 'bolt' : 'info'} size={14} /> {shown.text}
    </div>
  );
}

function VictoryBanner() {
  const me = useSessionStore((s) => s.playerId);
  const v = useRoomSelector((s: TanksPublicState) => ({
    stage: s.battle?.stage ?? '',
    winners: s.battle?.winners ?? '',
    team: s.battle?.winnerTeam ?? -1,
    reason: s.battle?.reason ?? '',
    phase: s.phase,
  }));
  if (!v || v.stage !== 'over' || v.phase !== 'PLAYING') return null;
  const s = getStateSnapshot<TanksPublicState>();
  const ids = v.winners.split(',').filter(Boolean);
  const iWon = Boolean(me && ids.includes(me));
  const names = ids.map((id) => s?.tanks?.[id]?.name ?? '').filter(Boolean);
  const title =
    v.reason === 'draw' ? 'DRAW' : v.team >= 0 ? `TEAM ${TEAM_NAMES[v.team]?.toUpperCase()} WINS` : iWon ? 'VICTORY' : `${(names[0] ?? 'WINNER').toUpperCase()} WINS`;
  const sub =
    v.reason === 'round_limit'
      ? 'Round limit — most armor left'
      : v.reason === 'forfeit'
        ? 'The other side abandoned the field'
        : v.reason === 'draw'
          ? 'Mutual destruction'
          : 'Last one standing';
  return (
    <div className={cx('tk-victory', iWon && 'is-mine')} role="status" style={{ '--tank': v.team >= 0 ? TEAM_TINT[v.team] : undefined } as CSSProperties}>
      <PixelIcon name="trophy" size={34} />
      <span className="tk-victory__title">{title}</span>
      <span className="tk-victory__sub">{sub}</span>
    </div>
  );
}

export function OverviewToggle() {
  const { overview, setOverview } = useTanks();
  return (
    <IconButton
      icon="maximize"
      label={overview ? 'Follow the action' : 'Show the whole battlefield'}
      aria-pressed={overview}
      variant="secondary"
      size="sm"
      className="tk-overview"
      onClick={() => setOverview(!overview)}
    />
  );
}
