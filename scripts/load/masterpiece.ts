/**
 * DASterpiece load scenario: N (default 30) protocol clients write and vote in simultaneous bursts
 * (favourite mode → galleries of ≤10), including duplicate submissions and duplicate votes that must
 * never double-count. Checks timing, anonymity (no bot receives another bot's answer before voting;
 * no authors in public state until each showdown is scored), tallies and connection health.
 *
 *   LOAD_URL=http://localhost:2567 LOAD_SCENARIOS=masterpiece pnpm load
 */
import { allConnected, burst, errorCount, hostSkip, json, leaked, timeUntil, waitForStage, type AddScenario, type Bot, type ScenarioContext } from './helpers.ts';

const PRIVATE = 'masterpiece:private';

interface PrivateView {
  round: number;
  assignments: Array<{ showdownId: string; answer: string | null }>;
  showdownId: string;
  ownAnswerIds: string[];
  canVote: boolean;
}

const latest = (b: Bot): PrivateView | undefined => (b.payloads.get(PRIVATE) as PrivateView[] | undefined)?.at(-1);
const answerText = (i: number) => `mp load answer ${i} qx`;

export function register(add: AddScenario, ctx: ScenarioContext): void {
  add('masterpiece', async () => {
    const { bots, failures } = await ctx.createBots('masterpiece', ctx.N, [PRIVATE], {
      maxPlayers: Math.max(3, Math.min(30, ctx.N)),
      settings: { votingMode: 'favourite', rounds: 1, writeSeconds: 60, voteSeconds: 30, audienceVote: true },
    });
    const host = bots[0]!;
    const N = bots.length;
    host.room.send('lobby:start', {});
    if (!(await waitForStage(ctx, host, 'intro', 15_000))) throw new Error('never reached the intro');
    await ctx.sleep(450);
    hostSkip(host);
    if (!(await waitForStage(ctx, host, 'write', 8000))) throw new Error('never reached writing');
    const dealt = await ctx.waitFor(() => bots.every((b) => (latest(b)?.assignments.length ?? 0) > 0), 8000);
    if (!dealt) throw new Error('prompts were not dealt to everyone');

    // Burst: everyone hands in at once — and immediately re-sends (must be refused, never double-count).
    const errorsBefore = errorCount(bots);
    await burst(ctx, bots, (b, i) => {
      for (const a of latest(b)!.assignments) {
        b.room.send('masterpiece:submit', { showdownId: a.showdownId, text: answerText(i) });
        b.room.send('masterpiece:submit', { showdownId: a.showdownId, text: `${answerText(i)} again` });
      }
    });
    const writeMs = await timeUntil(ctx, () => json(host).answeredCount === N || json(host).stage === 'vote');
    // Anonymity: nobody but the author ever receives an answer privately (and none is public while writing).
    const stillWriting = json(host).stage === 'write';
    const writeLeak = bots.some((_, i) =>
      bots.some((b, j) => j !== i && (JSON.stringify(b.payloads.get(PRIVATE) ?? []).includes(answerText(i)) || (stillWriting && leaked([b], answerText(i), [])))),
    );
    const duplicatesRefused = await ctx.waitFor(() => errorCount(bots) - errorsBefore >= N, 5000);

    const showdowns: string[] = [];
    let anonymousVotes = true;
    let tallies = true;
    let voteMsMax = 0;
    for (let guard = 0; guard < 12; guard++) {
      const voting = await waitForStage(ctx, host, ['vote', 'scores'], 20_000, (s) => s.stage === 'scores' || !showdowns.includes(s.showdownId));
      if (!voting || json(host).stage === 'scores') break;
      const sid = json(host).showdownId as string;
      showdowns.push(sid);
      const answers = json(host).answers as Array<{ id: string; authorId: string }>;
      if (answers.some((a) => a.authorId !== '')) anonymousVotes = false;
      await ctx.waitFor(() => bots.every((b) => latest(b)?.showdownId === sid), 5000);
      await burst(ctx, bots, (b) => {
        const own = new Set(latest(b)?.ownAnswerIds ?? []);
        const pick = answers.find((a) => !own.has(a.id));
        if (!pick) return;
        b.room.send('masterpiece:vote', { showdownId: sid, picks: [pick.id] });
        b.room.send('masterpiece:vote', { showdownId: sid, picks: [pick.id] });
      });
      const ms = await timeUntil(ctx, () => json(host).stage === 'reveal', 10_000);
      voteMsMax = Math.max(voteMsMax, ms);
      if (ms < 0) {
        tallies = false;
        break;
      }
      await ctx.waitFor(() => (json(host).answers as Array<{ authorId: string }>).every((a) => a.authorId !== ''), 3000);
      const revealed = json(host).answers as Array<{ votes: number; authorId: string }>;
      const total = revealed.reduce((n, a) => n + a.votes, 0);
      if (total !== N) tallies = false;
      await ctx.sleep(450); // skips right after a stage change are ignored (double-tap guard)
      hostSkip(host);
    }
    const scores = await waitForStage(ctx, host, 'scores', 10_000);
    await ctx.sleep(450);
    hostSkip(host);
    const finished = await ctx.waitFor(() => json(host).phase === 'RESULTS', 10_000);

    ctx.results.push({
      scenario: `masterpiece ×${N}`,
      ok: failures === 0 && writeMs >= 0 && !writeLeak && duplicatesRefused && showdowns.length >= Math.ceil(N / 10) && anonymousVotes && tallies && scores && finished && allConnected(bots),
      details: `all-written ${writeMs.toFixed(0)}ms galleries=${showdowns.length} votes-in max ${voteMsMax.toFixed(0)}ms tallies=${tallies} anonymous=${!writeLeak && anonymousVotes} dup-refused=${duplicatesRefused} results=${finished} errors=${errorCount(bots) - errorsBefore} joinFailures=${failures}`,
    });
    await ctx.leaveAll(bots);
  });
}
