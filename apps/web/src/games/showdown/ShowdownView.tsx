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
import { useCallback, useEffect, useRef, useSyncExternalStore, type ComponentType, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  SHOWDOWN_MSG,
  SHOWDOWN_TEAMS,
  teamName,
  type ShowdownCue,
  type ShowdownEvent,
  type ShowdownFinale,
  type ShowdownLook,
  type ShowdownPublicState,
  type ShowdownReactions,
  type ShowdownSettings,
} from '@dascade/shared/games/showdown';
import { Button, GameTheme, IconButton, PixelIcon } from '@dascade/ui';
import { GAME_CATALOG } from '@dascade/shared';
import { session, useRoomMessage, useRoomSelector } from '../../net/hooks.ts';
import { useSessionStore } from '../../net/session.ts';
import { useApp } from '../../app/store.ts';
import { audioReady, onAudioReadyChange } from '../../audio/audio.ts';
import { GameStage, LeaveButton, ResultsActions } from '../../shell/common.tsx';
import { Lobby } from '../../shell/Lobby.tsx';
import type { GameClientModule, SettingsPanelProps } from '../types.ts';
import { AudienceView, switchToScreen } from './Audience.tsx';
import { PresenterConsole } from './Console.tsx';
import { ShowdownPlayerSetup, ShowdownSettingsPanel, TakeoverCard } from './Lobby.tsx';
import { Stage } from './Stage.tsx';
import { lineForCue, lineForEvent } from './look.ts';
import { showFeed } from './fx.ts';
import { CUE_SOUND, playShowSound, type ShowdownSound } from './sounds.ts';
import { canFullscreen, closeStageWindow, toggleFullscreen, useStageWindow } from './stageWindow.ts';
import { rememberPass, storedPass, takeHashPass, useScreenMode } from './access.ts';
import { useBoard, useFinale, useLook, useMe, useMotion, usePass, useRole, useShowSounds, useShowdownSettings, type RoleInfo } from './state.ts';

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

  // Leaving the room closes the stage window and clears the feed.
  useEffect(
    () => () => {
      closeStageWindow();
      showFeed.reset();
    },
    [],
  );
  // The stage window belongs to the presenter: close it if the role moves elsewhere.
  useEffect(() => {
    if (role.role !== 'presenter' && stageWin.open) closeStageWindow();
  }, [role.role, stageWin.open]);

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
        <p>
          This tab took over your presenter seat, so it won’t show the big screen: your console (with the answers) would end up on it.
        </p>
        <p>
          For a second screen on this computer, press <b>Stage window</b> in the console. For a TV or projector computer, open the big-screen link on
          that device.
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

// ---------------------------------------------------------------------------
// The per-device show feed
// ---------------------------------------------------------------------------

function eventSounds(e: ShowdownEvent): Array<[ShowdownSound, number]> {
  switch (e.type) {
    case 'intro':
      return [['intro', 0]];
    case 'round':
      return [['round', 0]];
    case 'question':
      return [['question', 0]];
    case 'control':
      return [['control', 0]];
    case 'reveal':
      return e.cleared ? [[e.top ? 'clangTop' : 'clang', 0], ['applause', 600]] : [[e.top ? 'clangTop' : 'clang', 0]];
    case 'strike':
      if (e.stealFailed) return [['stealMiss', 0]];
      return e.steal ? [['strike', 0], ['stealOpen', 950]] : [['strike', 0]];
    case 'award':
      if (e.how === 'none') return [['aww', 0]];
      return e.how === 'steal' ? [['award', 300], ['applause', 700]] : [['award', 300]];
    case 'undo':
      return [['undo', 0]];
    case 'adjust':
      return [];
  }
}

function useShowSync(role: RoleInfo, look: ShowdownLook, code: string, settings: ShowdownSettings | null, screen: boolean): void {
  const board = useBoard();
  const motion = useMotion();
  const [sounds] = useShowSounds(role.role);
  const pass = usePass();
  const me = useMe();
  const finale = useFinale();
  const status = useSessionStore((s) => s.status);
  const loaded = useRoomSelector<ShowdownPublicState, boolean>((s) => Boolean(s.code)) ?? false;
  const serverScreen = useRoomSelector<ShowdownPublicState, boolean>((s) => Boolean(role.playerId && s.screens?.[role.playerId])) ?? false;
  const ctx = useRef({ look, board, names: ['', ''] as [string, string], sounds, particles: motion.particles });
  ctx.current = { look, board, names: [teamName(settings, 0), teamName(settings, 1)], sounds, particles: motion.particles };
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t);
    },
    [],
  );

  const play = useCallback((list: Array<[ShowdownSound, number]>) => {
    if (!ctx.current.sounds) return;
    timers.current = timers.current.slice(-20);
    for (const [sound, delay] of list) {
      if (delay <= 0) playShowSound(sound, ctx.current.look);
      else timers.current.push(setTimeout(() => playShowSound(sound, ctx.current.look), delay));
    }
  }, []);

  useRoomMessage<ShowdownEvent>(SHOWDOWN_MSG.event, (e) => {
    showFeed.event(e);
    showFeed.say(lineForEvent(e, { look: ctx.current.look, board: ctx.current.board, teamNames: ctx.current.names }));
    play(eventSounds(e));
  });

  useRoomMessage<{ cue: ShowdownCue; id: number }>(SHOWDOWN_MSG.cue, ({ cue, id }) => {
    showFeed.cue(cue, id);
    showFeed.say(lineForCue(cue, id, ctx.current.look));
    play([[CUE_SOUND[cue], 0]]);
  });

  useRoomMessage<ShowdownReactions>(SHOWDOWN_MSG.reactions, (batch) => showFeed.reactions(batch, Math.min(14, Math.round(ctx.current.particles / 4))));

  // Remember the presenter pass in this browser (for a refreshed tab or a second device).
  useEffect(() => {
    if (pass && code) rememberPass(code, pass);
  }, [pass, code]);

  // Presenter link (#presenter=…) or a pass this browser remembers, while nobody presents.
  const claimed = useRef(false);
  useEffect(() => {
    if (claimed.current || status !== 'connected' || !loaded || !role.playerId || !code) return;
    const fromLink = takeHashPass();
    if (fromLink) {
      claimed.current = true;
      if (role.role !== 'presenter') session.send(SHOWDOWN_MSG.claim, { pass: fromLink });
      return;
    }
    if (role.presenterId === '' && !screen) {
      const remembered = storedPass(code);
      if (remembered) {
        claimed.current = true;
        session.send(SHOWDOWN_MSG.claim, { pass: remembered });
      }
    }
  }, [status, loaded, role.playerId, role.presenterId, role.role, code, screen]);

  // Keep the server's stage-display list in step with this device's choice.
  useEffect(() => {
    if (status !== 'connected' || !loaded || !role.playerId || role.role === 'presenter') return;
    if (screen !== serverScreen) session.send(SHOWDOWN_MSG.screen, { on: screen });
  }, [screen, serverScreen, status, loaded, role.playerId, role.role]);

  // "You called it!" — a private flash + chime when one of your guesses flips.
  const lastCalls = useRef<{ calls: number; points: number } | null>(null);
  useEffect(() => {
    if (!me) return;
    const prev = lastCalls.current;
    lastCalls.current = { calls: me.calls, points: me.points };
    if (!prev || me.calls <= prev.calls || me.points <= prev.points) return;
    showFeed.called(me.points - prev.points);
    playShowSound('calledIt', ctx.current.look);
  }, [me]);

  // The finale: fanfare + applause once per show on this device.
  const finaleKey = useRef('');
  useEffect(() => {
    if (!finale) return;
    const key = JSON.stringify(finale.scores) + finale.results.length;
    if (finaleKey.current === key) return;
    finaleKey.current = key;
    play([['finale', 250]]);
  }, [finale, play]);
}
