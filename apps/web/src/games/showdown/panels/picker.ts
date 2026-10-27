/**
 * The picker strip's model (pure, unit-tested): what the console says about the draw at a moment.
 *
 * The server has already decided who answers when the `pick` event arrives, so the console names
 * them at once — "Priya S. — on stage in 2 s", counting down to the moment the stage starts its
 * 1.5 s converge (landAt − 1500) — then "Priya S. is answering · 0:12" from the landing on. After
 * SHOWDOWN_NO_SHOW_MS without an answer the presenter may reroll (with a reason the server logs).
 */
import type { PlayerView } from '@dascade/shared';
import {
  SHOWDOWN_NO_SHOW_MS,
  SHOWDOWN_PICK_MODE_INFO,
  type ShowdownMode,
  type ShowdownPickMode,
  type ShowdownPickerPrivate,
  type ShowdownStage,
} from '@dascade/shared/games/showdown';

/** The stage spends the last 1.5 s before landAt converging on the winner. */
export const PICK_CONVERGE_MS = 1500;

export type PickerPhase =
  /** The picker can't run now: before round 1, or not a Presenter Showcase. */
  | { kind: 'off'; why: 'intro' | 'mode' }
  /** Nobody is in the random draw right now (Spotlight a name still works). */
  | { kind: 'empty' }
  /** Ready to draw from `pool` people. */
  | { kind: 'ready'; pool: number }
  /** Just drawn: the presenter reads the name before the stage lands ("on stage in 2 s"). */
  | { kind: 'heads'; name: string; seconds: number }
  /** On stage: `elapsedMs` since the landing (null = unknown), `rerollInMs` ≤ 0 = Reroll is open. */
  | { kind: 'answering'; name: string; elapsedMs: number | null; rerollInMs: number };

export interface PickerPhaseInput {
  mode: ShowdownMode;
  stage: ShowdownStage;
  hotSeat: string;
  hotName: string;
  landAt: number;
  poolSize: number;
}

export function pickerPhase(p: PickerPhaseInput, now: number): PickerPhase {
  if (p.mode !== 'showcase') return { kind: 'off', why: 'mode' };
  if (p.hotSeat) {
    const name = p.hotName || 'Someone';
    // A restored show can carry a hot seat without its landing time: treat it as on stage.
    if (!p.landAt) return { kind: 'answering', name, elapsedMs: null, rerollInMs: 0 };
    const headsEnd = p.landAt - PICK_CONVERGE_MS;
    if (now < headsEnd) return { kind: 'heads', name, seconds: Math.max(1, Math.ceil((headsEnd - now) / 1000)) };
    return { kind: 'answering', name, elapsedMs: Math.max(0, now - p.landAt), rerollInMs: p.landAt + SHOWDOWN_NO_SHOW_MS - now };
  }
  if (p.stage === 'intro') return { kind: 'off', why: 'intro' };
  if (p.poolSize <= 0) return { kind: 'empty' };
  return { kind: 'ready', pool: p.poolSize };
}

/** "0:07", "1:30" (never negative). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** "37 in the pool" / "1 in the pool". */
export function poolWords(n: number): string {
  return `${n} in the pool`;
}

/** One line of the draw history the console keeps from the room's pick / pickEnd events. */
export interface DrawLine {
  drawNo: number;
  name: string;
  /** What happened to the draw so far. */
  how: 'drawn' | 'done' | 'noAnswer' | 'reroll' | 'cleared';
  /** This draw was a reroll's redraw. */
  reroll: boolean;
  /** Spotlight a name: chosen, not drawn. */
  chosen?: boolean;
  at: number;
}

const HOW_WORDS: Record<DrawLine['how'], string> = {
  drawn: 'in the hot seat',
  done: 'turn done',
  noAnswer: 'no answer — back in the pool',
  reroll: 'rerolled — back in the pool',
  cleared: 'taken off the stage',
};

export function drawWords(line: DrawLine): string {
  return `${line.chosen ? 'Spotlight' : line.reroll ? 'Redraw' : 'Draw'} ${line.drawNo}: ${line.name}, ${HOW_WORDS[line.how]}`;
}

/**
 * Folds one room event into the history (newest first, capped). A repeated event changes nothing; a
 * pickEnd updates the draw it ends.
 */
export function foldDraw(
  list: readonly DrawLine[],
  ev:
    | { type: 'pick'; drawNo: number; name: string; reroll: boolean; chosen?: boolean }
    | { type: 'pickEnd'; drawNo: number; how: 'done' | 'noAnswer' | 'reroll' | 'cleared' },
  at: number,
  cap = 30,
): DrawLine[] {
  if (ev.type === 'pick') {
    if (list.some((l) => l.drawNo === ev.drawNo)) return [...list];
    const line: DrawLine = {
      drawNo: ev.drawNo,
      name: ev.name,
      how: 'drawn',
      reroll: ev.reroll,
      ...(ev.chosen ? { chosen: true } : {}),
      at,
    };
    return [line, ...list].slice(0, cap);
  }
  return list.map((l) => (l.drawNo === ev.drawNo && l.how === 'drawn' ? { ...l, how: ev.how } : l));
}

/** One person the picker can put in the hot seat (the presenter, big screens and spectators never). */
export interface PickPerson {
  id: string;
  name: string;
  crew: boolean;
  /** Turns this show. */
  turns: number;
  /** Out of the random draw (Include puts them back). */
  excluded: boolean;
  /** Hidden by a moderator: can't be chosen until shown again. */
  hidden: boolean;
  away: boolean;
  /** Their turn counted this round. */
  done: boolean;
  hot: boolean;
  me: boolean;
}

export interface PickPeopleInput {
  players: Record<string, Pick<PlayerView, 'id' | 'name' | 'connected' | 'spectator'>> | null | undefined;
  presenterId: string;
  screens: Record<string, boolean> | null | undefined;
  done: Record<string, boolean> | null | undefined;
  hotSeat: string;
  myId: string | null;
  /** The server's picker view (presenter and crew); null = not sent yet. */
  picker: ShowdownPickerPrivate | null | undefined;
}

/** Everyone who could take the hot seat, A–Z (the presenter, big screens and spectators never). */
export function pickPeople(input: PickPeopleInput): PickPerson[] {
  const crew = new Set(input.picker?.crew ?? []);
  const excluded = new Set(input.picker?.excluded ?? []);
  const hidden = new Set(input.picker?.hidden ?? []);
  const rows: PickPerson[] = [];
  for (const p of Object.values(input.players ?? {})) {
    if (!p || p.spectator || p.id === input.presenterId || input.screens?.[p.id]) continue;
    rows.push({
      id: p.id,
      name: p.name,
      crew: crew.has(p.id),
      turns: input.picker?.turns[p.id] ?? 0,
      excluded: excluded.has(p.id),
      hidden: hidden.has(p.id),
      away: !p.connected,
      done: input.done?.[p.id] === true,
      hot: p.id === input.hotSeat,
      me: p.id === input.myId,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}

/** Can be chosen by name right now (the server checks again). */
export function choosable(p: PickPerson): boolean {
  return !p.hidden && !p.away && !p.hot;
}

/** Why nobody is in the random draw — never naming who chose Skip me. */
export function emptyWhy(people: readonly PickPerson[], crewDraw: boolean): string {
  const here = people.filter((p) => !p.away && !p.hidden && !p.hot && (crewDraw || !p.crew));
  if (here.length === 0) return 'Nobody in the audience is connected right now.';
  if (here.every((p) => p.excluded)) return 'Everyone here is excluded from the random draw.';
  return 'Everyone here is excluded, hidden or has switched on Skip me.';
}

/** "Fair mode: fewest turns first…", plus where the crew stand. */
export function modeWords(mode: ShowdownPickMode, crewDraw: boolean): string {
  return `${SHOWDOWN_PICK_MODE_INFO[mode].title}: ${SHOWDOWN_PICK_MODE_INFO[mode].blurb} ${
    crewDraw ? 'Crew are in the random draw too.' : 'Crew are only picked by name.'
  }`;
}

/** Names matching a search (accents and case ignored), choosable first. */
export function searchPeople(people: readonly PickPerson[], query: string): PickPerson[] {
  const fold = (t: string) =>
    t
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase();
  const q = fold(query.trim());
  const hits = q ? people.filter((p) => fold(p.name).includes(q)) : [...people];
  return hits.sort((a, b) => Number(choosable(b)) - Number(choosable(a)));
}
