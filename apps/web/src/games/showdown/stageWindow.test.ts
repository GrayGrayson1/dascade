import { describe, expect, it } from 'vitest';
import { canFullscreen, isFullscreenKey, isWindowFullscreen, stageWindowFullscreen } from './stageWindow.ts';

/** A key press in the stage window (only what the full-screen key reads). */
const key = (over: Partial<Parameters<typeof isFullscreenKey>[0]> = {}): Parameters<typeof isFullscreenKey>[0] => ({
  key: 'f',
  defaultPrevented: false,
  repeat: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  target: { closest: () => null },
  ...over,
});

/** The stage window's page: nothing open over it, or a dialog. */
const page = (dialog = false) => ({
  querySelector: (sel: string) => (dialog && sel === 'dialog[open]' ? {} : null),
  querySelectorAll: () => [],
});

/** A window for isWindowFullscreen: its page's full-screen element and the browser's display mode. */
const view = (fullscreenElement: unknown, displayFullscreen = false) =>
  ({
    document: { fullscreenElement } as Document,
    matchMedia: (q: string) => ({ matches: displayFullscreen && q === '(display-mode: fullscreen)' }) as MediaQueryList,
  }) as Pick<Window, 'document' | 'matchMedia'>;

describe('the stage window’s full screen', () => {
  it('F (either case) toggles it; nothing else does', () => {
    expect(isFullscreenKey(key(), page())).toBe(true);
    expect(isFullscreenKey(key({ key: 'F' }), page())).toBe(true);
    for (const k of ['g', 'Escape', 'F11', 'Enter', ' ', 'j']) expect(isFullscreenKey(key({ key: k }), page()), k).toBe(false);
  });

  it('stays quiet with a modifier (Ctrl+F finds), a held key, a handled key, typing or a dialog', () => {
    expect(isFullscreenKey(key({ ctrlKey: true }), page())).toBe(false);
    expect(isFullscreenKey(key({ metaKey: true }), page())).toBe(false);
    expect(isFullscreenKey(key({ altKey: true }), page())).toBe(false);
    expect(isFullscreenKey(key({ repeat: true }), page())).toBe(false);
    expect(isFullscreenKey(key({ defaultPrevented: true }), page())).toBe(false);
    expect(isFullscreenKey(key({ target: { closest: (s: string) => (s.includes('input') ? {} : null) } }), page())).toBe(false);
    expect(isFullscreenKey(key(), page(true))).toBe(false);
    // Shift doesn't block it (F with Caps Lock or Shift is still F).
    expect(isFullscreenKey(key({ key: 'F' }), null)).toBe(true);
  });

  it('the window counts as full screen when its page is, or when the browser is (F11)', () => {
    expect(isWindowFullscreen(view(null))).toBe(false);
    expect(isWindowFullscreen(view({}))).toBe(true);
    expect(isWindowFullscreen(view(null, true))).toBe(true);
    const gone = {
      get document(): Document {
        throw new Error('closed');
      },
      matchMedia: () => ({ matches: true }) as MediaQueryList,
    };
    expect(isWindowFullscreen(gone)).toBe(false);
  });

  it('the button only where the page can go full screen; not full screen while no window is open', () => {
    expect(canFullscreen({ fullscreenEnabled: true } as Document)).toBe(true);
    expect(canFullscreen({ fullscreenEnabled: false } as Document)).toBe(false);
    expect(canFullscreen(null)).toBe(false);
    expect(stageWindowFullscreen()).toBe(false);
  });
});
