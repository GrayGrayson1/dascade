/**
 * DAS Survey Showdown synchronized state. PUBLIC ONLY: the board carries hidden answers as bare slots
 * (no text, no points); the answer sheet, the presenter pass, custom rounds and audience guesses live
 * in server memory and presenter-only / per-player messages. Shape as clients see it:
 * ShowdownPublicState in @dascade/shared/games/showdown.
 */
import { t, type SchemaType } from '@colyseus/schema';
import { BaseRoomState } from '../../schema/base.ts';

export const ShowdownState = BaseRoomState.extend(
  {
    presenterId: t.string().default(''),
    /** JSON ShowdownBoardView ('' outside a show). */
    boardJson: t.string().default(''),
    rev: t.uint32().default(0),
    /** playerId → team index (0 | 1). */
    teams: t.map('uint8'),
    /** playerIds of stage displays. */
    screens: t.map('boolean'),
    hype0: t.uint8().default(0),
    hype1: t.uint8().default(0),
    guessesIn: t.uint16().default(0),
    customRounds: t.uint8().default(0),
    /** JSON ShowdownFinale once the show is over. */
    finaleJson: t.string().default(''),
  },
  'ShowdownState',
);
export type ShowdownState = SchemaType<typeof ShowdownState>;
