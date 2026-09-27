/**
 * Room DJ load scenario: N (default 30) protocol clients in one room. The host drives synchronized
 * playback (play/seek/pause/resume/next) while guests queue songs, vote to skip (with duplicates),
 * leave and join, and the host finally hands over by leaving. Asserts every connected client ends on
 * the same DJ state version, late joiners get the current track, the vote skips exactly once at a
 * strict majority, host migration keeps the music, and nothing errors or disconnects.
 *
 *   LOAD_URL=http://localhost:2567 LOAD_SCENARIOS=dj pnpm load
 */
import { Client, type Room } from '@colyseus/sdk';
import { DJ, skipVotesNeeded, type DjState } from '@dascade/shared/jukebox';
import { allConnected, type AddScenario, type Bot, type ScenarioContext } from './helpers.ts';

interface Listener {
  name: string;
  room: Room;
  playerId: string;
  states: DjState[];
  errors: { type?: string; code: string }[];
}

const last = (l: Listener): DjState | undefined => l.states[l.states.length - 1];

/** Wrap a createBots bot (its payloads are kept for dj:state / sys:error). */
function fromBot(b: Bot): Listener {
  const view: Listener = { name: b.name, room: b.room, playerId: b.playerId, states: [], errors: [] };
  Object.defineProperty(view, 'states', { get: () => (b.payloads.get(DJ.state) ?? []) as DjState[] });
  Object.defineProperty(view, 'errors', { get: () => (b.payloads.get('sys:error') ?? []) as Listener['errors'] });
  Object.defineProperty(view, 'playerId', { get: () => b.playerId });
  return view;
}

async function joinListener(ctx: ScenarioContext, code: string, name: string): Promise<Listener> {
  const room = await new Client(ctx.URL).joinById(code, { name });
  const l: Listener = { name, room, playerId: '', states: [], errors: [] };
  room.onMessage('*', (type: string | number, payload: unknown) => {
    const t = String(type);
    if (t === DJ.state) l.states.push(payload as DjState);
    else if (t === 'sys:error') l.errors.push(payload as Listener['errors'][number]);
    else if (t === 'sys:welcome') l.playerId = (payload as { playerId: string }).playerId;
  });
  return l;
}

export function register(add: AddScenario, ctx: ScenarioContext): void {
  add('dj', async () => {
    const t0 = performance.now();
    const { bots, failures } = await ctx.createBots('wheel', ctx.N, [DJ.state, 'sys:error']);
    const code = bots[0]!.room.roomId;
    let listeners = bots.map(fromBot);
    const host = listeners[0]!;
    const checks: Record<string, boolean> = {};
    const sameVersion = (ls: Listener[], version: number) => ls.every((l) => last(l)?.version === version);

    // 1. Enable + play: everyone converges on one state.
    host.room.send(DJ.config, { enabled: true, allowQueue: true, allowSkipVote: true });
    host.room.send(DJ.command, { op: 'play', track: { trackId: 'neon-cruising', duration: 600 } });
    checks.play = await ctx.waitFor(() => listeners.every((l) => last(l)?.current?.trackId === 'neon-cruising'), 8000);

    // 2. Host scrubs (within its 4/s budget) while guests queue one song each.
    const queueBursts = listeners.slice(1).map((l, i) => l.room.send(DJ.command, { op: 'enqueue', track: { trackId: `song-${i}`, duration: 300 } }));
    for (let i = 0; i < 6; i++) {
      host.room.send(DJ.command, i % 3 === 0 ? { op: 'seek', position: 30 + i * 10 } : i % 3 === 1 ? { op: 'pause' } : { op: 'resume' });
      await ctx.sleep(300);
    }
    const expectedQueue = Math.min(queueBursts.length, 50);
    checks.queue = await ctx.waitFor(() => last(host)?.queue.length === expectedQueue, 8000);
    const scrubVersion = last(host)!.version;
    checks.scrubSync = await ctx.waitFor(() => sameVersion(listeners, last(host)!.version), 8000);

    // 3. Skip vote: exactly a strict majority skips once; duplicates don't count.
    const needed = skipVotesNeeded(listeners.length);
    checks.threshold = last(host)?.skipNeeded === needed;
    const voters = listeners.slice(1, 1 + needed - 1); // one short
    for (const v of voters) {
      v.room.send(DJ.skipVote, {});
      v.room.send(DJ.skipVote, {});
    }
    checks.oneShort = await ctx.waitFor(() => last(host)?.skipVotes === needed - 1, 8000);
    checks.notSkipped = last(host)?.current?.trackId === 'neon-cruising';
    listeners[needed]!.room.send(DJ.skipVote, {});
    checks.skipped = await ctx.waitFor(() => last(host)?.current?.trackId === 'song-0' && last(host)?.skipVotes === 0, 8000);

    // 4. Churn: 8 guests leave, 8 new ones join and immediately get the current track.
    const leaving = listeners.slice(-8);
    await Promise.all(leaving.map((l) => l.room.leave(true).catch(() => undefined)));
    listeners = listeners.slice(0, -8);
    const joined = await Promise.all(Array.from({ length: 8 }, (_, i) => joinListener(ctx, code, `DJ Fan ${i + 1}`).catch(() => null)));
    const fresh = joined.filter((l): l is Listener => l !== null);
    listeners.push(...fresh);
    checks.lateJoin = fresh.length === 8 && (await ctx.waitFor(() => fresh.every((l) => last(l)?.current?.trackId === 'song-0'), 8000));
    checks.churnSync = await ctx.waitFor(() => sameVersion(listeners, last(host)!.version) && last(host)!.skipNeeded === skipVotesNeeded(listeners.length), 8000);

    // 5. Host migration: the host leaves; the music keeps its anchor and authority moves.
    const before = last(host)!;
    await host.room.leave(true);
    listeners = listeners.slice(1);
    checks.migrated = await ctx.waitFor(() => listeners.every((l) => {
      const s = last(l);
      return Boolean(s && s.djId !== before.djId && s.current?.trackId === before.current?.trackId && s.anchorServerTime === before.anchorServerTime);
    }), 8000);
    const heir = listeners.find((l) => l.playerId === last(listeners[0]!)?.djId);
    heir?.room.send(DJ.command, { op: 'next' });
    checks.heirControls = Boolean(heir) && (await ctx.waitFor(() => listeners.every((l) => last(l)?.current?.trackId === 'song-1'), 8000));

    // Consistency: every client ends on the host's exact state; versions never went backwards.
    const final = last(listeners[0]!)!;
    checks.consistent = await ctx.waitFor(() => listeners.every((l) => JSON.stringify(last(l)) === JSON.stringify(final)), 8000);
    checks.monotonic = listeners.every((l) => l.states.every((s, i) => i === 0 || s.version >= l.states[i - 1]!.version));
    const serverErrors = [...listeners, ...leaving].flatMap((l) => l.errors).filter((e) => e.code === 'server_error' || e.code === 'invalid_payload');
    checks.noErrors = serverErrors.length === 0;
    checks.connected = allConnected(listeners.map((l) => ({ room: l.room }) as unknown as Bot));

    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
    const messages = listeners.reduce((n, l) => n + l.states.length, 0);
    ctx.results.push({
      scenario: `dj ×${bots.length}`,
      ok: failures === 0 && failed.length === 0,
      details: `${failed.length ? `FAILED: ${failed.join(',')} · ` : ''}queue=${expectedQueue} vote=${needed}/${bots.length} scrubV=${scrubVersion} finalV=${final.version} dj:state msgs=${messages} joinFailures=${failures} ${(performance.now() - t0).toFixed(0)}ms`,
    });
    await Promise.all(listeners.map((l) => l.room.leave(true).catch(() => undefined)));
  });
}
