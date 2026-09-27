/**
 * In-game HUD: hole plate + turn status + shot clock (top), leaderboard strip, aim dock
 * (bottom: aim/power/putt buttons for keyboard, switch and screen-reader users), callouts
 * and the hole intro card. All numbers use the numeric font; meaning never relies on colour.
 */
import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { PUTT_POWER_MAX, PUTT_POWER_MIN, type PuttPublicState } from '@dascade/shared/games/putt';
import { Button, IconButton, Modal, PixelIcon, Slider, TimerRing, cx } from '@dascade/ui';
import { useCountdown, useRoomSelector } from '../../../net/hooks.ts';
import { useSessionStore } from '../../../net/session.ts';
import type { PuttController } from '../game/controller.ts';
import { currentHole, formatToPar, rows } from '../helpers.ts';
import { Scorecard } from '../Scorecard.tsx';

const selectHud = (s: PuttPublicState) => ({
  phase: s.phase,
  holeIndex: s.holeIndex,
  holeStatus: s.holeStatus,
  route: s.route,
  regulation: s.regulation,
  turnId: s.turnId,
  mode: s.mode,
  solo: s.solo,
  shotClock: s.shotClock,
  maxOverPar: s.maxOverPar,
  playoffIds: s.playoffIds,
  golfers: s.golfers,
  tournament: s.tournament,
});

function useHud() {
  return useRoomSelector<PuttPublicState, ReturnType<typeof selectHud>>(selectHud);
}

function useUi(ctrl: PuttController) {
  return useSyncExternalStore(ctrl.subscribeUi, ctrl.getUi, ctrl.getUi);
}

export function TopHud({ ctrl, onScorecard }: { ctrl: PuttController; onScorecard: () => void }) {
  const hud = useHud();
  const ui = useUi(ctrl);
  const me = useSessionStore((s) => s.playerId);
  const clockOwner = hud ? (hud.mode === 'turns' ? hud.turnId : me ?? '') : '';
  const deadline = hud && clockOwner ? (hud.golfers?.[clockOwner]?.deadline ?? 0) : 0;
  const left = useCountdown(deadline || null);
  if (!hud) return null;
  const hole = currentHole(hud);
  const playoff = hud.holeIndex >= hud.regulation;
  const mine = me ? hud.golfers?.[me] : undefined;
  const turnName = hud.turnId ? (hud.golfers?.[hud.turnId]?.name ?? '') : '';
  const rolling = Object.values(hud.golfers ?? {}).some((g) => g.moving);
  let status = '';
  if (hud.phase === 'COUNTDOWN') status = 'Get ready…';
  else if (hud.holeStatus === 'intro') status = playoff ? 'Sudden-death playoff' : 'New hole';
  else if (hud.holeStatus === 'done') status = 'Hole complete';
  else if (rolling && hud.mode === 'turns') status = 'Ball rolling…';
  else if (ui.spectator) status = hud.mode === 'turns' && turnName ? `${turnName} to putt` : 'Spectating';
  else if (mine?.holed) status = 'Holed! Waiting for the others';
  else if (mine?.pickedUp) status = 'Picked up — waiting for the others';
  else if (hud.mode === 'ghost') status = ui.canAim ? 'Everyone putts at once — go!' : 'Your ball is rolling…';
  else if (ui.myTurn) status = 'Your turn';
  else if (turnName) status = `${turnName} to putt`;
  const secs = Math.ceil(left / 1000);
  const total = Math.max(1, hud.shotClock) * 1000;
  const showClock = deadline > 0 && hud.holeStatus === 'play' && !hud.solo;
  const limit = hole ? hole.par + hud.maxOverPar : 0;
  return (
    <header className="pt-top" aria-label="Hole status">
      <div className="pt-plate">
        <span className="pt-plate__hole">
          <span className="pt-plate__label">{playoff ? 'Playoff' : 'Hole'}</span>
          <b className="pt-num">{hole?.number ?? '–'}</b>
          {!playoff && hud.regulation > 1 ? <span className="pt-plate__of pt-num">/{hud.regulation}</span> : null}
        </span>
        <span className="pt-plate__meta">
          <span className="pt-plate__name">{hole?.name ?? ''}</span>
          <span className="pt-plate__par">
            Par <b className="pt-num">{hole?.par ?? '–'}</b>
          </span>
        </span>
      </div>
      <div className={cx('pt-status', ui.myTurn && hud.holeStatus === 'play' && !rolling && 'is-mine')} role="status" aria-live="polite">
        {status}
      </div>
      <div className="pt-top__right">
        {mine && !ui.spectator ? (
          <div className="pt-strokes" aria-label={`Strokes this hole: ${mine.strokes + (mine.moving ? 1 : 0)}, limit ${limit}`}>
            <span className="pt-strokes__label">Strokes</span>
            <b className="pt-num">{mine.strokes + (mine.moving ? 1 : 0)}</b>
            <span className="pt-strokes__limit pt-num">/{limit}</span>
          </div>
        ) : ui.spectator ? (
          <span className="pt-spectating">
            <PixelIcon name="eye" /> Spectating
          </span>
        ) : null}
        {showClock ? (
          <div className="pt-clock" data-urgent={secs <= 8 ? 'true' : undefined}>
            <TimerRing seconds={secs} progress={left / total} urgentAt={8} size={44} label="Shot clock" />
          </div>
        ) : null}
        <IconButton icon="flag" label="Scorecard" variant="secondary" size="sm" className="pt-top__card" onClick={onScorecard} />
      </div>
    </header>
  );
}

export function Leaderboard() {
  const state = useRoomSelector<PuttPublicState, PuttPublicState>((s) => s, (a, b) => a === b);
  const me = useSessionStore((s) => s.playerId);
  if (!state || !state.golfers || Object.keys(state.golfers).length === 0) return null;
  const list = rows(state);
  if (list.length < 2) return null;
  const playoff = state.playoffIds ?? [];
  return (
    <aside className="pt-board" aria-label="Leaderboard">
      <ol>
        {list.map(({ id, g, toPar, thru }, i) => {
          const turn = state.mode === 'turns' && state.turnId === id;
          const out = playoff.length > 0 && !playoff.includes(id);
          const status = g.retired ? 'left' : g.holed ? 'holed' : g.pickedUp ? 'picked up' : g.moving ? 'rolling' : turn ? 'putting' : !state.players?.[id]?.connected ? 'offline' : '';
          return (
            <li key={id} className={cx('pt-board__row', id === me && 'is-me', turn && 'is-turn', (g.retired || out) && 'is-out')}>
              <span className="pt-board__pos pt-num">{i + 1}</span>
              <i className="pt-dot" style={{ background: g.color }} aria-hidden />
              <span className="pt-board__name">{g.name}</span>
              <span className="pt-board__hole pt-num" title="Strokes on this hole">
                {g.strokes + (g.moving ? 1 : 0)}
              </span>
              <span className="pt-board__par pt-num" title="To par">
                {thru ? formatToPar(toPar) : 'E'}
              </span>
              {status ? <span className={cx('pt-board__state', `is-${status.replace(' ', '-')}`)}>{status}</span> : null}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

export function AimDock({ ctrl, touch }: { ctrl: PuttController; touch: boolean }) {
  const ui = useUi(ctrl);
  const hud = useHud();
  const me = useSessionStore((s) => s.playerId);
  const [confirmPickup, setConfirmPickup] = useState(false);
  if (!hud || ui.spectator || hud.phase !== 'PLAYING') return null;
  const mine = me ? hud.golfers?.[me] : undefined;
  if (!mine || mine.retired) return null;
  const pct = Math.round((ui.power / PUTT_POWER_MAX) * 100);
  const deg = Math.round(ui.angle / 100);
  const disabled = !ui.canAim;
  const hint = ui.aiming
    ? ui.cancelZone
      ? 'Drag back to set power · release here to cancel'
      : 'Release to putt · drag back to the start to cancel'
    : touch
      ? 'Drag back from anywhere on the course, release to putt'
      : 'Drag back to aim & set power · or ← → aim, ↑ ↓ power, Space to putt';
  return (
    <div className={cx('pt-dock', disabled && 'is-idle')} aria-label="Putt controls" role="group">
      <p className="pt-dock__hint">{ui.canAim ? hint : ' '}</p>
      <div className="pt-dock__row">
        <div className="pt-dock__aim">
          <IconButton icon="arrow-left" label="Aim left" size="sm" variant="secondary" disabled={disabled} onClick={() => ctrl.nudgeAngle(-100)} />
          <output className="pt-dock__deg pt-num" aria-label="Aim angle">
            {deg}°
          </output>
          <IconButton icon="arrow-right" label="Aim right" size="sm" variant="secondary" disabled={disabled} onClick={() => ctrl.nudgeAngle(100)} />
        </div>
        <label className="pt-dock__power" style={{ '--pt-power': `${pct}%` } as CSSProperties}>
          <span className="pt-dock__power-label">
            <span>Power</span> <b className="pt-num">{pct}%</b>
          </span>
          <Slider
            value={ui.power}
            min={PUTT_POWER_MIN}
            max={PUTT_POWER_MAX}
            step={5}
            disabled={disabled}
            aria-label="Putt power"
            onChange={(v) => ctrl.setAim(ui.angle, v, 'keys')}
          />
        </label>
        <Button variant="primary" size="lg" className="pt-dock__putt" icon="play" disabled={disabled || ui.power < PUTT_POWER_MIN} onClick={() => ctrl.putt()}>
          Putt
        </Button>
        {mine.strokes > 0 && !mine.holed && !mine.pickedUp ? (
          confirmPickup ? (
            <span className="pt-dock__confirm" role="group" aria-label="Confirm pick up">
              <Button
                size="sm"
                variant="danger"
                disabled={disabled}
                onClick={() => {
                  setConfirmPickup(false);
                  ctrl.pickUp();
                }}
              >
                Pick up ({hud && currentHole(hud) ? currentHole(hud)!.par + hud.maxOverPar : ''})
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmPickup(false)}>
                Keep playing
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" className="pt-dock__pickup" disabled={disabled} onClick={() => setConfirmPickup(true)}>
              Pick up
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}

export function Callouts({ ctrl }: { ctrl: PuttController }) {
  const ui = useUi(ctrl);
  return (
    <div className="pt-callouts" aria-live="polite" aria-atomic="false">
      {ui.callouts.map((c) => (
        <div key={c.id} className={cx('pt-callout', `pt-callout--${c.tone}`)}>
          <span className="pt-callout__text">{c.text}</span>
          {c.sub ? <span className="pt-callout__sub">{c.sub}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function HoleIntro() {
  const hud = useHud();
  if (!hud || hud.phase !== 'PLAYING' || hud.holeStatus !== 'intro') return null;
  const hole = currentHole(hud);
  if (!hole) return null;
  const playoff = hud.holeIndex >= hud.regulation;
  return (
    <div className="pt-intro" role="status" aria-live="polite" key={`${hud.holeIndex}`}>
      <span className="pt-intro__kicker">{playoff ? 'Sudden-death playoff' : `Hole ${hole.number} of ${hud.regulation}`}</span>
      <h2 className="pt-intro__name">{hole.name}</h2>
      <span className="pt-intro__par">
        Par <b className="pt-num">{hole.par}</b>
      </span>
      <p className="pt-intro__tip">{hole.tip}</p>
    </div>
  );
}

export function ScorecardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useRoomSelector<PuttPublicState, PuttPublicState>((s) => s, (a, b) => a === b);
  const me = useSessionStore((s) => s.playerId);
  return (
    <Modal open={open} onClose={onClose} title="Scorecard" wide>
      {state ? <Scorecard state={state} playerId={me} highlight={state.holeIndex} /> : null}
    </Modal>
  );
}
