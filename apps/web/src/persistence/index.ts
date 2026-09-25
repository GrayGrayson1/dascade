import { LocalPersistence } from './local.ts';
import type { AccountInfo, PersistenceAdapter } from './types.ts';

export * from './types.ts';
export { getOrCreateGuestId } from './local.ts';

let adapter: PersistenceAdapter = new LocalPersistence();
let ready: Promise<AccountInfo> | null = null;

/** Picks Supabase when configured, otherwise localStorage. Never throws. */
export function initPersistence(): Promise<AccountInfo> {
  ready ??= (async () => {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (url && key) {
      try {
        const { SupabasePersistence } = await import('./supabase.ts');
        const sb = new SupabasePersistence(url, key);
        const info = await sb.init();
        adapter = sb;
        return info;
      } catch (err) {
        console.warn('[DASCADE] Supabase unavailable, using local storage.', err);
      }
    }
    adapter = new LocalPersistence();
    return adapter.init();
  })();
  return ready;
}

export function persistence(): PersistenceAdapter {
  return adapter;
}
