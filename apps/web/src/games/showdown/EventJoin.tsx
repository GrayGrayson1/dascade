/**
 * JOI-01 B — the event join screen, at /r/<code> (App.tsx lazy-loads this file).
 *
 * The meeting link already carries the room, so the only field is the name: one big labelled input,
 * the "use the name your coworkers know you by" help next to it, a live name tag showing exactly how
 * the name will look on the stage and in the picker, a Skip me switch (PCK-03 C) and one Join button.
 * Nothing else is asked — no email, legal name or ID.
 *
 * The join is strict (JOI-03 B): a name someone in the room already has comes back as `name_taken`
 * with the name the room would give instead, and the screen asks for a last initial inline ("Sam P.")
 * — or keeps the room's "Sam 2", which is still distinct. Joined, it goes to /room/<code> (a refresh
 * or the link opened again goes straight there: App.tsx checks for a stored seat first).
 *
 * Rooms that aren't event rooms keep today's flow: /r/<code> → /room/<code>.
 */
import { useEffect, useId, useReducer, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import '@fontsource/creepster/latin-400.css';
import { GAME_CATALOG, LIMITS, type RoomLookup } from '@dascade/shared';
import {
  SHOWDOWN_EVENT_INFO,
  resolveShowdownLook,
  type ShowdownEventId,
  type ShowdownEventInfo,
  type ShowdownLook,
} from '@dascade/shared/games/showdown';
import { Button, GameTheme, PixelIcon, Spinner, TextInput, Toggle } from '@dascade/ui';
import { session } from '../../net/session.ts';
import { toFriendlyError, type FriendlyError } from '../../net/errors.ts';
import { useApp } from '../../app/store.ts';
import { seasonClock } from '../../themes/seasonalController.ts';
import { LoadingFlavour } from '../../themes/LoadingFlavour.tsx';
import { NoticeCard } from '../../shell/common.tsx';
import { showdownApi } from './api.ts';
import { NameTag } from './NameTag.tsx';
import { EMPTY_NAME_ERROR, JOIN_START, cleanInitial, joinReducer, nameToSend, previewName, takenPrompt } from './joinNames.ts';
import './audience-event.css';

type Found =
  | { kind: 'loading' }
  | { kind: 'event'; info: RoomLookup }
  | { kind: 'room' }
  | { kind: 'missing' }
  | { kind: 'error'; error: FriendlyError };

/** /r/<code> for a device without a seat in that room: event rooms get the join screen, the rest the room as today. */
export function EventJoinRoute({ code }: { code: string }) {
  const navigate = useNavigate();
  const [found, setFound] = useState<Found>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setFound({ kind: 'loading' });
    session.lookup(code).then(
      (info) => {
        if (!alive) return;
        if (!info.exists || !info.gameId) setFound({ kind: 'missing' });
        else setFound(info.event ? { kind: 'event', info } : { kind: 'room' });
      },
      (err: unknown) => {
        if (alive) setFound({ kind: 'error', error: toFriendlyError(err) });
      },
    );
    return () => {
      alive = false;
    };
  }, [code, attempt]);

  if (found.kind === 'room') return <Navigate to={`/room/${code}`} replace />;
  if (found.kind === 'event') return <EventJoin code={code} info={found.info} />;
  if (found.kind === 'loading') {
    return (
      <main className="center-screen" id="main" data-part="loading-screen">
        <div className="loading-card" data-part="loading-card">
          <LoadingFlavour kind="connecting" />
          <Spinner label={`Finding room ${code}…`} />
          <p className="dc-display">Finding your show…</p>
        </div>
      </main>
    );
  }
  const missing = found.kind === 'missing';
  return (
    <GameTheme
      accent={GAME_CATALOG.showdown.accent}
      as="main"
      className="center-screen dc-game-backdrop"
      id="main"
      data-part="event-join-missing"
    >
      <NoticeCard
        icon={missing ? 'help' : 'wifi-off'}
        tone={missing ? 'info' : 'warning'}
        title={missing ? 'This show isn’t open right now' : found.error.title}
        role={missing ? 'status' : 'alert'}
        actions={
          <>
            <Button variant="primary" size="lg" icon="refresh" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
            {missing ? null : (
              <Button variant="ghost" icon="play" onClick={() => navigate(`/room/${code}`, { replace: true })}>
                Open the room anyway
              </Button>
            )}
            <Button variant="ghost" icon="arrow-left" onClick={() => navigate('/')}>
              Arcade
            </Button>
          </>
        }
      >
        <p className="notice-card__text">
          {missing ? (
            <>
              No room is using the code <span className="dc-num">{code}</span>. Check the link in your meeting chat — the show may not have
              started yet, or it has already ended.
            </>
          ) : (
            found.error.message
          )}
        </p>
      </NoticeCard>
    </GameTheme>
  );
}

/** The show's look on the join screen: the event preset's (both DAS-O-Ween presets are Halloween Night). */
function eventLook(info: ShowdownEventInfo | undefined): ShowdownLook {
  return resolveShowdownLook(info?.settings.look ?? 'auto', seasonClock());
}

export function EventJoin({ code, info }: { code: string; info: RoomLookup }) {
  const navigate = useNavigate();
  const event = info.event ? (SHOWDOWN_EVENT_INFO[info.event as ShowdownEventId] as ShowdownEventInfo | undefined) : undefined;
  const look = eventLook(event);
  // The show's own title ("DAS-O-Ween Trivia") fits one line on a phone; the long event name doesn't.
  const showName = event?.settings.title || event?.settings.eventName || info.roomName || GAME_CATALOG.showdown.title;
  const rehearsalBadge = Boolean(event?.rehearsal) && !/rehearsal/i.test(showName);
  // A returning guest's saved name is ready to go: one tap.
  const [raw, setRaw] = useState(() => useApp.getState().profile.name);
  const [skip, setSkip] = useState(false);
  const [state, dispatch] = useReducer(joinReducer, JOIN_START);
  const nameRef = useRef<HTMLInputElement>(null);
  const initialRef = useRef<HTMLInputElement>(null);
  const ids = { name: useId(), help: useId(), error: useId(), dup: useId(), initial: useId(), skip: useId() };

  const prompt = state.taken ? takenPrompt(state.taken) : null;
  const sending = nameToSend(state, raw);
  const withLetter = Boolean(prompt?.initial && cleanInitial(state.initial));
  const busy = state.step === 'joining';

  // The duplicate prompt opened (or changed): put the cursor where the answer goes.
  useEffect(() => {
    if (!state.taken) return;
    if (takenPrompt(state.taken).initial) initialRef.current?.focus();
    else nameRef.current?.select();
  }, [state.taken]);

  /** A join on its way (a double tap must not start a second one before the screen re-renders). */
  const inFlight = useRef(false);
  const join = async (name: string, strictName: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: 'submit' });
    // The name becomes this device's profile name (what the lobby rename and the next room use).
    const app = useApp.getState();
    app.setNameDraft(null);
    app.updateProfile({ name });
    const result = await session.joinRoom(code, { strictName });
    inFlight.current = false;
    if (result.ok) {
      if (skip) showdownApi.skip(true);
      navigate(`/room/${code}`, { replace: true });
      return;
    }
    // The failure is shown here, inline; the room screen must not inherit it.
    session.clearNotices();
    if (result.error.kind === 'name_taken') {
      if (name !== previewName(raw)) setRaw(name);
      dispatch({ type: 'taken', name, suggestion: result.error.message });
      return;
    }
    dispatch({ type: 'failed', error: result.error.message || result.error.title });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (state.taken && prompt?.initial && !withLetter) {
      dispatch({ type: 'failed', error: `Type your last initial — or keep “${state.taken.suggestion}”.` });
      initialRef.current?.focus();
      return;
    }
    if (!sending) {
      dispatch({ type: 'empty' });
      nameRef.current?.focus();
      return;
    }
    void join(sending, true);
  };

  return (
    <GameTheme accent={GAME_CATALOG.showdown.accent} as="main" id="main" className="sdj" data-look={look} data-part="event-join">
      <div className="sdj__card">
        <header className="sdj__head">
          <span className="sdj__mark" aria-hidden>
            {look === 'halloween' ? '🎃' : '🎤'}
          </span>
          <div className="sdj__heading">
            <p className="sdj__show">
              {showName}
              {rehearsalBadge ? <span className="sdj__badge">Rehearsal</span> : null}
            </p>
            <p className="sdj__room">
              <PixelIcon name="check" size={14} /> Room <span className="sdj__code">{code}</span>, from your meeting link
            </p>
          </div>
        </header>

        <form className="sdj__form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
          {info.locked ? (
            <p className="sdj__note" role="status">
              <PixelIcon name="lock" size={14} /> The host has locked the room for a moment. Type your name — Join works once it opens.
            </p>
          ) : null}
          <div className="sdj-field">
            <h1 className="sdj__ask">
              <label htmlFor={ids.name}>What should we call you?</label>
            </h1>
            <TextInput
              ref={nameRef}
              id={ids.name}
              className="sdj__input"
              value={raw}
              maxLength={LIMITS.nickname}
              placeholder="e.g. Priya S."
              autoComplete="nickname"
              autoCapitalize="words"
              spellCheck={false}
              enterKeyHint="go"
              aria-describedby={`${ids.help} ${ids.error}`}
              aria-invalid={state.error === EMPTY_NAME_ERROR ? true : undefined}
              onChange={(e) => {
                setRaw(e.currentTarget.value);
                dispatch({ type: 'edit' });
              }}
            />
            <p id={ids.help} className="sdj__help">
              Use the name your coworkers know you by — it’s how you’ll appear on the stage and in the picker.
            </p>

            {/* JOI-03 B: inline, next to the field — a live region, never a modal. */}
            <div className="sdj-dup" data-open={prompt ? 'true' : undefined} data-part="event-join-duplicate">
              <p id={ids.dup} className="sdj-dup__msg" role="status">
                {prompt ? (
                  <>
                    <b>{prompt.headline}</b> {prompt.ask}
                  </>
                ) : null}
              </p>
              {state.taken && prompt ? (
                <div className="sdj-dup__actions">
                  {prompt.initial ? (
                    <span className="sdj-dup__initial">
                      <label htmlFor={ids.initial}>Last initial</label>
                      <TextInput
                        ref={initialRef}
                        id={ids.initial}
                        className="sdj-dup__field"
                        value={state.initial}
                        maxLength={2}
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        enterKeyHint="go"
                        aria-describedby={`${ids.dup} ${ids.error}`}
                        onChange={(e) => dispatch({ type: 'initial', value: e.currentTarget.value })}
                      />
                    </span>
                  ) : null}
                  <Button
                    variant="ghost"
                    className="sdj-dup__keep"
                    disabled={busy}
                    onClick={() => state.taken && void join(state.taken.name, false)}
                  >
                    Keep “{state.taken.suggestion}”
                  </Button>
                </div>
              ) : null}
            </div>

            {/* Always in the page, so every error is announced: no name, no initial, a locked room… */}
            <p id={ids.error} className="sdj__error" role="alert" data-part="event-join-error">
              {state.error ? (
                <>
                  <PixelIcon name="warning" size={14} /> {state.error}
                </>
              ) : null}
            </p>
          </div>

          <NameTag name={sending} look={look} />

          <div className="sdj-skip">
            <p id={ids.skip} className="sdj-skip__text">
              You might be picked to answer. Rather not? Switch on <b>Skip me</b>.
            </p>
            <Toggle
              className="sdj-skip__switch"
              label="Skip me"
              checked={skip}
              onChange={setSkip}
              aria-describedby={ids.skip}
              data-part="event-join-skip"
            />
          </div>

          <Button type="submit" variant="primary" size="lg" block loading={busy} className="sdj__go" data-part="event-join-go">
            {withLetter ? `Join as ${sending}` : 'Join the show'}
          </Button>
          <p className="sdj__fine">Just a display name — no email, full name or ID.</p>
        </form>
      </div>
    </GameTheme>
  );
}
