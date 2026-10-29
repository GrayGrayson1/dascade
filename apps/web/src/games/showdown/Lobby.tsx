/**
 * Pre-show (the shared DASCADE lobby): the presenter's show settings and, per player, the setup
 * card — team pick for the audience, presenter tools for the presenter, big-screen mode for a TV.
 *
 * The format comes first: Team Showdown (teams, strikes, scores) or Presenter Showcase (one board
 * for a crowd in a meeting). Event presets set up a ready-made showcase in one click: DAS-O-Ween 2026
 * carries settings only (the boards come from the presenter's show file, never the app — ADM-01), the
 * rehearsal adds two practice boards. Loading either makes the room an event room: the presenter's
 * setup then gets "Crew & checks" (preflight, crew links and the log, names).
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cleanText } from '@dascade/shared';
import {
  SHOWDOWN_DISPLAYS,
  SHOWDOWN_DISPLAY_INFO,
  SHOWDOWN_EVENT_IDS,
  SHOWDOWN_EVENT_INFO,
  SHOWDOWN_LIMITS,
  SHOWDOWN_LOOKS,
  SHOWDOWN_LOOK_INFO,
  SHOWDOWN_MODES,
  SHOWDOWN_MODE_INFO,
  SHOWDOWN_MSG,
  SHOWDOWN_PACK_IDS,
  SHOWDOWN_PACK_INFO,
  SHOWDOWN_PICK_MODES,
  SHOWDOWN_PICK_MODE_INFO,
  SHOWDOWN_MEDAL_MODES,
  SHOWDOWN_MEDAL_MODE_INFO,
  SHOWDOWN_REVEAL_MODES,
  SHOWDOWN_REVEAL_MODE_INFO,
  SHOWDOWN_SCORING,
  SHOWDOWN_SCORING_INFO,
  SHOWDOWN_TEAMS,
  SHOWDOWN_DEFAULT_TITLE,
  resolveShowdownLook,
  showTitle,
  teamName,
  type ShowdownEventId,
  type ShowdownLookSetting,
  type ShowdownMode,
  type ShowdownPackId,
  type ShowdownPublicState,
  type ShowdownSettings,
} from '@dascade/shared/games/showdown';
import { Badge, Button, Field, Modal, NumberInput, PixelIcon, Segmented, TextInput, Toggle, cx } from '@dascade/ui';
import { session, useRoomSelector } from '../../net/hooks.ts';
import { useSessionStore } from '../../net/session.ts';
import { useApp } from '../../app/store.ts';
import { sfx } from '../../audio/audio.ts';
import { seasonClock } from '../../themes/seasonalController.ts';
import type { SettingsPanelProps } from '../types.ts';
import { ContentEditor } from './ContentEditor.tsx';
import {
  AudioStatus,
  BigScreenLinkButton,
  JoinQrTools,
  PresenterTools,
  StageCards,
  StageWindowButton,
  loadEventPreset,
} from './consoleParts.tsx';
import { copyText, screenLink, setScreenMode, useScreenMode } from './access.ts';
import { useEvent, useLook, usePass, useRehearsal, useRole, useRosters, useShowdownSettings } from './state.ts';
import { CrewPanel, NamesPanel, PickerPanel, PreflightPanel } from './panels/index.ts';
import { PoolCard } from './PoolCard.tsx';
import { TourButton } from './tour/TourButton.tsx';
import './chrome-showcase.css';

/** A text setting sent ~400 ms after the last keystroke (settings are rate limited). */
function useDebouncedText(value: string, commit: (v: string) => void): [string, (v: string) => void] {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editing = useRef(false);
  useEffect(() => {
    // The server's cleaned echo of the draft ("Spooky " comes back "Spooky") must not eat the space
    // just typed: only a value that really differs replaces what's in the field.
    if (!editing.current && cleanText(draftRef.current, draftRef.current.length) !== value) setDraft(value);
  }, [value]);
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);
  const change = (v: string) => {
    editing.current = true;
    setDraft(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      editing.current = false;
      commit(v);
    }, 400);
  };
  return [draft, change];
}

export function ShowdownSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<ShowdownSettings>) {
  const customRounds = useRoomSelector<ShowdownPublicState, number>((s) => s.customRounds) ?? 0;
  const rehearsal = useRehearsal();
  const [editing, setEditing] = useState<false | 'edit' | 'showfile'>(false);
  const [title, setTitle] = useDebouncedText(settings.title ?? '', (t) => update({ title: t }));
  const [eventName, setEventName] = useDebouncedText(settings.eventName ?? '', (t) => update({ eventName: t }));
  const [name0, setName0] = useDebouncedText(settings.teamNames?.[0] ?? '', (t) =>
    update({ teamNames: [t, settings.teamNames?.[1] ?? ''] }),
  );
  const [name1, setName1] = useDebouncedText(settings.teamNames?.[1] ?? '', (t) =>
    update({ teamNames: [settings.teamNames?.[0] ?? '', t] }),
  );
  const available = SHOWDOWN_PACK_IDS.filter((id) => settings.packs?.includes(id)).reduce((n, id) => n + SHOWDOWN_PACK_INFO[id].rounds, 0);
  const auto = resolveShowdownLook('auto', seasonClock());
  if (!settings.packs) return null;
  const showcase = settings.mode === 'showcase';

  const togglePack = (id: ShowdownPackId) => {
    const on = settings.packs.includes(id);
    if (on && settings.packs.length === 1) return;
    update({
      packs: on ? settings.packs.filter((p) => p !== id) : SHOWDOWN_PACK_IDS.filter((p) => p === id || settings.packs.includes(p)),
    });
  };

  return (
    <div className="sd-settings" data-mode={settings.mode}>
      <FormatPicker value={settings.mode ?? 'classic'} canEdit={canEdit} onChange={(mode) => update({ mode })} />

      {canEdit ? <EventPresets customRounds={customRounds} rehearsal={rehearsal} onLoadShowFile={() => setEditing('showfile')} /> : null}

      <Field
        label="Show title"
        hint={showcase ? 'On the opening marquee, the title cards and the stage window.' : 'On the marquee and the big screen.'}
      >
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            aria-describedby={describedBy}
            value={title}
            placeholder={SHOWDOWN_DEFAULT_TITLE}
            maxLength={SHOWDOWN_LIMITS.showTitle}
            disabled={!canEdit}
            onChange={(e) => setTitle(e.currentTarget.value)}
          />
        )}
      </Field>

      {showcase ? (
        <Field
          label="Holding-screen headline"
          hint="The big line on the Welcome card (the event’s name). Leave blank to use the show title."
        >
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              value={eventName}
              placeholder={showTitle(settings)}
              maxLength={SHOWDOWN_LIMITS.eventName}
              disabled={!canEdit}
              onChange={(e) => setEventName(e.currentTarget.value)}
            />
          )}
        </Field>
      ) : null}

      <div className="dc-field">
        <span className="dc-field__label" id="sd-look-label">
          Look
        </span>
        <div className="sd-looks" role="radiogroup" aria-labelledby="sd-look-label">
          {SHOWDOWN_LOOKS.map((look) => (
            <button
              key={look}
              type="button"
              role="radio"
              aria-checked={settings.look === look}
              className="sd-lookcard"
              data-look={look === 'auto' ? auto : look}
              disabled={!canEdit}
              onClick={() => update({ look: look as ShowdownLookSetting })}
            >
              <span className="sd-lookcard__swatch" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <span className="sd-lookcard__title">
                {SHOWDOWN_LOOK_INFO[look].title}
                {look === 'auto' ? <Badge>{auto === 'halloween' ? 'Halloween now' : 'Showtime now'}</Badge> : null}
              </span>
              <span className="sd-lookcard__blurb">{SHOWDOWN_LOOK_INFO[look].blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="dc-field">
        <span className="dc-field__label">Questions</span>
        <Segmented
          label="Question source"
          value={settings.source}
          disabled={!canEdit}
          onChange={(source) => update({ source })}
          options={[
            { value: 'packs', label: 'Question packs' },
            { value: 'custom', label: `Your own (${customRounds})` },
          ]}
        />
      </div>

      {settings.source === 'packs' ? (
        <>
          <div className="sd-packs" role="group" aria-label="Question packs">
            {SHOWDOWN_PACK_IDS.map((id) => {
              const info = SHOWDOWN_PACK_INFO[id];
              const on = settings.packs.includes(id);
              return (
                <button key={id} type="button" className="sd-pack" aria-pressed={on} disabled={!canEdit} onClick={() => togglePack(id)}>
                  <span className="sd-pack__title">
                    {info.title}
                    {info.seasonal ? <span aria-hidden> 🎃</span> : null}
                  </span>
                  <span className="sd-pack__blurb">{info.blurb}</span>
                  <span className="sd-pack__count">
                    <span className="dc-num">{info.rounds}</span> questions
                  </span>
                </button>
              );
            })}
          </div>
          <Field
            label="Rounds"
            hint={
              settings.rounds > available
                ? `Only ${available} questions in these packs.`
                : 'Questions in this show (unplayed ones come first).'
            }
          >
            {({ id, describedBy }) => (
              <NumberInput
                id={id}
                aria-describedby={describedBy}
                value={settings.rounds}
                min={SHOWDOWN_LIMITS.packRoundsMin}
                max={SHOWDOWN_LIMITS.packRoundsMax}
                disabled={!canEdit}
                onChange={(rounds) => rounds !== settings.rounds && update({ rounds })}
              />
            )}
          </Field>
        </>
      ) : (
        <div className="sd-customcard">
          <p>
            <span className="dc-num">{customRounds}</span> custom round{customRounds === 1 ? '' : 's'} ready.
            {rehearsal ? ' (The rehearsal’s demo boards.)' : ''}
            {canEdit
              ? ' The answers stay on your device and the server — nobody else sees them until they flip.'
              : ' The presenter writes these; nobody else sees the answers.'}
          </p>
          {canEdit ? (
            <div className="sd-row sd-row--wrap">
              <Button icon="pencil" variant="primary" onClick={() => setEditing('edit')}>
                {customRounds ? 'Edit your rounds' : 'Write your rounds'}
              </Button>
              <Button icon="share" variant="ghost" onClick={() => setEditing('showfile')}>
                Load show file
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {showcase ? (
        <ShowcaseOptions settings={settings} canEdit={canEdit} update={update} />
      ) : (
        <>
          <div className="dc-field">
            <span className="dc-field__label">Scoring</span>
            <Segmented
              label="Scoring"
              value={settings.scoring}
              disabled={!canEdit}
              onChange={(scoring) => update({ scoring })}
              options={SHOWDOWN_SCORING.map((s) => ({ value: s, label: SHOWDOWN_SCORING_INFO[s].title }))}
            />
            <span className="dc-field__hint">{SHOWDOWN_SCORING_INFO[settings.scoring].blurb}</span>
          </div>

          <div className="sd-toggles">
            <Toggle
              label="Three strikes open a steal"
              checked={settings.steal}
              disabled={!canEdit}
              onChange={(steal) => update({ steal })}
            />
            <Toggle
              label="Audience locks in guesses for points"
              checked={settings.audience}
              disabled={!canEdit}
              onChange={(audience) => update({ audience })}
            />
          </div>
          <GuessesField settings={settings} canEdit={canEdit} update={update} />

          <div className="sd-teamnames">
            {([0, 1] as const).map((t) => (
              <Field key={t} label={`Team ${t + 1} name`}>
                {({ id }) => (
                  <TextInput
                    id={id}
                    className="sd-teamname"
                    style={{ '--team': SHOWDOWN_TEAMS[t].color } as CSSProperties}
                    value={t === 0 ? name0 : name1}
                    placeholder={SHOWDOWN_TEAMS[t].defaultName}
                    maxLength={SHOWDOWN_LIMITS.teamName}
                    disabled={!canEdit}
                    onChange={(e) => (t === 0 ? setName0 : setName1)(e.currentTarget.value)}
                  />
                )}
              </Field>
            ))}
          </div>
        </>
      )}

      {editing ? (
        <ContentEditor
          onClose={() => setEditing(false)}
          settings={settings}
          update={update}
          intent={editing === 'showfile' ? 'showfile' : undefined}
        />
      ) : null}
    </div>
  );
}

/** Team Showdown or Presenter Showcase — the first decision. */
function FormatPicker({ value, canEdit, onChange }: { value: ShowdownMode; canEdit: boolean; onChange: (mode: ShowdownMode) => void }) {
  return (
    <div className="dc-field">
      <span className="dc-field__label" id="sdc-format-label">
        Format
      </span>
      <div className="sdc-formats" role="radiogroup" aria-labelledby="sdc-format-label">
        {SHOWDOWN_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={value === mode}
            className="sdc-format"
            disabled={!canEdit}
            onClick={() => value !== mode && onChange(mode)}
          >
            <span className="sdc-format__icon" aria-hidden>
              <PixelIcon name={mode === 'showcase' ? 'crown' : 'users'} />
            </span>
            <span className="sdc-format__title">{SHOWDOWN_MODE_INFO[mode].title}</span>
            <span className="sdc-format__blurb">{SHOWDOWN_MODE_INFO[mode].blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const PRESET_LABEL: Record<ShowdownEventId, { title: string; icon: string }> = {
  'dasoween-2026': { title: 'DAS-O-Ween 2026', icon: '🎃' },
  'dasoween-rehearsal': { title: 'DAS-O-Ween rehearsal (demo answers)', icon: '🧪' },
};

/**
 * One-click ready-made shows. DAS-O-Ween 2026 sets the format, look and clock and keeps the rounds
 * already loaded (its boards live in the presenter's show file, never in the app); the rehearsal also
 * loads two practice boards, replacing the room's rounds (so it asks first).
 */
function EventPresets({
  customRounds,
  rehearsal,
  onLoadShowFile,
}: {
  customRounds: number;
  rehearsal: boolean;
  onLoadShowFile: () => void;
}) {
  const code = useSessionStore((s) => s.code) ?? '';
  const event = useEvent();
  const [pending, setPending] = useState<ShowdownEventId | null>(null);
  /** The preset in the room now (the server says "rehearsal" and which preset made it an event room). */
  const current: ShowdownEventId | null = rehearsal ? 'dasoween-rehearsal' : event === 'dasoween-2026' ? 'dasoween-2026' : null;
  const load = (id: ShowdownEventId) => {
    // Only a preset with boards replaces rounds: ask first when they're the presenter's own.
    const replaces = !SHOWDOWN_EVENT_INFO[id].settingsOnly;
    if (replaces && customRounds > 0 && !rehearsal) return setPending(id);
    loadEventPreset(code, id);
  };
  const needShowFile = current === 'dasoween-2026' && customRounds === 0;
  return (
    <section className="sdc-presets" aria-labelledby="sdc-presets-label">
      <div className="sdc-presets__head">
        <span className="dc-field__label" id="sdc-presets-label">
          Event presets
          {event ? (
            <>
              {' '}
              <Badge color="var(--accent)" icon="crown" data-part="showdown-event-badge">
                Event room
              </Badge>
            </>
          ) : null}
        </span>
        <span className="dc-field__hint">
          One click sets up the show’s format, look and clock and makes this an event room (crew links, the preflight, the sound station).
          DAS-O-Ween 2026 keeps your boards out of the app: you load them from your show file. The rehearsal brings two practice boards.
        </span>
      </div>
      <div className="sdc-presets__list">
        {SHOWDOWN_EVENT_IDS.map((id) => {
          const info = SHOWDOWN_EVENT_INFO[id];
          const on = current === id;
          return (
            <div key={id} className="sdc-preset" data-on={on ? 'true' : undefined} data-rehearsal={info.rehearsal ? 'true' : undefined}>
              <span className="sdc-preset__icon" aria-hidden>
                {PRESET_LABEL[id].icon}
              </span>
              <span className="sdc-preset__body">
                <span className="sdc-preset__title">
                  {PRESET_LABEL[id].title}
                  {on ? (
                    <Badge color="var(--success)" icon="check">
                      Loaded
                    </Badge>
                  ) : null}
                </span>
                <span className="sdc-preset__blurb">{info.blurb}</span>
              </span>
              <Button
                size="sm"
                variant={on ? 'ghost' : info.rehearsal ? 'secondary' : 'primary'}
                onClick={() => load(id)}
                aria-label={`${on ? 'Reload' : 'Load'} ${PRESET_LABEL[id].title}`}
              >
                {on ? 'Reload' : 'Load'}
              </Button>
            </div>
          );
        })}
      </div>
      <div className="sdc-presets__status" role="status" data-part="showdown-preset-status">
        {rehearsal ? (
          <p>
            <Badge color="var(--warning)" solid>
              Rehearsal
            </Badge>{' '}
            Practice boards loaded — try every control without giving the real answers away. For the real show, load DAS-O-Ween 2026, then
            your show file.
          </p>
        ) : needShowFile ? (
          <div className="sdp-showfile-prompt" data-part="showdown-showfile-prompt">
            <p>
              <PixelIcon name="warning" /> <b>Now load your show file.</b> DAS-O-Ween 2026’s settings are on, but its boards aren’t in the
              app: open <b>Load show file</b> and pick the file on this computer (or <b>Load from this device</b> if you saved it here),
              then press Save to the show.
            </p>
            <Button size="sm" variant="primary" icon="share" onClick={onLoadShowFile}>
              Load your show file
            </Button>
          </div>
        ) : current === 'dasoween-2026' ? (
          <p>
            <PixelIcon name="check" /> DAS-O-Ween 2026’s settings with <span className="dc-num">{customRounds}</span> round
            {customRounds === 1 ? '' : 's'} from your show file. Check them with Edit your rounds.
          </p>
        ) : customRounds > 0 ? (
          <p>
            <span className="dc-num">{customRounds}</span> round{customRounds === 1 ? '' : 's'} of your own loaded.
          </p>
        ) : null}
      </div>
      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={`Load ${pending ? PRESET_LABEL[pending].title : ''}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Keep my rounds
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (pending) loadEventPreset(code, pending);
                setPending(null);
              }}
            >
              Replace them
            </Button>
          </>
        }
      >
        <p>
          This room has <span className="dc-num">{customRounds}</span> round{customRounds === 1 ? '' : 's'} of your own. Loading the
          rehearsal replaces them with its practice boards (and sets the format, look and clock). Save them as a show file first if you want
          to keep them (Edit your rounds → Save show file).
        </p>
      </Modal>
    </section>
  );
}

function ShowcaseOptions({ settings, canEdit, update }: SettingsPanelProps<ShowdownSettings>) {
  return (
    <div className="sdc-showopts">
      <Field
        label="Round clock (minutes)"
        hint="0 = no clock. It starts when the question goes up and never reveals anything by itself — you press Reveal remaining."
      >
        {({ id, describedBy }) => (
          <NumberInput
            id={id}
            aria-describedby={describedBy}
            value={settings.minutes}
            min={0}
            max={SHOWDOWN_LIMITS.minutesMax}
            disabled={!canEdit}
            onChange={(minutes) => minutes !== settings.minutes && update({ minutes })}
          />
        )}
      </Field>
      <div className="sd-toggles">
        <Toggle
          label="Show the clock on the stage"
          checked={settings.stageClock}
          disabled={!canEdit || settings.minutes === 0}
          onChange={(stageClock) => update({ stageClock })}
        />
        <Toggle
          label="Phones can lock in private guesses"
          checked={settings.audience}
          disabled={!canEdit}
          onChange={(audience) => update({ audience })}
        />
        <span className="dc-field__hint">
          Phones lock in a private Top 10 for crowd points. People can still shout or type answers in the chat — you flip what they name.
        </span>
      </div>
      <fieldset className="sdc-optgroup" data-part="showdown-scoring-options">
        <legend className="dc-field__label">Scoring</legend>
        <Toggle
          label="Score the crowd"
          checked={settings.points ?? false}
          disabled={!canEdit}
          onChange={(points) => update(points && !settings.audience ? { points, audience: true } : { points })}
        />
        <span className="dc-field__hint">
          Called it: an answer you locked in before it flipped scores #1 = 10 … #10 = 1, +1 in the right spot, +20 for a perfect list. Off:
          the show runs without crowd points.
        </span>
        <GuessesField settings={settings} canEdit={canEdit} update={update} />
        <Toggle
          label="Hidden gems (answers nobody found pay double)"
          checked={settings.gems ?? true}
          disabled={!canEdit || !settings.points}
          onChange={(gems) => update({ gems })}
        />
        <Toggle
          label="Called-it pops on the stage (“+9 · 6 called it”)"
          checked={settings.pops ?? true}
          disabled={!canEdit || !settings.points}
          onChange={(pops) => update({ pops })}
        />
        <span className="dc-field__label">Medal ceremony (the hot seat)</span>
        <Segmented
          label="Medal ceremony"
          value={settings.medals ?? 'never'}
          disabled={!canEdit}
          onChange={(medals) => medals !== settings.medals && update({ medals })}
          options={SHOWDOWN_MEDAL_MODES.map((m) => ({ value: m, label: SHOWDOWN_MEDAL_MODE_INFO[m].title }))}
        />
        <span className="dc-field__hint">{SHOWDOWN_MEDAL_MODE_INFO[settings.medals ?? 'never'].blurb}</span>
        <span className="dc-field__label">Showtime</span>
        <Segmented
          label="Showtime"
          value={settings.reveal ?? 'standings'}
          disabled={!canEdit}
          onChange={(reveal) => reveal !== settings.reveal && update({ reveal })}
          options={SHOWDOWN_REVEAL_MODES.map((m) => ({ value: m, label: SHOWDOWN_REVEAL_MODE_INFO[m].title }))}
        />
        <span className="dc-field__hint">{SHOWDOWN_REVEAL_MODE_INFO[settings.reveal ?? 'standings'].blurb}</span>
      </fieldset>
      <fieldset className="sdc-optgroup" data-part="showdown-picker-options">
        <legend className="dc-field__label">Picker</legend>
        <Segmented
          label="Picker mode"
          value={settings.pickMode ?? 'fair'}
          disabled={!canEdit}
          onChange={(pickMode) => pickMode !== settings.pickMode && update({ pickMode })}
          options={SHOWDOWN_PICK_MODES.map((m) => ({ value: m, label: SHOWDOWN_PICK_MODE_INFO[m].title }))}
        />
        <span className="dc-field__hint">{SHOWDOWN_PICK_MODE_INFO[settings.pickMode ?? 'fair'].blurb}</span>
        <Toggle
          label="Crew in the random draw"
          checked={settings.crewDraw ?? false}
          disabled={!canEdit}
          onChange={(crewDraw) => update({ crewDraw })}
        />
        <span className="dc-field__hint">
          Off: the producer, backups and moderators are only picked by name (Spotlight a name). Anyone can be spotlighted by name, whether
          or not they’ve had a turn.
        </span>
      </fieldset>
      <div className="dc-field">
        <span className="dc-field__label">Display</span>
        <Segmented
          label="Display"
          value={settings.display ?? 'auto'}
          disabled={!canEdit}
          onChange={(display) => display !== settings.display && update({ display })}
          options={SHOWDOWN_DISPLAYS.map((d) => ({ value: d, label: SHOWDOWN_DISPLAY_INFO[d].title }))}
        />
        <span className="dc-field__hint">{SHOWDOWN_DISPLAY_INFO[settings.display ?? 'auto'].blurb}</span>
      </div>
    </div>
  );
}

/** Guesses each phone may lock in per board (the audience game), 1–10. */
function GuessesField({ settings, canEdit, update }: SettingsPanelProps<ShowdownSettings>) {
  const guesses = settings.guesses ?? SHOWDOWN_LIMITS.guessesDefault;
  return (
    <Field
      label="Guesses per board"
      hint={settings.audience ? 'How many private guesses each phone can lock in per question.' : 'Used when phone guesses are on.'}
    >
      {({ id, describedBy }) => (
        <NumberInput
          id={id}
          aria-describedby={describedBy}
          value={guesses}
          min={1}
          max={SHOWDOWN_LIMITS.guessesMax}
          disabled={!canEdit || !settings.audience}
          onChange={(n) => n !== guesses && update({ guesses: n })}
          data-part="showdown-guesses-setting"
        />
      )}
    </Field>
  );
}

/** "Your setup" in the lobby: presenter tools, or team pick + big-screen mode for everyone else. */
export function ShowdownPlayerSetup() {
  const code = useSessionStore((s) => s.code) ?? '';
  const screen = useScreenMode(code);
  const role = useRole(screen);
  const settings = useShowdownSettings();
  const look = useLook(settings);
  const pass = usePass();
  const rosters = useRosters();
  const presenterId = role.presenterId;
  const names: [string, string] = [teamName(settings, 0), teamName(settings, 1)];
  const showcase = settings?.mode === 'showcase';
  const title = settings ? showTitle(settings) : SHOWDOWN_DEFAULT_TITLE;
  const event = useEvent();

  // Event rooms: the preflight belongs in the lobby too (OPS-03), with the producer's crew links and names.
  const crewChecks =
    role.role === 'presenter' && event ? (
      <section className="sdp-crewchecks" aria-labelledby="sdp-crewchecks-label" data-part="showdown-crew-checks">
        <span className="dc-field__label" id="sdp-crewchecks-label">
          Crew & checks{' '}
          <Badge color="var(--accent)" icon="crown">
            Event room
          </Badge>
        </span>
        <span className="dc-field__hint">
          Run the preflight before doors open, hand out crew links, fix names as people join, and take anyone out of the random draw.
        </span>
        <div className="sdp-lobbycrew">
          <PreflightPanel look={look} code={code} title={title} />
          <CrewPanel code={code} />
          <NamesPanel />
          {showcase ? <PickerPanel look={look} board={null} /> : null}
        </div>
      </section>
    ) : null;

  if (role.role === 'presenter' && showcase) {
    return (
      <div className="sd-setup sdc-setup">
        <p className="sdc-lead">
          <PixelIcon name="crown" />
          <span>
            <b>You’re the presenter.</b> Only you see the answers — on your console, never on the stage.
          </span>
        </p>
        <div className="sdc-setup__tour">
          <TourButton look={look} label="Watch the presenter tour" />
          <span className="dc-field__hint">
            An animated walk through the whole show on the Dashboard (about 6 minutes, on practice boards).
          </span>
        </div>
        <div className="sdc-teamsflow">
          <span className="dc-field__label">Run it in a Teams call</span>
          <ol className="sdc-steps">
            <li>
              <b>Open the stage window</b> — the show, without the answers.
            </li>
            <li>
              In Teams, <b>Share → Window</b>: pick the stage window and turn on <b>Include computer sound</b>.
            </li>
            <li>
              Press <b>Start game</b>. Keep this console on your own screen.
            </li>
          </ol>
          <div className="sd-row sd-row--wrap">
            <StageWindowButton code={code} title={title} />
            <BigScreenLinkButton code={code} />
          </div>
          <div className="sdc-setup__sound">
            <AudioStatus look={look} />
            <span className="dc-field__hint">Test sound: the meeting should hear the ding once you share with computer sound.</span>
          </div>
        </div>
        <div className="sdc-setup__cards">
          <span className="dc-field__label">Stage cards</span>
          <StageCards />
          <span className="dc-field__hint">Put up Welcome while people arrive; it comes down when the show starts.</span>
        </div>
        <div className="sdc-setup__cards">
          <span className="dc-field__label">Join QR</span>
          <JoinQrTools code={code} />
          <span className="dc-field__hint">
            The stage shows it on Welcome. Paste the image and the link in the Teams chat at the start.
          </span>
        </div>
        <PresenterTools code={code} pass={pass} />
        {crewChecks}
      </div>
    );
  }

  if (role.role === 'presenter') {
    return (
      <div className="sd-setup">
        <p className="sd-setup__lead">
          <PixelIcon name="crown" /> <b>You’re the presenter.</b> Only you will see the answers, on your console.
        </p>
        <ol className="sd-setup__steps">
          <li>Put the stage on the projector: open the stage window here, or the big-screen link on the TV’s browser.</li>
          <li>Everyone else joins with the room code on their phones and picks a team.</li>
          <li>Press Start — the show opens on its marquee.</li>
        </ol>
        <div className="sd-row sd-row--wrap">
          <StageWindowButton code={code} title={settings?.title || SHOWDOWN_DEFAULT_TITLE} />
          <Button
            variant="ghost"
            icon="copy"
            onClick={async () => {
              const ok = await copyText(screenLink(code));
              sfx('pop');
              useApp.getState().toast(ok ? 'success' : 'info', ok ? 'Big-screen link copied' : screenLink(code));
            }}
          >
            Big-screen link
          </Button>
        </div>
        <PresenterTools code={code} pass={pass} />
        {crewChecks}
      </div>
    );
  }

  if (screen) {
    return (
      <div className="sd-setup">
        <p className="sd-setup__lead">
          <PixelIcon name="maximize" /> This device is a <b>big screen</b>: it shows the stage{showcase ? '' : ' and joins no team'}.
        </p>
        <Button
          variant="ghost"
          onClick={() => {
            setScreenMode(code, false);
            session.send(SHOWDOWN_MSG.screen, { on: false });
          }}
        >
          Stop being a big screen
        </Button>
      </div>
    );
  }

  const bigScreen = (
    <Button
      variant="ghost"
      size="sm"
      icon="maximize"
      onClick={() => {
        setScreenMode(code, true);
        session.send(SHOWDOWN_MSG.screen, { on: true });
      }}
    >
      Use this device as the big screen
    </Button>
  );

  if (showcase) {
    return (
      <div className="sd-setup sdc-setup">
        {presenterId === '' ? <TakeoverCard /> : null}
        <div className="sdc-crowd">
          <span className="sdc-crowd__icon" aria-hidden>
            {look === 'halloween' ? '🎃' : '🎉'}
          </span>
          <p className="sdc-crowd__lead">
            <b>You’re in the audience</b> — cheer on the show!
          </p>
          <p className="sd-muted">
            No teams tonight. Watch the board, shout your guesses (or type them in the meeting chat) and tap the reactions to cheer — they
            float up on the stage.
          </p>
        </div>
        {/* Event rooms: whether you might be picked, and your private Skip me switch. */}
        {event ? <PoolCard compact /> : null}
        {role.role === 'spectator' ? <p className="sd-muted">You’re spectating — you’ll see the show too.</p> : null}
        {bigScreen}
        <ClaimForm />
      </div>
    );
  }

  return (
    <div className="sd-setup">
      {presenterId === '' ? <TakeoverCard /> : null}
      {role.role === 'spectator' ? (
        <p className="sd-muted">You’re spectating — take a seat to join a team.</p>
      ) : (
        <>
          <span className="dc-field__label">Pick your team</span>
          <div className="sd-teampick" role="radiogroup" aria-label="Your team">
            {([0, 1] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={role.team === t}
                className={cx('sd-teampick__card')}
                data-team={SHOWDOWN_TEAMS[t].id}
                style={{ '--team': SHOWDOWN_TEAMS[t].color } as CSSProperties}
                onClick={() => {
                  sfx('select');
                  session.send(SHOWDOWN_MSG.team, { team: t });
                }}
              >
                <PixelIcon name={SHOWDOWN_TEAMS[t].icon} />
                <span className="sd-teampick__name">{names[t]}</span>
                <span className="sd-teampick__count">
                  <span className="dc-num">{rosters[t].length}</span> {rosters[t].length === 1 ? 'player' : 'players'}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {bigScreen}
      <ClaimForm />
    </div>
  );
}

export function TakeoverCard() {
  return (
    <div className="sd-takeover" role="status">
      <p>
        <b>No presenter.</b> The presenter left. They can come back with their presenter link — or someone else can run the next show.
      </p>
      <Button variant="secondary" size="sm" icon="crown" onClick={() => session.send(SHOWDOWN_MSG.takeover, {})}>
        Become the presenter
      </Button>
    </div>
  );
}

function ClaimForm() {
  const [pass, setPass] = useState('');
  return (
    <details className="sd-claim">
      <summary>Presenter on another device?</summary>
      <form
        className="sd-row"
        onSubmit={(e) => {
          e.preventDefault();
          const value = pass.trim().replace(/^.*#presenter=/, '');
          if (value) session.send(SHOWDOWN_MSG.claim, { pass: value });
          setPass('');
        }}
      >
        <TextInput
          value={pass}
          placeholder="Paste your presenter link or pass"
          aria-label="Presenter pass"
          onChange={(e) => setPass(e.currentTarget.value)}
          autoComplete="off"
        />
        <Button type="submit" size="sm" disabled={!pass.trim()}>
          Claim
        </Button>
      </form>
    </details>
  );
}
