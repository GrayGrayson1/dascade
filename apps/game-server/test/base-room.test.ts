import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import { isValidRoomCode, JoinErrorCode, type WelcomePayload } from '@dascade/shared';
import { bootTestServer, collect, sleep, waitFor, quiet } from './helpers.ts';
import type { TestRoom } from './fixtures/TestRoom.ts';
import { setMatchmakingLimits } from '../src/rooms/BaseGameRoom.ts';
import { ipRateKey, isPrivateAddress, resolveClientIp, setTrustProxy } from '../src/lib/clientIp.ts';

let colyseus: ColyseusTestServer;
let port = 0;

beforeAll(async () => {
  ({ colyseus, port } = await bootTestServer());
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

async function join(code: string, name: string, extra: Record<string, unknown> = {}) {
  const room = await colyseus.sdk.joinById(code, { name, ...extra });
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ code: string }>(room, 'sys:error');
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  return { room, welcomes, errors, me: () => welcomes[welcomes.length - 1]! };
}

async function createRoom(name = 'Host') {
  const room = await colyseus.sdk.create('test', { name });
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ code: string }>(room, 'sys:error');
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  const server = colyseus.getRoomById(room.roomId) as unknown as TestRoom;
  return { room, welcomes, errors, server, me: () => welcomes[welcomes.length - 1]! };
}

const st = (room: SdkRoom) => room.state as any;

/** Drop the socket as if the network died; the SDK auto-reconnects after roughly `delayMs`. */
function dropAndReconnectLater(room: SdkRoom, delayMs: number): Promise<void> {
  room.reconnection.minUptime = 0;
  room.reconnection.delay = delayMs;
  room.reconnection.minDelay = delayMs;
  room.reconnection.maxDelay = delayMs;
  const reconnected = new Promise<void>((r) => room.onReconnect(() => r()));
  (room as any).connection.transport.ws.close(4010);
  return reconnected;
}

function dropForGood(room: SdkRoom): void {
  room.reconnection.enabled = false;
  (room as any).connection.transport.ws.close(4010);
}

describe('BaseGameRoom lifecycle', () => {
  it('creates a room with a human-friendly code and the creator as host', async () => {
    const host = await createRoom('Alice');
    expect(isValidRoomCode(host.room.roomId)).toBe(true);
    expect(st(host.room).code).toBe(host.room.roomId);
    expect(st(host.room).hostId).toBe(host.me().playerId);
    expect(st(host.room).players.get(host.me().playerId).name).toBe('Alice');
    expect(host.me().seatToken.length).toBeGreaterThan(10);
    expect(JSON.parse(st(host.room).settingsJson)).toEqual({ target: 10, label: 'hello' });
  });

  it('joins by code, dedupes names, and exposes the lookup API', async () => {
    const host = await createRoom('Sam');
    const guest = await join(host.room.roomId, 'sam');
    await waitFor(() => st(host.room).players.size === 2);
    expect(st(guest.room).players.get(guest.me().playerId).name).toBe('sam 2');
    const res = await colyseus.http.get(`/api/rooms/${host.room.roomId.toLowerCase()}`);
    expect(res.data).toMatchObject({ exists: true, gameId: 'wheel', code: host.room.roomId });
    const missing = await colyseus.http.get('/api/rooms/ZZZZZ');
    expect(missing.data.exists).toBe(false);
  });

  it('only the host can start; start runs countdown then PLAYING', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    guest.room.send('lobby:start', {});
    await waitFor(() => guest.errors.some((e) => e.code === 'not_host'));
    host.room.send('lobby:start', {});
    await waitFor(() => host.server.state.phase === 'COUNTDOWN' || host.server.state.phase === 'PLAYING');
    await waitFor(() => st(host.room).phase === 'PLAYING');
    expect(host.server.events).toContain('start');
  });

  it('rejects invalid payloads, wrong phase and spectator actions without disconnecting', async () => {
    const host = await createRoom();
    host.room.send('test:inc', { by: 1 });
    await waitFor(() => host.errors.some((e) => e.code === 'wrong_phase'));
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING');
    host.room.send('test:inc', { by: 'lots' });
    host.room.send('test:inc', { by: 99 });
    await waitFor(() => host.errors.filter((e) => e.code === 'invalid_payload').length === 2);
    host.room.send('test:inc', { by: 2 });
    await waitFor(() => st(host.room).counter === 2);
    expect(host.server.clients.length).toBe(1);
  });

  it('rate-limits spammy actions', async () => {
    const host = await createRoom();
    const pongs = collect(host.room, 'test:pong');
    for (let i = 0; i < 10; i++) host.room.send('test:ping', {});
    await waitFor(() => host.errors.some((e) => e.code === 'rate_limited'));
    await sleep(100);
    expect(pongs.length).toBe(3);
  });

  it('validates settings and only lets the host change them', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    guest.room.send('lobby:settings', { settings: { target: 20 } });
    await waitFor(() => guest.errors.some((e) => e.code === 'not_host'));
    host.room.send('lobby:settings', { settings: { target: 500 } });
    await waitFor(() => host.errors.some((e) => e.code === 'invalid_payload'));
    host.room.send('lobby:settings', { settings: { target: 20 } });
    await waitFor(() => JSON.parse(st(guest.room).settingsJson).target === 20);
    expect(JSON.parse(st(guest.room).settingsJson).label).toBe('hello');
  });

  it('delivers private messages only to their recipient', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    const hostPongs = collect<{ secret: string }>(host.room, 'test:pong');
    const guestPongs = collect<{ secret: string }>(guest.room, 'test:pong');
    guest.room.send('test:ping', {});
    await waitFor(() => guestPongs.length === 1);
    await sleep(100);
    expect(hostPongs.length).toBe(0);
    expect(guestPongs[0]!.secret).toBe(`for-${guest.me().playerId}`);
  });

  it('migrates host when the host leaves', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    await host.room.leave(true);
    await waitFor(() => st(guest.room).hostId === guest.me().playerId);
    expect(st(guest.room).players.get(guest.me().playerId).isHost).toBe(true);
  });

  it('migrates host after the host drops and does not return', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    host.room.reconnection.enabled = false;
    (host.room as any).connection.transport.ws.close(4010);
    await waitFor(() => st(guest.room).players.get(host.me().playerId)?.connected === false);
    await waitFor(() => st(guest.room).hostId === guest.me().playerId, 3000, 'host migration');
  });

  it('auto-reconnects a dropped client to the same seat and re-sends private state', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    const privates = collect<{ mine: string }>(guest.room, 'test:private');
    const playerId = guest.me().playerId;
    guest.room.reconnection.minUptime = 0;
    const reconnected = new Promise<void>((r) => guest.room.onReconnect(() => r()));
    (guest.room as any).connection.transport.ws.close(4010);
    await waitFor(() => st(host.room).players.get(playerId)?.connected === false);
    await reconnected;
    await waitFor(() => st(host.room).players.get(playerId)?.connected === true);
    await waitFor(() => privates.length > 0);
    expect(privates.at(-1)!.mine).toBe(playerId);
    expect(guest.me().rejoined).toBe(true);
    expect(st(host.room).players.size).toBe(2);
  });

  it('keeps an away seat mid-match and lets the player reclaim it with their seat token', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    const { playerId, seatToken } = guest.me();
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING');
    guest.room.reconnection.enabled = false;
    (guest.room as any).connection.transport.ws.close(4010);
    await waitFor(() => host.server.events.includes(`away:${playerId}`), 4000, 'away');
    expect(st(host.room).players.get(playerId).connected).toBe(false);
    const again = await join(host.room.roomId, 'Bob', { seatToken });
    expect(again.me().playerId).toBe(playerId);
    expect(again.me().rejoined).toBe(true);
    await waitFor(() => st(host.room).players.get(playerId)?.connected === true);
    expect(st(host.room).players.size).toBe(2);
  });

  it('a second tab with the same seat token replaces the first without duplicating the player', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    const left = new Promise<number>((r) => guest.room.onLeave((code) => r(code)));
    const second = await join(host.room.roomId, 'Bob', { seatToken: guest.me().seatToken });
    expect(second.me().playerId).toBe(guest.me().playerId);
    await left;
    await sleep(100);
    expect(st(host.room).players.size).toBe(2);
    expect(host.server.clients.length).toBe(2);
  });

  it('kicks and bans a player', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    const removed = collect<{ reason: string }>(guest.room, 'sys:removed');
    const left = new Promise<number>((r) => guest.room.onLeave((code) => r(code)));
    host.room.send('lobby:kick', { playerId: guest.me().playerId });
    expect(await left).toBe(4403);
    expect(removed[0]?.reason).toBe('kicked');
    await waitFor(() => st(host.room).players.size === 1);
    await expect(colyseus.sdk.joinById(host.room.roomId, { name: 'Bob', seatToken: guest.me().seatToken })).rejects.toMatchObject({
      code: JoinErrorCode.KICKED,
    });
  });

  it('locking the room rejects new joiners; full rooms seat newcomers as spectators', async () => {
    const host = await createRoom();
    host.room.send('lobby:room', { maxPlayers: 1 });
    await waitFor(() => st(host.room).maxPlayers === 1);
    const late = await join(host.room.roomId, 'Late');
    expect(st(late.room).players.get(late.me().playerId).spectator).toBe(true);
    host.room.send('lobby:room', { locked: true });
    await waitFor(() => st(host.room).locked === true);
    await expect(colyseus.sdk.joinById(host.room.roomId, { name: 'Nope' })).rejects.toMatchObject({ code: JoinErrorCode.ROOM_LOCKED });
  });

  it('late joiners spectate a running match when the game disallows late join, and are promoted on return to lobby', async () => {
    const host = await createRoom();
    host.server['catalog'] = { ...host.server['catalog'], capacity: { ...host.server['catalog'].capacity, lateJoinAsPlayer: false } };
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING');
    const late = await join(host.room.roomId, 'Late');
    const lateState = () => st(late.room).players.get(late.me().playerId);
    expect(lateState().spectator).toBe(true);
    expect(lateState().queued).toBe(true);
    host.room.send('lobby:toLobby', {});
    await waitFor(() => st(host.room).phase === 'LOBBY');
    await waitFor(() => lateState().spectator === false);
  });

  it('broadcasts chat, masks profanity and trims long text', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    const msgs = collect<{ text: string; kind: string; playerId: string | null }>(host.room, 'chat:msg');
    guest.room.send('chat:send', { text: '  hello   shit world  ' });
    await waitFor(() => msgs.some((m) => m.kind === 'chat'));
    expect(msgs.find((m) => m.kind === 'chat')!.text).toBe('hello s*** world');
  });

  it('host can close the room for everyone', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    const left = new Promise<number>((r) => guest.room.onLeave((code) => r(code)));
    host.room.send('lobby:close', {});
    expect(await left).toBe(4410);
  });

  it('a closing room refuses seat-token rejoins (no zombie seats in an ENDED room)', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    const { seatToken } = guest.me();
    host.room.send('lobby:close', {});
    await waitFor(() => host.server.state.phase === 'ENDED');
    await expect(colyseus.sdk.joinById(host.room.roomId, { name: 'Bob', seatToken })).rejects.toBeTruthy();
  });

  it('ends a match into RESULTS and returns to lobby resetting ready flags', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    guest.room.send('lobby:ready', { ready: true });
    await waitFor(() => st(host.room).players.get(guest.me().playerId)?.ready === true);
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING');
    host.room.send('test:finish', {});
    await waitFor(() => st(host.room).phase === 'RESULTS');
    host.room.send('lobby:toLobby', {});
    await waitFor(() => st(host.room).phase === 'LOBBY');
    await waitFor(() => st(host.room).players.get(guest.me().playerId)?.ready === false);
  });

  it('a solo host who drops and comes back is still the host (no candidate ≠ no host)', async () => {
    const host = await createRoom('Solo');
    const me = host.me().playerId;
    // Reconnect after the 300ms host-migration timer fired but inside the 1s grace period.
    await dropAndReconnectLater(host.room, 650);
    await waitFor(() => st(host.room).players.get(me)?.connected === true);
    expect(host.server.state.hostId).toBe(me);
    expect(st(host.room).players.get(me).isHost).toBe(true);
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'host can still start');
  });

  it('when the whole room drops, the first player back takes over an orphaned host role', async () => {
    const host = await createRoom('A');
    const guest = await join(host.room.roomId, 'B');
    const guestReconnected = dropAndReconnectLater(guest.room, 650);
    await waitFor(() => host.server.state.players.get(guest.me().playerId)?.connected === false);
    dropForGood(host.room);
    await guestReconnected;
    await waitFor(() => st(guest.room).hostId === guest.me().playerId, 2000, 'host handed to the returning player');
  });

  it("a game clearing its own timers doesn't cancel host migration", async () => {
    const host = await createRoom('A');
    const guest = await join(host.room.roomId, 'B');
    host.server['reconnectGraceSeconds'] = 5; // host stays "disconnected" (not removed) for the whole test
    dropForGood(host.room);
    await waitFor(() => host.server.state.players.get(host.me().playerId)?.connected === false);
    guest.room.send('test:clearTimers', {});
    await waitFor(() => st(guest.room).hostId === guest.me().playerId, 2000, 'migration after clearAllTimers');
  });

  it('a player kicked while disconnected is told they were kicked when the client auto-reconnects', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    const guestId = guest.me().playerId;
    const left = new Promise<number>((r) => guest.room.onLeave((code) => r(code)));
    void dropAndReconnectLater(guest.room, 400);
    await waitFor(() => host.server.state.players.get(guestId)?.connected === false);
    host.room.send('lobby:kick', { playerId: guestId });
    expect(await left).toBe(4403);
    await expect(colyseus.sdk.joinById(host.room.roomId, { name: 'Bob', seatToken: guest.me().seatToken })).rejects.toMatchObject({
      code: JoinErrorCode.KICKED,
    });
  });

  it('a match that nobody is seated in any more returns to the lobby', async () => {
    const host = await createRoom('Player');
    const watcher = await join(host.room.roomId, 'Watcher', { spectator: true });
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING');
    await host.room.leave(true);
    await waitFor(() => st(watcher.room).phase === 'LOBBY', 2000, 'back to lobby');
    expect(st(watcher.room).hostId).toBe(watcher.me().playerId);
  });

  it('unknown message types are ignored instead of disconnecting the client', async () => {
    const host = await createRoom();
    let leftCode: number | null = null;
    host.room.onLeave((code) => (leftCode = code));
    const pongs = collect(host.room, 'test:pong');
    host.room.send('nope:unknown', { x: 1 });
    host.room.send(1234 as unknown as string, {});
    await sleep(150);
    host.room.send('test:ping', {});
    await waitFor(() => pongs.length === 1);
    expect(leftCode).toBeNull();
    expect(host.server.clients.length).toBe(1);
  });

  it('a throwing game hook (syncPrivate) cannot break joining', async () => {
    const host = await createRoom();
    const boom = await join(host.room.roomId, 'Boom');
    await waitFor(() => st(host.room).players.size === 2);
    expect(st(boom.room).players.get(boom.me().playerId).name).toBe('Boom');
  });

  it('sanitizes nicknames: invisible fillers fall back, the system name is reserved, bidi stripped', async () => {
    const host = await createRoom('\u3164\u3164\u3164');
    const hostName = st(host.room).players.get(host.me().playerId).name as string;
    expect(['Player', 'Guest', 'Challenger', 'Rookie']).toContain(hostName);
    const fake = await join(host.room.roomId, 'DASCADE');
    expect(st(fake.room).players.get(fake.me().playerId).name).not.toMatch(/dascade/i);
    const bidi = await join(host.room.roomId, 'evil\u202Egnp.exe\u2066');
    expect(st(bidi.room).players.get(bidi.me().playerId).name).toBe('evilgnp.exe');
  });

  it('per-IP throttles ignore forged X-Forwarded-For / X-Real-IP headers', async () => {
    setMatchmakingLimits({ burst: 100, perSecond: 100 }, { burst: 2, perSecond: 0.01 });
    setTrustProxy(0); // directly exposed server: forwarding headers come from the client
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await fetch(`http://localhost:${port}/matchmake/create/test`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${i}`, 'x-real-ip': `10.1.0.${i}` },
          body: JSON.stringify({ name: `spoof${i}` }),
        });
        statuses.push(res.status);
        await res.text();
      }
      expect(statuses.slice(0, 2)).toEqual([200, 200]);
      expect(statuses.slice(2)).toEqual([429, 429]);
    } finally {
      setTrustProxy('auto');
      setMatchmakingLimits({ burst: 5000, perSecond: 500 }, { burst: 5000, perSecond: 500 });
    }
  });

  it('client IP resolution: forwarding headers only count when they come from a proxy', () => {
    const req = (peer: string, xff?: string) => ({ socket: { remoteAddress: peer }, headers: xff ? { 'x-forwarded-for': xff } : {} }) as never;
    // auto: a public peer is the client itself — its X-Forwarded-For is ignored.
    expect(resolveClientIp(req('203.0.113.9', '1.2.3.4'), 'auto')).toBe('203.0.113.9');
    // auto: a private/loopback peer is a proxy — use the entry it appended (right-most), not the forgeable first one.
    expect(resolveClientIp(req('10.0.0.5', 'forged, 198.51.100.7'), 'auto')).toBe('198.51.100.7');
    expect(resolveClientIp(req('::ffff:127.0.0.1', '198.51.100.8'), 'auto')).toBe('198.51.100.8');
    expect(resolveClientIp(req('10.0.0.5', 'a, b, 198.51.100.7, 10.0.0.2'), 2)).toBe('198.51.100.7');
    expect(resolveClientIp(req('10.0.0.5', '198.51.100.7'), 0)).toBe('10.0.0.5');
    expect(['fd00::1', 'fe80::1', '::1', '172.20.1.1', '100.64.0.1'].every(isPrivateAddress)).toBe(true);
    expect(['8.8.8.8', '2001:db8::1', '172.32.0.1'].some(isPrivateAddress)).toBe(false);
    // IPv6 clients are grouped per /64 so rotating addresses inside one subscriber prefix share a bucket.
    expect(ipRateKey('2001:db8:1:2:aaaa::1')).toBe(ipRateKey('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
    expect(ipRateKey('::ffff:192.0.2.1')).toBe('192.0.2.1');
  });

  it('refuses oversized matchmaking bodies before parsing them', async () => {
    const res = await fetch(`http://localhost:${port}/matchmake/create/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'big', settings: { label: 'x'.repeat(300_000) } }),
    });
    expect(res.status).toBe(413);
  });

  it('returnToLobby drops away players in the LOBBY phase, then calls onReturnToLobby with the final roster', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    const guestId = guest.me().playerId;
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING');
    dropForGood(guest.room);
    await waitFor(() => host.server.events.includes(`away:${guestId}`), 4000, 'away');
    host.server.events.length = 0;
    host.room.send('lobby:toLobby', {});
    await waitFor(() => st(host.room).phase === 'LOBBY');
    expect(host.server.events).toEqual([`removed:${guestId}:disconnected`, 'removed-in:LOBBY', 'lobby:LOBBY:1']);
  });

  it('checks role/phase before parsing payloads, and enforces per-handler maxBytes', async () => {
    const host = await createRoom();
    const watcher = await join(host.room.roomId, 'Watcher', { spectator: true });
    watcher.room.send('test:act', { n: 'not-a-number' });
    await waitFor(() => watcher.errors.length > 0);
    expect(watcher.errors[0]!.code).toBe('not_allowed');
    const ok = collect(host.room, 'test:blobOk');
    host.room.send('test:blob', { data: 'x'.repeat(1000) });
    await waitFor(() => host.errors.some((e) => e.code === 'invalid_payload'));
    host.room.send('test:blob', { data: 'small' });
    await waitFor(() => ok.length === 1);
  });

  it('budgets settings bytes per room (each change is re-broadcast to everyone)', async () => {
    const host = await createRoom();
    for (let i = 0; i < 6; i++) host.room.send('lobby:settings', { settings: { notes: String(i).repeat(60_000) } });
    await waitFor(() => host.errors.some((e) => e.code === 'rate_limited'), 3000, 'byte budget');
    // The budget refills (~64 KB/s): after a pause the next (still ~60 KB) change goes through.
    await sleep(1100);
    host.room.send('lobby:settings', { settings: { target: 33 } });
    await waitFor(() => JSON.parse(st(host.room).settingsJson).target === 33);
  });

  it('cannot hand the host role to a spectator mid-match, but can in the lobby', async () => {
    const host = await createRoom();
    const watcher = await join(host.room.roomId, 'Watcher', { spectator: true });
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING');
    host.room.send('lobby:transferHost', { playerId: watcher.me().playerId });
    await waitFor(() => host.errors.some((e) => e.code === 'not_allowed'));
    expect(st(host.room).hostId).toBe(host.me().playerId);
    host.room.send('lobby:toLobby', {});
    await waitFor(() => st(host.room).phase === 'LOBBY');
    host.room.send('lobby:transferHost', { playerId: watcher.me().playerId });
    await waitFor(() => st(host.room).hostId === watcher.me().playerId);
  });

  it('locks the room name while a match is running', async () => {
    const host = await createRoom();
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING');
    const before = st(host.room).roomName;
    host.room.send('lobby:room', { roomName: 'the word is BANANA' });
    await waitFor(() => host.errors.some((e) => e.code === 'wrong_phase'));
    expect(st(host.room).roomName).toBe(before);
  });

  it('masks profanity in room names given at creation, like renames', async () => {
    const room = await colyseus.sdk.create('test', { name: 'Maker', roomName: 'shit show' });
    quiet(room);
    await room.waitForInitialState();
    expect(st(room).roomName).toBe('s*** show');
  });

  it('calls onCountdownStart when the phase enters COUNTDOWN, before onGameStart', async () => {
    const host = await createRoom();
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING');
    expect(host.server.events.filter((e) => e === 'countdown:COUNTDOWN' || e === 'start')).toEqual(['countdown:COUNTDOWN', 'start']);
  });

  it('a burst of ~200 frames in one second (buffered after a stall) does not disconnect the client', async () => {
    const host = await createRoom();
    let leftCode: number | null = null;
    host.room.onLeave((code) => (leftCode = code));
    for (let i = 0; i < 200; i++) host.room.send('sys:time', { t0: i });
    const pongs = collect(host.room, 'test:pong');
    await sleep(200);
    host.room.send('test:ping', {});
    await waitFor(() => pongs.length === 1);
    expect(leftCode).toBeNull();
  });

  it('create-time settings run through onSettingsChanged', async () => {
    const room = await colyseus.sdk.create('test', { name: 'Maker', settings: { target: 42 } });
    quiet(room);
    await room.waitForInitialState();
    const server = colyseus.getRoomById(room.roomId) as unknown as TestRoom;
    expect(JSON.parse(st(room).settingsJson).target).toBe(42);
    expect(server.events).toContain('settings:42');
  });

  it('throttles matchmaking per IP with a proper 429 error', async () => {
    setMatchmakingLimits({ burst: 100, perSecond: 100 }, { burst: 2, perSecond: 0.01 });
    try {
      await colyseus.sdk.create('test', { name: 'a' });
      await colyseus.sdk.create('test', { name: 'b' });
      await expect(colyseus.sdk.create('test', { name: 'c' })).rejects.toMatchObject({ code: JoinErrorCode.RATE_LIMITED });
    } finally {
      setMatchmakingLimits({ burst: 5000, perSecond: 500 }, { burst: 5000, perSecond: 500 });
    }
  });
});
