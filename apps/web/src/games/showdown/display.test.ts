import { describe, expect, it } from 'vitest';
import { SHOWDOWN_DISPLAYS } from '@dascade/shared/games/showdown';
import { PROJECTOR_MIN_WIDTH, SHOW_FONTS, displayParam, resolveDisplay, type DisplayContext } from './display.ts';

const CONTEXTS: DisplayContext[] = ['window', 'console', 'screen', 'other'];

describe('display profiles (DSP-02 C)', () => {
  it('a forced setting wins on every screen, whatever its size or link', () => {
    for (const setting of ['stream', 'projector'] as const) {
      for (const context of CONTEXTS) {
        for (const width of [0, 640, 1280, 1920, 3840]) {
          for (const search of ['', '?screen=1&display=stream', '?screen=1&display=projector']) {
            expect(resolveDisplay(setting, { context, width, search }), `${setting} ${context} ${width} ${search}`).toBe(setting);
          }
        }
      }
    }
  });

  it('auto: the stage window and the console preview are Stream-safe at any size', () => {
    for (const context of ['window', 'console'] as const) {
      for (const width of [0, 320, 1280, 1920, 3840]) expect(resolveDisplay('auto', { context, width })).toBe('stream');
      // A link parameter belongs to big screens only.
      expect(resolveDisplay('auto', { context, width: 1920, search: '?display=projector' })).toBe('stream');
    }
  });

  it('auto: a big screen is Projector unless its link says otherwise', () => {
    expect(resolveDisplay('auto', { context: 'screen', width: 1920, search: '?screen=1' })).toBe('projector');
    expect(resolveDisplay('auto', { context: 'screen', width: 800, search: '' })).toBe('projector');
    expect(resolveDisplay('auto', { context: 'screen', width: 1920, search: '?screen=1&display=stream' })).toBe('stream');
    expect(resolveDisplay('auto', { context: 'screen', width: 1920, search: '?display=stream&screen=1' })).toBe('stream');
    expect(resolveDisplay('auto', { context: 'screen', width: 1920, search: '?screen=1&display=projector' })).toBe('projector');
    // Anything else in the link is ignored.
    expect(resolveDisplay('auto', { context: 'screen', width: 1920, search: '?screen=1&display=tv' })).toBe('projector');
  });

  it('auto: anything else is decided by the stage’s size', () => {
    expect(resolveDisplay('auto', { context: 'other', width: 0 })).toBe('stream');
    expect(resolveDisplay('auto', { context: 'other', width: 390 })).toBe('stream');
    expect(resolveDisplay('auto', { context: 'other', width: 1280 })).toBe('stream');
    expect(resolveDisplay('auto', { context: 'other', width: PROJECTOR_MIN_WIDTH - 1 })).toBe('stream');
    expect(resolveDisplay('auto', { context: 'other', width: PROJECTOR_MIN_WIDTH })).toBe('projector');
    expect(resolveDisplay('auto', { context: 'other', width: 3840 })).toBe('projector');
    // The link parameter is a big-screen option.
    expect(resolveDisplay('auto', { context: 'other', width: 1920, search: '?display=stream' })).toBe('projector');
  });

  it('a missing setting behaves like auto (rooms made before the setting existed)', () => {
    for (const context of CONTEXTS) {
      for (const width of [640, 1920]) {
        expect(resolveDisplay(undefined, { context, width })).toBe(resolveDisplay('auto', { context, width }));
        expect(resolveDisplay(null, { context, width })).toBe(resolveDisplay('auto', { context, width }));
      }
    }
  });

  it('every setting resolves to one of the two profiles', () => {
    for (const setting of SHOWDOWN_DISPLAYS) {
      for (const context of CONTEXTS) expect(['stream', 'projector']).toContain(resolveDisplay(setting, { context, width: 1000 }));
    }
  });

  it('reads the display parameter from a link', () => {
    expect(displayParam('?screen=1&display=stream')).toBe('stream');
    expect(displayParam('display=projector')).toBe('projector');
    expect(displayParam('?display=STREAM')).toBeNull();
    expect(displayParam('')).toBeNull();
    expect(displayParam(undefined)).toBeNull();
  });

  it('pins the show’s fonts (never a theme’s): UI, numbers and the display fallback', () => {
    expect(Object.keys(SHOW_FONTS).sort()).toEqual(['--font-display', '--font-num', '--font-ui']);
    expect(SHOW_FONTS['--font-ui']).toMatch(/^'Inter Variable'/);
    expect(SHOW_FONTS['--font-num']).toMatch(/^'Space Grotesk Variable'/);
    for (const stack of Object.values(SHOW_FONTS)) expect(stack).not.toMatch(/Tahoma|Verdana/);
  });
});
