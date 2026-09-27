/**
 * DASception — 30 synthetic clients: 20 players (the game's maximum) + 10 spectators play one
 * full cycle. Checks: every player gets exactly one private role matching the public setup,
 * spectators and Sysops receive nothing private they shouldn't (roles, Glitch channel), a burst of
 * simultaneous night actions / ready / votes is absorbed, and every client sees the same verdict.
 */
import {
  DECEPTION_MSG,
  roleTeam,
  type DeceptionPrivate,
  type DeceptionSetup,
  type DeceptionVerdict,
} from '@dascade/shared/games/deception';
import {
  allConnected,
  burst,
  errorCount,
  json,
  leaked,
  timeUntil,
  waitForStage,
  type AddScenario,
  type Bot,
  type ScenarioContext,
} from './helpers.ts';

const latest = (b: Bot): DeceptionPrivate | null => {
  const list = (b.payloads.get(DECEPTION_MSG.private) ?? []) as DeceptionPrivate[];
  return list.at(-1) ?? null;
};

export function register(add: AddScenario, ctx: ScenarioContext): void {
  add('deception', async () => {
    const { bots } = await ctx.createBots('deception', ctx.N, [DECEPTION_MSG.private, DECEPTION_MSG.team], {
      maxPlayers: 20,
      settings: { nightSeconds: 20, discussionSeconds: 30, voteSeconds: 20 },
    });
    const host = bots[0]!;
    host.room.send('lobby:start', {});
    if (!(await waitForStage(ctx, host, 'boot', 15_000))) throw new Error('never reached the role reveal');
    const nodes = () => json(host).nodes as Record<string, { alive: boolean; role: string }>;
    const players = bots.filter((b) => nodes()[b.playerId]);
    const spectators = bots.filter((b) => !nodes()[b.playerId]);
    const dealt = await ctx.waitFor(() => players.every((b) => latest(b)?.role), 8000);

    // Roles: one per player, counts match the public setup, no role in public state.
    const setup = JSON.parse(json(host).setupJson) as DeceptionSetup;
    const counts: Record<string, number> = {};
    for (const b of players) counts[latest(b)!.role!] = (counts[latest(b)!.role!] ?? 0) + 1;
    const countsOk = Object.entries(setup.counts).every(([role, n]) => (counts[role] ?? 0) === n);
    const publicClean = bots.every((b) => Object.values(json(b).nodes as Record<string, { role: string }>).every((n) => n.role === ''));
    const spectatorsClean = spectators.every((b) => (b.payloads.get(DECEPTION_MSG.private) ?? []).length === 0);
    const glitches = players.filter((b) => roleTeam(latest(b)!.role!) === 'glitches');
    const sysops = players.filter((b) => !glitches.includes(b));

    // Boot → night: everyone reads their card at once.
    await burst(ctx, players, (b) => b.room.send(DECEPTION_MSG.ready, { ready: true }), 200);
    const toNight = await timeUntil(ctx, () => json(host).stage === 'night', 8000);

    // Night: every ability at once; the Glitches chat privately.
    const order = Object.keys(nodes());
    const victim = order.find((id) => !glitches.some((g) => g.playerId === id))!;
    glitches[0]?.room.send(DECEPTION_MSG.teamSay, { text: 'secret-load-plan' });
    await burst(
      ctx,
      players,
      (b) => {
        const role = latest(b)!.role;
        const other = order.find((id) => id !== b.playerId && id !== victim) ?? victim;
        if (role === 'glitch' || role === 'jammer') b.room.send(DECEPTION_MSG.act, { kind: 'attack', target: victim, lock: true });
        if (role === 'jammer')
          b.room.send(DECEPTION_MSG.act, {
            kind: 'jam',
            target: order.find((id) => !glitches.some((g) => g.playerId === id) && id !== victim)!,
            lock: true,
          });
        if (role === 'scanner') b.room.send(DECEPTION_MSG.act, { kind: 'scan', target: other, lock: true });
        if (role === 'firewall') b.room.send(DECEPTION_MSG.act, { kind: 'shield', target: b.playerId, lock: true });
      },
      200,
    );
    const toDawn = await timeUntil(ctx, () => json(host).stage === 'dawn', 25_000);
    const teamOk = glitches.every((g) => JSON.stringify(g.payloads.get(DECEPTION_MSG.team) ?? []).includes('secret-load-plan'));
    const teamPrivate = !leaked([...sysops, ...spectators], 'secret-load-plan');
    const nightSilent = !leaked([...sysops, ...spectators], `"target":"${victim}"`, [DECEPTION_MSG.private]);

    // Day → vote → verdict.
    if (!(await waitForStage(ctx, host, 'day', 15_000))) throw new Error('never reached the day');
    const living = () => players.filter((b) => nodes()[b.playerId]?.alive);
    await burst(ctx, living(), (b) => b.room.send(DECEPTION_MSG.ready, { ready: true }), 200);
    if (!(await waitForStage(ctx, host, 'vote', 10_000))) throw new Error('never reached the vote');
    const suspect = glitches.find((g) => nodes()[g.playerId]?.alive)?.playerId ?? victim;
    const votersSnapshot = living();
    await burst(ctx, votersSnapshot, (b) => b.room.send(DECEPTION_MSG.vote, { target: b.playerId === suspect ? 'skip' : suspect }), 250);
    const voteMs = await timeUntil(ctx, () => json(host).answeredCount === votersSnapshot.length, 8000);
    const toVerdict = await timeUntil(ctx, () => json(host).stage === 'verdict', 8000);
    await ctx.waitFor(() => bots.every((b) => json(b).verdictJson !== ''), 5000);
    const verdicts = bots.map((b) => JSON.parse(json(b).verdictJson || '{}') as DeceptionVerdict);
    const sameVerdict = new Set(verdicts.map((v) => `${v.outcome}|${v.playerId}|${v.tally?.map((t) => t.votes).join(',')}`)).size === 1;
    const disconnected = verdicts[0]?.outcome === 'disconnected' && verdicts[0]?.playerId === suspect;

    const ok =
      dealt &&
      countsOk &&
      publicClean &&
      spectatorsClean &&
      teamOk &&
      teamPrivate &&
      nightSilent &&
      toNight >= 0 &&
      toDawn >= 0 &&
      voteMs >= 0 &&
      toVerdict >= 0 &&
      sameVerdict &&
      disconnected &&
      allConnected(bots);
    ctx.results.push({
      scenario: `deception ${players.length} players + ${spectators.length} spectators`,
      ok,
      details: `roles-dealt=${dealt} counts=${countsOk} public-clean=${publicClean} spectators-clean=${spectatorsClean} team-channel=${teamOk}/${teamPrivate} night-silent=${nightSilent} boot→night=${toNight.toFixed(0)}ms night→dawn=${toDawn.toFixed(0)}ms (8s floor) all-voted=${voteMs.toFixed(0)}ms verdict=${toVerdict.toFixed(0)}ms same-verdict=${sameVerdict} glitch-out=${disconnected} errors=${errorCount(bots)}`,
    });
    await ctx.leaveAll(bots);
  });
}
