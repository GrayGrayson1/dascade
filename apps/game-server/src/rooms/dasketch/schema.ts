/**
 * DASketch synchronized state. The secret word is NEVER stored here while a turn is
 * live: guessers only ever see the masked `hint`; `word` is filled in at reveal time.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { BaseRoomState } from '../../schema/base.ts';

export const SketchPlayerState = schema(
  {
    guessed: t.boolean().default(false),
    rank: t.uint8().default(0),
    turnPoints: t.int32().default(0),
    guessMs: t.uint32().default(0),
  },
  'SketchPlayerState',
);
export type SketchPlayerState = SchemaType<typeof SketchPlayerState>;

export const DasketchState = BaseRoomState.extend(
  {
    stage: t.string().default('idle'),
    artistId: t.string().default(''),
    turn: t.uint32().default(0),
    turnInRound: t.uint16().default(0),
    turnsInRound: t.uint16().default(0),
    totalRounds: t.uint8().default(0),
    hint: t.string().default(''),
    word: t.string().default(''),
    revealReason: t.string().default(''),
    turnStartedAt: t.number().default(0),
    drawMs: t.uint32().default(0),
    artistPoints: t.int32().default(0),
    guessedCount: t.uint8().default(0),
    eligibleCount: t.uint8().default(0),
    sketch: t.map(SketchPlayerState),
    historyJson: t.string().default('[]'),
    awardsJson: t.string().default('[]'),
    customCount: t.uint16().default(0),
    customFiltered: t.uint16().default(0),
  },
  'DasketchState',
);
export type DasketchState = SchemaType<typeof DasketchState>;
