/**
 * Host match settings: mode and turn style, match length and economy, CPU crews, the
 * battlefield (terrain, walls, gravity, wind), the rules (turn time, armor, driving, round
 * limit, friendly fire) and the flavor (talking tanks, hazards).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { createSeededRng } from '@dascade/shared';
import {
  BATTLE_COUNTS,
  CPU_SKILLS,
  CPU_SKILL_LABEL,
  GRAVITY_LABEL,
  GRAVITY_LEVELS,
  MAX_TANKS,
  START_CREDITS,
  TERRAIN_LABEL,
  TERRAIN_STYLES,
  WALL_LABEL,
  WALL_MODES,
  type ConcreteTerrainStyle,
  type TanksSettings,
  type TerrainStyle,
} from '@dascade/shared/games/tanks';
import { generateTerrain, TERRAIN_STYLE_LIST } from '@dascade/game-core/tanks';
import { Field, IconButton, Segmented, Toggle, cx } from '@dascade/ui';
import type { SettingsPanelProps } from '../types.ts';

/** Representative preview seeds per style. */
const THUMB_SEED: Record<ConcreteTerrainStyle, number> = {
  hills: 5,
  mesa: 3,
  valley: 1,
  peaks: 6,
  dunes: 2,
  canyon: 4,
  cliffs: 7,
  islands: 3,
};

const WALL_NOTE: Record<string, string> = {
  random: 'A different edge rule every battle.',
  open: 'Shells that leave the field are lost.',
  wrap: 'Shells fly off one side and come in the other.',
  bounce: 'Shells bounce off the edges.',
  concrete: 'Shells burst on the edges.',
};

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
    const styles: readonly ConcreteTerrainStyle[] = style === 'random' ? TERRAIN_STYLE_LIST : [style];
    styles.forEach((s, i) => {
      const t = generateTerrain(createSeededRng(`thumb-${s}-${THUMB_SEED[s] ?? 1}`), s);
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= w; x++) {
        const col = Math.min(t.width - 1, Math.floor((x / w) * t.width));
        g.lineTo(x, h - (t.h[col]! / 760) * h * 0.95);
      }
      g.lineTo(w, h);
      g.closePath();
      g.fillStyle = style === 'random' ? `rgba(255,138,61,${0.08 + i * 0.03})` : 'rgba(255,138,61,0.55)';
      g.fill();
      g.strokeStyle = '#fde047';
      g.lineWidth = style === 'random' ? 0.6 : 1.4;
      g.stroke();
    });
  }, [style]);
  return <canvas ref={ref} className="tk-terrain-thumb" aria-hidden />;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="tk-settings__section">
      <h3 className="tk-settings__title">{title}</h3>
      {children}
    </section>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
  note,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  disabled: boolean;
  onChange: (v: T) => void;
  note?: ReactNode;
}) {
  return (
    <div className="dc-field">
      <span className="dc-field__label">{label}</span>
      <Segmented label={label} value={value} disabled={disabled} options={options} onChange={onChange} />
      {note ? <p className="dc-muted tk-settings__note">{note}</p> : null}
    </div>
  );
}

function shortCredits(n: number): string {
  return n === 0 ? 'None' : n >= 1000 ? `${n / 1000}k` : String(n);
}

export function TanksSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<TanksSettings>) {
  const cpu = settings.cpu ?? 0;
  const teams = settings.mode === 'teams';
  const economy = settings.economy ?? 'shop';
  const ro = !canEdit;
  return (
    <div className="tk-settings">
      <Section title="Match">
        <div className="tk-settings__grid">
          <Choice
            label="Mode"
            value={settings.mode ?? 'ffa'}
            disabled={ro}
            options={[
              { value: 'ffa', label: 'Free-for-all' },
              { value: 'teams', label: 'Teams' },
            ]}
            onChange={(mode) => update({ mode })}
          />
          <Choice
            label="Turns"
            value={settings.turnMode ?? 'turns'}
            disabled={ro}
            options={[
              { value: 'turns', label: 'One at a time' },
              { value: 'volley', label: 'Volley' },
            ]}
            onChange={(turnMode) => update({ turnMode })}
            note={
              settings.turnMode === 'volley'
                ? 'Everyone aims at once, then every shot flies together. Great for big groups.'
                : 'Classic artillery: tanks take turns.'
            }
          />
          <Choice
            label="Battles"
            value={String(settings.battles ?? 3)}
            disabled={ro}
            options={BATTLE_COUNTS.map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(v) => update({ battles: Number(v) })}
            note="A fresh battlefield each battle; the most points wins the match."
          />
          <Choice
            label="Economy"
            value={economy}
            disabled={ro}
            options={[
              { value: 'shop', label: 'Shop' },
              { value: 'stocked', label: 'Stocked' },
              { value: 'shells', label: 'Shells only' },
            ]}
            onChange={(v) => update({ economy: v })}
            note={
              economy === 'shop'
                ? 'Earn credits in battle, spend them in the armory between battles.'
                : economy === 'stocked'
                  ? 'Every tank gets the same mixed loadout each battle. No shop.'
                  : 'Standard shells only. Pure aim.'
            }
          />
          {economy === 'shop' ? (
            <Choice
              label="Starting credits"
              value={String(settings.startCredits ?? 20_000)}
              disabled={ro}
              options={START_CREDITS.map((n) => ({ value: String(n), label: shortCredits(n) }))}
              onChange={(v) => update({ startCredits: Number(v) })}
            />
          ) : null}
        </div>
      </Section>

      <Section title="Crews">
        <div className="tk-settings__row">
          <Field label="CPU tanks" hint={`Computer gunners with their own personalities (up to ${MAX_TANKS} tanks in total)`}>
            {({ id }) => (
              <div className="tk-stepper" id={id}>
                <IconButton
                  icon="minus"
                  label="Fewer CPU tanks"
                  size="sm"
                  disabled={ro || cpu <= 0}
                  onClick={() => update({ cpu: cpu - 1 })}
                />
                <output aria-live="polite" aria-label="CPU tanks">
                  {cpu}
                </output>
                <IconButton
                  icon="plus"
                  label="More CPU tanks"
                  size="sm"
                  disabled={ro || cpu >= MAX_TANKS - 1}
                  onClick={() => update({ cpu: cpu + 1 })}
                />
              </div>
            )}
          </Field>
          <Choice
            label="CPU skill"
            value={settings.cpuSkill ?? 'veteran'}
            disabled={ro || cpu === 0}
            options={CPU_SKILLS.map((s) => ({ value: s, label: CPU_SKILL_LABEL[s] }))}
            onChange={(cpuSkill) => update({ cpuSkill })}
          />
        </div>
      </Section>

      <Section title="Battlefield">
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
                aria-label={`${TERRAIN_LABEL[style]} terrain`}
                disabled={ro}
                className={cx('tk-terrain', settings.terrain === style && 'is-on')}
                onClick={() => update({ terrain: style })}
              >
                <TerrainThumb style={style} />
                <span>{TERRAIN_LABEL[style]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="tk-settings__grid">
          <Choice
            label="Walls"
            value={settings.walls ?? 'open'}
            disabled={ro}
            options={WALL_MODES.map((w) => ({ value: w, label: WALL_LABEL[w] }))}
            onChange={(walls) => update({ walls })}
            note={WALL_NOTE[settings.walls ?? 'open']}
          />
          <Choice
            label="Gravity"
            value={settings.gravity ?? 'normal'}
            disabled={ro}
            options={GRAVITY_LEVELS.map((g) => ({ value: g, label: GRAVITY_LABEL[g] }))}
            onChange={(gravity) => update({ gravity })}
          />
          <Choice
            label="Wind"
            value={settings.wind ?? 'normal'}
            disabled={ro}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'light', label: 'Light' },
              { value: 'normal', label: 'Normal' },
              { value: 'strong', label: 'Strong' },
            ]}
            onChange={(wind) => update({ wind })}
          />
        </div>
      </Section>

      <Section title="Rules">
        <div className="tk-settings__grid">
          <Choice
            label={settings.turnMode === 'volley' ? 'Aim time' : 'Turn time'}
            value={String(settings.turnSeconds ?? 30)}
            disabled={ro}
            options={[15, 20, 30, 45, 60].map((s) => ({ value: String(s), label: `${s}s` }))}
            onChange={(v) => update({ turnSeconds: Number(v) })}
          />
          <Choice
            label="Armor"
            value={String(settings.armor ?? 100)}
            disabled={ro}
            options={[100, 150, 200].map((s) => ({ value: String(s), label: String(s) }))}
            onChange={(v) => update({ armor: Number(v) })}
          />
          <Choice
            label="Driving"
            value={settings.movement ?? 'short'}
            disabled={ro}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'short', label: 'Short' },
              { value: 'long', label: 'Long' },
            ]}
            onChange={(movement) => update({ movement })}
          />
          <Choice
            label="Round limit"
            value={String(settings.maxRounds ?? 12)}
            disabled={ro}
            options={[8, 12, 15, 20, 30].map((s) => ({ value: String(s), label: String(s) }))}
            onChange={(v) => update({ maxRounds: Number(v) })}
            note="A battle still going after this many rounds goes to the tank with the most armor left."
          />
        </div>
        <div className="tk-settings__ff">
          <Toggle
            label="Friendly fire"
            checked={Boolean(settings.friendlyFire)}
            disabled={ro || !teams}
            onChange={(friendlyFire) => update({ friendlyFire })}
          />
          <p className="dc-muted tk-settings__note">
            {teams
              ? settings.friendlyFire
                ? 'Teammates can be hurt by your shells (blasts, fire and falls).'
                : 'Nothing you fire can hurt a teammate. You still take your own splash damage.'
              : 'Teams only. In free-for-all every shell hurts every tank — including yours.'}
          </p>
        </div>
      </Section>

      <Section title="Flavor">
        <div className="tk-settings__grid">
          <Choice
            label="Talking tanks"
            value={settings.talk ?? 'some'}
            disabled={ro}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'some', label: 'Some' },
              { value: 'lots', label: 'Lots' },
            ]}
            onChange={(talk) => update({ talk })}
            note="Speech bubbles when tanks fire and when they’re destroyed."
          />
          <div className="tk-settings__ff">
            <Toggle label="Hazards" checked={Boolean(settings.hazards)} disabled={ro} onChange={(hazards) => update({ hazards })} />
            <p className="dc-muted tk-settings__note">
              Now and then a meteor shower or a lightning strike hits the field. Nobody earns credits for it.
            </p>
          </div>
        </div>
      </Section>
    </div>
  );
}
