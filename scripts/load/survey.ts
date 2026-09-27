/**
 * DAS Survey load scenario: N (default 30) protocol clients answer and predict in simultaneous
 * bursts, including a duplicate burst that must not double-count. Checks timing, idempotency,
 * anonymity (no bot ever receives another bot's answer; public state has no answers) and that
 * everyone stays connected.
 *
 *   LOAD_URL=http://localhost:2567 LOAD_SCENARIOS=survey pnpm load
 */
import {
  allConnected,
  burst,
  errorCount,
  json,
  timeUntil,
  waitForStage,
  type AddScenario,
  type Bot,
  type ScenarioContext,
} from './helpers.ts';

const PRIVATE = 'survey:private';

interface PrivateView {
  q: number;
  answer: number | null;
}

export function register(add: AddScenario, ctx: ScenarioContext): void {
  add('survey', async () => {
    const { bots, failures } = await ctx.createBots('survey', ctx.N, [PRIVATE], {
      settings: { mode: 'majority', questions: 3, answerSeconds: 30, predictSeconds: 30, revealSeconds: 6 },
    });
    const host = bots[0]!;
    const N = bots.length;
    host.room.send('lobby:start', {});
    if (!(await waitForStage(ctx, host, 'answer'))) throw new Error('never reached the answer stage');
    const q = json(host).q as number;
    const options = (JSON.parse(json(host).questionJson) as { options: string[] }).options.length;
    const mine = (i: number) => i % options;

    // Burst: everyone answers at once — and immediately sends a duplicate (must be refused).
    const errorsBefore = errorCount(bots);
    await burst(ctx, bots, (b, i) => {
      b.room.send('survey:answer', { q, option: mine(i) });
      b.room.send('survey:answer', { q, option: (mine(i) + 1) % options });
    });
    const answerMs = await timeUntil(ctx, () => json(host).answersIn === N);
    const predictStage = await waitForStage(ctx, host, 'predict', 8000);
    const duplicatesRefused = await ctx.waitFor(() => errorCount(bots) - errorsBefore >= N, 5000);

    // Burst: everyone predicts at once.
    await burst(ctx, bots, (b) => b.room.send('survey:predict', { q, kind: 'majority', option: 0 }));
    const predictMs = await timeUntil(ctx, () => json(host).predictionsIn === N || json(host).stage === 'reveal');
    const revealed = await waitForStage(ctx, host, 'reveal', 8000, (s) => s.resultJson !== '');
    const result = revealed ? (JSON.parse(json(host).resultJson) as { respondents: number; counts: number[]; predictors: number }) : null;
    const tallyOk = Boolean(
      result && result.respondents === N && result.predictors === N && result.counts.reduce((a, b) => a + b, 0) === N,
    );

    // Anonymity: every private payload a bot received carries only its own answer (or none),
    // and the public state never contains answers.
    const privatesOk = bots.every((b: Bot, i) =>
      ((b.payloads.get(PRIVATE) ?? []) as PrivateView[]).every((p) => p.answer === null || p.answer === mine(i)),
    );
    const progress = json(bots[N - 1]!).progress as Record<string, Record<string, unknown>>;
    const stateOk = Object.values(progress).every((p) => Object.keys(p).sort().join() === 'answered,predicted');

    ctx.results.push({
      scenario: `survey ×${N}`,
      ok:
        failures === 0 &&
        answerMs >= 0 &&
        predictStage &&
        duplicatesRefused &&
        predictMs >= 0 &&
        tallyOk &&
        privatesOk &&
        stateOk &&
        allConnected(bots),
      details: `answers-in ${answerMs.toFixed(0)}ms predictions-in ${predictMs.toFixed(0)}ms tally=${tallyOk} dup-refused=${duplicatesRefused} private-only=${privatesOk && stateOk} errors=${errorCount(bots) - errorsBefore} joinFailures=${failures}`,
    });
    await ctx.leaveAll(bots);
  });
}
