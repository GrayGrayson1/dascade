/**
 * Display profiles (DSP-02 C): how the showcase stage tunes itself for the way it's watched.
 *
 *  - Stream-safe: for a Teams share (compressed, downscaled): type +10 %, tile edges of at least 3 px,
 *    no fog or soft glows, particles capped at the "low" level.
 *  - Projector: for a room (washed-out blacks): lifted blacks, lighter hidden tiles, brighter edges.
 *
 * The show setting `display` decides: 'stream' / 'projector' force one profile on every screen (the
 * escape hatch); 'auto' (the default) lets each screen choose:
 *
 *  | Where the stage is drawn                          | Profile                                  |
 *  |---------------------------------------------------|------------------------------------------|
 *  | the stage window (the one shared in Teams)        | Stream-safe                              |
 *  | the console's pinned preview                      | Stream-safe (what the share looks like)  |
 *  | a big screen (`?screen=1`, role 'screen')         | Projector, unless the link says          |
 *  |                                                   | `&display=stream` (or `&display=projector`)|
 *  | anything else (an audience laptop, the tour…)     | by size: a stage at least                |
 *  |                                                   | PROJECTOR_MIN_WIDTH CSS px wide is a room |
 *  |                                                   | display → Projector; smaller → Stream-safe|
 *
 * A browser can't know it's being screen-shared, so these are informed guesses; the setting is the
 * manual override when a guess is wrong. Presentation only: nothing here reaches the server.
 */
import { useLayoutEffect, useState, type RefObject } from 'react';
import type { ShowdownDisplay, ShowdownDisplaySetting } from '@dascade/shared/games/showdown';

/** Where a stage is drawn. */
export type DisplayContext = 'window' | 'console' | 'screen' | 'other';

/**
 * The show's own type (DSP-02, finding F8): the stage pins these on its root, so the DASCADE theme of
 * whoever draws it (the presenter's, through the stage window; a big screen's own) never changes the
 * stage's fonts. They are DASCADE's default UI and number faces; the looks add their title faces
 * (Creepster, Audiowide) on top through `--sd-title-font`.
 */
export const SHOW_FONTS = {
  '--font-ui': "'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-num': "'Space Grotesk Variable', 'Inter Variable', system-ui, sans-serif",
  '--font-display': "'DASCADE Digits', 'Tiny5', 'Silkscreen', ui-monospace, 'SFMono-Regular', monospace",
} as const;

/**
 * A stage at least this wide (CSS px) with nothing else to go on is a room display (a TV or a
 * projector running full screen): Projector. Laptop windows, phones and previews are smaller.
 */
export const PROJECTOR_MIN_WIDTH = 1600;

export interface DisplayInput {
  context: DisplayContext;
  /** The stage's rendered width (CSS px); 0 = not measured yet. */
  width: number;
  /** The page's query string (`?screen=1&display=stream`). */
  search?: string;
}

/** A profile named in the page's link (`&display=stream` / `&display=projector`), or null. */
export function displayParam(search: string | undefined): ShowdownDisplay | null {
  if (!search) return null;
  let value: string | null;
  try {
    value = new URLSearchParams(search).get('display');
  } catch {
    return null;
  }
  return value === 'stream' || value === 'projector' ? value : null;
}

/** The profile a stage uses. */
export function resolveDisplay(setting: ShowdownDisplaySetting | null | undefined, input: DisplayInput): ShowdownDisplay {
  if (setting === 'stream' || setting === 'projector') return setting;
  switch (input.context) {
    case 'window':
    case 'console':
      return 'stream';
    case 'screen':
      return displayParam(input.search) ?? 'projector';
    case 'other':
      return input.width >= PROJECTOR_MIN_WIDTH ? 'projector' : 'stream';
  }
}

/**
 * Where this stage element is drawn, from the page around it: the stage window is another document
 * (the console portals into it), the console and the big screen mark their roots with data-part.
 */
export function detectDisplayContext(el: Element): DisplayContext {
  if (typeof document !== 'undefined' && el.ownerDocument !== document) return 'window';
  if (el.closest('[data-part="showdown-console"], .sd-console')) return 'console';
  if (el.closest('[data-part="showdown-screen"]')) return 'screen';
  return 'other';
}

/**
 * The display profile for the stage at `ref`. `context` overrides the detection (a caller that knows
 * where it draws the stage). Decided before the first paint and re-decided when the stage resizes.
 */
export function useDisplay(
  ref: RefObject<HTMLElement | null>,
  setting: ShowdownDisplaySetting | null | undefined,
  context?: DisplayContext,
): ShowdownDisplay {
  const [seen, setSeen] = useState<{ context: DisplayContext; width: number; search: string }>(() => ({
    context: context ?? 'other',
    width: 0,
    search: '',
  }));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const where = context ?? detectDisplayContext(el);
    const view = el.ownerDocument.defaultView;
    const search = view?.location?.search ?? '';
    const update = () => {
      const width = where === 'other' ? Math.round(el.getBoundingClientRect().width) : 0;
      setSeen((prev) =>
        prev.context === where && prev.width === width && prev.search === search ? prev : { context: where, width, search },
      );
    };
    update();
    // Only a stage decided by its size needs to watch it.
    if (where !== 'other') return;
    const Observer =
      (view as (Window & typeof globalThis) | null)?.ResizeObserver ?? (typeof ResizeObserver !== 'undefined' ? ResizeObserver : null);
    if (!Observer) return;
    const ro = new Observer(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, context]);
  return resolveDisplay(setting, seen);
}
