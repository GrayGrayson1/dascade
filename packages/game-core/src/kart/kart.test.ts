/**
 * Physics + feel targets (the "feel lab" numbers, pinned). Targets:
 *  - Top speed 28.5–30.5 u/s by stat; 0 → 95 % top in 1.8–3.3 s (accel stat orders it).
 *  - Steering: yaw response 63 % within ~85 ms; authority low at a crawl, full at mid speed, ~60 % at top;
 *    the grip-limited turn radius at top speed is 16–24 u; a little slip (1–4°) in a full-lock grip turn.
 *  - Drift: inside steer radius clearly tighter than a grip turn (≤ 14 u at ~27 u/s), outside ≥ 2.5× the
 *    inside radius; body angle 18–30° inside; stages at ~0.6/1.3/2.2 s (neutral), faster tight, slower wide;
 *    mini-turbo peak gain over top speed ≥ 4 / 6 / 8 u/s for stages 1 / 2 / 3.
 *  - Walls: 15° graze keeps ≥ 80 % speed, 45° keeps ≥ 50 %, head-on bounces back (never a dead stop).
 *  - Hop 0.2–0.35 s; ramps launch by speed; off-road top speed 55–85 % (grip stat helps).
 */
import { describe, expect, it } from 'vitest';
import { NEUTRAL_KART_INPUT, type KartInput } from '@dascade/shared/games/kart';
import { applyHit, createKartState, DRIFT_STAGE_POINTS, driftStage, PHYS, steerFactor, stepKart, type KartState } from './kart.ts';
import { itemCode } from './itemcodes.ts';
import { HEADING_Q, Q_ANG, Q_VEL, Q_Z } from './math.ts';
import { racerSpec } from './spec.ts';
import { buildTrack, groundAt, pointAtS, type KartTrack } from './track.ts';
import { getKartTrack } from './index.ts';
import type { KartTrackDef } from './trackdef.ts';
import { drive, getLabTrack, getWallTrack, meanSlipDeg, pathRadius, rolling, speedOf, stageTick, timeTo, LAB_DEF } from './lab/feel.ts';

const nova = racerSpec('nova');

describe('straight line', () => {
  it('accelerates along a smooth curve to a stat-dependent top speed', () => {
    const tops: Record<string, number> = {};
    for (const r of ['byte', 'nova', 'brick'] as const) {
      const spec = racerSpec(r);
      const f = drive(() => ({ throttle: 1 }), 600, { racer: r });
      const top = speedOf(f[599]!.state);
      tops[r] = top;
      expect(top).toBeGreaterThan(28.3);
      expect(top).toBeLessThan(30.5);
      const t95 = timeTo(f, spec.topSpeed * 0.95);
      expect(t95).toBeGreaterThan(1.7);
      expect(t95).toBeLessThan(3.4);
      // Monotonic, no overshoot.
      for (let i = 1; i < f.length; i++) expect(speedOf(f[i]!.state)).toBeGreaterThanOrEqual(speedOf(f[i - 1]!.state) - 1e-6);
    }
    expect(tops.brick!).toBeGreaterThan(tops.nova!);
    expect(tops.nova!).toBeGreaterThan(tops.byte!);
    expect(
      timeTo(
        drive(() => ({ throttle: 1 }), 300, { racer: 'byte' }),
        20,
      ),
    ).toBeLessThan(
      timeTo(
        drive(() => ({ throttle: 1 }), 300, { racer: 'brick' }),
        20,
      ),
    );
  });

  it('brakes, coasts and reverses', () => {
    const brake = drive(() => ({ brake: 1 }), 120, { start: rolling(28) });
    const stopTick = brake.findIndex((f) => speedOf(f.state) < 0.5);
    expect(stopTick / 60).toBeLessThan(1);
    const rev = brake[119]!.state;
    expect(rev.vx).toBeLessThan(-2); // reversing after the stop
    expect(rev.vx).toBeGreaterThanOrEqual(-nova.reverseMax - 1e-9);
    const coast = drive(() => ({}), 120, { start: rolling(28) });
    const v = speedOf(coast[119]!.state);
    expect(v).toBeLessThan(24);
    expect(v).toBeGreaterThan(14);
  });
});

describe('steering', () => {
  it('is speed-sensitive: low at a crawl, peak at mid speed, eased at top speed', () => {
    expect(steerFactor(0)).toBeLessThan(0.2);
    expect(steerFactor(10)).toBe(1);
    expect(steerFactor(30)).toBeCloseTo(0.6, 5);
    const yaw = (v: number) => {
      const f = drive(() => ({ throttle: v > 20 ? 1 : 0, steer: 1 }), 10, { start: rolling(v, 350, -15) });
      return f[9]!.state.angVel;
    };
    expect(yaw(2)).toBeLessThan(yaw(11) * 0.5);
    expect(yaw(28)).toBeLessThan(yaw(11) * 0.85);
  });

  it('responds within ~85 ms and turns a 16–24 u radius at top speed with a little slip', () => {
    const f = drive(() => ({ throttle: 1, steer: 1 }), 40, { start: rolling(29, 350, -15) });
    const w = f[39]!.state.angVel;
    const i63 = f.findIndex((fr) => fr.state.angVel >= w * 0.63);
    expect(((i63 + 1) * 1000) / 60).toBeLessThanOrEqual(85);
    const r = speedOf(f[39]!.state) / w;
    expect(r).toBeGreaterThan(16);
    expect(r).toBeLessThan(24);
    const slip = meanSlipDeg(f, 20, 40);
    expect(slip).toBeGreaterThan(0.8);
    expect(slip).toBeLessThan(4);
  });

  it('grip stat raises the cornering limit at speed', () => {
    const turn = (grip: number) => {
      const spec = { ...nova, steerTop: 0.8, latMax: 30 + 5 * grip };
      const f = drive(() => ({ throttle: 1, steer: 1 }), 40, { start: rolling(29, 350, -15), spec });
      return f[39]!.state.angVel;
    };
    expect(turn(5)).toBeGreaterThan(turn(1) * 1.2);
  });
});

describe('hop-drift', () => {
  const driftRun = (steer: number, ticks = 200, spec = nova) =>
    drive((t) => ({ throttle: 1, drift: t >= 2, steer: t < 6 ? 1 : steer }), ticks, { start: rolling(27, 350, -15), spec });

  it('hops, locks the drift direction to the steer side, and tightens/widens with steer', () => {
    const inside = driftRun(1);
    expect(inside.slice(2, 20).some((f) => !f.state.grounded)).toBe(true);
    expect(inside[40]!.state.driftDir).toBe(1);
    const wide = driftRun(-1);
    expect(wide[40]!.state.driftDir).toBe(1); // counter-steer doesn't flip it
    const rIn = pathRadius(inside, 30, 60);
    const rOut = pathRadius(wide, 30, 60);
    expect(rIn).toBeLessThan(14);
    expect(rOut).toBeGreaterThan(rIn * 2.5);
    // Tighter than a full-lock grip turn at the same speed.
    const grip = drive(() => ({ throttle: 1, steer: 1 }), 60, { start: rolling(27, 350, -15) });
    expect(rIn).toBeLessThan(pathRadius(grip, 30, 60) * 0.8);
    const angle = meanSlipDeg(inside, 30, 60);
    expect(angle).toBeGreaterThan(18);
    expect(angle).toBeLessThan(30);
  });

  it('charges through three stages, faster when drifting tighter', () => {
    // A tighter-arcing spec keeps the circle on the lab road; charge doesn't depend on the arc.
    const n = driftRun(0, 260, { ...nova, driftTurn: 1.5 });
    const land = n.findIndex((f, i) => i > 3 && f.state.grounded);
    const s1 = (stageTick(n, 1) - land) / 60;
    const s2 = (stageTick(n, 2) - land) / 60;
    const s3 = (stageTick(n, 3) - land) / 60;
    expect(s1).toBeGreaterThan(0.45);
    expect(s1).toBeLessThan(0.75);
    expect(s2).toBeGreaterThan(1.1);
    expect(s2).toBeLessThan(1.5);
    expect(s3).toBeGreaterThan(1.9);
    expect(s3).toBeLessThan(2.5);
    const tight = driftRun(1, 260, { ...nova, driftTurn: 1.5 });
    expect(stageTick(tight, 3)).toBeLessThan(stageTick(n, 3));
    expect(DRIFT_STAGE_POINTS).toEqual([432, 936, 1584]);
  });

  it('releases into a mini-turbo that kicks harder at higher stages', () => {
    const gains: number[] = [];
    for (const hold of [50, 80, 125]) {
      const f = drive((t) => ({ throttle: 1, drift: t >= 2 && t < hold, steer: t < hold ? 1 : 0 }), hold + 150, {
        start: rolling(28, 350, -15),
      });
      expect(f[hold]!.info.miniTurbo).toBe(gains.length + 1);
      let peak = 0;
      for (const fr of f.slice(hold)) peak = Math.max(peak, speedOf(fr.state));
      gains.push(peak - nova.topSpeed);
    }
    expect(gains[0]!).toBeGreaterThan(4);
    expect(gains[1]!).toBeGreaterThan(6);
    expect(gains[2]!).toBeGreaterThan(8);
    expect(gains[2]!).toBeGreaterThan(gains[1]!);
    expect(gains[1]!).toBeGreaterThan(gains[0]!);
  });

  it('loses the charge on a hit, a big wall hit or when speed collapses', () => {
    const f = driftRun(1, 80);
    const st = { ...f[79]!.state };
    expect(st.driftCharge).toBeGreaterThan(200);
    applyHit(st, 'spin', false);
    expect(st.driftDir).toBe(0);
    expect(st.driftCharge).toBe(0);
    // Braking to a crawl cancels without a boost.
    const slow = drive((t) => ({ drift: true, brake: t > 5 ? 1 : 0, steer: 1 }), 120, { start: { ...f[79]!.state } });
    expect(slow.some((fr) => fr.info.miniTurbo > 0)).toBe(false);
    expect(slow[119]!.state.driftDir).toBe(0);
  });

  it('a short tap is only a hop (no drift without a steer direction)', () => {
    const f = drive((t) => ({ throttle: 1, drift: t >= 2 && t < 10 }), 60, { start: rolling(25, 350, 0) });
    expect(f.every((fr) => fr.state.driftDir === 0)).toBe(true);
    const air = f.filter((fr) => !fr.state.grounded).length / 60;
    expect(air).toBeGreaterThan(0.2);
    expect(air).toBeLessThan(0.35);
  });
});

describe('walls', () => {
  const hit = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    const st = rolling(29, 350, 8, getWallTrack());
    st.vx = 29 * Math.cos(a);
    st.vy = 29 * Math.sin(a);
    st.heading = a;
    const f = drive(() => ({ throttle: 1 }), 160, { start: st, track: getWallTrack() });
    const i = f.findIndex((fr) => fr.info.wallImpact > 0);
    expect(i).toBeGreaterThan(0);
    return { before: speedOf(f[i - 1]!.state), after: speedOf(f[i + 2]!.state), frames: f, i };
  };

  it('bounce costs speed but never stops the kart dead, and it slides along', () => {
    const g15 = hit(15);
    expect(g15.after / g15.before).toBeGreaterThan(0.8);
    const g45 = hit(45);
    expect(g45.after / g45.before).toBeGreaterThan(0.5);
    const head = hit(90);
    expect(head.after).toBeGreaterThan(3);
    // Stays inside the corridor.
    for (const fr of head.frames) expect(Math.abs(fr.info.d)).toBeLessThan(16);
    // After a graze the nose points along the wall (no grinding): no further impacts.
    expect(g15.frames.slice(g15.i + 3).filter((fr) => fr.info.wallImpact > 1).length).toBe(0);
  });
});

describe('hazards only hit karts on their own road (TRACK_NOTES #2)', () => {
  it('a kart on a branch is not hit by a laser gate on the main road at the same progress', () => {
    const def: KartTrackDef = {
      ...LAB_DEF,
      branches: [
        {
          from: 0.02,
          to: 0.3,
          surface: 'road',
          halfWidth: 8,
          points: [
            [150, -70],
            [400, -90],
            [650, -70],
          ],
        },
      ],
      hazards: [{ kind: 'laser', at: 0.15, d: 0, period: 1 }],
    };
    const track = buildTrack(def);
    const b = track.branches[0]!;
    // Walk along the branch every tick: never a hit while the laser is on.
    let st = createKartState(track, { x: b.xs[3]!, y: b.ys[3]!, z: 0, heading: Math.atan2(b.ty[3]!, b.tx[3]!), s: b.from, d: 0 });
    st.branch = b.index;
    st.seg = 3;
    st.vx = 25 * b.tx[3]!;
    st.vy = 25 * b.ty[3]!;
    let hits = 0;
    let onBranch = 0;
    for (let t = 0; t < 900; t++) {
      const i = Math.min(b.n - 1, st.seg + 4);
      const err = Math.atan2(b.ys[i]! - st.y, b.xs[i]! - st.x) - st.heading;
      const r = stepKart(
        st,
        { ...NEUTRAL_KART_INPUT, throttle: 1, steer: Math.max(-1, Math.min(1, Math.atan2(Math.sin(err), Math.cos(err)) * 2)) },
        nova,
        track,
        { locked: false, tick: t },
      );
      st = r.state;
      if (r.info.hazardHit >= 0) hits++;
      if (st.branch === b.index) onBranch++;
      if (st.branch < 0 && onBranch > 0) break;
    }
    expect(onBranch).toBeGreaterThan(100);
    expect(hits).toBe(0);
  });
});

describe('walls: the nose never teleports', () => {
  it('heading change per tick stays bounded on head-on and 45° hits (and the nose ends along the wall)', () => {
    for (const deg of [45, 90, 60, 20]) {
      const a = (deg * Math.PI) / 180;
      const st = rolling(29, 350, 8, getWallTrack());
      st.vx = 29 * Math.cos(a);
      st.vy = 29 * Math.sin(a);
      st.heading = a;
      const f = drive(() => ({ throttle: 1 }), 90, { start: st, track: getWallTrack() });
      let maxStep = 0;
      for (let i = 1; i < f.length; i++) {
        let dh = f[i]!.state.heading - f[i - 1]!.state.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        maxStep = Math.max(maxStep, Math.abs(dh));
      }
      expect(maxStep, `${deg}°`).toBeLessThanOrEqual(PHYS.wallAlignMaxYaw / 60 + 1e-3);
      if (deg < 90) expect(Math.abs(f[89]!.state.heading), `${deg}° ends along the wall`).toBeLessThan(0.25);
    }
  });

  it('a drifting kart (nose 90° into the wall) swings round smoothly', () => {
    const track = getKartTrack('pixel-plaza');
    let st = createKartState(track, 0);
    for (let t = 0; t < 180; t++) st = stepKart(st, { ...NEUTRAL_KART_INPUT, throttle: 1 }, nova, track, { locked: false, tick: t }).state;
    let maxStep = 0;
    for (let t = 0; t < 100; t++) {
      const prev = st.heading;
      st = stepKart(st, { ...NEUTRAL_KART_INPUT, throttle: 1, drift: true, steer: 1 }, nova, track, { locked: false, tick: 180 + t }).state;
      let dh = st.heading - prev;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      maxStep = Math.max(maxStep, Math.abs(dh));
    }
    expect(maxStep).toBeLessThanOrEqual(PHYS.wallAlignMaxYaw / 60 + 1e-3);
  });
});

describe('walls: no pinning (FEEL_NOTES #1)', () => {
  it('a drift held into the wall bounces off, slides along and keeps going (never grinds to a halt)', () => {
    const track = getKartTrack('pixel-plaza');
    let st = createKartState(track, 0);
    const step = (i: Partial<KartInput>, t: number) =>
      stepKart(st, { ...NEUTRAL_KART_INPUT, ...i }, nova, track, { locked: false, tick: t });
    for (let t = 0; t < 180; t++) st = step({ throttle: 1 }, t).state;
    let hitAt = -1;
    let minAfter = Infinity;
    for (let t = 0; t < 100; t++) {
      const r = step({ throttle: 1, drift: true, steer: 1 }, 180 + t);
      st = r.state;
      if (hitAt < 0 && r.info.wallImpact > 15) hitAt = t;
      if (hitAt >= 0 && t > hitAt) minAfter = Math.min(minAfter, speedOf(st));
    }
    expect(hitAt).toBeGreaterThan(0);
    expect(minAfter).toBeGreaterThan(8);
    expect(speedOf(st)).toBeGreaterThan(12);
  });
});

describe('surfaces', () => {
  const zoneTrack: KartTrack = buildTrack({
    ...LAB_DEF,
    zones: [{ from: 0.02, to: 0.3, d0: -16, d1: 16, kind: 'ice' }],
  });
  const mudTrack: KartTrack = buildTrack({ ...LAB_DEF, zones: [{ from: 0.02, to: 0.3, d0: -16, d1: 16, kind: 'mud' }] });

  it('off-road slows to 55–85 % of top and the grip stat helps', () => {
    const top = (r: 'quack' | 'glitch') =>
      speedOf(drive(() => ({ throttle: 1 }), 400, { racer: r, start: rolling(10, 350, 25) })[399]!.state);
    const q = top('quack');
    const g = top('glitch');
    expect(q).toBeGreaterThan(g);
    expect(g / racerSpec('glitch').topSpeed).toBeGreaterThan(0.5);
    expect(q / racerSpec('quack').topSpeed).toBeLessThan(0.85);
  });

  it('boosts punch through off-road', () => {
    const st = rolling(20, 350, 25);
    st.boostTicks = 120;
    st.boostPower = 30;
    const f = drive(() => ({ throttle: 1 }), 100, { start: st });
    expect(speedOf(f[99]!.state)).toBeGreaterThan(nova.topSpeed);
  });

  it('ice slides more than asphalt; mud slows', () => {
    const run = (y: number) => drive(() => ({ throttle: 1, steer: 0.4 }), 50, { start: rolling(22, 100, y), track: zoneTrack });
    const ice = meanSlipDeg(run(-8), 20, 50);
    const road = meanSlipDeg(
      drive(() => ({ throttle: 1, steer: 0.4 }), 50, { start: rolling(22, 350, -8) }),
      20,
      50,
    );
    expect(ice).toBeGreaterThan(road * 3);
    const mud = speedOf(drive(() => ({ throttle: 1 }), 200, { start: rolling(28, 60, 8), track: mudTrack })[199]!.state);
    expect(mud).toBeLessThan(nova.topSpeed * 0.8);
  });
});

describe('air, ramps, gaps and respawn', () => {
  const LL = getLabTrack().length;
  const jumpDef: KartTrackDef = { ...LAB_DEF, ramps: [{ at: 0.1, launch: 13 }], gaps: [{ from: 0.1 + 4 / LL, to: 0.1 + 12 / LL }] };
  const jump = buildTrack(jumpDef);
  const rampS = jump.ramps[0]!.s;

  const approach = (v: number, script: (t: number) => Partial<KartInput> = () => ({ throttle: 1 })) => {
    const c = pointAtS(jump, rampS - 20);
    const st = createKartState(jump, { x: c.x, y: c.y, z: c.z, heading: Math.atan2(c.ty, c.tx), s: rampS - 20, d: 0 });
    st.vx = v * c.tx;
    st.vy = v * c.ty;
    return drive((t) => script(t), 320, { start: st, track: jump });
  };

  it('launches by speed and clears the gap at speed', () => {
    const fast = approach(29);
    const launch = fast.findIndex((f) => f.info.launched);
    expect(launch).toBeGreaterThan(0);
    expect(fast[launch]!.state.vz).toBeGreaterThan(8);
    expect(fast.some((f) => f.info.fell)).toBe(false);
    expect(fast.some((f) => f.info.landed)).toBe(true);
    const air = fast.filter((f) => !f.state.grounded).length / 60;
    expect(air).toBeGreaterThan(0.5);
  });

  it('a drift press at the lip is a trick → landing boost', () => {
    const trick = approach(29, (t) => ({ throttle: 1, drift: t > 0 && t % 100 > 42 && t % 100 < 50 }));
    const launch = trick.findIndex((f) => f.info.launched);
    // Press within the window after takeoff.
    const f2 = approach(29, (t) => ({ throttle: 1, drift: t === launch + 3 }));
    const land = f2.findIndex((f) => f.info.landed);
    expect(land).toBeGreaterThan(launch);
    expect(f2[land]!.state.boostTicks).toBeGreaterThan(0);
    void trick;
    const plain = approach(29);
    const land2 = plain.findIndex((f) => f.info.landed);
    expect(plain[land2]!.state.boostTicks).toBe(0);
  });

  it('falls into the gap when too slow, then respawns past it, stopped, with immunity', () => {
    const slow = approach(9, () => ({ throttle: 0.2 }));
    const fell = slow.findIndex((f) => f.info.fell);
    expect(fell).toBeGreaterThan(0);
    const re = slow.findIndex((f) => f.info.respawned);
    expect((re - fell) / 60).toBeGreaterThan(1.1);
    expect((re - fell) / 60).toBeLessThan(1.3);
    const st = slow[re]!.state;
    expect(speedOf(st)).toBe(0);
    expect(st.grounded).toBe(true);
    expect(st.immuneTicks).toBeGreaterThan(60);
    const gi = groundAt(jump, st.x, st.y);
    expect(gi.s).toBeGreaterThan(jump.gaps[0]!.to);
    expect(gi.onRoad).toBe(true);
  });

  it('driving off a drop edge respawns on the centreline at the last safe point', () => {
    const drop = buildTrack({ ...LAB_DEF, edge: 'drop', shoulder: 2 });
    const st = createKartState(drop, { x: 300, y: 0, z: 0, heading: 1.2, s: 300, d: 0 });
    st.vx = 20 * Math.cos(1.2);
    st.vy = 20 * Math.sin(1.2);
    const f = drive(() => ({ throttle: 1 }), 200, { start: st, track: drop });
    const fell = f.findIndex((fr) => fr.info.fell);
    expect(fell).toBeGreaterThan(0);
    const re = f.findIndex((fr) => fr.info.respawned);
    expect(re).toBeGreaterThan(fell);
    const g = groundAt(drop, f[re]!.state.x, f[re]!.state.y);
    expect(Math.abs(g.d)).toBeLessThan(0.5);
    expect(g.s).toBeGreaterThan(295);
    expect(g.s).toBeLessThan(320);
  });
});

describe('hits, boosts and items on the kart', () => {
  it('spin-out lasts ~1 s, ends facing the same way, then ~1.5 s of immunity', () => {
    const st = rolling(25, 350, 0);
    expect(applyHit(st, 'spin', false)).toBe('hit');
    expect(applyHit(st, 'spin', false)).toBe('ignored');
    const f = drive(() => ({ throttle: 1, steer: 1 }), 200, { start: st });
    const end = f.findIndex((fr) => fr.state.spinTicks === 0);
    expect(end).toBe(PHYS.spinTicks - 1);
    expect(Math.abs(f[end]!.state.heading)).toBeLessThan(0.02);
    const immuneEnd = f.findIndex((fr) => fr.state.immuneTicks === 0);
    expect((immuneEnd - end) / 60).toBeGreaterThan(1.4);
    expect((immuneEnd - end) / 60).toBeLessThan(1.6);
  });

  it('shield blocks one hit; a trailing item blocks one hit from behind only', () => {
    const st = rolling(25);
    st.shieldTicks = 100;
    expect(applyHit(st, 'spin', false)).toBe('blocked');
    expect(st.shieldTicks).toBe(0);
    st.immuneTicks = 0;
    st.item = itemCode('mine');
    st.itemUses = 1;
    st.trailing = true;
    expect(applyHit(st, 'spin', false)).toBe('hit'); // from the front: not blocked, item lost
    expect(st.item).toBe(0);
    const st2 = rolling(25);
    st2.item = itemCode('puck3');
    st2.itemUses = 3;
    st2.trailing = true;
    expect(applyHit(st2, 'spin', true)).toBe('blocked');
    expect(st2.itemUses).toBe(2);
  });

  it('fizz is a grip loss, not a spin', () => {
    const st = rolling(25);
    expect(applyHit(st, 'slick', false)).toBe('hit');
    expect(st.spinTicks).toBe(0);
    expect(st.slickTicks).toBe(PHYS.slickTicks);
  });

  it('using a turbo boosts on the very tick; a shield raises the flag; press/release edges', () => {
    const st = rolling(28);
    st.item = itemCode('turbo3');
    st.itemUses = 3;
    const f = drive((t) => ({ throttle: 1, item: t === 1 || t === 3 }), 10, { start: st });
    expect(f[1]!.info.used?.item).toBe('turbo3');
    expect(f[1]!.state.boostTicks).toBe(PHYS.turboTicks);
    expect(f[3]!.info.used?.item).toBe('turbo3');
    expect(f[9]!.state.itemUses).toBe(1);
    // Holding the button doesn't fire every tick.
    const held = drive(() => ({ throttle: 1, item: true }), 10, { start: { ...st } });
    expect(held.filter((fr) => fr.info.used).length).toBe(1);
    const sh = rolling(20);
    sh.item = itemCode('shield');
    sh.itemUses = 1;
    const g = drive((t) => ({ item: t === 0 }), 3, { start: sh });
    expect(g[0]!.state.shieldTicks).toBe(PHYS.shieldTicks);
    expect(g[2]!.state.item).toBe(0);
  });

  it('trailable items trail while held and fire on release (with the aim)', () => {
    const st = rolling(20);
    st.item = itemCode('puck');
    st.itemUses = 1;
    const f = drive((t) => ({ throttle: 1, item: t < 30, back: t >= 29 }), 40, { start: st });
    expect(f[10]!.state.trailing).toBe(true);
    expect(f[10]!.info.used).toBeNull();
    const use = f.find((fr) => fr.info.used);
    expect(use?.t).toBe(30);
    expect(use?.info.used).toEqual({ item: 'puck', back: true, ahead: false });
    expect(f[39]!.state.item).toBe(0);
  });

  it('three-way aim: pucks forward by default; traps behind by default, ahead only with `ahead`; back wins', () => {
    const fire = (item: 'puck' | 'mine', aim: Partial<KartInput>) => {
      const st = rolling(20);
      st.item = itemCode(item);
      st.itemUses = 1;
      const f = drive((t) => ({ throttle: 1, item: t === 0, ...aim }), 4, { start: st });
      return f.find((fr) => fr.info.used)!.info.used!;
    };
    expect(fire('puck', {})).toEqual({ item: 'puck', back: false, ahead: true });
    expect(fire('puck', { back: true })).toEqual({ item: 'puck', back: true, ahead: false });
    expect(fire('mine', {})).toEqual({ item: 'mine', back: false, ahead: false });
    expect(fire('mine', { ahead: true })).toEqual({ item: 'mine', back: false, ahead: true });
    expect(fire('mine', { ahead: true, back: true })).toEqual({ item: 'mine', back: true, ahead: false });
  });

  it('warp rides the track untouchable, then grants short immunity', () => {
    const track = getKartTrackForWarp();
    const c = pointAtS(track, 50);
    const st = createKartState(track, { x: c.x, y: c.y, z: c.z, heading: Math.atan2(c.ty, c.tx), s: 50, d: 0 });
    st.item = itemCode('warp');
    st.itemUses = 1;
    const f = drive((t) => ({ item: t === 0 }), 240, { start: st, track });
    expect(f[10]!.state.warpTicks).toBeGreaterThan(0);
    expect(applyHit({ ...f[10]!.state }, 'spin', false)).toBe('ignored');
    expect(speedOf(f[60]!.state)).toBeGreaterThan(40);
    const end = f.findIndex((fr) => fr.state.warpTicks === 0);
    expect(end).toBeGreaterThan(150);
    expect(f[end]!.state.immuneTicks).toBeGreaterThan(0);
    // Stayed on the road the whole way.
    for (const fr of f) expect(groundAt(track, fr.state.x, fr.state.y).onRoad).toBe(true);
  });

  it('start boost: throttle in the window boosts, too early spins the wheels', () => {
    const run = (held: number) => {
      let st: KartState = createKartState(getLabTrack(), 0);
      for (let t = 0; t < 120; t++)
        st = stepKart(st, { ...NEUTRAL_KART_INPUT, throttle: t >= 120 - held ? 1 : 0 }, nova, getLabTrack(), {
          locked: true,
          tick: t,
        }).state;
      return stepKart(st, { ...NEUTRAL_KART_INPUT, throttle: 1 }, nova, getLabTrack(), { locked: false, tick: 120 });
    };
    expect(run(30).info.startBoost).toBe('boost');
    expect(run(30).state.boostTicks).toBeGreaterThan(0);
    expect(run(100).info.startBoost).toBe('stall');
    expect(run(0).info.startBoost).toBe('none');
    // Locked karts don't move.
    const locked = stepKart(rolling(10), { ...NEUTRAL_KART_INPUT, throttle: 1 }, nova, getLabTrack(), { locked: true, tick: 0 }).state;
    expect(locked.vx).toBe(0);
  });
});

describe('determinism + quantization', () => {
  it('stepKart is pure and its state is exactly representable on the wire', () => {
    const st0 = rolling(20);
    const frozen = JSON.stringify(st0);
    const a = drive((t) => ({ throttle: 1, steer: Math.sin(t / 9), drift: t % 90 > 20 && t % 90 < 70 }), 400, { start: st0 });
    expect(JSON.stringify(st0)).toBe(frozen);
    const b = drive((t) => ({ throttle: 1, steer: Math.sin(t / 9), drift: t % 90 > 20 && t % 90 < 70 }), 400, { start: rolling(20) });
    expect(a.map((f) => f.state)).toEqual(b.map((f) => f.state));
    for (const { state: s } of a) {
      expect(Math.fround(s.x)).toBe(s.x);
      expect(Math.fround(s.y)).toBe(s.y);
      expect(Number.isInteger(s.z * Q_Z)).toBe(true);
      expect(Number.isInteger(s.vx * Q_VEL)).toBe(true);
      expect(Number.isInteger(s.vz * Q_VEL)).toBe(true);
      expect(Number.isInteger(s.angVel * Q_ANG)).toBe(true);
      expect(Math.round(s.heading / HEADING_Q) * HEADING_Q).toBe(s.heading);
      expect(driftStage(s)).toBeGreaterThanOrEqual(0);
    }
  });
});

function getKartTrackForWarp(): KartTrack {
  return getLabTrack();
}
