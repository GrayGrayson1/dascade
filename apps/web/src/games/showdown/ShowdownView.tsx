/**
 * DAS Survey Showdown — the client root. Renders in every phase (the module's lobbyPhases is empty)
 * and picks the experience for this connection:
 *
 *   presenter → the shared lobby, then the presenter console (+ the stage window portal)
 *   big screen → the stage, full window (also in the lobby: the waiting marquee)
 *   audience  → the shared lobby (team pick), then the audience view
 *   everyone  → the finale on RESULTS
 *
 * It also owns the per-device show feed: board events, cues and reactions go into one store that
 * every stage on this device reads, sounds play once here, and a presenter link (#presenter=…) or a
 * pass remembered in this browser reclaims the presenter role.
 */
import { useEffect, useRef, useSyncExternalStore, type ComponentType, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  SHOWDOWN_MSG,
  SHOWDOWN_TEAMS,
  showTitle,
  teamName,
  type ShowdownFinale,
  type ShowdownLook,
  type ShowdownMe,
  type ShowdownPublicState,
  type ShowdownSettings,
  type ShowdownBlackBox,
} from '@dascade/shared/games/showdown';
import { Button, GameTheme, IconButton, PixelIcon } from '@dascade/ui';
import { GAME_CATALOG } from '@dascade/shared';
import { useRoomMessage, useRoomSelector } from '../../net/hooks.ts';
import { useSessionStore } from '../../net/session.ts';
import { useApp } from '../../app/store.ts';
import { audioReady, onAudioReadyChange } from '../../audio/audio.ts';
import { GameStage, LeaveButton, ResultsActions } from '../../shell/common.tsx';
import { Lobby } from '../../shell/Lobby.tsx';
import type { GameClientModule, SettingsPanelProps } from '../types.ts';
import { AudienceView, switchToScreen } from './Audience.tsx';
import { PresenterConsole } from './Console.tsx';
import { StageCards } from './consoleParts.tsx';
import { ShowdownPlayerSetup, ShowdownSettingsPanel, TakeoverCard } from './Lobby.tsx';
import { Stage } from './Stage.tsx';
import { LOOK_COPY, fill } from './look.ts';
import { showFeed } from './fx.ts';
import { useShowSync } from './useShowSync.ts';
import { CrewView } from './CrewView.tsx';
import { StationBadge } from './StationBadge.tsx';
import { showdownApi } from './api.ts';
import { clearBlackBox, forgetRecoverable, markRecoverable, onRecoveryGiveUp, saveBlackBox } from '../../net/recovery.ts';
import { canRecover } from '../../shell/ShowRecovery.tsx';
import { serverUrl } from '../../net/serverUrl.ts';

/** How often an event room's console pings the server's health check (keep-warm). */
const KEEP_WARM_MS = 4 * 60_000;

// Nobody is bringing the room back after all: a stage window held through the outage closes.
onRecoveryGiveUp(() => {
  if (stageWindowOpen()) closeStageWindow();
});
import {
  canFullscreen,
  closeStageWindow,
  holdStageWindow,
  setStageWindowTitle,
  stageWindowOpen,
  toggleFullscreen,
  useStageWindow,
} from './stageWindow.ts';
import { takeHashCrew, useScreenMode } from './access.ts';
import { useCrew, useEvent, useFinale, useLook, useMe, useRole, useShowSounds, useShowdownSettings, type RoleInfo } from './state.ts';

/** The shared lobby with the show's setup panels (the lobby is rendered from here, not the shell). */
const LOBBY_MODULE: GameClientModule = {
  GameView: () => null,
  SettingsPanel: ShowdownSettingsPanel as unknown as ComponentType<SettingsPanelProps<never>>,
  PlayerSetup: ShowdownPlayerSetup,
  lobbyStartTab: 'setup',
};

export function ShowdownView() {
  const code = useSessionStore((s) => s.code) ?? '';
  const phase = useRoomSelector<ShowdownPublicState, string>((s) => s.phase) ?? 'LOBBY';
  const settings = useShowdownSettings();
  const look = useLook(settings);
  const screen = useScreenMode(code);
  const role = useRole(screen);
  const stageWin = useStageWindow();

  useShowSync(role, look, code, settings, screen);
  useEventRoom(code, role);
  const crew = useCrew();

  // Leaving the room closes the stage window and clears the feed. Losing the connection to an event
  // room doesn't (OPS-01): Teams keeps sharing the window, which holds a calm card until the room is
  // back (restored from the black box) and this view portals into the same window again.
  const codeRef = useRef(code);
  codeRef.current = code;
  useEffect(
    () => () => {
      const status = useSessionStore.getState().status;
      const lost = status === 'lost' || status === 'reconnecting';
      if (lost && canRecover(codeRef.current) && stageWindowOpen()) {
        holdStageWindow({ title: 'We’ll be right back', line: 'The show is reconnecting — stay tuned.' });
      } else closeStageWindow();
      showFeed.reset();
    },
    [],
  );
  // The stage window belongs to the presenter: close it if the role moves to someone else. (A fresh
  // mount — e.g. a room just restored from its black box — can see the room's state before its own
  // player id arrives, or no presenter yet: neither is a move.)
  const loaded = useRoomSelector<ShowdownPublicState, boolean>((s) => Boolean(s.code)) ?? false;
  const otherPresents = loaded && Boolean(role.playerId) && role.presenterId !== '' && role.presenterId !== role.playerId;
  useEffect(() => {
    if (otherPresents && stageWin.open) closeStageWindow();
  }, [otherPresents, stageWin.open]);
  // Its title follows the show's (a preset loaded with the window already open renames it).
  const showName = settings ? showTitle(settings) : '';
  useEffect(() => {
    if (stageWin.open && showName) setStageWindowTitle(showName);
  }, [stageWin.open, showName]);

  const portal =
    stageWin.container && role.role === 'presenter'
      ? createPortal(
          <GameTheme accent={GAME_CATALOG.showdown.accent} className="sd-window__theme">
            <Stage look={look} settings={settings} variant="screen" corner={<FullscreenButton />} />
          </GameTheme>,
          stageWin.container,
        )
      : null;

  let body;
  // The presenter's own browser opened the big-screen link: that tab took the presenter's seat (seats are
  // per browser), and the console it would show carries the answers. Never put that on a big screen.
  if (role.role === 'presenter' && screen) body = <PresenterScreenGuard code={code} />;
  else if (role.role === 'screen') body = <BigScreen look={look} settings={settings} code={code} />;
  // Crew who aren't presenting (a moderator, a producer on a second device) get the crew screen in every phase.
  else if (role.role === 'audience' && crew?.event && crew.roles.length > 0)
    body = <CrewView look={look} settings={settings} code={code} />;
  else if (phase === 'LOBBY' || phase === 'COUNTDOWN') body = <Lobby gameId="showdown" module={LOBBY_MODULE} />;
  else if (phase === 'RESULTS') body = <Results look={look} settings={settings} role={role} />;
  else if (role.role === 'presenter')
    body = (
      <GameStage gameId="showdown" className="sd-room">
        <PresenterConsole look={look} settings={settings} code={code} />
      </GameStage>
    );
  else
    body = (
      <GameStage gameId="showdown" className="sd-room">
        <AudienceView look={look} settings={settings} code={code} role={role} />
      </GameStage>
    );

  return (
    <>
      {body}
      {portal}
    </>
  );
}

/**
 * Event rooms (OPS-01, ADM-04): redeem a crew link from the address bar, keep the presenter's black
 * box on this device, and remember that this room is worth waiting for after a server restart.
 */
function useEventRoom(code: string, role: RoleInfo): void {
  const event = useEvent();
  const status = useSessionStore((s) => s.status);
  const loaded = useRoomSelector<ShowdownPublicState, boolean>((s) => Boolean(s.code)) ?? false;

  // `#crew=<id>.<secret>`: read once, stripped from the address bar, sent over the room connection.
  const claimed = useRef(false);
  useEffect(() => {
    if (claimed.current || status !== 'connected' || !loaded || !role.playerId) return;
    const link = takeHashCrew();
    claimed.current = true;
    if (link) showdownApi.claimCrew(link);
  }, [status, loaded, role.playerId]);

  useEffect(() => {
    if (event && code) markRecoverable(code, 'showdown');
  }, [event, code]);

  // Only the presenter carries a black box: a former presenter's device drops its old one (it must
  // never win a restore), and once the show is over a guest has nothing to wait for after a restart.
  const phase = useRoomSelector<ShowdownPublicState, string>((s) => s.phase) ?? '';
  useEffect(() => {
    if (!code || !loaded) return;
    if (role.playerId && role.presenterId && role.presenterId !== role.playerId) clearBlackBox(code);
    if (phase === 'RESULTS' && role.role !== 'presenter') forgetRecoverable(code);
  }, [code, loaded, role.role, role.playerId, role.presenterId, phase]);

  // Keep-warm (OPS-01): Render's free plan sleeps without inbound HTTP traffic, and nobody has checked
  // whether WebSocket traffic counts. The presenter's console pings the health check while an event runs.
  const presenting = role.role === 'presenter';
  useEffect(() => {
    if (!event || !presenting) return;
    const ping = () => void fetch(`${serverUrl()}/api/health`, { cache: 'no-store' }).catch(() => undefined);
    const t = setInterval(ping, KEEP_WARM_MS);
    return () => clearInterval(t);
  }, [event, presenting]);

  useRoomMessage<ShowdownBlackBox | null>(SHOWDOWN_MSG.blackbox, (box) => {
    if (!code) return;
    if (!box) clearBlackBox(code);
    else if (box.code === code) saveBlackBox({ code, gameId: 'showdown', takenAt: box.takenAt, blob: box.blob });
  });
}

function FullscreenButton() {
  if (!canFullscreen()) return null;
  return (
    <IconButton
      icon="maximize"
      label="Full screen"
      size="sm"
      variant="secondary"
      className="sd-fullscreen"
      onClick={(e) => toggleFullscreen(e.currentTarget)}
    />
  );
}

/**
 * Browsers start audio only after a click or tap on the page. A big screen that joined (or reloaded)
 * on its own would stay silent all show without anyone noticing: say so until the first tap.
 */
function SoundPrompt() {
  const [sounds] = useShowSounds('screen');
  const muted = useApp((s) => s.settings.muted);
  const ready = useSyncExternalStore(onAudioReadyChange, audioReady, () => true);
  if (!sounds || muted || ready) return null;
  return (
    // Any click on the page unlocks audio (installAudio's gesture listener); this is where to click.
    <button type="button" className="sd-soundprompt" data-part="showdown-sound-prompt">
      <PixelIcon name="sound-on" /> Click or tap here for the show’s sound
    </button>
  );
}

function PresenterScreenGuard({ code }: { code: string }) {
  return (
    <GameStage gameId="showdown" className="sd-room">
      <section className="sd-panel sd-guard" role="alert" data-part="showdown-screen-guard">
        <h2 className="sd-panel__title">
          <PixelIcon name="eye" /> This browser is the presenter’s
        </h2>
        <p>This tab took over your presenter seat, so it won’t show the big screen: your console (with the answers) would end up on it.</p>
        <p>
          For a second screen on this computer, press <b>Stage window</b> in the console. For a TV or projector computer, open the
          big-screen link on that device.
        </p>
        <Button variant="primary" icon="crown" onClick={() => switchToScreen(code, false)}>
          Use this tab as the presenter console
        </Button>
      </section>
    </GameStage>
  );
}

/** A device showing the stage full-window (TV, projector PC). */
function BigScreen({ look, settings, code }: { look: ShowdownLook; settings: ShowdownSettings | null; code: string }) {
  return (
    <div className="sd-screen" data-part="showdown-screen" data-look={look}>
      <SoundPrompt />
      <Stage
        look={look}
        settings={settings}
        variant="screen"
        corner={
          <>
            <StationBadge compact />
            <FullscreenButton />
            <Button size="sm" variant="ghost" onClick={() => switchToScreen(code, false)}>
              Exit big screen
            </Button>
            <LeaveButton size="sm" collapseLabel />
          </>
        }
      />
    </div>
  );
}

function Results({ look, settings, role }: { look: ShowdownLook; settings: ShowdownSettings | null; role: RoleInfo }) {
  const finale = useFinale();
  const me = useMe();
  const names: [string, string] = [teamName(settings, 0), teamName(settings, 1)];
  if ((finale?.mode ?? settings?.mode) === 'showcase')
    return <ShowcaseResults look={look} settings={settings} role={role} finale={finale} me={me} />;
  return (
    <GameStage gameId="showdown" className="sd-room sd-results">
      <div className="sd-results__stage">
        <Stage look={look} settings={settings} variant="preview" />
      </div>
      <div className="sd-results__below">
        {finale ? <FinaleSummary finale={finale} /> : null}
        {role.role === 'audience' && me ? (
          <p className="sd-results__me">
            <PixelIcon name="star" /> You called <span className="dc-num">{me.calls}</span> answer{me.calls === 1 ? '' : 's'} for{' '}
            <span className="dc-num">{me.points}</span> Survey Sayer points{role.team !== null ? ` · ${names[role.team]}` : ''}
            {finale && role.team !== null && finale.winner === role.team ? ' — your team won!' : ''}
          </p>
        ) : null}
        {/* The presenter left for good: someone has to be able to run the next show. */}
        {role.presenterId === '' && role.role !== 'screen' ? <TakeoverCard /> : null}
        <ResultsActions />
      </div>
    </GameStage>
  );
}

/**
 * Presenter Showcase's closing screen: no winner and no leaderboard (there were no teams or
 * scores) — a friendly wrap with what the crowd found. The presenter gets the stage cards here, to
 * put up Prize time (or Thanks) for the rest of the event.
 */
function ShowcaseResults({
  look,
  settings,
  role,
  finale,
  me,
}: {
  look: ShowdownLook;
  settings: ShowdownSettings | null;
  role: RoleInfo;
  finale: ShowdownFinale | null;
  me: ShowdownMe | null;
}) {
  const copy = LOOK_COPY[look].showcase;
  const title = settings ? showTitle(settings) : '';
  const results = finale?.results ?? [];
  const presenter = role.role === 'presenter';
  const closing = (
    <section className="sd-panel sdc-closing" aria-label="That’s a wrap">
      <p className="sdc-closing__title">{copy.wrap}</p>
      <p className="sdc-closing__sub">{title ? `Thanks for playing ${title}!` : copy.wrapSub}</p>
      {results.length ? (
        <ul className="sdc-closing__rounds">
          {results.map((r) => (
            <li key={r.index}>
              <span className="sdc-closing__r">Round {r.index + 1}</span>
              <span>{r.total ? fill(copy.recap, { found: r.found ?? 0, total: r.total }) : 'Skipped'}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {role.role === 'audience' && me && me.calls > 0 ? (
        <p className="sdc-closing__me">
          <PixelIcon name="star" /> You called <span className="dc-num">{me.calls}</span> answer{me.calls === 1 ? '' : 's'}!
        </p>
      ) : null}
    </section>
  );
  return (
    <GameStage gameId="showdown" className={`sd-room sd-results sdc-results${presenter ? ' sdc-results--presenter' : ''}`}>
      <div className="sd-results__stage">
        <Stage look={look} settings={settings} variant="preview" />
      </div>
      <div className="sd-results__below">
        {presenter ? (
          // The presenter's next moves first: a stage card for the rest of the event, or another show.
          <>
            <section className="sd-panel sdc-afterpanel" aria-label="Stage cards">
              <h3 className="sd-panel__title">Stage cards</h3>
              <p className="sd-muted">
                For the rest of the event: put up Prize time for the winners, then Thanks. Play again goes back to the lobby (the cards stay
                available there).
              </p>
              <StageCards />
            </section>
            <ResultsActions />
            {closing}
          </>
        ) : (
          <>
            {closing}
            {/* The presenter left for good: someone has to be able to run the next show. */}
            {role.presenterId === '' && role.role !== 'screen' ? <TakeoverCard /> : null}
            <ResultsActions />
          </>
        )}
      </div>
    </GameStage>
  );
}

/** The final scores as plain text, for phones: the 16:9 finale is too small to read at 360 px (CSS shows it there only). */
function FinaleSummary({ finale }: { finale: ShowdownFinale }) {
  return (
    <section className="sd-panel sd-finalesum" aria-label="Final scores">
      <p className="sd-finalesum__winner">{finale.winner === -1 ? 'It’s a tie!' : `${finale.names[finale.winner]} wins!`}</p>
      <ul className="sd-finalesum__teams">
        {([0, 1] as const).map((t) => (
          <li key={t} data-won={finale.winner === t ? 'true' : undefined} style={{ '--team': SHOWDOWN_TEAMS[t].color } as CSSProperties}>
            <span className="sd-finalesum__name">{finale.names[t]}</span>
            <span className="dc-num">{finale.scores[t]}</span>
          </li>
        ))}
      </ul>
      {finale.callers.length ? (
        <p className="sd-finalesum__callers">
          Top Survey Sayers:{' '}
          {finale.callers.slice(0, 3).map((c, i) => (
            <span key={c.playerId}>
              {i > 0 ? ' · ' : ''}
              {c.name} <span className="dc-num">{c.points}</span>
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}
