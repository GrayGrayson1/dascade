import { describe, expect, it } from 'vitest';
import type { WheelSegment } from '@dascade/shared/games/wheel';
import { rebaseServerToggles } from './model.ts';

const seg = (id: string, enabled = true, label = id.toUpperCase()): WheelSegment => ({ id, label, emoji: '', weight: 1, color: '#ffb020', enabled });

describe('rebaseServerToggles (deferred editor flush vs. "remove winner")', () => {
  it('keeps the server switching the winner off while a local edit batch was waiting', () => {
    // The host renamed B, then a spin started before the debounced edit was sent. At the
    // landing the server switched the winner A off. Flushing the stale list must not turn A back on.
    const base = [seg('a'), seg('b'), seg('c')];
    const server = [seg('a', false), seg('b'), seg('c')];
    const local = [seg('a'), seg('b', true, 'Bravo'), seg('c')];
    expect(rebaseServerToggles(local, base, server)).toEqual([seg('a', false), seg('b', true, 'Bravo'), seg('c')]);
  });

  it('only rebases segments whose switch the host left alone', () => {
    // Server switched A off (winner removed) while the host was editing; the host had turned C on.
    const base = [seg('a'), seg('b'), seg('c', false)];
    const server = [seg('a', false), seg('b'), seg('c', false)];
    const local = [seg('a'), seg('b', true, 'Bravo'), seg('c', true)];
    expect(rebaseServerToggles(local, base, server)).toEqual([seg('a', false), seg('b', true, 'Bravo'), seg('c', true)]);
    // If the host already switched it off too, nothing to do.
    const both = [seg('a', false), seg('b'), seg('c', false)];
    expect(rebaseServerToggles(both, base, server)).toBe(both);
  });

  it('ignores segments added or removed locally and is a no-op when the server did not change anything', () => {
    const base = [seg('a'), seg('b')];
    const local = [seg('b'), seg('new')];
    expect(rebaseServerToggles(local, base, [seg('a', false), seg('b')])).toEqual(local);
    expect(rebaseServerToggles(local, base, base)).toBe(local);
  });
});
