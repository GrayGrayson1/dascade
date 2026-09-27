/**
 * Shared DASino UI pieces: the HUD (balance, session net, refill, close floor),
 * table navigation, the big-win ticker, the chip rack and phase timers.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Badge, Button, CasinoChip, IconButton, Modal, PixelIcon, cx, type IconName } from '@dascade/ui';
import {
  DASINO_MSG,
  seatNet,
  type DasinoPublicState,
  type DasinoSeatView,
  type DasinoSettings,
  type DasinoTable,
  type DasinoTickerView,
} from '@dascade/shared/games/dasino';
import { serverNow, session, useCountdown } from '../../net/hooks.ts';
import { SLOT_SPRITES } from './sprites.ts';
import { Sprite } from './Sprite.tsx';
import { fmt, play, signed, useDasinoUi, useMotion } from './ui.ts';

// ---------------------------------------------------------------------------
// Animated number (count-up) — instant when motion is reduced.
// ---------------------------------------------------------------------------
export function useTween(target: number, ms = 600): number {
  const { reduced } = useMotion();
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const raf = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    if (reduced || Math.abs(target - from.current) < 1) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    const step = (t: number) => {
      const u = Math.min(1, (t - start) / ms);
      const eased = 1 - (1 - u) ** 3;
      const v = a + (target - a) * eased;
      from.current = v;
      setValue(v);
      if (u < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms, reduced]);
  return value;
}

// ---------------------------------------------------------------------------
// Table navigation
// ---------------------------------------------------------------------------
const TABLES: Array<{ id: DasinoTable; label: string; icon: IconName }> = [
  { id: 'floor', label: 'Floor', icon: 'star' },
  { id: 'roulette', label: 'Roulette', icon: 'refresh' },
  { id: 'slots', label: 'Slots', icon: 'bolt' },
  { id: 'dice', label: 'Dice', icon: 'dice' },
];

export function goToTable(table: DasinoTable, seated: boolean): void {
  if (useDasinoUi.getState().table === table) return;
  useDasinoUi.getState().setTable(table);
  play('select');
  window.scrollTo({ top: 0 });
  if (seated) session.send(DASINO_MSG.table, { table });
}

export function TableNav({ state, seated }: { state: DasinoPublicState; seated: boolean }) {
  const table = useDasinoUi((s) => s.table);
  const live: Partial<Record<DasinoTable, boolean>> = {
    roulette: state.roulette.phase === 'BETTING',
    dice: state.dice.phase === 'BETTING',
  };
  return (
    <nav className="dn-nav" aria-label="DASino tables">
      {TABLES.map((t) => (
        <button
          key={t.id}
          type="button"
          className="dn-nav__item"
          aria-current={table === t.id ? 'page' : undefined}
          onClick={() => goToTable(t.id, seated)}
        >
          <PixelIcon name={t.icon} />
          <span>{t.label}</span>
          {live[t.id] ? <i className="dn-nav__live" aria-label="Betting open" /> : null}
        </button>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// HUD: balance + net + refill + close floor
// ---------------------------------------------------------------------------
export function BalanceHud({ seat, settings, isHost, spectator }: { seat: DasinoSeatView | undefined; settings: DasinoSettings; isHost: boolean; spectator: boolean }) {
  const freeze = useDasinoUi((s) => s.freeze);
  const balance = seat ? (freeze ?? seat.balance) : settings.startingBalance;
  const shown = useTween(balance);
  const net = seat ? seatNet({ ...seat, balance }) : 0;
  const [confirmEnd, setConfirmEnd] = useState(false);
  const canRefill = Boolean(seat && settings.allowRefills && seat.balance < settings.minBet && seat.inPlay === 0);
  return (
    <div className="dn-hud__right">
      {spectator ? (
        <Badge icon="eye" color="var(--purple)">
          Spectating
        </Badge>
      ) : (
        <>
          <div className="dn-balance" aria-live="polite" aria-label={`Balance ${fmt(balance)} virtual chips`}>
            <CasinoChip value={100} size={30} label={false} />
            <span className="dn-balance__stack">
              <span className="dn-balance__label">Chips</span>
              <span className="dn-balance__value dc-num">{fmt(shown)}</span>
            </span>
          </div>
          <div className={cx('dn-net', net > 0 && 'is-up', net < 0 && 'is-down')} title="Session result (balance − starting chips − refills)">
            <PixelIcon name={net >= 0 ? 'chevron-up' : 'chevron-down'} />
            <span className="dn-net__label">Net</span>
            <span className="dc-num">{signed(net)}</span>
          </div>
          {seat && seat.inPlay > 0 ? (
            <span className="dn-inplay" title="Chips on the felt">
              <PixelIcon name="chip" /> <span className="dc-num">{fmt(seat.inPlay)}</span> on the felt
            </span>
          ) : null}
          {canRefill ? (
            <Button
              size="sm"
              variant="gold"
              icon="refresh"
              onClick={() => {
                play('coin');
                session.send(DASINO_MSG.refill, {});
              }}
            >
              Free refill
            </Button>
          ) : null}
        </>
      )}
      <span className="dn-virtual" title="DASino uses virtual arcade chips only. No real money, purchases or cash-out.">
        <PixelIcon name="info" /> Virtual chips only
      </span>
      {isHost ? (
        <>
          <IconButton icon="flag" label="Close the floor and show results" size="sm" variant="secondary" onClick={() => setConfirmEnd(true)} />
          <Modal
            open={confirmEnd}
            onClose={() => setConfirmEnd(false)}
            title="Close the DASino floor?"
            footer={
              <>
                <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
                  Keep playing
                </Button>
                <Button
                  variant="primary"
                  icon="trophy"
                  onClick={() => {
                    setConfirmEnd(false);
                    session.send(DASINO_MSG.endSession, {});
                  }}
                >
                  Show leaderboard
                </Button>
              </>
            }
          >
            <p>Spins already in motion settle; chips still waiting in an open betting window are handed back. Everyone sees the final leaderboard of net winnings.</p>
          </Modal>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticker
// ---------------------------------------------------------------------------
const GAME_ICON: Record<string, ReactNode> = {
  roulette: <span className="dn-ticker__dot dn-ticker__dot--roulette" aria-hidden />,
  slots: <Sprite rows={SLOT_SPRITES.seven} size={16} />,
  dice: <PixelIcon name="dice" />,
};

export function Ticker({ ticker }: { ticker: DasinoTickerView[] }) {
  const { reduced } = useMotion();
  const [, force] = useState(0);
  // Re-check hidden (not yet revealed) entries a few times a second.
  const pending = ticker.some((t) => t.at > serverNow());
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => force((n) => n + 1), 400);
    return () => clearInterval(id);
  }, [pending]);
  const visible = ticker.filter((t) => t.at <= serverNow()).reverse();
  const items = visible.length ? visible : null;
  return (
    <div className="dn-ticker" data-part="ticker" role="log" aria-label="Recent big wins" data-static={reduced || !items ? 'true' : undefined}>
      <span className="dn-ticker__tag">
        <PixelIcon name="trophy" /> Big wins
      </span>
      <div className="dn-ticker__track">
        {items ? (
          <div className="dn-ticker__run" style={{ '--n': items.length } as CSSProperties}>
            {[...items, ...(reduced ? [] : items)].map((t, i) => (
              <span key={`${t.id}-${i}`} className="dn-ticker__item" aria-hidden={i >= items.length ? true : undefined}>
                {GAME_ICON[t.game]}
                <strong>{t.name}</strong>
                <span className="dn-ticker__label">{t.label}</span>
                <span className="dn-ticker__amount dc-num">+{fmt(t.amount)}</span>
                <span className="dn-ticker__mult">{t.multiple.toFixed(t.multiple >= 100 ? 0 : 1)}×</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="dn-ticker__empty">Welcome to the DASino floor — every chip is virtual. Big wins light up here.</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chip rack
// ---------------------------------------------------------------------------
export function ChipRack({ chips, balance, disabled, className }: { chips: number[]; balance: number; disabled?: boolean; className?: string }) {
  const chip = useDasinoUi((s) => s.chip);
  const setChip = useDasinoUi((s) => s.setChip);
  useEffect(() => {
    if (!chips.includes(chip)) setChip(chips[Math.min(1, chips.length - 1)] ?? chips[0]!);
  }, [chips, chip, setChip]);
  return (
    <div className={cx('dn-rack', className)} data-part="chip-rack" role="radiogroup" aria-label="Chip value">
      {chips.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={chip === c}
          aria-label={`${fmt(c)} chip`}
          className="dn-rack__chip"
          disabled={disabled || c > balance}
          onClick={() => {
            setChip(c);
            play('chip');
          }}
        >
          <CasinoChip value={c} size={46} />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Countdown ring for a table phase
// ---------------------------------------------------------------------------
export function PhaseTimer({ endsAt, totalMs, label, urgentAt = 4 }: { endsAt: number; totalMs: number; label: string; urgentAt?: number }) {
  const remaining = useCountdown(endsAt, true);
  const seconds = Math.ceil(remaining / 1000);
  const lastSecond = useRef(seconds);
  useEffect(() => {
    if (seconds !== lastSecond.current && seconds > 0 && seconds <= 3) play('tick');
    lastSecond.current = seconds;
  }, [seconds]);
  const p = totalMs > 0 ? remaining / totalMs : 0;
  return (
    <div className="dn-timer" data-urgent={seconds <= urgentAt && seconds > 0 ? 'true' : undefined} role="timer" aria-label={`${label}: ${seconds} seconds`}>
      <svg viewBox="0 0 40 40" aria-hidden>
        <circle cx="20" cy="20" r="17" className="dn-timer__track" />
        <circle cx="20" cy="20" r="17" className="dn-timer__bar" style={{ strokeDashoffset: `${(1 - Math.max(0, Math.min(1, p))) * 106.8}` }} />
      </svg>
      <span className="dc-num">{Math.max(0, seconds)}</span>
    </div>
  );
}

/** Players currently sitting at a table (by seat.table). */
export function TableCrowd({ state, table, max = 6 }: { state: DasinoPublicState; table: DasinoTable; max?: number }) {
  const here = Object.values(state.seats).filter((s) => s.table === table);
  if (here.length === 0) return <span className="dn-crowd dn-crowd--empty">Nobody seated yet</span>;
  return (
    <span className="dn-crowd" aria-label={`${here.length} at this table`}>
      {here.slice(0, max).map((s) => {
        const p = state.players[s.id];
        return (
          <i key={s.id} className="dn-crowd__dot" style={{ '--c': p?.color ?? '#fff' } as CSSProperties} title={p?.name}>
            {(p?.name ?? '?').slice(0, 1).toUpperCase()}
          </i>
        );
      })}
      {here.length > max ? <em>+{here.length - max}</em> : null}
    </span>
  );
}
