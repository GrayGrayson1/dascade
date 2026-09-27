/**
 * ThemeHost — mounted ONCE at the App root, inside the router and outside <Routes>.
 *
 *   - Renders the active skin's Environment in a fixed, full-viewport layer BEHIND the app
 *     ([data-part="theme-environment"], z-index -1 inside #root's isolated stacking context, so it
 *     paints above the <body> background and below every screen).
 *   - Mirrors the current place onto <html data-place="floor|cabinet|entry|lobby|game|tournament|other">
 *     so skin CSS can react (`:root[data-theme='x'][data-place='game'] …`).
 *   - Renders the theme transition overlay (see ThemeTransition).
 *
 * The environment only shows where a screen lets it: the floor, title screen, cabinet picker and game
 * stages paint their own backdrops through tokens a theme can make translucent (`--arcade-floor-bg`,
 * `--entry-backdrop`, `--picker-backdrop`, `--game-backdrop`). Lobby, tournament, loading and error
 * screens are transparent over the page. See docs/THEMING.md → "Layering".
 */
import { lazy, Suspense, useEffect } from 'react';
import { useThemeId } from '@dascade/ui';
import { useApp } from '../app/store.ts';
import { useThemePlace } from './place.ts';
import { useSkin } from './registry.ts';
import { SkinBoundary } from './SkinBoundary.tsx';
import { ThemeTransition } from './ThemeTransition.tsx';
import { useThemePickerOpen } from './pickerStore.ts';
import type { SkinRenderContext } from './types.ts';
import './host.css';

const ThemePickerSheet = lazy(() => import('./ThemePickerSheet.tsx'));

/** Render context every skin component receives. */
export function useSkinContext(): SkinRenderContext {
  const fx = useApp((s) => s.settings.fx);
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const place = useThemePlace();
  return { fx, reducedMotion, place };
}

export function ThemeHost() {
  const themeId = useThemeId();
  const skin = useSkin(themeId);
  const ctx = useSkinContext();

  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.place !== ctx.place) root.dataset.place = ctx.place;
  }, [ctx.place]);

  const pickerOpen = useThemePickerOpen();
  const Environment = skin?.Environment;
  return (
    <>
      <div className="theme-env" data-part="theme-environment" data-theme-env={skin?.id ?? themeId} aria-hidden>
        {Environment ? (
          <SkinBoundary skinId={skin.id}>
            <Environment fx={ctx.fx} reducedMotion={ctx.reducedMotion} place={ctx.place} />
          </SkinBoundary>
        ) : null}
      </div>
      {pickerOpen ? (
        <Suspense fallback={null}>
          <ThemePickerSheet />
        </Suspense>
      ) : null}
      <ThemeTransition />
    </>
  );
}

/** The arcade floor's decor slot: the active skin's FloorDecor, over the room and under the carousel. */
export function FloorDecorSlot() {
  const themeId = useThemeId();
  const skin = useSkin(themeId);
  const ctx = useSkinContext();
  const FloorDecor = skin?.FloorDecor;
  if (!FloorDecor) return null;
  return (
    <div className="theme-floor-decor" data-part="floor-decor" aria-hidden>
      <SkinBoundary skinId={skin.id}>
        <FloorDecor fx={ctx.fx} reducedMotion={ctx.reducedMotion} place={ctx.place} />
      </SkinBoundary>
    </div>
  );
}

/** Whether the active skin keeps Delta Neon's pixel-art room on the floor. */
export function useArcadeRoomVisible(): boolean {
  const themeId = useThemeId();
  const skin = useSkin(themeId);
  return skin?.arcadeRoom !== 'hide';
}
