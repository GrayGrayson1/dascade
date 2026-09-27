import { describe, expect, it } from 'vitest';
import { CreateOptionsSchema, JoinOptionsSchema } from './protocol.ts';
import { StatsQuerySchema } from './stats.ts';

describe('guest ids', () => {
  it('accept what the web client generates (and short test ids)', () => {
    for (const guestId of ['g_0123456789abcdef01234567', 'g-b', 'guest-Player1', 'A_z-9']) {
      expect(JoinOptionsSchema.safeParse({ name: 'P', guestId }).success).toBe(true);
    }
    expect(StatsQuerySchema.safeParse({ guestId: 'g_0123456789abcdef01234567' }).success).toBe(true);
  });

  it('refuse separators that could alias another profile’s store keys', () => {
    for (const guestId of ['x|g:victim', 'a|b', 'u:someone', 'has space', '', 'é', 'x'.repeat(65)]) {
      expect(JoinOptionsSchema.safeParse({ name: 'P', guestId }).success).toBe(false);
      expect(CreateOptionsSchema.safeParse({ name: 'P', guestId }).success).toBe(false);
    }
    expect(StatsQuerySchema.safeParse({ guestId: 'x|g:victim' }).success).toBe(false);
  });
});
