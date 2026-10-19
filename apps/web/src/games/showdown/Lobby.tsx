/**
 * Pre-show (the shared DASCADE lobby): the presenter's show settings and, per player, the setup
 * card — team pick for the audience, presenter tools for the presenter, big-screen mode for a TV.
 *
 * The format comes first: Team Showdown (teams, strikes, scores) or Presenter Showcase (one board
 * for a crowd in a meeting). Event presets load a ready-made showcase (its settings and rounds) in
 * one click.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cleanText } from '@dascade/shared';
import {
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
import { AudioStatus, BigScreenLinkButton, PresenterTools, StageCards, StageWindowButton, loadEventPreset, useLoadedPreset } from './consoleParts.tsx';
import { copyText, screenLink, setScreenMode, useScreenMode } from './access.ts';
import { useLook, usePass, useRehearsal, useRole, useRosters, useShowdownSettings } from './state.ts';
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
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useDebouncedText(settings.title ?? '', (t) => update({ title: t }));
  const [eventName, setEventName] = useDebouncedText(settings.eventName ?? '', (t) => update({ eventName: t }));
  const [name0, setName0] = useDebouncedText(settings.teamNames?.[0] ?? '', (t) => update({ teamNames: [t, settings.teamNames?.[1] ?? ''] }));
  const [name1, setName1] = useDebouncedText(settings.teamNames?.[1] ?? '', (t) => update({ teamNames: [settings.teamNames?.[0] ?? '', t] }));
  const available = SHOWDOWN_PACK_IDS.filter((id) => settings.packs?.includes(id)).reduce((n, id) => n + SHOWDOWN_PACK_INFO[id].rounds, 0);
  const auto = resolveShowdownLook('auto', seasonClock());
  if (!settings.packs) return null;
  const showcase = settings.mode === 'showcase';

  const togglePack = (id: ShowdownPackId) => {
    const on = settings.packs.includes(id);
    if (on && settings.packs.length === 1) return;
    update({ packs: on ? settings.packs.filter((p) => p !== id) : SHOWDOWN_PACK_IDS.filter((p) => p === id || settings.packs.includes(p)) });
  };

  return (
    <div className="sd-settings" data-mode={settings.mode}>
      <FormatPicker value={settings.mode ?? 'classic'} canEdit={canEdit} onChange={(mode) => update({ mode })} />

      {canEdit ? <EventPresets customRounds={customRounds} rehearsal={rehearsal} /> : null}

      <Field label="Show title" hint={showcase ? 'On the opening marquee, the title cards and the stage window.' : 'On the marquee and the big screen.'}>
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
        <Field label="Holding-screen headline" hint="The big line on the Welcome card (the event’s name). Leave blank to use the show title.">
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
          <Field label="Rounds" hint={settings.rounds > available ? `Only ${available} questions in these packs.` : 'Questions in this show (unplayed ones come first).'}>
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
            {canEdit ? ' The answers stay on your device and the server — nobody else sees them until they flip.' : ' The presenter writes these; nobody else sees the answers.'}
          </p>
          {canEdit ? (
            <Button icon="pencil" variant="primary" onClick={() => setEditing(true)}>
              {customRounds ? 'Edit your rounds' : 'Write your rounds'}
            </Button>
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
            <Toggle label="Three strikes open a steal" checked={settings.steal} disabled={!canEdit} onChange={(steal) => update({ steal })} />
            <Toggle label="Audience locks in guesses for points" checked={settings.audience} disabled={!canEdit} onChange={(audience) => update({ audience })} />
          </div>

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

      {editing ? <ContentEditor onClose={() => setEditing(false)} settings={settings} update={update} /> : null}
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

/** One-click ready-made shows: they replace this room's rounds and set the format, look and clock. */
function EventPresets({ customRounds, rehearsal }: { customRounds: number; rehearsal: boolean }) {
  const code = useSessionStore((s) => s.code) ?? '';
  const loaded = useLoadedPreset(code);
  const [pending, setPending] = useState<ShowdownEventId | null>(null);
  /** The preset in the room now (the server knows "rehearsal"; this browser knows which one it loaded). */
  const current: ShowdownEventId | null = rehearsal ? 'dasoween-rehearsal' : loaded === 'dasoween-2026' && customRounds > 0 ? 'dasoween-2026' : null;
  const load = (id: ShowdownEventId) => {
    // Hand-written rounds would be replaced: ask first. A preset's own rounds can be loaded again any time.
    if (customRounds > 0 && current === null) return setPending(id);
    loadEventPreset(code, id);
  };
  return (
    <section className="sdc-presets" aria-labelledby="sdc-presets-label">
      <div className="sdc-presets__head">
        <span className="dc-field__label" id="sdc-presets-label">
          Event presets
        </span>
        <span className="dc-field__hint">One click loads a ready-made show — its format, look, clock and rounds. It replaces this room’s rounds.</span>
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
              <Button size="sm" variant={on ? 'ghost' : info.rehearsal ? 'secondary' : 'primary'} onClick={() => load(id)} aria-label={`${on ? 'Reload' : 'Load'} ${PRESET_LABEL[id].title}`}>
                {on ? 'Reload' : 'Load'}
              </Button>
            </div>
          );
        })}
      </div>
      <p className="sdc-presets__status" role="status">
        {rehearsal ? (
          <>
            <Badge color="var(--warning)" solid>
              Rehearsal
            </Badge>{' '}
            Demo boards loaded — practise every control without giving the real answers away. Load DAS-O-Ween 2026 for the real show.
          </>
        ) : current === 'dasoween-2026' ? (
          <>
            <PixelIcon name="check" /> DAS-O-Ween 2026 is loaded: <span className="dc-num">{customRounds}</span> rounds. Check them with Edit your rounds.
          </>
        ) : customRounds > 0 ? (
          <>
            <span className="dc-num">{customRounds}</span> round{customRounds === 1 ? '' : 's'} of your own loaded.
          </>
        ) : null}
      </p>
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
          This room has <span className="dc-num">{customRounds}</span> round{customRounds === 1 ? '' : 's'} of your own. Loading the preset replaces them (and sets the format, look and
          clock). Save them on this device first if you want to keep them (Edit your rounds → Save, load and share).
        </p>
      </Modal>
    </section>
  );
}

function ShowcaseOptions({ settings, canEdit, update }: SettingsPanelProps<ShowdownSettings>) {
  return (
    <div className="sdc-showopts">
      <Field label="Round clock (minutes)" hint="0 = no clock. It starts when the question goes up and never reveals anything by itself — you press Reveal remaining.">
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
        <Toggle label="Phones can lock in private guesses" checked={settings.audience} disabled={!canEdit} onChange={(audience) => update({ audience })} />
        <span className="dc-field__hint">For a meeting, leave phone guesses off: people guess in the chat and you flip what they name.</span>
      </div>
    </div>
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

  if (role.role === 'presenter' && showcase) {
    return (
      <div className="sd-setup sdc-setup">
        <p className="sdc-lead">
          <PixelIcon name="crown" />
          <span>
            <b>You’re the presenter.</b> Only you see the answers — on your console, never on the stage.
          </span>
        </p>
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
        <PresenterTools code={code} pass={pass} />
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
            No teams tonight. Watch the board, shout your guesses (or type them in the meeting chat) and tap the reactions to cheer — they float up on the stage.
          </p>
        </div>
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
        <TextInput value={pass} placeholder="Paste your presenter link or pass" aria-label="Presenter pass" onChange={(e) => setPass(e.currentTarget.value)} autoComplete="off" />
        <Button type="submit" size="sm" disabled={!pass.trim()}>
          Claim
        </Button>
      </form>
    </details>
  );
}
