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
    /** Holding card on every stage ('' = none). */
    card: t.string().default(''),
    /** Round clock (Presenter Showcase): server epoch ms it runs out while running, else 0. */
    clockEndsAt: t.number().default(0),
    /** Ms left while paused (negative = overtime). */
    clockLeft: t.number().default(0),
    /** The round's full time in ms (0 = no clock). */
    clockMax: t.number().default(0),
    clockShow: t.boolean().default(true),
    /** A Reveal remaining sweep is running. */
    sweep: t.boolean().default(false),
    /** The rounds loaded are an event preset's practice boards. */
    rehearsal: t.boolean().default(false),
    /** The event preset that made this an event room ('' = an ordinary room). */
    event: t.string().default(''),
    // The picker: public (a pick is public the moment it lands). Who skipped is never here.
    drawNo: t.uint32().default(0),
    hotSeat: t.string().default(''),
    pickAt: t.number().default(0),
    landAt: t.number().default(0),
    poolSize: t.uint16().default(0),
    /** playerIds whose turn counted this round. */
    done: t.map('boolean'),
    /** playerIds on the stage's spotlight grid (participants who aren't hidden). */
    seats: t.map('boolean'),
    // Sound station (event rooms).
    soundStation: t.string().default(''),
    soundSeenAt: t.number().default(0),
    /** playerId → 1 (can play) | 2 (silent), for consoles and big screens that report. */
    audio: t.map('uint8'),
  },
  'ShowdownState',
);
export type ShowdownState = SchemaType<typeof ShowdownState>;
