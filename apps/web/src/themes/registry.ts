/**
 * Lazy skin registry. Token data for all eleven themes is tiny and eager (`@dascade/ui`); the
 * structural skins (CSS + environment components) load on demand and are cached, so the
 * default bundle only carries the active theme's skin.
 *
 * A skin's CSS stays in the document once loaded (Vite injects it with the chunk). That's safe —
 * every rule is scoped under `:root[data-theme='<id>']`, so an inactive skin is inert — and it means
 * switching back and forth never re-downloads or re-injects anything: at most one stylesheet per
 * theme, ever.
 */
import { useSyncExternalStore } from 'react';
import { DEFAULT_THEME_ID, getTheme } from '@dascade/ui';
import type { ThemeSkin } from './types.ts';

type SkinModule = { default: ThemeSkin };
type Loader = () => Promise<SkinModule>;

const BUILT_IN_LOADERS: Record<string, Loader> = {
  'delta-neon': () => import('./delta-neon/index.ts'),
  'shareware-97': () => import('./shareware-97/index.ts'),
  'corporate-98': () => import('./corporate-98/index.ts'),
  'cyber-cafe-01': () => import('./cyber-cafe-01/index.ts'),
  'mall-arcade-92': () => import('./mall-arcade-92/index.ts'),
  'vhs-after-dark': () => import('./vhs-after-dark/index.ts'),
  'space-casino-2088': () => import('./space-casino-2088/index.ts'),
  'lan-party': () => import('./lan-party/index.ts'),
  'saturday-morning': () => import('./saturday-morning/index.ts'),
  executive: () => import('./executive/index.ts'),
  'neon-noir': () => import('./neon-noir/index.ts'),
};

const LOADERS: Record<string, Loader> = { ...BUILT_IN_LOADERS };
const cache = new Map<string, ThemeSkin>();
const pending = new Map<string, Promise<ThemeSkin>>();
/** When a skin chunk last failed (ms): renders don't hammer a failing network; explicit loads always retry. */
const failedAt = new Map<string, number>();
/** Minimum gap between render-driven retries of a failed skin (useSkin). */
export const SKIN_RETRY_MS = 5000;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version++;
  for (const l of [...listeners]) l();
}

export function skinIds(): string[] {
  return Object.keys(LOADERS);
}

/** The skin key a theme id resolves to (unknown ids → Delta Neon, like getTheme()). */
export function skinKey(id: string | null | undefined): string {
  const themeId = getTheme(id).id;
  return LOADERS[themeId] ? themeId : DEFAULT_THEME_ID;
}

/** Already-loaded skin (sync), or null. */
export function loadedSkin(id: string | null | undefined): ThemeSkin | null {
  return cache.get(skinKey(id)) ?? null;
}

/**
 * Loads (once) the skin for a theme id; unknown ids resolve to Delta Neon's skin. Never rejects.
 * A failed chunk (offline, a deploy mid-session) resolves to a token-only skin for this call but is
 * NOT cached: one network blip mustn't leave the theme unskinned until a reload, so the next load
 * (the next switch, or a later render via useSkin) tries again.
 */
export function loadThemeSkin(id: string | null | undefined): Promise<ThemeSkin> {
  const key = skinKey(id);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(key);
  if (!p) {
    const loader = LOADERS[key] ?? LOADERS[DEFAULT_THEME_ID]!;
    p = Promise.resolve()
      .then(loader)
      .then((m) => (m && typeof m.default === 'object' && m.default ? m.default : ({ id: key } satisfies ThemeSkin)))
      .then(
        (skin) => {
          cache.set(key, skin);
          failedAt.delete(key);
          pending.delete(key);
          notify();
          return skin;
        },
        () => {
          // Token-only for now (never breaks the app); no notify — nothing new to render.
          failedAt.set(key, nowMs());
          pending.delete(key);
          return { id: key } satisfies ThemeSkin;
        },
      );
    pending.set(key, p);
  }
  return p;
}

/**
 * Resolves with the skin, or after `ms` with whatever is cached (null) — used by the boot preload so a
 * slow network never holds the first paint for more than `ms`. Never rejects.
 */
export function loadThemeSkinWithin(id: string | null | undefined, ms: number): Promise<ThemeSkin | null> {
  const hit = loadedSkin(id);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(loadedSkin(id)), ms);
    void loadThemeSkin(id).then((skin) => {
      clearTimeout(timer);
      resolve(skin);
    });
  });
}

/** Subscribe to "a skin finished loading". */
export function onSkinLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React: the loaded skin for `id` (kicks off loading; null until it arrives). */
export function useSkin(id: string): ThemeSkin | null {
  useSyncExternalStore(
    onSkinLoaded,
    () => version,
    () => version,
  );
  const skin = loadedSkin(id);
  if (!skin) {
    const failed = failedAt.get(skinKey(id));
    if (failed === undefined || nowMs() - failed >= SKIN_RETRY_MS) void loadThemeSkin(id);
  }
  return skin;
}

/** Test/QA hook: register a loader for a runtime-registered theme (e.g. e2e's throwaway theme). */
export function registerSkinLoader(id: string, loader: Loader): void {
  if (BUILT_IN_LOADERS[id]) throw new Error(`Skin "${id}" is built in`);
  LOADERS[id] = loader;
  cache.delete(id);
  failedAt.delete(id);
}

/** Test-only: forget every loaded skin. */
export function __resetSkinCacheForTests(): void {
  cache.clear();
  pending.clear();
  failedAt.clear();
  for (const id of Object.keys(LOADERS)) if (!BUILT_IN_LOADERS[id]) delete LOADERS[id];
  notify();
}
