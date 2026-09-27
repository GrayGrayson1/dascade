import { describe, expect, it } from 'vitest';
import type { TournamentMatchView } from '@dascade/shared';
import {
  bracketVM,
  crosstableVM,
  matchNote,
  matchStatusVM,
  nextMatchFor,
  opponentLabel,
  indexParticipants,
  standingsVM,
  tiebreaksVM,
} from './adapt.ts';
import { layoutBracket } from './bracket/layout.ts';
import { doubleElimView, roundRobinView, singleElimView, swissView } from './dev/viewFixtures.ts';

describe('match status and notes', () => {
  const m = (p: Partial<TournamentMatchView>) =>
    ({
      status: 'COMPLETE',
      resultKind: 'played',
      decider: '',
      conditional: false,
      draw: false,
      resultNote: '',
      ...p,
    }) as TournamentMatchView;
  it('maps server statuses', () => {
    expect(matchStatusVM(m({ status: 'WAITING' }))).toBe('waiting');
    expect(matchStatusVM(m({ status: 'READY' }))).toBe('ready');
    expect(matchStatusVM(m({ status: 'IN_PROGRESS' }))).toBe('live');
    expect(matchStatusVM(m({ status: 'COMPLETE' }))).toBe('done');
    expect(matchStatusVM(m({ status: 'COMPLETE', resultKind: 'bye' }))).toBe('bye');
    expect(matchStatusVM(m({ status: 'FORFEIT', resultKind: 'forfeit' }))).toBe('forfeit');
    expect(matchStatusVM(m({ status: 'VOID' }))).toBe('void');
  });
  it('explains unusual results', () => {
    expect(matchNote(m({ status: 'IN_PROGRESS', decider: 'armageddon' }))).toBe('Armageddon');
    expect(matchNote(m({ status: 'IN_PROGRESS', decider: 'sudden_death' }))).toBe('Decider');
    expect(matchNote(m({ status: 'VOID', conditional: true }))).toBe('Not needed');
    expect(matchNote(m({ status: 'WAITING', conditional: true }))).toBe('If needed');
    expect(matchNote(m({ draw: true }))).toBe('Draw');
    expect(matchNote(m({ resultKind: 'override' }))).toBe('Organizer decision');
    expect(matchNote(m({ status: 'FORFEIT', resultKind: 'forfeit', resultNote: 'No-show' }))).toBe('No-show');
    expect(matchNote(m({ resultKind: 'lots' }))).toBe('Decided by lot');
    expect(matchNote(m({}))).toBeNull();
  });
});

describe('bracket view-model', () => {
  it('single elimination → one "main" band, codes match server ids, connectors from feeders', () => {
    const view = singleElimView(8, 1);
    const vm = bracketVM(view, 'p1');
    expect(vm.sections.map((s) => s.id)).toEqual(['main']);
    const rounds = vm.sections[0]!.rounds;
    expect(rounds.map((r) => r.matches.length)).toEqual([4, 2, 1]);
    const final = rounds[2]!.matches[0]!;
    expect(final.code).toBe('W3-1');
    expect(final.feeders).toEqual([
      { matchId: 'W2-1', take: 'winner', slot: 0 },
      { matchId: 'W2-2', take: 'winner', slot: 1 },
    ]);
    const layout = layoutBracket(vm);
    expect(layout.connectors).toHaveLength(6);
  });

  it('marks the viewer, winners, placeholders and sides', () => {
    const vm = bracketVM(singleElimView(8, 1), 'p1');
    const [r1, r2] = vm.sections[0]!.rounds;
    const first = r1!.matches[0]!;
    expect(first.involvesMe).toBe(true);
    expect(first.slots[0]).toMatchObject({
      participantId: 'p1',
      name: 'Ada',
      seed: 1,
      isMe: true,
      isWinner: true,
      score: 1,
      side: 'first',
    });
    expect(first.slots[1]).toMatchObject({ participantId: 'p8', isLoser: true, side: 'second' });
    const semi = r2!.matches[0]!;
    expect(semi.slots[0].name).toBe('Ada');
    const final = vm.sections[0]!.rounds[2]!.matches[0]!;
    expect(final.slots[0]).toMatchObject({ placeholder: true, name: 'Winner of W2-1', participantId: null });
  });

  it('hides the meaningless 0–0 of a result decided without play', () => {
    const view = singleElimView(4, 1);
    const m = view.matches.find((x) => x.id === 'W1-1')!;
    Object.assign(m, { status: 'COMPLETE', resultKind: 'override', aPoints: 0, bPoints: 0, winnerId: m.aId, loserId: m.bId });
    const card = bracketVM(view, null).sections[0]!.rounds[0]!.matches[0]!;
    expect(card.slots.map((s) => s.score)).toEqual([null, null]);
    expect(card.slots[0].isWinner).toBe(true);
    expect(card.note).toBe('Organizer decision');
  });

  it('shows byes for a non power-of-two field', () => {
    const vm = bracketVM(singleElimView(6, 0), null);
    const byes = vm.sections[0]!.rounds[0]!.matches.filter((m) => m.status === 'bye');
    expect(byes).toHaveLength(2);
    for (const b of byes) expect(b.slots.some((s) => s.isBye)).toBe(true);
  });

  it('double elimination → winners, losers and finals (grand final + reset)', () => {
    const vm = bracketVM(doubleElimView(8, 1), null);
    expect(vm.sections.map((s) => s.id)).toEqual(['winners', 'losers', 'finals']);
    const finals = vm.sections[2]!.rounds;
    expect(finals.map((r) => r.matches[0]!.code)).toEqual(['GF', 'GF2']);
    expect(finals[1]!.matches[0]!.note).toBe('If needed');
    const layout = layoutBracket(vm);
    expect(Object.keys(layout.boxes)).toHaveLength(vm.sections.flatMap((s) => s.rounds.flatMap((r) => r.matches)).length);
  });

  it('connects the bracket reset to the grand final even without feeder fields', () => {
    const view = doubleElimView(4, 0);
    const gf2 = view.matches.find((m) => m.bracket === 'grand_final_reset')!;
    gf2.aFrom = '';
    gf2.bFrom = '';
    const vm = bracketVM(view, null);
    const reset = vm.sections.find((s) => s.id === 'finals')!.rounds[1]!.matches[0]!;
    expect(reset.feeders).toEqual([{ matchId: 'GF', take: 'winner', slot: 0 }]);
    expect(layoutBracket(vm).connectors.some((c) => c.from === 'GF' && c.to === 'GF2')).toBe(true);
  });

  it('round state follows the server rounds when present', () => {
    const view = roundRobinView(6, 2);
    const vm = bracketVM(view, null);
    expect(vm.sections[0]!.rounds.map((r) => r.state)).toEqual(['done', 'done', 'live', 'upcoming', 'upcoming']);
  });
});

describe('standings and crosstable', () => {
  it('builds standings with names, tiebreak values and the viewer flag', () => {
    const view = swissView(9, 2, 4);
    const rows = standingsVM(view, 'p2');
    expect(rows).toHaveLength(9);
    expect(rows.find((r) => r.participantId === 'p2')!.isMe).toBe(true);
    expect(Object.keys(rows[0]!.tiebreaks)).toEqual([
      'buchholz_cut1',
      'buchholz',
      'sonneborn_berger',
      'direct_encounter',
      'wins',
      'progressive',
    ]);
    expect(tiebreaksVM(view).map((t) => t.short)).toEqual(['BH-C1', 'BH', 'SB', 'H2H', 'W', 'Prog']);
    for (const t of tiebreaksVM(view)) expect(t.explanation.length).toBeGreaterThan(20);
  });

  it('crosstable cells are mirrored from each player’s perspective', () => {
    const view = roundRobinView(5, 5);
    const { ids, cells } = crosstableVM(view);
    expect(ids).toHaveLength(5);
    let pairs = 0;
    for (const a of ids)
      for (const b of ids) {
        if (a === b) {
          expect(cells.get(`${a}|${b}`)).toBeUndefined();
          continue;
        }
        const ab = cells.get(`${a}|${b}`)!;
        const ba = cells.get(`${b}|${a}`)!;
        expect(ab.matchId).toBe(ba.matchId);
        const mirror = { W: 'L', L: 'W', D: 'D' } as const;
        expect(ba.result).toBe(ab.result ? mirror[ab.result] : null);
        pairs++;
      }
    // Every pair meets exactly once.
    expect(pairs).toBe(5 * 4);
  });

  it('crosstable leaves unplayed cells empty', () => {
    const { cells } = crosstableVM(roundRobinView(4, 0));
    for (const c of cells.values()) expect(c.result).toBeNull();
  });
});

describe('next match helpers', () => {
  it('prefers a live match, then ready, then waiting', () => {
    const view = singleElimView(8, 1);
    const next = nextMatchFor(view, 'p1');
    expect(next?.id).toBe('W2-1');
    expect(opponentLabel(next!, 'p1', indexParticipants(view))).toBe('Dmitri');
    expect(nextMatchFor(view, null)).toBeNull();
    // Player 8 lost in round 1: no further matches.
    expect(nextMatchFor(view, 'p8')).toBeNull();
  });

  it('names the pending feeder when the opponent is not known yet', () => {
    const view = singleElimView(8, 1);
    const final = view.matches.find((m) => m.id === 'W3-1')!;
    const withMe = { ...final, aId: 'p1' };
    expect(opponentLabel(withMe, 'p1', indexParticipants(view))).toBe('Winner of W2-2');
  });
});
