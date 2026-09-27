/**
 * Tournament Center × EVERY tournament-capable game, end to end with the real game rooms.
 *
 * For each game in the catalog with `tournament` (chess, checkers, ships, putt, paddle, snake,
 * memory) a 4-player best-of-3 single-elimination bracket runs through server-created match rooms:
 * tickets seat the participants (outsiders only spectate), games auto-start, sided games put the
 * 'first' participant on the first-mover side and swap sides every game, series progress (draws and
 * deciders included where a game can draw), both semifinals complete concurrently, duplicate and late
 * reports change nothing, the final is launched and the champion recorded.
 *
 * Further tests (spread over different games): a no-show forfeit through a real room, an organizer
 * override mid-game (audited; the room closes; a late result is ignored), simultaneous completion of
 * two matches in the same tick, and a relaunched room continuing its series.
 */
process.env.DASCADE_TOURNAMENT_START_DELAY_MS = '30';
process.env.DASCADE_TOURNAMENT_INTERMISSION_MS = '150';
process.env.DASCADE_TOURNAMENT_CLOSE_DELAY_MS = '80';
process.env.DASCADE_TOURNAMENT_NOSHOW_MS = '700';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import { GAME_CATALOG, TOURNAMENT_GAME_LIST } from '@dascade/shared';
import { SHIPS_TOURNAMENT_TURN_SECONDS } from '@dascade/shared/games/ships';
import { bootTestServer, sleep, waitFor } from './helpers.ts';
import { admin, participantOf, setupField, useTournamentServer, type Viewer } from './tournament-helpers.ts';
import { DRIVERS, stateOf, type MatchSeat } from './tournament-drivers.ts';
import {
  expectSides,
  gameLive,
  gamesOf,
  matchById,
  matchWithRoom,
  playGame,
  runBracketScenario,
  seatFor,
  useBracketServer,
} from './tournament-bracket.ts';

const TOURNAMENT_GAMES = TOURNAMENT_GAME_LIST.map((g) => g.id);

/** Real-time arcade games run in tournament-games-arcade.test.ts (a separate file so both run in parallel). */
const ARCADE_GAMES = ['putt', 'paddle', 'snake'];
const GAMES_HERE = TOURNAMENT_GAMES.filter((id) => !ARCADE_GAMES.includes(id));

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['tournament', ...TOURNAMENT_GAMES]));
  useTournamentServer(colyseus);
  useBracketServer(colyseus);
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

// ---------------------------------------------------------------------------
// Every tournament-capable game, end to end
// ---------------------------------------------------------------------------

describe('Tournament Center × real game rooms', () => {
  it('covers every tournament-capable game in the catalog', () => {
    expect(TOURNAMENT_GAMES.slice().sort()).toEqual(Object.keys(DRIVERS).sort());
    expect(ARCADE_GAMES.every((id) => TOURNAMENT_GAMES.includes(id as (typeof TOURNAMENT_GAMES)[number]))).toBe(true);
    // Games whose rooms honour participants[].side must declare sides so the kiosk assigns and balances them.
    for (const id of TOURNAMENT_GAMES) expect(GAME_CATALOG[id].tournament!.sides, id).toBe(DRIVERS[id]!.sided);
  });

  for (const gameId of GAMES_HERE) {
    it(
      `${gameId}: 4-player best-of-3 bracket — tickets, auto-start, sides, series, concurrent semis, champion`,
      () => runBracketScenario(gameId),
      120_000,
    );
  }
});

// ---------------------------------------------------------------------------
// No-shows, overrides, simultaneous results, relaunches — through real rooms
// ---------------------------------------------------------------------------

describe('Tournament Center × real game rooms — edge cases', () => {
  it('ships: an untimed tournament game still has a turn clock; an idle captain forfeits and the bracket advances', async () => {
    const driver = DRIVERS.ships!;
    // The organizer asked for untimed turns (settings the wizard doesn't offer, sent raw).
    const { org, players } = await setupField(2, { gameId: 'ships', gameSettings: { turnSeconds: 0, placementSeconds: 30 } });
    await admin(org, 'begin');
    const [a, b] = players as [Viewer, Viewer];
    const match = await matchWithRoom(org, () => true, 'match room');
    const sa = await seatFor(driver, a, match.id);
    const sb = await seatFor(driver, b, match.id);
    await gameLive(driver, sa, 1);
    const server = sa.server();
    expect(server.settings.turnSeconds).toBe(0);
    // Nobody deploys: the deployment clock locks random fleets in and the battle opens anyway.
    expect(stateOf(sa.room).clockMs).toBe(30_000);
    server.cancel('placement');
    server.beginBattle();
    await waitFor(() => stateOf(sa.room).stage === 'battle', 3000, 'battle');
    // Untimed in the lobby, but a tournament game gets SHIPS_TOURNAMENT_TURN_SECONDS so it can't stall.
    expect(stateOf(sa.room).clockMs).toBe(SHIPS_TOURNAMENT_TURN_SECONDS * 1000);
    const first = sa.info().participants.find((p) => p.side === 'first')!;
    expect(stateOf(sa.room).turnId).toBe(first.playerId);
    // Nobody fires: SHIPS_TIMEOUT_STRIKES timeouts in a row forfeit the captain who had the first turn.
    server.timing = { ...server.timing, turnMs: 40 };
    server.startTurn(stateOf(sa.room).turnId as string);
    await waitFor(() => org.view().status === 'COMPLETE', 6000, 'forfeit on time');
    const loser = first.participantId;
    const winner = [sa, sb].find((s) => s.participantId !== loser)!.participantId;
    expect(org.view().championId).toBe(winner);
    expect(JSON.parse(matchById(org, match.id).gamesJson)[0]).toMatchObject({ winnerId: winner, reason: 'timeout' });
  });

  it('no-show: the absent participant forfeits; the waiting room closes and the champion is recorded (memory)', async () => {
    const driver = DRIVERS.memory!;
    const { org, players } = await setupField(2, { gameId: 'memory', noShowMinutes: 1 });
    await admin(org, 'begin');
    const [a, b] = players as [Viewer, Viewer];
    const match = await matchWithRoom(org, () => true, 'match room');
    const seat = await seatFor(driver, a, match.id);
    await waitFor(() => matchById(org, match.id).noShowAt > 0, 3000, 'no-show clock');
    expect(stateOf(seat.room).phase).toBe('LOBBY');
    await waitFor(() => org.view().status === 'COMPLETE', 5000, 'forfeit');
    expect(matchById(org, match.id)).toMatchObject({
      status: 'FORFEIT',
      resultKind: 'forfeit',
      winnerId: participantOf(a),
      loserId: participantOf(b),
    });
    expect(org.view().championId).toBe(participantOf(a));
    expect(org.view().audit.find((e) => e.action === 'no_show')).toMatchObject({
      actor: 'system',
      participantId: participantOf(b),
      matchId: match.id,
    });
    await waitFor(() => seat.removed.length > 0, 3000, 'match room closed');
    expect(seat.info().seriesStatus).toBe('void');
  });

  it('memory head-to-head: an opponent who leaves forfeits at once; a later exit by the winner changes nothing', async () => {
    const driver = DRIVERS.memory!;
    const { org, players } = await setupField(2, { gameId: 'memory', bestOf: 1 });
    await admin(org, 'begin');
    const [a, b] = players as [Viewer, Viewer];
    const match = await matchWithRoom(org, () => true, 'match room');
    const sa = await seatFor(driver, a, match.id);
    const sb = await seatFor(driver, b, match.id);
    await gameLive(driver, sa, 1);
    await waitFor(() => stateOf(sa.room).stage === 'input', 5000, 'round 1 input');
    // A walks out mid-round with 3 lives left each: B doesn't have to play on alone — the match is decided now.
    await sa.room.leave(true);
    await waitFor(() => org.view().status === 'COMPLETE', 1500, 'decided at once');
    expect(matchById(org, match.id)).toMatchObject({ status: 'COMPLETE', resultKind: 'played', winnerId: participantOf(b), draw: false });
    expect(org.view().championId).toBe(participantOf(b));
    await waitFor(() => sb.info().seriesStatus === 'decided', 3000, 'decided in the room');
    // B heading back to the kiosk afterwards changes nothing.
    const decided = JSON.stringify(matchById(org, match.id));
    await sb.room.leave(true);
    await sleep(100);
    expect(JSON.stringify(matchById(org, match.id))).toBe(decided);
  });

  it('organizer override mid-game: audited, the room closes, the bracket advances, a late result is ignored (snake)', async () => {
    const driver = DRIVERS.snake!;
    const { org, players } = await setupField(4, { gameId: 'snake', format: 'single_elimination', bestOf: 1 });
    await admin(org, 'seed', { method: 'manual', order: players.map(participantOf) });
    await admin(org, 'begin');
    const [p1, p2, p3, p4] = players as [Viewer, Viewer, Viewer, Viewer];
    const semiA = await matchWithRoom(org, (m) => m.round === 1 && [m.aId, m.bId].includes(participantOf(p1)), 'semi A');
    const s1 = await seatFor(driver, p1, semiA.id);
    const s4 = await seatFor(driver, p4, semiA.id);
    await gameLive(driver, s1, 1);
    const server = s1.server();
    const ack = await admin(org, 'override', {
      matchId: semiA.id,
      outcome: 'win',
      winnerId: participantOf(p4),
      reason: 'Seed 1 had to leave early',
      confirm: true,
    });
    expect(ack.ok).toBe(true);
    expect(matchById(org, semiA.id)).toMatchObject({ status: 'COMPLETE', resultKind: 'override', winnerId: participantOf(p4) });
    expect(org.view().audit.find((e) => e.action === 'override')).toMatchObject({
      actor: 'organizer',
      matchId: semiA.id,
      reason: 'Seed 1 had to leave early',
    });
    await waitFor(() => s1.info().seriesStatus === 'void', 3000, 'room told');
    await waitFor(() => s1.toasts.some((t) => /organizer decision/.test(t.text)), 3000, 'room toast');
    // The snake game ends in the (closing) room anyway: its late result changes nothing.
    const before = JSON.stringify(org.view().matches);
    server.finishMatch('survival');
    await sleep(50);
    expect(JSON.stringify(org.view().matches)).toBe(before);
    await waitFor(() => s1.removed.length > 0 && s4.removed.length > 0, 3000, 'room closed');
    // The other semi still decides the final's second slot normally.
    const semiB = await matchWithRoom(org, (m) => m.round === 1 && [m.aId, m.bId].includes(participantOf(p2)), 'semi B');
    const b2 = await seatFor(driver, p2, semiB.id);
    const b3 = await seatFor(driver, p3, semiB.id);
    await gameLive(driver, b2, 1);
    await playGame(driver, org, semiB.id, [b2, b3], b2);
    const final = await matchWithRoom(org, (m) => m.round === 2, 'final');
    expect(new Set([final.aId, final.bId])).toEqual(new Set([participantOf(p2), participantOf(p4)]));
  }, 60_000);

  it('a drawn chess final: sudden-death decider, then Armageddon — a draw goes to the second side, never the first', async () => {
    const driver = DRIVERS.chess!;
    const { org, players } = await setupField(2, { gameId: 'chess', bestOf: 1 });
    await admin(org, 'begin');
    const [a, b] = players as [Viewer, Viewer];
    const match = await matchWithRoom(org, () => true, 'final room');
    const seats: [MatchSeat, MatchSeat] = [await seatFor(driver, a, match.id), await seatFor(driver, b, match.id)];
    const [sa] = seats;
    // Game 1 drawn → decider 1 (sudden death) drawn → decider 2 is Armageddon.
    for (const n of [1, 2]) {
      await gameLive(driver, sa, n);
      await playGame(driver, org, match.id, seats, 'draw');
    }
    await gameLive(driver, sa, 3);
    expect(sa.info().decider).toBe('armageddon');
    const second = sa.info().participants.find((p) => p.side === 'second')!.participantId;
    const first = expectSides(driver, seats)!;
    expect(second).not.toBe(first);
    await playGame(driver, org, match.id, seats, 'draw');
    await waitFor(() => org.view().status === 'COMPLETE', 3000, 'decided');
    expect(matchById(org, match.id)).toMatchObject({ winnerId: second, loserId: first, resultKind: 'played', resultNote: 'Armageddon' });
    expect(org.view().championId).toBe(second);
    expect(gamesOf(matchById(org, match.id)).map((g) => g.decider)).toEqual(['', 'sudden_death', 'armageddon']);
  });

  it('paddle: the house paddle never plays for a dropped tournament participant', async () => {
    const driver = DRIVERS.paddle!;
    const { org, players } = await setupField(2, { gameId: 'paddle', gameSettings: { ai: 'legend' } });
    await admin(org, 'begin');
    const [a, b] = players as [Viewer, Viewer];
    const match = await matchWithRoom(org, () => true, 'match room');
    const sa = await seatFor(driver, a, match.id);
    const sb = await seatFor(driver, b, match.id);
    await gameLive(driver, sa, 1);
    const server = sa.server();
    const side = server.state.left.playerId === sb.playerId() ? 0 : 1;
    // B's connection drops (auto-reconnect slowed so the gap is observable).
    sb.room.reconnection.minUptime = 0;
    sb.room.reconnection.delay = 600;
    sb.room.reconnection.minDelay = 600;
    sb.room.reconnection.maxDelay = 600;
    const back = new Promise<void>((resolve) => sb.room.onReconnect(() => resolve()));
    (sb.room as unknown as { connection: { transport: { ws: WebSocket } } }).connection.transport.ws.close(4010);
    await waitFor(() => server.players.get(sb.playerId())?.client === null, 3000, 'B dropped');
    await sleep(100);
    expect(server.covering[side]).toBe(false);
    expect(server.brains[side]).toBeNull();
    expect(server.state[side === 0 ? 'left' : 'right'].ai).toBe(false);
    await back;
    await waitFor(() => Boolean(server.players.get(sb.playerId())?.client), 3000, 'B back');
    expect(server.covering[side]).toBe(false);
    expect(stateOf(sb.room).phase).toBe('PLAYING');
  });

  it('two matches finishing in the same tick advance exactly once each (chess)', async () => {
    const driver = DRIVERS.chess!;
    const { org, players } = await setupField(4, { gameId: 'chess', format: 'single_elimination', bestOf: 1 });
    await admin(org, 'seed', { method: 'manual', order: players.map(participantOf) });
    await admin(org, 'begin');
    const [p1, p2, p3, p4] = players as [Viewer, Viewer, Viewer, Viewer];
    const semiA = await matchWithRoom(org, (m) => m.round === 1 && [m.aId, m.bId].includes(participantOf(p1)), 'semi A');
    const semiB = await matchWithRoom(org, (m) => m.round === 1 && [m.aId, m.bId].includes(participantOf(p2)), 'semi B');
    const seats = await Promise.all([
      seatFor(driver, p1, semiA.id),
      seatFor(driver, p4, semiA.id),
      seatFor(driver, p2, semiB.id),
      seatFor(driver, p3, semiB.id),
    ]);
    await Promise.all([gameLive(driver, seats[0]!, 1), gameLive(driver, seats[2]!, 1)]);
    const roomA = seats[0]!.server();
    const roomB = seats[2]!.server();
    const winnerSide = (room: ReturnType<MatchSeat['server']>, playerId: string) =>
      room.state.seats[0].playerId === playerId ? 'first' : 'second';
    // Seed 4 and seed 3 win in the very same synchronous block — and each room reports twice.
    roomA.finish({ winner: winnerSide(roomA, seats[1]!.playerId()), reason: 'resign' });
    roomB.finish({ winner: winnerSide(roomB, seats[3]!.playerId()), reason: 'resign' });
    roomA.finish({ winner: winnerSide(roomA, seats[0]!.playerId()), reason: 'resign' });
    roomB.reportOutcome({ placements: [[seats[2]!.playerId()], [seats[3]!.playerId()]], reason: 'duplicate' });
    await waitFor(() => org.view().matches.find((m) => m.round === 2)?.status === 'READY', 3000, 'final ready');
    const final = org.view().matches.find((m) => m.round === 2)!;
    expect(new Set([final.aId, final.bId])).toEqual(new Set([participantOf(p3), participantOf(p4)]));
    for (const id of [semiA.id, semiB.id]) expect(gamesOf(matchById(org, id))).toHaveLength(1);
    expect(org.view().matches.filter((m) => m.status === 'READY' || m.status === 'IN_PROGRESS')).toHaveLength(1);
    expect(matchById(org, semiA.id).winnerId).toBe(participantOf(p4));
    expect(matchById(org, semiB.id).winnerId).toBe(participantOf(p3));
  });

  it('a relaunched match room keeps the series: tickets, score, sides and the game number continue (paddle)', async () => {
    const driver = DRIVERS.paddle!;
    const { org, players } = await setupField(2, { gameId: 'paddle', bestOf: 3 });
    await admin(org, 'begin');
    const [a, b] = players as [Viewer, Viewer];
    const match = await matchWithRoom(org, () => true, 'match room');
    const sa = await seatFor(driver, a, match.id);
    const sb = await seatFor(driver, b, match.id);
    await gameLive(driver, sa, 1);
    const firstGame1 = expectSides(driver, [sa, sb]);
    await playGame(driver, org, match.id, [sa, sb], sa);
    const oldCode = match.roomCode;
    const ticket = a.me().activeMatch!.ticket;
    await colyseus.getRoomById(oldCode).disconnect();
    await waitFor(() => Boolean(a.me().activeMatch && a.me().activeMatch!.roomCode !== oldCode), 4000, 'relaunched');
    expect(a.me().activeMatch!.ticket).toBe(ticket);
    const ra = await seatFor(driver, a, match.id);
    const rb = await seatFor(driver, b, match.id);
    await gameLive(driver, ra, 2);
    expect(ra.info().seriesScore[ra.participantId]).toBe(1);
    expect(expectSides(driver, [ra, rb])).not.toBe(firstGame1);
    await playGame(driver, org, match.id, [ra, rb], ra);
    await waitFor(() => org.view().status === 'COMPLETE', 3000, 'complete');
    expect(org.view().championId).toBe(participantOf(a));
    expect(org.view().audit.some((e) => e.action === 'relaunch')).toBe(true);
  }, 40_000);
});
