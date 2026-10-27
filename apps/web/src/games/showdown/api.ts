/**
 * Event-room commands (picker, crew, moderation, sound station, preflight, audit). Every one goes
 * through the room's validated handlers; the server checks the permission, the phase and the draw
 * number again, so these only send what a button asked for.
 */
import {
  SHOWDOWN_MSG,
  type ShowdownIssuableRole,
  type ShowdownPickPayload,
  type ShowdownRerollReason,
} from '@dascade/shared/games/showdown';
import { session } from '../../net/hooks.ts';

const pick = (payload: ShowdownPickPayload) => session.send(SHOWDOWN_MSG.pick, payload);

export const showdownApi = {
  /** Draw the next person (`drawNo` = the last draw number this console saw). */
  pick: (round: number, drawNo: number) => pick({ a: 'pick', round, drawNo }),
  /** The hot seat's turn counts (key D). */
  done: (drawNo: number) => pick({ a: 'done', drawNo }),
  /** The hot seat didn't answer: back in the pool (key A). */
  noAnswer: (drawNo: number) => pick({ a: 'noAnswer', drawNo }),
  /** Put the hot seat back and draw again without them. */
  reroll: (drawNo: number, reason: ShowdownRerollReason) => pick({ a: 'reroll', drawNo, reason }),
  /** Spotlight a name: put this person in the hot seat (`picker.choose`). */
  choose: (round: number, drawNo: number, playerId: string) => pick({ a: 'choose', round, drawNo, playerId }),
  /** Out of / back in the random draw (`picker.manage`). */
  exclude: (playerId: string) => pick({ a: 'exclude', playerId }),
  include: (playerId: string) => pick({ a: 'include', playerId }),
  includeAll: () => pick({ a: 'includeAll' }),
  /** Your own Skip me switch. */
  skip: (on: boolean) => session.send(SHOWDOWN_MSG.skip, { on }),

  /** Redeem a crew link (`<id>.<secret>`, from the address bar's fragment). */
  claimCrew: (link: string) => session.send(SHOWDOWN_MSG.crewClaim, { link }),
  issueCrew: (role: ShowdownIssuableRole, name: string) => session.send(SHOWDOWN_MSG.crewIssue, { role, name }),
  revokeCrew: (id: string) => session.send(SHOWDOWN_MSG.crewRevoke, { id }),
  /** Make someone the presenter (producer): their console opens, the old presenter link stops working. */
  assign: (playerId: string, reason?: string) => session.send(SHOWDOWN_MSG.assign, reason ? { playerId, reason } : { playerId }),
  rename: (playerId: string, name: string) => session.send(SHOWDOWN_MSG.rename, { playerId, name }),
  hide: (playerId: string, on: boolean) => session.send(SHOWDOWN_MSG.hide, { playerId, on }),
  /** Ask for the whole audit log (the answer arrives as SHOWDOWN_MSG.auditExport). */
  exportAudit: () => session.send(SHOWDOWN_MSG.auditExport, {}),

  /** This device's show audio (sent every SHOWDOWN_AUDIO_BEAT_MS by consoles and big screens). */
  audio: (ready: boolean, muted: boolean, sounds: boolean) => session.send(SHOWDOWN_MSG.audio, { ready, muted, sounds }),
  /** Move the sound station ('' = the presenter's console). */
  station: (playerId: string) => session.send(SHOWDOWN_MSG.station, { playerId }),
  /** Ask the server for the preflight facts (the answer arrives as SHOWDOWN_MSG.preflight). */
  preflight: () => session.send(SHOWDOWN_MSG.preflight, {}),
};
