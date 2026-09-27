import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { activeThemeId, onThemeChange } from './apply.ts';
import { readThemeTokens } from './read.ts';
import type { ThemeTokens } from './types.ts';

/** Re-render when the active theme changes. */
export function useThemeId(): string {
  return useSyncExternalStore(onThemeChange, activeThemeId, activeThemeId);
}

/**
 * Subscribe to theme / visual-effects / reduced-motion changes (html[data-theme|data-fx|data-reduced-motion]).
 * For renderers outside React (Phaser scenes): call it in create() and dispose in shutdown().
 */
export function subscribeThemeTokens(listener: () => void): () => void {
  const offTheme = onThemeChange(() => listener());
  let observer: MutationObserver | null = null;
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    observer = new MutationObserver(() => listener());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-fx', 'data-reduced-motion'] });
  }
  return () => {
    offTheme();
    observer?.disconnect();
  };
}

/**
 * Resolved renderer palette for a Canvas/Phaser view. Pass a ref to an element inside your
 * <GameStage> so the game's accent is used. Updates when the theme or fx/reduced-motion change.
 */
export function useThemeTokens(ref?: RefObject<Element | null>): ThemeTokens {
  const [tokens, setTokens] = useState<ThemeTokens>(() => readThemeTokens(ref?.current ?? null));
  useEffect(() => {
    const read = () => setTokens(readThemeTokens(ref?.current ?? null));
    read(); // the ref is attached now: pick up the scoped accent
    return subscribeThemeTokens(read);
  }, [ref]);
  return tokens;
}
