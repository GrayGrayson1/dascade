/**
 * DASwords — N synthetic players (default 30):
 *  - `words`:       one Letter Grid round. Every bot fires a burst of real board words (plus a few
 *                   invalid and duplicate ones) as fast as the rate limit allows; we measure verdict
 *                   latency, check that nobody ever sees another player's words before the reveal,
 *                   that duplicates never double-count, and that every client gets the same reveal.
 *  - `words-chain`: one Word Chain link answered by everyone at once → the link closes early and
 *                   every bot sees the same link reveal.
 * The bots read the shipped dictionary locally to know which words are on the board (as a human
 * player would by looking); the server never sends any word list.
 */
import { readFileSync } from 'node:fs';
import { WORDS_MSG, type ChainLinkReveal, type WordsPrivate, type WordsRoundReveal } from '@dascade/shared/games/words';
import { WordDictionary, isBlockedWord, solveGrid } from '../../packages/game-core/src/words/index.ts';
import { allConnected, burst, errorCount, hostSkip, json, leaked, timeUntil, waitForStage, type AddScenario, type Bot, type ScenarioContext } from './helpers.ts';

let dict: WordDictionary | null = null;
function dictionary(): WordDictionary {
  dict ??= WordDictionary.fromText(readFileSync(new URL('../../apps/game-server/src/rooms/words/data/dascade-words.txt', import.meta.url), 'utf8'));
  return dict;
}

const privatesOf = (b: Bot) => (b.payloads.get(WORDS_MSG.private) ?? []) as WordsPrivate[];

export function register(add: AddScenario, ctx: ScenarioContext): void {
  add('words', async () => {
    const { bots } = await ctx.createBots('words', ctx.N, [WORDS_MSG.private, WORDS_MSG.event, 'sys:error'], {
      maxPlayers: 30,
      settings: { mode: 'grid', rounds: 1, gridSize: 5, gridMinLength: 4, gridSeconds: 60 },
    });
    const host = bots[0]!;
    host.room.send('lobby:start', {});
    if (!(await waitForStage(ctx, host, 'play', 20_000))) throw new Error('play never started');
    await ctx.waitFor(() => bots.every((b) => json(b).grid.length === 25), 5000);
    const d = dictionary();
    const tiles = json(host).grid as string[];
    const words = [...solveGrid(tiles, d, 4).keys()].filter((w) => !isBlockedWord(w)).sort((a, b) => b.length - a.length);
    if (words.length < 20) throw new Error(`board too sparse for the scenario (${words.length})`);
    // Bot 0's secret: the longest word, only bot 0 plays it.
    const secret = words[0]!;
    const shared = words.slice(1);

    // Each bot: 8 valid words (overlapping with others), 1 duplicate, 1 invalid — in two bursts.
    const plan = (i: number) => {
      const mine = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => shared[(i * 3 + k) % shared.length]!);
      if (i === 0) mine[0] = secret;
      return [...mine, mine[1]!, `zzq${i}x`];
    };
    const t0 = performance.now();
    for (let step = 0; step < 10; step++) {
      await burst(ctx, bots, (b, i) => b.room.send(WORDS_MSG.submit, { round: 1, word: plan(i)[step]! }), 150);
      await ctx.sleep(220); // stay inside the 5/s submission budget
    }
    const verdictMs = await timeUntil(ctx, () => bots.every((b) => (privatesOf(b).at(-1)?.entries.length ?? 0) >= 10), 10_000);
    const elapsed = performance.now() - t0;
    const counts = bots.map((b) => json(host).progress[b.playerId]?.found ?? 0);
    const noDoubleCount = bots.every((b, i) => {
      const entries = privatesOf(b).at(-1)?.entries ?? [];
      const ok = entries.filter((e) => e.status === 'ok').map((e) => e.word);
      return new Set(ok).size === ok.length && ok.length === new Set(plan(i).slice(0, 8)).size && counts[i] === ok.length;
    });
    const beforeReveal = !leaked(bots.slice(1), secret, [WORDS_MSG.private, WORDS_MSG.event]);

    hostSkip(host);
    if (!(await waitForStage(ctx, host, ['reveal', 'final'], 10_000))) throw new Error('no reveal');
    await ctx.waitFor(() => bots.every((b) => json(b).revealJson !== ''), 5000);
    const reveals = bots.map((b) => JSON.parse(json(b).revealJson) as WordsRoundReveal);
    const consistent = new Set(reveals.map((r) => `${r.round}|${r.found}|${r.players.map((p) => `${p.id}:${p.points}`).join(',')}`)).size === 1;
    const secretUnique = reveals[0]!.players.find((p) => p.id === host.playerId)?.words.find((w) => w.w === secret)?.u === 1;
    const finished = await ctx.waitFor(() => json(host).phase === 'RESULTS' && json(host).podiumJson !== '', 30_000);
    ctx.results.push({
      scenario: `words grid ×${bots.length}`,
      ok: verdictMs >= 0 && noDoubleCount && beforeReveal && consistent && secretUnique && finished && allConnected(bots),
      details: `${bots.length * 10} submissions in ${elapsed.toFixed(0)}ms, all verdicts +${verdictMs.toFixed(0)}ms · no-double-count=${noDoubleCount} private-until-reveal=${beforeReveal} consistent-reveal=${consistent} unique=${secretUnique} podium=${finished} rejects=${errorCount(bots)}`,
    });
    await ctx.leaveAll(bots);
  });

  add('words-chain', async () => {
    const { bots } = await ctx.createBots('words', ctx.N, [WORDS_MSG.private, 'sys:error'], {
      maxPlayers: 30,
      settings: { mode: 'chain', rounds: 1, chainLives: 2, chainSeconds: 30, chainLinks: 5, chainMinLength: 3 },
    });
    const host = bots[0]!;
    host.room.send('lobby:start', {});
    if (!(await waitForStage(ctx, host, 'link', 20_000))) throw new Error('link never opened');
    const d = dictionary();
    const s = json(host);
    const options = d.wordsWithPrefix(s.chainPrefix, (w) => w !== s.chainWord && !isBlockedWord(w) && w.length >= 3);
    const t0 = await burst(ctx, bots, (b, i) => b.room.send(WORDS_MSG.submit, { round: 1, word: options[i % options.length]! }), 300);
    const allMs = await timeUntil(ctx, () => json(host).answeredCount === bots.length, 8000);
    const closed = await waitForStage(ctx, host, 'linkReveal', 5000);
    const closeMs = performance.now() - t0;
    await ctx.waitFor(() => bots.every((b) => json(b).linkJson !== ''), 5000);
    const reveals = bots.map((b) => JSON.parse(json(b).linkJson) as ChainLinkReveal);
    const consistent = new Set(reveals.map((r) => `${r.link}|${r.next}|${r.answers.length}|${r.missed.length}`)).size === 1;
    ctx.results.push({
      scenario: `words chain ×${bots.length}`,
      ok: allMs >= 0 && closed && consistent && reveals[0]!.answers.length === bots.length && reveals[0]!.missed.length === 0 && allConnected(bots),
      details: `all answered in ${allMs.toFixed(0)}ms, link closed early after ${closeMs.toFixed(0)}ms (timer 30s) · consistent=${consistent} next=${reveals[0]!.next} rejects=${errorCount(bots)}`,
    });
    await ctx.leaveAll(bots);
  });
}
