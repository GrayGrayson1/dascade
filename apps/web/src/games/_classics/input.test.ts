import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntentInput, prefersTouch } from './input.ts';

type Intent = 'left' | 'fire';
const SPEC = { keys: { left: ['ArrowLeft'], fire: ['Space'] } } as const;

function stubPointer(coarse: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: coarse && (query.includes('pointer: coarse') || query.includes('hover: none')),
    media: query,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('IntentInput.lastDevice', () => {
  it('starts as touch on coarse-pointer devices, so launch hints say "tap" before the first touch', () => {
    stubPointer(true);
    expect(prefersTouch()).toBe(true);
    expect(new IntentInput<Intent>(SPEC).lastDevice).toBe('touch');
  });

  it('starts as keyboard on fine-pointer devices', () => {
    stubPointer(false);
    expect(prefersTouch()).toBe(false);
    expect(new IntentInput<Intent>(SPEC).lastDevice).toBe('keyboard');
  });

  it('starts as keyboard where matchMedia is unavailable (server / tests)', () => {
    expect(new IntentInput<Intent>(SPEC).lastDevice).toBe('keyboard');
  });
});
