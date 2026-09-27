/**
 * DASwords synchronized state (extends the party kit state). Shapes as seen by clients:
 * WordsPublicState in @dascade/shared/games/words.
 *
 * PUBLIC ONLY. Never here: the dictionary, a board's solution list, the anagram seed word,
 * anyone's words before the reveal, chain answers before the link closes, or who wrote a pending
 * Forbidden Letter answer. Those live in the room's memory and in private messages.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { PartyRoomState } from '../party/index.ts';

export const WordsSeatState = schema(
  {
    found: t.uint16().default(0),
    lives: t.uint8().default(0),
    out: t.boolean().default(false),
  },
  'WordsSeatState',
);
export type WordsSeatState = SchemaType<typeof WordsSeatState>;

export const WordsState = PartyRoomState.extend(
  {
    mode: t.string().default('grid'),
    grid: t.array('string'),
    gridSize: t.uint8().default(4),
    minLength: t.uint8().default(3),
    rack: t.string().default(''),
    possible: t.uint16().default(0),
    category: t.string().default(''),
    categoryHint: t.string().default(''),
    forbidden: t.string().default(''),
    chainWord: t.string().default(''),
    chainPrefix: t.string().default(''),
    chainLink: t.uint16().default(0),
    chainLinks: t.uint16().default(0),
    chainRule: t.string().default('last'),
    chainJson: t.string().default('[]'),
    linkJson: t.string().default(''),
    progress: t.map(WordsSeatState),
    reviewJson: t.string().default('[]'),
    revealJson: t.string().default(''),
    historyJson: t.string().default('[]'),
  },
  'WordsState',
);
export type WordsState = SchemaType<typeof WordsState>;
