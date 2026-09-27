/**
 * Client-side helpers for the Tournament Center integration tests (tournament*.test.ts).
 * Call `useTournamentServer(colyseus)` in beforeAll.
 */
import { expect } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import {
  TOURNAMENT_MSG,
  defaultTournamentConfig,
  tournamentViewFromState,
  type GameId,
  type TournamentAck,
  type TournamentConfig,
  type TournamentEvent,
  type TournamentMatchInfo,
  type TournamentMe,
  type TournamentPublicState,
  type TournamentView,
  type WelcomePayload,
} from '@dascade/shared';
import type { TournamentRoom } from '../src/rooms/tournament/TournamentRoom.ts';
import { collect, quiet, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;

export function useTournamentServer(server: ColyseusTestServer): void {
  colyseus = server;
}

export interface Viewer {
  room: SdkRoom;
  mes: TournamentMe[];
  acks: TournamentAck[];
  events: TournamentEvent[];
  errors: Array<{ type?: string; code: string; message: string }>;
  me(): TournamentMe;
  playerId(): string;
  view(): TournamentView;
}

let requestSeq = 0;

export async function wrapKiosk(room: SdkRoom): Promise<Viewer> {
  const mes = collect<TournamentMe>(room, TOURNAMENT_MSG.me);
  const acks = collect<TournamentAck>(room, TOURNAMENT_MSG.ack);
  const events = collect<TournamentEvent>(room, TOURNAMENT_MSG.event);
  const errors = collect<{ type?: string; code: string; message: string }>(room, 'sys:error');
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => mes.length > 0 && welcomes.length > 0, 3000, 'tournament:me');
  return {
    room,
    mes,
    acks,
    events,
    errors,
    me: () => mes[mes.length - 1]!,
    playerId: () => welcomes[welcomes.length - 1]!.playerId,
    view: () => tournamentViewFromState((room.state as unknown as { toJSON(): TournamentPublicState }).toJSON()),
  };
}

export async function createKiosk(config: Partial<TournamentConfig> = {}, name = 'Organizer', gameId: GameId = 'checkers'): Promise<Viewer> {
  const settings = { ...defaultTournamentConfig(config.gameId ?? gameId), name: 'Office Open', noShowMinutes: 0, ...config };
  const room = await colyseus.sdk.create('tournament', { name, guestId: `guest-${name}`, settings, roomName: settings.name });
  return wrapKiosk(room);
}

export async function joinKiosk(code: string, name: string): Promise<Viewer> {
  const room = await colyseus.sdk.joinById(code, { name, guestId: `guest-${name}` });
  return wrapKiosk(room);
}

export async function send(v: Viewer, type: string, payload: Record<string, unknown> = {}): Promise<TournamentAck> {
  const requestId = `r${++requestSeq}`;
  v.room.send(type, { ...payload, requestId });
  await waitFor(() => v.acks.some((a) => a.requestId === requestId), 3000, `ack for ${type}`);
  return v.acks.find((a) => a.requestId === requestId)!;
}

export const admin = (v: Viewer, action: string, extra: Record<string, unknown> = {}) => send(v, TOURNAMENT_MSG.admin, { action, ...extra });

export function kioskServer(code: string): TournamentRoom {
  return colyseus.getRoomById(code) as unknown as TournamentRoom;
}

export interface Seat {
  room: SdkRoom;
  info(): TournamentMatchInfo;
  playerId(): string;
}

export async function takeSeat(v: Viewer, name: string): Promise<Seat> {
  await waitFor(() => Boolean(v.me().activeMatch), 3000, `${name} active match`);
  const active = v.me().activeMatch!;
  const room = await colyseus.sdk.joinById(active.roomCode, { name, guestId: `guest-${name}`, ticket: active.ticket });
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  return {
    room,
    info: () => JSON.parse((room.state as unknown as { tournamentJson: string }).tournamentJson) as TournamentMatchInfo,
    playerId: () => welcomes[welcomes.length - 1]!.playerId,
  };
}

export const phaseOf = (room: SdkRoom) => (room.state as unknown as { phase: string }).phase;

export async function waitPhase(room: SdkRoom, phase: string, timeout = 3000): Promise<void> {
  await waitFor(() => phaseOf(room) === phase, timeout, `phase ${phase}`);
}

/** Organizer + n registered participants (all in the kiosk). */
export async function setupField(n: number, config: Partial<TournamentConfig> = {}) {
  const org = await createKiosk(config);
  const code = org.room.roomId;
  expect((await admin(org, 'openRegistration')).ok).toBe(true);
  const players: Viewer[] = [];
  for (let i = 0; i < n; i++) {
    const v = await joinKiosk(code, `Player${i + 1}`);
    const ack = await send(v, TOURNAMENT_MSG.register, {});
    expect(ack.ok).toBe(true);
    await waitFor(() => Boolean(v.me().participantId), 3000, 'participant id');
    players.push(v);
  }
  return { org, code, players };
}

export function participantOf(v: Viewer): string {
  return v.me().participantId!;
}
