/**
 * Optional Wheel of DAStiny hooks a skin may bring (ThemeSkin.wheel): a decorative layer inside the
 * wheel (`Decor`) and re-voiced wheel sounds (`voices`). Presentation only — the server's spin plan
 * decides every outcome; a skin only reacts to what every screen already shows, at the same moment.
 * Leave the hook out and the wheel looks and sounds exactly as in Delta Neon.
 */
import type { ComponentType } from 'react';
import type { SfxKit } from '../audio/voices.ts';
import type { SkinRenderContext } from './types.ts';

/** A slice as a skin sees it: what's printed on it (the host's text, emoji and colour). */
export interface WheelSlice {
  label: string;
  emoji: string;
  color: string;
}

export interface WheelDecorContext extends SkinRenderContext {
  /** The current spin's phase on the synced server clock (the same moment on every screen). */
  phase: 'idle' | 'lead' | 'spinning' | 'landed';
  /**
   * Where the wheel is right now — rotation in degrees (clockwise) and speed 0..1 — exactly as the
   * renderer draws it. Cheap: safe to call every animation frame.
   */
  sample: () => { rotation: number; speed: number };
  /**
   * A fresh landing that every screen is celebrating right now, with a key unique to that spin; null
   * otherwise (stale landings for late joiners never react). Ends when the result card closes.
   */
  landing: (WheelSlice & { key: string }) | null;
}

/**
 * Re-voiced wheel moments, built only from the sfx kit (tone / noise / note) on the SFX bus. Mute,
 * volume and the jukebox dip apply as for the built-in sounds; a moment without a voice keeps its own.
 */
export interface WheelVoices {
  /** The spin starts (built-in: a whoosh and a rising saw, ~0.5 s). */
  launch?: (kit: SfxKit) => void;
  /** A peg passes the flapper; `speed` 0..1. Called at most ~35 times a second — keep it under 50 ms. */
  tick?: (kit: SfxKit, speed: number) => void;
  /** The landing sting for the winning slice (built-in: ding + win + a C-major arpeggio, ~1.2 s). */
  reveal?: (kit: SfxKit, slice: WheelSlice) => void;
}

export interface WheelSkin {
  /**
   * Rendered inside the stage wheel (the `--wh-*` geometry vars are in scope: `--wh-cy` centre,
   * `--wh-rw` rim radius, `--wh-rh` hub radius) in `[data-part="wheel-decor"]`, which is absolutely
   * positioned over the wheel box, pointer-events none, aria-hidden and makes no stacking context:
   * `z-index: -1` paints behind the wheel (above the stage lights), 1–4 between the wheel and the
   * result card (the pointer is 3, the card 5). Never in the lobby's preview wheel.
   */
  Decor?: ComponentType<WheelDecorContext>;
  voices?: WheelVoices;
}

/** Problems with a skin's wheel hooks (empty when usable). */
export function wheelSkinProblems(wheel: WheelSkin): string[] {
  const out: string[] = [];
  const decor: unknown = wheel.Decor;
  // A function/class component, or memo()/forwardRef() objects.
  if (decor !== undefined && typeof decor !== 'function' && (typeof decor !== 'object' || decor === null))
    out.push('Decor must be a component');
  for (const [name, voice] of Object.entries(wheel.voices ?? {})) {
    if (!['launch', 'tick', 'reveal'].includes(name)) out.push(`unknown voice "${name}"`);
    else if (typeof voice !== 'function') out.push(`voice "${name}" must be a function`);
  }
  return out;
}
