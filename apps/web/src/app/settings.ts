/**
 * App settings shape + versioned, fail-safe migration of whatever is stored (localStorage or the
 * Supabase profile). Pure: no DOM, no store, so it's unit-tested directly.
 *
 * Rules:
 *  - never throw, whatever the stored value is (null, a string, an array, corrupted JSON…);
 *  - never drop keys we don't know (a newer build — or another feature — may own them);
 *  - replace only invalid known values with their defaults;
 *  - stamp `settingsVersion` so later builds can migrate again.
 */

export type FxLevel = 'high' | 'low' | 'off';
export type VisualizerPref = 'auto' | 'on' | 'off';
export type GameMusicWithJukebox = 'duck' | 'mute' | 'keep';

/** How Halloween Night got switched on: the October invite (reverts after Oct 31) or any other way. */
export type HalloweenVia = 'invite' | 'picker';

/** The October invite's bookkeeping (see themes/seasonal.ts). */
export interface HalloweenPrefs {
  /** Season (calendar year) the record refers to: when the invite was declined or accepted. */
  year?: number;
  /** The invite was declined (or Halloween exited) that season: don't invite again until next year. */
  dismissed?: boolean;
  /** While Halloween Night is on: how it was switched on, and the theme to go back to. */
  via?: HalloweenVia;
  prev?: string;
}

/** Seasonal-theme state, per season. Unknown seasons (a newer build's) are kept as they are. */
export interface SeasonalPrefs {
  halloween?: HalloweenPrefs;
  [season: string]: unknown;
}

export interface AppSettings {
  masterVolume: number;
  sfxVolume: number;
  /** "Game music" (the procedural per-game soundtrack) volume. */
  musicVolume: number;
  muted: boolean;
  /** "Game music" on/off. */
  musicEnabled: boolean;
  /** Jukebox (MP3 player) volume. */
  jukeboxVolume: number;
  /** Jukebox visualizer: 'auto' = off under reduced motion or effects off. */
  visualizer: VisualizerPref;
  /** What the game music does while the jukebox is audibly playing. */
  gameMusicWithJukebox: GameMusicWithJukebox;
  reducedMotion: boolean;
  fx: FxLevel;
  /** Theme preference (a ThemeDefinition id). Unknown ids render as Delta Neon but are kept. */
  theme: string;
  /**
   * Seasonal invite bookkeeping (October's Halloween Night invite). Optional and validated on read;
   * absent = nothing recorded. Added without a version bump: there is nothing to migrate.
   */
  seasonal?: SeasonalPrefs;
}

/**
 * v1 = the original shape (no version stamp); v2 adds `theme`; v3 adds the jukebox audio fields. The
 * optional `seasonal` field came later without a bump (absent = nothing recorded; nothing to migrate).
 */
export const SETTINGS_VERSION = 3;
export const DEFAULT_THEME_PREF = 'delta-neon';

export type StoredSettings = AppSettings & { settingsVersion: number } & Record<string, unknown>;

const THEME_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

const unit = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function parseHalloween(v: unknown): HalloweenPrefs | undefined {
  if (!isRecord(v)) return undefined;
  const out: HalloweenPrefs = {};
  if (typeof v.year === 'number' && Number.isInteger(v.year) && v.year >= 2000 && v.year <= 9999) out.year = v.year;
  if (typeof v.dismissed === 'boolean') out.dismissed = v.dismissed;
  if (v.via === 'invite' || v.via === 'picker') out.via = v.via;
  if (typeof v.prev === 'string' && THEME_ID_RE.test(v.prev)) out.prev = v.prev;
  return out;
}

/**
 * Validates stored seasonal prefs field by field (a bad field is dropped, the rest kept). Seasons this
 * build doesn't know are kept untouched; anything that isn't an object reads as "nothing recorded".
 */
export function parseSeasonal(v: unknown): SeasonalPrefs | undefined {
  if (!isRecord(v)) return undefined;
  const out: SeasonalPrefs = { ...v };
  const halloween = parseHalloween(v.halloween);
  if (halloween) out.halloween = halloween;
  else delete out.halloween;
  return out;
}

/** Upgrades any stored settings object to the current version. */
export function migrateSettings(stored: unknown, defaults: AppSettings): StoredSettings {
  const raw: Record<string, unknown> =
    stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...(stored as Record<string, unknown>) } : {};
  const version = typeof raw.settingsVersion === 'number' && Number.isFinite(raw.settingsVersion) ? raw.settingsVersion : 1;

  // v1 → v2: introduce the theme preference.
  if (version < 2 && typeof raw.theme !== 'string') raw.theme = defaults.theme;

  return {
    ...raw, // unknown keys survive untouched
    masterVolume: unit(raw.masterVolume, defaults.masterVolume),
    sfxVolume: unit(raw.sfxVolume, defaults.sfxVolume),
    musicVolume: unit(raw.musicVolume, defaults.musicVolume),
    muted: bool(raw.muted, defaults.muted),
    musicEnabled: bool(raw.musicEnabled, defaults.musicEnabled),
    reducedMotion: bool(raw.reducedMotion, defaults.reducedMotion),
    fx: raw.fx === 'high' || raw.fx === 'low' || raw.fx === 'off' ? raw.fx : defaults.fx,
    // v2 → v3: jukebox fields (absent → defaults; invalid → defaults).
    jukeboxVolume: unit(raw.jukeboxVolume, defaults.jukeboxVolume),
    visualizer: raw.visualizer === 'auto' || raw.visualizer === 'on' || raw.visualizer === 'off' ? raw.visualizer : defaults.visualizer,
    gameMusicWithJukebox:
      raw.gameMusicWithJukebox === 'duck' || raw.gameMusicWithJukebox === 'mute' || raw.gameMusicWithJukebox === 'keep'
        ? raw.gameMusicWithJukebox
        : defaults.gameMusicWithJukebox,
    theme: typeof raw.theme === 'string' && THEME_ID_RE.test(raw.theme) ? raw.theme : defaults.theme,
    // Seasonal invite bookkeeping (optional, no version bump: absent = nothing recorded).
    seasonal: parseSeasonal(raw.seasonal),
    // A settings blob written by a newer build keeps its (higher) version.
    settingsVersion: Math.max(version, SETTINGS_VERSION),
  };
}

/**
 * Synchronous read of the locally stored theme preference, for the boot script (applied before
 * React renders, so a future non-default theme doesn't flash Delta Neon first).
 */
export function peekStoredTheme(storage: Pick<Storage, 'getItem'> | null | undefined, key = 'dascade:v1:settings'): string | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { theme?: unknown } | null;
    return typeof parsed?.theme === 'string' && THEME_ID_RE.test(parsed.theme) ? parsed.theme : null;
  } catch {
    return null;
  }
}

/** localStorage key of the settings blob (LocalPersistence namespaces keys with `dascade:v1:`). */
export const LOCAL_SETTINGS_KEY = 'dascade:v1:settings';

/**
 * Synchronous read of the whole locally stored settings blob (raw — run it through
 * migrateSettings), so the first render already honours mute, volumes, fx and reduced motion
 * instead of waiting for persistence to initialise (with Supabase that's seconds).
 */
export function peekStoredSettings(storage: Pick<Storage, 'getItem'> | null | undefined, key = LOCAL_SETTINGS_KEY): unknown {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/**
 * Stored alongside the settings: true once the player set "Reduce motion" themselves. Until then
 * the OS preference decides (and follows OS changes); afterwards their choice sticks either way.
 */
export const MOTION_CHOSEN_KEY = 'reducedMotionChosen';

/**
 * Effective reduced-motion setting for a stored blob. Blobs written before the flag existed are read
 * as the old build behaved: "reduce" when the OS asks for it, and an in-app "reduce" (stored true on a
 * device whose OS doesn't ask) counts as the player's own choice.
 */
export function motionChoice(stored: unknown, osPrefersReduced: boolean): { chosen: boolean; reducedMotion: boolean } {
  const raw = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const value = typeof raw.reducedMotion === 'boolean' ? raw.reducedMotion : null;
  const flag = raw[MOTION_CHOSEN_KEY];
  const chosen = value !== null && (typeof flag === 'boolean' ? flag : value && !osPrefersReduced);
  return { chosen, reducedMotion: chosen && value !== null ? value : osPrefersReduced };
}

/**
 * Merge freshly loaded (e.g. remote) settings into the ones on screen: keys the player changed since
 * boot keep their on-screen value, everything else takes the loaded one.
 */
export function reconcileSettings(loaded: AppSettings, current: AppSettings, changedSinceBoot: ReadonlySet<keyof AppSettings>): AppSettings {
  const out = { ...loaded };
  for (const key of changedSinceBoot) (out as Record<string, unknown>)[key] = current[key];
  return out;
}
