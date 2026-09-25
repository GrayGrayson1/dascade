/** Lobby: host table settings and the per-player seat picker. */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  DEFAULT_HOLDEM_SETTINGS,
  HOLDEM_MAX_STACK,
  HOLDEM_MIN_STACK,
  HOLDEM_MSG,
  formatBlinds,
  type HoldemPublicState,
  type HoldemSettings,
} from '@dascade/shared/games/holdem';
import { Avatar, Field, NumberInput, PixelIcon, Segmented, Select, Slider, Toggle, cx } from '@dascade/ui';
import { session, useGame } from '../../net/hooks.ts';
import type { SettingsPanelProps } from '../types.ts';
import { fmt } from './helpers.ts';

const BLIND_PRESETS: Array<[number, number]> = [
  [5, 10],
  [10, 20],
  [25, 50],
  [50, 100],
  [100, 200],
  [250, 500],
  [500, 1000],
  [1000, 2000],
  [2500, 5000],
];

/** Local draft that follows the server value and sends changes after a short pause. */
function useDraft<T>(value: T, commit: (v: T) => void, delay = 400): [T, (v: T) => void] {
  const [draft, setDraft] = useState(value);
  const timer = useRef<number | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const latest = useRef(value);
  latest.current = value;
  // Follow server changes (compared by value: tuples arrive as fresh arrays every render).
  const key = JSON.stringify(value);
  useEffect(() => {
    if (timer.current === null) setDraft(latest.current);
  }, [key]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const set = (v: T) => {
    setDraft(v);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      commitRef.current(v);
    }, delay);
  };
  return [draft, set];
}

export function HoldemSettingsPanel({ settings: raw, canEdit, update }: SettingsPanelProps<HoldemSettings>) {
  const s: HoldemSettings = { ...DEFAULT_HOLDEM_SETTINGS, ...raw };
  const [stack, setStack] = useDraft(s.startingStack, (v) => {
    if (v >= HOLDEM_MIN_STACK && v <= HOLDEM_MAX_STACK && v >= s.bigBlind * 10) update({ startingStack: v });
  });
  const [blinds, setBlinds] = useDraft<[number, number]>([s.smallBlind, s.bigBlind], ([sb, bb]) => {
    if (sb >= 1 && bb >= sb && s.startingStack >= bb * 10) update({ smallBlind: sb, bigBlind: bb });
  });
  const [every, setEvery] = useDraft(s.blindIncreaseEvery, (v) => update({ blindIncreaseEvery: v }));
  const [sb, bb] = blinds;
  const stackError =
    stack < HOLDEM_MIN_STACK || stack > HOLDEM_MAX_STACK
      ? `Between ${fmt(HOLDEM_MIN_STACK)} and ${fmt(HOLDEM_MAX_STACK)}.`
      : stack < bb * 10
        ? `At least 10 big blinds (${fmt(bb * 10)}).`
        : undefined;
  const blindError = bb < sb ? 'The big blind must be at least the small blind.' : bb * 10 > s.startingStack ? 'Too big for the starting stack (needs 10 big blinds).' : undefined;
  const presetValue = BLIND_PRESETS.find(([a, b]) => a === sb && b === bb) ? `${sb}/${bb}` : 'custom';

  return (
    <div className="hd-settings">
      <Field label="Starting stack" hint={stackError ? undefined : `${fmt(Math.floor(stack / Math.max(1, bb)))} big blinds deep · virtual chips`} error={stackError}>
        {({ id, describedBy }) => (
          <NumberInput id={id} aria-describedby={describedBy} value={stack} min={HOLDEM_MIN_STACK} max={HOLDEM_MAX_STACK} step={1000} disabled={!canEdit} onChange={setStack} />
        )}
      </Field>

      <Field label="Blinds" hint="Small blind / big blind" error={blindError}>
        {({ id, describedBy }) => (
          <div className="hd-settings__blinds">
            <Select
              id={id}
              aria-describedby={describedBy}
              value={presetValue}
              disabled={!canEdit}
              onChange={(e) => {
                const v = e.currentTarget.value;
                if (v === 'custom') return;
                const [a, b] = v.split('/').map(Number) as [number, number];
                setBlinds([a, b]);
              }}
            >
              {BLIND_PRESETS.map(([a, b]) => (
                <option key={`${a}/${b}`} value={`${a}/${b}`} disabled={b * 10 > s.startingStack}>
                  {formatBlinds(a, b)}
                </option>
              ))}
              <option value="custom">Custom</option>
            </Select>
            <NumberInput aria-label="Small blind" value={sb} min={1} max={50_000} disabled={!canEdit} onChange={(v) => setBlinds([v, bb])} />
            <span className="hd-settings__slash" aria-hidden>
              /
            </span>
            <NumberInput aria-label="Big blind" value={bb} min={2} max={100_000} disabled={!canEdit} onChange={(v) => setBlinds([sb, v])} />
          </div>
        )}
      </Field>

      <div className="hd-settings__group">
        <Toggle
          label="Raise the blinds over time"
          checked={s.blindIncreaseEvery > 0}
          disabled={!canEdit}
          onChange={(on) => update({ blindIncreaseEvery: on ? 10 : 0 })}
        />
        {s.blindIncreaseEvery > 0 ? (
          <div className="hd-settings__row">
            <Field label="Every" hint="hands">
              {({ id, describedBy }) => <NumberInput id={id} aria-describedby={describedBy} value={every} min={1} max={100} disabled={!canEdit} onChange={setEvery} />}
            </Field>
            <div className="dc-field">
              <span className="dc-field__label">Increase</span>
              <Segmented
                label="Blind increase"
                value={String(s.blindIncreasePct)}
                disabled={!canEdit}
                onChange={(v) => update({ blindIncreasePct: Number(v) })}
                options={[
                  { value: '25', label: '+25%' },
                  { value: '50', label: '+50%' },
                  { value: '100', label: '×2' },
                ]}
              />
            </div>
          </div>
        ) : null}
      </div>

      <Field label="Action timer" aside={<span className="hd-settings__value">{s.actionSeconds}s</span>}>
        {({ id }) => (
          <Slider id={id} value={s.actionSeconds} min={10} max={60} step={5} disabled={!canEdit} onChange={(v) => update({ actionSeconds: v })} />
        )}
      </Field>

      <Toggle label="Free virtual rebuys when a player busts" checked={s.allowRebuys} disabled={!canEdit} onChange={(allowRebuys) => update({ allowRebuys })} />

      <div className="dc-field">
        <span className="dc-field__label">Showdown</span>
        <Segmented
          label="Showdown reveal"
          value={s.showdownReveal}
          disabled={!canEdit}
          onChange={(showdownReveal) => update({ showdownReveal })}
          options={[
            { value: 'all', label: 'Table every hand' },
            { value: 'winners', label: 'Winners only' },
          ]}
        />
        <span className="dc-field__hint">
          {s.showdownReveal === 'all' ? 'Every hand still live at showdown is turned face up.' : 'Losing hands are mucked face down. All-in hands are always tabled.'}
        </span>
      </div>
    </div>
  );
}

/** Lobby seat picker: tap an open seat (or get one automatically at the start). */
export function SeatPicker() {
  const game = useGame<HoldemPublicState, HoldemSettings>();
  if (!game) return null;
  const { state, playerId } = game;
  const size = state.tableSize;
  const mySeat = state.seats.findIndex((s) => s.playerId === playerId);
  return (
    <div className="hd-picker">
      <p className="dc-field__hint">{mySeat >= 0 ? `You’re in seat ${mySeat + 1}. Tap another open seat to move.` : 'Pick your seat — or you’ll be seated automatically when the game starts.'}</p>
      <div className="hd-picker__table">
        <div className="hd-picker__felt" aria-hidden />
        {state.seats.slice(0, size).map((seat, i) => {
          const t = Math.PI / 2 + (i / size) * Math.PI * 2;
          const style = { left: `${50 + 43 * Math.cos(t)}%`, top: `${50 + 38 * Math.sin(t)}%` } as CSSProperties;
          const p = seat.playerId ? state.players[seat.playerId] : undefined;
          const mine = seat.playerId === playerId;
          return seat.playerId ? (
            <span key={i} className={cx('hd-picker__seat', mine && 'hd-picker__seat--me')} style={style} aria-label={`Seat ${i + 1}: ${seat.name}`}>
              <Avatar avatar={p?.avatar ?? 'ghost'} color={p?.color ?? '#8f88b3'} size={26} />
              <span className="hd-picker__name">{mine ? 'You' : seat.name}</span>
            </span>
          ) : (
            <button key={i} type="button" className="hd-picker__seat hd-picker__seat--open" style={style} onClick={() => session.send(HOLDEM_MSG.sit, { seat: i })} aria-label={`Take seat ${i + 1}`}>
              <PixelIcon name="plus" />
              <span className="hd-picker__name">Seat {i + 1}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
