/**
 * TournamentView fixtures (the server contract shape) for adapter tests and the dev-only gallery.
 * Brackets come from bracket/fixtures.ts; round robin uses the circle method; Swiss is a small,
 * hand-checked 8-player event. Not used in production code paths.
 */
import {
  FORMAT_TIEBREAKS,
  TIEBREAKS,
  defaultTournamentConfig,
  type GameId,
  type MatchStatus,
  type TournamentBracket,
  type TournamentFormat,
  type TournamentMatchView,
  type TournamentParticipantView,
  type TournamentStandingRow,
  type TournamentStatus,
  type TournamentView,
} from '@dascade/shared';
import { doubleElimFixture, singleElimFixture } from '../bracket/fixtures.ts';
import type { MatchVM } from '../bracket/types.ts';

const NAMES = [
  'Ada',
  'Brianna',
  'Chen',
  'Dmitri',
  'Esme',
  'Farouk',
  'Greta',
  'Hiro',
  'Imani',
  'Jonas',
  'Kaia',
  'Luis',
  'Mira',
  'Nnamdi',
  'Oona',
  'Pavel',
  'Quinn',
  'Rosa',
  'Sven',
  'Tamsin',
  'Uma',
  'Viktor',
  'Wren',
  'Xavi',
  'Yara',
  'Zeke',
  'Anouk',
  'Bodhi',
  'Cleo',
  'Dario',
  'Elif',
  'Finn',
];
const AVATARS = ['rocket', 'ghost', 'cat', 'robot', 'alien', 'crown', 'bolt', 'star'];

export function fixtureParticipants(n: number, status: TournamentParticipantView['status'] = 'active'): TournamentParticipantView[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: NAMES[i % NAMES.length]! + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ''),
    avatar: AVATARS[i % AVATARS.length]!,
    seed: i + 1,
    status,
    checkedIn: true,
    rating: 1650 - i * 23,
    provisional: i % 5 === 4,
    entry: i + 1,
    online: i % 3 !== 2,
    place: 0,
    points: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    byes: 0,
    currentMatchId: '',
  }));
}

function baseMatch(
  partial: Partial<TournamentMatchView> & Pick<TournamentMatchView, 'id' | 'bracket' | 'round' | 'order'>,
): TournamentMatchView {
  return {
    label: '',
    roundLabel: '',
    status: 'WAITING',
    aId: '',
    bId: '',
    aLabel: '',
    bLabel: '',
    aFrom: '',
    bFrom: '',
    aFromTake: '',
    bFromTake: '',
    nextMatchId: '',
    nextSlot: '',
    loserNextMatchId: '',
    loserNextSlot: '',
    conditional: false,
    bestOf: 1,
    gameNumber: 0,
    aPoints: 0,
    bPoints: 0,
    gamesJson: '[]',
    winnerId: '',
    loserId: '',
    draw: false,
    resultKind: '',
    resultNote: '',
    firstId: '',
    decider: '',
    roomCode: '',
    aPresent: false,
    bPresent: false,
    noShowAt: 0,
    startedAt: 0,
    completedAt: 0,
    ...partial,
  };
}

const STATUS_BACK: Record<MatchVM['status'], MatchStatus> = {
  waiting: 'WAITING',
  ready: 'READY',
  live: 'IN_PROGRESS',
  done: 'COMPLETE',
  forfeit: 'FORFEIT',
  void: 'VOID',
  bye: 'COMPLETE',
};

function fromVM(m: MatchVM, bracket: TournamentBracket): TournamentMatchView {
  const [a, b] = m.slots;
  const winner = a.isWinner ? a : b.isWinner ? b : null;
  const loser = a.isLoser ? a : b.isLoser ? b : null;
  const fa = m.feeders.find((f) => f.slot === 0);
  const fb = m.feeders.find((f) => f.slot === 1);
  return baseMatch({
    id: m.id,
    bracket,
    round: bracket === 'grand_final' || bracket === 'grand_final_reset' ? 1 : m.round,
    order: m.order,
    label: `${m.roundLabel} · Match ${m.order + 1}`,
    roundLabel: m.roundLabel,
    status: STATUS_BACK[m.status],
    aId: a.participantId ?? '',
    bId: b.participantId ?? '',
    aLabel: a.participantId ? `Seed ${a.seed}` : a.name,
    bLabel: b.participantId ? `Seed ${b.seed}` : b.name,
    aFrom: fa?.matchId ?? '',
    bFrom: fb?.matchId ?? '',
    aFromTake: fa?.take ?? '',
    bFromTake: fb?.take ?? '',
    conditional: bracket === 'grand_final_reset',
    gameNumber: m.status === 'live' ? 1 : m.status === 'done' ? 1 : 0,
    aPoints: a.score ?? 0,
    bPoints: b.score ?? 0,
    winnerId: winner?.participantId ?? '',
    loserId: loser?.participantId ?? '',
    resultKind: m.status === 'bye' ? 'bye' : m.status === 'done' ? 'played' : '',
    firstId: a.participantId ?? '',
    roomCode: m.roomCode ?? '',
    aPresent: m.status === 'live',
    bPresent: m.status === 'live',
  });
}

function shell(
  format: TournamentFormat,
  gameId: GameId,
  participants: TournamentParticipantView[],
  matches: TournamentMatchView[],
  status: TournamentStatus,
): TournamentView {
  const config = { ...defaultTournamentConfig(gameId), name: 'Friday Night Invitational', format, maxField: 32 };
  return {
    code: 'TRNMT',
    config,
    status,
    paused: false,
    organizerId: 'org',
    organizerName: 'Brian',
    seedingMethod: 'rating',
    currentRound: 2,
    totalRounds: 5,
    championId: null,
    checkInEndsAt: 0,
    createdAt: Date.UTC(2026, 8, 26, 17, 0),
    startedAt: Date.UTC(2026, 8, 26, 17, 30),
    completedAt: 0,
    participants,
    matches,
    rounds: [],
    standings: { format, tiebreaks: [...FORMAT_TIEBREAKS[format]], final: false, rows: [] },
    tiebreaks: FORMAT_TIEBREAKS[format].map((id) => TIEBREAKS[id]),
    audit: [
      { id: 1, at: Date.UTC(2026, 8, 26, 17, 0), actor: 'organizer', action: 'create', text: 'Brian created the tournament.' },
      { id: 2, at: Date.UTC(2026, 8, 26, 17, 30), actor: 'organizer', action: 'seed', text: 'Seeded by DASCADE rating.' },
      { id: 3, at: Date.UTC(2026, 8, 26, 17, 31), actor: 'system', action: 'begin', text: 'Round 1 started.' },
    ],
  };
}

export function singleElimView(n: number, decidedRounds = 1, gameId: GameId = 'chess'): TournamentView {
  const vm = singleElimFixture(n, decidedRounds);
  const matches = vm.sections.flatMap((s) => s.rounds.flatMap((r) => r.matches)).map((m) => fromVM(m, 'winners'));
  return shell('single_elimination', gameId, fixtureParticipants(n), matches, 'IN_PROGRESS');
}

export function doubleElimView(n: number, decidedWinnerRounds = 1, gameId: GameId = 'chess'): TournamentView {
  const vm = doubleElimFixture(n, decidedWinnerRounds);
  const matches: TournamentMatchView[] = [];
  for (const s of vm.sections)
    for (const r of s.rounds)
      for (const m of r.matches)
        matches.push(
          fromVM(m, s.id === 'losers' ? 'losers' : s.id === 'finals' ? (m.id === 'GF' ? 'grand_final' : 'grand_final_reset') : 'winners'),
        );
  return shell('double_elimination', gameId, fixtureParticipants(n), matches, 'IN_PROGRESS');
}

/** Circle-method round robin; the first `playedRounds` rounds are decided (lower seed wins, every 4th match drawn). */
export function roundRobinView(n: number, playedRounds = 2, gameId: GameId = 'chess'): TournamentView {
  const people = fixtureParticipants(n);
  const ids = people.map((p) => p.id);
  if (ids.length % 2) ids.push('');
  const rounds = ids.length - 1;
  const matches: TournamentMatchView[] = [];
  const pts = new Map<string, { points: number; w: number; d: number; l: number; played: number; byes: number }>(
    people.map((p) => [p.id, { points: 0, w: 0, d: 0, l: 0, played: 0, byes: 0 }]),
  );
  let rot = [...ids];
  for (let r = 1; r <= rounds; r++) {
    let order = 0;
    for (let i = 0; i < rot.length / 2; i++) {
      const a = rot[i]!;
      const b = rot[rot.length - 1 - i]!;
      if (!a || !b) {
        const who = a || b;
        if (r <= playedRounds) pts.get(who)!.byes++;
        continue;
      }
      const decided = r <= playedRounds;
      const drawn = decided && (r + i) % 4 === 0;
      const aWins = Number(a.slice(1)) < Number(b.slice(1));
      const m = baseMatch({
        id: `R${r}-${order + 1}`,
        bracket: 'main',
        round: r,
        order: order++,
        label: `Round ${r} · Board ${order}`,
        roundLabel: `Round ${r}`,
        status: decided ? 'COMPLETE' : r === playedRounds + 1 ? (order % 2 ? 'IN_PROGRESS' : 'READY') : 'WAITING',
        aId: a,
        bId: b,
        aPoints: decided ? (drawn ? 0.5 : aWins ? 1 : 0) : 0,
        bPoints: decided ? (drawn ? 0.5 : aWins ? 0 : 1) : 0,
        winnerId: decided && !drawn ? (aWins ? a : b) : '',
        loserId: decided && !drawn ? (aWins ? b : a) : '',
        draw: drawn,
        resultKind: decided ? 'played' : '',
        firstId: r % 2 ? a : b,
        roomCode: r === playedRounds + 1 && order % 2 ? `LV${r}${order}` : '',
        gameNumber: decided ? 1 : 0,
      });
      matches.push(m);
      if (decided) {
        const sa = pts.get(a)!;
        const sb = pts.get(b)!;
        sa.played++;
        sb.played++;
        if (drawn) {
          sa.points += 0.5;
          sb.points += 0.5;
          sa.d++;
          sb.d++;
        } else {
          const [w, l] = aWins ? [sa, sb] : [sb, sa];
          w.points++;
          w.w++;
          l.l++;
        }
      }
    }
    rot = [rot[0]!, rot[rot.length - 1]!, ...rot.slice(1, -1)];
  }
  const view = shell('round_robin', gameId, people, matches, 'IN_PROGRESS');
  view.rounds = Array.from({ length: rounds }, (_, i) => ({
    bracket: 'main' as const,
    round: i + 1,
    label: `Round ${i + 1}`,
    status: i + 1 <= playedRounds ? ('complete' as const) : i + 1 === playedRounds + 1 ? ('active' as const) : ('pending' as const),
    byeId: '',
  }));
  view.standings.rows = standingRows(pts, ['direct_encounter', 'wins', 'sonneborn_berger']);
  view.currentRound = playedRounds + 1;
  view.totalRounds = rounds;
  return view;
}

function standingRows(
  pts: Map<string, { points: number; w: number; d: number; l: number; played: number; byes: number }>,
  tbs: string[],
): TournamentStandingRow[] {
  const rows = [...pts.entries()].sort((a, b) => b[1].points - a[1].points || Number(a[0].slice(1)) - Number(b[0].slice(1)));
  let prev = -1;
  let rank = 0;
  return rows.map(([id, s], i) => {
    if (s.points !== prev) rank = i + 1;
    const shared = s.points === prev;
    prev = s.points;
    return {
      participantId: id,
      rank,
      shared,
      points: s.points,
      played: s.played,
      wins: s.w,
      draws: s.d,
      losses: s.l,
      byes: s.byes,
      gamePoints: s.points,
      tiebreaks: Object.fromEntries(tbs.map((t, j) => [t, Math.max(0, s.points * (3 - j) + (s.w % 3) + (j === 0 ? 0.5 : 0))])),
      eliminatedIn: '',
    };
  });
}

/** Swiss: `n` players (odd n gets a bye each round), `played` rounds decided of `total`. */
export function swissView(n = 9, played = 2, total = 4, gameId: GameId = 'chess'): TournamentView {
  const people = fixtureParticipants(n);
  const pts = new Map(people.map((p) => [p.id, { points: 0, w: 0, d: 0, l: 0, played: 0, byes: 0 }]));
  const matches: TournamentMatchView[] = [];
  const rounds = [];
  for (let r = 1; r <= Math.min(total, played + 1); r++) {
    const ranked = [...pts.entries()]
      .sort((a, b) => b[1].points - a[1].points || Number(a[0].slice(1)) - Number(b[0].slice(1)))
      .map(([id]) => id);
    let byeId = '';
    if (ranked.length % 2) byeId = ranked.pop()!;
    const decided = r <= played;
    if (byeId && decided) {
      const s = pts.get(byeId)!;
      s.points++;
      s.byes++;
    }
    for (let i = 0; i < ranked.length / 2; i++) {
      const a = ranked[(i + r) % ranked.length]!;
      const b = ranked[(i + r + ranked.length / 2) % ranked.length]!;
      const drawn = decided && (i + r) % 3 === 0;
      const aWins = Number(a.slice(1)) < Number(b.slice(1));
      matches.push(
        baseMatch({
          id: `S${r}-${i + 1}`,
          bracket: 'main',
          round: r,
          order: i,
          label: `Swiss round ${r} · Board ${i + 1}`,
          roundLabel: `Swiss round ${r}`,
          status: decided ? 'COMPLETE' : i % 2 ? 'READY' : 'IN_PROGRESS',
          aId: a,
          bId: b,
          aPoints: decided ? (drawn ? 0.5 : aWins ? 1 : 0) : 0,
          bPoints: decided ? (drawn ? 0.5 : aWins ? 0 : 1) : 0,
          winnerId: decided && !drawn ? (aWins ? a : b) : '',
          loserId: decided && !drawn ? (aWins ? b : a) : '',
          draw: drawn,
          resultKind: decided ? 'played' : '',
          firstId: i % 2 ? b : a,
          roomCode: !decided && i % 2 === 0 ? `SW${i}` : '',
          gameNumber: decided ? 1 : 1,
        }),
      );
      if (decided) {
        const sa = pts.get(a)!;
        const sb = pts.get(b)!;
        sa.played++;
        sb.played++;
        if (drawn) {
          sa.points += 0.5;
          sb.points += 0.5;
          sa.d++;
          sb.d++;
        } else {
          const [w, l] = aWins ? [sa, sb] : [sb, sa];
          w.points++;
          w.w++;
          l.l++;
        }
      }
    }
    rounds.push({
      bracket: 'main' as const,
      round: r,
      label: `Swiss round ${r}`,
      status: decided ? ('complete' as const) : ('active' as const),
      byeId,
    });
  }
  const view = shell('swiss', gameId, people, matches, 'IN_PROGRESS');
  view.rounds = rounds;
  view.standings.rows = standingRows(pts, [...FORMAT_TIEBREAKS.swiss]);
  view.currentRound = played + 1;
  view.totalRounds = total;
  return view;
}

/** Registration open: `n` players registered (some checked in), no draw yet. */
export function registrationView(n = 6, status: TournamentStatus = 'REGISTRATION', gameId: GameId = 'chess'): TournamentView {
  const people = fixtureParticipants(n, 'registered').map((p, i) => ({
    ...p,
    seed: 0,
    checkedIn: status === 'CHECK_IN' && i % 2 === 0,
    status: (status === 'CHECK_IN' && i % 2 === 0 ? 'checked_in' : 'registered') as TournamentParticipantView['status'],
  }));
  const view = shell('single_elimination', gameId, people, [], status);
  view.config = { ...view.config, checkIn: true, checkInMinutes: 10 };
  view.seedingMethod = '';
  view.checkInEndsAt = status === 'CHECK_IN' ? Date.now() + 7 * 60_000 : 0;
  view.currentRound = 0;
  view.totalRounds = 0;
  view.startedAt = 0;
  return view;
}

/** A finished 8-player single elimination with a champion and placements. */
export function completeView(): TournamentView {
  const view = singleElimView(8, 3);
  view.status = 'COMPLETE';
  view.completedAt = Date.UTC(2026, 8, 26, 19, 0);
  view.championId = 'p1';
  const place: Record<string, number> = { p1: 1, p2: 2, p3: 3, p4: 3, p5: 5, p6: 5, p7: 5, p8: 5 };
  view.participants = view.participants.map((p) => ({
    ...p,
    place: place[p.id] ?? 0,
    status: p.id === 'p1' ? 'champion' : 'eliminated',
    wins: p.id === 'p1' ? 3 : p.id === 'p2' ? 2 : p.id === 'p3' || p.id === 'p4' ? 1 : 0,
    losses: p.id === 'p1' ? 0 : 1,
  }));
  view.standings = {
    format: 'single_elimination',
    tiebreaks: [],
    final: true,
    rows: view.participants.map((p) => ({
      participantId: p.id,
      rank: p.place,
      shared: p.place === 3 || p.place === 5,
      points: p.wins,
      played: p.wins + p.losses,
      wins: p.wins,
      draws: 0,
      losses: p.losses,
      byes: 0,
      gamePoints: p.wins,
      tiebreaks: {},
      eliminatedIn: p.place === 2 ? 'Final' : p.place === 3 ? 'Semifinals' : p.place === 5 ? 'Quarterfinals' : '',
    })),
  };
  return view;
}
