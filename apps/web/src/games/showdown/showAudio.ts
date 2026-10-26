/**
 * Where the show's sound plays and when the music steps aside — the rules useShowSync and
 * StationBadge apply, kept pure (plus one small timer-driven router) so they're unit-tested
 * (showAudio.test.ts).
 *
 *  - AUD-02 C, the sound station: in an event room exactly one device plays the show's sound (the
 *    station the server names: the presenter's console unless the crew moved it to a big screen).
 *    Outside event rooms nothing changes: each device plays show sound if its show-sounds switch is on.
 *    Local mute and volume always apply on top (the shared mixer does that).
 *  - AUD-04 C, jukebox for breaks only: in Presenter Showcase event rooms the jukebox pauses as a
 *    question goes live and comes back in the breaks (a round's title card, a holding card, the
 *    results) — only if the show paused it — and the theme bed never plays over the jukebox.
 */
import {
  SHOWDOWN_AUDIO_SILENT,
  SHOWDOWN_STATION_TIMEOUT_MS,
  type ShowdownCard,
  type ShowdownEvent,
  type ShowdownMode,
  type ShowdownStage,
} from '@dascade/shared/games/showdown';
import { showsPlaying, type JukeboxState } from '../../audio/jukebox/store.ts';
import { eventSounds, pickSounds, type ShowdownSound } from './sounds.ts';
import type { ShowdownRole } from './state.ts';

// ---------------------------------------------------------------------------
// The sound station (AUD-02)
// ---------------------------------------------------------------------------

export interface ShowSoundGate {
  /** This is an event room (the station decides). */
  event: boolean;
  /** This connection is the sound station (useStation().mine). */
  mine: boolean;
  /** This device's show-sounds switch (useShowSounds). */
  sounds: boolean;
}

/**
 * Whether this device plays the show's sounds (events, cues, the called-it chime, the card whoosh, the
 * finale, the theme music). Outside event rooms: the device's show-sounds switch, as always. In an
 * event room: only on the sound station, and still only with its show sounds on.
 */
export function playsShowSound(g: ShowSoundGate): boolean {
  return g.sounds && (!g.event || g.mine);
}

/**
 * Whether this device reports its audio to the server (`showdown:audio`, every SHOWDOWN_AUDIO_BEAT_MS):
 * in an event room, the presenter's console and big screens — the devices that can hold the station.
 * Phones never do.
 */
export function sendsAudioBeat(o: { event: boolean; role: ShowdownRole; connected: boolean; loaded: boolean }): boolean {
  return o.event && o.connected && o.loaded && (o.role === 'presenter' || o.role === 'screen');
}

/** The heartbeat's `muted`: anything that silences this device's show sound (mute, master or SFX volume at 0). */
export function locallySilenced(s: { muted: boolean; masterVolume: number; sfxVolume: number }): boolean {
  return s.muted || !(s.masterVolume > 0) || !(s.sfxVolume > 0);
}

// ---------------------------------------------------------------------------
// The station badge ("Sound: Stage TV ✓ heard 2 s ago")
// ---------------------------------------------------------------------------

/** ok = heard recently and able to play; silent = heard, but locked/muted/sounds off; stale = not heard lately; none = never heard. */
export type StationHealth = 'ok' | 'silent' | 'stale' | 'none';

export interface StationReading {
  health: StationHealth;
  /** Whole seconds since the last heartbeat (null = none yet). */
  agoS: number | null;
}

/** How the station sounds from here: its last heartbeat (server ms), its audio flag and the server clock now. */
export function stationHealth(o: { seenAt: number; flag: number | undefined; now: number }): StationReading {
  if (!(o.seenAt > 0)) return { health: 'none', agoS: null };
  const ago = Math.max(0, o.now - o.seenAt);
  const agoS = Math.floor(ago / 1000);
  if (ago > SHOWDOWN_STATION_TIMEOUT_MS) return { health: 'stale', agoS };
  return { health: o.flag === SHOWDOWN_AUDIO_SILENT ? 'silent' : 'ok', agoS };
}

/** "2 s", "just now", "3 min". */
export function agoText(agoS: number): string {
  if (agoS < 1) return 'just now';
  if (agoS < 120) return `${agoS} s`;
  return `${Math.floor(agoS / 60)} min`;
}

export interface StationLabelInput {
  /** The station's playerId ('' = the presenter's console). */
  station: string;
  /** The holder's display name (the presenter's, or the screen's). */
  holderName: string;
  /** This connection presents (the console is "this console"). */
  presenting: boolean;
  /** This connection holds the station. */
  mine: boolean;
}

/** The device that plays the show's sound, in words: "this console", "the presenter’s console", "Stage TV". */
export function stationDevice(o: StationLabelInput): string {
  if (!o.station) return o.presenting ? 'this console' : 'the presenter’s console';
  if (o.mine) return 'this screen';
  return o.holderName.trim() || 'a big screen';
}

export interface StationCopy {
  /** The visible line. */
  text: string;
  /** ✓ or ✗ (never colour alone). */
  mark: '✓' | '✗' | '';
  /** The calm summary for screen readers (no ticking seconds). */
  spoken: string;
}

/** What the console (or a crew device) says about the sound station. */
export function consoleStationCopy(device: string, r: StationReading): StationCopy {
  switch (r.health) {
    case 'ok':
      return {
        mark: '✓',
        text: `Sound: ${device} ✓ heard ${r.agoS! < 1 ? 'just now' : `${agoText(r.agoS!)} ago`}`,
        spoken: `Sound plays on ${device}.`,
      };
    case 'silent':
      return {
        mark: '✗',
        text: `Sound: ${device} ✗ silent (muted, show sounds off, or waiting for a click)`,
        spoken: `Sound station ${device} is silent: muted, show sounds off, or waiting for a click.`,
      };
    case 'stale':
      return {
        mark: '✗',
        text: `Sound: ${device} ✗ not heard for ${agoText(r.agoS ?? 0)}`,
        spoken: `Sound station ${device} is not answering.`,
      };
    case 'none':
      return { mark: '✗', text: `Sound: ${device} ✗ not heard yet`, spoken: `Sound station ${device} has not answered yet.` };
  }
}

/** What a big screen says: it plays the show's sound, or it's silent and where the sound is instead. */
export function screenStationCopy(mine: boolean, device: string, r: StationReading): StationCopy {
  if (mine) {
    return r.health === 'silent'
      ? {
          mark: '✗',
          text: 'This screen plays the show’s sound ✗ but it’s silent here',
          spoken: 'This screen plays the show’s sound, but it is silent: unmute it or click the page.',
        }
      : { mark: '✓', text: 'This screen plays the show’s sound', spoken: 'This screen plays the show’s sound.' };
  }
  return { mark: '', text: `Silent — the sound plays on ${device}`, spoken: `This screen is silent. The sound plays on ${device}.` };
}

/** The console's message when a big-screen station stopped answering and the sound came back. */
export function stationLostMessage(screenName: string): string {
  return `Sound moved back to your console: ${screenName.trim() || 'the big screen'} stopped answering`;
}

// ---------------------------------------------------------------------------
// The jukebox and the theme bed (AUD-04)
// ---------------------------------------------------------------------------

/** Live = a question is up (until the next round's card); break = a title card, a holding card or the results. */
export type MusicSegment = 'live' | 'break' | 'neutral';

export function musicSegment(o: { phase: string; stage: ShowdownStage | null; card: ShowdownCard | null }): MusicSegment {
  if (o.phase === 'RESULTS') return 'break';
  if (o.card !== null && (o.phase === 'PLAYING' || o.phase === 'LOBBY')) return 'break';
  if (o.phase !== 'PLAYING') return 'neutral';
  if (o.stage === 'title') return 'break';
  if (o.stage === 'live' || o.stage === 'steal' || o.stage === 'done') return 'live';
  return 'neutral';
}

/** What the show does to the jukebox as the segment changes: hold it as a question goes live, give it back in a break. */
export function jukeboxStep(prev: MusicSegment | null, next: MusicSegment): 'hold' | 'release' | null {
  if (prev === next) return null;
  if (next === 'live') return 'hold';
  if (next === 'break') return 'release';
  return null;
}

/** The jukebox is playing (or means to) where it can be heard: the bed yields to it. */
export function jukeboxAudible(
  s: Pick<JukeboxState, 'source' | 'wantPlaying' | 'room' | 'jukeboxMuted'>,
  settings: { jukeboxVolume: number },
): boolean {
  return showsPlaying(s) && !s.jukeboxMuted && settings.jukeboxVolume > 0;
}

export interface BedInput {
  mode: ShowdownMode;
  /** The device's theme-music switch. */
  musicPref: boolean;
  /** This device plays show sound (playsShowSound). */
  audible: boolean;
  phase: string;
  stage: ShowdownStage | null;
  card: ShowdownCard | null;
  /** (Event rooms) the jukebox is playing or the show holds it paused: one music source per segment. */
  jukeboxBusy: boolean;
}

/**
 * The theme bed (Presenter Showcase): under the opening, the title cards and the holding cards, and
 * off the moment a question goes up. Never under the jukebox, and never while the show holds the
 * jukebox paused (the break that follows gives the jukebox back).
 */
export function bedWanted(o: BedInput): boolean {
  if (o.mode !== 'showcase' || !o.musicPref || !o.audible || o.jukeboxBusy) return false;
  if (o.phase === 'PLAYING') return o.card !== null || o.stage === 'intro' || o.stage === 'title';
  return (o.phase === 'LOBBY' || o.phase === 'RESULTS') && o.card !== null;
}

// ---------------------------------------------------------------------------
// The router: board events → sounds, gated where they play
// ---------------------------------------------------------------------------

type Timer = unknown;

export interface ShowSoundRouterDeps {
  /** Plays a sound now (playShowSound with the current look). */
  play: (sound: ShowdownSound) => void;
  /** Whether this device plays show sound right now (checked as each sound fires, not when it was scheduled). */
  allowed: () => boolean;
  /** Server epoch ms (serverNow). */
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => Timer;
  clearTimeout: (t: Timer) => void;
}

export interface ShowSoundRouter {
  /** Plays a list of [sound, delay ms]. */
  play(list: Array<[ShowdownSound, number]>): void;
  /** A board event from the server (live only: events are never replayed after a reconnect). */
  event(e: ShowdownEvent, mode: ShowdownMode): void;
  /** Cancels everything still waiting (leaving the room). */
  dispose(): void;
}

export function createShowSoundRouter(deps: ShowSoundRouterDeps): ShowSoundRouter {
  const pending = new Set<Timer>();
  let land: { drawNo: number; timer: Timer } | null = null;

  const fire = (sound: ShowdownSound) => {
    if (deps.allowed()) deps.play(sound);
  };
  const later = (fn: () => void, ms: number): Timer => {
    const t = deps.setTimeout(() => {
      pending.delete(t);
      fn();
    }, ms);
    pending.add(t);
    return t;
  };
  const cancelLand = () => {
    if (!land) return;
    deps.clearTimeout(land.timer);
    pending.delete(land.timer);
    land = null;
  };
  const play = (list: Array<[ShowdownSound, number]>) => {
    for (const [sound, delay] of list) {
      if (delay <= 0) fire(sound);
      else later(() => fire(sound), delay);
    }
  };

  return {
    play,
    event(e, mode) {
      if (e.type === 'pick') {
        // A new draw (or a reroll) replaces a landing still on its way. The land is timed against the
        // server clock, so every screen's landing and this sound meet at landAt.
        cancelLand();
        for (const [sound, delay] of pickSounds(e.landAt, deps.now())) {
          if (sound !== 'land') play([[sound, delay]]);
          else if (delay <= 0) fire('land');
          else {
            const drawNo = e.drawNo;
            const timer = later(() => {
              if (land?.drawNo === drawNo) land = null;
              fire('land');
            }, delay);
            land = { drawNo, timer };
          }
        }
        return;
      }
      // The turn ended before the stage landed (marked done, no answer, rerolled, hidden): no landing.
      if (e.type === 'pickEnd' && land?.drawNo === e.drawNo) cancelLand();
      play(eventSounds(e, mode));
    },
    dispose() {
      for (const t of pending) deps.clearTimeout(t);
      pending.clear();
      land = null;
    },
  };
}
