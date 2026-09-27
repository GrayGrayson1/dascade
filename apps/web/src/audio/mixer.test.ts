import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MIX_SETTINGS, createMixer } from './mixer.ts';
import {
  GAME_MUSIC_DUCK_LEVEL,
  GAME_MUSIC_SCALE,
  JUKEBOX_HEADROOM,
  SFX_DUCK_LEVEL,
  SFX_HOLD_LEVEL,
  elementFallbackVolume,
  jukeboxDuckBase,
  gameMusicLevel,
  isJukeboxAudible,
  jukeboxLevel,
  masterLevel,
  visualizerEnabled,
  type MixSettings,
} from './mixPolicy.ts';
import { FakeAudioContext, type FakeNode, type FakeParam } from './testFakes.ts';

const S = (patch: Partial<MixSettings> = {}): MixSettings => ({ ...DEFAULT_MIX_SETTINGS, musicEnabled: true, ...patch });
const PLAYING = { playing: true, muted: false };
const IDLE = { playing: false, muted: false };

describe('mix policy', () => {
  it('master honours mute and clamps', () => {
    expect(masterLevel({ muted: true, masterVolume: 1 })).toBe(0);
    expect(masterLevel({ muted: false, masterVolume: 2 })).toBe(1);
    expect(masterLevel({ muted: false, masterVolume: Number.NaN })).toBe(0);
  });

  it('jukebox level has fixed headroom and obeys local mute', () => {
    expect(jukeboxLevel({ jukeboxVolume: 1 }, { muted: false })).toBeCloseTo(JUKEBOX_HEADROOM);
    expect(jukeboxLevel({ jukeboxVolume: 1 }, { muted: true })).toBe(0);
  });

  it('audible only when playing, unmuted, and every volume above zero', () => {
    expect(isJukeboxAudible(S(), PLAYING)).toBe(true);
    expect(isJukeboxAudible(S(), IDLE)).toBe(false);
    expect(isJukeboxAudible(S(), { playing: true, muted: true })).toBe(false);
    expect(isJukeboxAudible(S({ muted: true }), PLAYING)).toBe(false);
    expect(isJukeboxAudible(S({ masterVolume: 0 }), PLAYING)).toBe(false);
    expect(isJukeboxAudible(S({ jukeboxVolume: 0 }), PLAYING)).toBe(false);
  });

  it('ducking policy: mute (default) / duck / keep only while the jukebox is audible', () => {
    const base = DEFAULT_MIX_SETTINGS.musicVolume * GAME_MUSIC_SCALE;
    expect(DEFAULT_MIX_SETTINGS.gameMusicWithJukebox).toBe('mute');
    expect(gameMusicLevel(S(), IDLE)).toBeCloseTo(base);
    expect(gameMusicLevel(S(), PLAYING)).toBe(0);
    expect(gameMusicLevel(S({ gameMusicWithJukebox: 'duck' }), PLAYING)).toBeCloseTo(base * GAME_MUSIC_DUCK_LEVEL);
    expect(gameMusicLevel(S({ gameMusicWithJukebox: 'keep' }), PLAYING)).toBeCloseTo(base);
    // A muted / zero-volume jukebox doesn't count as playing: game music comes back.
    expect(gameMusicLevel(S(), { playing: true, muted: true })).toBeCloseTo(base);
    expect(gameMusicLevel(S({ jukeboxVolume: 0 }), PLAYING)).toBeCloseTo(base);
    // Game music off stays off.
    expect(gameMusicLevel(S({ musicEnabled: false, gameMusicWithJukebox: 'keep' }), IDLE)).toBe(0);
  });

  it('element fallback volume = master × jukebox (so Safari fallback obeys every control)', () => {
    expect(elementFallbackVolume(S({ masterVolume: 0.5, jukeboxVolume: 1 }), { muted: false })).toBeCloseTo(0.5 * JUKEBOX_HEADROOM);
    expect(elementFallbackVolume(S({ muted: true }), { muted: false })).toBe(0);
    expect(elementFallbackVolume(S(), { muted: true })).toBe(0);
  });

  it('visualizer auto = off under reduced motion or fx off', () => {
    expect(visualizerEnabled({ visualizer: 'auto', reducedMotion: false, fx: 'high' })).toBe(true);
    expect(visualizerEnabled({ visualizer: 'auto', reducedMotion: true, fx: 'high' })).toBe(false);
    expect(visualizerEnabled({ visualizer: 'auto', reducedMotion: false, fx: 'off' })).toBe(false);
    expect(visualizerEnabled({ visualizer: 'on', reducedMotion: true, fx: 'off' })).toBe(true);
    expect(visualizerEnabled({ visualizer: 'off', reducedMotion: false, fx: 'high' })).toBe(false);
  });
});

describe('mixer', () => {
  beforeEach(() => {
    FakeAudioContext.instances = [];
  });
  const make = () => createMixer({ AudioContextCtor: () => FakeAudioContext as unknown as typeof AudioContext, random: () => 0.5 });
  const gainOf = (n: unknown) => (n as FakeNode).gain as FakeParam;

  it('creates exactly one context and one graph, however often ensureContext is called', () => {
    const m = make();
    expect(m.context()).toBeNull();
    const a = m.ensureContext();
    const b = m.ensureContext();
    expect(a).toBe(b);
    expect(FakeAudioContext.instances).toHaveLength(1);
    const ctx = FakeAudioContext.instances[0]!;
    expect(ctx.countOf('analyser')).toBe(1);
    expect(ctx.countOf('compressor')).toBe(1);
    expect(m.analyser()).toBe(m.buses()!.analyser);
  });

  it('wires master → compressor → destination and all buses into master', () => {
    const m = make();
    m.ensureContext();
    const b = m.buses()!;
    const master = b.master as unknown as FakeNode;
    expect(master.connections[0]!.kind).toBe('compressor');
    expect(master.connections[0]!.connections[0]!.kind).toBe('destination');
    expect((b.sfx as unknown as FakeNode).connections).toContain(master);
    expect((b.gameMusic as unknown as FakeNode).connections).toContain(master);
    expect((b.analyser as unknown as FakeNode).connections).toContain(b.jukebox as unknown as FakeNode);
    expect((b.jukeboxDuck as unknown as FakeNode).connections).toContain(master);
  });

  it('returns null without WebAudio', () => {
    const m = createMixer({ AudioContextCtor: () => undefined });
    expect(m.ensureContext()).toBeNull();
    expect(m.analyser()).toBeNull();
  });

  it('applies settings with smooth setTargetAtTime ramps (no hard jumps after creation)', () => {
    const m = make();
    m.ensureContext();
    const b = m.buses()!;
    m.setSettings(S({ masterVolume: 0.4 }));
    const calls = gainOf(b.master).calls;
    expect(calls.at(-1)![0]).toBe('target');
    expect(gainOf(b.master).target).toBeCloseTo(0.4);
  });

  it('game music ducks/mutes while the jukebox plays and SFX are untouched', () => {
    const m = make();
    m.ensureContext();
    const b = m.buses()!;
    m.setSettings(S({ sfxVolume: 0.9 }));
    const sfxBefore = gainOf(b.sfx).target;
    m.setJukeboxFlags(PLAYING);
    expect(gainOf(b.gameMusic).target).toBe(0);
    expect(m.gameMusicSilenced()).toBe(true);
    expect(gainOf(b.sfx).target).toBe(sfxBefore);
    m.setSettings(S({ sfxVolume: 0.9, gameMusicWithJukebox: 'duck' }));
    expect(gainOf(b.gameMusic).target).toBeGreaterThan(0);
    m.setJukeboxFlags(IDLE);
    expect(gainOf(b.gameMusic).target).toBeCloseTo(DEFAULT_MIX_SETTINGS.musicVolume * GAME_MUSIC_SCALE);
  });

  it('SFX priority dips the jukebox only while it is audible, then releases to 1', () => {
    const m = make();
    const ctx = m.ensureContext() as unknown as FakeAudioContext;
    const duck = gainOf(m.buses()!.jukeboxDuck);
    m.setSettings(S());
    m.sfxPriority();
    expect(duck.calls.filter((c) => c[0] === 'target')).toHaveLength(0);
    m.setJukeboxFlags(PLAYING);
    m.sfxPriority();
    const targets = duck.calls.filter((c) => c[0] === 'target');
    expect(targets.map((c) => c[1])).toEqual([SFX_DUCK_LEVEL, 1]);
    // Rate-limited within 40 ms.
    m.sfxPriority();
    expect(duck.calls.filter((c) => c[0] === 'target')).toHaveLength(2);
    ctx.currentTime = 1;
    m.sfxPriority();
    expect(duck.calls.filter((c) => c[0] === 'target')).toHaveLength(4);
  });

  it('a sustained SFX (circuit engine hum) holds a gentle dip only while the jukebox is audible', () => {
    const m = make();
    const ctx = m.ensureContext() as unknown as FakeAudioContext;
    const duck = gainOf(m.buses()!.jukeboxDuck);
    const targets = () => duck.calls.filter((c) => c[0] === 'target').map((c) => c[1]);
    m.setSettings(S());
    m.sfxHold('engine', true);
    expect(targets()).toEqual([]); // jukebox silent: nothing to dip
    m.setJukeboxFlags(PLAYING);
    expect(targets()).toEqual([SFX_HOLD_LEVEL]);
    m.sfxHold('engine', true); // idempotent (called every frame)
    m.setSettings(S({ sfxVolume: 0.5 })); // unrelated setting: resting level untouched
    expect(targets()).toEqual([SFX_HOLD_LEVEL]);
    // A transient SFX still cuts through, and releases back to the hold level, not to 1.
    ctx.currentTime = 2;
    m.sfxPriority();
    expect(targets().slice(-2)).toEqual([SFX_HOLD_LEVEL * SFX_DUCK_LEVEL, SFX_HOLD_LEVEL]);
    // Local jukebox mute → no dip needed; unmute → dip again; release the hold → back to 1.
    m.setJukeboxFlags({ playing: true, muted: true });
    expect(targets().at(-1)).toBe(1);
    m.setJukeboxFlags(PLAYING);
    expect(targets().at(-1)).toBe(SFX_HOLD_LEVEL);
    m.sfxHold('engine', false);
    expect(targets().at(-1)).toBe(1);
    expect(m.sfxHolds()).toBe(0);
    expect(jukeboxDuckBase(S(), PLAYING, true)).toBe(SFX_HOLD_LEVEL);
    expect(jukeboxDuckBase(S({ muted: true }), PLAYING, true)).toBe(1);
  });

  it("a hold that starts or ends inside a dip's release window wins over the dip's stale release", () => {
    const m = make();
    const ctx = m.ensureContext() as unknown as FakeAudioContext;
    const duck = gainOf(m.buses()!.jukeboxDuck);
    // The level the stage settles on: the setTargetAtTime event that starts last (ties: inserted last).
    const resting = () => {
      let best: [string, number, number, number?] | null = null;
      for (const c of duck.calls) if (c[0] === 'target' && (!best || c[2] >= best[2])) best = c;
      return best?.[1];
    };
    m.setSettings(S());
    m.setJukeboxFlags(PLAYING);
    ctx.currentTime = 1;
    m.sfxPriority(); // dip now, release to 1 at 1.12
    ctx.currentTime = 1.05;
    m.sfxHold('engine', true);
    expect(resting()).toBe(SFX_HOLD_LEVEL); // not the stale release to 1
    ctx.currentTime = 2;
    m.sfxPriority(); // dip, release to the hold level at 2.12
    ctx.currentTime = 2.05;
    m.sfxHold('engine', false);
    expect(resting()).toBe(1); // not stuck at the hold level (≈ −5 dB)
    // Outside any release window the change starts right away.
    ctx.currentTime = 5;
    m.sfxHold('engine', true);
    expect(duck.calls.at(-1)).toEqual(['target', SFX_HOLD_LEVEL, 5, expect.any(Number)]);
  });

  it('reports context state changes (suspended by the OS, running again)', async () => {
    const m = make();
    const seen: boolean[] = [];
    const off = m.onStateChange(() => seen.push(m.isRunning()));
    const ctx = m.ensureContext() as unknown as FakeAudioContext;
    await m.resume();
    ctx.setState('suspended');
    await m.resume();
    expect(seen).toEqual([true, false, true]);
    off();
    ctx.setState('suspended');
    expect(seen).toHaveLength(3);
  });

  it('routes a media element once (idempotent), only when running, and remembers refusals', async () => {
    const m = make();
    const el = {} as HTMLMediaElement;
    expect(m.routeElement(el)).toBe(false); // no context
    const ctx = m.ensureContext() as unknown as FakeAudioContext;
    expect(m.routeElement(el)).toBe(false); // suspended
    expect(await m.resume()).toBe(true);
    expect(m.routeElement(el)).toBe(true);
    expect(m.routeElement(el)).toBe(true);
    expect(ctx.mediaSources).toBe(1);
    const other = {} as HTMLMediaElement;
    ctx.refuseMediaSource = true;
    expect(m.routeElement(other)).toBe(false);
    ctx.refuseMediaSource = false;
    expect(m.routeElement(other)).toBe(false); // never retried
    expect(m.isRouted(other)).toBe(false);
  });

  it('resume reports failure when the context stays suspended (iOS interrupted)', async () => {
    const m = make();
    const ctx = m.ensureContext() as unknown as FakeAudioContext;
    ctx.resumeResult = 'suspended';
    expect(await m.resume()).toBe(false);
  });
});
