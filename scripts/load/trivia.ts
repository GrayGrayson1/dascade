/**
 * DAStravaganza Trivia — N synthetic players (default 30) play a short starter-pack match:
 * burst of simultaneous locks per question, early reveal once everyone answered, identical reveal
 * on every client, no answer key before the reveal, private locks only to their owner, podium.
 */
import {
  TRIVIA_MSG,
  type TriviaAnswerInput,
  type TriviaPrivate,
  type TriviaQuestionView,
  type TriviaRevealView,
} from '@dascade/shared/games/trivia';
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

function answerFor(view: TriviaQuestionView, i: number): TriviaAnswerInput {
  switch (view.type) {
    case 'mc':
      return { kind: 'mc', index: i % (view.options?.length ?? 1) };
    case 'tf':
      return { kind: 'tf', value: i % 2 === 0 };
    case 'text':
      return { kind: 'text', text: `guess ${i}` };
    case 'number':
      return { kind: 'number', value: 1000 + i * 7 };
    case 'order':
      return { kind: 'order', order: (view.items ?? []).map((_, k) => k) };
  }
}

export function register(add: AddScenario, ctx: ScenarioContext): void {
  add('trivia', async () => {
    const QUESTIONS = 3;
    const { bots } = await ctx.createBots('trivia', ctx.N, [TRIVIA_MSG.private], {
      settings: { questionCount: QUESTIONS, answerSeconds: 20, pack: 'starter', speedBonus: true, streakBonus: true },
    });
    const host = bots[0]!;
    host.room.send('lobby:start', {});
    const lockMs: number[] = [];
    let leakFree = true;
    let consistent = true;
    let ownOnly = true;
    for (let q = 0; q < QUESTIONS; q++) {
      if (!(await waitForStage(ctx, host, 'question', 20_000))) throw new Error(`question ${q + 1} never opened`);
      const view = JSON.parse(json(host).questionJson) as TriviaQuestionView;
      await ctx.waitFor(() => bots.every((b) => json(b).questionJson && JSON.parse(json(b).questionJson).seq === view.seq), 5000);
      // Before the reveal: no answer key anywhere public.
      if (bots.some((b) => json(b).revealJson !== '' || /"correct/.test(json(b).questionJson))) leakFree = false;
      await burst(ctx, bots, (b: Bot, i) => b.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer: answerFor(view, i) }), 250);
      const t = await timeUntil(ctx, () => json(host).answeredCount === bots.length, 8000);
      lockMs.push(t);
      if (!(await waitForStage(ctx, host, ['reveal', 'scores', 'final'], 8000))) throw new Error(`question ${q + 1} never revealed`);
      await ctx.waitFor(() => bots.every((b) => json(b).revealJson !== ''), 5000);
      const reveals = bots.map((b) => JSON.parse(json(b).revealJson) as TriviaRevealView);
      if (new Set(reveals.map((r) => `${r.seq}|${r.correctText}|${r.answeredCount}`)).size !== 1) consistent = false;
      if (Object.keys(reveals[0]!.results).length !== bots.length) consistent = false;
      // Each bot only ever received its own private payloads.
      for (const b of bots) {
        const privs = (b.payloads.get(TRIVIA_MSG.private) ?? []) as TriviaPrivate[];
        const mine = privs.filter((p) => p.seq === view.seq);
        if (mine.length === 0 || mine.length > 3) ownOnly = false;
      }
    }
    const finished = await ctx.waitFor(() => json(host).phase === 'RESULTS' && json(host).podiumJson !== '', 30_000);
    const podium = finished ? JSON.parse(json(host).podiumJson) : { players: [] };
    const ok =
      finished &&
      leakFree &&
      consistent &&
      ownOnly &&
      lockMs.every((t) => t >= 0) &&
      podium.players.length === bots.length &&
      allConnected(bots);
    ctx.results.push({
      scenario: `trivia ×${bots.length}`,
      ok,
      details: `questions=${QUESTIONS} all-locked-after-burst p50=${ctx.pct(lockMs, 50).toFixed(0)}ms max=${Math.max(...lockMs).toFixed(0)}ms (sends jittered over 250ms) no-leak=${leakFree} identical-reveals=${consistent} private-own-only=${ownOnly} podium=${podium.players.length} errors=${errorCount(bots)}`,
    });
    await ctx.leaveAll(bots);
  });
}
