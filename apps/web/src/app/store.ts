/**
 * Global app state (outside any room): settings, profile, toasts, modals.
 * High-frequency game data never lives here.
 */
import { create } from 'zustand';
import { AVATARS, cleanNickname, cleanText, type Avatar, type ToastKind } from '@dascade/shared';
import { applyTheme } from '@dascade/ui';
import { getOrCreateGuestId, persistence } from '../persistence/index.ts';
import { LocalPersistence } from '../persistence/local.ts';
import { createCoalescedWriter } from './coalescedWriter.ts';
import {
  DEFAULT_THEME_PREF,
  MOTION_CHOSEN_KEY,
  SETTINGS_VERSION,
  migrateSettings,
  motionChoice,
  peekStoredSettings,
  reconcileSettings,
  type AppSettings,
} from './settings.ts';

export type { AppSettings, FxLevel, GameMusicWithJukebox, VisualizerPref } from './settings.ts';

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

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION_QUERY).matches;
}

export const DEFAULT_SETTINGS: AppSettings = {
  masterVolume: 0.8,
  sfxVolume: 0.7,
  musicVolume: 0.35,
  muted: false,
  musicEnabled: false,
  jukeboxVolume: 0.7,
  visualizer: 'auto',
  gameMusicWithJukebox: 'mute',
  reducedMotion: prefersReducedMotion(),
  fx: 'high',
  theme: DEFAULT_THEME_PREF,
};

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>;

function extrasOf(stored: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(stored).filter(([key]) => !(SETTINGS_KEYS as string[]).includes(key)));
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

/** Settings as the app uses them from any stored blob (local or remote), plus what the blob carries besides. */
function readSettings(stored: unknown): { settings: AppSettings; extras: Record<string, unknown>; motionChosen: boolean } {
  const migrated = migrateSettings(stored, DEFAULT_SETTINGS);
  const settings = pickSettings(migrated);
  const motion = motionChoice(stored, prefersReducedMotion());
  settings.reducedMotion = motion.reducedMotion;
  return { settings, extras: extrasOf(migrated), motionChosen: motion.chosen };
}

function randomAvatar(): Avatar {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)] as Avatar;
}

/** Stored profile values are untrusted (edited, or written by an older build). */
function readProfile(stored: { name?: unknown; avatar?: unknown } | null | undefined, fallbackAvatar: Avatar): Omit<Profile, 'guestId'> {
  return {
    // A corrupted name must not reach join options (the server refuses non-strings / > 64 chars).
    name: cleanText(stored?.name, 20),
    avatar: typeof stored?.avatar === 'string' && (AVATARS as readonly string[]).includes(stored.avatar) ? (stored.avatar as Avatar) : fallbackAvatar,
  };
}

function peekStoredProfile(): { name?: unknown; avatar?: unknown } | null {
  try {
    const raw = localStorageOrNull()?.getItem('dascade:v1:profile');
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as { name?: unknown; avatar?: unknown }) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Boot: everything stored locally is read synchronously, so the first render already honours mute,
// volumes, fx, reduced motion and the theme, and shows the saved nickname. hydrate() later reconciles
// with the persistence adapter (Supabase: remote copy) without undoing changes made meanwhile.
// ---------------------------------------------------------------------------
const boot = readSettings(peekStoredSettings(localStorageOrNull()));
/** Stored keys this build doesn't know (kept and written back untouched). */
let storedExtras: Record<string, unknown> = boot.extras;
/** The player set "Reduce motion" themselves (else the OS preference decides). */
let motionChosen = boot.motionChosen;
/** Settings keys / profile changed by the player before hydrate() finished: those win over the stored copy. */
const changedBeforeHydrate = new Set<keyof AppSettings>();
let profileChangedBeforeHydrate = false;
let hydrated = false;

// ---------------------------------------------------------------------------
// Saving: the local copy is written at once; a remote (Supabase) copy is debounced — every slider
// step would otherwise be an upsert, and out-of-order completions could store a stale value.
// ---------------------------------------------------------------------------
const localSettingsStore = new LocalPersistence();
const REMOTE_SETTINGS_DELAY_MS = 500;
const remoteSettings = createCoalescedWriter((blob: Record<string, unknown>) => persistence().saveSettings(blob), REMOTE_SETTINGS_DELAY_MS);

function settingsBlob(settings: AppSettings): Record<string, unknown> {
  return {
    ...storedExtras,
    ...settings,
    [MOTION_CHOSEN_KEY]: motionChosen,
    settingsVersion: Math.max(SETTINGS_VERSION, Number(storedExtras.settingsVersion) || 0),
  };
}

/** Saves settings without ever dropping stored keys this build doesn't know about. */
function saveSettings(settings: AppSettings): void {
  const blob = settingsBlob(settings);
  const p = persistence();
  if (p.kind === 'local') {
    void p.saveSettings(blob).catch(() => undefined);
    return;
  }
  void localSettingsStore.saveSettings(blob).catch(() => undefined);
  remoteSettings.schedule(blob);
}

if (typeof window !== 'undefined') {
  // Don't lose the last slider position when the tab closes or is backgrounded (mobile).
  window.addEventListener('pagehide', () => remoteSettings.flush(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') remoteSettings.flush();
  });
}

interface AppState {
  settings: AppSettings;
  profile: Profile;
  profileConfirmed: boolean;
  /**
   * The nickname being typed (null = no pending edit). It commits on blur / Enter, and create / join
   * commit it too (commitNameDraft) — a tap on a button doesn't blur the field on iOS.
   */
  nameDraft: string | null;
  toasts: Toast[];
  modal: ModalName;
  helpGameId: string | null;
  updateSettings: (patch: Partial<AppSettings>) => void;
  updateProfile: (patch: Partial<Omit<Profile, 'guestId'>>) => void;
  setNameDraft: (text: string | null) => void;
  /** Commits a pending nickname edit (when it's a usable name); returns whether the profile has a name. */
  commitNameDraft: () => boolean;
  /** Shows a toast; returns its id, or null when an identical toast is already on screen. */
  toast: (kind: ToastKind, text: string, ms?: number) => number | null;
  dismissToast: (id: number) => void;
  openModal: (modal: ModalName, helpGameId?: string | null) => void;
  closeModal: () => void;
  hydrate: () => Promise<void>;
}

/** A nickname the server will accept as typed (the server falls back to a random name for blanks). */
export function isUsableName(text: string): boolean {
  return cleanText(text, 20).length > 0;
}

/** Create / join may proceed: the typed name when an edit is pending, else the saved one. */
export function selectCanPlay(s: Pick<AppState, 'nameDraft' | 'profileConfirmed'>): boolean {
  return s.nameDraft !== null ? isUsableName(s.nameDraft) : s.profileConfirmed;
}

let toastSeq = 1;

const bootProfile = readProfile(peekStoredProfile(), randomAvatar());

export const useApp = create<AppState>((set, get) => ({
  settings: boot.settings,
  profile: { ...bootProfile, guestId: getOrCreateGuestId() },
  profileConfirmed: bootProfile.name.length > 0,
  nameDraft: null,
  toasts: [],
  modal: null,
  helpGameId: null,

  updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    if (!hydrated) for (const key of Object.keys(patch)) changedBeforeHydrate.add(key as keyof AppSettings);
    if (patch.reducedMotion !== undefined) motionChosen = true;
    set({ settings });
    applyDocumentSettings(settings);
    saveSettings(settings);
  },

  updateProfile(patch) {
    const next = { ...get().profile, ...patch };
    if (patch.name !== undefined) next.name = cleanNickname(patch.name).slice(0, 20);
    if (!hydrated) profileChangedBeforeHydrate = true;
    set({ profile: next, profileConfirmed: next.name.length > 0 });
    void persistence().saveProfile({ name: next.name, avatar: next.avatar });
  },

  setNameDraft(text) {
    set({ nameDraft: text });
  },

  commitNameDraft() {
    const { nameDraft, profile } = get();
    if (nameDraft !== null) {
      if (isUsableName(nameDraft) && cleanText(nameDraft, 20) !== profile.name) get().updateProfile({ name: nameDraft });
      set({ nameDraft: null });
    }
    return get().profileConfirmed;
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
    const loaded = readSettings(storedSettings);
    storedExtras = loaded.extras;
    if (!changedBeforeHydrate.has('reducedMotion')) motionChosen = loaded.motionChosen;
    // Changes the player made while persistence was loading win over the stored copy.
    const settings = reconcileSettings(loaded.settings, get().settings, changedBeforeHydrate);
    const current = get().profile;
    const profile: Profile = profileChangedBeforeHydrate ? current : { ...readProfile(storedProfile, current.avatar), guestId: getOrCreateGuestId() };
    const storedVersion = (storedSettings as { settingsVersion?: unknown } | null)?.settingsVersion;
    // Stamp the upgraded shape once (unknown keys are carried along untouched), and hand changes
    // made before hydration to the adapter that just came up (e.g. the remote copy).
    const needsSave = changedBeforeHydrate.size > 0 || (storedSettings !== null && storedVersion !== loaded.extras.settingsVersion);
    hydrated = true;
    changedBeforeHydrate.clear();
    set({ settings, profile, profileConfirmed: profile.name.length > 0 });
    applyDocumentSettings(settings);
    if (needsSave) saveSettings(settings);
    if (profileChangedBeforeHydrate) void p.saveProfile({ name: profile.name, avatar: profile.avatar }).catch(() => undefined);
  },
}));

// Until the player picks "Reduce motion" themselves, follow the OS preference live.
if (typeof matchMedia === 'function') {
  try {
    matchMedia(REDUCED_MOTION_QUERY).addEventListener('change', (e) => {
      if (motionChosen) return;
      const settings = { ...useApp.getState().settings, reducedMotion: e.matches };
      useApp.setState({ settings });
      applyDocumentSettings(settings);
    });
  } catch {
    /* very old engines: no change events */
  }
}

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
