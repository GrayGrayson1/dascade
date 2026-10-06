/**
 * Web-side half of a theme: the STRUCTURAL skin. The token/material/effects data lives in
 * `@dascade/ui` (packages/ui/src/theme/themes/<id>.ts); this is what makes a theme more than a
 * palette — scoped CSS that reshapes chrome (title bars, bevels, marquees, carpet), a full-viewport
 * environment layer, and decorative extras for the jukebox and arcade floor.
 *
 * Each theme lives in apps/web/src/themes/<id>/:
 *   index.ts    default-exports a ThemeSkin and imports ./skin.css (loaded lazily, cached)
 *   skin.css    every rule scoped under :root[data-theme='<id>'] (never unscoped)
 *   *.tsx       Environment / decor components (lazy with the skin)
 *
 * Presentation only: a skin must never change rules, state, networking, timers or layout metrics
 * that games depend on (foundation tokens: --fs-*, --sp-*, --z-*, --topbar-h, --safe-*).
 */
import type { ComponentType } from 'react';
import type { ClawCostume } from '../arcade/clawArt.ts';
import type { SfxVoices } from '../audio/voices.ts';
import type { SkinCelebration } from './celebration.ts';
import type { WheelSkin } from './wheelSkin.ts';

export interface SkinRenderContext {
  /** Settings mirror: 'high' | 'low' | 'off' (FULL / REDUCED / MINIMAL). */
  fx: 'high' | 'low' | 'off';
  reducedMotion: boolean;
  /** Where the player is, so environments can calm down inside games. */
  place: 'floor' | 'cabinet' | 'entry' | 'lobby' | 'game' | 'tournament' | 'other';
}

export interface JukeboxDecorContext extends SkinRenderContext {
  playing: boolean;
  expanded: boolean;
  /** 0–1 smoothed loudness, updated by the visualizer loop at most ~30 fps (0 when visualizer is off). */
  level: number;
}

export interface ThemeSkin {
  id: string;
  /**
   * Fixed, full-viewport ambient layer painted BEHIND the app (pointer-events: none, aria-hidden).
   * Must honour fx/reducedMotion, pause when the tab is hidden, and stay subtle when place === 'game'.
   */
  Environment?: ComponentType<SkinRenderContext>;
  /** Decorative element(s) inside the expanded jukebox (tape reels, spinning CD, bubble tubes…). */
  JukeboxDecor?: ComponentType<JukeboxDecorContext>;
  /**
   * Decorative extras on the arcade floor (prize counter, velvet ropes, pizza boxes…). Rendered by
   * the floor's `[data-part="floor-decor"]` slot: absolutely positioned over the whole floor, above the
   * room backdrop and below the cabinet carousel, pointer-events none, aria-hidden.
   */
  FloorDecor?: ComponentType<SkinRenderContext>;
  /**
   * 'hide' skips Delta Neon's pixel-art arcade room (canvas + light cones) on the floor so the theme's
   * Environment / FloorDecor shows through (also saves its render loop). Pair it with a transparent
   * `--arcade-floor-bg`. Default 'keep'.
   */
  arcadeRoom?: 'keep' | 'hide';
  /**
   * Optional costume for the claw machine's plushies and the inside of its glass (same four kinds at
   * the same sprite sizes, so saved prize shelves and the physics are untouched). See clawArt.ts.
   */
  claw?: ClawCostume;
  /** Optional confetti colours/sprites for celebrations (Wheel of DAStiny landings, claw wins). */
  celebration?: SkinCelebration;
  /** Optional re-voiced sfx() sounds while this theme is active (see audio/voices.ts). */
  sounds?: SfxVoices;
  /** Optional Wheel of DAStiny decor (inside the stage wheel) and wheel sounds (see wheelSkin.ts). */
  wheel?: WheelSkin;
}

export type ThemePlace = SkinRenderContext['place'];
