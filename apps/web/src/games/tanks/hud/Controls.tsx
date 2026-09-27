/**
 * The gunner deck: drive (with fuel), weapon picker, angle and power steppers + sliders,
 * and the big FIRE button. Aim controls stay live between turns (pre-aim); driving and
 * firing unlock on your turn. Touch-first: ≥ 44px targets, hold-to-repeat steppers.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  ANGLE_MAX,
  ANGLE_MIN,
  POWER_MAX,
  POWER_MIN,
  WEAPONS,
  WEAPON_IDS,
  type TanksPublicState,
  type WeaponId,
} from '@dascade/shared/games/tanks';
import { PixelArt, PixelIcon, cx, type IconName } from '@dascade/ui';
import { useRoomSelector } from '../../../net/hooks.ts';
import { useSessionStore } from '../../../net/session.ts';
import { sfx } from '../../../audio/audio.ts';
import { Repeater, type AimSnapshot } from '../model/aim.ts';
import { tankSfx } from '../audio.ts';
import { useTanks } from '../context.ts';
import { WEAPON_ART } from './weaponArt.ts';

function ammoText(n: number): string {
  return n < 0 ? '∞' : `×${n}`;
}

function HoldButton({
  icon,
  label,
  disabled,
  onDown,
  onUp,
  className,
  children,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  onDown: () => void;
  onUp: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const down = useRef(false);
  const start = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    down.current = true;
    onDown();
  };
  const end = () => {
    if (!down.current) return;
    down.current = false;
    onUp();
  };
  useEffect(() => () => end(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button
      type="button"
      className={cx('tk-hold', className)}
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={start}
      onMouseDown={(e) => e.preventDefault()}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && !disabled) {
          e.preventDefault();
          down.current = true;
          onDown();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          end();
        }
      }}
    >
      <PixelIcon name={icon} size={18} />
      {children}
    </button>
  );
}

function Stepper({
  kind,
  value,
  min,
  max,
  disabled,
  onStep,
  onSet,
}: {
  kind: 'angle' | 'power';
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onStep: (d: number) => void;
  onSet: (v: number) => void;
}) {
  const rep = useRef(new Repeater());
  useEffect(() => {
    const r = rep.current;
    return () => r.stop();
  }, []);
  const title = kind === 'angle' ? 'Angle' : 'Power';
  const decLabel = kind === 'angle' ? 'Aim right (lower angle)' : 'Less power';
  const incLabel = kind === 'angle' ? 'Aim left (higher angle)' : 'More power';
  const facing = value > 90 ? 'left' : value < 90 ? 'right' : 'straight up';
  const dec = (
    <HoldButton
      icon={kind === 'angle' ? 'arrow-right' : 'minus'}
      label={decLabel}
      disabled={disabled || value <= min}
      onDown={() => rep.current.start(() => onStep(-1))}
      onUp={() => rep.current.stop()}
      className="tk-dial__btn"
    />
  );
  const inc = (
    <HoldButton
      icon={kind === 'angle' ? 'arrow-left' : 'plus'}
      label={incLabel}
      disabled={disabled || value >= max}
      onDown={() => rep.current.start(() => onStep(1))}
      onUp={() => rep.current.stop()}
      className="tk-dial__btn"
    />
  );
  return (
    <div className={cx('tk-dial', `tk-dial--${kind}`)} role="group" aria-label={title}>
      <div className="tk-dial__row">
        {/* Angle: the ← button sits on the left and swings the barrel left, matching the rtl slider below. */}
        {kind === 'angle' ? inc : dec}
        <output className="tk-dial__value" aria-live="off">
          <span className="tk-dial__label">{title.toUpperCase()}</span>
          <b>
            {value}
            {kind === 'angle' ? '°' : ''}
          </b>
          {kind === 'angle' ? <small>{facing}</small> : <small>{value >= 85 ? 'max' : value <= 25 ? 'soft' : ''}</small>}
        </output>
        {kind === 'angle' ? dec : inc}
      </div>
      <input
        type="range"
        className={cx('dc-slider', 'tk-dial__slider')}
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        dir={kind === 'angle' ? 'rtl' : 'ltr'}
        aria-label={`${title} slider`}
        aria-valuetext={kind === 'angle' ? `${value} degrees, aiming ${facing}` : `${value} percent`}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
        onChange={(e) => onSet(e.currentTarget.valueAsNumber)}
      />
    </div>
  );
}

function WeaponPicker({ a }: { a: AimSnapshot }) {
  const { aim } = useTanks();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const w = WEAPONS[a.weapon];
  const pick = (id: WeaponId) => {
    aim.setWeapon(id);
    sfx('select');
    setOpen(false);
  };
  return (
    <div className="tk-weapon" ref={ref}>
      <button type="button" className="tk-weapon__prev" aria-label="Previous weapon" onClick={() => aim.cycleWeapon(-1)} disabled={!a.inBattle}>
        <PixelIcon name="chevron-up" size={14} />
      </button>
      <button
        type="button"
        className="tk-weapon__current"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Weapon: ${w.name}, ${a.ammo[a.weapon] < 0 ? 'unlimited' : `${a.ammo[a.weapon]} left`}. Change weapon`}
        onClick={() => setOpen((v) => !v)}
        disabled={!a.inBattle}
      >
        <PixelArt rows={WEAPON_ART[a.weapon]} className="tk-weapon__art" />
        <span className="tk-weapon__name">{w.short}</span>
        <span className="tk-weapon__ammo">{ammoText(a.ammo[a.weapon])}</span>
      </button>
      <button type="button" className="tk-weapon__next" aria-label="Next weapon" onClick={() => aim.cycleWeapon(1)} disabled={!a.inBattle}>
        <PixelIcon name="chevron-down" size={14} />
      </button>
      {open ? (
        <div className="tk-tray tk-glass" role="radiogroup" aria-label="Weapons">
          {WEAPON_IDS.map((id) => {
            const info = WEAPONS[id];
            const n = a.ammo[id];
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={a.weapon === id}
                disabled={n === 0}
                className={cx('tk-tray__item', a.weapon === id && 'is-on')}
                onClick={() => pick(id)}
              >
                <PixelArt rows={WEAPON_ART[id]} className="tk-tray__art" />
                <span className="tk-tray__name">{info.name}</span>
                <span className="tk-tray__ammo">{n === 0 ? 'empty' : ammoText(n)}</span>
                <span className="tk-tray__blurb">{info.blurb}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function Controls({ deckRef }: { deckRef: (el: HTMLElement | null) => void }) {
  const { aim } = useTanks();
  const a = useSyncExternalStore(aim.subscribe, aim.getSnapshot, aim.getSnapshot);
  const me = useSessionStore((s) => s.playerId);
  const info = useRoomSelector((s: TanksPublicState) => {
    const b = s.battle;
    const mine = me ? s.tanks?.[me] : undefined;
    const active = b ? s.tanks?.[b.activeId] : undefined;
    return {
      stage: b?.stage ?? 'idle',
      activeName: active?.name ?? '',
      activeCpu: active?.cpu ?? false,
      hasTank: Boolean(mine),
      alive: Boolean(mine?.alive),
      gone: Boolean(mine?.gone),
      phase: s.phase,
    };
  });
  if (!info || info.phase === 'RESULTS') return null;

  if (!info.hasTank || !info.alive) {
    return (
      <section className="tk-deck tk-deck--watch tk-glass" aria-label="Spectating" ref={deckRef}>
        <PixelIcon name={info.hasTank ? 'warning' : 'eye'} size={18} />
        <span>
          {info.hasTank ? (info.gone ? 'You left the battle.' : 'Your tank was destroyed — watching the rest of the battle.') : 'Spectating'}
          {info.stage === 'aim' && info.activeName ? (
            <>
              {' '}
              · <b>{info.activeName}</b> is aiming
            </>
          ) : null}
        </span>
      </section>
    );
  }

  const fireLabel = a.firing ? 'FIRING' : a.canAct ? 'FIRE' : 'WAIT';
  const fuelK = a.maxFuel > 0 ? Math.max(0, Math.min(1, a.fuel / a.maxFuel)) : 0;
  return (
    <section className="tk-deck tk-glass" data-turn={a.canAct ? 'mine' : 'wait'} aria-label="Gunner controls" ref={deckRef}>
      <div className="tk-drive" role="group" aria-label="Drive">
        <HoldButton icon="arrow-left" label="Drive left" disabled={!a.canAct || a.fuel <= 0} onDown={() => aim.startMove(-1)} onUp={() => aim.stopMove()} className="tk-drive__btn" />
        <div className="tk-fuel" role="meter" aria-label="Fuel" aria-valuemin={0} aria-valuemax={Math.max(1, a.maxFuel)} aria-valuenow={Math.round(a.fuel)}>
          <span className="tk-fuel__label">{a.maxFuel > 0 ? 'FUEL' : 'NO DRIVE'}</span>
          <span className="tk-fuel__bar">
            <i style={{ width: `${fuelK * 100}%` }} />
          </span>
        </div>
        <HoldButton icon="arrow-right" label="Drive right" disabled={!a.canAct || a.fuel <= 0} onDown={() => aim.startMove(1)} onUp={() => aim.stopMove()} className="tk-drive__btn" />
      </div>
      <WeaponPicker a={a} />
      <Stepper
        kind="angle"
        value={a.angle}
        min={ANGLE_MIN}
        max={ANGLE_MAX}
        disabled={!a.inBattle}
        onStep={(d) => {
          aim.nudge(d, 0);
          tankSfx.aimTick();
        }}
        onSet={(v) => aim.setAngle(v)}
      />
      <Stepper
        kind="power"
        value={a.power}
        min={POWER_MIN}
        max={POWER_MAX}
        disabled={!a.inBattle}
        onStep={(d) => {
          aim.nudge(0, d);
          tankSfx.aimTick();
        }}
        onSet={(v) => aim.setPower(v)}
      />
      <button type="button" className="tk-fire" aria-label="Fire" disabled={!a.canAct} onMouseDown={(e) => e.preventDefault()} data-state={a.firing ? 'firing' : a.canAct ? 'ready' : 'wait'} onClick={() => aim.fire()}>
        <span className="tk-fire__label">{fireLabel}</span>
        <span className="tk-fire__hint">
          {a.canAct ? (
            <>
              <kbd className="tk-key">Space</kbd>
              <span className="tk-tap">tap to fire</span>
            </>
          ) : a.firing || info.stage === 'resolving' ? (
            'shell in flight'
          ) : info.stage === 'aim' && info.activeName ? (
            `${info.activeName}${info.activeCpu ? ' (CPU)' : ''}`
          ) : (
            'next turn'
          )}
        </span>
      </button>
    </section>
  );
}
