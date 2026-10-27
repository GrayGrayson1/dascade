/**
 * The per-device show feed: board events, cues and reactions go into one store that every stage on
 * this device reads, and the show's sounds and theme music play once here. Also claims the presenter
 * role from a presenter link or a pass this browser remembers, and keeps the server's stage-display
 * list in step.
 *
 * Where the sound plays (AUD-02 C, showAudio.ts):
 *  - Outside event rooms, as always: presenter consoles and big screens play show sound; phones only
 *    if their owner switched show sounds on.
 *  - In an event room, only the sound station plays it (the presenter's console unless the crew moved
 *    it to a big screen). The console and big screens report their audio every SHOWDOWN_AUDIO_BEAT_MS;
 *    a station that stops answering falls back to the console, which says so.
 *  - Local mute/volume and the device's show-sounds switch always win.
 *
 * The music (AUD-04 C): in Presenter Showcase event rooms the jukebox pauses as a question goes live
 * and comes back in the breaks (a title card, a holding card, the results) — only if the show paused
 * it — and the theme bed never plays over the jukebox. Room DJ is the server's (locked while PLAYING).
 *
 * Nothing replays: board events are live messages, and the sounds this hook derives from state (the
 * called-it chime, the card whoosh, the finale) stay quiet for a moment after every (re)connect, so a
 * reconnect or a restored room only resyncs the picture.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  SHOWDOWN_AUDIO_BEAT_MS,
  SHOWDOWN_MSG,
  showTitle,
  teamName,
  type ShowdownCue,
  type ShowdownEvent,
  type ShowdownLook,
  type ShowdownPublicState,
  type ShowdownReactions,
  type ShowdownSettings,
} from '@dascade/shared/games/showdown';
import { serverNow, session, useRoomMessage, useRoomSelector } from '../../net/hooks.ts';
import { useSessionStore } from '../../net/session.ts';
import { useApp } from '../../app/store.ts';
import { audioReady, onAudioReadyChange } from '../../audio/audio.ts';
import { jukeboxShowPause } from '../../audio/jukebox/engine.ts';
import { useJukebox } from '../../audio/jukebox/store.ts';
import { lineForCue, lineForEvent } from './look.ts';
import { showFeed } from './fx.ts';
import { CUE_SOUND, playShowSound, preloadShowSounds, type ShowdownSound } from './sounds.ts';
import { themeMusic } from './themeMusic.ts';
import { rememberPass, storedPass, takeHashPass } from './access.ts';
import { showdownApi } from './api.ts';
import {
  bedWanted,
  createShowSoundRouter,
  jukeboxAudible,
  jukeboxStep,
  locallySilenced,
  musicSegment,
  playsShowSound,
  sendsAudioBeat,
  stationLostMessage,
  type MusicSegment,
} from './showAudio.ts';
import {
  useBoard,
  useCard,
  useFinale,
  useMe,
  useMode,
  useMotion,
  usePass,
  useShowSounds,
  useStation,
  useThemeMusicPref,
  type RoleInfo,
} from './state.ts';

/** After a (re)connect, state changes are a resync, not moments: no chime, whoosh or finale for this long. */
const RESYNC_QUIET_MS = 1500;

const subscribeHold = (cb: () => void) => jukeboxShowPause.subscribe(cb);
const holdOwner = () => jukeboxShowPause.owner;

export function useShowSync(role: RoleInfo, look: ShowdownLook, code: string, settings: ShowdownSettings | null, screen: boolean): void {
  const board = useBoard();
  const mode = useMode(settings);
  const card = useCard();
  const phase = useRoomSelector<ShowdownPublicState, string>((s) => s.phase) ?? 'LOBBY';
  const [musicPref] = useThemeMusicPref();
  const motion = useMotion();
  const [sounds] = useShowSounds(role.role);
  const station = useStation();
  const pass = usePass();
  const me = useMe();
  const finale = useFinale();
  const status = useSessionStore((s) => s.status);
  const loaded = useRoomSelector<ShowdownPublicState, boolean>((s) => Boolean(s.code)) ?? false;
  const serverScreen = useRoomSelector<ShowdownPublicState, boolean>((s) => Boolean(role.playerId && s.screens?.[role.playerId])) ?? false;
  const event = station.event;
  const audible = playsShowSound({ event, mine: station.mine, sounds });

  const ctx = useRef({
    look,
    board,
    mode,
    show: '',
    names: ['', ''] as [string, string],
    audible,
    particles: motion.particles,
    role: role.role,
  });
  ctx.current = {
    look,
    board,
    mode,
    show: settings ? showTitle(settings) : '',
    names: [teamName(settings, 0), teamName(settings, 1)],
    audible,
    particles: motion.particles,
    role: role.role,
  };

  // Every show sound goes through the router: gated on this device playing show sound as it fires.
  const router = useRef<ReturnType<typeof createShowSoundRouter> | null>(null);
  router.current ??= createShowSoundRouter({
    play: (sound) => playShowSound(sound, ctx.current.look),
    allowed: () => ctx.current.audible,
    now: serverNow,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  });
  useEffect(() => () => router.current?.dispose(), []);
  const play = useCallback((list: Array<[ShowdownSound, number]>) => router.current?.play(list), []);

  // A (re)connect resyncs the room: the state-derived sounds below hold their tongue meanwhile.
  const quietUntil = useRef(0);
  useEffect(() => {
    if (status === 'connected') quietUntil.current = performance.now() + RESYNC_QUIET_MS;
  }, [status]);

  // The last screen that held the station, for the console's "… stopped answering".
  const lastScreen = useRef('');
  useEffect(() => {
    if (station.station && station.holderName) lastScreen.current = station.holderName;
  }, [station.station, station.holderName]);

  useRoomMessage<ShowdownEvent>(SHOWDOWN_MSG.event, (e) => {
    showFeed.event(e);
    showFeed.say(
      lineForEvent(e, {
        look: ctx.current.look,
        board: ctx.current.board,
        teamNames: ctx.current.names,
        mode: ctx.current.mode,
        show: ctx.current.show,
      }),
    );
    router.current?.event(e, ctx.current.mode);
    if (e.type === 'station' && e.lost && !e.playerId && ctx.current.role === 'presenter') {
      useApp.getState().toast('warning', stationLostMessage(lastScreen.current), 10_000);
    }
  });

  useRoomMessage<{ cue: ShowdownCue; id: number }>(SHOWDOWN_MSG.cue, ({ cue, id }) => {
    showFeed.cue(cue, id);
    showFeed.say(lineForCue(cue, id, ctx.current.look));
    play([[CUE_SOUND[cue], 0]]);
  });

  useRoomMessage<ShowdownReactions>(SHOWDOWN_MSG.reactions, (batch) =>
    showFeed.reactions(batch, Math.min(14, Math.round(ctx.current.particles / 4))),
  );

  // ---- The sound station's heartbeat (event rooms: the console and big screens, never phones) ----
  const ready = useSyncExternalStore(onAudioReadyChange, audioReady, () => false);
  const silenced = useApp((s) => locallySilenced(s.settings));
  const beat = sendsAudioBeat({ event, role: role.role, connected: status === 'connected', loaded });
  useEffect(() => {
    if (!beat) return;
    // Now (a change is news at once), then every beat; mute and readiness are read fresh each time.
    const send = () => showdownApi.audio(audioReady(), locallySilenced(useApp.getState().settings), sounds);
    send();
    const t = setInterval(send, SHOWDOWN_AUDIO_BEAT_MS);
    return () => clearInterval(t);
  }, [beat, ready, silenced, sounds]);

  // Recorded show sounds (Brian's soundboard) are decoded once audio is unlocked, so the first press isn't late.
  useEffect(() => {
    if (ready && sounds && mode === 'showcase') preloadShowSounds(look);
  }, [ready, sounds, mode, look]);

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
    // On the calls count: a ranked showcase board has no points, but calling one is still a moment.
    if (!prev || me.calls <= prev.calls || performance.now() < quietUntil.current) return;
    showFeed.called(Math.max(0, me.points - prev.points));
    // Phones default to show sounds off: a room of them chiming with the stage's clang is the echo that
    // avoids. In an event room only the station chimes (and phones never hold it).
    play([['calledIt', 0]]);
  }, [me, play]);

  // A holding card going up gets a soft whoosh (once per change, not for a device that joins on one).
  const lastCard = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!loaded) return;
    const prev = lastCard.current;
    lastCard.current = card;
    if (prev !== undefined && card && card !== prev && performance.now() >= quietUntil.current) play([['cardIn', 0]]);
  }, [card, loaded, play]);

  // ---- The jukebox steps aside for live questions (AUD-04: Presenter Showcase event rooms) ----
  const stage = board?.stage ?? null;
  const segment = musicSegment({ phase, stage, card });
  const linkJukebox = event && mode === 'showcase' && loaded && (role.role === 'presenter' || role.role === 'screen');
  const lastSegment = useRef<MusicSegment | null>(null);
  useEffect(() => {
    if (!linkJukebox || !code) {
      lastSegment.current = null;
      return;
    }
    const step = jukeboxStep(lastSegment.current, segment);
    lastSegment.current = segment;
    if (step === 'hold') jukeboxShowPause.hold(code);
    else if (step === 'release') jukeboxShowPause.release(code);
  }, [linkJukebox, segment, code]);

  // Theme music (Presenter Showcase): under the opening, the title cards and the holding cards; it
  // stops the moment a question goes up. Only where show sounds play — and in an event room never
  // over the jukebox, nor while the show holds the jukebox paused (one music source per segment).
  const held = useSyncExternalStore(subscribeHold, holdOwner, holdOwner);
  const jukeboxVolume = useApp((s) => s.settings.jukeboxVolume);
  const jukeboxOn = useJukebox((s) => jukeboxAudible(s, { jukeboxVolume }));
  const jukeboxBusy = event && (jukeboxOn || held !== '');
  const musicOn = bedWanted({ mode, musicPref, audible, phase, stage, card, jukeboxBusy });
  useEffect(() => {
    if (!musicOn) {
      themeMusic.stop();
      return;
    }
    // The opening has its own fanfare: the bed comes in under the marquee once it has played.
    const t = setTimeout(() => themeMusic.play(look), stage === 'intro' && card === null ? 4200 : 0);
    return () => clearTimeout(t);
  }, [musicOn, look, stage, card]);
  useEffect(() => () => themeMusic.stop(), []);

  // The finale: Brian's applause once per show on this device, as the show ends. A device that
  // joins (or reloads, or reconnects) on the results screen hears nothing: that finale is already over.
  const finaleKey = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const key = finale ? JSON.stringify(finale.scores) + finale.results.length : '';
    const prev = finaleKey.current;
    finaleKey.current = key;
    if (prev === null || !key || key === prev || performance.now() < quietUntil.current) return;
    play([['finale', 250]]);
  }, [finale, loaded, play]);
}
