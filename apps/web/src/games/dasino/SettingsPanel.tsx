import { useEffect, useRef, useState } from 'react';
import { Field, NumberInput, Slider, Toggle } from '@dascade/ui';
import { DASINO_LIMITS, DEFAULT_DASINO_SETTINGS, type DasinoSettings } from '@dascade/shared/games/dasino';
import type { SettingsPanelProps } from '../types.ts';
import { fmt } from './ui.ts';

/** Local draft for a number field, flushed to the server after a short pause. */
function useDebounced<T>(value: T, commit: (v: T) => void, ms = 400): [T, (v: T) => void] {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => setDraft(value), [value]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const update = (v: T) => {
    setDraft(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commitRef.current(v), ms);
  };
  return [draft, update];
}

export function DasinoSettingsPanel({ settings: raw, canEdit, update }: SettingsPanelProps<DasinoSettings>) {
  const settings = { ...DEFAULT_DASINO_SETTINGS, ...raw };
  const [start, setStart] = useDebounced(settings.startingBalance, (v) => update({ startingBalance: v }));
  const [minBet, setMinBet] = useDebounced(settings.minBet, (v) => update({ minBet: v }));
  const [maxBet, setMaxBet] = useDebounced(settings.maxBet, (v) => update({ maxBet: v }));
  const [rouletteSecs, setRouletteSecs] = useDebounced(settings.rouletteBettingSeconds, (v) => update({ rouletteBettingSeconds: v }), 250);
  const [diceSecs, setDiceSecs] = useDebounced(settings.diceBettingSeconds, (v) => update({ diceBettingSeconds: v }), 250);
  return (
    <div className="dn-settings">
      <Field label="Starting chips" hint="Everyone starts with this many virtual chips.">
        {({ id, describedBy }) => (
          <NumberInput
            id={id}
            aria-describedby={describedBy}
            value={start}
            min={DASINO_LIMITS.minStartingBalance}
            max={DASINO_LIMITS.maxStartingBalance}
            step={100}
            disabled={!canEdit}
            onChange={setStart}
          />
        )}
      </Field>
      <div className="dn-settings__row">
        <Field label="Min bet" hint="Smallest chip / slot bet.">
          {({ id, describedBy }) => (
            <NumberInput id={id} aria-describedby={describedBy} value={minBet} min={DASINO_LIMITS.minBet} max={DASINO_LIMITS.maxBet} disabled={!canEdit} onChange={setMinBet} />
          )}
        </Field>
        <Field label="Max bet" hint="Per spot, per pick and per spin.">
          {({ id, describedBy }) => (
            <NumberInput id={id} aria-describedby={describedBy} value={maxBet} min={DASINO_LIMITS.minBet} max={DASINO_LIMITS.maxBet} disabled={!canEdit} onChange={setMaxBet} />
          )}
        </Field>
      </div>
      <Field label="Roulette betting time" aside={`${rouletteSecs}s`}>
        {({ id }) => (
          <Slider
            id={id}
            aria-label="Roulette betting time"
            value={rouletteSecs}
            min={DASINO_LIMITS.minBettingSeconds}
            max={DASINO_LIMITS.maxBettingSeconds}
            disabled={!canEdit}
            onChange={setRouletteSecs}
          />
        )}
      </Field>
      <Field label="Dice betting time" aside={`${diceSecs}s`}>
        {({ id }) => (
          <Slider
            id={id}
            aria-label="Dice betting time"
            value={diceSecs}
            min={DASINO_LIMITS.minBettingSeconds}
            max={DASINO_LIMITS.maxBettingSeconds}
            disabled={!canEdit}
            onChange={setDiceSecs}
          />
        )}
      </Field>
      <Toggle
        label={settings.allowRefills ? `Free refills on (back to ${fmt(settings.startingBalance)} when broke)` : 'Free refills off'}
        checked={settings.allowRefills}
        disabled={!canEdit}
        onChange={(allowRefills) => update({ allowRefills })}
      />
      <p className="dc-field__hint">Virtual chips only — there is no real money, no chip purchases and no cash-out in DASino.</p>
    </div>
  );
}
