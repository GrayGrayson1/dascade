/**
 * Binary world snapshot for Asteroid Run (little-endian, via the classics kit ByteWriter).
 *
 * Header: u8 version · u8 status (0 play, 1 intermission, 2 over) · u16 matchId · u32 tick ·
 *         u16 wave · u16 interLeft · u32 teamScore · u8 ships · u16 rocks · u16 bullets · u8 drops
 * Ship (35 B): u8 slot · u8 flags · f32 x,y,vx,vy (exact sim state) · u16 heading×8 · u8 shield ·
 *         u8 lives · u8 invuln · u8 respawnIn · u8 cooldown · u16 shots · u16 spread · u16 rapid · u32 ack
 * Rock (14 B): u16 id · u8 kind<<4|size · u8 hp · u16 x×32 · u16 y×32 · i16 vx×256 · i16 vy×256 · i8 spin
 * Bullet (12 B): u16 id · u8 owner · u16 x×32 · u16 y×32 · i16 vx×256 · i16 vy×256 · u8 life
 * Drop (9 B): u16 id · u8 kind · u16 x×32 · u16 y×32 · u16 ttl
 */
import { POWER_KINDS, ROCK_KINDS, type PowerKind, type RockKind } from '@dascade/shared/games/asteroids';
import { ByteReader, ByteWriter } from '../classics/shared/index.ts';
import type { World, WorldStatus } from './world.ts';

export const ASTEROIDS_SNAPSHOT_VERSION = 1;

export const ShipFlag = { alive: 1, thrusting: 2, out: 4, retired: 8 } as const;

const STATUS: readonly WorldStatus[] = ['play', 'intermission', 'over'];
const POS = 32;
const VEL = 256;

export interface SnapShip {
  slot: number;
  flags: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  h: number;
  shield: number;
  lives: number;
  invuln: number;
  respawnIn: number;
  cooldown: number;
  shots: number;
  spread: number;
  rapid: number;
  ack: number;
}

export interface SnapRock {
  id: number;
  kind: RockKind;
  size: number;
  hp: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
}

export interface SnapBullet {
  id: number;
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export interface SnapDrop {
  id: number;
  kind: PowerKind;
  x: number;
  y: number;
  ttl: number;
}

export interface AsteroidsSnapshot {
  matchId: number;
  tick: number;
  status: WorldStatus;
  wave: number;
  interLeft: number;
  teamScore: number;
  ships: SnapShip[];
  rocks: SnapRock[];
  bullets: SnapBullet[];
  drops: SnapDrop[];
}

const writer = new ByteWriter(2048);

/** Encode the world; `acks[slot]` is the last input seq applied to each ship. */
export function encodeAsteroidsSnapshot(w: World, matchId: number, acks: readonly number[]): Uint8Array {
  const b = writer.reset();
  b.u8(ASTEROIDS_SNAPSHOT_VERSION)
    .u8(Math.max(0, STATUS.indexOf(w.status)))
    .u16(matchId & 0xffff)
    .u32(w.tick)
    .u16(w.wave)
    .u16(Math.max(0, w.interLeft))
    .u32(Math.min(0xffffffff, w.teamScore))
    .u8(w.ships.length)
    .u16(w.rocks.length)
    .u16(w.bullets.length)
    .u8(Math.min(255, w.drops.length));
  for (const s of w.ships) {
    const flags = (s.alive ? ShipFlag.alive : 0) | (s.thrusting && s.alive ? ShipFlag.thrusting : 0) | (s.out ? ShipFlag.out : 0) | (s.retired ? ShipFlag.retired : 0);
    b.u8(s.slot)
      .u8(flags)
      .f32(s.x)
      .f32(s.y)
      .f32(s.vx)
      .f32(s.vy)
      .u16(Math.round(s.h * 8))
      .u8(Math.round(s.shield))
      .u8(s.lives)
      .u8(Math.min(255, s.invuln))
      .u8(Math.min(255, s.respawnIn))
      .u8(Math.min(255, s.cooldown))
      .u16(s.shots)
      .u16(s.spread)
      .u16(s.rapid)
      .u32(acks[s.slot] ?? 0);
  }
  for (const r of w.rocks) {
    b.u16(r.id)
      .u8((Math.max(0, ROCK_KINDS.indexOf(r.kind)) << 4) | (r.size & 15))
      .u8(Math.max(0, r.hp))
      .u16(r.x * POS)
      .u16(r.y * POS)
      .fx16(r.vx, VEL)
      .fx16(r.vy, VEL)
      .i8(r.spin);
  }
  for (const bl of w.bullets) {
    b.u16(bl.id).u8(bl.owner).u16(bl.x * POS).u16(bl.y * POS).fx16(bl.vx, VEL).fx16(bl.vy, VEL).u8(Math.max(0, bl.life));
  }
  for (const d of w.drops.slice(0, 255)) {
    b.u16(d.id).u8(Math.max(0, POWER_KINDS.indexOf(d.kind))).u16(d.x * POS).u16(d.y * POS).u16(d.ttl);
  }
  return b.bytes();
}

/** Decode a world snapshot; null for anything malformed. */
export function decodeAsteroidsSnapshot(bytes: Uint8Array): AsteroidsSnapshot | null {
  if (!(bytes instanceof Uint8Array)) return null;
  const r = new ByteReader(bytes);
  if (r.u8() !== ASTEROIDS_SNAPSHOT_VERSION) return null;
  const status = STATUS[r.u8()];
  const matchId = r.u16();
  const tick = r.u32();
  const wave = r.u16();
  const interLeft = r.u16();
  const teamScore = r.u32();
  const nShips = r.u8();
  const nRocks = r.u16();
  const nBullets = r.u16();
  const nDrops = r.u8();
  if (!r.ok || !status || nShips > 16) return null;
  const ships: SnapShip[] = [];
  for (let i = 0; i < nShips; i++) {
    ships.push({
      slot: r.u8(),
      flags: r.u8(),
      x: r.f32(),
      y: r.f32(),
      vx: r.f32(),
      vy: r.f32(),
      h: r.u16() / 8,
      shield: r.u8(),
      lives: r.u8(),
      invuln: r.u8(),
      respawnIn: r.u8(),
      cooldown: r.u8(),
      shots: r.u16(),
      spread: r.u16(),
      rapid: r.u16(),
      ack: r.u32(),
    });
  }
  const rocks: SnapRock[] = [];
  for (let i = 0; i < nRocks; i++) {
    const id = r.u16();
    const ks = r.u8();
    rocks.push({
      id,
      kind: ROCK_KINDS[ks >> 4] ?? 'stone',
      size: Math.max(1, Math.min(3, ks & 15)),
      hp: r.u8(),
      x: r.u16() / POS,
      y: r.u16() / POS,
      vx: r.fx16(VEL),
      vy: r.fx16(VEL),
      spin: r.i8(),
    });
  }
  const bullets: SnapBullet[] = [];
  for (let i = 0; i < nBullets; i++) {
    bullets.push({ id: r.u16(), owner: r.u8(), x: r.u16() / POS, y: r.u16() / POS, vx: r.fx16(VEL), vy: r.fx16(VEL), life: r.u8() });
  }
  const drops: SnapDrop[] = [];
  for (let i = 0; i < nDrops; i++) {
    const id = r.u16();
    const kind = POWER_KINDS[r.u8()] ?? 'shield';
    drops.push({ id, kind, x: r.u16() / POS, y: r.u16() / POS, ttl: r.u16() });
  }
  if (!r.ok) return null;
  return { matchId, tick, status, wave, interLeft, teamScore, ships, rocks, bullets, drops };
}
