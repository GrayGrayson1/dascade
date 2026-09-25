/**
 * Race HUD overlay. Structure is React; fast-changing values (timers, speed,
 * boost, banners, lights) are written by the RaceController through HudBridge
 * refs at ~15 Hz, so React re-renders only on low-frequency changes.
 */
import { useMemo, useSyncExternalStore, type CSSProperties } from 'react';
import { CIRCUIT_SIM, type CircuitPublicState, type CircuitTrackId } from '@dascade/shared/games/circuit';
import { TRACK_DEFS } from '@dascade/game-core/circuit';
import { IconButton, PixelIcon, cx } from '@dascade/ui';
import { getStateSnapshot, useSessionStore } from '../../../net/session.ts';
import { useRoomSelector } from '../../../net/hooks.ts';
import type { RaceController } from '../race/controller.ts';
import type { HudBridge } from './bridge.ts';

export function Hud({ ctrl }: { ctrl: RaceController }) {
  const b = ctrl.hud;
  const ui = useSyncExternalStore(ctrl.subscribeUi, ctrl.getUi, ctrl.getUi);
  const solo = useRoomSelector((s: CircuitPublicState) => Boolean(s.race?.solo));
  const boostOn = useRoomSelector((s: CircuitPublicState) => {
    try {
      return (JSON.parse(s.settingsJson) as { boost?: boolean }).boost !== false;
    } catch {
      return true;
    }
  });
  return (
    <div className="ci-hud" ref={b.ref('root')} data-touch={ui.touch ? 'true' : undefined} data-spectating={ui.spectating ? 'true' : undefined}>
      <section className="ci-hud__tl ci-glass" aria-label="Position and lap times">
        <div className="ci-pos">
          <span className="ci-pos__label">POS</span>
          <span className="ci-pos__num" ref={b.ref('pos')}>
            -
          </span>
          <span className="ci-pos__of" ref={b.ref('posOf')} />
        </div>
        <div className="ci-lap">
          <span className="ci-lap__label">LAP</span>
          <b ref={b.ref('lap')}>1</b>
          <span className="ci-lap__of" ref={b.ref('lapOf')} />
        </div>
        <dl className="ci-times">
          <div>
            <dt ref={b.ref('lapTimeLabel')}>TIME</dt>
            <dd ref={b.ref('lapTime')}>0:00.000</dd>
          </div>
          <div>
            <dt>BEST</dt>
            <dd ref={b.ref('best')}>--:--.---</dd>
          </div>
          <div>
            <dt>LAST</dt>
            <dd ref={b.ref('last')}>--:--.---</dd>
          </div>
          {solo ? (
            <div className="ci-times__pb">
              <dt>PB</dt>
              <dd ref={b.ref('pb')}>--:--.---</dd>
            </div>
          ) : null}
        </dl>
        <div className="ci-delta" ref={b.ref('delta')} aria-live="polite" />
      </section>

      <div className="ci-hud__tc">
        <div className="ci-clock ci-glass" aria-label="Race time">
          <PixelIcon name="clock" />
          <span ref={b.ref('clock')}>0:00.000</span>
        </div>
        <div className="ci-banner" ref={b.ref('banner')} role="status" aria-live="polite" />
        <div className="ci-wrongway" ref={b.ref('wrongWay')} role="alert">
          <PixelIcon name="warning" /> WRONG WAY
        </div>
        <div className="ci-window" ref={b.ref('windowWrap')}>
          <span>Finish window</span> <b ref={b.ref('window')} />
        </div>
      </div>

      <StartLights bridge={b} />
      <Standings />

      <div className="ci-hud__bl">
        <canvas className="ci-minimap" ref={b.ref('minimap')} width={200} height={200} role="img" aria-label="Track map with racer positions" />
      </div>

      <Speedo bridge={b} boost={boostOn !== false} />

      {ui.spectating ? (
        <div className="ci-spectate ci-glass" role="group" aria-label="Spectator camera">
          <IconButton icon="arrow-left" label="Previous driver" size="sm" onClick={() => ctrl.cycleFollow(-1)} />
          <span>
            <PixelIcon name="eye" /> Watching <b>{ui.followName || '…'}</b>
          </span>
          <IconButton icon="arrow-right" label="Next driver" size="sm" onClick={() => ctrl.cycleFollow(1)} />
        </div>
      ) : (
        <ControlsHint touch={ui.touch} />
      )}
    </div>
  );
}

function ControlsHint({ touch }: { touch: boolean }) {
  if (touch) return null;
  return (
    <div className="ci-hint" aria-hidden>
      <span>
        <kbd>W</kbd>/<kbd>↑</kbd> gas
      </span>
      <span>
        <kbd>S</kbd>/<kbd>↓</kbd> brake
      </span>
      <span>
        <kbd>Space</kbd> drift
      </span>
      <span>
        <kbd>Shift</kbd> boost
      </span>
    </div>
  );
}

function StartLights({ bridge }: { bridge: HudBridge }) {
  const title = useRoomSelector((s: CircuitPublicState) => {
    const def = TRACK_DEFS[s.race?.trackId as CircuitTrackId];
    return def ? `${def.name} · ${s.race.laps} ${s.race.laps === 1 ? 'lap' : 'laps'}${s.race.solo ? ' · time trial' : ''}` : '';
  });
  return (
    <div className="ci-lights" ref={bridge.ref('lights')} data-phase="hidden" aria-hidden>
      <div className="ci-lights__title">{title}</div>
      <div className="ci-lights__rig">
        {Array.from({ length: CIRCUIT_SIM.lights }, (_, i) => (
          <div className="ci-lights__pod" key={i}>
            <i ref={bridge.ref(`light${i}`)} />
            <i className="ci-lights__twin" />
          </div>
        ))}
      </div>
      <div className="ci-lights__go">GO!</div>
    </div>
  );
}

function Speedo({ bridge, boost }: { bridge: HudBridge; boost: boolean }) {
  const ticks = useMemo(
    () =>
      Array.from({ length: 13 }, (_, i) => {
        const a = ((-120 + i * 20) * Math.PI) / 180;
        const r1 = i % 2 === 0 ? 38 : 41;
        return { x1: 60 + Math.sin(a) * r1, y1: 62 - Math.cos(a) * r1, x2: 60 + Math.sin(a) * 45, y2: 62 - Math.cos(a) * 45, major: i % 2 === 0 };
      }),
    [],
  );
  return (
    <div className="ci-hud__br">
      <div className="ci-speedo ci-glass" ref={bridge.ref('speedo')} aria-label="Speedometer">
        <svg viewBox="0 0 120 110" className="ci-speedo__dial" aria-hidden>
          <path d="M 18.43 86 A 48 48 0 1 1 101.57 86" className="ci-speedo__track" pathLength={100} />
          <path d="M 18.43 86 A 48 48 0 1 1 101.57 86" className="ci-speedo__fill" pathLength={100} ref={bridge.ref('speedArc') as unknown as (el: SVGPathElement | null) => void} />
          {ticks.map((t, i) => (
            <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className={t.major ? 'ci-speedo__tick ci-speedo__tick--major' : 'ci-speedo__tick'} />
          ))}
          <g className="ci-speedo__needle" ref={bridge.ref('needle') as unknown as (el: SVGGElement | null) => void} style={{ transform: 'rotate(-120deg)' } as CSSProperties}>
            <line x1="60" y1="66" x2="60" y2="24" />
          </g>
          <circle cx="60" cy="62" r="5" className="ci-speedo__hub" />
        </svg>
        <div className="ci-speedo__num">
          <span ref={bridge.ref('speed')}>000</span>
          <small>KM/H</small>
        </div>
        {boost ? (
          <div className="ci-boost" ref={bridge.ref('boost')} data-state="empty">
            <span className="ci-boost__label">
              <PixelIcon name="bolt" /> BOOST
            </span>
            <div className="ci-boost__bar">
              <i ref={bridge.ref('boostFill')} />
            </div>
            <span className="ci-boost__pct" ref={bridge.ref('boostPct')}>
              0%
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Standings() {
  const me = useSessionStore((s) => s.playerId);
  // A compact string key keeps this from re-rendering on every distance update.
  const key = useRoomSelector((s: CircuitPublicState) =>
    Object.entries(s.racers ?? {})
      .map(([id, r]) => `${id}:${r.position}:${r.finished ? 1 : 0}:${r.dnf ? 1 : 0}:${r.lap}:${r.active ? 1 : 0}:${s.cars?.[id]?.primary ?? ''}:${s.cars?.[id]?.nameplate ?? ''}`)
      .join('|'),
  );
  const rows = useMemo(() => {
    const s = getStateSnapshot<CircuitPublicState>();
    if (!s || !key) return [];
    return Object.entries(s.racers ?? {})
      .map(([id, r]) => ({ id, r, look: s.cars?.[id] }))
      .sort((a, b) => a.r.position - b.r.position);
  }, [key]);
  if (rows.length <= 1) return null;
  const top = rows.slice(0, 8);
  const mine = rows.find((row) => row.id === me);
  if (mine && !top.includes(mine)) top.push(mine);
  return (
    <ol className="ci-tower ci-glass" aria-label="Standings">
      {top.map(({ id, r, look }) => (
        <li key={id} className={cx('ci-tower__row', id === me && 'is-me', !r.active && 'is-out')}>
          <span className="ci-tower__pos">{r.position}</span>
          <span className="ci-tower__chip" style={{ background: look?.primary ?? '#22d3ee' }} aria-hidden />
          <span className="ci-tower__name">{look?.nameplate || r.name}</span>
          <span className="ci-tower__state">{r.finished ? 'FIN' : r.dnf ? 'DNF' : !r.active ? 'OUT' : `L${Math.max(1, r.lap)}`}</span>
        </li>
      ))}
    </ol>
  );
}
