/** Lobby settings: grid, fleet preset, spacing rule, firing mode, clocks. Host edits; everyone sees. */
import { useId, type CSSProperties, type ReactNode } from 'react';
import {
  DEFAULT_SHIPS_SETTINGS,
  SHIPS_FIRING_LABELS,
  SHIPS_FIRING_MODES,
  SHIPS_FLEETS,
  SHIPS_FLEET_IDS,
  SHIPS_PLACEMENT_SECONDS,
  SHIPS_TURN_SECONDS,
  SHIPS_UNTIMED_IDLE_SECONDS,
  VESSELS,
  fleetCells,
  type ShipsFiringMode,
  type ShipsFleetId,
  type ShipsSettings,
  type ShipsSpacing,
  type ShipsTimeoutRule,
} from '@dascade/shared/games/ships';
import { Field, Segmented, Select, cx } from '@dascade/ui';
import type { SettingsPanelProps } from '../types.ts';
import { VesselIcon } from './art.tsx';

const GRID_OPTIONS = [
  { value: '8', label: '8×8' },
  { value: '10', label: '10×10' },
  { value: '12', label: '12×12' },
] as const;

export function ShipsSettingsPanel({ settings: raw, canEdit, update }: SettingsPanelProps<ShipsSettings>) {
  const s: ShipsSettings = { ...DEFAULT_SHIPS_SETTINGS, ...raw };
  const setGrid = (g: 8 | 10 | 12) => {
    // Keep the pair valid in one update (the server validates the whole object).
    if (g < SHIPS_FLEETS[s.fleet].minGrid) update({ gridSize: g, fleet: 'standard' });
    else update({ gridSize: g });
  };
  return (
    <div className="sh-settings">
      <Group label="Grid" hint={`${s.gridSize * s.gridSize} squares per sea`}>
        <Segmented
          label="Grid size"
          value={String(s.gridSize) as '8' | '10' | '12'}
          options={GRID_OPTIONS}
          disabled={!canEdit}
          onChange={(v) => setGrid(Number(v) as 8 | 10 | 12)}
        />
      </Group>

      <div className="dc-field">
        <span className="dc-field__label" id="sh-fleet-label">
          Fleet
        </span>
        <div className="sh-fleet-pick" role="radiogroup" aria-labelledby="sh-fleet-label">
          {SHIPS_FLEET_IDS.map((id) => {
            const f = SHIPS_FLEETS[id];
            const fits = s.gridSize >= f.minGrid;
            const on = s.fleet === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!canEdit || !fits}
                className={cx('sh-fleet-pick__card', on && 'is-on')}
                onClick={() => update({ fleet: id as ShipsFleetId })}
                title={fits ? f.blurb : `Needs a ${f.minGrid}×${f.minGrid} grid or larger`}
              >
                <span className="sh-fleet-pick__name">{f.name}</span>
                <span className="sh-fleet-pick__meta">
                  {f.vessels.length} vessels · {fleetCells(id)} squares
                </span>
                <span className="sh-fleet-pick__icons" aria-hidden>
                  {f.vessels.map((v) => (
                    <span key={v} style={{ '--len': VESSELS[v].length } as CSSProperties}>
                      <VesselIcon id={v} />
                    </span>
                  ))}
                </span>
                {!fits ? (
                  <span className="sh-fleet-pick__warn">
                    Needs {f.minGrid}×{f.minGrid}+
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <Group label="Firing" hint={SHIPS_FIRING_LABELS[s.firing].blurb}>
        <Segmented<ShipsFiringMode>
          label="Firing mode"
          value={s.firing}
          disabled={!canEdit}
          options={SHIPS_FIRING_MODES.map((m) => ({ value: m, label: SHIPS_FIRING_LABELS[m].name }))}
          onChange={(v) => update({ firing: v })}
        />
      </Group>

      <Group
        label="Spacing"
        hint={s.spacing === 'apart' ? 'No two vessels may touch — not even corner to corner.' : 'Vessels may sit side by side.'}
      >
        <Segmented<ShipsSpacing>
          label="Vessel spacing"
          value={s.spacing}
          disabled={!canEdit}
          options={[
            { value: 'touching', label: 'May touch' },
            { value: 'apart', label: 'Keep apart' },
          ]}
          onChange={(v) => update({ spacing: v })}
        />
      </Group>

      <div className="sh-settings__row">
        <Field label="Turn clock">
          {({ id }) => (
            <Select
              id={id}
              value={String(s.turnSeconds)}
              disabled={!canEdit}
              onChange={(e) => update({ turnSeconds: Number(e.currentTarget.value) })}
            >
              {SHIPS_TURN_SECONDS.map((t) => (
                <option key={t} value={t}>
                  {t === 0 ? 'Untimed' : `${t} s per turn`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Deployment time">
          {({ id }) => (
            <Select
              id={id}
              value={String(s.placementSeconds)}
              disabled={!canEdit}
              onChange={(e) => update({ placementSeconds: Number(e.currentTarget.value) })}
            >
              {SHIPS_PLACEMENT_SECONDS.map((t) => (
                <option key={t} value={t}>
                  {t % 60 === 0 ? `${t / 60} min` : `${Math.floor(t / 60)} min ${t % 60} s`}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Group
        label="When the turn clock runs out"
        hint={
          s.turnSeconds === 0
            ? `Untimed: a captain idle for ${SHIPS_UNTIMED_IDLE_SECONDS / 60} minutes auto-fires; three idle turns in a row forfeit.`
            : 'Three timeouts in a row forfeit the game.'
        }
      >
        <Segmented<ShipsTimeoutRule>
          label="Timeout rule"
          value={s.onTimeout}
          disabled={!canEdit || s.turnSeconds === 0}
          options={[
            { value: 'autofire', label: 'Auto-fire' },
            { value: 'skip', label: 'Lose the turn' },
          ]}
          onChange={(v) => update({ onTimeout: v })}
        />
      </Group>
    </div>
  );
}

/** A labelled control group (segmented radios aren't <label>-able form fields). */
function Group({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div className="dc-field" role="group" aria-labelledby={`${id}-l`}>
      <span className="dc-field__label" id={`${id}-l`}>
        {label}
      </span>
      {children}
      {hint ? <div className="dc-field__hint">{hint}</div> : null}
    </div>
  );
}
