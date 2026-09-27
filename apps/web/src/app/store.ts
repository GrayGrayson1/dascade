/**
 * Global app state (outside any room): settings, profile, toasts, modals.
 * High-frequency game data never lives here.
 */
import { create } from 'zustand';
import { AVATARS, cleanNickname, cleanText, type Avatar, type ToastKind } from '@dascade/shared';
import { applyTheme } from '@dascade/ui';
import { getOrCreateGuestId, persistence } from '../persistence/index.ts';
import { DEFAULT_THEME_PREF, SETTINGS_VERSION, migrateSettings, peekStoredTheme, type AppSettings } from './settings.ts';

export type { AppSettings, FxLevel } from './settings.ts';

export interface Profile {
  name: string;
  avatar: Avatar;
  guestId: string;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

export type ModalName = 'settings' | 'help' | 'profile' | 'join' | null;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const DEFAULT_SETTINGS: AppSettings = {
  masterVolume: 0.8,
  sfxVolume: 0.7,
  musicVolume: 0.35,
  muted: false,
  musicEnabled: false,
  reducedMotion: prefersReducedMotion(),
  fx: 'high',
  theme: DEFAULT_THEME_PREF,
};

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>;

/** Stored keys this build doesn't know (kept and written back untouched), known after hydrate(). */
let storedExtras: Record<string, unknown> | null = null;

function extrasOf(stored: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(stored).filter(([key]) => !(SETTINGS_KEYS as string[]).includes(key)));
}

/** Saves settings without ever dropping stored keys this build doesn't know about. */
async function saveSettings(settings: AppSettings): Promise<void> {
  const p = persistence();
  if (!storedExtras) storedExtras = extrasOf(migrateSettings(await p.loadSettings<unknown>().catch(() => null), DEFAULT_SETTINGS));
  await p.saveSettings({
    ...storedExtras,
    ...settings,
    settingsVersion: Math.max(SETTINGS_VERSION, Number(storedExtras.settingsVersion) || 0),
  });
}

function pickSettings(source: AppSettings): AppSettings {
  const out = { ...DEFAULT_SETTINGS };
  for (const key of SETTINGS_KEYS) (out as Record<string, unknown>)[key] = source[key];
  return out;
}

function localStorageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // storage disabled (privacy mode, sandboxed frame)
  }
}

interface AppState {
  settings: AppSettings;
  profile: Profile;
  profileConfirmed: boolean;
  toasts: Toast[];
  modal: ModalName;
  helpGameId: string | null;
  updateSettings: (patch: Partial<AppSettings>) => void;
  updateProfile: (patch: Partial<Omit<Profile, 'guestId'>>) => void;
  /** Shows a toast; returns its id, or null when an identical toast is already on screen. */
  toast: (kind: ToastKind, text: string, ms?: number) => number | null;
  dismissToast: (id: number) => void;
  openModal: (modal: ModalName, helpGameId?: string | null) => void;
  closeModal: () => void;
  hydrate: () => Promise<void>;
}

let toastSeq = 1;

function randomAvatar(): Avatar {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)] as Avatar;
}

export const useApp = create<AppState>((set, get) => ({
  // The theme is read synchronously so a non-default theme is applied before the first paint.
  settings: { ...DEFAULT_SETTINGS, theme: peekStoredTheme(localStorageOrNull()) ?? DEFAULT_THEME_PREF },
  profile: { name: '', avatar: randomAvatar(), guestId: getOrCreateGuestId() },
  profileConfirmed: false,
  toasts: [],
  modal: null,
  helpGameId: null,

  updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    applyDocumentSettings(settings);
    void saveSettings(settings).catch(() => undefined);
  },

  updateProfile(patch) {
    const next = { ...get().profile, ...patch };
    if (patch.name !== undefined) next.name = cleanNickname(patch.name).slice(0, 20);
    set({ profile: next, profileConfirmed: next.name.length > 0 });
    void persistence().saveProfile({ name: next.name, avatar: next.avatar });
  },

  toast(kind, text, ms = kind === 'error' ? 5200 : 3600) {
    // Collapse repeats (e.g. a button mashed into a rate limit) instead of stacking copies.
    if (get().toasts.some((t) => t.kind === kind && t.text === text)) return null;
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), ms);
    return id;
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  openModal(modal, helpGameId = null) {
    set({ modal, helpGameId });
  },

  closeModal() {
    set({ modal: null });
  },

  async hydrate() {
    const p = persistence();
    const [storedSettings, storedProfile] = await Promise.all([p.loadSettings<unknown>(), p.loadProfile()]);
    const migrated = migrateSettings(storedSettings, DEFAULT_SETTINGS);
    const storedVersion = (storedSettings as { settingsVersion?: unknown } | null)?.settingsVersion;
    storedExtras = extrasOf(migrated);
    // Stamp the upgraded shape once (unknown keys are carried along untouched).
    if (storedSettings && storedVersion !== migrated.settingsVersion) void p.saveSettings(migrated).catch(() => undefined);
    const settings = pickSettings(migrated);
    // The OS-level "reduce motion" preference always wins over a stale stored default.
    if (prefersReducedMotion()) settings.reducedMotion = true;
    const profile: Profile = {
      guestId: getOrCreateGuestId(),
      // Stored values are untrusted (edited, or written by an older build): a corrupted name
      // must not reach join options (the server refuses non-strings / > 64 chars).
      name: cleanText(storedProfile?.name, 20),
      avatar: (AVATARS as readonly string[]).includes(storedProfile?.avatar ?? '') ? (storedProfile!.avatar as Avatar) : randomAvatar(),
    };
    set({ settings, profile, profileConfirmed: profile.name.length > 0 });
    applyDocumentSettings(settings);
  },
}));

export function applyDocumentSettings(settings: AppSettings): void {
  const root = document.documentElement;
  // Only write changes: renderers observe these attributes (subscribeThemeTokens).
  if (root.dataset.reducedMotion !== String(settings.reducedMotion)) root.dataset.reducedMotion = String(settings.reducedMotion);
  if (root.dataset.fx !== settings.fx) root.dataset.fx = settings.fx;
  // Unknown / removed theme ids fall back to Delta Neon (the preference itself is kept).
  applyTheme(settings.theme);
}

/** Imperative toast helper usable outside React. */
export function toast(kind: ToastKind, text: string): void {
  useApp.getState().toast(kind, text);
}
