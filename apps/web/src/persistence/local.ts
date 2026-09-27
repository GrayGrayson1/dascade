import type { AccountInfo, PersistenceAdapter, Preset, PresetKind, StoredProfile } from './types.ts';

const NS = 'dascade:v1:';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
  } catch {
    // Storage full or disabled (private mode) — persistence silently degrades.
  }
}

function newId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Guest ids are sent with every join (the server accepts ≤ 64 chars); anything else is regenerated. */
const GUEST_ID_RE = /^[\w-]{1,64}$/;

export function getOrCreateGuestId(): string {
  const stored = read<unknown>('guestId');
  if (typeof stored === 'string' && GUEST_ID_RE.test(stored)) return stored;
  // Missing or corrupted (a number, an object, an over-long string…): a fresh identity beats a
  // browser that can never join a room again.
  const id = `g_${newId()}`;
  write('guestId', id);
  return id;
}

function isPreset(value: unknown): value is Preset {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<Preset>;
  return typeof p.id === 'string' && typeof p.name === 'string' && typeof p.updatedAt === 'number' && Number.isFinite(p.updatedAt);
}

/** A kind's saved presets; a corrupted list (not an array, junk entries) degrades to its valid entries. */
function readPresets<T>(kind: PresetKind): Array<Preset<T>> {
  const all = read<unknown>(`presets:${kind}`);
  return Array.isArray(all) ? (all.filter(isPreset) as Array<Preset<T>>) : [];
}

export class LocalPersistence implements PersistenceAdapter {
  readonly kind = 'local' as const;
  private info: AccountInfo = { kind: 'local', id: '', isAnonymous: true };

  async init(): Promise<AccountInfo> {
    this.info = { kind: 'local', id: getOrCreateGuestId(), isAnonymous: true };
    return this.info;
  }
  account(): AccountInfo {
    return this.info;
  }
  async accessToken(): Promise<string | undefined> {
    return undefined;
  }
  async loadProfile(): Promise<StoredProfile | null> {
    return read<StoredProfile>('profile');
  }
  async saveProfile(profile: StoredProfile): Promise<void> {
    write('profile', profile);
  }
  async loadSettings<T>(): Promise<T | null> {
    return read<T>('settings');
  }
  async saveSettings<T>(settings: T): Promise<void> {
    write('settings', settings);
  }
  async listPresets<T>(kind: PresetKind): Promise<Array<Preset<T>>> {
    return readPresets<T>(kind).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async savePreset<T>(kind: PresetKind, name: string, data: T, id?: string): Promise<Preset<T>> {
    const all = readPresets<T>(kind);
    const preset: Preset<T> = { id: id ?? newId(), kind, name: name.slice(0, 60), data, updatedAt: Date.now() };
    const idx = all.findIndex((p) => p.id === preset.id);
    if (idx >= 0) all[idx] = preset;
    else all.push(preset);
    write(`presets:${kind}`, all.slice(-50));
    return preset;
  }
  async deletePreset(kind: PresetKind, id: string): Promise<void> {
    const all = readPresets(kind);
    write(
      `presets:${kind}`,
      all.filter((p) => p.id !== id),
    );
  }
  async loadDoc<T>(key: string): Promise<T | null> {
    return read<T>(`doc:${key}`);
  }
  async saveDoc<T>(key: string, data: T): Promise<void> {
    write(`doc:${key}`, data);
  }
}
