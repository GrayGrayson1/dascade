/**
 * Deterministic bracket view-models for unit tests and the dev-only bracket gallery.
 * (The real brackets come from the server's tournament engine through adapt.ts.)
 */
import type { BracketVM, FeederVM, MatchStatusVM, MatchVM, RoundVM, SectionId, SlotVM } from './types.ts';

function emptySlot(name = 'TBD'): SlotVM {
  return {
    participantId: null,
    name,
    seed: null,
    score: null,
    isWinner: false,
    isLoser: false,
    placeholder: true,
    isBye: false,
    isMe: false,
  };
}

function playerSlot(seed: number): SlotVM {
  return {
    participantId: `p${seed}`,
    name: `Player ${seed}`,
    seed,
    score: null,
    isWinner: false,
    isLoser: false,
    placeholder: false,
    isBye: false,
    isMe: false,
  };
}

function byeSlot(): SlotVM {
  return { ...emptySlot('Bye'), isBye: true };
}

/** Standard seeding order for a bracket of `size` (1 v size, 2 v size-1 … arranged so top seeds meet last). */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/** Server-style match ids: W1-3 (winners/main round 1, 3rd match), L2-1, GF, GF2. */
export function fixtureId(section: SectionId, round: number, order: number): string {
  if (section === 'finals') return round === 1 ? 'GF' : 'GF2';
  return `${section === 'losers' ? 'L' : 'W'}${round}-${order + 1}`;
}

function match(
  section: SectionId,
  round: number,
  order: number,
  roundLabel: string,
  slots: [SlotVM, SlotVM],
  feeders: FeederVM[] = [],
): MatchVM {
  const id = fixtureId(section, round, order);
  return {
    id,
    code: id,
    roundLabel,
    section,
    round,
    order,
    status: 'waiting',
    slots,
    bestOf: 1,
    gameNumber: 1,
    note: null,
    roomCode: null,
    feeders,
    involvesMe: false,
  };
}

const W = (round: number, order: number) => fixtureId('winners', round, order);
const L = (round: number, order: number) => fixtureId('losers', round, order);

/**
 * Resolve matches in dependency order: the lower seed number wins. `decide(m)` says whether a
 * playable match is finished; the first undecided playable match of each round is live.
 */
function resolve(all: MatchVM[], decide: (m: MatchVM) => boolean): void {
  const results = new Map<string, { winner: SlotVM; loser: SlotVM }>();
  const done = new Set<string>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const m of all) {
      if (done.has(m.id)) continue;
      if (m.feeders.some((f) => !done.has(f.matchId) && all.some((x) => x.id === f.matchId))) continue;
      done.add(m.id);
      progress = true;
      m.feeders.forEach((f) => {
        const r = results.get(f.matchId);
        if (r) m.slots[f.slot] = { ...(f.take === 'winner' ? r.winner : r.loser), score: null, isWinner: false, isLoser: false };
      });
      const [a, b] = m.slots;
      if (a.isBye || b.isBye) {
        const w = a.isBye ? b : a;
        if (!w.placeholder) {
          m.status = 'bye';
          m.note = 'Bye';
          results.set(m.id, { winner: w, loser: a.isBye ? a : b });
        }
        continue;
      }
      if (a.placeholder || b.placeholder) continue;
      if (decide(m)) {
        const aWins = (a.seed ?? 99) < (b.seed ?? 99);
        m.status = 'done';
        m.slots = [
          { ...a, isWinner: aWins, isLoser: !aWins, score: aWins ? 1 : 0 },
          { ...b, isWinner: !aWins, isLoser: aWins, score: aWins ? 0 : 1 },
        ];
        results.set(m.id, { winner: aWins ? a : b, loser: aWins ? b : a });
      } else {
        m.status = m.order % 2 === 0 ? 'live' : 'ready';
        if (m.status === 'live') {
          m.roomCode = 'LIVE1';
          m.slots = [
            { ...a, score: 0 },
            { ...b, score: 0 },
          ];
        }
      }
    }
  }
}

function rounds(section: SectionId, matches: MatchVM[], labels: (round: number, total: number) => string): RoundVM[] {
  const total = Math.max(0, ...matches.map((m) => m.round));
  const out: RoundVM[] = [];
  for (let r = 1; r <= total; r++) {
    const ms = matches.filter((m) => m.round === r).sort((a, b) => a.order - b.order);
    const state: MatchStatusVM[] = ms.map((m) => m.status);
    out.push({
      key: `${section}-${r}`,
      section,
      round: r,
      label: labels(r, total),
      matches: ms,
      state: state.every((s) => s === 'done' || s === 'bye' || s === 'forfeit')
        ? 'done'
        : state.some((s) => s === 'live' || s === 'ready')
          ? 'live'
          : 'upcoming',
    });
  }
  return out;
}

const seLabel = (r: number, total: number) =>
  r === total ? 'Final' : r === total - 1 ? 'Semifinals' : r === total - 2 ? 'Quarterfinals' : `Round ${r}`;

/** Single elimination for `n` participants (byes for the top seeds when n isn't a power of two). */
export function singleElimFixture(n: number, decidedRounds = 0): BracketVM {
  const size = 2 ** Math.ceil(Math.log2(Math.max(2, n)));
  const order = seedOrder(size);
  const all: MatchVM[] = [];
  const total = Math.log2(size);
  for (let i = 0; i < size / 2; i++) {
    const a = order[2 * i]!;
    const b = order[2 * i + 1]!;
    all.push(match('main', 1, i, seLabel(1, total), [a <= n ? playerSlot(a) : byeSlot(), b <= n ? playerSlot(b) : byeSlot()]));
  }
  for (let r = 2; r <= total; r++) {
    const count = size / 2 ** r;
    for (let i = 0; i < count; i++) {
      const f1 = W(r - 1, 2 * i);
      const f2 = W(r - 1, 2 * i + 1);
      all.push(
        match(
          'main',
          r,
          i,
          seLabel(r, total),
          [emptySlot(`Winner of ${f1}`), emptySlot(`Winner of ${f2}`)],
          [
            { matchId: f1, take: 'winner', slot: 0 },
            { matchId: f2, take: 'winner', slot: 1 },
          ],
        ),
      );
    }
  }
  resolve(all, (m) => m.round <= decidedRounds);
  return { sections: [{ id: 'main', label: 'Bracket', rounds: rounds('main', all, seLabel) }] };
}

/** Double elimination for a power-of-two field `n` ≥ 4, with grand final + reset. */
export function doubleElimFixture(n: number, decidedWinnerRounds = 0): BracketVM {
  const k = Math.log2(n);
  const order = seedOrder(n);
  const wb: MatchVM[] = [];
  for (let i = 0; i < n / 2; i++) wb.push(match('winners', 1, i, 'Winners 1', [playerSlot(order[2 * i]!), playerSlot(order[2 * i + 1]!)]));
  for (let r = 2; r <= k; r++) {
    for (let i = 0; i < n / 2 ** r; i++) {
      wb.push(
        match(
          'winners',
          r,
          i,
          r === k ? 'Winners final' : `Winners ${r}`,
          [emptySlot(`Winner of ${W(r - 1, 2 * i)}`), emptySlot(`Winner of ${W(r - 1, 2 * i + 1)}`)],
          [
            { matchId: W(r - 1, 2 * i), take: 'winner', slot: 0 },
            { matchId: W(r - 1, 2 * i + 1), take: 'winner', slot: 1 },
          ],
        ),
      );
    }
  }
  const lb: MatchVM[] = [];
  const lbRounds = 2 * (k - 1);
  const lbLabel = (r: number) => (r === lbRounds ? 'Losers final' : `Losers ${r}`);
  for (let i = 0; i < n / 4; i++) {
    lb.push(
      match(
        'losers',
        1,
        i,
        lbLabel(1),
        [emptySlot(`Loser of ${W(1, 2 * i)}`), emptySlot(`Loser of ${W(1, 2 * i + 1)}`)],
        [
          { matchId: W(1, 2 * i), take: 'loser', slot: 0 },
          { matchId: W(1, 2 * i + 1), take: 'loser', slot: 1 },
        ],
      ),
    );
  }
  for (let r = 2; r <= lbRounds; r++) {
    const j = Math.floor(r / 2);
    if (r % 2 === 0) {
      const count = n / 2 ** (j + 1);
      for (let i = 0; i < count; i++) {
        const wbMatch = count - 1 - i;
        lb.push(
          match(
            'losers',
            r,
            i,
            lbLabel(r),
            [emptySlot(`Winner of ${L(r - 1, i)}`), emptySlot(`Loser of ${W(j + 1, wbMatch)}`)],
            [
              { matchId: L(r - 1, i), take: 'winner', slot: 0 },
              { matchId: W(j + 1, wbMatch), take: 'loser', slot: 1 },
            ],
          ),
        );
      }
    } else {
      const count = n / 2 ** (j + 2);
      for (let i = 0; i < count; i++) {
        lb.push(
          match(
            'losers',
            r,
            i,
            lbLabel(r),
            [emptySlot(`Winner of ${L(r - 1, 2 * i)}`), emptySlot(`Winner of ${L(r - 1, 2 * i + 1)}`)],
            [
              { matchId: L(r - 1, 2 * i), take: 'winner', slot: 0 },
              { matchId: L(r - 1, 2 * i + 1), take: 'winner', slot: 1 },
            ],
          ),
        );
      }
    }
  }
  const gf = match(
    'finals',
    1,
    0,
    'Grand final',
    [emptySlot(`Winner of ${W(k, 0)}`), emptySlot(`Winner of ${L(lbRounds, 0)}`)],
    [
      { matchId: W(k, 0), take: 'winner', slot: 0 },
      { matchId: L(lbRounds, 0), take: 'winner', slot: 1 },
    ],
  );
  const reset = match(
    'finals',
    2,
    0,
    'Bracket reset',
    [emptySlot('If needed'), emptySlot('If needed')],
    [{ matchId: gf.id, take: 'winner', slot: 0 }],
  );
  resolve([...wb, ...lb, gf, reset], (m) =>
    m.section === 'winners'
      ? m.round <= decidedWinnerRounds
      : m.section === 'losers'
        ? m.round <= Math.max(0, decidedWinnerRounds * 2 - 2)
        : false,
  );
  return {
    sections: [
      { id: 'winners', label: 'Winners bracket', rounds: rounds('winners', wb, (r) => (r === k ? 'Winners final' : `Winners ${r}`)) },
      { id: 'losers', label: 'Losers bracket', rounds: rounds('losers', lb, lbLabel) },
      { id: 'finals', label: 'Finals', rounds: rounds('finals', [gf, reset], (r) => (r === 1 ? 'Grand final' : 'Reset')) },
    ],
  };
}
