/**
 * Pre-show (the shared DASCADE lobby): the presenter's show settings and, per player, the setup
 * card — team pick for the audience, presenter tools for the presenter, big-screen mode for a TV.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cleanText } from '@dascade/shared';
import {
  SHOWDOWN_LIMITS,
  SHOWDOWN_LOOKS,
  SHOWDOWN_LOOK_INFO,
  SHOWDOWN_MSG,
  SHOWDOWN_PACK_IDS,
  SHOWDOWN_PACK_INFO,
  SHOWDOWN_SCORING,
  SHOWDOWN_SCORING_INFO,
  SHOWDOWN_TEAMS,
  SHOWDOWN_DEFAULT_TITLE,
  resolveShowdownLook,
  teamName,
  type ShowdownLookSetting,
  type ShowdownPackId,
  type ShowdownPublicState,
  type ShowdownSettings,
} from '@dascade/shared/games/showdown';
import { Badge, Button, Field, NumberInput, PixelIcon, Segmented, TextInput, Toggle, cx } from '@dascade/ui';
import { session, useRoomSelector } from '../../net/hooks.ts';
import { useSessionStore } from '../../net/session.ts';
import { useApp } from '../../app/store.ts';
import { sfx } from '../../audio/audio.ts';
import { seasonClock } from '../../themes/seasonalController.ts';
import type { SettingsPanelProps } from '../types.ts';
import { ContentEditor } from './ContentEditor.tsx';
import { PresenterTools } from './Console.tsx';
import { openStageWindow, useStageWindow } from './stageWindow.ts';
import { copyText, screenLink, setScreenMode, useScreenMode } from './access.ts';
import { usePass, useRole, useRosters, useShowdownSettings } from './state.ts';

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
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useDebouncedText(settings.title ?? '', (t) => update({ title: t }));
  const [name0, setName0] = useDebouncedText(settings.teamNames?.[0] ?? '', (t) => update({ teamNames: [t, settings.teamNames?.[1] ?? ''] }));
  const [name1, setName1] = useDebouncedText(settings.teamNames?.[1] ?? '', (t) => update({ teamNames: [settings.teamNames?.[0] ?? '', t] }));
  const available = SHOWDOWN_PACK_IDS.filter((id) => settings.packs?.includes(id)).reduce((n, id) => n + SHOWDOWN_PACK_INFO[id].rounds, 0);
  const auto = resolveShowdownLook('auto', seasonClock());
  if (!settings.packs) return null;

  const togglePack = (id: ShowdownPackId) => {
    const on = settings.packs.includes(id);
    if (on && settings.packs.length === 1) return;
    update({ packs: on ? settings.packs.filter((p) => p !== id) : SHOWDOWN_PACK_IDS.filter((p) => p === id || settings.packs.includes(p)) });
  };

  return (
    <div className="sd-settings">
      <Field label="Show title" hint="On the marquee and the big screen.">
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
            {canEdit ? ' The answers stay on your device and the server — nobody else sees them until they flip.' : ' The presenter writes these; nobody else sees the answers.'}
          </p>
          {canEdit ? (
            <Button icon="pencil" variant="primary" onClick={() => setEditing(true)}>
              {customRounds ? 'Edit your rounds' : 'Write your rounds'}
            </Button>
          ) : null}
        </div>
      )}

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

      {editing ? <ContentEditor onClose={() => setEditing(false)} /> : null}
    </div>
  );
}

/** "Your setup" in the lobby: presenter tools, or team pick + big-screen mode for everyone else. */
export function ShowdownPlayerSetup() {
  const code = useSessionStore((s) => s.code) ?? '';
  const screen = useScreenMode(code);
  const role = useRole(screen);
  const settings = useShowdownSettings();
  const pass = usePass();
  const rosters = useRosters();
  const stageWin = useStageWindow();
  const presenterId = role.presenterId;
  const names: [string, string] = [teamName(settings, 0), teamName(settings, 1)];

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
          <Button
            variant={stageWin.open ? 'success' : 'primary'}
            icon="maximize"
            onClick={() => {
              if (!openStageWindow(code, settings?.title || SHOWDOWN_DEFAULT_TITLE)) {
                useApp.getState().toast('warning', 'Your browser blocked the stage window — allow pop-ups for this site, or open the big-screen link on the projector.');
              }
            }}
          >
            {stageWin.open ? 'Stage window open' : 'Open stage window'}
          </Button>
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
          <PixelIcon name="maximize" /> This device is a <b>big screen</b>: it shows the stage and joins no team.
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
