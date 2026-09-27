/**
 * The Tournament Center × real game room scenario shared by tournament-games*.test.ts: helpers to
 * seat participants with their tickets and drive games (see tournament-drivers.ts), and the full
 * 4-player best-of-3 bracket run for one game. Call `useBracketServer(colyseus)` in beforeAll (after
 * `useTournamentServer`).
 */
import { expect } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import { GAME_CATALOG, type GameId, type TournamentMatchView } from '@dascade/shared';
import { onOutcome } from '../src/platform/hub.ts';
import { sleep, waitFor } from './helpers.ts';
import { admin, kioskServer, participantOf, setupField, type Viewer } from './tournament-helpers.ts';
import { DRIVERS, joinMatchRoom, stateOf, type GameDriver, type MatchSeat } from './tournament-drivers.ts';

let colyseus: ColyseusTestServer;

export function useBracketServer(server: ColyseusTestServer): void {
  colyseus = server;
}

/** Organizer game settings per game (Memory Matrix: sudden death keeps each game to a round or two). */
export const GAME_SETTINGS: Partial<Record<GameId, Record<string, unknown>>> = {
  memory: { rule: 'sudden' },
  chess: { timeControl: { baseMinutes: 3, incrementSeconds: 2 } },
};

/** Rooms whose timings were already compressed (one call per launched match room). */
const prepared = new Set<string>();

export function prepareRoom(driver: GameDriver, roomCode: string): void {
  if (prepared.has(roomCode)) return;
  prepared.add(roomCode);
  driver.fast(colyseus.getRoomById(roomCode));
}

export async function matchWithRoom(org: Viewer, pick: (m: TournamentMatchView) => boolean, label: string): Promise<TournamentMatchView> {
  await waitFor(() => org.view().matches.some((m) => pick(m) && m.roomCode !== ''), 4000, label);
  return org.view().matches.find((m) => pick(m) && m.roomCode !== '')!;
}

/** Join the participant's current match room with their ticket. */
export async function seatFor(driver: GameDriver, v: Viewer, matchId: string): Promise<MatchSeat> {
  await waitFor(() => v.me().activeMatch?.matchId === matchId, 4000, `ticket for ${matchId}`);
  const active = v.me().activeMatch!;
  prepareRoom(driver, active.roomCode);
  const seat = await joinMatchRoom(colyseus, active.roomCode, { name: v.me().participantId!, ticket: active.ticket });
  seat.participantId = participantOf(v);
  return seat;
}

const participantEntry = (seat: MatchSeat, pid = seat.participantId) => seat.info().participants.find((p) => p.participantId === pid)!;

/** The participant on the 'first' side of the current game (sided games). */
function firstParticipant(seat: MatchSeat): string | undefined {
  return seat.info().participants.find((p) => p.side === 'first')?.participantId;
}

/** Sides follow the tournament: exactly one 'first', and the game seats that participant as its first mover. */
export function expectSides(driver: GameDriver, seats: [MatchSeat, MatchSeat]): string | undefined {
  const [a] = seats;
  const sides = a.info().participants.map((p) => p.side);
  if (!GAME_CATALOG[driver.gameId].tournament!.sides) {
    expect(sides.every((s) => s === undefined)).toBe(true);
    return undefined;
  }
  expect(sides.slice().sort()).toEqual(['first', 'second']);
  const first = firstParticipant(a)!;
  if (driver.firstMover) {
    const firstSeat = seats.find((s) => s.participantId === first)!;
    expect(driver.firstMover(a.server())).toBe(firstSeat.playerId());
  }
  return first;
}

/** Wait until game `n` of the series is live in the room (auto-started). */
export async function gameLive(driver: GameDriver, seat: MatchSeat, n: number): Promise<void> {
  await waitFor(
    () => seat.info().gameNumber === n && seat.info().seriesStatus === 'playing' && driver.live(seat),
    8000,
    `game ${n} live`,
  ).catch((err: Error) => {
    const st = stateOf(seat.room);
    const kiosk = kioskServer(seat.info().tournamentCode);
    const m = kiosk['engine'].match(seat.info().matchId);
    throw new Error(
      `${err.message} (${seat.room.roomId}: phase ${st.phase}, series ${seat.info().seriesStatus} game ${seat.info().gameNumber}, ${JSON.stringify(seat.errors.slice(-3))} games ${JSON.stringify(m?.games)})`,
    );
  });
}

export const gamesOf = (m: TournamentMatchView) =>
  JSON.parse(m.gamesJson) as Array<{ n: number; winnerId: string | null; firstId: string | null; decider: string }>;
export const matchById = (org: Viewer, id: string) => org.view().matches.find((m) => m.id === id)!;

/** Play one game to `outcome` and wait until the kiosk recorded it. */
export async function playGame(
  driver: GameDriver,
  org: Viewer,
  matchId: string,
  seats: [MatchSeat, MatchSeat],
  outcome: MatchSeat | 'draw',
): Promise<void> {
  const before = gamesOf(matchById(org, matchId)).length;
  if (outcome === 'draw') await driver.draw!(seats[0], seats[1]);
  else
    await driver.win(
      outcome,
      seats.find((s) => s !== outcome)!,
    );
  await waitFor(() => gamesOf(matchById(org, matchId)).length === before + 1, 20_000, `${matchId} game ${before + 1} recorded`);
  const game = gamesOf(matchById(org, matchId))[before]!;
  expect(game.winnerId).toBe(outcome === 'draw' ? null : outcome.participantId);
}

// ---------------------------------------------------------------------------
// The full bracket for one game
// ---------------------------------------------------------------------------

/**
 * 4-player best-of-3 single elimination through the real rooms: tickets, outsiders, auto-start,
 * sides and swaps, concurrent semis, duplicate/late reports, refused rematches, draws + deciders
 * (drawable games), the final and the champion.
 */
export async function runBracketScenario(gameId: GameId): Promise<void> {
  const driver = DRIVERS[gameId as GameId]!;
  const drawable = GAME_CATALOG[gameId].tournament!.draws && Boolean(driver.draw);
  const gameSettings = GAME_SETTINGS[gameId] ?? {};
  const { org, code, players } = await setupField(4, { gameId, format: 'single_elimination', bestOf: 3, gameSettings });
  const [p1, p2, p3, p4] = players as [Viewer, Viewer, Viewer, Viewer];
  await admin(org, 'seed', { method: 'manual', order: players.map(participantOf) });
  expect((await admin(org, 'begin')).ok).toBe(true);

  // Seed 1 v 4 and seed 2 v 3 get rooms and tickets.
  const semiA = await matchWithRoom(org, (m) => m.round === 1 && [m.aId, m.bId].includes(participantOf(p1)), 'semi A room');
  const semiB = await matchWithRoom(org, (m) => m.round === 1 && [m.aId, m.bId].includes(participantOf(p2)), 'semi B room');
  expect(new Set([semiA.aId, semiA.bId])).toEqual(new Set([participantOf(p1), participantOf(p4)]));
  await waitFor(() => players.every((p) => Boolean(p.me().activeMatch)), 4000, 'every ticket');
  expect(p1.me().activeMatch).toMatchObject({ gameId, matchId: semiA.id, roomCode: semiA.roomCode, opponentId: participantOf(p4) });

  // Outsiders can't take a seat: no ticket, a forged ticket, or another match's ticket → spectators.
  prepareRoom(driver, semiA.roomCode);
  const noTicket = await joinMatchRoom(colyseus, semiA.roomCode, { name: 'Lurker' });
  const forged = await joinMatchRoom(colyseus, semiA.roomCode, { name: 'Forger', ticket: 'f'.repeat(32) });
  const foreign = await joinMatchRoom(colyseus, semiA.roomCode, { name: 'Wanderer', ticket: p2.me().activeMatch!.ticket });
  for (const outsider of [noTicket, forged, foreign]) {
    const me = (stateOf(outsider.room).players as Map<string, { spectator: boolean }>).get(outsider.playerId());
    expect(me?.spectator).toBe(true);
  }
  await waitFor(() => forged.toasts.some((t) => /not valid here/.test(t.text)), 3000, 'forged-ticket notice');
  noTicket.room.send('lobby:spectate', { spectator: false });
  noTicket.room.send('lobby:start', {});
  await waitFor(() => noTicket.errors.length >= 2, 3000, 'outsider refused');
  expect((stateOf(noTicket.room).players as Map<string, { spectator: boolean }>).get(noTicket.playerId())?.spectator).toBe(true);

  // One participant alone never starts the game.
  const a1 = await seatFor(driver, p1, semiA.id);
  await sleep(120);
  expect(stateOf(a1.room).phase).toBe('LOBBY');
  expect(a1.info().seriesStatus).toBe('waiting');
  expect(participantEntry(a1).playerId).toBe(a1.playerId());

  // Everyone else takes their seat → both semifinals auto-start.
  const a4 = await seatFor(driver, p4, semiA.id);
  const b2 = await seatFor(driver, p2, semiB.id);
  const b3 = await seatFor(driver, p3, semiB.id);
  const seatsA: [MatchSeat, MatchSeat] = [a1, a4];
  const seatsB: [MatchSeat, MatchSeat] = [b2, b3];
  await Promise.all([gameLive(driver, a1, 1), gameLive(driver, b2, 1)]);
  for (const seat of [...seatsA, ...seatsB]) {
    const players = stateOf(seat.room).players as Map<string, { spectator: boolean }>;
    expect(players.get(seat.playerId())?.spectator).toBe(false);
  }
  await waitFor(
    () => matchById(org, semiA.id).status === 'IN_PROGRESS' && matchById(org, semiB.id).status === 'IN_PROGRESS',
    3000,
    'semis in progress',
  );
  // The organizer's game settings reached the match room.
  expect(JSON.parse(stateOf(a1.room).settingsJson as string)).toMatchObject(gameSettings);
  const firstA1 = expectSides(driver, seatsA);
  const firstB1 = expectSides(driver, seatsB);
  // The outsider is still just watching.
  expect((stateOf(noTicket.room).players as Map<string, { spectator: boolean }>).get(noTicket.playerId())?.spectator).toBe(true);

  // A buggy duplicate report in the very same tick as the real one (a second timer, a repeated
  // message…) is ignored by the room: it must not count as game 2.
  let duplicates = 0;
  const stopDuplicates = onOutcome((_outcome, ctx) => {
    if (ctx.roomCode !== semiA.roomCode || duplicates > 0) return;
    duplicates++;
    a1.server().reportOutcome({ placements: [[a4.playerId()], [a1.playerId()]], reason: 'duplicate' });
  });

  // Game 1 of both semis at once: seed 1 wins; semi B is drawn (or won by seed 3).
  try {
    await Promise.all([playGame(driver, org, semiA.id, seatsA, a1), playGame(driver, org, semiB.id, seatsB, drawable ? 'draw' : b3)]);
  } finally {
    stopDuplicates();
  }
  expect(duplicates).toBe(1);
  await waitFor(() => a1.info().seriesScore[a1.participantId] === 1, 3000, 'series score published');

  // Late deliveries to the kiosk change nothing: game 1 again, or a result from a stale room.
  const kiosk = kioskServer(code);
  const engineGames = () => JSON.stringify(kiosk['engine'].match(semiA.id)?.games);
  const recorded = engineGames();
  kiosk.matchGameOutcome(semiA.id, semiA.roomCode, 1, a4.participantId, 'duplicate');
  kiosk.matchGameOutcome(semiA.id, 'ZZZZZ', 2, a4.participantId, 'stale room');
  expect(engineGames()).toBe(recorded);
  expect(JSON.parse(recorded)).toHaveLength(1);

  // Game 2 starts by itself after the intermission, sides swapped.
  await Promise.all([gameLive(driver, a1, 2), gameLive(driver, b2, 2)]);
  if (firstA1) expect(expectSides(driver, seatsA)).not.toBe(firstA1);
  if (firstB1) expect(expectSides(driver, seatsB)).not.toBe(firstB1);
  expect(a1.info()).toMatchObject({ bestOf: 3, gameNumber: 2, decider: '' });

  // Semi A: seed 1 wins game 2 → 2–0; semi B: seed 2 wins game 2 — at the same time.
  await Promise.all([playGame(driver, org, semiA.id, seatsA, a1), playGame(driver, org, semiB.id, seatsB, b2)]);
  await waitFor(() => matchById(org, semiA.id).status === 'COMPLETE', 3000, 'semi A decided');
  expect(matchById(org, semiA.id)).toMatchObject({
    winnerId: a1.participantId,
    loserId: a4.participantId,
    resultKind: 'played',
    aPoints: 2,
    bPoints: 0,
  });
  await waitFor(() => a1.info().seriesStatus === 'decided', 3000, 'decided in the room');
  expect(a1.info().result).toMatchObject({ winnerId: a1.participantId, kind: 'played' });

  // A finished match can't be reported again (late room report / late kiosk delivery).
  const decided = JSON.stringify(kiosk['engine'].match(semiA.id));
  a1.server().reportOutcome({ placements: [[a4.playerId()], [a1.playerId()]], reason: 'late' });
  kiosk.matchGameOutcome(semiA.id, semiA.roomCode, 3, a4.participantId, 'late');
  expect(JSON.stringify(kiosk['engine'].match(semiA.id))).toBe(decided);
  await sleep(60);
  expect(matchById(org, semiA.id)).toMatchObject({ status: 'COMPLETE', winnerId: a1.participantId, aPoints: 2, bPoints: 0 });

  // The game's own rematch / play-again is refused in a tournament room (by the host, too), and the
  // lobby's "back to lobby" as well: the decided room keeps showing the result.
  await waitFor(() => stateOf(a1.room).phase === 'RESULTS', 3000, 'results screen');
  const host = [a1, a4].find((s) => stateOf(s.room).hostId === s.playerId())!;
  const refusals = host.errors.length;
  host.room.send(driver.rematch.type, driver.rematch.payload);
  host.room.send('lobby:toLobby', {});
  await waitFor(() => host.errors.length >= refusals + 2, 3000, 'rematch refused');
  expect(host.errors.slice(refusals).every((e) => e.code === 'not_allowed')).toBe(true);
  await sleep(60);
  expect(stateOf(a1.room).phase).toBe('RESULTS');
  expect(a1.info().seriesStatus).toBe('decided');
  expect(p4.view().participants.find((p) => p.id === a4.participantId)!.status).toBe('eliminated');

  // Semi B goes the distance: game 3 (sides back), and after a drawn game a sudden-death decider.
  await gameLive(driver, b2, 3);
  if (firstB1) expect(expectSides(driver, seatsB)).toBe(firstB1);
  await playGame(driver, org, semiB.id, seatsB, b3);
  if (drawable) {
    // ½–½, 1–0 seed 2, 0–1 seed 3 → level 1½–1½ → elimination decider.
    await gameLive(driver, b2, 4);
    expect(b2.info().decider).toBe('sudden_death');
    expect(b2.info().seriesScore).toEqual({ [b2.participantId]: 1.5, [b3.participantId]: 1.5 });
    await playGame(driver, org, semiB.id, seatsB, b3);
  }
  await waitFor(() => matchById(org, semiB.id).status === 'COMPLETE', 3000, 'semi B decided');
  expect(matchById(org, semiB.id).winnerId).toBe(b3.participantId);
  expect(gamesOf(matchById(org, semiB.id))).toHaveLength(drawable ? 4 : 3);

  // The final: the two winners, a fresh room and fresh tickets.
  const final = await matchWithRoom(org, (m) => m.round === 2, 'final room');
  expect(final.label).toBe('Final');
  expect(new Set([final.aId, final.bId])).toEqual(new Set([participantOf(p1), participantOf(p3)]));
  expect(org.view().matches.filter((m) => m.status === 'READY' || m.status === 'IN_PROGRESS')).toHaveLength(1);
  const f1 = await seatFor(driver, p1, final.id);
  const f3 = await seatFor(driver, p3, final.id);
  const seatsF: [MatchSeat, MatchSeat] = [f1, f3];
  await gameLive(driver, f1, 1);
  const firstF1 = expectSides(driver, seatsF);
  await playGame(driver, org, final.id, seatsF, f1);
  await gameLive(driver, f1, 2);
  if (firstF1) expect(expectSides(driver, seatsF)).not.toBe(firstF1);
  await playGame(driver, org, final.id, seatsF, f1);

  await waitFor(() => org.view().status === 'COMPLETE', 4000, 'tournament complete');
  const done = org.view();
  expect(done.championId).toBe(participantOf(p1));
  expect(done.participants.find((p) => p.id === participantOf(p1))!.status).toBe('champion');
  expect(done.standings.final).toBe(true);
  expect(done.standings.rows.find((r) => r.participantId === participantOf(p1))!.rank).toBe(1);
  expect(done.standings.rows.find((r) => r.participantId === participantOf(p3))!.rank).toBe(2);
  await waitFor(() => f1.info().seriesStatus === 'decided', 3000, 'final decided in the room');
  await waitFor(() => p1.me().activeMatch === null && p3.me().activeMatch === null, 3000, 'no more matches');
  expect(done.audit.some((e) => e.action === 'lots')).toBe(false);
}
