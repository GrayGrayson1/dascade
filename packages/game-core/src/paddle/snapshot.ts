/**
 * Compact binary snapshot of a Pixel Paddle match (little-endian, 52 bytes).
 *
 *   u8  version   u8 status (0 serve, 1 play, 2 point, 3 over)   u16 matchId
 *   u32 tick      u16 timer (ticks in status)   u8 server   u8 flags (bit0/1 = serve requested L/R)
 *   f32 ball x, y, vx, vy, speed
 *   f32 left y, left target, right y, right target
 *   u16 rally     u16 reserved
 */
import { createMatch, type MatchStatus, type PaddleMatch, type PaddleRules, type Side } from './sim.ts';

export const PADDLE_SNAPSHOT_VERSION = 1;
export const PADDLE_SNAPSHOT_BYTES = 52;

const STATUS_CODES: readonly MatchStatus[] = ['serve', 'play', 'point', 'over'];

export interface PaddleSnapshot {
  matchId: number;
  tick: number;
  status: MatchStatus;
  timer: number;
  server: Side;
  serveReq: [boolean, boolean];
  ball: { x: number; y: number; vx: number; vy: number; speed: number };
  paddles: [{ y: number; target: number }, { y: number; target: number }];
  rally: number;
}

export function snapshotOf(m: PaddleMatch, matchId: number): PaddleSnapshot {
  return {
    matchId,
    tick: m.tick,
    status: m.status,
    timer: m.timer,
    server: m.server,
    serveReq: [m.sides[0].serveReq, m.sides[1].serveReq],
    ball: { x: m.ball.x, y: m.ball.y, vx: m.ball.vx, vy: m.ball.vy, speed: m.ball.speed },
    paddles: [
      { y: m.sides[0].y, target: m.sides[0].target },
      { y: m.sides[1].y, target: m.sides[1].target },
    ],
    rally: m.rally,
  };
}

export function encodePaddleSnapshot(s: PaddleSnapshot): Uint8Array {
  const buf = new ArrayBuffer(PADDLE_SNAPSHOT_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, PADDLE_SNAPSHOT_VERSION);
  v.setUint8(1, Math.max(0, STATUS_CODES.indexOf(s.status)));
  v.setUint16(2, s.matchId & 0xffff, true);
  v.setUint32(4, s.tick >>> 0, true);
  v.setUint16(8, Math.min(0xffff, s.timer), true);
  v.setUint8(10, s.server);
  v.setUint8(11, (s.serveReq[0] ? 1 : 0) | (s.serveReq[1] ? 2 : 0));
  v.setFloat32(12, s.ball.x, true);
  v.setFloat32(16, s.ball.y, true);
  v.setFloat32(20, s.ball.vx, true);
  v.setFloat32(24, s.ball.vy, true);
  v.setFloat32(28, s.ball.speed, true);
  v.setFloat32(32, s.paddles[0].y, true);
  v.setFloat32(36, s.paddles[0].target, true);
  v.setFloat32(40, s.paddles[1].y, true);
  v.setFloat32(44, s.paddles[1].target, true);
  v.setUint16(48, Math.min(0xffff, s.rally), true);
  return new Uint8Array(buf);
}

/** Decode a snapshot; null for anything malformed (short, wrong version, non-finite numbers). */
export function decodePaddleSnapshot(bytes: Uint8Array): PaddleSnapshot | null {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < PADDLE_SNAPSHOT_BYTES) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint8(0) !== PADDLE_SNAPSHOT_VERSION) return null;
  for (let o = 12; o < 48; o += 4) if (!Number.isFinite(v.getFloat32(o, true))) return null;
  const status = STATUS_CODES[v.getUint8(1)];
  if (!status) return null;
  const flags = v.getUint8(11);
  return {
    matchId: v.getUint16(2, true),
    tick: v.getUint32(4, true),
    status,
    timer: v.getUint16(8, true),
    server: (v.getUint8(10) === 1 ? 1 : 0) as Side,
    serveReq: [(flags & 1) !== 0, (flags & 2) !== 0],
    ball: {
      x: v.getFloat32(12, true),
      y: v.getFloat32(16, true),
      vx: v.getFloat32(20, true),
      vy: v.getFloat32(24, true),
      speed: v.getFloat32(28, true),
    },
    paddles: [
      { y: v.getFloat32(32, true), target: v.getFloat32(36, true) },
      { y: v.getFloat32(40, true), target: v.getFloat32(44, true) },
    ],
    rally: v.getUint16(48, true),
  };
}

/**
 * Load a snapshot into a client-side mirror match (for extrapolating the ball between
 * snapshots). Scores and the winner are NOT carried here; they live in the schema state.
 */
export function applyPaddleSnapshot(mirror: PaddleMatch | null, s: PaddleSnapshot, rules: PaddleRules): PaddleMatch {
  const m = mirror ?? createMatch(rules, s.server);
  m.tick = s.tick;
  m.status = s.status;
  m.timer = s.timer;
  m.server = s.server;
  m.rally = s.rally;
  m.ball.x = s.ball.x;
  m.ball.y = s.ball.y;
  m.ball.vx = s.ball.vx;
  m.ball.vy = s.ball.vy;
  m.ball.speed = s.ball.speed;
  for (const i of [0, 1] as const) {
    const side = m.sides[i];
    side.vy = s.paddles[i].y - side.y;
    side.y = s.paddles[i].y;
    side.target = s.paddles[i].target;
    side.serveReq = s.serveReq[i];
    side.history = [side.y];
  }
  return m;
}
