/**
 * Client persistence contract. Two implementations:
 *  - LocalPersistence: localStorage only (default, zero config)
 *  - SupabasePersistence: anonymous auth + Postgres (when VITE_SUPABASE_* is set)
 * Game code only ever talks to this interface (see usePersistence()).
 * NEVER persist live match state here — the game server owns that.
 */

export type PresetKind =
  | 'wheel'
  | 'bingo-pattern'
  | 'bingo-setup'
  | 'sketch-words'
  | 'quest-save'
  | (string & {});

export interface Preset<T = unknown> {
  id: string;
  kind: PresetKind;
  name: string;
  data: T;
  updatedAt: number;
}

export interface StoredProfile {
  name: string;
  avatar: string;
}

export interface AccountInfo {
  kind: 'local' | 'supabase';
  /** Stable guest id (local) or Supabase user id. */
  id: string;
  isAnonymous: boolean;
  email?: string;
}

export interface PersistenceAdapter {
  readonly kind: 'local' | 'supabase';
  init(): Promise<AccountInfo>;
  account(): AccountInfo;
  /** Supabase access token for server-side identity (undefined for local). */
  accessToken(): Promise<string | undefined>;

  loadProfile(): Promise<StoredProfile | null>;
  saveProfile(profile: StoredProfile): Promise<void>;

  loadSettings<T>(): Promise<T | null>;
  saveSettings<T>(settings: T): Promise<void>;

  listPresets<T>(kind: PresetKind): Promise<Array<Preset<T>>>;
  savePreset<T>(kind: PresetKind, name: string, data: T, id?: string): Promise<Preset<T>>;
  deletePreset(kind: PresetKind, id: string): Promise<void>;

  /** Small per-user documents (car customization, last room settings, etc). */
  loadDoc<T>(key: string): Promise<T | null>;
  saveDoc<T>(key: string, data: T): Promise<void>;

  /** Upgrade an anonymous account to a permanent one (Supabase only). */
  upgradeAccount?(email: string): Promise<{ ok: boolean; message: string }>;
}
