/**
 * DASterpiece synchronized state (extends the party kit state).
 *
 * Anonymity: `answers` carries only the text under an opaque random id while a showdown is being
 * voted on. `authorId` / `authorName` and every tally field stay empty until that showdown's
 * voting has closed and it has been scored. Prompts are dealt privately while writing; ballots are
 * never published (only per-answer totals after the vote).
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { PartyRoomState } from '../party/index.ts';

export const MpAnswerState = schema(
  {
    id: t.string().default(''),
    text: t.string().default(''),
    blank: t.boolean().default(false),
    votes: t.uint16().default(0),
    firsts: t.uint16().default(0),
    audienceVotes: t.uint16().default(0),
    points: t.int32().default(0),
    authorId: t.string().default(''),
    authorName: t.string().default(''),
    winner: t.boolean().default(false),
    sweep: t.boolean().default(false),
    audiencePick: t.boolean().default(false),
  },
  'MpAnswerState',
);
export type MpAnswerState = SchemaType<typeof MpAnswerState>;

export const MasterpieceState = PartyRoomState.extend(
  {
    roundType: t.string().default(''),
    roundKind: t.string().default(''),
    multiplier: t.uint8().default(1),
    perWriter: t.uint8().default(0),
    written: t.map('uint8'),
    showdownCount: t.uint8().default(0),
    showdownIndex: t.uint8().default(0),
    showdownId: t.string().default(''),
    voteKind: t.string().default(''),
    prompt: t.string().default(''),
    promptType: t.string().default(''),
    walkover: t.boolean().default(false),
    answers: t.array(MpAnswerState),
    votesIn: t.uint16().default(0),
    votersExpected: t.uint16().default(0),
    audienceIn: t.uint16().default(0),
    audienceOpen: t.boolean().default(false),
    hallJson: t.string().default('[]'),
    customCount: t.uint16().default(0),
  },
  'MasterpieceState',
);
export type MasterpieceState = SchemaType<typeof MasterpieceState>;
