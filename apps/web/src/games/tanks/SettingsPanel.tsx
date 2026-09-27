/** Host battle settings: mode, CPU tanks, terrain, wind, turn time, armor, arsenal, driving, rounds. */
import { useEffect, useRef } from 'react';
import { createSeededRng } from '@dascade/shared';
import { CPU_SKILLS, CPU_SKILL_LABEL, MAX_TANKS, TERRAIN_STYLES, type TanksSettings, type TerrainStyle } from '@dascade/shared/games/tanks';
import { generateTerrain, TERRAIN_STYLE_LIST } from '@dascade/game-core/tanks';
import { Field, IconButton, Segmented, Toggle, cx } from '@dascade/ui';
import type { SettingsPanelProps } from '../types.ts';

/** Representative preview seeds per style. */
const THUMB_SEED: Record<Exclude<TerrainStyle, 'random'>, number> = { hills: 5, mesa: 3, valley: 1, peaks: 6 };

const STYLE_LABEL: Record<TerrainStyle, string> = { random: 'Random', hills: 'Hills', mesa: 'Mesa', valley: 'Valley', peaks: 'Peaks' };

function TerrainThumb({ style }: { style: TerrainStyle }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = 112;
    const h = 40;
    c.width = w * dpr;
    c.height = h * dpr;
    const g = c.getContext('2d');
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    const styles = style === 'random' ? TERRAIN_STYLE_LIST : [style];
    styles.forEach((s, i) => {
      const t = generateTerrain(createSeededRng(`thumb-${s}-${THUMB_SEED[s]}`), s);
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= w; x++) {
        const col = Math.min(t.width - 1, Math.floor((x / w) * t.width));
        g.lineTo(x, h - (t.h[col]! / 760) * h * 0.95);
      }
      g.lineTo(w, h);
      g.closePath();
      g.fillStyle = style === 'random' ? `rgba(255,138,61,${0.18 + i * 0.08})` : 'rgba(255,138,61,0.55)';
      g.fill();
      g.strokeStyle = '#fde047';
      g.lineWidth = style === 'random' ? 0.8 : 1.4;
      g.stroke();
    });
  }, [style]);
  return <canvas ref={ref} className="tk-terrain-thumb" aria-hidden />;
}

export function TanksSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<TanksSettings>) {
  const cpu = settings.cpu ?? 0;
  const teams = settings.mode === 'teams';
  return (
    <div className="tk-settings">
      <div className="dc-field">
        <span className="dc-field__label">Mode</span>
        <Segmented
          label="Mode"
          value={settings.mode ?? 'ffa'}
          disabled={!canEdit}
          options={[
            { value: 'ffa', label: 'Free-for-all' },
            { value: 'teams', label: 'Teams' },
          ]}
          onChange={(mode) => update({ mode })}
        />
      </div>

      <div className="tk-settings__row">
        <Field label="CPU tanks" hint={`Adds computer gunners (up to ${MAX_TANKS} tanks in total)`}>
          {({ id }) => (
            <div className="tk-stepper" id={id}>
              <IconButton icon="minus" label="Fewer CPU tanks" size="sm" disabled={!canEdit || cpu <= 0} onClick={() => update({ cpu: cpu - 1 })} />
              <output aria-live="polite" aria-label="CPU tanks">
                {cpu}
              </output>
              <IconButton icon="plus" label="More CPU tanks" size="sm" disabled={!canEdit || cpu >= MAX_TANKS - 1} onClick={() => update({ cpu: cpu + 1 })} />
            </div>
          )}
        </Field>
        <div className="dc-field">
          <span className="dc-field__label">CPU skill</span>
          <Segmented
            label="CPU skill"
            value={settings.cpuSkill ?? 'veteran'}
            disabled={!canEdit || cpu === 0}
            options={CPU_SKILLS.map((s) => ({ value: s, label: CPU_SKILL_LABEL[s] }))}
            onChange={(cpuSkill) => update({ cpuSkill })}
          />
        </div>
      </div>

      <div className="dc-field">
        <span className="dc-field__label" id="tk-terrain-label">
          Terrain
        </span>
        <div className="tk-terrains" role="radiogroup" aria-labelledby="tk-terrain-label">
          {TERRAIN_STYLES.map((style) => (
            <button
              key={style}
              type="button"
              role="radio"
              aria-checked={settings.terrain === style}
              aria-label={`${STYLE_LABEL[style]} terrain`}
              disabled={!canEdit}
              className={cx('tk-terrain', settings.terrain === style && 'is-on')}
              onClick={() => update({ terrain: style })}
            >
              <TerrainThumb style={style} />
              <span>{STYLE_LABEL[style]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="tk-settings__grid">
        <div className="dc-field">
          <span className="dc-field__label">Wind</span>
          <Segmented
            label="Wind"
            value={settings.wind ?? 'normal'}
            disabled={!canEdit}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'light', label: 'Light' },
              { value: 'normal', label: 'Normal' },
              { value: 'strong', label: 'Strong' },
            ]}
            onChange={(wind) => update({ wind })}
          />
        </div>
        <div className="dc-field">
          <span className="dc-field__label">Turn time</span>
          <Segmented
            label="Turn time"
            value={String(settings.turnSeconds ?? 30)}
            disabled={!canEdit}
            options={[15, 20, 30, 45, 60].map((s) => ({ value: String(s), label: `${s}s` }))}
            onChange={(v) => update({ turnSeconds: Number(v) })}
          />
        </div>
        <div className="dc-field">
          <span className="dc-field__label">Armor</span>
          <Segmented
            label="Armor"
            value={String(settings.armor ?? 100)}
            disabled={!canEdit}
            options={[100, 150, 200].map((s) => ({ value: String(s), label: String(s) }))}
            onChange={(v) => update({ armor: Number(v) })}
          />
        </div>
        <div className="dc-field">
          <span className="dc-field__label">Arsenal</span>
          <Segmented
            label="Arsenal"
            value={settings.arsenal ?? 'standard'}
            disabled={!canEdit}
            options={[
              { value: 'standard', label: 'Standard' },
              { value: 'plenty', label: 'Plenty' },
              { value: 'shells', label: 'Shells only' },
            ]}
            onChange={(arsenal) => update({ arsenal })}
          />
        </div>
        <div className="dc-field">
          <span className="dc-field__label">Driving</span>
          <Segmented
            label="Driving"
            value={settings.movement ?? 'short'}
            disabled={!canEdit}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'short', label: 'Short' },
              { value: 'long', label: 'Long' },
            ]}
            onChange={(movement) => update({ movement })}
          />
        </div>
        <div className="dc-field">
          <span className="dc-field__label">Round limit</span>
          <Segmented
            label="Round limit"
            value={String(settings.maxRounds ?? 15)}
            disabled={!canEdit}
            options={[10, 15, 20, 30].map((s) => ({ value: String(s), label: String(s) }))}
            onChange={(v) => update({ maxRounds: Number(v) })}
          />
        </div>
      </div>

      <div className="tk-settings__ff">
        <Toggle
          label="Friendly fire"
          checked={Boolean(settings.friendlyFire)}
          disabled={!canEdit || !teams}
          onChange={(friendlyFire) => update({ friendlyFire })}
        />
        <p className="dc-muted tk-settings__note">
          {teams
            ? settings.friendlyFire
              ? 'Teammates can be hurt by your shells (blasts and falls).'
              : 'Nothing you fire can hurt a teammate. You still take your own splash damage.'
            : 'Teams only. In free-for-all every shell hurts every tank — including yours.'}
        </p>
      </div>
    </div>
  );
}
