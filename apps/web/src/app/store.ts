/**
 * Global app state (outside any room): settings, profile, toasts, modals.
 * High-frequency game data never lives here.
 */
import { create } from 'zustand';
import { AVATARS, cleanNickname, type Avatar, type ToastKind } from '@dascade/shared';
import { getOrCreateGuestId, persistence } from '../persistence/index.ts';

export type FxLevel = 'high' | 'low' | 'off';

export interface AppSettings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  musicEnabled: boolean;
  reducedMotion: boolean;
  fx: FxLevel;
}

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
};

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
  settings: DEFAULT_SETTINGS,
  profile: { name: '', avatar: randomAvatar(), guestId: getOrCreateGuestId() },
  profileConfirmed: false,
  toasts: [],
  modal: null,
  helpGameId: null,

  updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    applyDocumentSettings(settings);
    void persistence().saveSettings(settings);
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
    const [storedSettings, storedProfile] = await Promise.all([p.loadSettings<Partial<AppSettings>>(), p.loadProfile()]);
    const settings = { ...DEFAULT_SETTINGS, ...(storedSettings ?? {}) };
    // The OS-level "reduce motion" preference always wins over a stale stored default.
    if (prefersReducedMotion()) settings.reducedMotion = true;
    const profile: Profile = {
      guestId: getOrCreateGuestId(),
      name: storedProfile?.name ?? '',
      avatar: (AVATARS as readonly string[]).includes(storedProfile?.avatar ?? '') ? (storedProfile!.avatar as Avatar) : randomAvatar(),
    };
    set({ settings, profile, profileConfirmed: profile.name.length > 0 });
    applyDocumentSettings(settings);
  },
}));

export function applyDocumentSettings(settings: AppSettings): void {
  const root = document.documentElement;
  root.dataset.reducedMotion = String(settings.reducedMotion);
  root.dataset.fx = settings.fx;
}

/** Imperative toast helper usable outside React. */
export function toast(kind: ToastKind, text: string): void {
  useApp.getState().toast(kind, text);
}
