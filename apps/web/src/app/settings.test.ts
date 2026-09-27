import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_PREF,
  MOTION_CHOSEN_KEY,
  SETTINGS_VERSION,
  migrateSettings,
  motionChoice,
  peekStoredSettings,
  peekStoredTheme,
  reconcileSettings,
  type AppSettings,
} from './settings.ts';

const DEFAULTS: AppSettings = {
  masterVolume: 0.8,
  sfxVolume: 0.7,
  musicVolume: 0.35,
  muted: false,
  musicEnabled: false,
  jukeboxVolume: 0.7,
  visualizer: 'auto',
  gameMusicWithJukebox: 'mute',
  reducedMotion: false,
  fx: 'high',
  theme: DEFAULT_THEME_PREF,
};

const JUKEBOX_DEFAULTS = { jukeboxVolume: 0.7, visualizer: 'auto', gameMusicWithJukebox: 'mute' } as const;

describe('migrateSettings', () => {
  it('upgrades a v1 blob (no version, no theme) and keeps every stored value', () => {
    const v1 = { masterVolume: 0.25, sfxVolume: 0.5, musicVolume: 0.1, muted: true, musicEnabled: true, reducedMotion: true, fx: 'low' };
    expect(migrateSettings(v1, DEFAULTS)).toEqual({ ...v1, ...JUKEBOX_DEFAULTS, theme: 'delta-neon', settingsVersion: SETTINGS_VERSION });
  });

  it('never drops keys it does not know (other features / newer builds own them)', () => {
    const out = migrateSettings({ fx: 'off', futureFlag: { nested: true }, keybinds: ['a'] }, DEFAULTS);
    expect(out.futureFlag).toEqual({ nested: true });
    expect(out.keybinds).toEqual(['a']);
    expect(out.fx).toBe('off');
  });

  it('keeps an unknown-but-valid theme id (the renderer falls back; the preference survives)', () => {
    expect(migrateSettings({ settingsVersion: 2, theme: 'retro-desktop' }, DEFAULTS).theme).toBe('retro-desktop');
  });

  it('replaces only invalid values with defaults', () => {
    const out = migrateSettings(
      {
        settingsVersion: 2,
        masterVolume: 'loud',
        sfxVolume: 7,
        musicVolume: -1,
        muted: 'yes',
        fx: 'ultra',
        theme: '<script>',
        reducedMotion: true,
      },
      DEFAULTS,
    );
    expect(out).toMatchObject({
      masterVolume: 0.8,
      sfxVolume: 1,
      musicVolume: 0,
      muted: false,
      fx: 'high',
      theme: 'delta-neon',
      reducedMotion: true,
    });
  });

  it('is fail-safe for garbage input', () => {
    for (const junk of [null, undefined, 'settings', 42, [], ['fx'], true]) {
      const out = migrateSettings(junk, DEFAULTS);
      expect(out).toEqual({ ...DEFAULTS, settingsVersion: SETTINGS_VERSION });
    }
  });

  it('is idempotent and never downgrades a newer version stamp', () => {
    const once = migrateSettings({ fx: 'low' }, DEFAULTS);
    expect(migrateSettings(once, DEFAULTS)).toEqual(once);
    expect(migrateSettings({ settingsVersion: 9, theme: 'x-theme' }, DEFAULTS).settingsVersion).toBe(9);
  });
});

describe('migrateSettings v3 (jukebox audio)', () => {
  it('is version 3', () => {
    expect(SETTINGS_VERSION).toBe(3);
  });

  it('upgrades a v2 blob: adds the jukebox fields, keeps game music + theme + unknown keys', () => {
    const v2 = { settingsVersion: 2, musicVolume: 0.2, musicEnabled: true, theme: 'shareware-97', extra: 1 };
    const out = migrateSettings(v2, DEFAULTS);
    expect(out).toMatchObject({ ...JUKEBOX_DEFAULTS, musicVolume: 0.2, musicEnabled: true, theme: 'shareware-97', extra: 1, settingsVersion: 3 });
  });

  it('keeps valid stored jukebox values', () => {
    const out = migrateSettings({ settingsVersion: 3, jukeboxVolume: 0.25, visualizer: 'off', gameMusicWithJukebox: 'duck' }, DEFAULTS);
    expect(out).toMatchObject({ jukeboxVolume: 0.25, visualizer: 'off', gameMusicWithJukebox: 'duck' });
    expect(migrateSettings({ visualizer: 'on', gameMusicWithJukebox: 'keep' }, DEFAULTS)).toMatchObject({ visualizer: 'on', gameMusicWithJukebox: 'keep' });
  });

  it('replaces invalid jukebox values with defaults (and clamps volume)', () => {
    expect(migrateSettings({ settingsVersion: 3, jukeboxVolume: 'max', visualizer: 'strobe', gameMusicWithJukebox: 42 }, DEFAULTS)).toMatchObject(
      JUKEBOX_DEFAULTS,
    );
    expect(migrateSettings({ jukeboxVolume: 3 }, DEFAULTS).jukeboxVolume).toBe(1);
    expect(migrateSettings({ jukeboxVolume: -2 }, DEFAULTS).jukeboxVolume).toBe(0);
    expect(migrateSettings({ jukeboxVolume: Number.NaN }, DEFAULTS).jukeboxVolume).toBe(0.7);
  });

  it('is idempotent across v1 → v3', () => {
    const once = migrateSettings({ muted: true }, DEFAULTS);
    expect(migrateSettings(once, DEFAULTS)).toEqual(once);
  });
});

describe('peekStoredTheme', () => {
  const storage = (value: string | null) => ({ getItem: () => value });
  it('reads a stored theme id synchronously', () => {
    expect(peekStoredTheme(storage(JSON.stringify({ theme: 'delta-neon', fx: 'low' })))).toBe('delta-neon');
  });
  it('returns null for missing, corrupt or unsafe values and never throws', () => {
    expect(peekStoredTheme(storage(null))).toBeNull();
    expect(peekStoredTheme(storage('{nope'))).toBeNull();
    expect(peekStoredTheme(storage(JSON.stringify({ theme: 'Bad Theme;' })))).toBeNull();
    expect(peekStoredTheme(null)).toBeNull();
    expect(
      peekStoredTheme({
        getItem: () => {
          throw new Error('SecurityError');
        },
      }),
    ).toBeNull();
  });
});

describe('peekStoredSettings', () => {
  const storage = (value: string | null) => ({ getItem: () => value });
  it('reads the whole local blob synchronously (mute, volumes, fx… apply to the first render)', () => {
    const stored = { muted: true, masterVolume: 0.2, fx: 'off', reducedMotion: true, theme: 'delta-neon', settingsVersion: 3 };
    const out = migrateSettings(peekStoredSettings(storage(JSON.stringify(stored))), DEFAULTS);
    expect(out).toMatchObject({ muted: true, masterVolume: 0.2, fx: 'off', reducedMotion: true });
  });
  it('is null for missing / corrupt storage and never throws', () => {
    expect(peekStoredSettings(storage(null))).toBeNull();
    expect(peekStoredSettings(storage('{nope'))).toBeNull();
    expect(peekStoredSettings(null)).toBeNull();
    expect(
      peekStoredSettings({
        getItem: () => {
          throw new Error('SecurityError');
        },
      }),
    ).toBeNull();
  });
});

describe('motionChoice', () => {
  it('follows the OS preference until the player chooses', () => {
    expect(motionChoice(null, true)).toEqual({ chosen: false, reducedMotion: true });
    expect(motionChoice(null, false)).toEqual({ chosen: false, reducedMotion: false });
    // Saved by this build without a choice: the stored value is only the OS default of that moment.
    expect(motionChoice({ reducedMotion: true, [MOTION_CHOSEN_KEY]: false }, false)).toEqual({ chosen: false, reducedMotion: false });
  });

  it('keeps the player’s own choice, even against the OS preference (turning animations back on persists)', () => {
    expect(motionChoice({ reducedMotion: false, [MOTION_CHOSEN_KEY]: true }, true)).toEqual({ chosen: true, reducedMotion: false });
    expect(motionChoice({ reducedMotion: true, [MOTION_CHOSEN_KEY]: true }, false)).toEqual({ chosen: true, reducedMotion: true });
  });

  it('reads blobs from before the flag the way the old build behaved', () => {
    // OS asks for reduced motion: it wins, as before.
    expect(motionChoice({ reducedMotion: false }, true)).toEqual({ chosen: false, reducedMotion: true });
    // "Reduce" stored on a device whose OS doesn't ask for it: the player turned it on.
    expect(motionChoice({ reducedMotion: true }, false)).toEqual({ chosen: true, reducedMotion: true });
    expect(motionChoice({ reducedMotion: false }, false)).toEqual({ chosen: false, reducedMotion: false });
  });

  it('is fail-safe for junk', () => {
    for (const junk of [undefined, 'x', 3, [], { reducedMotion: 'yes', [MOTION_CHOSEN_KEY]: true }]) {
      expect(motionChoice(junk, true)).toEqual({ chosen: false, reducedMotion: true });
    }
  });
});

describe('reconcileSettings', () => {
  it('takes loaded values except the keys changed on screen since boot', () => {
    const current: AppSettings = { ...DEFAULTS, muted: true, masterVolume: 0.1, fx: 'off' };
    const loaded: AppSettings = { ...DEFAULTS, muted: false, masterVolume: 0.9, fx: 'low', theme: 'shareware-97' };
    const out = reconcileSettings(loaded, current, new Set<keyof AppSettings>(['muted', 'masterVolume']));
    expect(out).toEqual({ ...loaded, muted: true, masterVolume: 0.1 });
    expect(reconcileSettings(loaded, current, new Set())).toEqual(loaded);
  });
});
