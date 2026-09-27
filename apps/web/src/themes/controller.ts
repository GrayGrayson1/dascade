/**
 * The app's theme switcher instance. UI calls `switchTheme(id)`; everything else (settings
 * persistence, applyTheme, Supabase profile sync) happens through `updateSettings({ theme })`.
 */
import { useSyncExternalStore } from 'react';
import { useApp } from '../app/store.ts';
import { loadThemeSkin } from './registry.ts';
import { createThemeSwitcher, type TransitionState } from './switcher.ts';

const nextFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame !== 'function') return void setTimeout(resolve, 16);
    requestAnimationFrame(() => resolve());
  });

export const themeSwitcher = createThemeSwitcher({
  current: () => useApp.getState().settings.theme,
  apply: (id) => useApp.getState().updateSettings({ theme: id }),
  load: (id) => loadThemeSkin(id),
  calm: () => {
    const s = useApp.getState().settings;
    return s.reducedMotion || s.fx === 'off' || (typeof document !== 'undefined' && document.hidden);
  },
  // Two frames: the first lets React/CSS apply the new theme, the second guarantees it painted.
  settle: async () => {
    await nextFrame();
    await nextFrame();
  },
});

/** Switch theme with the premium transition. Never touches routes, the room or music. */
export function switchTheme(id: string, opts?: { animate?: boolean }): Promise<void> {
  return themeSwitcher.switchTo(id, opts);
}

export function useThemeTransition(): TransitionState {
  return useSyncExternalStore(themeSwitcher.subscribe, themeSwitcher.getState, themeSwitcher.getState);
}
