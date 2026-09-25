/**
 * Supabase-backed persistence (optional). Loaded only when VITE_SUPABASE_URL and
 * VITE_SUPABASE_PUBLISHABLE_KEY are set. Uses anonymous sign-in; users may upgrade
 * to a permanent account by attaching an email (magic link). All tables are
 * protected by row-level security — see supabase/migrations.
 * Falls back to localStorage for anything that fails so the arcade never breaks.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { LocalPersistence } from './local.ts';
import type { AccountInfo, PersistenceAdapter, Preset, PresetKind, StoredProfile } from './types.ts';

export class SupabasePersistence implements PersistenceAdapter {
  readonly kind = 'supabase' as const;
  private sb!: SupabaseClient;
  private info: AccountInfo = { kind: 'supabase', id: '', isAnonymous: true };
  private readonly local = new LocalPersistence();

  constructor(
    private readonly url: string,
    private readonly publishableKey: string,
  ) {}

  async init(): Promise<AccountInfo> {
    await this.local.init();
    const { createClient } = await import('@supabase/supabase-js');
    this.sb = createClient(this.url, this.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'dascade-auth' },
    });
    let { data } = await this.sb.auth.getSession();
    if (!data.session) {
      const { error } = await this.sb.auth.signInAnonymously();
      if (error) throw error;
      ({ data } = await this.sb.auth.getSession());
    }
    const user = data.session?.user;
    if (!user) throw new Error('Supabase sign-in failed');
    this.info = { kind: 'supabase', id: user.id, isAnonymous: Boolean(user.is_anonymous), email: user.email ?? undefined };
    return this.info;
  }

  account(): AccountInfo {
    return this.info;
  }

  async accessToken(): Promise<string | undefined> {
    const { data } = await this.sb.auth.getSession();
    return data.session?.access_token;
  }

  async loadProfile(): Promise<StoredProfile | null> {
    const { data, error } = await this.sb.from('profiles').select('display_name, avatar').eq('id', this.info.id).maybeSingle();
    if (error || !data) return this.local.loadProfile();
    return { name: data.display_name as string, avatar: data.avatar as string };
  }

  async saveProfile(profile: StoredProfile): Promise<void> {
    await this.local.saveProfile(profile);
    await this.sb.from('profiles').upsert({ id: this.info.id, display_name: profile.name, avatar: profile.avatar, updated_at: new Date().toISOString() });
  }

  async loadSettings<T>(): Promise<T | null> {
    const { data, error } = await this.sb.from('profiles').select('preferences').eq('id', this.info.id).maybeSingle();
    if (error || !data?.preferences) return this.local.loadSettings<T>();
    return data.preferences as T;
  }

  async saveSettings<T>(settings: T): Promise<void> {
    await this.local.saveSettings(settings);
    await this.sb.from('profiles').upsert({ id: this.info.id, preferences: settings, updated_at: new Date().toISOString() });
  }

  async listPresets<T>(kind: PresetKind): Promise<Array<Preset<T>>> {
    const { data, error } = await this.sb
      .from('presets')
      .select('id, kind, name, data, updated_at')
      .eq('kind', kind)
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error || !data) return this.local.listPresets<T>(kind);
    return data.map((row) => ({
      id: row.id as string,
      kind: row.kind as PresetKind,
      name: row.name as string,
      data: row.data as T,
      updatedAt: Date.parse(row.updated_at as string),
    }));
  }

  async savePreset<T>(kind: PresetKind, name: string, data: T, id?: string): Promise<Preset<T>> {
    const row = { ...(id ? { id } : {}), owner: this.info.id, kind, name: name.slice(0, 60), data, updated_at: new Date().toISOString() };
    const { data: saved, error } = await this.sb.from('presets').upsert(row).select('id, updated_at').single();
    if (error || !saved) return this.local.savePreset(kind, name, data, id);
    return { id: saved.id as string, kind, name, data, updatedAt: Date.parse(saved.updated_at as string) };
  }

  async deletePreset(kind: PresetKind, id: string): Promise<void> {
    await this.local.deletePreset(kind, id);
    await this.sb.from('presets').delete().eq('id', id);
  }

  async loadDoc<T>(key: string): Promise<T | null> {
    const { data, error } = await this.sb.from('user_docs').select('data').eq('owner', this.info.id).eq('key', key).maybeSingle();
    if (error || !data) return this.local.loadDoc<T>(key);
    return data.data as T;
  }

  async saveDoc<T>(key: string, data: T): Promise<void> {
    await this.local.saveDoc(key, data);
    await this.sb.from('user_docs').upsert({ owner: this.info.id, key, data, updated_at: new Date().toISOString() });
  }

  async upgradeAccount(email: string): Promise<{ ok: boolean; message: string }> {
    const { error } = await this.sb.auth.updateUser({ email });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: 'Check your inbox to confirm your email — your saves will stay with you.' };
  }
}
