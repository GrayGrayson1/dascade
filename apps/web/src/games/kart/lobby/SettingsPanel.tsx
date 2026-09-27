/**
 * Host settings: mode (Race / Grand Prix / Time Trial — solo rooms only), track or cup, laps,
 * items, bots and their skill, the finish window. Read-only for guests and tournament rooms.
 */
import {
  KART_BOT_SKILLS,
  KART_CUPS,
  KART_CUP_IDS,
  KART_SIM,
  KART_TRACKS,
  type KartBotSkill,
  type KartCupId,
  type KartMode,
  type KartPublicState,
  type KartSettings,
  type KartTrackId,
} from '@dascade/shared/games/kart';
import { Badge, Field, IconButton, Segmented, Toggle, cx, handleRovingKeys, rovingTabIndex } from '@dascade/ui';
import type { SettingsPanelProps } from '../../types.ts';
import { useRoomSelector } from '../../../net/hooks.ts';
import { TrackThumb } from './TrackThumb.tsx';
import { BIOME_LABEL, trackBiome } from '../trackInfo.ts';

const MODE_LABEL: Record<KartMode, string> = { race: 'Race', gp: 'Grand Prix', timetrial: 'Time Trial' };
const SKILL_LABEL: Record<KartBotSkill, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled: boolean;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {({ id }) => (
        <div className="kp-stepper" id={id}>
          <IconButton
            icon="minus"
            label={`Fewer ${label.toLowerCase()}`}
            size="sm"
            disabled={disabled || value <= min}
            onClick={() => onChange(value - 1)}
          />
          <output aria-live="polite" aria-label={label}>
            {value}
          </output>
          <IconButton
            icon="plus"
            label={`More ${label.toLowerCase()}`}
            size="sm"
            disabled={disabled || value >= max}
            onClick={() => onChange(value + 1)}
          />
        </div>
      )}
    </Field>
  );
}

function TrackCard({
  id,
  on,
  onPick,
  disabled,
  tabIndex,
}: {
  id: KartTrackId;
  on: boolean;
  onPick: () => void;
  disabled: boolean;
  tabIndex: number;
}) {
  const t = KART_TRACKS[id];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      tabIndex={tabIndex}
      aria-label={`${t.name}: ${t.tagline}`}
      disabled={disabled}
      className={cx('kp-track', on && 'is-on')}
      data-biome={trackBiome(id)}
      onClick={onPick}
    >
      <TrackThumb trackId={id} />
      <span className="kp-track__name">{t.name}</span>
      <span className="kp-track__biome">{BIOME_LABEL[trackBiome(id)]}</span>
      <span className="kp-track__tag">{t.tagline}</span>
      <span className="kp-track__chips">
        {t.features.map((f) => (
          <span key={f} className="kp-chip">
            {f}
          </span>
        ))}
      </span>
    </button>
  );
}

export function KartSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<KartSettings>) {
  const solo = useRoomSelector((s: KartPublicState) => Boolean(s.race?.solo));
  const tournament = useRoomSelector((s: KartPublicState) => Boolean(s.tournamentJson));
  const humans =
    useRoomSelector(
      (s: KartPublicState) => Object.values(s.players ?? {}).filter((p) => !(p as { spectator?: boolean }).spectator).length,
    ) ?? 1;
  const edit = canEdit && !tournament;
  const mode = settings.mode ?? 'race';
  const tt = mode === 'timetrial';
  const gp = mode === 'gp';
  const maxBots = Math.max(0, Math.min(KART_SIM.maxBots, KART_SIM.gridSlots - humans));

  const modes: KartMode[] = ['race', 'gp', 'timetrial'];
  return (
    <div className="kp-settings" data-part="kart-settings">
      <div className="dc-field">
        <span className="dc-field__label">Mode</span>
        <Segmented
          label="Mode"
          value={mode}
          disabled={!edit}
          options={modes.map((m) => ({ value: m, label: MODE_LABEL[m], disabled: m === 'timetrial' && !solo }))}
          onChange={(m) => update({ mode: m as KartMode })}
        />
        <span className="dc-field__hint">
          {tt
            ? 'Solo against the clock: no items, no bots — three Turbo Cells and your ghost.'
            : gp
              ? 'Four races in a cup. Points for every finish; the most points takes the trophy.'
              : solo
                ? 'One race against computer racers. Time Trial is for solo rooms.'
                : 'One race. Time Trial is available in solo rooms.'}
        </span>
      </div>

      {gp ? (
        <div className="dc-field">
          <span className="dc-field__label" id="kp-cup-label">
            Cup
          </span>
          <div className="kp-cups" role="radiogroup" aria-labelledby="kp-cup-label" onKeyDown={(e) => handleRovingKeys(e, 'radio')}>
            {KART_CUP_IDS.map((cid: KartCupId, i) => {
              const cup = KART_CUPS[cid];
              const on = settings.cup === cid;
              return (
                <button
                  key={cid}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={rovingTabIndex(on, i, true)}
                  disabled={!edit}
                  className={cx('kp-cup', on && 'is-on')}
                  onClick={() => update({ cup: cid })}
                >
                  <span className="kp-cup__name">{cup.name}</span>
                  <span className="kp-cup__maps">
                    {cup.tracks.map((tid) => (
                      <span key={tid} className="kp-cup__map" title={KART_TRACKS[tid].name}>
                        <TrackThumb trackId={tid} small />
                        <small>{KART_TRACKS[tid].name}</small>
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="dc-field">
          <span className="dc-field__label" id="kp-track-label">
            Track
          </span>
          <div
            className="kp-trackgroups"
            role="radiogroup"
            aria-labelledby="kp-track-label"
            onKeyDown={(e) => handleRovingKeys(e, 'radio')}
          >
            {KART_CUP_IDS.map((cid) => (
              <div key={cid} className="kp-trackgroup" role="presentation">
                <span className="kp-trackgroup__cup dc-pixel" aria-hidden>
                  {KART_CUPS[cid].name}
                </span>
                <div className="kp-tracks" role="presentation">
                  {KART_CUPS[cid].tracks.map((tid) => (
                    <TrackCard
                      key={tid}
                      id={tid}
                      on={settings.track === tid}
                      disabled={!edit}
                      tabIndex={settings.track === tid ? 0 : -1}
                      onPick={() => update({ track: tid })}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="kp-settings__grid">
        <Stepper
          label="Laps"
          value={settings.laps ?? 3}
          min={1}
          max={5}
          disabled={!edit}
          onChange={(laps) => update({ laps })}
          hint="1–5 per race"
        />
        {tt ? null : (
          <>
            <Stepper
              label="Bots"
              value={Math.min(settings.bots ?? 0, maxBots)}
              min={0}
              max={maxBots}
              disabled={!edit}
              onChange={(bots) => update({ bots })}
              hint={`Computer racers (up to ${maxBots})`}
            />
            <div className="dc-field">
              <span className="dc-field__label">Bot skill</span>
              <Segmented
                label="Bot skill"
                value={settings.botSkill ?? 'normal'}
                disabled={!edit || (settings.bots ?? 0) === 0}
                options={KART_BOT_SKILLS.map((s) => ({ value: s, label: SKILL_LABEL[s] }))}
                onChange={(botSkill) => update({ botSkill: botSkill as KartBotSkill })}
              />
            </div>
          </>
        )}
      </div>

      {tt ? null : (
        <div className="kp-settings__toggles">
          <Toggle label="Items" checked={settings.items !== false} disabled={!edit} onChange={(items) => update({ items })} />
          {settings.items === false ? (
            <Badge color="var(--info)" icon="info">
              Pure racing: no cubes
            </Badge>
          ) : null}
        </div>
      )}

      {tt || solo ? null : (
        <div className="dc-field">
          <span className="dc-field__label">Finish window after the winner</span>
          <Segmented
            label="Finish window"
            value={String(settings.finishWindowSec ?? 25)}
            disabled={!edit}
            options={[15, 25, 40, 60].map((s) => ({ value: String(s), label: `${s}s` }))}
            onChange={(v) => update({ finishWindowSec: Number(v) })}
          />
        </div>
      )}
      <p className="kp-settings__note">Up to {KART_SIM.gridSlots} karts on the grid. Settings lock once the race starts.</p>
    </div>
  );
}
