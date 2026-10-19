/**
 * DAS Survey Showdown load scenario: a presenter and N-1 (default 29) audience clients. The audience
 * locks in guesses (with duplicates) and cheers in bursts while the presenter flips the board with
 * double-sent reveals. Checks: guesses counted once, no audience client ever receives a hidden answer
 * (before its reveal) or the answer sheet, callers scored exactly once, the finale reaches everyone
 * and nobody drops.
 *
 * `showdown-showcase`: the DAS-O-Ween preset (Presenter Showcase) with a cheering crowd: double-sent
 * reveals, a burst of Wrong presses (double clicks collapse into one), the server-run Reveal remaining
 * sweep (#10 → #1), no answer reaching the crowd before it flips, the finale for everyone.
 *
 *   LOAD_URL=http://localhost:2567 LOAD_SCENARIOS=showdown,showdown-showcase pnpm load
 */
import { allConnected, burst, errorCount, json, leaked, timeUntil, type AddScenario, type ScenarioContext } from './helpers.ts';

const SHEET = 'showdown:sheet';
const ME = 'showdown:me';
const EVENT = 'showdown:event';
const REACTIONS = 'showdown:reactions';

interface Sheet {
  answers: Array<{ text: string; points: number; aliases: string[] }>;
}
interface Me {
  points: number;
  calls: number;
}

export function register(add: AddScenario, ctx: ScenarioContext): void {
  add('showdown', async () => {
    const { bots, failures } = await ctx.createBots('showdown', ctx.N, [SHEET, ME, EVENT, REACTIONS], {
      settings: { source: 'packs', packs: ['office'], rounds: 2, audience: true, steal: true, scoring: 'flat' },
    });
    const host = bots[0]!;
    const audience = bots.slice(1);
    const act = (payload: Record<string, unknown>) => host.room.send('showdown:act', { ...payload, rev: json(host).rev });

    host.room.send('lobby:start', {});
    if (!(await ctx.waitFor(() => json(host).phase === 'PLAYING' && json(host).boardJson !== '', 8000))) throw new Error('show never started');
    act({ a: 'begin' });
    await ctx.waitFor(() => JSON.parse(json(host).boardJson).stage === 'title', 4000);
    act({ a: 'question' });
    await ctx.waitFor(() => JSON.parse(json(host).boardJson).stage === 'live', 4000);
    const sheets = () => (host.payloads.get(SHEET) ?? []) as Array<Sheet | null>;
    if (!(await ctx.waitFor(() => (sheets().at(-1)?.answers.length ?? 0) > 0, 4000))) throw new Error('no answer sheet');
    const answers = sheets().at(-1)!.answers;

    // Burst: everyone locks in a guess for answer #(i % n) twice (the duplicate must be refused),
    // plus one miss, and cheers.
    const errorsBefore = errorCount(bots);
    const target = (i: number) => i % answers.length;
    await burst(ctx, audience, (b, i) => {
      const a = answers[target(i)]!;
      b.room.send('showdown:guess', { round: 0, text: a.text });
      b.room.send('showdown:guess', { round: 0, text: a.text });
      b.room.send('showdown:guess', { round: 0, text: `no such answer ${i}` });
      for (let r = 0; r < 4; r++) b.room.send('showdown:react', { r: r % 6 });
    });
    const expected = audience.length * 2;
    const guessMs = await timeUntil(ctx, () => json(host).guessesIn === expected);
    const duplicatesRefused = await ctx.waitFor(() => errorCount(bots) - errorsBefore >= audience.length, 5000);

    // Nothing hidden has reached the audience: no answer text, no sheet.
    const sheetLeak = audience.some((b) => (b.payloads.get(SHEET) ?? []).some((s) => s !== null));
    // (Each bot's own `me` echo carries its own guess — which may be an answer's text — so it isn't searched.)
    const textLeak = answers.some((a) => leaked(audience, `"${a.text}"`, [SHEET, EVENT, REACTIONS]));

    // Flip the board: control to Team 1, every reveal sent twice (idempotent).
    act({ a: 'control', team: 0 });
    await ctx.waitFor(() => JSON.parse(json(host).boardJson).control === 0, 4000);
    const t0 = performance.now();
    // A fast presenter (a key every ~150 ms), every reveal double-sent.
    for (let slot = 0; slot < answers.length; slot++) {
      host.room.send('showdown:act', { a: 'reveal', slot });
      host.room.send('showdown:act', { a: 'reveal', slot });
      await ctx.sleep(150);
    }
    const swept = await ctx.waitFor(() => JSON.parse(json(audience.at(-1)!).boardJson).roundHow === 'sweep', 8000);
    const revealMs = performance.now() - t0;
    const board = JSON.parse(json(host).boardJson) as { scores: number[]; slots: Array<{ callers: number }> };
    const total = answers.reduce((s, a) => s + a.points, 0);
    const scoreOk = board.scores[0] === total && board.scores[1] === 0;
    const callersOk = board.slots.every((s, slot) => s.callers === audience.filter((_, i) => target(i) === slot).length);
    // Every caller scored exactly the points of their answer (once).
    const scored = await ctx.waitFor(
      () =>
        audience.every((b, i) => {
          const me = ((b.payloads.get(ME) ?? []) as Me[]).at(-1);
          return me?.points === answers[target(i)]!.points && me.calls === 1;
        }),
      6000,
    );
    const reactionsSeen = ((audience[0]!.payloads.get(REACTIONS) ?? []) as Array<{ k: number[] }>).reduce((n, r) => n + r.k.reduce((a, b) => a + b, 0), 0);

    act({ a: 'finish' });
    const finale = await ctx.waitFor(() => audience.every((b) => json(b).phase === 'RESULTS' && json(b).finaleJson !== ''), 8000);

    ctx.results.push({
      scenario: `showdown ×${bots.length}`,
      ok: failures === 0 && guessMs >= 0 && duplicatesRefused && !sheetLeak && !textLeak && swept && scoreOk && callersOk && scored && finale && allConnected(bots),
      details: `guesses-in ${guessMs.toFixed(0)}ms board-swept ${revealMs.toFixed(0)}ms dup-refused=${duplicatesRefused} no-leak=${!sheetLeak && !textLeak} score=${scoreOk} callers=${callersOk} scored-once=${scored} reactions-seen=${reactionsSeen} finale=${finale} errors=${errorCount(bots) - errorsBefore} joinFailures=${failures}`,
    });
    await ctx.leaveAll(bots);
  });

  add('showdown-showcase', async () => {
    const { bots, failures } = await ctx.createBots('showdown', ctx.N, [SHEET, EVENT, REACTIONS], {});
    const host = bots[0]!;
    const audience = bots.slice(1);
    const board = (b = host) => JSON.parse(json(b).boardJson || 'null') as { rev: number; round: number; stage: string; slots: Array<{ revealed: boolean; late: boolean }> } | null;
    const act = (payload: Record<string, unknown>) => host.room.send('showdown:act', payload);
    host.room.send('showdown:preset', { id: 'dasoween-2026' });
    if (!(await ctx.waitFor(() => json(host).customRounds === 2, 4000))) throw new Error('preset never loaded');
    host.room.send('lobby:start', {});
    if (!(await ctx.waitFor(() => json(host).phase === 'PLAYING' && board() !== null, 8000))) throw new Error('show never started');
    act({ a: 'begin', rev: board()!.rev });
    await ctx.waitFor(() => board()?.stage === 'title', 4000);
    act({ a: 'question', rev: board()!.rev });
    await ctx.waitFor(() => board()?.stage === 'live', 4000);
    const sheets = () => (host.payloads.get(SHEET) ?? []) as Array<Sheet | null>;
    if (!(await ctx.waitFor(() => (sheets().at(-1)?.answers.length ?? 0) === 10, 4000))) throw new Error('no answer sheet');
    const answers = sheets().at(-1)!.answers;
    const errorsBefore = errorCount(bots);

    // The crowd cheers while the presenter finds five answers (each reveal double-sent) and buzzes misses.
    const cheering = burst(ctx, audience, (b) => {
      for (let r = 0; r < 6; r++) b.room.send('showdown:react', { r });
    });
    const t0 = performance.now();
    for (const slot of [2, 0, 4, 6, 1]) {
      act({ a: 'reveal', slot, round: 0 });
      act({ a: 'reveal', slot, round: 0 });
      await ctx.sleep(120);
    }
    // Ten Wrong presses in pairs (double clicks), 600 ms apart: five misses reach the crowd.
    for (let i = 0; i < 5; i++) {
      act({ a: 'miss', round: 0 });
      act({ a: 'miss', round: 0 });
      await ctx.sleep(600);
    }
    await cheering;
    const missesSeen = await ctx.waitFor(() => audience.every((b) => ((b.payloads.get(EVENT) ?? []) as Array<{ type: string }>).filter((e) => e.type === 'miss').length === 5), 6000);
    // Before the sweep: the five hidden answers never reached anyone in the crowd.
    const hidden = [3, 5, 7, 8, 9].map((i) => answers[i]!.text);
    const earlyLeak = hidden.some((text) => leaked(audience, `"${text}"`, [SHEET, EVENT, REACTIONS]));
    const sheetLeak = audience.some((b) => (b.payloads.get(SHEET) ?? []).some((x) => x !== null));

    act({ a: 'sweep', round: 0 });
    const swept = await ctx.waitFor(() => audience.every((b) => board(b)?.stage === 'done'), 30000);
    const revealMs = performance.now() - t0;
    const last = board(audience.at(-1))!;
    const lateOk = last.slots.every((x, i) => x.revealed && x.late === [3, 5, 7, 8, 9].includes(i));
    const order = ((audience[0]!.payloads.get(EVENT) ?? []) as Array<{ type: string; slot?: number; sweep?: boolean }>)
      .filter((e) => e.type === 'reveal' && e.sweep)
      .map((e) => e.slot);
    const orderOk = JSON.stringify(order) === JSON.stringify([9, 8, 7, 5, 3]);
    const reactionsSeen = ((audience[0]!.payloads.get(REACTIONS) ?? []) as Array<{ k: number[] }>).reduce((n, r) => n + r.k.reduce((a, b) => a + b, 0), 0);

    act({ a: 'next', rev: board()!.rev });
    await ctx.waitFor(() => board()?.round === 1, 4000);
    act({ a: 'finish', rev: board()!.rev });
    const finale = await ctx.waitFor(() => audience.every((b) => json(b).phase === 'RESULTS' && json(b).finaleJson !== ''), 8000);

    ctx.results.push({
      scenario: `showdown-showcase ×${bots.length}`,
      ok: failures === 0 && missesSeen && !earlyLeak && !sheetLeak && swept && lateOk && orderOk && finale && allConnected(bots),
      details: `round-played ${revealMs.toFixed(0)}ms misses=${missesSeen} no-leak=${!earlyLeak && !sheetLeak} sweep-order=${orderOk ? order.join('>') : `WRONG ${order.join('>')}`} late-flags=${lateOk} reactions-seen=${reactionsSeen} finale=${finale} errors=${errorCount(bots) - errorsBefore} joinFailures=${failures}`,
    });
    await ctx.leaveAll(bots);
  });
}
