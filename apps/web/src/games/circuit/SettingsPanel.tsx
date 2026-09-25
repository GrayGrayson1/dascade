/** Host settings: track, laps, collisions, boost and the finish window. */
import { useEffect, useRef } from 'react';
import { CIRCUIT_TRACK_IDS, type CircuitSettings, type CircuitTrackId } from '@dascade/shared/games/circuit';
import { TRACK_DEFS, getTrack } from '@dascade/game-core/circuit';
import { Field, IconButton, Segmented, Toggle, cx } from '@dascade/ui';
import type { SettingsPanelProps } from '../types.ts';
import { minimapCanvas } from './art/worldArt.ts';

function TrackMap({ trackId }: { trackId: CircuitTrackId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const size = 160;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = Math.round(size * 0.66) * dpr;
    const g = c.getContext('2d');
    if (!g) return;
    const { canvas } = minimapCanvas(getTrack(trackId), c.width, c.height, 10 * dpr);
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(canvas, 0, 0);
  }, [trackId]);
  return <canvas ref={ref} className="ci-trackmap" aria-hidden />;
}

export function CircuitSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<CircuitSettings>) {
  const laps = settings.laps ?? 3;
  return (
    <div className="ci-settings">
      <div className="dc-field">
        <span className="dc-field__label" id="ci-track-label">
          Track
        </span>
        <div className="ci-tracks" role="radiogroup" aria-labelledby="ci-track-label">
          {CIRCUIT_TRACK_IDS.map((id) => {
            const def = TRACK_DEFS[id];
            const km = (getTrack(id).length * 0.075) / 1000;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={settings.track === id}
                aria-label={`${def.name} track`}
                disabled={!canEdit}
                className={cx('ci-track', settings.track === id && 'is-on')}
                onClick={() => update({ track: id })}
              >
                <TrackMap trackId={id} />
                <span className="ci-track__name">{def.name}</span>
                <span className="ci-track__meta">
                  {def.style} · {km.toFixed(2)} km
                </span>
                <span className="ci-track__tag">{def.tagline}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Field label="Laps" hint="1–10">
        {({ id }) => (
          <div className="ci-stepper" id={id}>
            <IconButton icon="minus" label="Fewer laps" size="sm" disabled={!canEdit || laps <= 1} onClick={() => update({ laps: laps - 1 })} />
            <output aria-live="polite" aria-label="Laps">
              {laps}
            </output>
            <IconButton icon="plus" label="More laps" size="sm" disabled={!canEdit || laps >= 10} onClick={() => update({ laps: laps + 1 })} />
          </div>
        )}
      </Field>

      <div className="ci-settings__toggles">
        <Toggle label="Car collisions" checked={settings.collisions !== false} disabled={!canEdit} onChange={(collisions) => update({ collisions })} />
        <Toggle label="Drift boost" checked={settings.boost !== false} disabled={!canEdit} onChange={(boost) => update({ boost })} />
      </div>

      <div className="dc-field">
        <span className="dc-field__label">Finish window after the winner</span>
        <Segmented
          label="Finish window"
          value={String(settings.finishWindowSec ?? 30)}
          disabled={!canEdit}
          options={[15, 30, 60, 90].map((s) => ({ value: String(s), label: `${s}s` }))}
          onChange={(v) => update({ finishWindowSec: Number(v) })}
        />
      </div>
    </div>
  );
}
