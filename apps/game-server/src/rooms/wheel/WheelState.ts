/**
 * Synchronized state for Wheel of DAStiny. Everything here is public: the spin
 * result is decided when the spin is published, and every client needs the full
 * plan (start time, rotations, segment snapshot) to animate to the same landing.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { BaseRoomState } from '../../schema/base.ts';

export const WheelSpinState = schema(
  {
    spinId: t.uint32().default(0),
    /** 'idle' | 'spinning' | 'landed' */
    status: t.string().default('idle'),
    startAt: t.float64().default(0),
    durationMs: t.uint32().default(0),
    // float64: `t.number()` would send non-integers as float32 (≈0.0002° error at 4000°).
    fromRotation: t.float64().default(0),
    toRotation: t.float64().default(0),
    winnerId: t.string().default(''),
    winnerIndex: t.int32().default(-1),
    spunById: t.string().default(''),
    spunByName: t.string().default(''),
    /** JSON WheelSpinSnapshot: the exact segments + slice mode this spin used. */
    snapshotJson: t.string().default(''),
  },
  'WheelSpinState',
);
export type WheelSpinState = SchemaType<typeof WheelSpinState>;

export const WheelHistoryEntry = schema(
  {
    spinId: t.uint32().default(0),
    segmentId: t.string().default(''),
    label: t.string().default(''),
    emoji: t.string().default(''),
    color: t.string().default('#ffb020'),
    spunById: t.string().default(''),
    spunByName: t.string().default(''),
    at: t.number().default(0),
  },
  'WheelHistoryEntry',
);
export type WheelHistoryEntry = SchemaType<typeof WheelHistoryEntry>;

export const WheelState = BaseRoomState.extend(
  {
    spin: WheelSpinState,
    history: t.array(WheelHistoryEntry),
    restRotation: t.float64().default(0),
    nextSpinAt: t.number().default(0),
    totalSpins: t.uint32().default(0),
    lastWinnerId: t.string().default(''),
  },
  'WheelState',
);
export type WheelState = SchemaType<typeof WheelState>;
