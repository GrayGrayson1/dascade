/**
 * Game drivers for the Tournament Center × real game room tests (tournament-games.test.ts).
 *
 * Every tournament-capable game gets a driver that plays ONE game of a tournament match to a chosen
 * result through the real room: clients send the same intents a player would (resign, draw offers,
 * taps, strokes, turns). Only where a game would otherwise take minutes of real-time play (paddle
 * rallies) does the driver fast-forward the server simulation — the same technique the games' own
 * integration tests use. Drivers also compress each room's timings (countdowns, intros…).
 */
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { ColyseusTestServer } from '@colyseus/testing';
import { createSeededRng, type GameId, type TournamentMatchInfo, type WelcomePayload } from '@dascade/shared';
import { CLASSICS_MSG } from '@dascade/shared/games/classics';
import { MEMORY_MSG, type MemoryPatternMsg } from '@dascade/shared/games/memory';
import { PADDLE_TOURNAMENT_RULES } from '@dascade/shared/games/paddle';
import { PUTT_MSG, type PuttShotView } from '@dascade/shared/games/putt';
import { SHIPS_MSG } from '@dascade/shared/games/ships';
import { SNAKE_MSG } from '@dascade/shared/games/snake';
import { FACE_X, type PaddleMatch } from '@dascade/game-core/paddle';
import { randomLayout } from '@dascade/game-core/ships';
import { getHole, searchShots } from '@dascade/game-core/putt';
import { botDirection, cellY, type SnakeGame } from '@dascade/game-core/snake';
import { collect, quiet, sleep, waitFor } from './helpers.ts';

/** A participant seated in a live match room (joined with their ticket). */
export interface MatchSeat {
  room: SdkRoom;
  participantId: string;
  playerId(): string;
  info(): TournamentMatchInfo;
  /** The server-side room instance (tests read engine state / fast-forward through it). */
  server(): ServerRoom;
  patterns: MemoryPatternMsg[];
  shots: PuttShotView[];
  errors: Array<{ type?: string; code: string; message: string }>;
  toasts: Array<{ kind: string; text: string }>;
  removed: Array<{ reason: string; message: string }>;
}

/** Loose view of a server room (drivers poke timings and engine state, as the games' own tests do). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to private room internals
export type ServerRoom = any;

export const stateOf = (room: SdkRoom) =>
  room.state as unknown as Record<string, unknown> & { phase: string; toJSON(): Record<string, unknown> };

export async function joinMatchRoom(
  colyseus: ColyseusTestServer,
  roomCode: string,
  options: { name: string; ticket?: string; guestId?: string; spectator?: boolean },
): Promise<MatchSeat & { welcome(): WelcomePayload | undefined }> {
  const room = await colyseus.sdk.joinById(roomCode, { guestId: `guest-${options.name}`, ...options });
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const patterns = collect<MemoryPatternMsg>(room, MEMORY_MSG.pattern);
  const shots = collect<PuttShotView>(room, PUTT_MSG.shot);
  const errors = collect<{ type?: string; code: string; message: string }>(room, 'sys:error');
  const toasts = collect<{ kind: string; text: string }>(room, 'sys:toast');
  const removed = collect<{ reason: string; message: string }>(room, 'sys:removed');
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  const code = room.roomId;
  return {
    room,
    participantId: '',
    playerId: () => welcomes[welcomes.length - 1]!.playerId,
    welcome: () => welcomes[welcomes.length - 1],
    info: () => JSON.parse(stateOf(room).tournamentJson as string) as TournamentMatchInfo,
    server: () => colyseus.getRoomById(code) as ServerRoom,
    patterns,
    shots,
    errors,
    toasts,
    removed,
  };
}

/**
 * A closure that reports whether the game being played when it was created is over (results, or the
 * series moved on). Drivers loop until it says so — never into the next game of the series, even if
 * a busy test process missed the short RESULTS window.
 */
export function gameOver(seat: MatchSeat): () => boolean {
  const n = seat.info().gameNumber;
  return () => stateOf(seat.room).phase === 'RESULTS' || seat.info().gameNumber !== n || seat.info().seriesStatus !== 'playing';
}

export interface GameDriver {
  gameId: GameId;
  /** The room seats the 'first' participant as its first mover (chess White, paddle left/first serve…). */
  sided: boolean;
  /** Compress the room's timings (called on every freshly launched match room, before anyone joins). */
  fast(server: ServerRoom): void;
  /** The game is live and accepting game actions (after the countdown). */
  live(seat: MatchSeat): boolean;
  /** Room player id the game put on the 'first' side (sided games). */
  firstMover?(server: ServerRoom): string;
  /** Play the current game so that `winner` wins it. */
  win(winner: MatchSeat, loser: MatchSeat): Promise<void>;
  /** Play the current game to a draw (games whose single games can be drawn). */
  draw?(a: MatchSeat, b: MatchSeat): Promise<void>;
  /** The game's own "rematch / play again" message (must be refused in tournament rooms). */
  rematch: { type: string; payload: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Boardroom games (chess, checkers): resign / draw by agreement
// ---------------------------------------------------------------------------

function boardDriver(gameId: 'chess' | 'checkers'): GameDriver {
  return {
    gameId,
    sided: true,
    fast(server) {
      server.countdownMs = 60;
    },
    live: (seat) => stateOf(seat.room).phase === 'PLAYING' && !(stateOf(seat.room).result as { over: boolean }).over,
    firstMover: (server) => server.state.seats[0].playerId as string,
    async win(_winner, loser) {
      loser.room.send(`${gameId}:resign`, {});
    },
    rematch: { type: `${gameId}:rematch`, payload: { action: 'offer' } },
    async draw(a, b) {
      a.room.send(`${gameId}:draw`, { action: 'offer' });
      await waitFor(() => (stateOf(b.room).offers as { drawBy: string }).drawBy !== '', 3000, 'draw offer');
      b.room.send(`${gameId}:draw`, { action: 'accept' });
    },
  };
}

// ---------------------------------------------------------------------------
// Ships: the loser strikes their colours during deployment
// ---------------------------------------------------------------------------

const shipsDriver: GameDriver = {
  gameId: 'ships',
  sided: true,
  fast(server) {
    server.countdownMs = 60;
    server.timing = { ...server.timing, over: 60 };
  },
  live: (seat) => stateOf(seat.room).phase === 'PLAYING' && stateOf(seat.room).stage === 'placement',
  rematch: { type: SHIPS_MSG.rematch, payload: { want: true } },
  // Who fires first is decided when the battle opens; with tournament sides it is deterministic.
  firstMover: (server) => server.pickFirstShooter() as string,
  async win(winner, loser) {
    // Both captains deploy a legal fleet; the 'first' side must fire first; then the loser strikes their colours.
    const server = winner.server();
    const rng = createSeededRng(`fleet-${server.state.matchNo}`);
    for (const seat of [winner, loser]) seat.room.send(SHIPS_MSG.layout, { vessels: randomLayout(rng, server.rules), ready: true });
    await waitFor(() => stateOf(winner.room).stage === 'battle', 3000, 'ships battle');
    const first = winner.info().participants.find((p) => p.side === 'first')?.playerId;
    if (!first || stateOf(winner.room).turnId !== first)
      throw new Error(`ships: the 'first' side (${first}) must fire first, not ${String(stateOf(winner.room).turnId)}`);
    loser.room.send(SHIPS_MSG.resign, {});
  },
};

// ---------------------------------------------------------------------------
// Putt: the loser picks up every hole; the winner holes out until ahead
// ---------------------------------------------------------------------------

interface GolferView {
  x: number;
  y: number;
  moving: boolean;
  total: number;
  holed: boolean;
  pickedUp: boolean;
  lastSeq: number;
}

const golfer = (seat: MatchSeat, id = seat.playerId()) => (stateOf(seat.room).golfers as Map<string, GolferView>).get(id);

/** Pick the ball up (the concede button). Paced like a person: retried if the action rate limit bites. */
async function puttPickup(seat: MatchSeat, observer: MatchSeat = seat): Promise<void> {
  const me = seat.playerId();
  const index = stateOf(observer.room).holeIndex;
  for (let attempt = 0; attempt < 6; attempt++) {
    const errors = seat.errors.length;
    seat.room.send(PUTT_MSG.pickup, {});
    try {
      await waitFor(
        () =>
          Boolean(golfer(observer, me)?.pickedUp) ||
          stateOf(observer.room).holeIndex !== index ||
          stateOf(observer.room).phase !== 'PLAYING' ||
          seat.errors.length > errors,
        3000,
        'pickup',
      );
    } catch {
      continue;
    }
    if (seat.errors.slice(errors).some((e) => e.code === 'rate_limited')) {
      await sleep(400);
      continue;
    }
    return;
  }
  throw new Error('pickup never went through');
}

async function puttHoleOut(seat: MatchSeat): Promise<void> {
  const me = seat.playerId();
  for (let i = 0; i < 8; i++) {
    await waitFor(() => stateOf(seat.room).turnId === me && golfer(seat)?.moving === false, 4000, 'putt turn');
    const g = golfer(seat)!;
    const st = stateOf(seat.room);
    const route = st.route as number[];
    const hole = getHole(route[st.holeIndex as number]!);
    const best = searchShots(hole, { x: g.x, y: g.y }, { angleStep: 100, keep: 1 })[0]!;
    const before = seat.shots.length;
    seat.room.send(PUTT_MSG.stroke, { angle: best.angle, power: best.power });
    await waitFor(() => seat.shots.length > before, 3000, 'putt shot');
    const shot = seat.shots[seat.shots.length - 1]!;
    await waitFor(() => golfer(seat)?.moving === false && golfer(seat)?.lastSeq === shot.seq, 4000, 'ball at rest');
    if (shot.holed || shot.pickedUp) return;
  }
}

const puttDriver: GameDriver = {
  gameId: 'putt',
  sided: false,
  fast(server) {
    server.countdownMs = 60;
    server.introMs = 40;
    server.intermissionMs = 80;
    server.resultsDelayMs = 40;
    server.restPadMs = 0;
    server.playbackScale = 0.02;
  },
  live: (seat) => stateOf(seat.room).phase === 'PLAYING' && stateOf(seat.room).holeStatus === 'play',
  rematch: { type: PUTT_MSG.rematch, payload: {} },
  async win(winner, loser) {
    const over = gameOver(winner);
    const regulation = () => stateOf(winner.room).regulation as number;
    for (let h = 0; h < regulation(); h++) {
      await waitFor(
        () =>
          (stateOf(winner.room).phase === 'PLAYING' &&
            stateOf(winner.room).holeStatus === 'play' &&
            stateOf(winner.room).holeIndex === h) ||
          over(),
        6000,
        `putt hole ${h + 1}`,
      );
      if (over()) return;
      // Totals so far cover the finished holes: once ahead, the winner can pick up too.
      const ahead = (golfer(winner)?.total ?? 0) < (golfer(winner, loser.playerId())?.total ?? 0);
      await puttPickup(loser, winner);
      if (ahead) await puttPickup(winner);
      else await puttHoleOut(winner);
    }
  },
  async draw(a, b) {
    // Everyone picks up every hole (and every playoff hole) → level after the playoff limit.
    const over = gameOver(a);
    for (let guard = 0; guard < 16; guard++) {
      await waitFor(() => (stateOf(a.room).phase === 'PLAYING' && stateOf(a.room).holeStatus === 'play') || over(), 6000, 'putt hole');
      if (over()) return;
      const index = stateOf(a.room).holeIndex as number;
      await Promise.all([puttPickup(a), puttPickup(b, a)]);
      await waitFor(() => stateOf(a.room).holeIndex !== index || stateOf(a.room).phase !== 'PLAYING' || over(), 6000, 'next hole');
    }
  },
};

// ---------------------------------------------------------------------------
// Paddle: fast-forward to game point and let the ball through
// ---------------------------------------------------------------------------

const paddleDriver: GameDriver = {
  gameId: 'paddle',
  sided: true,
  fast(server) {
    server.countdownMs = 60;
    server.matchCountdownMs = 60;
    server.resultsDelayMs = 40;
  },
  live: (seat) => stateOf(seat.room).phase === 'PLAYING',
  rematch: { type: CLASSICS_MSG.rematch, payload: {} },
  firstMover: (server) => server.state.left.playerId as string,
  async win(winner) {
    const server = winner.server();
    await waitFor(() => Boolean(server.match) && Date.now() >= server.startAt, 3000, 'paddle rally');
    const m = server.match as PaddleMatch;
    const side = server.state.left.playerId === winner.playerId() ? 0 : 1;
    const other = side === 0 ? 1 : 0;
    m.sides[side].score = PADDLE_TOURNAMENT_RULES.target - 1;
    m.sides[other].score = 0;
    m.status = 'play';
    m.ball.x = side === 0 ? FACE_X[1] - 40 : FACE_X[0] + 40;
    m.ball.y = m.sides[other].y > 450 ? 60 : 840;
    m.ball.vx = side === 0 ? 30 : -30;
    m.ball.vy = 0;
    m.ball.speed = 30;
  },
};

// ---------------------------------------------------------------------------
// Snake (tournament = survival): the loser steers into the nearest wall, the winner flies the autopilot
// ---------------------------------------------------------------------------

const snakeDriver: GameDriver = {
  gameId: 'snake',
  sided: false,
  fast(server) {
    server.countdownMs = 60;
    server.matchCountdownMs = 60;
    server.resultsDelayMs = 40;
  },
  live: (seat) => stateOf(seat.room).phase === 'PLAYING',
  rematch: { type: CLASSICS_MSG.rematch, payload: {} },
  async win(winner, loser) {
    const server = winner.server();
    await waitFor(() => Boolean(server.game), 3000, 'snake game');
    const g = server.game as SnakeGame;
    const slotOf = (seat: MatchSeat) => g.snakes.findIndex((s) => s.id === seat.playerId());
    const ls = g.snakes[slotOf(loser)]!;
    loser.room.send(SNAKE_MSG.turn, { dir: cellY(g, ls.body[0]!) < g.rules.rows / 2 ? 0 : 2 });
    let on = true;
    const pilot = (async () => {
      while (on && server.game === g && g.status === 'running') {
        const slot = slotOf(winner);
        const d = botDirection(g, slot);
        if (d !== null && d !== g.snakes[slot]!.dir && winner.room.connection.isOpen) winner.room.send(SNAKE_MSG.turn, { dir: d });
        await sleep(20);
      }
    })();
    try {
      await waitFor(() => g.status === 'over' || server.game !== g, 15_000, 'snake crash');
    } finally {
      on = false;
      await pilot;
    }
  },
};

// ---------------------------------------------------------------------------
// Memory Matrix: the winner repeats the patterns while the loser misses; then both run out
// ---------------------------------------------------------------------------

async function memoryPlay(seats: MatchSeat[], correct: (seat: MatchSeat, round: number) => boolean): Promise<void> {
  const [a] = seats as [MatchSeat];
  const st = () => stateOf(a.room);
  const over = gameOver(a);
  const standing = (seat: MatchSeat) => (st().standings as Map<string, { status: string }>).get(seat.playerId())?.status;
  for (let guard = 0; guard < 40; guard++) {
    await waitFor(() => (st().stage === 'input' && st().phase === 'PLAYING') || st().phase !== 'PLAYING' || over(), 8000, 'memory input');
    if (st().phase !== 'PLAYING' || over()) return;
    const round = st().round as number;
    for (const seat of seats) {
      if (standing(seat) !== 'playing') continue;
      // The last pattern for this round number is the current game's (games restart at round 1).
      const pattern = [...seat.patterns].reverse().find((p) => p.round === round);
      if (!pattern) throw new Error(`no pattern for round ${round}`);
      if (correct(seat, round)) {
        for (const tile of pattern.tiles) seat.room.send(MEMORY_MSG.tap, { round, tile });
      } else {
        const wrong = [...Array(pattern.size * pattern.size).keys()].find((t) => !pattern.tiles.includes(t))!;
        seat.room.send(MEMORY_MSG.tap, { round, tile: wrong });
      }
    }
    await waitFor(() => st().stage !== 'input' || st().round !== round || st().phase !== 'PLAYING', 8000, 'memory round closed');
  }
}

const memoryDriver: GameDriver = {
  gameId: 'memory',
  sided: false,
  fast(server) {
    server.countdownMs = 60;
    server.matchCountdownMs = 60;
    server.resultsDelayMs = 40;
    server.introMs = 40;
    server.reviewMs = 40;
    server.showLeadMs = 10;
    server.firstRoundDelayMs = 20;
    // Pattern playback length comes from the round spec; shorten it too (clients get the tiles at show time).
    const startRound = server.startRound.bind(server) as (round: number) => void;
    server.startRound = (round: number) => {
      startRound(round);
      if (server.spec) server.spec = { ...server.spec, showMs: 40 };
    };
  },
  live: (seat) => stateOf(seat.room).phase === 'PLAYING',
  rematch: { type: CLASSICS_MSG.rematch, payload: {} },
  async win(winner, loser) {
    const standing = (seat: MatchSeat) => (stateOf(winner.room).standings as Map<string, { status: string }>).get(seat.playerId())?.status;
    // The winner answers correctly for as long as the loser is still in, then misses too.
    await memoryPlay([winner, loser], (seat) => seat === winner && standing(loser) === 'playing');
  },
  async draw(a, b) {
    await memoryPlay([a, b], () => false);
  },
};

export const DRIVERS: Record<string, GameDriver> = {
  chess: boardDriver('chess'),
  checkers: boardDriver('checkers'),
  ships: shipsDriver,
  putt: puttDriver,
  paddle: paddleDriver,
  snake: snakeDriver,
  memory: memoryDriver,
};
