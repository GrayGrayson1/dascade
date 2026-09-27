/**
 * Tournament Center kiosk state. Participants and matches are Schema maps (delta-synced); config,
 * rounds, standings and the audit log travel as small JSON strings. Shapes match
 * `TournamentPublicState` in @dascade/shared. No secrets here: tokens and tickets are private.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { BaseRoomState } from '../../schema/base.ts';

export const TParticipant = schema(
  {
    id: t.string().default(''),
    name: t.string().default(''),
    avatar: t.string().default('rocket'),
    seed: t.uint16().default(0),
    status: t.string().default('registered'),
    checkedIn: t.boolean().default(false),
    rating: t.uint16().default(0),
    provisional: t.boolean().default(true),
    entry: t.uint16().default(0),
    online: t.boolean().default(false),
    place: t.uint16().default(0),
    points: t.float32().default(0),
    wins: t.uint16().default(0),
    draws: t.uint16().default(0),
    losses: t.uint16().default(0),
    byes: t.uint16().default(0),
    currentMatchId: t.string().default(''),
  },
  'TParticipant',
);
export type TParticipant = SchemaType<typeof TParticipant>;

export const TMatch = schema(
  {
    id: t.string().default(''),
    bracket: t.string().default('main'),
    round: t.uint16().default(0),
    order: t.uint16().default(0),
    label: t.string().default(''),
    roundLabel: t.string().default(''),
    status: t.string().default('WAITING'),
    aId: t.string().default(''),
    bId: t.string().default(''),
    aLabel: t.string().default(''),
    bLabel: t.string().default(''),
    aFrom: t.string().default(''),
    bFrom: t.string().default(''),
    aFromTake: t.string().default(''),
    bFromTake: t.string().default(''),
    nextMatchId: t.string().default(''),
    nextSlot: t.string().default(''),
    loserNextMatchId: t.string().default(''),
    loserNextSlot: t.string().default(''),
    conditional: t.boolean().default(false),
    bestOf: t.uint8().default(1),
    gameNumber: t.uint8().default(0),
    aPoints: t.float32().default(0),
    bPoints: t.float32().default(0),
    gamesJson: t.string().default('[]'),
    winnerId: t.string().default(''),
    loserId: t.string().default(''),
    draw: t.boolean().default(false),
    resultKind: t.string().default(''),
    resultNote: t.string().default(''),
    firstId: t.string().default(''),
    decider: t.string().default(''),
    roomCode: t.string().default(''),
    aPresent: t.boolean().default(false),
    bPresent: t.boolean().default(false),
    noShowAt: t.float64().default(0),
    startedAt: t.float64().default(0),
    completedAt: t.float64().default(0),
  },
  'TMatch',
);
export type TMatch = SchemaType<typeof TMatch>;

export const TournamentState = BaseRoomState.extend(
  {
    status: t.string().default('DRAFT'),
    paused: t.boolean().default(false),
    organizerId: t.string().default(''),
    organizerName: t.string().default(''),
    seedingMethod: t.string().default(''),
    currentRound: t.uint16().default(0),
    totalRounds: t.uint16().default(0),
    championId: t.string().default(''),
    checkInEndsAt: t.float64().default(0),
    createdAt: t.float64().default(0),
    startedAt: t.float64().default(0),
    completedAt: t.float64().default(0),
    participants: t.map(TParticipant),
    matches: t.map(TMatch),
    roundsJson: t.string().default('[]'),
    standingsJson: t.string().default(''),
    auditJson: t.string().default('[]'),
  },
  'TournamentState',
);
export type TournamentState = SchemaType<typeof TournamentState>;
