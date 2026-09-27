/**
 * Items on the server: the position-weighted distribution, rolls, and the live entities (pucks,
 * seekers, mines, fizz puddles). Items only exist in the authoritative sim (rolled with the
 * injected Rng); the physics (kart.ts) handles the local kart's self-affecting uses so client
 * prediction stays exact for turbos and shields.
 *
 * Fairness rules
 *  - Every hit is a 1 s spin followed by 1.5 s of immunity (no stun-lock); fizz is only a grip loss.
 *  - Counterplay: shields block one hit; a trailing puck/mine/fizz blocks one hit from behind;
 *    pucks are dodgeable (they travel straight and ricochet), seekers follow the racing line and
 *    only home in the last ~25 u; mines arm after 0.3 s; the warp is intangible.
 *  - Comeback is interactive (better items further back), never a hidden speed penalty.
 */
import { KART_ITEM_IDS, type KartItemId } from '@dascade/shared/games/kart';
import type { Rng } from '@dascade/shared';
import { itemCode, itemUses } from './itemcodes.ts';
import { applyHit, type ItemUse, type KartState } from './kart.ts';
import { clamp, datan2, dcos, dsin, f32, loopDelta, qheading } from './math.ts';
import { EDGE_DROP, EDGE_WALL, locate, newLoc, racingPointAt, type KartTrack } from './track.ts';
import type { KartHitCause } from '@dascade/shared/games/kart';

export type EntityKind = 'puck' | 'seeker' | 'mine' | 'puddle';
export const ENTITY_KINDS: readonly EntityKind[] = ['puck', 'seeker', 'mine', 'puddle'];

export interface KartEntity {
  id: number;
  kind: EntityKind;
  owner: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  age: number;
  life: number;
  /** Puck: wall bounces so far. */
  bounces: number;
  /** Seeker: target slot (-1 none). */
  target: number;
  /** Seeker: progress s along the racing line. */
  s: number;
  seg: number;
  branch: number;
  /** Traps: lobbed and still in the air. */
  flying: boolean;
}

export const ITEM_TUNING = {
  puckSpeed: 46,
  puckBackSpeed: 34,
  puckLife: 360,
  puckBounces: 3,
  puckRadius: 0.7,
  seekerSpeed: 50,
  seekerHomeSpeed: 58,
  seekerHomeRange: 25,
  seekerLife: 900,
  seekerRadius: 0.8,
  mineRadius: 0.9,
  mineArm: 18,
  mineLife: 2400,
  puddleRadius: 1.7,
  puddleLife: 480,
  lobSpeed: 16,
  lobVz: 9,
  ownerGrace: 24,
  maxEntities: 60,
  boxRespawnTicks: 120,
  boxRadius: 2.2,
  rouletteTicks: 66,
  magnetTicks: 210,
  magnetRange: 160,
  pulseRange: 120,
  /** A pulse spins at most this many karts (the nearest ahead) so a 30-kart pack isn't wiped out. */
  pulseMaxVictims: 8,
} as const;

// ---------------------------------------------------------------------------
// Distribution
// ---------------------------------------------------------------------------

type Weights = Record<KartItemId, number>;

/** Anchor tables at position fractions 0 (leader), 1/3, 2/3 and 1 (last); interpolated between. */
const ANCHORS: ReadonlyArray<readonly [number, Weights]> = [
  [0, { turbo: 20, turbo3: 0, puck: 22, puck3: 4, seeker: 6, mine: 20, fizz: 16, shield: 12, magnet: 0, warp: 0, pulse: 0 }],
  [1 / 3, { turbo: 20, turbo3: 6, puck: 16, puck3: 10, seeker: 14, mine: 10, fizz: 8, shield: 8, magnet: 8, warp: 0, pulse: 0 }],
  [2 / 3, { turbo: 14, turbo3: 18, puck: 8, puck3: 10, seeker: 18, mine: 4, fizz: 4, shield: 4, magnet: 14, warp: 3, pulse: 1.5 }],
  [1, { turbo: 6, turbo3: 26, puck: 2, puck3: 6, seeker: 16, mine: 0, fizz: 0, shield: 2, magnet: 22, warp: 10, pulse: 5 }],
];

/** Racers in the front quarter never get the rare catch-up items, however far the leader is. */
export const RARE_MIN_POSITION_FRAC = 0.25;

/**
 * Item probabilities for a racer at `positionFrac` (0 = leader, 1 = last) who is `gapToLeader`
 * units behind the leader, in a field of `racers`. Sums to 1.
 */
export function itemWeights(positionFrac: number, gapToLeader: number, racers: number): Weights {
  const p = racers <= 1 ? 0 : clamp(positionFrac, 0, 1);
  const leader = racers <= 1 || p === 0;
  // Far behind the leader counts like being further back (up to +0.35).
  const boost = leader ? 0 : 0.35 * clamp((gapToLeader - 60) / 400, 0, 1);
  const pe = Math.min(1, p + boost);
  let k = 0;
  while (k < ANCHORS.length - 2 && pe > ANCHORS[k + 1]![0]) k++;
  const [p0, w0] = ANCHORS[k]!;
  const [p1, w1] = ANCHORS[k + 1]!;
  const t = clamp((pe - p0) / (p1 - p0), 0, 1);
  const out = {} as Weights;
  let total = 0;
  for (const id of KART_ITEM_IDS) {
    let w = w0[id] + (w1[id] - w0[id]) * t;
    if (leader && (id === 'seeker' || id === 'magnet')) w = 0;
    if (p < RARE_MIN_POSITION_FRAC && (id === 'warp' || id === 'pulse')) w = 0;
    out[id] = w;
    total += w;
  }
  for (const id of KART_ITEM_IDS) out[id] = out[id] / total;
  return out;
}

export function rollItem(rng: Rng, positionFrac: number, gapToLeader: number, racers: number): KartItemId {
  const w = itemWeights(positionFrac, gapToLeader, racers);
  let r = rng.next();
  for (const id of KART_ITEM_IDS) {
    r -= w[id];
    if (r < 0) return id;
  }
  // Floating-point remainder: the last item with any weight.
  for (let i = KART_ITEM_IDS.length - 1; i >= 0; i--) if (w[KART_ITEM_IDS[i]!] > 0) return KART_ITEM_IDS[i]!;
  return 'turbo';
}

/** Give a kart an item (roulette result). */
export function giveItem(st: KartState, id: KartItemId): void {
  st.item = itemCode(id);
  st.itemUses = itemUses(id);
  st.trailing = false;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/** What the entity system needs to know about a kart. */
export interface ItemKart {
  slot: number;
  state: KartState;
  /** Can't be touched (retired, finished, ghost). */
  ghost: boolean;
  /** Rank distance (for pulse range / seeker targets). */
  distance: number;
  /** 1-based position. */
  position: number;
}

export interface ItemHit {
  victim: number;
  by: number | null;
  cause: KartHitCause;
  blocked: boolean;
}

const loc = newLoc();

export class ItemWorld {
  readonly track: KartTrack;
  entities: KartEntity[] = [];
  private nextId = 1;

  constructor(track: KartTrack) {
    this.track = track;
  }

  private add(e: Omit<KartEntity, 'id'>): KartEntity {
    const ent = { ...e, id: this.nextId } as KartEntity;
    this.nextId = this.nextId >= 0xffff ? 1 : this.nextId + 1;
    if (this.entities.length >= ITEM_TUNING.maxEntities) {
      // Oldest trap first, else the oldest entity.
      let idx = this.entities.findIndex((x) => x.kind === 'mine' || x.kind === 'puddle');
      if (idx < 0) idx = 0;
      this.entities.splice(idx, 1);
    }
    this.entities.push(ent);
    return ent;
  }

  /** Spawn what a kart just used. Returns hits (pulse) applied immediately. */
  use(kart: ItemKart, use: ItemUse, karts: readonly ItemKart[]): ItemHit[] {
    const st = kart.state;
    const fx = dcos(st.heading);
    const fy = dsin(st.heading);
    const speed = st.vx * fx + st.vy * fy;
    const base = {
      owner: kart.slot,
      z: st.z + 0.5,
      vz: 0,
      age: 0,
      bounces: 0,
      target: -1,
      s: 0,
      seg: st.seg,
      branch: st.branch,
      flying: false,
    };
    switch (use.item) {
      case 'puck':
      case 'puck3': {
        const dir = use.back ? -1 : 1;
        const v = use.back ? ITEM_TUNING.puckBackSpeed : Math.max(ITEM_TUNING.puckSpeed, speed + 16);
        const off = use.back ? 2.4 : 2.6;
        this.add({
          ...base,
          kind: 'puck',
          x: f32(st.x + fx * off * dir),
          y: f32(st.y + fy * off * dir),
          vx: fx * v * dir,
          vy: fy * v * dir,
          heading: qheading(st.heading + (dir < 0 ? Math.PI : 0)),
          life: ITEM_TUNING.puckLife,
        });
        return [];
      }
      case 'seeker': {
        const target = this.kartAhead(kart, karts);
        loc.branch = -1;
        locate(this.track, st.x, st.y, st.branch, st.seg, loc);
        this.add({
          ...base,
          kind: 'seeker',
          x: f32(st.x + fx * 2.6),
          y: f32(st.y + fy * 2.6),
          vx: fx * ITEM_TUNING.seekerSpeed,
          vy: fy * ITEM_TUNING.seekerSpeed,
          heading: st.heading,
          life: ITEM_TUNING.seekerLife,
          target: target ? target.slot : -1,
          s: loc.s + 2.6,
        });
        return [];
      }
      case 'mine':
      case 'fizz': {
        const kind: EntityKind = use.item === 'mine' ? 'mine' : 'puddle';
        const life = kind === 'mine' ? ITEM_TUNING.mineLife : ITEM_TUNING.puddleLife;
        // Traps drop behind unless explicitly lobbed ahead (`ahead` bit).
        if (use.ahead && !use.back) {
          const v = Math.max(0, speed) + ITEM_TUNING.lobSpeed;
          this.add({
            ...base,
            kind,
            x: f32(st.x + fx * 2),
            y: f32(st.y + fy * 2),
            z: st.z + 1,
            vx: fx * v,
            vy: fy * v,
            vz: ITEM_TUNING.lobVz,
            heading: st.heading,
            life,
            flying: true,
          });
        } else {
          this.add({ ...base, kind, x: f32(st.x - fx * 2.6), y: f32(st.y - fy * 2.6), z: st.z, vx: 0, vy: 0, heading: st.heading, life });
        }
        return [];
      }
      case 'magnet': {
        const target = this.kartAhead(kart, karts);
        const gap = target ? Math.max(0, target.distance - kart.distance) : 0;
        st.magnetTicks = ITEM_TUNING.magnetTicks;
        st.magnetPower = Math.round(clamp(8 + gap * 0.12, 8, 30));
        return [];
      }
      case 'pulse': {
        const ahead = karts
          .filter((k) => k !== kart && !k.ghost && k.distance > kart.distance && k.distance - kart.distance <= ITEM_TUNING.pulseRange)
          .sort((a, b) => a.distance - b.distance || a.slot - b.slot)
          .slice(0, ITEM_TUNING.pulseMaxVictims);
        const hits: ItemHit[] = [];
        for (const k of ahead) {
          const out = applyHit(k.state, 'spin', false);
          if (out !== 'ignored') hits.push({ victim: k.slot, by: kart.slot, cause: 'pulse', blocked: out === 'blocked' });
        }
        return hits;
      }
      default:
        return [];
    }
  }

  /** The racer directly ahead in the standings (null for the leader). */
  kartAhead(kart: ItemKart, karts: readonly ItemKart[]): ItemKart | null {
    let best: ItemKart | null = null;
    for (const k of karts) {
      if (k === kart || k.ghost || k.distance <= kart.distance) continue;
      if (!best || k.distance < best.distance) best = k;
    }
    return best;
  }

  /** Magnet tug: steer the velocity a little toward the kart ahead (server only). */
  magnetTug(kart: ItemKart, karts: readonly ItemKart[]): void {
    const st = kart.state;
    if (st.magnetTicks <= 0) return;
    const t = this.kartAhead(kart, karts);
    if (!t || t.distance - kart.distance > ITEM_TUNING.magnetRange) return;
    const dx = t.state.x - st.x;
    const dy = t.state.y - st.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const pull = 7 / 60;
    st.vx += (dx / dist) * pull;
    st.vy += (dy / dist) * pull;
  }

  /** Advance every entity one tick and resolve hits. */
  step(karts: readonly ItemKart[], out: ItemHit[]): void {
    const track = this.track;
    const dt = 1 / 60;
    const keep: KartEntity[] = [];
    for (const e of this.entities) {
      e.age++;
      if (e.age > e.life) continue;
      let alive = true;
      if (e.kind === 'puck') alive = this.movePuck(e, dt);
      else if (e.kind === 'seeker') alive = this.moveSeeker(e, karts, dt);
      else if (e.flying) alive = this.moveLob(e, dt);
      if (!alive) continue;
      if (e.flying) {
        keep.push(e);
        continue;
      }
      if (this.collide(e, karts, out)) continue;
      keep.push(e);
    }
    // Pucks and seekers destroy each other and traps they touch.
    this.entities = this.crossHits(keep);
    void track;
  }

  private movePuck(e: KartEntity, dt: number): boolean {
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    locate(this.track, e.x, e.y, e.branch, e.seg, loc);
    e.seg = loc.seg;
    e.branch = loc.branch;
    const left = loc.d >= 0;
    const hw = left ? loc.hwL : loc.hwR;
    const edge = left ? loc.edgeL : loc.edgeR;
    const lim = hw + this.track.shoulder - ITEM_TUNING.puckRadius;
    if (loc.noGround) return false;
    if (Math.abs(loc.d) > lim) {
      if (edge === EDGE_DROP) return false;
      if (edge === EDGE_WALL) {
        const side = left ? 1 : -1;
        const ox = -loc.ty * side;
        const oy = loc.tx * side;
        const pen = Math.abs(loc.d) - lim;
        e.x -= ox * pen;
        e.y -= oy * pen;
        const vn = e.vx * ox + e.vy * oy;
        if (vn > 0) {
          e.vx -= 2 * ox * vn;
          e.vy -= 2 * oy * vn;
          e.bounces++;
          if (e.bounces > ITEM_TUNING.puckBounces) return false;
        }
      }
    }
    e.x = f32(e.x);
    e.y = f32(e.y);
    e.z = loc.z + 0.5;
    e.heading = datan2(e.vy, e.vx);
    return true;
  }

  private moveSeeker(e: KartEntity, karts: readonly ItemKart[], dt: number): boolean {
    const target = karts.find((k) => k.slot === e.target && !k.ghost);
    if (!target) return e.age < 60 ? this.followLine(e, dt) : false;
    const L = this.track.length;
    locate(this.track, target.state.x, target.state.y, target.state.branch, target.state.seg, loc);
    const tS = loc.s;
    const gap = loopDelta(e.s, tS, L);
    const dx = target.state.x - e.x;
    const dy = target.state.y - e.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (gap < ITEM_TUNING.seekerHomeRange && dist < ITEM_TUNING.seekerHomeRange * 1.4) {
      const v = ITEM_TUNING.seekerHomeSpeed;
      e.vx = (dx / (dist || 1)) * v;
      e.vy = (dy / (dist || 1)) * v;
      e.x = f32(e.x + e.vx * dt);
      e.y = f32(e.y + e.vy * dt);
      e.z = target.state.z + 0.6;
      e.heading = datan2(e.vy, e.vx);
      e.s = tS - Math.max(0, gap - v * dt);
      return true;
    }
    return this.followLine(e, dt);
  }

  private followLine(e: KartEntity, dt: number): boolean {
    e.s += ITEM_TUNING.seekerSpeed * dt;
    const p = racingPointAt(this.track, e.s);
    const nx = p.x;
    const ny = p.y;
    // Ease from the launch point onto the line over the first half second.
    const w = Math.min(1, e.age / 30);
    const px = e.x + e.vx * dt;
    const py = e.y + e.vy * dt;
    const x = px + (nx - px) * w;
    const y = py + (ny - py) * w;
    e.vx = (x - e.x) / dt;
    e.vy = (y - e.y) / dt;
    e.x = f32(x);
    e.y = f32(y);
    e.z = p.z + 0.8;
    e.heading = datan2(e.vy, e.vx);
    return true;
  }

  private moveLob(e: KartEntity, dt: number): boolean {
    e.vz -= 30 * dt;
    e.x = f32(e.x + e.vx * dt);
    e.y = f32(e.y + e.vy * dt);
    e.z += e.vz * dt;
    locate(this.track, e.x, e.y, e.branch, e.seg, loc);
    e.seg = loc.seg;
    e.branch = loc.branch;
    const left = loc.d >= 0;
    const hw = left ? loc.hwL : loc.hwR;
    if (Math.abs(loc.d) > hw + this.track.shoulder) {
      if ((left ? loc.edgeL : loc.edgeR) === EDGE_DROP) return false;
      const side = left ? 1 : -1;
      const pen = Math.abs(loc.d) - (hw + this.track.shoulder);
      e.x = f32(e.x + loc.ty * side * pen);
      e.y = f32(e.y - loc.tx * side * pen);
      e.vx *= 0.3;
      e.vy *= 0.3;
    }
    if (e.z <= loc.z && e.vz < 0) {
      if (loc.noGround) return false;
      e.z = loc.z;
      e.vx = e.vy = e.vz = 0;
      e.flying = false;
      e.age = 0;
    }
    return e.z > loc.z - 20;
  }

  /** Returns true when the entity is consumed. */
  private collide(e: KartEntity, karts: readonly ItemKart[], out: ItemHit[]): boolean {
    const radius =
      e.kind === 'puck'
        ? ITEM_TUNING.puckRadius
        : e.kind === 'seeker'
          ? ITEM_TUNING.seekerRadius
          : e.kind === 'mine'
            ? ITEM_TUNING.mineRadius
            : ITEM_TUNING.puddleRadius;
    if (e.kind === 'mine' && e.age < ITEM_TUNING.mineArm) return false;
    for (const k of karts) {
      if (k.ghost) continue;
      const st = k.state;
      if (k.slot === e.owner && e.age < ITEM_TUNING.ownerGrace && e.kind !== 'puddle') continue;
      if (e.kind === 'puddle' && k.slot === e.owner && e.age < ITEM_TUNING.ownerGrace * 2) continue;
      const r = radius + 1.1;
      const dx = st.x - e.x;
      const dy = st.y - e.y;
      if (dx * dx + dy * dy > r * r || Math.abs(st.z - e.z) > 2.5) continue;
      if (st.warpTicks > 0) continue;
      if (e.kind === 'puddle') {
        const res = applyHit(st, 'slick', false);
        if (res === 'hit') out.push({ victim: k.slot, by: e.owner, cause: 'fizz', blocked: false });
        continue;
      }
      if (st.immuneTicks > 0) {
        // Immune karts pass through traps; projectiles still break on them.
        if (e.kind === 'mine') continue;
        return true;
      }
      const fx = dcos(st.heading);
      const fy = dsin(st.heading);
      const ev = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
      const fromBehind = ev > 1 && (e.vx * fx + e.vy * fy) / ev > 0.3;
      const res = applyHit(st, 'spin', fromBehind);
      const cause: KartHitCause = e.kind === 'puck' ? 'puck' : e.kind === 'seeker' ? 'seeker' : 'mine';
      if (res !== 'ignored') out.push({ victim: k.slot, by: e.owner, cause, blocked: res === 'blocked' });
      return true;
    }
    return false;
  }

  private crossHits(list: KartEntity[]): KartEntity[] {
    const dead = new Set<number>();
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      if (a.flying || (a.kind !== 'puck' && a.kind !== 'seeker')) continue;
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const b = list[j]!;
        if (b.flying || b.kind === 'puddle' || dead.has(b.id)) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy > 1.8 * 1.8 || Math.abs(a.z - b.z) > 2) continue;
        if (a.owner === b.owner && a.age < 30 && b.age < 30) continue;
        dead.add(a.id);
        dead.add(b.id);
      }
    }
    return dead.size ? list.filter((e) => !dead.has(e.id)) : list;
  }
}
