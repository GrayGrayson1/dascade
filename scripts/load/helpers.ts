/**
 * Shared helpers for party-game load scenarios (30 synthetic protocol clients).
 *
 * A scenario file `scripts/load/<gameId>.ts` exports:
 *
 *   export function register(add: AddScenario, ctx: ScenarioContext): void {
 *     add('trivia', async () => { ... ctx.results.push({ scenario, ok, details }) });
 *   }
 *
 * scripts/load/index.ts discovers these files and registers them with scripts/load-test.ts, so
 * `LOAD_SCENARIOS=trivia pnpm load` runs it. Use the helpers below instead of re-implementing
 * polling, bursts and leak checks.
 */
import type { ScenarioContext } from '../load-test.ts';

export type { ScenarioContext };
export type AddScenario = (name: string, fn: () => Promise<void>) => void;
export type Bot = Awaited<ReturnType<ScenarioContext['createBots']>>['bots'][number];
type Json = Record<string, any>;

/** Plain JSON snapshot of a bot's synchronized state. */
export function json(bot: Bot | { room: { state: unknown } }): Json {
  return (bot.room.state as { toJSON(): Json }).toJSON();
}

/** Polls until the host sees `stage` (and optionally a predicate on the snapshot). */
export async function waitForStage(
  ctx: ScenarioContext,
  bot: Bot,
  stage: string | string[],
  timeoutMs = 15_000,
  extra?: (s: Json) => boolean,
): Promise<boolean> {
  const stages = Array.isArray(stage) ? stage : [stage];
  return ctx.waitFor(() => {
    const s = json(bot);
    return stages.includes(s.stage) && (!extra || extra(s));
  }, timeoutMs);
}

/** Every bot sees the same value for `pick(state)` (e.g. the stage seq or a question id). */
export async function allSee(
  ctx: ScenarioContext,
  bots: Bot[],
  pick: (s: Json) => unknown,
  expected: unknown,
  timeoutMs = 8000,
): Promise<boolean> {
  return ctx.waitFor(() => bots.every((b) => pick(json(b)) === expected), timeoutMs);
}

/**
 * Sends one message per bot "at once" (optionally with jitter) and returns the send timestamps, so a
 * scenario can measure how long the server took to reflect the burst (e.g. answeredCount).
 */
export async function burst(ctx: ScenarioContext, bots: Bot[], send: (bot: Bot, i: number) => void, jitterMs = 0): Promise<number> {
  const t0 = performance.now();
  if (jitterMs <= 0) bots.forEach((b, i) => send(b, i));
  else await Promise.all(bots.map((b, i) => ctx.sleep(Math.floor(Math.random() * jitterMs)).then(() => send(b, i))));
  return t0;
}

/** Ms until `pred` holds (or -1 on timeout). */
export async function timeUntil(ctx: ScenarioContext, pred: () => boolean, timeoutMs = 8000): Promise<number> {
  const t0 = performance.now();
  const ok = await ctx.waitFor(pred, timeoutMs);
  return ok ? performance.now() - t0 : -1;
}

/**
 * Leak check: true when NONE of `bots` received `needle` in any message payload of the given types
 * (or of any type kept by createBots when `types` is omitted), nor in their state snapshot.
 * Remember createBots only keeps payloads for the types you pass as `keep`.
 */
export function leaked(bots: Bot[], needle: string, types?: string[]): boolean {
  for (const b of bots) {
    if (JSON.stringify(json(b)).includes(needle)) return true;
    for (const [type, list] of b.payloads) {
      if (types && !types.includes(type)) continue;
      if (JSON.stringify(list).includes(needle)) return true;
    }
  }
  return false;
}

/** Count of rejected actions (sys:error) across bots. */
export function errorCount(bots: Bot[]): number {
  return bots.reduce((n, b) => n + (b.messages.get('sys:error') ?? 0), 0);
}

export function allConnected(bots: Bot[]): boolean {
  return bots.every((b) => b.room.connection.isOpen);
}

/** Host skips the current party stage (kit message). */
export function hostSkip(host: Bot): void {
  host.room.send('party:host', { action: 'skip' });
}
