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

export interface AppSettings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  musicEnabled: boolean;
  reducedMotion: boolean;
  fx: FxLevel;
  /** Theme preference (a ThemeDefinition id). Unknown ids render as Delta Neon but are kept. */
  theme: string;
}

/** v1 = the original shape (no version stamp); v2 adds `theme`. */
export const SETTINGS_VERSION = 2;
export const DEFAULT_THEME_PREF = 'delta-neon';

export type StoredSettings = AppSettings & { settingsVersion: number } & Record<string, unknown>;

const THEME_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

const unit = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

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
    theme: typeof raw.theme === 'string' && THEME_ID_RE.test(raw.theme) ? raw.theme : defaults.theme,
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
