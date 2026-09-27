import { describe, expect, it } from 'vitest';
import { DEFAULT_DIMS, layoutBracket, slotY, type Box } from './layout.ts';
import { doubleElimFixture, seedOrder, singleElimFixture } from './fixtures.ts';
import type { BracketVM } from './types.ts';

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function assertNoOverlap(boxes: Box[]): void {
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!), `${boxes[i]!.id} vs ${boxes[j]!.id}`).toBe(false);
}

const centre = (b: Box) => b.y + b.h / 2;

describe('seed order', () => {
  it('pairs 1 v N and keeps top seeds apart', () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    for (const n of [2, 4, 8, 16, 32, 64]) {
      const o = seedOrder(n);
      expect(new Set(o).size).toBe(n);
      for (let i = 0; i < n; i += 2) expect(o[i]! + o[i + 1]!).toBe(n + 1);
    }
  });
});

describe('single elimination layout', () => {
  it.each([2, 3, 4, 5, 8, 12, 16, 32, 64])('%i players: every match placed once, no overlaps, inside the canvas', (n) => {
    const vm = singleElimFixture(n, 1);
    const layout = layoutBracket(vm);
    const matches = vm.sections.flatMap((s) => s.rounds.flatMap((r) => r.matches));
    expect(Object.keys(layout.boxes)).toHaveLength(matches.length);
    const boxes = Object.values(layout.boxes);
    assertNoOverlap(boxes);
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(DEFAULT_DIMS.headerH);
      expect(b.x + b.w).toBeLessThanOrEqual(layout.width);
      expect(b.y + b.h).toBeLessThanOrEqual(layout.height);
    }
  });

  it('centres each later match between the two matches that feed it', () => {
    const vm = singleElimFixture(16);
    const layout = layoutBracket(vm);
    for (const round of vm.sections[0]!.rounds.slice(1)) {
      for (const m of round.matches) {
        const [a, b] = m.feeders.map((f) => layout.boxes[f.matchId]!);
        expect(centre(layout.boxes[m.id]!)).toBeCloseTo((centre(a!) + centre(b!)) / 2, 0);
      }
    }
  });

  it('puts round n in column n and emits one header per round', () => {
    const vm = singleElimFixture(8);
    const layout = layoutBracket(vm);
    const col = DEFAULT_DIMS.cardW + DEFAULT_DIMS.gapX;
    for (const round of vm.sections[0]!.rounds) for (const m of round.matches) expect(layout.boxes[m.id]!.x).toBe((round.round - 1) * col);
    expect(layout.headers.map((h) => h.label)).toEqual(['Quarterfinals', 'Semifinals', 'Final']);
    expect(layout.width).toBe(3 * col - DEFAULT_DIMS.gapX);
  });

  it('draws one connector per winner path, ending at the right slot', () => {
    const vm = singleElimFixture(8, 1);
    const layout = layoutBracket(vm);
    // 4 + 2 + 1 matches → 6 winner paths.
    expect(layout.connectors).toHaveLength(6);
    for (const c of layout.connectors) {
      const to = layout.boxes[c.to]!;
      expect(c.d.endsWith(`V${slotY(to, c.slot)}H${to.x}`) || c.d.endsWith(`H${to.x}`)).toBe(true);
    }
    // First-round results are decided → connectors out of round 1 are solid.
    const fromR1 = layout.connectors.filter((c) => c.from.startsWith('W1-'));
    expect(fromR1.every((c) => c.decided)).toBe(true);
    expect(layout.connectors.filter((c) => c.from.startsWith('W2-')).every((c) => !c.decided)).toBe(true);
  });

  it('keeps bye matches in the layout (first round) and marks them', () => {
    const vm = singleElimFixture(5);
    const r1 = vm.sections[0]!.rounds[0]!.matches;
    expect(r1.filter((m) => m.status === 'bye')).toHaveLength(3);
    const layout = layoutBracket(vm);
    for (const m of r1) expect(layout.boxes[m.id]).toBeDefined();
  });
});

describe('double elimination layout', () => {
  it.each([4, 8, 16, 32])('%i players: winners above losers, finals to the right, no overlaps', (n) => {
    const vm = doubleElimFixture(n, 1);
    const layout = layoutBracket(vm);
    const boxes = Object.values(layout.boxes);
    assertNoOverlap(boxes);
    const winners = boxes.filter((b) => b.section === 'winners');
    const losers = boxes.filter((b) => b.section === 'losers');
    const finals = boxes.filter((b) => b.section === 'finals');
    expect(Math.max(...winners.map((b) => b.y + b.h))).toBeLessThan(Math.min(...losers.map((b) => b.y)));
    const rightmostTree = Math.max(...[...winners, ...losers].map((b) => b.x + b.w));
    for (const f of finals) expect(f.x).toBeGreaterThan(rightmostTree);
    expect(layout.bands.map((b) => b.id)).toEqual(['winners', 'losers', 'finals']);
  });

  it('centres the grand final between the winners final and the losers final', () => {
    const vm = doubleElimFixture(8);
    const layout = layoutBracket(vm);
    const wf = layout.boxes['W3-1']!;
    const lf = layout.boxes['L4-1']!;
    const gf = layout.boxes['GF']!;
    expect(centre(gf)).toBeCloseTo((centre(wf) + centre(lf)) / 2, 0);
    // The reset sits level with the grand final, one column further right.
    const reset = layout.boxes['GF2']!;
    expect(reset.y).toBe(gf.y);
    expect(reset.x).toBeGreaterThan(gf.x);
  });

  it('does not draw loser drops, but does draw both finals feeders', () => {
    const vm = doubleElimFixture(8);
    const layout = layoutBracket(vm);
    for (const c of layout.connectors) {
      const from = layout.boxes[c.from]!;
      const to = layout.boxes[c.to]!;
      if (to.section !== 'finals') expect(from.section).toBe(to.section);
    }
    const intoGf = layout.connectors
      .filter((c) => c.to === 'GF')
      .map((c) => c.from)
      .sort();
    expect(intoGf).toEqual(['L4-1', 'W3-1']);
  });

  it('aligns a losers-bracket minor-round match with its in-bracket feeder', () => {
    const vm = doubleElimFixture(8);
    const layout = layoutBracket(vm);
    // L2 matches take one L1 winner (in-bracket) + one winners-bracket loser (drop-in).
    for (const m of vm.sections[1]!.rounds[1]!.matches) {
      const inBand = m.feeders.find((f) => f.matchId.startsWith('L'))!;
      expect(layout.boxes[m.id]!.y).toBe(layout.boxes[inBand.matchId]!.y);
    }
  });
});

describe('degenerate input', () => {
  it('handles an empty bracket', () => {
    const layout = layoutBracket({ sections: [] } as BracketVM);
    expect(layout).toMatchObject({ width: 0, height: 0, connectors: [], bands: [] });
  });
  it('marks connectors on the viewer’s path', () => {
    const vm = singleElimFixture(4, 1);
    const r1 = vm.sections[0]!.rounds[0]!.matches[0]!;
    const final = vm.sections[0]!.rounds[1]!.matches[0]!;
    r1.involvesMe = true;
    final.involvesMe = true;
    const layout = layoutBracket(vm);
    expect(layout.connectors.filter((c) => c.mine).map((c) => c.from)).toEqual([r1.id]);
  });
});
