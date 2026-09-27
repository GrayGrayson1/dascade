/**
 * TournamentView (server contract, @dascade/shared) → UI view-models (bracket/types.ts).
 * Pure functions: unit tested and memoized per state snapshot by the kiosk.
 */
import {
  FINISHED_MATCH_STATUSES,
  GAME_CATALOG,
  TIEBREAKS,
  formatPoints,
  type TournamentMatchView,
  type TournamentParticipantView,
  type TournamentView,
} from '@dascade/shared';
import type {
  BracketVM,
  CrossCellVM,
  MatchStatusVM,
  MatchVM,
  RoundVM,
  SectionId,
  SectionVM,
  SlotVM,
  StandingVM,
  TiebreakVM,
} from './bracket/types.ts';

export type ParticipantIndex = Map<string, TournamentParticipantView>;

export function indexParticipants(view: Pick<TournamentView, 'participants'>): ParticipantIndex {
  return new Map(view.participants.map((p) => [p.id, p]));
}

export function matchStatusVM(m: Pick<TournamentMatchView, 'status' | 'resultKind'>): MatchStatusVM {
  switch (m.status) {
    case 'WAITING':
      return 'waiting';
    case 'READY':
      return 'ready';
    case 'IN_PROGRESS':
      return 'live';
    case 'COMPLETE':
      return m.resultKind === 'bye' ? 'bye' : 'done';
    case 'FORFEIT':
      return 'forfeit';
    case 'VOID':
      return 'void';
    default:
      return 'waiting';
  }
}

export const WITHOUT_PLAY = new Set<string>(['bye', 'forfeit', 'dq', 'double_forfeit', 'override', 'void']);

const RESULT_NOTES: Partial<Record<string, string>> = {
  forfeit: 'Forfeit',
  dq: 'Forfeit',
  double_forfeit: 'Double forfeit',
  override: 'Organizer decision',
  lots: 'Decided by lot',
  bye: 'Bye',
};

/** Short note for a match card ('' when nothing notable). */
export function matchNote(m: TournamentMatchView): string | null {
  if (m.status === 'IN_PROGRESS' && m.decider) return m.decider === 'armageddon' ? 'Armageddon' : 'Decider';
  if (m.status === 'VOID') return m.conditional ? 'Not needed' : 'Void';
  if (m.conditional && !FINISHED_MATCH_STATUSES.includes(m.status)) return 'If needed';
  if (FINISHED_MATCH_STATUSES.includes(m.status)) {
    if (m.draw) return 'Draw';
    if (m.resultNote) return m.resultNote.length > 22 ? (RESULT_NOTES[m.resultKind] ?? 'Decided') : m.resultNote;
    const note = RESULT_NOTES[m.resultKind];
    if (note) return note;
  }
  return null;
}

function slot(m: TournamentMatchView, which: 'a' | 'b', people: ParticipantIndex, me: string | null, sides: boolean): SlotVM {
  const id = which === 'a' ? m.aId : m.bId;
  const label = which === 'a' ? m.aLabel : m.bLabel;
  const points = which === 'a' ? m.aPoints : m.bPoints;
  const p = id ? people.get(id) : undefined;
  const started = m.status === 'IN_PROGRESS' || m.status === 'COMPLETE' || m.status === 'FORFEIT';
  // A result decided without play (bye, forfeit, organizer decision) has no meaningful series score.
  const unplayed = WITHOUT_PLAY.has(m.resultKind) && m.aPoints + m.bPoints === 0;
  const isBye = !id && (label === 'Bye' || m.resultKind === 'bye');
  const out: SlotVM = {
    participantId: id || null,
    name: p?.name ?? (id ? 'Unknown' : label || 'TBD'),
    seed: p && p.seed > 0 ? p.seed : null,
    score: id && started && !unplayed ? points : null,
    isWinner: Boolean(id) && m.winnerId === id,
    isLoser: Boolean(id) && m.loserId === id,
    placeholder: !id,
    isBye,
    isMe: Boolean(id) && id === me,
  };
  if (sides && id && m.firstId) out.side = m.firstId === id ? 'first' : 'second';
  return out;
}

export function matchVM(
  m: TournamentMatchView,
  section: SectionId,
  round: number,
  people: ParticipantIndex,
  me: string | null,
  sides: boolean,
): MatchVM {
  const feeders: MatchVM['feeders'] = [];
  if (m.aFrom) feeders.push({ matchId: m.aFrom, take: m.aFromTake === 'loser' ? 'loser' : 'winner', slot: 0 });
  if (m.bFrom) feeders.push({ matchId: m.bFrom, take: m.bFromTake === 'loser' ? 'loser' : 'winner', slot: 1 });
  return {
    id: m.id,
    code: m.id,
    roundLabel: m.roundLabel,
    section,
    round,
    order: m.order,
    status: matchStatusVM(m),
    slots: [slot(m, 'a', people, me, sides), slot(m, 'b', people, me, sides)],
    bestOf: m.bestOf,
    gameNumber: Math.max(1, m.gameNumber),
    note: matchNote(m),
    roomCode: m.roomCode || null,
    feeders,
    involvesMe: Boolean(me) && (m.aId === me || m.bId === me),
  };
}

function sectionOf(m: TournamentMatchView, format: TournamentView['config']['format']): { section: SectionId; round: number } {
  if (m.bracket === 'grand_final') return { section: 'finals', round: 1 };
  if (m.bracket === 'grand_final_reset') return { section: 'finals', round: 2 };
  if (m.bracket === 'losers') return { section: 'losers', round: m.round };
  if (m.bracket === 'winners' && format === 'double_elimination') return { section: 'winners', round: m.round };
  return { section: 'main', round: m.round };
}

const SECTION_LABELS: Record<SectionId, string> = {
  winners: 'Winners bracket',
  losers: 'Losers bracket',
  finals: 'Finals',
  main: 'Bracket',
};
const SECTION_ORDER: SectionId[] = ['winners', 'losers', 'finals', 'main'];

function roundState(matches: MatchVM[], serverStatus: 'pending' | 'active' | 'complete' | undefined): RoundVM['state'] {
  if (serverStatus === 'complete') return 'done';
  if (serverStatus === 'active') return 'live';
  if (serverStatus === 'pending') return 'upcoming';
  if (
    matches.length > 0 &&
    matches.every((m) => m.status === 'done' || m.status === 'bye' || m.status === 'forfeit' || m.status === 'void')
  )
    return 'done';
  if (matches.some((m) => m.status === 'live' || m.status === 'ready')) return 'live';
  return 'upcoming';
}

/** Bracket view-model for any format (RR/Swiss produce one 'main' section of rounds). */
export function bracketVM(view: TournamentView, me: string | null): BracketVM {
  const people = indexParticipants(view);
  const sides = Boolean(GAME_CATALOG[view.config.gameId]?.tournament?.sides);
  const groups = new Map<string, { section: SectionId; round: number; bracket: string; matches: MatchVM[]; label: string }>();
  for (const m of view.matches) {
    const { section, round } = sectionOf(m, view.config.format);
    const key = `${section}-${round}`;
    let g = groups.get(key);
    if (!g) {
      g = { section, round, bracket: m.bracket, matches: [], label: m.roundLabel };
      groups.set(key, g);
    }
    const vm = matchVM(m, section, round, people, me, sides);
    // The bracket reset is fed by the grand final itself (drawn as a connector even when the server
    // leaves its feeder fields empty because its slots are filled conditionally).
    if (m.bracket === 'grand_final_reset' && vm.feeders.length === 0) {
      const gf = view.matches.find((x) => x.bracket === 'grand_final');
      if (gf) vm.feeders.push({ matchId: gf.id, take: 'winner', slot: 0 });
    }
    g.matches.push(vm);
  }
  const sections: SectionVM[] = [];
  for (const id of SECTION_ORDER) {
    const rounds = [...groups.entries()]
      .filter(([, g]) => g.section === id)
      .sort((a, b) => a[1].round - b[1].round)
      .map(([key, g]): RoundVM => {
        const server = view.rounds.find((r) => r.bracket === g.bracket && r.round === g.round);
        const matches = g.matches.sort((a, b) => a.order - b.order);
        return { key, section: id, round: g.round, label: server?.label || g.label, matches, state: roundState(matches, server?.status) };
      });
    if (rounds.length > 0) sections.push({ id, label: SECTION_LABELS[id], rounds });
  }
  return { sections };
}

export function standingsVM(view: TournamentView, me: string | null): StandingVM[] {
  const people = indexParticipants(view);
  return view.standings.rows.map((r) => {
    const p = people.get(r.participantId);
    return {
      rank: r.rank,
      shared: r.shared,
      participantId: r.participantId,
      name: p?.name ?? 'Unknown',
      seed: p && p.seed > 0 ? p.seed : null,
      points: r.points,
      played: r.played,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      byes: r.byes,
      tiebreaks: Object.fromEntries(Object.entries(r.tiebreaks).filter((e): e is [string, number] => typeof e[1] === 'number')),
      isMe: r.participantId === me,
      inactive: p ? p.status === 'withdrawn' || p.status === 'disqualified' || p.status === 'no_show' : false,
    };
  });
}

export function tiebreaksVM(view: TournamentView): TiebreakVM[] {
  return view.standings.tiebreaks.map((id) => TIEBREAKS[id]).filter(Boolean);
}

/** Round-robin crosstable: rows/cols in standings order (else seed order); cell = row player's result vs column player. */
export function crosstableVM(view: TournamentView): { ids: string[]; cells: Map<string, CrossCellVM> } {
  const ranked = view.standings.rows.map((r) => r.participantId);
  const ids = ranked.length > 0 ? ranked : view.participants.filter((p) => p.status !== 'no_show').map((p) => p.id);
  const cells = new Map<string, CrossCellVM>();
  for (const m of view.matches) {
    if (!m.aId || !m.bId) continue;
    const finished = m.status === 'COMPLETE' || m.status === 'FORFEIT';
    const status = matchStatusVM(m);
    for (const [row, col, mine, theirs] of [
      [m.aId, m.bId, m.aPoints, m.bPoints],
      [m.bId, m.aId, m.bPoints, m.aPoints],
    ] as const) {
      const result: CrossCellVM['result'] = !finished ? null : m.draw ? 'D' : m.winnerId === row ? 'W' : m.winnerId ? 'L' : null;
      cells.set(`${row}|${col}`, {
        matchId: m.id,
        result,
        score:
          finished && m.resultKind === 'played'
            ? `${formatPoints(mine)}–${formatPoints(theirs)}`
            : finished
              ? result === 'W'
                ? '+'
                : result === 'L'
                  ? '−'
                  : '='
              : null,
        status,
        round: m.round,
      });
    }
  }
  return { ids, cells };
}

/** The viewer's next relevant match (live/ready first, else the next waiting one), or null. */
export function nextMatchFor(view: TournamentView, participantId: string | null): TournamentMatchView | null {
  if (!participantId) return null;
  const mine = view.matches.filter((m) => m.aId === participantId || m.bId === participantId);
  return (
    mine.find((m) => m.status === 'IN_PROGRESS') ??
    mine.find((m) => m.status === 'READY') ??
    mine.find((m) => m.status === 'WAITING') ??
    null
  );
}

/** Upcoming match a participant is waiting on (e.g. "Winner of W2-1") — for "next opponent" text. */
export function opponentLabel(m: TournamentMatchView, participantId: string, people: ParticipantIndex): string {
  const oppId = m.aId === participantId ? m.bId : m.aId;
  if (oppId) return people.get(oppId)?.name ?? 'Unknown';
  return m.aId === participantId ? m.bLabel || 'TBD' : m.aLabel || 'TBD';
}
