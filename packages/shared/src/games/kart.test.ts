import { describe, expect, it } from 'vitest';
import {
  KART_INPUT_MAX,
  KartInputSchema,
  NEUTRAL_KART_INPUT,
  packKartInput,
  quantizeKartInput,
  unpackKartInput,
  type KartInput,
} from './kart.ts';

describe('kart input packing', () => {
  it('uses 19 bits; every bit round-trips', () => {
    expect(KART_INPUT_MAX).toBe(2 ** 19 - 1);
    const full: KartInput = { throttle: 1, brake: 1, steer: 1, drift: true, item: true, back: true, ahead: true };
    expect(unpackKartInput(packKartInput(full))).toEqual(full);
    expect(packKartInput(full)).toBeLessThanOrEqual(KART_INPUT_MAX);
    for (const key of ['drift', 'item', 'back', 'ahead'] as const) {
      const one = { ...NEUTRAL_KART_INPUT, [key]: true };
      const back = unpackKartInput(packKartInput(one));
      for (const k of ['drift', 'item', 'back', 'ahead'] as const) expect(back[k]).toBe(k === key);
    }
  });

  it('ahead is optional: absent packs as false and older 18-bit frames decode unchanged', () => {
    const legacy = { throttle: 0.4, brake: 0, steer: -0.5, drift: false, item: true, back: false };
    const q = quantizeKartInput(legacy);
    expect(q.ahead).toBe(false);
    expect(packKartInput(legacy) & (1 << 18)).toBe(0);
    expect(unpackKartInput(packKartInput(legacy))).toMatchObject({ item: true, back: false, ahead: false });
  });

  it('any integer in [0, KART_INPUT_MAX] decodes in range; the schema accepts exactly that range', () => {
    for (const p of [0, 1, 12345, 0x3ffff, 0x40000, KART_INPUT_MAX]) {
      const i = unpackKartInput(p);
      expect(i.throttle).toBeGreaterThanOrEqual(0);
      expect(i.throttle).toBeLessThanOrEqual(1);
      expect(Math.abs(i.steer)).toBeLessThanOrEqual(1);
    }
    expect(KartInputSchema.safeParse({ seq: 1, inputs: [KART_INPUT_MAX] }).success).toBe(true);
    expect(KartInputSchema.safeParse({ seq: 1, inputs: [KART_INPUT_MAX + 1] }).success).toBe(false);
  });
});
