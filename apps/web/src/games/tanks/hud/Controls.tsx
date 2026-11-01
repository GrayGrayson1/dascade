/**
 * The gunner deck: drive (with fuel), the arsenal picker (owned weapons by category),
 * angle and power steppers + sliders, the items row (shields, battery, fuel, parachutes)
 * and the big FIRE button — LOCK IN during a volley. Aim controls stay live between turns
 * (pre-aim); driving, items and firing unlock when you may act. Touch-first: ≥ 44px
 * targets, hold-to-repeat steppers.
 */
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  ANGLE_MAX,
  ANGLE_MIN,
  ITEMS,
  POWER_MAX,
  POWER_MIN,
  USABLE_ITEMS,
  WEAPONS,
  type TanksPublicState,
  type UsableItemId,
  type WeaponId,
} from '@dascade/shared/games/tanks';
import { PixelArt, PixelIcon, cx, type IconName } from '@dascade/ui';
import { useRoomSelector } from '../../../net/hooks.ts';
import { useSessionStore } from '../../../net/session.ts';
import { sfx } from '../../../audio/audio.ts';
import { Repeater, itemBlock, type AimSnapshot } from '../model/aim.ts';
import { tankSfx } from '../audio.ts';
import { useTanks } from '../context.ts';
import { ownedByCategory } from '../shop/helpers.ts';
import { ITEM_ART, WEAPON_ART } from './weaponArt.ts';

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
  // A disabled button gets no pointerup/keyup: stop the repeat when it disables mid-hold (limit reached, turn over).
  useEffect(() => {
    if (disabled) end();
  }, [disabled]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const groups = ownedByCategory(a.ammo);
  const owned = groups.reduce((n, g) => n + g.ids.length, 0);
  const pick = (id: WeaponId) => {
    aim.setWeapon(id);
    sfx('select');
    setOpen(false);
  };
  const count = a.weapon === 'shell' ? -1 : (a.ammo[a.weapon] ?? 0);
  return (
    <div className="tk-weapon" ref={ref}>
      <button
        type="button"
        className="tk-weapon__prev"
        aria-label="Previous weapon"
        onClick={() => aim.cycleWeapon(-1)}
        disabled={!a.inBattle || owned <= 1}
      >
        <PixelIcon name="chevron-up" size={14} />
      </button>
      <button
        type="button"
        className="tk-weapon__current"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Weapon: ${w.name}, ${count < 0 ? 'unlimited' : `${count} left`}. Change weapon`}
        onClick={() => setOpen((v) => !v)}
        disabled={!a.inBattle}
      >
        <PixelArt rows={WEAPON_ART[a.weapon]} className="tk-weapon__art" />
        <span className="tk-weapon__name">{w.short}</span>
        <span className="tk-weapon__ammo">{ammoText(count)}</span>
        {owned > 1 ? (
          <span className="tk-weapon__count" aria-hidden>
            {owned}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        className="tk-weapon__next"
        aria-label="Next weapon"
        onClick={() => aim.cycleWeapon(1)}
        disabled={!a.inBattle || owned <= 1}
      >
        <PixelIcon name="chevron-down" size={14} />
      </button>
      {open ? (
        <div className="tk-tray tk-glass" data-part="arsenal" aria-label="Arsenal">
          {groups.map((g) => (
            <div key={g.key} className="tk-tray__group" role="radiogroup" aria-label={g.label}>
              <h4 className="tk-tray__cat">{g.label}</h4>
              <div className="tk-tray__items">
                {g.ids.map((id) => {
                  const info = WEAPONS[id];
                  const n = id === 'shell' ? -1 : (a.ammo[id] ?? 0);
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={a.weapon === id}
                      className={cx('tk-tray__item', a.weapon === id && 'is-on')}
                      onClick={() => pick(id)}
                    >
                      <PixelArt rows={WEAPON_ART[id]} className="tk-tray__art" />
                      <span className="tk-tray__name">{info.name}</span>
                      <span className="tk-tray__ammo">{ammoText(n)}</span>
                      <span className="tk-tray__blurb">{info.blurb}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {owned <= 1 ? <p className="tk-tray__empty">Only shells in stock. Buy more in the shop between battles.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

const ITEM_KEY: Partial<Record<UsableItemId, string>> = { shield: 'S', heavyshield: 'S', deflector: 'S', battery: 'B', fuel: 'F' };

function ItemsRow({ a }: { a: AimSnapshot }) {
  const { aim } = useTanks();
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), 2200);
    return () => clearTimeout(id);
  }, [note]);
  const owned = USABLE_ITEMS.filter((id) => (a.items[id] ?? 0) > 0);
  const chutes = a.items.parachute ?? 0;
  const digger: WeaponId | null = (a.ammo.excavator ?? 0) > 0 ? 'excavator' : (a.ammo.driller ?? 0) > 0 ? 'driller' : null;
  const showShield = a.shield > 0 && a.shieldMax > 0;
  if (owned.length === 0 && chutes === 0 && !showShield && !a.buried) return null;
  const use = (id: UsableItemId) => {
    const why = itemBlock(id, a);
    if (why) {
      setNote(`${ITEMS[id].name}: ${why}`);
      sfx('error');
      return;
    }
    if (aim.useItem(id)) {
      tankSfx.aimTick();
      sfx('select');
    }
  };
  return (
    <div className="tk-items" data-part="items" role="group" aria-label="Items">
      {a.buried ? (
        <div className="tk-buried" role="alert">
          <PixelIcon name="warning" size={14} />
          <span>
            <b>Buried!</b> {digger ? 'Dig out before you drive.' : 'Shots burst at the muzzle — no digging tools in stock.'}
          </span>
          {digger && a.weapon !== digger ? (
            <button type="button" className="tk-buried__dig" onClick={() => aim.setWeapon(digger)}>
              Load {WEAPONS[digger].short}
            </button>
          ) : null}
        </div>
      ) : null}
      {showShield ? (
        <span
          className="tk-shieldmeter"
          role="meter"
          aria-label={`${ITEMS[a.shieldKind || 'shield'].name} strength`}
          aria-valuemin={0}
          aria-valuemax={a.shieldMax}
          aria-valuenow={a.shield}
        >
          <PixelArt rows={ITEM_ART[a.shieldKind || 'shield']} className="tk-items__art" />
          <span className="tk-shieldmeter__bar">
            <i style={{ width: `${Math.max(0, Math.min(1, a.shield / a.shieldMax)) * 100}%` }} />
          </span>
          <b>{a.shield}</b>
        </span>
      ) : null}
      {owned.map((id) => {
        const why = itemBlock(id, a);
        const n = a.items[id] ?? 0;
        return (
          <button
            key={id}
            type="button"
            className="tk-item"
            aria-label={`Use ${ITEMS[id].name} (${n} left)${why ? ` — ${why}` : ''}`}
            title={`${ITEMS[id].name}${ITEM_KEY[id] ? ` (${ITEM_KEY[id]})` : ''}: ${ITEMS[id].blurb}`}
            aria-disabled={why ? true : undefined}
            data-blocked={why ? 'true' : undefined}
            onClick={() => use(id)}
          >
            <PixelArt rows={ITEM_ART[id]} className="tk-items__art" />
            <span className="tk-item__name">{ITEMS[id].short}</span>
            <b className="tk-item__n">{n}</b>
          </button>
        );
      })}
      {chutes > 0 ? (
        <span
          className="tk-chutes"
          title={ITEMS.parachute.blurb}
          aria-label={`${chutes} parachute${chutes === 1 ? '' : 's'}: they open by themselves`}
        >
          <PixelArt rows={ITEM_ART.parachute} className="tk-items__art" />
          <b>{chutes}</b>
        </span>
      ) : null}
      {note ? (
        <span className="tk-items__note" role="status">
          {note}
        </span>
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
      volley: b?.turnMode === 'volley',
      activeName: active?.name ?? '',
      activeCpu: active?.cpu ?? false,
      hasTank: Boolean(mine),
      alive: Boolean(mine?.alive),
      gone: Boolean(mine?.gone),
      phase: s.phase,
    };
  });
  if (!info || info.phase === 'RESULTS' || info.stage === 'shop') return null;

  if (!info.hasTank || !info.alive) {
    return (
      <section className="tk-deck tk-deck--watch tk-glass" data-part="controls" aria-label="Spectating" ref={deckRef}>
        <PixelIcon name={info.hasTank ? 'warning' : 'eye'} size={18} />
        <span>
          {info.hasTank
            ? info.gone
              ? 'You left the battle.'
              : 'Your tank was destroyed — watching the rest of the battle.'
            : 'Spectating'}
          {info.stage === 'aim' && info.activeName && !info.volley ? (
            <>
              {' '}
              · <b>{info.activeName}</b> is aiming
            </>
          ) : null}
        </span>
      </section>
    );
  }

  const volley = info.volley;
  const fireLabel = volley
    ? a.locked || a.firing
      ? 'LOCKED'
      : a.canAct
        ? 'LOCK IN'
        : 'WAIT'
    : a.firing
      ? 'FIRING'
      : a.canAct
        ? 'FIRE'
        : 'WAIT';
  const fuelK = a.maxFuel > 0 ? Math.max(0, Math.min(1, a.fuel / a.maxFuel)) : 0;
  const driveOff = !a.canAct || a.fuel <= 0 || a.buried;
  return (
    <section
      className="tk-deck tk-glass"
      data-part="controls"
      data-turn={a.canAct ? 'mine' : 'wait'}
      data-volley={volley ? 'true' : undefined}
      aria-label="Gunner controls"
      ref={deckRef}
    >
      <ItemsRow a={a} />
      <div className="tk-drive" role="group" aria-label="Drive">
        <HoldButton
          icon="arrow-left"
          label="Drive left"
          disabled={driveOff}
          onDown={() => aim.startMove(-1)}
          onUp={() => aim.stopMove()}
          className="tk-drive__btn"
        />
        <div
          className="tk-fuel"
          role="meter"
          aria-label="Fuel"
          aria-valuemin={0}
          aria-valuemax={Math.max(1, a.maxFuel, a.fuel)}
          aria-valuenow={Math.round(a.fuel)}
        >
          <span className="tk-fuel__label">{a.buried ? 'BURIED' : a.maxFuel > 0 || a.fuel > 0 ? 'FUEL' : 'NO DRIVE'}</span>
          <span className="tk-fuel__bar">
            <i style={{ width: `${Math.min(1, a.maxFuel > 0 ? fuelK : a.fuel > 0 ? 1 : 0) * 100}%` }} />
          </span>
        </div>
        <HoldButton
          icon="arrow-right"
          label="Drive right"
          disabled={driveOff}
          onDown={() => aim.startMove(1)}
          onUp={() => aim.stopMove()}
          className="tk-drive__btn"
        />
      </div>
      <WeaponPicker a={a} />
      <Stepper
        kind="angle"
        value={a.angle}
        min={ANGLE_MIN}
        max={ANGLE_MAX}
        disabled={!a.inBattle || a.locked}
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
        disabled={!a.inBattle || a.locked}
        onStep={(d) => {
          aim.nudge(0, d);
          tankSfx.aimTick();
        }}
        onSet={(v) => aim.setPower(v)}
      />
      <button
        type="button"
        className="tk-fire"
        data-part="fire"
        aria-label="Fire"
        title={volley ? 'Lock in your shot: every locked shot flies together when the volley ends' : undefined}
        disabled={!a.canAct}
        onMouseDown={(e) => e.preventDefault()}
        data-state={a.firing || a.locked ? 'firing' : a.canAct ? 'ready' : 'wait'}
        data-volley={volley ? 'true' : undefined}
        onClick={() => aim.fire()}
      >
        <span className="tk-fire__label">{fireLabel}</span>
        <span className="tk-fire__hint">
          {a.canAct ? (
            <>
              <kbd className="tk-key">Space</kbd>
              <span className="tk-tap">{volley ? 'tap to lock in' : 'tap to fire'}</span>
            </>
          ) : volley ? (
            a.locked || a.firing ? (
              info.stage === 'resolving' ? (
                'shells in flight'
              ) : (
                'waiting for the rest'
              )
            ) : info.stage === 'resolving' ? (
              'shells in flight'
            ) : (
              'next volley'
            )
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
