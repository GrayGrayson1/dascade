import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSoundStation, type ShowdownEvent } from '@dascade/shared/games/showdown';

// sounds.ts plays through the real synth (a browser AudioContext); the router only needs the lists.
vi.mock('../../audio/audio.ts', () => ({
  synth: {
    tone: vi.fn(),
    noise: vi.fn(),
    note: (n: number) => 440 * Math.pow(2, (n - 69) / 12),
    hold: vi.fn(),
    context: null,
    sfxBus: null,
  },
}));

const {
  agoText,
  bedWanted,
  consoleStationCopy,
  createShowSoundRouter,
  jukeboxAudible,
  jukeboxStep,
  locallySilenced,
  musicSegment,
  playsShowSound,
  screenStationCopy,
  sendsAudioBeat,
  stationDevice,
  stationHealth,
  stationLostMessage,
} = await import('./showAudio.ts');
type MusicSegment = import('./showAudio.ts').MusicSegment;
type ShowdownSound = import('./sounds.ts').ShowdownSound;
const { FLIP_LAND_MS } = await import('./sounds.ts');
const { INITIAL_JUKEBOX_STATE } = await import('../../audio/jukebox/store.ts');

// ---------------------------------------------------------------------------
// The sound station (AUD-02)
// ---------------------------------------------------------------------------

describe('who plays the show’s sound', () => {
  it('outside event rooms nothing changes: the device’s show-sounds switch decides', () => {
    for (const mine of [true, false]) {
      expect(playsShowSound({ event: false, mine, sounds: true })).toBe(true);
      expect(playsShowSound({ event: false, mine, sounds: false })).toBe(false);
    }
  });

  it('in an event room only the sound station plays, and its own switch still wins', () => {
    expect(playsShowSound({ event: true, mine: true, sounds: true })).toBe(true);
    expect(playsShowSound({ event: true, mine: true, sounds: false })).toBe(false);
    expect(playsShowSound({ event: true, mine: false, sounds: true })).toBe(false);
    expect(playsShowSound({ event: true, mine: false, sounds: false })).toBe(false);
  });

  it('the console and big screens report their audio in event rooms; phones and spectators never do', () => {
    const on = { event: true, connected: true, loaded: true };
    expect(sendsAudioBeat({ ...on, role: 'presenter' })).toBe(true);
    expect(sendsAudioBeat({ ...on, role: 'screen' })).toBe(true);
    expect(sendsAudioBeat({ ...on, role: 'audience' })).toBe(false);
    expect(sendsAudioBeat({ ...on, role: 'spectator' })).toBe(false);
    expect(sendsAudioBeat({ ...on, event: false, role: 'presenter' })).toBe(false);
    expect(sendsAudioBeat({ ...on, connected: false, role: 'presenter' })).toBe(false);
    expect(sendsAudioBeat({ ...on, loaded: false, role: 'screen' })).toBe(false);
  });

  it('the heartbeat’s “muted” covers every local silence: mute, master or SFX volume at zero', () => {
    expect(locallySilenced({ muted: false, masterVolume: 0.8, sfxVolume: 0.7 })).toBe(false);
    expect(locallySilenced({ muted: true, masterVolume: 0.8, sfxVolume: 0.7 })).toBe(true);
    expect(locallySilenced({ muted: false, masterVolume: 0, sfxVolume: 0.7 })).toBe(true);
    expect(locallySilenced({ muted: false, masterVolume: 0.8, sfxVolume: 0 })).toBe(true);
    expect(locallySilenced({ muted: false, masterVolume: Number.NaN, sfxVolume: 0.7 })).toBe(true);
  });
});

describe('the station badge', () => {
  const now = 1_000_000;

  it('reads the heartbeat: heard (ready or silent), not heard lately, never heard', () => {
    expect(stationHealth({ seenAt: 0, flag: undefined, now })).toEqual({ health: 'none', agoS: null });
    expect(stationHealth({ seenAt: now - 2_400, flag: 1, now })).toEqual({ health: 'ok', agoS: 2 });
    expect(stationHealth({ seenAt: now - 2_400, flag: 2, now })).toEqual({ health: 'silent', agoS: 2 });
    // The server's failover window (SHOWDOWN_STATION_TIMEOUT_MS = 5 s).
    expect(stationHealth({ seenAt: now - 5_000, flag: 1, now }).health).toBe('ok');
    expect(stationHealth({ seenAt: now - 5_001, flag: 1, now })).toEqual({ health: 'stale', agoS: 5 });
    expect(stationHealth({ seenAt: now - 8_200, flag: 1, now })).toEqual({ health: 'stale', agoS: 8 });
    // A heartbeat a hair "in the future" (clock estimate) reads as just now.
    expect(stationHealth({ seenAt: now + 300, flag: 1, now })).toEqual({ health: 'ok', agoS: 0 });
  });

  it('names the device: this console, the presenter’s console, this screen, or the screen’s name', () => {
    expect(stationDevice({ station: '', holderName: 'Brian', presenting: true, mine: true })).toBe('this console');
    expect(stationDevice({ station: '', holderName: 'Brian', presenting: false, mine: false })).toBe('the presenter’s console');
    expect(stationDevice({ station: 'tv', holderName: 'Stage TV', presenting: true, mine: false })).toBe('Stage TV');
    expect(stationDevice({ station: 'tv', holderName: 'Stage TV', presenting: false, mine: true })).toBe('this screen');
    expect(stationDevice({ station: 'tv', holderName: '  ', presenting: true, mine: false })).toBe('a big screen');
  });

  it('the console says where the sound is and when it was last heard, with ✓ / ✗ (never colour alone)', () => {
    expect(consoleStationCopy('Stage TV', { health: 'ok', agoS: 2 }).text).toBe('Sound: Stage TV ✓ heard 2 s ago');
    expect(consoleStationCopy('this console', { health: 'ok', agoS: 0 }).text).toBe('Sound: this console ✓ heard just now');
    expect(consoleStationCopy('Stage TV', { health: 'stale', agoS: 8 }).text).toBe('Sound: Stage TV ✗ not heard for 8 s');
    expect(consoleStationCopy('Stage TV', { health: 'stale', agoS: 300 }).text).toBe('Sound: Stage TV ✗ not heard for 5 min');
    expect(consoleStationCopy('Stage TV', { health: 'none', agoS: null }).text).toBe('Sound: Stage TV ✗ not heard yet');
    expect(consoleStationCopy('Stage TV', { health: 'silent', agoS: 1 }).text).toMatch(/^Sound: Stage TV ✗ silent/);
    for (const health of ['ok', 'silent', 'stale', 'none'] as const) {
      const copy = consoleStationCopy('Stage TV', { health, agoS: 3 });
      expect(copy.text).toContain(copy.mark);
      // The spoken summary never ticks (no seconds), so a screen reader isn't told every second.
      expect(copy.spoken).not.toMatch(/\d/);
    }
  });

  it('a big screen says whether it plays the sound, or where it plays instead', () => {
    expect(screenStationCopy(true, 'this screen', { health: 'ok', agoS: 1 }).text).toBe('This screen plays the show’s sound');
    expect(screenStationCopy(true, 'this screen', { health: 'silent', agoS: 1 }).text).toMatch(/✗ but it’s silent here/);
    expect(screenStationCopy(false, 'the presenter’s console', { health: 'ok', agoS: 1 }).text).toBe(
      'Silent — the sound plays on the presenter’s console',
    );
    expect(screenStationCopy(false, 'Stage TV', { health: 'stale', agoS: 9 }).text).toBe('Silent — the sound plays on Stage TV');
  });

  it('the console’s message when a screen stops answering', () => {
    expect(stationLostMessage('Stage TV')).toBe('Sound moved back to your console: Stage TV stopped answering');
    expect(stationLostMessage('')).toBe('Sound moved back to your console: the big screen stopped answering');
  });

  it('“ago” reads naturally', () => {
    expect(agoText(0)).toBe('just now');
    expect(agoText(2)).toBe('2 s');
    expect(agoText(119)).toBe('119 s');
    expect(agoText(125)).toBe('2 min');
  });
});

// ---------------------------------------------------------------------------
// The jukebox and the theme bed (AUD-04)
// ---------------------------------------------------------------------------

describe('the jukebox plays the breaks', () => {
  it('splits the show into live questions and breaks', () => {
    const seg = (
      phase: string,
      stage: Parameters<typeof musicSegment>[0]['stage'],
      card: Parameters<typeof musicSegment>[0]['card'] = null,
    ) => musicSegment({ phase, stage, card });
    expect(seg('LOBBY', null)).toBe('neutral');
    expect(seg('LOBBY', null, 'welcome')).toBe('break');
    expect(seg('COUNTDOWN', null)).toBe('neutral');
    expect(seg('PLAYING', 'intro')).toBe('neutral');
    expect(seg('PLAYING', 'title')).toBe('break');
    expect(seg('PLAYING', 'live')).toBe('live');
    expect(seg('PLAYING', 'steal')).toBe('live');
    // The round wraps up (Reveal remaining, the recap): still the round, until the next card.
    expect(seg('PLAYING', 'done')).toBe('live');
    // A holding card mid-round is a break.
    expect(seg('PLAYING', 'live', 'break')).toBe('break');
    expect(seg('RESULTS', 'done')).toBe('break');
  });

  it('holds the jukebox as a question goes live and gives it back in each break, once per change', () => {
    const walk: MusicSegment[] = ['neutral', 'break', 'neutral', 'break', 'live', 'live', 'break', 'live', 'break', 'neutral'];
    const steps: Array<string | null> = [];
    let prev: MusicSegment | null = null;
    for (const s of walk) {
      steps.push(jukeboxStep(prev, s));
      prev = s;
    }
    expect(steps).toEqual([null, 'release', null, 'release', 'hold', null, 'release', 'hold', 'release', null]);
    // A console that (re)loads mid-question holds at once; one that loads in a break releases (its own hold only).
    expect(jukeboxStep(null, 'live')).toBe('hold');
    expect(jukeboxStep(null, 'break')).toBe('release');
  });

  it('the jukebox counts as playing when it means to and can be heard', () => {
    const base = { ...INITIAL_JUKEBOX_STATE };
    expect(jukeboxAudible({ ...base, wantPlaying: true }, { jukeboxVolume: 0.7 })).toBe(true);
    expect(jukeboxAudible({ ...base, wantPlaying: false }, { jukeboxVolume: 0.7 })).toBe(false);
    expect(jukeboxAudible({ ...base, wantPlaying: true, jukeboxMuted: true }, { jukeboxVolume: 0.7 })).toBe(false);
    expect(jukeboxAudible({ ...base, wantPlaying: true }, { jukeboxVolume: 0 })).toBe(false);
    // Following a paused Room DJ: not playing.
    expect(jukeboxAudible({ ...base, wantPlaying: true, source: 'room', room: null }, { jukeboxVolume: 0.7 })).toBe(false);
  });

  it('the theme bed plays where it always did, but never over the jukebox (or while the show holds it)', () => {
    const on = {
      mode: 'showcase' as const,
      musicPref: true,
      audible: true,
      phase: 'PLAYING',
      stage: 'title' as const,
      card: null,
      jukeboxBusy: false,
    };
    expect(bedWanted(on)).toBe(true);
    expect(bedWanted({ ...on, stage: 'intro' })).toBe(true);
    expect(bedWanted({ ...on, stage: 'live' })).toBe(false);
    expect(bedWanted({ ...on, stage: 'live', card: 'break' })).toBe(true);
    expect(bedWanted({ ...on, phase: 'LOBBY', stage: null, card: 'welcome' })).toBe(true);
    expect(bedWanted({ ...on, phase: 'LOBBY', stage: null })).toBe(false);
    expect(bedWanted({ ...on, phase: 'RESULTS', stage: 'done', card: 'prizes' })).toBe(true);
    expect(bedWanted({ ...on, mode: 'classic' })).toBe(false);
    expect(bedWanted({ ...on, musicPref: false })).toBe(false);
    // Not the station (or show sounds off): no bed.
    expect(bedWanted({ ...on, audible: false })).toBe(false);
    // One music source per segment.
    expect(bedWanted({ ...on, jukeboxBusy: true })).toBe(false);
    expect(bedWanted({ ...on, stage: 'live', card: 'break', jukeboxBusy: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The router (events → sounds, gated where they play)
// ---------------------------------------------------------------------------

describe('the show sound router', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function device(allowed: () => boolean, now = () => 0) {
    const played: ShowdownSound[] = [];
    const router = createShowSoundRouter({
      play: (s) => played.push(s),
      allowed,
      now,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    });
    return { router, played };
  }
  const reveal: ShowdownEvent = {
    type: 'reveal',
    rev: 1,
    slot: 0,
    text: 'x',
    points: 30,
    top: true,
    late: false,
    callers: 0,
    cleared: false,
    special: false,
    sweep: false,
  };
  const pick = (drawNo: number, landAt: number): ShowdownEvent => ({
    type: 'pick',
    rev: 1,
    drawNo,
    winnerId: 'p',
    name: 'Priya',
    poolSize: 8,
    landAt,
    reroll: false,
  });

  it('a device that isn’t the station plays nothing, now or later', () => {
    const d = device(() => false);
    d.router.event(reveal, 'showcase');
    d.router.event({ type: 'clockWarn', rev: 1, round: 0 }, 'showcase');
    d.router.play([['special', 0]]);
    vi.advanceTimersByTime(5000);
    expect(d.played).toEqual([]);
  });

  it('a found answer dings now and clangs as the tile lands', () => {
    const d = device(() => true);
    d.router.event(reveal, 'showcase');
    expect(d.played).toEqual(['correct']);
    vi.advanceTimersByTime(FLIP_LAND_MS);
    expect(d.played).toEqual(['correct', 'clang']);
  });

  it('checks the station as each sound fires: a move mid-sound hands the rest over', () => {
    let mine = true;
    const d = device(() => mine);
    d.router.event(reveal, 'showcase');
    mine = false;
    vi.advanceTimersByTime(1000);
    expect(d.played).toEqual(['correct']);
  });

  it('exactly one device plays each cue, before and after the station moves (console + two big screens)', () => {
    const state = { event: 'dasoween-rehearsal', soundStation: '', presenterId: 'console' };
    const ids = ['console', 'tv1', 'tv2'];
    const devices = ids.map((id) => ({
      id,
      ...device(() => playsShowSound({ event: true, mine: isSoundStation(state, id), sounds: true })),
    }));
    const cue = (e: ShowdownEvent) => {
      for (const d of devices) d.router.event(e, 'showcase');
      vi.advanceTimersByTime(4000);
    };
    const heard = () => devices.map((d) => d.played.length);
    cue({ type: 'miss', rev: 1, round: 0, n: 1 });
    expect(heard()).toEqual([1, 0, 0]);
    state.soundStation = 'tv2';
    cue({ type: 'miss', rev: 2, round: 0, n: 2 });
    expect(heard()).toEqual([1, 0, 1]);
    // tv2 stopped answering: the server falls back to the console.
    state.soundStation = '';
    cue({ type: 'tick', rev: 3, round: 0, n: 3 });
    expect(heard()).toEqual([2, 0, 1]);
  });

  it('the picker spins at once and lands at landAt on the server clock', () => {
    const now = 10_000;
    const d = device(
      () => true,
      () => now,
    );
    d.router.event(pick(1, now + 3200), 'showcase'); // heard 300 ms late
    expect(d.played).toEqual(['spin']);
    vi.advanceTimersByTime(3199);
    expect(d.played).toEqual(['spin']);
    vi.advanceTimersByTime(1);
    expect(d.played).toEqual(['spin', 'land']);
  });

  it('a reroll replaces the landing on its way; the end of that turn before the landing cancels it', () => {
    const now = 50_000;
    const d = device(
      () => true,
      () => now,
    );
    d.router.event(pick(1, now + 3500), 'showcase');
    vi.advanceTimersByTime(1000);
    d.router.event({ type: 'pickEnd', rev: 2, drawNo: 1, playerId: 'p', how: 'reroll' }, 'showcase');
    d.router.event(pick(2, now + 4500), 'showcase');
    vi.advanceTimersByTime(10_000);
    expect(d.played.filter((s) => s === 'land')).toHaveLength(1);
    expect(d.played.filter((s) => s === 'spin')).toHaveLength(2);

    const e = device(
      () => true,
      () => now,
    );
    e.router.event(pick(7, now + 3500), 'showcase');
    // Another draw's end doesn't touch this landing; this draw's does.
    e.router.event({ type: 'pickEnd', rev: 2, drawNo: 6, playerId: 'q', how: 'done' }, 'showcase');
    e.router.event({ type: 'pickEnd', rev: 3, drawNo: 7, playerId: 'p', how: 'noAnswer' }, 'showcase');
    vi.advanceTimersByTime(10_000);
    expect(e.played).toEqual(['spin']);
  });

  it('a pick heard after its landing just lands', () => {
    const d = device(
      () => true,
      () => 99_000,
    );
    d.router.event(pick(3, 98_000), 'showcase');
    expect(d.played).toEqual(['land']);
  });

  it('station moves and the end of a turn are silent; leaving the room cancels what was waiting', () => {
    const d = device(() => true);
    d.router.event({ type: 'station', rev: 1, playerId: '', lost: true }, 'showcase');
    d.router.event({ type: 'pickEnd', rev: 1, drawNo: 1, playerId: 'p', how: 'done' }, 'showcase');
    expect(d.played).toEqual([]);
    d.router.event(reveal, 'showcase');
    d.router.event(pick(4, 3500), 'showcase');
    d.router.dispose();
    vi.advanceTimersByTime(10_000);
    expect(d.played).toEqual(['correct', 'spin']);
  });
});
