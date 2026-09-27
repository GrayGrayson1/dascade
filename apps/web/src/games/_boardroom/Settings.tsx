/**
 * DAS Boardroom kit — lobby settings for the kit fields: time control (presets + custom), who plays
 * first, rated, take-backs. Games render <BoardSettingsFields> inside their SettingsPanel and add
 * their own options below.
 */
import { useEffect, useRef, useState } from 'react';
import {
  CLOCK_MAX_BASE_MINUTES,
  CLOCK_MAX_INCREMENT_SECONDS,
  CLOCK_PRESETS,
  DEFAULT_BOARD_SETTINGS,
  clockCategory,
  presetFor,
  timeControlLabel,
  type BoardSettings,
  type SideMode,
  type TimeControl,
} from '@dascade/shared/games/boardroom';
import { Field, NumberInput, PixelIcon, Segmented, Toggle, cx, handleRovingKeys, rovingTabIndex } from '@dascade/ui';
import { useRoomSelector } from '../../net/hooks.ts';

const CATEGORY_LABEL: Record<string, string> = {
  untimed: 'No clock',
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
};

/** Local draft that follows the server value and commits after a pause (settings are rate limited). */
function useDraft<T>(value: T, commit: (v: T) => void, delay = 450): [T, (v: T) => void] {
  const [draft, setDraft] = useState(value);
  const timer = useRef<number | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const latest = useRef(value);
  latest.current = value;
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

export interface TimeControlPickerProps {
  value: TimeControl;
  onChange: (tc: TimeControl) => void;
  disabled?: boolean;
}

export function TimeControlPicker({ value, onChange, disabled }: TimeControlPickerProps) {
  const preset = presetFor(value);
  const [custom, setCustom] = useState(!preset);
  useEffect(() => {
    if (!presetFor(value)) setCustom(true);
  }, [value]);
  const [draft, setDraft] = useDraft<TimeControl>(value, (tc) => {
    if (
      tc.baseMinutes >= 1 &&
      tc.baseMinutes <= CLOCK_MAX_BASE_MINUTES &&
      tc.incrementSeconds >= 0 &&
      tc.incrementSeconds <= CLOCK_MAX_INCREMENT_SECONDS
    )
      onChange(tc);
  });
  const options = [
    ...CLOCK_PRESETS.map((p) => ({ id: p.id, label: p.label, sub: CATEGORY_LABEL[p.category] ?? '' })),
    { id: 'custom', label: 'Custom', sub: custom && !preset ? timeControlLabel(value) : 'Your own' },
  ];
  const selectedId = custom ? 'custom' : (preset?.id ?? 'custom');

  return (
    <div className="br-tc">
      <div className="br-tc__grid" role="radiogroup" aria-label="Time control" onKeyDown={(e) => handleRovingKeys(e, 'radio')}>
        {options.map((o, i) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={o.id === selectedId}
            tabIndex={rovingTabIndex(o.id === selectedId, i, true)}
            className={cx('br-tc__opt', o.id === 'untimed' && 'br-tc__opt--untimed')}
            disabled={disabled}
            onClick={() => {
              if (o.id === 'custom') {
                setCustom(true);
                return;
              }
              setCustom(false);
              const p = CLOCK_PRESETS.find((x) => x.id === o.id);
              if (p) onChange({ baseMinutes: p.baseMinutes, incrementSeconds: p.incrementSeconds });
            }}
          >
            <span className="br-tc__label br-num">{o.label}</span>
            <span className="br-tc__sub">{o.sub}</span>
          </button>
        ))}
      </div>
      {custom ? (
        <div className="br-tc__custom">
          <Field label="Minutes each" hint={`1–${CLOCK_MAX_BASE_MINUTES}`}>
            {({ id, describedBy }) => (
              <NumberInput
                id={id}
                aria-describedby={describedBy}
                value={draft.baseMinutes || 1}
                min={1}
                max={CLOCK_MAX_BASE_MINUTES}
                disabled={disabled}
                onChange={(n) => setDraft({ ...draft, baseMinutes: Math.round(n) })}
              />
            )}
          </Field>
          <Field label="Increment (seconds)" hint={`0–${CLOCK_MAX_INCREMENT_SECONDS}, added after every move`}>
            {({ id, describedBy }) => (
              <NumberInput
                id={id}
                aria-describedby={describedBy}
                value={draft.incrementSeconds}
                min={0}
                max={CLOCK_MAX_INCREMENT_SECONDS}
                disabled={disabled}
                onChange={(n) => setDraft({ ...draft, incrementSeconds: Math.round(n) })}
              />
            )}
          </Field>
          <p className="br-tc__cat">{CATEGORY_LABEL[clockCategory(draft)] ?? ''}</p>
        </div>
      ) : null}
    </div>
  );
}

export interface BoardSettingsFieldsProps {
  settings: Partial<BoardSettings>;
  canEdit: boolean;
  update: (patch: Partial<BoardSettings>) => void;
  /** "White" / "Black", "Dark" / "Light". */
  sideLabels: readonly [string, string];
  /** Whether the game supports take-backs (hide the toggle otherwise). */
  undo?: boolean;
}

export function BoardSettingsFields({ settings: raw, canEdit: hostCanEdit, update, sideLabels, undo = true }: BoardSettingsFieldsProps) {
  const s: BoardSettings = { ...DEFAULT_BOARD_SETTINGS, ...raw };
  // Tournament Center match rooms: the organizer fixed the format; games are always rated, never take-backs.
  const tournament = Boolean(useRoomSelector((st) => st.tournamentJson));
  const canEdit = hostCanEdit && !tournament;
  const rated = s.rated || tournament;
  const allowUndo = s.allowUndo && !rated;
  const sideOptions: Array<{ value: SideMode; label: string }> = [
    { value: 'random', label: 'Random' },
    { value: 'host_first', label: `Host ${sideLabels[0]}` },
    { value: 'host_second', label: `Host ${sideLabels[1]}` },
  ];
  return (
    <div className="br-settings">
      {tournament ? (
        <p className="br-settings__locked" role="note">
          <PixelIcon name="lock" /> Tournament match — settings are fixed by the organizer · rated (internal DASCADE rating) · no take-backs
        </p>
      ) : null}
      <div className="dc-field">
        <span className="dc-field__label">Clock</span>
        <TimeControlPicker value={s.timeControl} disabled={!canEdit} onChange={(timeControl) => update({ timeControl })} />
        <div className="dc-field__hint">
          {s.timeControl.baseMinutes > 0
            ? `${timeControlLabel(s.timeControl)} — minutes each + seconds added per move. Run out and you lose.`
            : 'No clock — play at your own pace.'}
        </div>
      </div>
      <div className="dc-field">
        <span className="dc-field__label">Sides</span>
        <Segmented
          label="Who plays which side"
          value={s.sides}
          options={sideOptions}
          onChange={(sides) => update({ sides })}
          disabled={!canEdit}
        />
        <div className="dc-field__hint">{`${sideLabels[0]} moves first. Rematches swap sides.`}</div>
      </div>
      <div className="br-settings__toggles">
        <Toggle
          checked={rated}
          disabled={!canEdit}
          onChange={(rated) => update({ rated })}
          label={
            <span>
              Rated game <span className="br-settings__hint">changes both players’ DASCADE rating (internal, not FIDE)</span>
            </span>
          }
        />
        {undo ? (
          <Toggle
            checked={allowUndo}
            disabled={!canEdit || rated}
            onChange={(allowUndo) => update({ allowUndo })}
            label={
              <span>
                Allow take-backs{' '}
                <span className="br-settings__hint">{rated ? 'never in rated games' : 'the opponent must accept each request'}</span>
              </span>
            }
          />
        ) : null}
      </div>
    </div>
  );
}
