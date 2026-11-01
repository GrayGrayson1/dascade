/**
 * Battle HUD: whose turn it is — or the shared volley window — with the timer, battle and
 * round; the wind gauge; my credits; the roster (armor, shields, lock-ins, buried tanks,
 * CPU personalities, match score); turn and volley banners, shot callouts and the match
 * victory banner. Hit points and shields come from the presenter so they drop when the
 * shell lands, not when the server resolved it.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { PERSONA_INFO, TEAM_NAMES, WIND_MAX, type TanksPublicState, type TanksSettings, type TankView } from '@dascade/shared/games/tanks';
import { IconButton, PixelIcon, TimerRing, cx } from '@dascade/ui';
import { useCountdown, useRoomSelector, useSettings } from '../../../net/hooks.ts';
import { getStateSnapshot, useSessionStore } from '../../../net/session.ts';
import { useApp } from '../../../app/store.ts';
import { TEAM_TINT } from '../art/themes.ts';
import { tankSfx } from '../audio.ts';
import { useTanks } from '../context.ts';
import { formatCredits, monogram } from '../shop/helpers.ts';
import { describeScript, useBattleUi } from './battleUi.ts';

type TurnInfo = {
  stage: string;
  volley: boolean;
  activeId: string;
  name: string;
  color: string;
  team: number;
  cpu: boolean;
  turnEndsAt: number;
  round: number;
  maxRounds: number;
  turnId: number;
  battleNo: number;
  battles: number;
  locked: number;
  alive: number;
};

function useTurn(): TurnInfo | null {
  return useRoomSelector((s: TanksPublicState) => {
    const b = s.battle;
    if (!b) return null;
    const t = s.tanks?.[b.activeId];
    let locked = 0;
    let alive = 0;
    for (const tk of Object.values(s.tanks ?? {})) {
      if (!tk.alive || tk.gone) continue;
      alive++;
      if (tk.locked) locked++;
    }
    return {
      stage: b.stage,
      volley: b.turnMode === 'volley',
      activeId: b.activeId,
      name: t?.name ?? '',
      color: t?.color ?? '#ffffff',
      team: t?.team ?? -1,
      cpu: t?.cpu ?? false,
      turnEndsAt: b.turnEndsAt,
      round: s.round,
      maxRounds: b.maxRounds,
      turnId: b.turnId,
      battleNo: b.battleNo ?? 1,
      battles: b.battles ?? 1,
      locked,
      alive,
    };
  });
}

/** The HUD is for fighting: hidden while the shop is open. */
const FIGHT_STAGES = new Set(['intro', 'aim', 'resolving', 'idle', 'battle_over', 'over']);

export function Hud() {
  const stage = useRoomSelector((s: TanksPublicState) => s.battle?.stage ?? 'idle');
  if (stage && !FIGHT_STAGES.has(stage)) return null;
  return (
    <div className="tk-hud" data-part="hud">
      <TurnCard />
      <WindGauge />
      <CreditsChip />
      <Roster />
      <TurnBanner />
      <ShotCallout />
      <VictoryBanner />
    </div>
  );
}

function BattleLine({ turn }: { turn: TurnInfo }) {
  return (
    <span className="tk-turn__round">
      {turn.battles > 1 ? (
        <>
          Battle <b>{turn.battleNo}</b>/{turn.battles} ·{' '}
        </>
      ) : null}
      Round <b>{Math.max(1, turn.round)}</b>/{turn.maxRounds}
      {!turn.volley && turn.team >= 0 && turn.activeId ? (
        <em style={{ color: TEAM_TINT[turn.team] }}> · Team {TEAM_NAMES[turn.team]}</em>
      ) : null}
    </span>
  );
}

function TurnCard() {
  const turn = useTurn();
  const me = useSessionStore((s) => s.playerId);
  const settings = useSettings<TanksSettings>();
  const remaining = useCountdown(turn?.turnEndsAt || 0);
  const ui = useBattleUi();
  const myLocked = useRoomSelector((s: TanksPublicState) => Boolean(me && s.tanks?.[me]?.locked));
  const myAlive = useRoomSelector((s: TanksPublicState) => Boolean(me && s.tanks?.[me]?.alive));
  if (!turn) return null;
  const total = (settings?.turnSeconds ?? 30) * 1000;
  const flying = turn.stage === 'resolving' || ui.playing;
  const timer =
    turn.stage === 'aim' && turn.turnEndsAt ? (
      <TimerRing
        seconds={remaining / 1000}
        progress={remaining / total}
        urgentAt={5}
        size={46}
        label={turn.volley ? 'Volley time' : 'Turn time'}
      />
    ) : null;

  if (turn.volley) {
    const status =
      turn.stage === 'over'
        ? 'Match over'
        : turn.stage === 'battle_over'
          ? 'Battle over'
          : turn.stage === 'intro'
            ? 'Get ready…'
            : flying
              ? 'Shells in the air…'
              : turn.stage === 'aim'
                ? myAlive && !myLocked
                  ? 'Aim, then lock in!'
                  : `${turn.locked} of ${turn.alive} locked in`
                : 'Next volley…';
    const mine = turn.stage === 'aim' && myAlive && !myLocked;
    return (
      <section className={cx('tk-turn tk-turn--volley tk-glass', mine && 'is-mine')} aria-label="Volley" data-part="turn">
        <span className="tk-turn__chip" aria-hidden />
        <div className="tk-turn__text">
          <span className="tk-turn__who" aria-live="polite">
            {turn.stage === 'over'
              ? 'Game over'
              : turn.stage === 'aim'
                ? mine
                  ? 'Everyone aim'
                  : myLocked
                    ? 'Locked in'
                    : 'Volley'
                : 'Volley'}
          </span>
          <span className="tk-turn__status">{status}</span>
          {turn.stage === 'aim' ? (
            <span className="tk-locks" aria-label={`${turn.locked} of ${turn.alive} tanks locked in`}>
              {Array.from({ length: turn.alive }, (_, i) => (
                <i key={i} data-on={i < turn.locked ? 'true' : undefined} />
              ))}
            </span>
          ) : null}
          <BattleLine turn={turn} />
        </div>
        {timer}
      </section>
    );
  }

  const mine = turn.activeId === me && Boolean(me);
  const status =
    turn.stage === 'over'
      ? 'Match over'
      : turn.stage === 'battle_over'
        ? 'Battle over'
        : turn.stage === 'intro'
          ? 'Get ready…'
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
    <section
      className={cx('tk-turn tk-glass', mine && 'is-mine')}
      aria-label="Turn"
      data-part="turn"
      style={{ '--tank': turn.color } as CSSProperties}
    >
      <span className="tk-turn__chip" aria-hidden />
      <div className="tk-turn__text">
        <span className="tk-turn__who" aria-live="polite">
          {turn.stage === 'over'
            ? 'Game over'
            : !turn.activeId
              ? 'Get ready'
              : mine
                ? 'Your turn'
                : `${turn.name}${turn.cpu ? ' (CPU)' : ''}`}
        </span>
        <span className="tk-turn__status">{status}</span>
        <BattleLine turn={turn} />
      </div>
      {timer}
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
    <div className="tk-wind tk-glass" data-part="wind" role="img" aria-label={label} data-level={level} data-dir={dir}>
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

function CreditsChip() {
  const me = useSessionStore((s) => s.playerId);
  const info = useRoomSelector((s: TanksPublicState) => ({
    economy: s.battle?.economy ?? 'shop',
    credits: me ? (s.fleet?.[me]?.credits ?? -1) : -1,
    score: me ? (s.fleet?.[me]?.score ?? -1) : -1,
  }));
  if (!info || info.economy !== 'shop' || info.credits < 0) return null;
  return (
    <div
      className="tk-credits tk-glass"
      data-part="credits"
      aria-label={`Your credits: ${formatCredits(info.credits)}. Score: ${info.score}`}
    >
      <span className="tk-credits__coin" aria-hidden>
        ¢
      </span>
      <b>{formatCredits(info.credits)}</b>
      <small aria-hidden>{info.score} pts</small>
    </div>
  );
}

function Roster() {
  const me = useSessionStore((s) => s.playerId);
  const ui = useBattleUi();
  const key = useRoomSelector((s: TanksPublicState) =>
    Object.values(s.tanks ?? {})
      .map(
        (t) =>
          `${t.id}:${t.slot}:${t.name}:${t.color}:${t.team}:${t.cpu ? 1 : 0}:${t.gone ? 1 : 0}:${t.maxHp}:${t.hp}:${t.alive ? 1 : 0}:${t.shield}:${t.shieldMax}:${t.locked ? 1 : 0}:${t.buried > 0 ? 1 : 0}:${s.fleet?.[t.id]?.score ?? 0}:${s.fleet?.[t.id]?.persona ?? ''}`,
      )
      .join('|'),
  );
  const activeId = useRoomSelector((s: TanksPublicState) => s.battle?.activeId ?? '');
  const volley = useRoomSelector((s: TanksPublicState) => s.battle?.turnMode === 'volley' && s.battle?.stage === 'aim');
  const compactDefault = typeof window !== 'undefined' && (window.innerHeight < 560 || window.innerWidth < 700);
  const [open, setOpen] = useState(!compactDefault);
  const rows = useMemo(() => {
    const s = getStateSnapshot<TanksPublicState>();
    if (!s || !key) return [] as Array<TankView & { score: number; persona: string }>;
    return Object.values(s.tanks ?? {})
      .map((t) => ({ ...t, score: s.fleet?.[t.id]?.score ?? 0, persona: s.fleet?.[t.id]?.persona ?? '' }))
      .sort((a, b) => (a.team - b.team) * 100 + (a.slot - b.slot));
  }, [key]);
  if (rows.length === 0) return null;
  const aliveCount = rows.filter((t) => ui.alive[t.id] ?? t.alive).length;
  return (
    <section className={cx('tk-roster tk-glass', !open && 'is-collapsed')} aria-label="Tanks" data-part="scoreboard">
      <button type="button" className="tk-roster__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <PixelIcon name="users" size={14} /> Tanks <b>{aliveCount}</b>/{rows.length}
        <PixelIcon name={open ? 'chevron-up' : 'chevron-down'} size={12} />
      </button>
      {open ? (
        <ol className="tk-roster__list">
          {rows.map((t) => {
            const hp = ui.hp[t.id] ?? t.hp;
            const alive = ui.alive[t.id] ?? t.alive;
            const shield = ui.shield[t.id] ?? t.shield;
            const k = Math.max(0, Math.min(1, hp / Math.max(1, t.maxHp)));
            const sk = t.shieldMax > 0 ? Math.max(0, Math.min(1, shield / t.shieldMax)) : 0;
            const persona = t.persona ? PERSONA_INFO[t.persona as keyof typeof PERSONA_INFO]?.label : '';
            const armorLabel = alive
              ? `${hp} of ${t.maxHp} armor${shield > 0 ? `, shield ${shield}` : ''}${t.buried > 0 ? ', buried' : ''}${volley && t.locked ? ', locked in' : ''}`
              : t.gone
                ? 'left the battle'
                : 'destroyed';
            return (
              <li key={t.id} className={cx('tk-roster__row', t.id === me && 'is-me', !alive && 'is-out', t.id === activeId && 'is-active')}>
                <span className="tk-roster__chip" style={{ background: t.color }} aria-hidden>
                  {t.team >= 0 ? TEAM_NAMES[t.team]?.[0] : monogram(t.name)[0]}
                </span>
                <span className="tk-roster__name">
                  {t.id === activeId ? <PixelIcon name="play" size={10} className="tk-roster__turn" /> : null}
                  <span className="tk-roster__label">{t.name}</span>
                  {t.id === me ? <small>(you)</small> : null}
                  {t.cpu ? (
                    <small className="tk-cpu" title={persona ? PERSONA_INFO[t.persona as keyof typeof PERSONA_INFO]?.blurb : undefined}>
                      {persona || 'CPU'}
                    </small>
                  ) : null}
                  {alive && t.buried > 0 ? <small className="tk-tag tk-tag--buried">BURIED</small> : null}
                  <small className="tk-roster__score" aria-label={`${t.score} points`}>
                    {t.score}
                  </small>
                </span>
                <span className="tk-roster__hp" aria-label={armorLabel}>
                  {alive ? (
                    <>
                      {volley ? (
                        <span className="tk-lock" data-on={t.locked ? 'true' : undefined} aria-hidden>
                          <PixelIcon name={t.locked ? 'check' : 'clock'} size={11} />
                        </span>
                      ) : null}
                      <span className="tk-hpbar" data-level={k > 0.5 ? 'ok' : k > 0.25 ? 'warn' : 'low'}>
                        <i style={{ width: `${k * 100}%` }} />
                        {sk > 0 ? <s style={{ width: `${sk * 100}%` }} /> : null}
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
    if (!turn || turn.stage !== 'aim' || turn.turnId === lastTurn.current) return;
    if (!turn.volley && !turn.activeId) return;
    lastTurn.current = turn.turnId;
    const sub = `${turn.battles > 1 ? `Battle ${turn.battleNo} · ` : ''}Round ${turn.round} of ${turn.maxRounds}`;
    if (turn.volley) {
      tankSfx.yourTurn();
      setBanner({ key: turn.turnId, text: 'VOLLEY!', sub: `Everyone aim · ${sub}`, mine: true, color: '#ffd23f' });
    } else {
      const mine = turn.activeId === me;
      if (mine) tankSfx.yourTurn();
      setBanner({
        key: turn.turnId,
        text: mine ? 'YOUR TURN' : `${turn.name.toUpperCase()}${turn.cpu ? ' · CPU' : ''}`,
        sub,
        mine,
        color: turn.color,
      });
    }
    const id = setTimeout(() => setBanner(null), turn.volley || turn.activeId === me ? 1500 : 1100);
    return () => clearTimeout(id);
  }, [turn, me]);
  if (!banner) return null;
  return (
    <div
      className={cx('tk-banner', banner.mine && 'is-mine', reduced && 'is-still')}
      key={banner.key}
      role="status"
      style={{ '--tank': banner.color } as CSSProperties}
    >
      <span className="tk-banner__text">{banner.text}</span>
      <span className="tk-banner__sub">{banner.sub}</span>
    </div>
  );
}

function ShotCallout() {
  const ui = useBattleUi();
  const [shown, setShown] = useState<{ seq: number; text: string; tone: 'hit' | 'miss' | 'ko' } | null>(null);
  const last = ui.lastShot;
  const lastKey = last ? `${last.seq}:${last.kind}` : '';
  useEffect(() => {
    if (!last) return;
    const s = getStateSnapshot<TanksPublicState>();
    const { text, tone } = describeScript(last, (id) => s?.tanks?.[id]?.name ?? s?.fleet?.[id]?.name ?? '');
    setShown({ seq: last.seq, text, tone });
    const id = setTimeout(() => setShown(null), 2600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the script, not the object identity
  }, [lastKey]);
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
    battles: s.battle?.battles ?? 1,
    phase: s.phase,
  }));
  if (!v || v.stage !== 'over' || v.phase !== 'PLAYING') return null;
  const s = getStateSnapshot<TanksPublicState>();
  const ids = v.winners.split(',').filter(Boolean);
  const iWon = Boolean(me && ids.includes(me));
  const names = ids.map((id) => s?.fleet?.[id]?.name ?? s?.tanks?.[id]?.name ?? '').filter(Boolean);
  const title =
    v.reason === 'draw'
      ? 'DRAW'
      : v.team >= 0
        ? `TEAM ${TEAM_NAMES[v.team]?.toUpperCase()} WINS`
        : iWon
          ? 'VICTORY'
          : `${(names[0] ?? 'WINNER').toUpperCase()} WINS`;
  const sub =
    v.battles > 1 || v.reason === 'points'
      ? 'Most points across the match'
      : v.reason === 'round_limit'
        ? 'Round limit — most armor left'
        : v.reason === 'forfeit'
          ? 'The other side abandoned the field'
          : v.reason === 'draw'
            ? 'Mutual destruction'
            : 'Last one standing';
  return (
    <div
      className={cx('tk-victory', iWon && 'is-mine')}
      role="status"
      style={{ '--tank': v.team >= 0 ? TEAM_TINT[v.team] : undefined } as CSSProperties}
    >
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
