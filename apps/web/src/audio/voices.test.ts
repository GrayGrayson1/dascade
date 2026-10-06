import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SfxName } from './audio.ts';
import { activeSfxVoices, playSfxVoice, setSfxVoices, themeVoice, type SfxKit, type SfxVoice, type SfxVoices } from './voices.ts';

const kit: SfxKit = { tone: vi.fn(), noise: vi.fn(), note: (n) => 440 * Math.pow(2, (n - 69) / 12) };

/** A stand-in for audio.ts's SOUNDS that records which built-in sound played. */
function builtins() {
  const played: string[] = [];
  const sounds = new Proxy({} as Record<SfxName, () => void>, {
    get: (_target, name) => () => played.push(String(name)),
  });
  return { played, sounds };
}

afterEach(() => setSfxVoices(null));

describe('theme voices (ThemeSkin.sounds)', () => {
  it('plays the built-in sound when no theme voices are set', () => {
    const b = builtins();
    playSfxVoice('coin', b.sounds, kit);
    expect(b.played).toEqual(['coin']);
    expect(activeSfxVoices()).toBeNull();
  });

  it("plays the active theme's voice instead, with the kit", () => {
    const b = builtins();
    const coin = vi.fn<SfxVoice>();
    setSfxVoices({ coin });
    playSfxVoice('coin', b.sounds, kit);
    expect(coin).toHaveBeenCalledWith(kit);
    expect(b.played).toEqual([]);
  });

  it('falls back to the built-in sound for names the theme does not voice', () => {
    const b = builtins();
    setSfxVoices({ coin: vi.fn() });
    playSfxVoice('click', b.sounds, kit);
    expect(b.played).toEqual(['click']);
  });

  it('clears with null or undefined', () => {
    setSfxVoices({ win: vi.fn() });
    expect(themeVoice('win')).not.toBeNull();
    setSfxVoices(undefined);
    expect(themeVoice('win')).toBeNull();
    setSfxVoices({ win: vi.fn() });
    setSfxVoices(null);
    expect(activeSfxVoices()).toBeNull();
  });

  it('ignores anything that is not a function', () => {
    const b = builtins();
    setSfxVoices({ ding: 'loud' } as unknown as SfxVoices);
    expect(themeVoice('ding')).toBeNull();
    playSfxVoice('ding', b.sounds, kit);
    expect(b.played).toEqual(['ding']);
  });
});
