/**
 * DASception synchronized state (extends the party kit state). PUBLIC ONLY.
 *
 * Roles, night picks, Glitch identities and votes before the reveal are never stored here.
 * `nodes` carry whether a player is online, how they went offline, and a role only once it has
 * been revealed (elimination with revealRoles on, or the end of the match). The kit's
 * `seats[id].answered` flag means "read my card" (boot), "ready to vote" (day) or "voted"
 * (vote/runoff) — never anything during the night.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { PartyRoomState } from '../party/index.ts';

export const DeceptionNodeState = schema(
  {
    /** Seat order (join order at the deal). */
    seat: t.uint8().default(0),
    /** Name/avatar/colour captured at the deal so players who leave stay recognisable. */
    name: t.string().default(''),
    avatar: t.string().default('rocket'),
    color: t.string().default('#ffffff'),
    alive: t.boolean().default(true),
    outCycle: t.uint16().default(0),
    fate: t.string().default(''),
    role: t.string().default(''),
  },
  'DeceptionNodeState',
);
export type DeceptionNodeState = SchemaType<typeof DeceptionNodeState>;

export const DeceptionState = PartyRoomState.extend(
  {
    match: t.uint16().default(0),
    cycle: t.uint16().default(0),
    nodes: t.map(DeceptionNodeState),
    setupJson: t.string().default(''),
    dawnJson: t.string().default(''),
    verdictJson: t.string().default(''),
    runoffJson: t.string().default('[]'),
    logJson: t.string().default('[]'),
    winner: t.string().default(''),
    finalJson: t.string().default(''),
  },
  'DeceptionState',
);
export type DeceptionState = SchemaType<typeof DeceptionState>;
