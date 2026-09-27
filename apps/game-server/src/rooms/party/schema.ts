/**
 * Party kit synchronized state. Game states extend it:
 *
 *   export const TriviaState = PartyRoomState.extend({ questionJson: t.string().default('') }, 'TriviaState');
 *
 * PUBLIC ONLY: seats carry *whether* someone answered, never *what*. Answers, votes, roles and
 * authors live in server memory (AnswerBox / VoteBox) and private messages until a reveal.
 * Shapes as seen by clients: PartyPublicView in @dascade/shared/party.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { BaseRoomState } from '../../schema/base.ts';

export const PartySeatState = schema(
  {
    answered: t.boolean().default(false),
    eligible: t.boolean().default(false),
    teamId: t.string().default(''),
    delta: t.int32().default(0),
    rank: t.uint16().default(0),
    prevRank: t.uint16().default(0),
    streak: t.uint16().default(0),
  },
  'PartySeatState',
);
export type PartySeatState = SchemaType<typeof PartySeatState>;

export const PartyTeamState = schema(
  {
    id: t.string().default(''),
    name: t.string().default(''),
    color: t.string().default('#ffffff'),
    icon: t.string().default('star'),
    score: t.int32().default(0),
    delta: t.int32().default(0),
    rank: t.uint16().default(0),
    prevRank: t.uint16().default(0),
    size: t.uint16().default(0),
  },
  'PartyTeamState',
);
export type PartyTeamState = SchemaType<typeof PartyTeamState>;

export const PartyRoomState = BaseRoomState.extend(
  {
    stage: t.string().default('idle'),
    stageSeq: t.uint32().default(0),
    stageMs: t.uint32().default(0),
    paused: t.boolean().default(false),
    pausedMs: t.uint32().default(0),
    totalRounds: t.uint16().default(0),
    teamMode: t.boolean().default(false),
    teamScoring: t.string().default('sum'),
    seats: t.map(PartySeatState),
    teams: t.map(PartyTeamState),
    answeredCount: t.uint16().default(0),
    eligibleCount: t.uint16().default(0),
    scoreSeq: t.uint32().default(0),
    podiumJson: t.string().default(''),
  },
  'PartyRoomState',
);
export type PartyRoomState = SchemaType<typeof PartyRoomState>;
