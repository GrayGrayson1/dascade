/**
 * Host-editable table rules. Used in the lobby and (applied from the next round)
 * from the in-game table menu. Numeric inputs are debounced before sending.
 */
import { useEffect, useRef, useState } from 'react';
import { formatChips } from '@dascade/shared';
import {
  BLACKJACK_LIMITS,
  DEFAULT_BLACKJACK_SETTINGS,
  tableArcText,
  type BlackjackSettings,
} from '@dascade/shared/games/blackjack';
import { Button, Field, NumberInput, Segmented, Select, Slider, Toggle } from '@dascade/ui';
import type { SettingsPanelProps } from '../types.ts';

type Patch = Partial<BlackjackSettings>;

const PRESETS: Array<{ id: string; label: string; hint: string; patch: Patch }> = [
  {
    id: 'strip',
    label: 'Vegas Strip',
    hint: '6 decks · S17 · 3:2 · DAS · surrender',
    patch: {
      decks: 6,
      dealerHitsSoft17: false,
      blackjackPayout: '3:2',
      doubleRule: 'any',
      doubleAfterSplit: true,
      maxHands: 4,
      resplitAces: false,
      hitSplitAces: false,
      surrender: true,
      insurance: true,
      dealerPeek: true,
    },
  },
  {
    id: 'downtown',
    label: 'Downtown',
    hint: '2 decks · H17 · 3:2 · re-split aces',
    patch: {
      decks: 2,
      dealerHitsSoft17: true,
      blackjackPayout: '3:2',
      doubleRule: 'any',
      doubleAfterSplit: true,
      maxHands: 4,
      resplitAces: true,
      hitSplitAces: false,
      surrender: false,
      insurance: true,
      dealerPeek: true,
    },
  },
  {
    id: 'single',
    label: 'Single deck',
    hint: '1 deck · H17 · 6:5 · double 10–11',
    patch: {
      decks: 1,
      dealerHitsSoft17: true,
      blackjackPayout: '6:5',
      doubleRule: '10-11',
      doubleAfterSplit: false,
      maxHands: 2,
      resplitAces: false,
      hitSplitAces: false,
      surrender: false,
      insurance: true,
      dealerPeek: true,
    },
  },
  {
    id: 'euro',
    label: 'European',
    hint: '6 decks · no peek · 3:2 · no surrender',
    patch: {
      decks: 6,
      dealerHitsSoft17: false,
      blackjackPayout: '3:2',
      doubleRule: '9-11',
      doubleAfterSplit: true,
      maxHands: 3,
      resplitAces: false,
      hitSplitAces: false,
      surrender: false,
      insurance: true,
      dealerPeek: false,
    },
  },
];

/** A number that is edited locally and sent after a short pause (settings are rate-limited). */
function useDebounced<T>(value: T, commit: (v: T) => void, delay = 400): [T, (v: T) => void, () => void] {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<T | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    if (pending.current === null) setLocal(value);
  }, [value]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current !== null) {
      const v = pending.current;
      pending.current = null;
      commitRef.current(v);
    }
  };
  const set = (v: T) => {
    setLocal(v);
    pending.current = v;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };
  return [local, set, flush];
}

function NumberSetting({
  label,
  hint,
  value,
  min,
  max,
  step,
  disabled,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled: boolean;
  onCommit: (v: number) => void;
}) {
  const [local, set, flush] = useDebounced(value, (v) => onCommit(Math.min(max, Math.max(min, Math.round(v)))));
  return (
    <Field label={label} hint={hint}>
      {({ id, describedBy }) => (
        <NumberInput id={id} aria-describedby={describedBy} value={local} min={min} max={max} step={step} disabled={disabled} onChange={set} onBlur={flush} />
      )}
    </Field>
  );
}

function SliderSetting({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  disabled: boolean;
  onCommit: (v: number) => void;
}) {
  const [local, set, flush] = useDebounced(value, onCommit, 300);
  return (
    <Field label={label} aside={<span className="dc-num">{`${local}${unit}`}</span>}>
      {({ id, describedBy }) => (
        <Slider id={id} aria-describedby={describedBy} value={local} min={min} max={max} step={step} disabled={disabled} onChange={set} onPointerUp={flush} onBlur={flush} />
      )}
    </Field>
  );
}

export function BlackjackSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<BlackjackSettings>) {
  const s: BlackjackSettings = { ...DEFAULT_BLACKJACK_SETTINGS, ...settings };
  const off = !canEdit;
  const activePreset = PRESETS.find((p) => Object.entries(p.patch).every(([k, v]) => s[k as keyof BlackjackSettings] === v))?.id;
  return (
    <div className="bj-settings">
      <p className="bj-settings__arc">{tableArcText(s)}</p>

      <div className="bj-settings__presets" role="group" aria-label="Rule presets">
        {PRESETS.map((p) => (
          <Button
            key={p.id}
            size="sm"
            variant={activePreset === p.id ? 'primary' : 'secondary'}
            disabled={off}
            aria-pressed={activePreset === p.id}
            onClick={() => update(p.patch)}
            title={p.hint}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <div className="bj-settings__grid">
        <Field label="Decks in the shoe">
          {({ id }) => (
            <Select id={id} value={s.decks} disabled={off} onChange={(e) => update({ decks: Number(e.currentTarget.value) })}>
              {Array.from({ length: BLACKJACK_LIMITS.maxDecks }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} deck{n === 1 ? '' : 's'}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="dc-field">
          <span className="dc-field__label">Dealer on soft 17</span>
          <Segmented
            label="Dealer on soft 17"
            value={s.dealerHitsSoft17 ? 'hit' : 'stand'}
            disabled={off}
            onChange={(v) => update({ dealerHitsSoft17: v === 'hit' })}
            options={[
              { value: 'stand', label: 'Stands (S17)' },
              { value: 'hit', label: 'Hits (H17)' },
            ]}
          />
        </div>
        <div className="dc-field">
          <span className="dc-field__label">Blackjack pays</span>
          <Segmented
            label="Blackjack pays"
            value={s.blackjackPayout}
            disabled={off}
            onChange={(v) => update({ blackjackPayout: v })}
            options={[
              { value: '3:2', label: '3 : 2' },
              { value: '6:5', label: '6 : 5' },
              { value: '1:1', label: '1 : 1' },
            ]}
          />
        </div>
        <div className="dc-field">
          <span className="dc-field__label">Double down on</span>
          <Segmented
            label="Double down on"
            value={s.doubleRule}
            disabled={off}
            onChange={(v) => update({ doubleRule: v })}
            options={[
              { value: 'any', label: 'Any two' },
              { value: '9-11', label: 'Hard 9–11' },
              { value: '10-11', label: 'Hard 10–11' },
            ]}
          />
        </div>
        <div className="dc-field">
          <span className="dc-field__label">Splitting</span>
          <Segmented
            label="Maximum hands after splits"
            value={String(s.maxHands)}
            disabled={off}
            onChange={(v) => update({ maxHands: Number(v) })}
            options={[
              { value: '1', label: 'No split' },
              { value: '2', label: '2 hands' },
              { value: '3', label: '3 hands' },
              { value: '4', label: '4 hands' },
            ]}
          />
        </div>
      </div>

      <div className="bj-settings__toggles">
        <Toggle label="Double after split" checked={s.doubleAfterSplit} disabled={off || s.maxHands <= 1} onChange={(v) => update({ doubleAfterSplit: v })} />
        <Toggle label="Re-split aces" checked={s.resplitAces} disabled={off || s.maxHands <= 2} onChange={(v) => update({ resplitAces: v })} />
        <Toggle label="Hit split aces" checked={s.hitSplitAces} disabled={off || s.maxHands <= 1} onChange={(v) => update({ hitSplitAces: v })} />
        <Toggle label="Late surrender" checked={s.surrender} disabled={off} onChange={(v) => update({ surrender: v })} />
        <Toggle label="Insurance / even money" checked={s.insurance} disabled={off} onChange={(v) => update({ insurance: v })} />
        <Toggle label="Dealer peeks for blackjack" checked={s.dealerPeek} disabled={off} onChange={(v) => update({ dealerPeek: v })} />
      </div>

      <div className="bj-settings__grid bj-settings__grid--3">
        <NumberSetting label="Min bet" value={s.minBet} min={BLACKJACK_LIMITS.minBet} max={Math.min(s.maxBet, s.startingBalance)} disabled={off} onCommit={(minBet) => update({ minBet })} />
        <NumberSetting label="Max bet" value={s.maxBet} min={s.minBet} max={BLACKJACK_LIMITS.maxBet} disabled={off} onCommit={(maxBet) => update({ maxBet })} />
        <NumberSetting
          label="Starting chips"
          hint="Free refills top you back up to this."
          value={s.startingBalance}
          min={Math.max(BLACKJACK_LIMITS.minStartingBalance, s.minBet)}
          max={BLACKJACK_LIMITS.maxStartingBalance}
          step={100}
          disabled={off}
          onCommit={(startingBalance) => update({ startingBalance })}
        />
      </div>

      <div className="bj-settings__grid bj-settings__grid--3">
        <SliderSetting label="Betting window" value={s.bettingSeconds} min={5} max={60} unit="s" disabled={off} onCommit={(bettingSeconds) => update({ bettingSeconds })} />
        <SliderSetting label="Decision timer" value={s.decisionSeconds} min={5} max={60} unit="s" disabled={off} onCommit={(decisionSeconds) => update({ decisionSeconds })} />
        <SliderSetting label="Cut card" value={s.penetration} min={50} max={90} step={5} unit="%" disabled={off} onCommit={(penetration) => update({ penetration })} />
      </div>

      <p className="dc-field__hint">
        Virtual chips only — no purchases, no cash value. Fractional payouts round down. Table limits {formatChips(s.minBet)}–{formatChips(s.maxBet)}.
      </p>
    </div>
  );
}
