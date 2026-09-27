/**
 * Tournament Center integration tests: the kiosk room, server-created match rooms bound by an
 * in-process binding, ticket seating, series driving, automatic advancement, idempotency,
 * organizer powers, private-message isolation, reconnects, no-shows and relaunches.
 *
 * Match games are a fixture duel room registered (only in this test server) under the ids of
 * tournament-capable games: 'checkers' (sides + draws) and 'snake' (no sides).
 */
process.env.DASCADE_TOURNAMENT_START_DELAY_MS = '30';
process.env.DASCADE_TOURNAMENT_INTERMISSION_MS = '150';
process.env.DASCADE_TOURNAMENT_CLOSE_DELAY_MS = '80';
process.env.DASCADE_TOURNAMENT_NOSHOW_MS = '600';
process.env.DASCADE_TOURNAMENT_IDLE_MS = '1200';
process.env.DASCADE_TOURNAMENT_DRAFT_IDLE_MS = '1200';
process.env.DASCADE_TOURNAMENT_UNCLAIMED_IDLE_MS = '1500';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { Room } from '@colyseus/core';
import { TOURNAMENT_MSG, type TournamentListResponse } from '@dascade/shared';
import { createDascadeServer } from '../src/server.ts';
import { MATCH_BINDING_OPTION } from '../src/platform/tournaments.ts';
import { setTournamentCaps } from '../src/rooms/tournament/TournamentRoom.ts';
import { collect, freePort, quiet, sleep, waitFor } from './helpers.ts';
import { SidelessDuelRoom, TournamentDuelRoom } from './fixtures/TournamentDuelRoom.ts';
import {
  admin,
  createKiosk,
  joinKiosk,
  kioskServer,
  participantOf,
  send,
  setupField,
  takeSeat,
  useTournamentServer,
  waitPhase,
  type Viewer,
} from './tournament-helpers.ts';

let colyseus: ColyseusTestServer;
let port = 0;

beforeAll(async () => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const p = await freePort();
    const server = await createDascadeServer({
      games: ['tournament'],
      extraRooms: { checkers: TournamentDuelRoom as unknown as new () => Room, snake: SidelessDuelRoom as unknown as new () => Room },
    });
    try {
      await server.listen(p);
      colyseus = new ColyseusTestServer(server);
      useTournamentServer(colyseus);
      port = p;
      return;
    } catch (err) {
      lastError = err;
      await server.gracefullyShutdown(false).catch(() => undefined);
    }
  }
  throw lastError;
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Tournament Center — kiosk', () => {
  it('creator is the organizer, gets a private organizer token, and host powers are organizer-only', async () => {
    const org = await createKiosk({ name: 'Friday Blitz' });
    expect(org.me().isOrganizer).toBe(true);
    expect(org.me().organizerToken).toMatch(/^[A-Za-z0-9]{32}$/);
    const view = org.view();
    expect(view.status).toBe('DRAFT');
    expect(view.config.name).toBe('Friday Blitz');
    expect(view.organizerName).toBe('Organizer');
    const guest = await joinKiosk(org.room.roomId, 'Guest');
    expect(guest.me()).toEqual({ isOrganizer: false, organizerToken: null, participantId: null, participantToken: null, activeMatch: null });
    // Non-organizer admin actions are refused.
    const denied = await admin(guest, 'openRegistration');
    expect(denied).toMatchObject({ ok: false, message: 'Only the organizer can do that.' });
    expect(guest.view().status).toBe('DRAFT');
    // Lobby controls that don't apply are refused gracefully.
    org.room.send('lobby:start', {});
    guest.room.send('lobby:ready', { ready: true });
    await waitFor(() => org.errors.length > 0 && guest.errors.length > 0, 3000, 'lobby rejections');
    expect(org.errors[0]!.message).toMatch(/organizer console/);
    // Host powers can't be handed to a non-organizer, and settings go through updateConfig only.
    const before = org.errors.length;
    org.room.send('lobby:transferHost', { playerId: guest.playerId() });
    org.room.send('lobby:settings', { settings: { name: 'Hijacked' } });
    await waitFor(() => org.errors.length >= before + 2, 3000, 'host/settings rejections');
    expect((org.room.state as unknown as { hostId: string }).hostId).toBe(org.playerId());
    expect(org.view().organizerId).toBe(org.playerId());
    expect(org.view().config.name).toBe('Friday Blitz');
    expect((await admin(org, 'updateConfig', { config: { name: 'Friday Rapid', bestOf: 3 } })).ok).toBe(true);
    expect(org.view().config).toMatchObject({ name: 'Friday Rapid', bestOf: 3 });
    // Capability checks: checkers has no best-of-4.
    expect(await admin(org, 'updateConfig', { config: { bestOf: 4 } })).toMatchObject({ ok: false });
  });

  it('registration, check-in and the public listing', async () => {
    const org = await createKiosk({ checkIn: true, checkInMinutes: 0 });
    const code = org.room.roomId;
    const list = async () => (await (await fetch(`http://localhost:${port}/api/tournaments`)).json()) as TournamentListResponse;
    expect((await list()).tournaments.find((t) => t.code === code)).toBeUndefined(); // drafts aren't listed
    await admin(org, 'openRegistration');
    const a = await joinKiosk(code, 'Ada');
    const b = await joinKiosk(code, 'Bo');
    expect((await send(a, TOURNAMENT_MSG.register, { name: 'Ada L' })).ok).toBe(true);
    expect((await send(a, TOURNAMENT_MSG.register, {})).ok).toBe(false); // already registered
    expect((await send(b, TOURNAMENT_MSG.register, {})).ok).toBe(true);
    await waitFor(() => Boolean(a.me().participantToken), 3000, 'token');
    expect(a.me().participantToken).not.toBe(b.me().participantToken);
    const lookup = (await (await fetch(`http://localhost:${port}/api/rooms/${code}`)).json()) as { exists: boolean; gameId: string };
    expect(lookup).toMatchObject({ exists: true, gameId: 'tournament' });
    const listing = (await list()).tournaments.find((t) => t.code === code)!;
    expect(listing).toMatchObject({ name: 'Office Open', gameId: 'checkers', status: 'REGISTRATION', participants: 2, checkIn: true });
    // Check-in before it opens is refused; then works.
    expect((await send(a, TOURNAMENT_MSG.checkIn, {})).ok).toBe(false);
    await admin(org, 'closeRegistration');
    expect(org.view().status).toBe('CHECK_IN');
    expect((await send(a, TOURNAMENT_MSG.checkIn, {})).ok).toBe(true);
    await admin(org, 'closeCheckIn');
    const view = org.view();
    expect(view.status).toBe('READY');
    expect(view.participants.find((p) => p.name === 'Ada L')!.status).toBe('checked_in');
    expect(view.participants.find((p) => p.name === 'Bo')!.status).toBe('no_show');
    // A single checked-in player can't start.
    expect(await admin(org, 'begin')).toMatchObject({ ok: false });
    await admin(org, 'cancel', { reason: 'not enough players', confirm: true });
    expect(org.view().status).toBe('CANCELLED');
    expect((await list()).tournaments.find((t) => t.code === code)).toBeUndefined();
    expect(org.view().audit.at(-1)).toMatchObject({ action: 'cancel', reason: 'not enough players' });
  });

  it('secrets never leak: tokens and tickets go only to their owner; state carries none', async () => {
    const { org, players } = await setupField(2);
    await admin(org, 'begin');
    await waitFor(() => players.every((p) => Boolean(p.me().activeMatch)), 3000, 'tickets');
    const [a, b] = players as [Viewer, Viewer];
    const secrets = [org.me().organizerToken!, a.me().participantToken!, b.me().participantToken!, a.me().activeMatch!.ticket, b.me().activeMatch!.ticket];
    expect(new Set(secrets).size).toBe(5);
    const everyMe = (v: Viewer) => JSON.stringify(v.mes);
    expect(everyMe(a)).not.toContain(b.me().participantToken!);
    expect(everyMe(a)).not.toContain(b.me().activeMatch!.ticket);
    expect(everyMe(b)).not.toContain(a.me().activeMatch!.ticket);
    expect(everyMe(a)).not.toContain(org.me().organizerToken!);
    const spectator = await joinKiosk(org.room.roomId, 'Watcher');
    expect(spectator.me()).toMatchObject({ participantToken: null, organizerToken: null, activeMatch: null });
    const stateJson = JSON.stringify((org.room.state as unknown as { toJSON(): unknown }).toJSON());
    for (const s of secrets) expect(stateJson).not.toContain(s);
    expect(stateJson).not.toContain('guest-Player'); // identities stay server-side
  });
});

describe('Tournament Center — matches', () => {
  it('4-player single elimination: tickets seat participants, results advance, champion recorded', async () => {
    const { org, code, players } = await setupField(4, { format: 'single_elimination', bestOf: 1 });
    await admin(org, 'seed', { method: 'manual', order: players.map(participantOf) });
    expect((await admin(org, 'begin')).ok).toBe(true);
    const view = org.view();
    expect(view.status).toBe('IN_PROGRESS');
    expect(view.seedingMethod).toBe('manual');
    const semis = view.matches.filter((m) => m.round === 1);
    expect(semis).toHaveLength(2);
    await waitFor(() => org.view().matches.filter((m) => m.round === 1).every((m) => m.roomCode !== ''), 3000, 'match rooms');

    // Seed 1 v seed 4, seed 2 v seed 3.
    const [p1, p2, p3, p4] = players as [Viewer, Viewer, Viewer, Viewer];
    expect(p1.me().activeMatch!.opponentId).toBe(participantOf(p4));
    const roomCode = p1.me().activeMatch!.roomCode;

    // A non-participant can't take a seat — with no ticket or with someone else's match ticket.
    const outsider = await colyseus.sdk.joinById(roomCode, { name: 'Sneaky' });
    quiet(outsider);
    await outsider.waitForInitialState();
    const wrongTicket = await colyseus.sdk.joinById(roomCode, { name: 'Sneaky2', ticket: p2.me().activeMatch!.ticket });
    quiet(wrongTicket);
    await wrongTicket.waitForInitialState();
    const seatsOf = (room: SdkRoom) =>
      Object.values((room.state as unknown as { toJSON(): { players: Record<string, { spectator: boolean; name: string }> } }).toJSON().players);
    await waitFor(() => seatsOf(outsider).length === 2, 3000, 'spectators visible');
    expect(seatsOf(outsider).every((p) => p.spectator)).toBe(true);
    // Spectators can't start, unspectate or change settings.
    outsider.send('lobby:spectate', { spectator: false });
    await sleep(80);
    expect(seatsOf(outsider).every((p) => p.spectator)).toBe(true);

    // Participants join with tickets → the game starts by itself.
    const s1 = await takeSeat(p1, 'Player1');
    const s4 = await takeSeat(p4, 'Player4');
    await waitPhase(s1.room, 'PLAYING');
    const info = s1.info();
    expect(info.participants.map((p) => p.name).sort()).toEqual(['Player1', 'Player4']);
    expect(info.participants.every((p) => p.playerId)).toBe(true);
    expect(new Set(info.participants.map((p) => p.side))).toEqual(new Set(['first', 'second']));
    expect(info.seriesStatus).toBe('playing');
    await waitFor(() => org.view().matches.find((m) => m.roomCode === roomCode)?.status === 'IN_PROGRESS', 3000, 'in progress');
    const bound = org.view().matches.find((m) => m.roomCode === roomCode)!;
    expect(bound.aPresent && bound.bPresent).toBe(true);

    // Player 4 wins the semifinal.
    s4.room.send('duel:win', {});
    await waitFor(() => org.view().matches.find((m) => m.id === bound.id)?.status === 'COMPLETE', 3000, 'semi complete');
    expect(org.view().matches.find((m) => m.id === bound.id)!.winnerId).toBe(participantOf(p4));
    await waitFor(() => s1.info().seriesStatus === 'decided', 3000, 'decided in room');
    expect(s1.info().result).toMatchObject({ winnerId: participantOf(p4), kind: 'played' });
    // A buggy duplicate report from the finished room changes nothing.
    const before = JSON.stringify(org.view().matches);
    s4.room.send('duel:reportAgain', {});
    await sleep(100);
    expect(JSON.stringify(org.view().matches)).toBe(before);
    // Delivering the same game again straight to the kiosk is ignored too (idempotent by match + game).
    kioskServer(code).matchGameOutcome(bound.id, roomCode, 1, participantOf(p1), 'late');
    expect(JSON.stringify(org.view().matches)).toBe(before);
    expect(p1.view().participants.find((p) => p.id === participantOf(p1))!.status).toBe('eliminated');

    // The other semifinal: seed 2 wins.
    const s2 = await takeSeat(p2, 'Player2');
    await takeSeat(p3, 'Player3');
    await waitPhase(s2.room, 'PLAYING');
    s2.room.send('duel:win', {});

    // The final is generated with the two winners and gets its own room.
    await waitFor(() => org.view().matches.find((m) => m.round === 2)?.status === 'READY' && org.view().matches.find((m) => m.round === 2)!.roomCode !== '', 3000, 'final ready');
    const final = org.view().matches.find((m) => m.round === 2)!;
    expect(new Set([final.aId, final.bId])).toEqual(new Set([participantOf(p2), participantOf(p4)]));
    expect(final.label).toBe('Final');
    await waitFor(() => p2.me().activeMatch?.matchId === final.id && p4.me().activeMatch?.matchId === final.id, 3000, 'final tickets');
    const f2 = await takeSeat(p2, 'Player2');
    await takeSeat(p4, 'Player4');
    await waitPhase(f2.room, 'PLAYING');
    f2.room.send('duel:win', {});

    await waitFor(() => org.view().status === 'COMPLETE', 3000, 'complete');
    const done = org.view();
    expect(done.championId).toBe(participantOf(p2));
    expect(done.participants.find((p) => p.id === participantOf(p2))!.status).toBe('champion');
    expect(done.standings.final).toBe(true);
    expect(done.standings.rows.map((r) => r.rank)).toEqual([1, 2, 3, 3]);
    await waitFor(() => org.events.some((e) => e.kind === 'champion'), 3000, 'champion event');
    await waitFor(() => p2.me().activeMatch === null, 3000, 'no more matches');
  });

  it('best-of-3 series: sides alternate, next game auto-starts, series score published', async () => {
    const { org, players } = await setupField(2, { format: 'single_elimination', bestOf: 3 });
    await admin(org, 'begin');
    const [a, b] = players as [Viewer, Viewer];
    const sa = await takeSeat(a, 'Player1');
    const sb = await takeSeat(b, 'Player2');
    await waitPhase(sa.room, 'PLAYING');
    const firstGame = sa.info();
    expect(firstGame.gameNumber).toBe(1);
    const firstSide = firstGame.participants.find((p) => p.side === 'first')!.participantId;
    sa.room.send('duel:win', {});
    await waitFor(() => sa.info().seriesStatus === 'intermission', 3000, 'intermission');
    expect(sa.info().seriesScore[participantOf(a)]).toBe(1);
    expect(sa.info().nextGameAt).toBeGreaterThan(0);
    // Game 2 starts by itself with sides swapped.
    await waitFor(() => sa.info().seriesStatus === 'playing' && sa.info().gameNumber === 2, 4000, 'game 2');
    const second = sa.info();
    expect(second.participants.find((p) => p.side === 'first')!.participantId).not.toBe(firstSide);
    const sidesSeen = JSON.parse((sa.room.state as unknown as { sidesJson: string }).sidesJson) as Array<[string, string]>;
    expect(sidesSeen.find(([pid]) => pid === sa.playerId())![1]).toBe(second.participants.find((p) => p.participantId === participantOf(a))!.side);
    // Lobby controls are refused in the match room.
    const errors = collect<{ code: string; message: string }>(sb.room, 'sys:error');
    sb.room.send('lobby:toLobby', {});
    sb.room.send('lobby:kick', { playerId: sa.playerId() });
    await waitFor(() => errors.length >= 1, 3000, 'rejections');
    // Game 2: draw (½–½) → 1½–½; game 3: B wins → 1½–1½ … needs a decider (elimination).
    sb.room.send('duel:draw', {});
    await waitFor(() => sa.info().gameNumber === 3 && sa.info().seriesStatus === 'playing', 4000, 'game 3');
    expect(sa.info().seriesScore).toEqual({ [participantOf(a)]: 1.5, [participantOf(b)]: 0.5 });
    sb.room.send('duel:win', {});
    await waitFor(() => sa.info().gameNumber === 4 && sa.info().seriesStatus === 'playing', 4000, 'decider');
    expect(sa.info().decider).toBe('sudden_death');
    sa.room.send('duel:win', {});
    await waitFor(() => org.view().status === 'COMPLETE', 3000, 'complete');
    const match = org.view().matches[0]!;
    expect(match.winnerId).toBe(participantOf(a));
    expect(match.aPoints + match.bPoints).toBe(4);
    expect(JSON.parse(match.gamesJson)).toHaveLength(4);
  });

  it('concurrent semifinal results produce exactly one correct final', async () => {
    const { org, players } = await setupField(4, { format: 'single_elimination' });
    await admin(org, 'seed', { method: 'manual', order: players.map(participantOf) });
    await admin(org, 'begin');
    const seats = await Promise.all(players.map((p, i) => takeSeat(p, `Player${i + 1}`)));
    await Promise.all(seats.map((s) => waitPhase(s.room, 'PLAYING')));
    // Seeds 4 and 3 win their semis at the same moment.
    seats[3]!.room.send('duel:win', {});
    seats[2]!.room.send('duel:win', {});
    await waitFor(() => org.view().matches.find((m) => m.round === 2)?.status === 'READY', 3000, 'final');
    const final = org.view().matches.find((m) => m.round === 2)!;
    expect(new Set([final.aId, final.bId])).toEqual(new Set([participantOf(players[2]!), participantOf(players[3]!)]));
    expect(org.view().matches.filter((m) => m.status === 'READY' || m.status === 'IN_PROGRESS')).toHaveLength(1);
  });

  it('organizer override decides a live match (audited), closes its room and advances', async () => {
    const { org, players } = await setupField(2);
    await admin(org, 'begin');
    const [a, b] = players as [Viewer, Viewer];
    const sa = await takeSeat(a, 'Player1');
    await takeSeat(b, 'Player2');
    await waitPhase(sa.room, 'PLAYING');
    const match = org.view().matches[0]!;
    // Validation: a reason (3+ chars) and confirm are required — invalid payloads are rejected before any handler runs.
    org.room.send(TOURNAMENT_MSG.admin, { action: 'override', matchId: match.id, outcome: 'win', winnerId: participantOf(b), reason: 'x', confirm: true });
    org.room.send(TOURNAMENT_MSG.admin, { action: 'override', matchId: match.id, outcome: 'win', winnerId: participantOf(b), reason: 'long enough' });
    await waitFor(() => org.errors.filter((e) => e.type === TOURNAMENT_MSG.admin && e.code === 'invalid_payload').length === 2, 3000, 'invalid payloads');
    await waitFor(() => org.view().matches[0]!.status === 'IN_PROGRESS', 3000, 'match in progress');
    const removed = collect<{ message: string }>(sa.room, 'sys:removed');
    const ack = await admin(org, 'override', { matchId: match.id, outcome: 'win', winnerId: participantOf(b), reason: 'Player 1 had to leave', confirm: true });
    expect(ack.ok).toBe(true);
    const view = org.view();
    expect(view.status).toBe('COMPLETE');
    expect(view.championId).toBe(participantOf(b));
    expect(view.matches[0]).toMatchObject({ resultKind: 'override', winnerId: participantOf(b) });
    expect(view.audit.find((e) => e.action === 'override')).toMatchObject({ actor: 'organizer', reason: 'Player 1 had to leave', matchId: match.id });
    await waitFor(() => removed.length > 0, 3000, 'room closed');
    expect(removed[0]!.message).toMatch(/organizer decision/);
    // A late game result from that room can't change anything.
    sa.room.send('duel:win', {});
    await sleep(100);
    expect(org.view().championId).toBe(participantOf(b));
  });

  it('no-show: when neither participant ever arrives, both forfeit (the bracket never stalls)', async () => {
    const { org, players } = await setupField(2, { noShowMinutes: 1 });
    await admin(org, 'begin');
    // The clock runs from the moment the room opens, with nobody there.
    await waitFor(() => org.view().matches[0]!.noShowAt > 0, 3000, 'no-show clock');
    await waitFor(() => org.view().status === 'COMPLETE', 4000, 'double forfeit');
    const m = org.view().matches[0]!;
    expect(m).toMatchObject({ status: 'FORFEIT', resultKind: 'double_forfeit', winnerId: '' });
    expect(org.view().championId).toBeNull();
    expect(org.view().audit.some((e) => e.action === 'no_show' && e.actor === 'system' && e.matchId === m.id)).toBe(true);
    expect(players.every((p) => p.me().activeMatch === null)).toBe(true);
  });

  it('after an override re-pairs a match, a displaced participant’s old ticket no longer seats them', async () => {
    const { org, players } = await setupField(4, { format: 'single_elimination', bestOf: 1 });
    await admin(org, 'seed', { method: 'manual', order: players.map(participantOf) });
    await admin(org, 'begin');
    const [p1, p2, p3, p4] = players as [Viewer, Viewer, Viewer, Viewer];
    const semis = org.view().matches.filter((m) => m.round === 1);
    const semiOf = (v: Viewer) => semis.find((m) => m.aId === participantOf(v) || m.bId === participantOf(v))!;
    const decide = (matchId: string, winner: Viewer) =>
      admin(org, 'override', { matchId, outcome: 'win', winnerId: participantOf(winner), reason: 'reported result', confirm: true });
    expect((await decide(semiOf(p1).id, p1)).ok).toBe(true);
    expect((await decide(semiOf(p2).id, p2)).ok).toBe(true);
    await waitFor(() => Boolean(p1.me().activeMatch?.roomCode), 3000, 'final room');
    const stale = p1.me().activeMatch!;
    // Scoring error: seed 4 actually won semifinal 1 — the (unstarted) final is re-paired and relaunched.
    expect((await decide(semiOf(p1).id, p4)).ok).toBe(true);
    await waitFor(() => Boolean(p4.me().activeMatch?.roomCode) && p4.me().activeMatch!.roomCode !== stale.roomCode, 4000, 'relaunched final');
    expect(p1.me().activeMatch).toBeNull();
    const final = p4.me().activeMatch!;
    expect(final.matchId).toBe(stale.matchId);
    const sneaky = await colyseus.sdk.joinById(final.roomCode, { name: 'Player1', guestId: 'guest-Player1', ticket: stale.ticket });
    const toasts = collect<{ text: string }>(sneaky, 'sys:toast');
    quiet(sneaky);
    await sneaky.waitForInitialState();
    const seats = () => Object.values((sneaky.state as unknown as { toJSON(): { players: Record<string, { spectator: boolean }> } }).toJSON().players);
    await waitFor(() => seats().length === 1, 3000, 'joined');
    expect(seats().every((p) => p.spectator)).toBe(true);
    await waitFor(() => toasts.some((t) => /not valid here/.test(t.text)), 3000, 'invalid ticket notice');
    // The current pair still takes their seats with their own tickets.
    const s4 = await takeSeat(p4, 'Player4');
    expect(s4.info().participants.map((p) => p.participantId).sort()).toEqual([participantOf(p4), participantOf(p2)].sort());
    expect(p3.me().activeMatch).toBeNull();
  });

  it('no-show: a participant absent past the window forfeits', async () => {
    const { org, players } = await setupField(2, { noShowMinutes: 1 });
    await admin(org, 'begin');
    const [a, b] = players as [Viewer, Viewer];
    await takeSeat(a, 'Player1');
    await waitFor(() => org.view().matches[0]!.noShowAt > 0, 3000, 'no-show clock');
    await waitFor(() => org.view().status === 'COMPLETE', 4000, 'forfeit');
    const m = org.view().matches[0]!;
    expect(m).toMatchObject({ status: 'FORFEIT', resultKind: 'forfeit', winnerId: participantOf(a), loserId: participantOf(b) });
    expect(org.view().audit.some((e) => e.action === 'no_show' && e.actor === 'system')).toBe(true);
  });

  it('a match room that dies is relaunched; the same ticket works and the series continues', async () => {
    const { org, players } = await setupField(2, { bestOf: 3 });
    await admin(org, 'begin');
    const [a, b] = players as [Viewer, Viewer];
    const sa = await takeSeat(a, 'Player1');
    await takeSeat(b, 'Player2');
    await waitPhase(sa.room, 'PLAYING');
    sa.room.send('duel:win', {});
    await waitFor(() => sa.info().seriesStatus === 'intermission', 3000, 'game 1 recorded');
    const oldCode = a.me().activeMatch!.roomCode;
    const oldTicket = a.me().activeMatch!.ticket;
    await colyseus.getRoomById(oldCode).disconnect();
    await waitFor(() => Boolean(a.me().activeMatch && a.me().activeMatch!.roomCode !== oldCode), 4000, 'relaunched');
    expect(a.me().activeMatch!.ticket).toBe(oldTicket);
    const again = await takeSeat(a, 'Player1');
    await takeSeat(b, 'Player2');
    await waitPhase(again.room, 'PLAYING');
    expect(again.info().gameNumber).toBe(2);
    expect(again.info().seriesScore[participantOf(a)]).toBe(1);
    expect(org.view().audit.some((e) => e.action === 'relaunch')).toBe(true);
  });

  it('participants reclaim their seat in the kiosk with their token; the organizer with theirs', async () => {
    const { org, code, players } = await setupField(2);
    const token = players[0]!.me().participantToken!;
    const orgToken = org.me().organizerToken!;
    await players[0]!.room.leave();
    await org.room.leave();
    await sleep(50);
    const back = await joinKiosk(code, 'Returning');
    expect(back.me().participantId).toBeNull();
    expect((await send(back, TOURNAMENT_MSG.claim, { token: 'x'.repeat(32) })).ok).toBe(false);
    expect((await send(back, TOURNAMENT_MSG.claim, { token })).ok).toBe(true);
    await waitFor(() => back.me().participantToken === token, 3000, 'claimed');
    const orgBack = await joinKiosk(code, 'Boss');
    expect(orgBack.me().isOrganizer).toBe(false);
    expect((await admin(orgBack, 'begin')).ok).toBe(false);
    expect((await send(orgBack, TOURNAMENT_MSG.claimOrganizer, { token: orgToken })).ok).toBe(true);
    await waitFor(() => orgBack.me().isOrganizer, 3000, 'organizer');
    expect((await admin(orgBack, 'begin')).ok).toBe(true);
    await waitFor(() => Boolean(back.me().activeMatch), 3000, 'ticket after claim');
  });

  it('withdrawal after the start forfeits; disqualification by the organizer is audited', async () => {
    const { org, players } = await setupField(4, { format: 'round_robin', bestOf: 1 });
    await admin(org, 'begin');
    const [a, b] = players as [Viewer, Viewer];
    expect((await send(a, TOURNAMENT_MSG.withdraw, { confirm: true })).ok).toBe(true);
    const aId = participantOf(a);
    await waitFor(() => org.view().participants.find((p) => p.id === aId)?.status === 'withdrawn', 3000, 'withdrawn');
    expect(org.view().matches.filter((m) => m.aId === aId || m.bId === aId).every((m) => m.status === 'FORFEIT')).toBe(true);
    const bId = participantOf(b);
    expect((await admin(org, 'disqualify', { participantId: bId, reason: 'Unsporting conduct', confirm: true })).ok).toBe(true);
    expect(org.view().audit.find((e) => e.action === 'disqualify')).toMatchObject({ participantId: bId, reason: 'Unsporting conduct' });
  });

  it('side-less games publish no sides; pause holds new matches', async () => {
    const { org, players } = await setupField(4, { gameId: 'snake', format: 'single_elimination', bestOf: 1 });
    await admin(org, 'seed', { method: 'manual', order: players.map(participantOf) });
    await admin(org, 'begin');
    expect((await admin(org, 'pause')).ok).toBe(true);
    const seats = await Promise.all(players.map((p, i) => takeSeat(p, `Player${i + 1}`)));
    await Promise.all(seats.map((s) => waitPhase(s.room, 'PLAYING')));
    expect(seats[0]!.info().participants.every((p) => p.side === undefined)).toBe(true);
    seats[0]!.room.send('duel:win', {});
    seats[1]!.room.send('duel:win', {});
    await waitFor(() => org.view().matches.filter((m) => m.round === 1).every((m) => m.status === 'COMPLETE'), 3000, 'semis');
    await sleep(100);
    const final = org.view().matches.find((m) => m.round === 2)!;
    expect(final.status).toBe('WAITING');
    expect(final.roomCode).toBe('');
    expect(org.view().paused).toBe(true);
    await admin(org, 'resume');
    await waitFor(() => org.view().matches.find((m) => m.round === 2)!.roomCode !== '', 3000, 'final launched after resume');
  });
});

describe('Tournament Center — security & formats', () => {
  it('clients cannot forge a tournament binding through create options', async () => {
    const forged = await colyseus.sdk.create('checkers', { name: 'Forger', [MATCH_BINDING_OPTION]: 'x'.repeat(40), ticket: 'y'.repeat(32) });
    quiet(forged);
    await forged.waitForInitialState();
    const state = forged.state as unknown as { tournamentJson: string; locked: boolean };
    expect(state.tournamentJson).toBe('');
    expect(state.locked).toBe(false);
    // A real binding key is single-use and never leaves the server: reusing one from a live match fails too.
    const { org, players } = await setupField(2);
    await admin(org, 'begin');
    await waitFor(() => Boolean(players[0]!.me().activeMatch), 3000, 'match');
    const again = await colyseus.sdk.create('checkers', { name: 'Forger2', [MATCH_BINDING_OPTION]: players[0]!.me().activeMatch!.ticket });
    quiet(again);
    await again.waitForInitialState();
    expect((again.state as unknown as { tournamentJson: string }).tournamentJson).toBe('');
  });

  it('a seat is reclaimed (not duplicated) when a participant rejoins with the same ticket', async () => {
    const { org, players } = await setupField(2);
    await admin(org, 'begin');
    const [a, b] = players as [Viewer, Viewer];
    const first = await takeSeat(a, 'Player1');
    await takeSeat(b, 'Player2');
    await waitPhase(first.room, 'PLAYING');
    const firstId = first.playerId();
    const second = await takeSeat(a, 'Player1');
    expect(second.playerId()).toBe(firstId);
    const seated = Object.values((second.room.state as unknown as { toJSON(): { players: Record<string, { spectator: boolean }> } }).toJSON().players).filter((p) => !p.spectator);
    expect(seated).toHaveLength(2);
  });

  it('round robin through real rooms: every pair plays once, standings final', async () => {
    const { org, players } = await setupField(3, { format: 'round_robin', bestOf: 1 });
    await admin(org, 'begin');
    expect(org.view().matches.filter((m) => m.resultKind === 'bye')).toHaveLength(3);
    const byParticipant = new Map(players.map((p) => [participantOf(p), p]));
    let guard = 0;
    while (org.view().status === 'IN_PROGRESS' && guard++ < 10) {
      await waitFor(() => org.view().matches.some((m) => m.status === 'READY' && m.roomCode !== ''), 3000, 'ready match');
      const m = org.view().matches.find((x) => x.status === 'READY' && x.roomCode !== '')!;
      const sa = await takeSeat(byParticipant.get(m.aId)!, 'A');
      await takeSeat(byParticipant.get(m.bId)!, 'B');
      await waitPhase(sa.room, 'PLAYING');
      sa.room.send('duel:win', {});
      await waitFor(() => org.view().matches.find((x) => x.id === m.id)!.status === 'COMPLETE', 3000, 'result');
    }
    const view = org.view();
    expect(view.status).toBe('COMPLETE');
    expect(view.standings.final).toBe(true);
    expect(view.standings.tiebreaks).toEqual(['direct_encounter', 'wins', 'sonneborn_berger']);
    expect(view.standings.rows.reduce((s, r) => s + r.points, 0)).toBe(3);
    expect(view.championId).toBe(view.standings.rows[0]!.participantId);
  });

  it('Swiss through real rooms pairs round 2 only after round 1 is complete', async () => {
    const { org, players } = await setupField(4, { format: 'swiss', swissRounds: 2, gameId: 'snake' });
    await admin(org, 'seed', { method: 'manual', order: players.map(participantOf) });
    await admin(org, 'begin');
    const byParticipant = new Map(players.map((p) => [participantOf(p), p]));
    for (let round = 1; round <= 2; round++) {
      await waitFor(() => org.view().matches.filter((m) => m.round === round && m.roomCode !== '').length === 2, 3000, `round ${round} rooms`);
      const ms = org.view().matches.filter((m) => m.round === round);
      expect(org.view().matches.some((m) => m.round === round + 1)).toBe(false);
      for (const m of ms) {
        const sa = await takeSeat(byParticipant.get(m.aId)!, 'A');
        await takeSeat(byParticipant.get(m.bId)!, 'B');
        await waitPhase(sa.room, 'PLAYING');
        sa.room.send('duel:win', {});
        await waitFor(() => org.view().matches.find((x) => x.id === m.id)!.status === 'COMPLETE', 3000, 'result');
      }
    }
    const view = org.view();
    expect(view.status).toBe('COMPLETE');
    const r2 = view.matches.filter((m) => m.round === 2);
    const r1Winners = new Set(view.matches.filter((m) => m.round === 1).map((m) => m.winnerId));
    // Winners meet winners in round 2 (same score group).
    expect(r2.some((m) => r1Winners.has(m.aId) && r1Winners.has(m.bId))).toBe(true);
    expect(view.standings.rows[0]!.points).toBe(2);
  });

  it('the organizer closing the kiosk cancels the tournament and its match rooms', async () => {
    const { org, players } = await setupField(2);
    await admin(org, 'begin');
    const seat = await takeSeat(players[0]!, 'Player1');
    const removed = collect<{ message: string }>(seat.room, 'sys:removed');
    const kiosk = kioskServer(org.room.roomId);
    org.room.send('lobby:close', {});
    await waitFor(() => removed.length > 0, 4000, 'match room closed');
    expect(removed[0]!.message).toMatch(/cancelled|closed/i);
    expect(kiosk['engine'].status).toBe('CANCELLED');
  });
});

describe('Tournament Center — lifecycle cleanup', () => {
  it('a finished tournament stays while watched, then closes once nobody has been around for a while', async () => {
    const { org, code, players } = await setupField(2);
    await admin(org, 'begin');
    const match = org.view().matches[0]!;
    await admin(org, 'override', { matchId: match.id, outcome: 'win', winnerId: participantOf(players[0]!), reason: 'quick final', confirm: true });
    expect(org.view().status).toBe('COMPLETE');
    await sleep(1500);
    expect(colyseus.getRoomById(code)).toBeDefined(); // viewers are still here
    await Promise.all([org, ...players].map((v) => v.room.leave()));
    await waitFor(() => colyseus.getRoomById(code) === undefined, 5000, 'kiosk disposed');
  });

  it('a tournament created without ever connecting disappears (no organizer, no trace)', async () => {
    const res = await fetch(`http://localhost:${port}/matchmake/create/tournament`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Script', settings: { name: 'Ghost Cup' } }),
    });
    expect(res.status).toBe(200);
    const { roomId } = (await res.json()) as { roomId: string };
    expect(kioskServer(roomId).autoDispose).toBe(true); // Colyseus drops it when the seat reservation expires
    await waitFor(() => colyseus.getRoomById(roomId) === undefined, 5000, 'unclaimed kiosk disposed');
  });

  it('the organizer joining keeps the room; a DRAFT nobody watches is discarded after a while', async () => {
    const org = await createKiosk();
    const code = org.room.roomId;
    expect(kioskServer(code).autoDispose).toBe(false);
    await org.room.leave();
    await waitFor(() => colyseus.getRoomById(code) === undefined, 5000, 'idle draft disposed');
  });

  it('concurrent tournaments are capped per address and per process, with a clear error', async () => {
    try {
      setTournamentCaps({ perIp: 2, perProcess: 50 });
      const first = await createKiosk({}, 'Org1');
      await createKiosk({}, 'Org2');
      await expect(createKiosk({}, 'Org3')).rejects.toThrow(/already running 2 tournaments/);
      setTournamentCaps({ perIp: 50, perProcess: 2 });
      await expect(createKiosk({}, 'Org4')).rejects.toThrow(/Tournament Center is full/);
      // Viewers can still join an existing tournament.
      const viewer = await joinKiosk(first.room.roomId, 'Viewer');
      expect(viewer.view().status).toBe('DRAFT');
    } finally {
      setTournamentCaps({ perIp: 500, perProcess: 2000 });
    }
  });

  it('an active tournament never auto-disposes when everyone leaves', async () => {
    const { org, code, players } = await setupField(2);
    await Promise.all([org, ...players].map((v) => v.room.leave()));
    await sleep(1600);
    expect(colyseus.getRoomById(code)).toBeDefined();
    const back = await joinKiosk(code, 'Player1b');
    expect(back.view().participants).toHaveLength(2);
  });
});
