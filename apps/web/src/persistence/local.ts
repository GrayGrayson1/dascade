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

export function getOrCreateGuestId(): string {
  let id = read<string>('guestId');
  if (!id) {
    id = `g_${newId()}`;
    write('guestId', id);
  }
  return id;
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
    const all = read<Array<Preset<T>>>(`presets:${kind}`) ?? [];
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async savePreset<T>(kind: PresetKind, name: string, data: T, id?: string): Promise<Preset<T>> {
    const all = read<Array<Preset<T>>>(`presets:${kind}`) ?? [];
    const preset: Preset<T> = { id: id ?? newId(), kind, name: name.slice(0, 60), data, updatedAt: Date.now() };
    const idx = all.findIndex((p) => p.id === preset.id);
    if (idx >= 0) all[idx] = preset;
    else all.push(preset);
    write(`presets:${kind}`, all.slice(-50));
    return preset;
  }
  async deletePreset(kind: PresetKind, id: string): Promise<void> {
    const all = read<Array<Preset>>(`presets:${kind}`) ?? [];
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
