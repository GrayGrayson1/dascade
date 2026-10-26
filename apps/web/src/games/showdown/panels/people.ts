/**
 * The Names panel's model (pure, unit-tested): every person in the room except big screens, with
 * their state in words — Presenter, Crew, Watching, On stage, Hidden, and Away on top of any of them.
 *
 * `seats` (public) lists participants who are on the stage grid; it leaves out the presenter, crew,
 * screens, spectators AND hidden guests. A guest who isn't seated is Hidden only when we know who the
 * crew are (the server's crew list, or the producer's crew links); otherwise the honest word is
 * "Not on stage".
 */
import type { PlayerView } from '@dascade/shared';

export type PersonStatus = 'presenter' | 'crew' | 'watching' | 'onstage' | 'hidden' | 'offstage';

export interface PersonRow {
  id: string;
  name: string;
  status: PersonStatus;
  /** Disconnected (the seat is held, they may come back). */
  away: boolean;
  /** This is you. */
  me: boolean;
  /** A guest the moderators can hide or put back (not the presenter, crew or a spectator). */
  guest: boolean;
}

export const STATUS_WORDS: Record<PersonStatus, string> = {
  presenter: 'Presenter',
  crew: 'Crew',
  watching: 'Watching',
  onstage: 'On stage',
  hidden: 'Hidden',
  offstage: 'Not on stage',
};

export interface PeopleInput {
  players: Record<string, Pick<PlayerView, 'id' | 'name' | 'connected' | 'spectator' | 'joinOrder'>> | null | undefined;
  presenterId: string;
  screens: Record<string, boolean> | null | undefined;
  seats: Record<string, boolean> | null | undefined;
  myId: string | null;
  /** You hold a crew role. */
  meCrew: boolean;
  /** Everyone holding a crew role, when known (server list or the producer's links); null = unknown. */
  crewIds: readonly string[] | null;
  /** Guests hidden by moderation, when the server says (null = work it out from `seats`). */
  hiddenIds: readonly string[] | null;
}

const RANK: Record<PersonStatus, number> = { presenter: 0, crew: 1, watching: 4, onstage: 3, hidden: 2, offstage: 3 };

export function buildPeople(input: PeopleInput): PersonRow[] {
  const crew = new Set(input.crewIds ?? []);
  if (input.meCrew && input.myId) crew.add(input.myId);
  const hidden = input.hiddenIds ? new Set(input.hiddenIds) : null;
  const rows: Array<PersonRow & { order: number }> = [];
  for (const p of Object.values(input.players ?? {})) {
    if (!p || input.screens?.[p.id]) continue;
    const presenter = p.id === input.presenterId;
    const isCrew = !presenter && crew.has(p.id);
    const watching = !presenter && !isCrew && p.spectator;
    const guest = !presenter && !isCrew && !watching;
    let status: PersonStatus;
    if (presenter) status = 'presenter';
    else if (isCrew) status = 'crew';
    else if (watching) status = 'watching';
    else if (hidden) status = hidden.has(p.id) ? 'hidden' : 'onstage';
    else if (input.seats?.[p.id]) status = 'onstage';
    else status = input.crewIds ? 'hidden' : 'offstage';
    rows.push({ id: p.id, name: p.name, status, away: !p.connected, me: p.id === input.myId, guest, order: p.joinOrder ?? 0 });
  }
  // The presenter and crew first, then hidden guests (what a moderator looks for), then everyone else in join order.
  rows.sort((a, b) => RANK[a.status] - RANK[b.status] || a.order - b.order);
  return rows.map(({ order: _order, ...row }) => row);
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase();

/** Rows whose name contains the filter text (accents and case ignored). */
export function filterPeople(rows: readonly PersonRow[], query: string): PersonRow[] {
  const q = fold(query.trim());
  return q ? rows.filter((r) => fold(r.name).includes(q)) : [...rows];
}

/** "24 people · 21 on stage · 1 hidden · 2 away". */
export function peopleSummary(rows: readonly PersonRow[]): string {
  const n = (s: PersonStatus) => rows.filter((r) => r.status === s).length;
  const parts = [`${rows.length} ${rows.length === 1 ? 'person' : 'people'}`, `${n('onstage')} on stage`];
  if (n('hidden')) parts.push(`${n('hidden')} hidden`);
  if (n('offstage')) parts.push(`${n('offstage')} not on stage`);
  const away = rows.filter((r) => r.away).length;
  if (away) parts.push(`${away} away`);
  return parts.join(' · ');
}
