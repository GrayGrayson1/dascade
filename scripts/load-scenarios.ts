/**
 * Game-specific load scenarios for scripts/load-test.ts (N synthetic clients each):
 *  - sketch: drawing stream from the artist relayed to every guesser + guess traffic
 *  - wheel:  synchronized spin broadcast to every client
 *  - bingo:  30 players with private cards, rapid calls, server-validated claims
 */
import { DASKETCH_MSG, type SketchPrivate } from '@dascade/shared/games/dasketch';
import { WHEEL_MSG } from '@dascade/shared/games/wheel';
import { BINGO_FREE, BINGO_MSG, type BingoCardPayload, type BingoClaimResultPayload } from '@dascade/shared/games/bingo';
import type { ScenarioContext } from './load-test.ts';

type Json = Record<string, any>;
const json = (room: { state: unknown }): Json => (room.state as { toJSON(): Json }).toJSON();

export function register(add: (name: string, fn: () => Promise<void>) => void, ctx: ScenarioContext): void {
  const { N, createBots, leaveAll, waitFor, sleep, pct, results } = ctx;

  // -------------------------------------------------------------------------
  add('sketch', async () => {
    const keep = [DASKETCH_MSG.private, DASKETCH_MSG.stroke];
    const { bots } = await createBots('dasketch', N, keep, { settings: { drawSeconds: 60, rounds: 1 } });
    const host = bots[0]!;
    host.room.send('lobby:start', {});
    const choosing = await waitFor(() => json(host.room).stage === 'choosing' && Boolean(json(host.room).artistId), 15_000);
    if (!choosing) throw new Error('never reached word choice');
    const artistId = json(host.room).artistId as string;
    const artist = bots.find((b) => b.playerId === artistId);
    if (!artist) throw new Error('artist bot not found');
    await waitFor(() => ((artist.payloads.get(DASKETCH_MSG.private) ?? []).at(-1) as SketchPrivate | undefined)?.choices != null, 5000);
    artist.room.send(DASKETCH_MSG.choose, { index: 0 });
    if (!(await waitFor(() => json(host.room).stage === 'drawing', 8000))) throw new Error('drawing never started');

    const turn = json(host.room).turn as number;
    const guessers = bots.filter((b) => b !== artist);
    const relayBefore = guessers.map((b) => b.messages.get(DASKETCH_MSG.stroke) ?? 0);
    const durationMs = 6000;
    const start = Date.now();
    let sent = 0;
    let x = 100;
    artist.room.send(DASKETCH_MSG.draw, { turn, events: [{ k: 'stroke', tool: 'brush', color: '#ff4fd8', size: 6, pts: [x, 100, x + 2, 102] }] });
    sent++;
    let guessTick = 0;
    while (Date.now() - start < durationMs) {
      // ~20 batches/s of 12 points each — what a fast human scribble produces.
      const pts: number[] = [];
      for (let i = 0; i < 12; i++) {
        x = 100 + ((x + 7) % 900);
        pts.push(x, 300 + Math.round(150 * Math.sin(x / 40)));
      }
      artist.room.send(DASKETCH_MSG.draw, { turn, events: [{ k: 'pts', pts }] });
      sent++;
      if (guessTick++ % 20 === 0) for (const g of guessers) g.room.send('chat:send', { text: `is it a banana ${guessTick}?` });
      await sleep(50);
    }
    await sleep(800);
    const relays = guessers.map((b, i) => (b.messages.get(DASKETCH_MSG.stroke) ?? 0) - relayBefore[i]!);
    const minRelays = Math.min(...relays);
    const connected = bots.every((b) => b.room.connection.isOpen);
    results.push({
      scenario: `sketch drawing ×${N}`,
      ok: minRelays >= sent * 0.95 && connected,
      details: `artist-batches=${sent} relays-per-guesser min=${minRelays} p50=${pct(relays, 50)} all-connected=${connected}`,
    });
    await leaveAll(bots);
  });

  // -------------------------------------------------------------------------
  add('wheel', async () => {
    const { bots } = await createBots('wheel', N, [], { settings: { spinDurationMs: 2000 } });
    const host = bots[0]!;
    host.room.send('lobby:start', {});
    if (!(await waitFor(() => json(host.room).phase === 'PLAYING', 8000))) throw new Error('wheel never started');
    const spins = 3;
    const latencies: number[] = [];
    let consistent = true;
    for (let s = 0; s < spins; s++) {
      await waitFor(() => (json(host.room).nextSpinAt ?? 0) <= Date.now() && json(host.room).spin?.status !== 'spinning', 10_000);
      const prevId = json(host.room).spin?.spinId ?? 0;
      const t0 = performance.now();
      host.room.send(WHEEL_MSG.spin, { winnerIndex: 0, forceWinner: 'hacked' });
      const seen = await waitFor(() => bots.every((b) => (json(b.room).spin?.spinId ?? 0) > prevId), 5000);
      latencies.push(performance.now() - t0);
      if (!seen) {
        consistent = false;
        break;
      }
      const plans = bots.map((b) => {
        const sp = json(b.room).spin;
        return `${sp.spinId}|${sp.winnerId}|${sp.toRotation}|${sp.startAt}`;
      });
      if (new Set(plans).size !== 1) consistent = false;
      await waitFor(() => json(host.room).spin?.status === 'landed', 8000);
    }
    const history = (json(host.room).history ?? []).length;
    results.push({
      scenario: `wheel broadcast ×${N}`,
      ok: consistent && history >= spins,
      details: `spins=${spins} identical-plan-on-all-clients=${consistent} broadcast p95=${pct(latencies, 95).toFixed(0)}ms history=${history}`,
    });
    await leaveAll(bots);
  });

  // -------------------------------------------------------------------------
  add('bingo', async () => {
    const keep = [BINGO_MSG.card, BINGO_MSG.claimResult];
    const { bots } = await createBots('bingo', N, keep, { settings: { callerMode: 'manual', tieWindowMs: 1500 } });
    const host = bots[0]!;
    host.room.send('lobby:start', {});
    if (!(await waitFor(() => json(host.room).phase === 'PLAYING', 10_000))) throw new Error('bingo never started');
    const gotCards = await waitFor(() => bots.every((b) => (b.payloads.get(BINGO_MSG.card) ?? []).length > 0), 8000);
    const cards = bots.map((b) => (b.payloads.get(BINGO_MSG.card) ?? []).at(-1) as BingoCardPayload | undefined);
    const unique = new Set(cards.map((c) => c?.cells.join(','))).size;

    const lineComplete = (card: BingoCardPayload, called: Set<number>): boolean => {
      const n = card.size;
      const hit = (i: number) => card.cells[i] === BINGO_FREE || called.has(card.cells[i]!);
      const lines: number[][] = [];
      for (let r = 0; r < n; r++) lines.push(Array.from({ length: n }, (_, c) => r * n + c));
      for (let c = 0; c < n; c++) lines.push(Array.from({ length: n }, (_, r) => r * n + c));
      lines.push(Array.from({ length: n }, (_, i) => i * n + i), Array.from({ length: n }, (_, i) => i * n + (n - 1 - i)));
      return lines.some((l) => l.every(hit));
    };

    const claimed = new Set<number>();
    let calls = 0;
    const t0 = performance.now();
    let winners: number;
    while (calls < 75 && performance.now() - t0 < 45_000) {
      host.room.send(BINGO_MSG.call, {});
      calls++;
      await sleep(360);
      bots.forEach((b, i) => {
        const card = cards[i];
        if (!card || claimed.has(i)) return;
        const called = new Set<number>(json(b.room).calls ?? []);
        if (lineComplete(card, called)) {
          claimed.add(i);
          b.room.send(BINGO_MSG.claim, {});
        }
      });
      winners = (json(host.room).winners ?? []).length;
      if (winners > 0) break;
    }
    await sleep(2000);
    winners = (json(host.room).winners ?? []).length;
    const verdicts = bots.flatMap((b) => (b.payloads.get(BINGO_MSG.claimResult) ?? []) as BingoClaimResultPayload[]);
    const accepted = verdicts.filter((v) => v.ok).length;
    const callsSeen = bots.map((b) => (json(b.room).calls ?? []).length);
    results.push({
      scenario: `bingo ×${N}`,
      ok: gotCards && unique === N && winners > 0 && accepted === winners && Math.min(...callsSeen) === Math.max(...callsSeen),
      details: `cards=${gotCards ? N : 'missing'} unique=${unique} calls=${calls} claims=${claimed.size} accepted=${accepted} winners=${winners} calls-in-sync=${Math.min(...callsSeen) === Math.max(...callsSeen)}`,
    });
    await leaveAll(bots);
  });
}
