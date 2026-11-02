import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real store boots persistence; buzz() only needs its settings.
const settings = { muted: false, haptics: true as boolean | undefined };
vi.mock('./store.ts', () => ({ useApp: { getState: () => ({ settings }) } }));

const { buzz, hapticsAllowed } = await import('./haptics.ts');

describe('hapticsAllowed', () => {
  it('is on by default, including settings saved before the switch existed', () => {
    expect(hapticsAllowed({ muted: false, haptics: true })).toBe(true);
    expect(hapticsAllowed({ muted: false })).toBe(true);
  });

  it('is off when the Vibration switch is off or everything is muted', () => {
    expect(hapticsAllowed({ muted: false, haptics: false })).toBe(false);
    expect(hapticsAllowed({ muted: true, haptics: true })).toBe(false);
    expect(hapticsAllowed({ muted: true })).toBe(false);
  });
});

describe('buzz', () => {
  const vibrate = vi.fn((_pattern: number | number[]) => true);

  beforeEach(() => {
    settings.muted = false;
    settings.haptics = true;
    vibrate.mockClear();
    vibrate.mockImplementation(() => true);
    vi.stubGlobal('navigator', { vibrate });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('vibrates with the given pattern when allowed', () => {
    expect(buzz(35)).toBe(true);
    expect(buzz([200, 100, 200])).toBe(true);
    expect(vibrate).toHaveBeenNthCalledWith(1, 35);
    expect(vibrate).toHaveBeenNthCalledWith(2, [200, 100, 200]);
  });

  it('does nothing when "Mute everything" is on', () => {
    settings.muted = true;
    expect(buzz(35)).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does nothing when the Vibration switch is off', () => {
    settings.haptics = false;
    expect(buzz(35)).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('reads the settings at call time (a mute made after load applies to the next buzz)', () => {
    expect(buzz(35)).toBe(true);
    settings.muted = true;
    expect(buzz(35)).toBe(false);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('is a no-op where vibrate is missing or throws', () => {
    vi.stubGlobal('navigator', {});
    expect(buzz(35)).toBe(false);
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('not allowed');
      },
    });
    expect(buzz(35)).toBe(false);
  });
});
