import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { CHASSIS_IDS, INPUT_MAX, NEUTRAL_INPUT, packInput, quantizeInput, unpackInput, type CarInput } from '@dascade/shared/games/circuit';
import { BOOST_Q, CHASSIS, createCar, stepCar, Surface, type CarState } from './car.ts';
import { autopilot, createBotMemory } from './bot.ts';
import { buildTrack, pointAt, projectOnTrack, type Track } from './track.ts';
import { TRACK_DEFS } from './tracks.ts';
import { wrapAngle } from './math.ts';
import { getTrack } from './tracks.ts';

const DT = 1 / 60;
const GAS: CarInput = { throttle: 1, brake: 0, steer: 0, drift: false, boost: false };

/** Place a car on the main straight at arc length s with a lateral offset d. */
function placeCar(track: Track, sPos: number, d = 0, boost = 0.35): CarState {
  const p = pointAt(track, sPos);
  return createCar(p.x - p.ty * d, p.y + p.tx * d, Math.atan2(p.ty, p.tx), track, boost);
}

function run(state: CarState, input: CarInput | ((i: number) => CarInput), steps: number, track: Track, chassis = CHASSIS.volt, boostEnabled = true) {
  let s = state;
  let info = stepCar(s, NEUTRAL_INPUT, chassis, track, { dt: DT, locked: true }).info;
  for (let i = 0; i < steps; i++) {
    const r = stepCar(s, typeof input === 'function' ? input(i) : input, chassis, track, { dt: DT, boostEnabled });
    s = r.state;
    info = r.info;
  }
  return { state: s, info };
}

/** Full throttle while an autopilot keeps the car on the racing line. */
function lineKeeping(track: Track, extra: Partial<CarInput> = {}) {
  const memory = createBotMemory();
  return (state: CarState): CarInput => ({ ...autopilot(state, CHASSIS.volt, track, memory), throttle: 1, brake: 0, boost: false, drift: false, ...extra });
}

function runKeeping(state: CarState, steps: number, track: Track, extra: Partial<CarInput> = {}, boostEnabled = true) {
  const drive = lineKeeping(track, extra);
  let s = state;
  let info = stepCar(s, NEUTRAL_INPUT, CHASSIS.volt, track, { dt: DT, locked: true }).info;
  for (let i = 0; i < steps; i++) {
    const r = stepCar(s, drive(s), CHASSIS.volt, track, { dt: DT, boostEnabled });
    s = r.state;
    info = r.info;
  }
  return { state: s, info };
}

function scriptedInputs(seed: string, n: number): CarInput[] {
  const rng = createSeededRng(seed);
  const out: CarInput[] = [];
  let cur: CarInput = { ...GAS };
  for (let i = 0; i < n; i++) {
    if (i % 20 === 0) {
      cur = quantizeInput({
        throttle: rng.next() < 0.8 ? 1 : rng.next(),
        brake: rng.next() < 0.1 ? 1 : 0,
        steer: rng.next() * 2 - 1,
        drift: rng.next() < 0.25,
        boost: rng.next() < 0.2,
      });
    }
    out.push(cur);
  }
  return out;
}

describe('input packing', () => {
  it('round-trips quantized inputs and clamps every packed value into range', () => {
    const input: CarInput = { throttle: 1, brake: 0.4, steer: -0.5, drift: true, boost: false };
    const back = unpackInput(packInput(input));
    expect(back.throttle).toBe(1);
    expect(back.brake).toBeCloseTo(0.4, 1);
    expect(back.steer).toBeCloseTo(-0.5, 1);
    expect(back.drift).toBe(true);
    expect(back.boost).toBe(false);
    expect(packInput(unpackInput(packInput(input)))).toBe(packInput(input));
    for (const packed of [0, 1, 255, 0x7f00, INPUT_MAX, 12345]) {
      const u = unpackInput(packed);
      expect(u.throttle).toBeGreaterThanOrEqual(0);
      expect(u.throttle).toBeLessThanOrEqual(1);
      expect(u.brake).toBeGreaterThanOrEqual(0);
      expect(u.brake).toBeLessThanOrEqual(1);
      expect(u.steer).toBeGreaterThanOrEqual(-1);
      expect(u.steer).toBeLessThanOrEqual(1);
    }
    expect(packInput({ throttle: 7, brake: -3, steer: 9, drift: false, boost: true })).toBeLessThanOrEqual(INPUT_MAX);
  });
});

describe('stepCar', () => {
  const track = getTrack('neon-loop');

  it('is deterministic: identical inputs produce identical states', () => {
    const inputs = scriptedInputs('determinism', 900);
    for (const chassis of CHASSIS_IDS) {
      const a = run(placeCar(track, 200), (i) => inputs[i]!, 900, track, CHASSIS[chassis]);
      const b = run(placeCar(track, 200), (i) => inputs[i]!, 900, track, CHASSIS[chassis]);
      expect(a.state).toEqual(b.state);
    }
    const volt = run(placeCar(track, 200), (i) => inputs[i]!, 900, track, CHASSIS.volt);
    const comet = run(placeCar(track, 200), (i) => inputs[i]!, 900, track, CHASSIS.comet);
    expect(volt.state).not.toEqual(comet.state);
  });

  it('quantizes state to its wire representation', () => {
    const inputs = scriptedInputs('quantize', 300);
    let s = placeCar(track, 400);
    for (let i = 0; i < 300; i++) {
      s = stepCar(s, inputs[i]!, CHASSIS.volt, track, { dt: DT, boostEnabled: true }).state;
      for (const v of [s.x, s.y, s.heading, s.vx, s.vy, s.angVel]) expect(Math.fround(v)).toBe(v);
      expect(Math.round(s.boost * BOOST_Q) / BOOST_Q).toBe(s.boost);
      expect(Number.isInteger(s.drift)).toBe(true);
    }
  });

  it('accelerates toward top speed, brakes, then reverses', () => {
    const back = track.length - 700;
    const fast = runKeeping(placeCar(track, back), 210, track);
    expect(fast.info.speed).toBeGreaterThan(CHASSIS.volt.maxSpeed * 0.9);
    expect(fast.info.speed).toBeLessThanOrEqual(CHASSIS.volt.maxSpeed * 1.001);
    expect(fast.info.forwardSpeed).toBeGreaterThan(0);
    const oneSecond = runKeeping(placeCar(track, back), 60, track);
    expect(oneSecond.info.speed).toBeGreaterThan(250);
    expect(oneSecond.info.speed).toBeLessThan(fast.info.speed);

    const braking = run(fast.state, { ...NEUTRAL_INPUT, brake: 1 }, 45, track);
    expect(braking.info.speed).toBeLessThan(80);
    const reversing = run(braking.state, { ...NEUTRAL_INPUT, brake: 1 }, 120, track);
    expect(reversing.info.forwardSpeed).toBeLessThan(-120);
    expect(reversing.info.forwardSpeed).toBeGreaterThanOrEqual(-CHASSIS.volt.reverseMax - 1);
  });

  it('coasts to a stop without input', () => {
    const fast = run(placeCar(track, 100), GAS, 180, track);
    const coast = run(fast.state, NEUTRAL_INPUT, 60 * 5, track);
    expect(coast.info.speed).toBeLessThan(1);
  });

  it('never moves while locked on the grid', () => {
    const start = placeCar(track, 100);
    let s = start;
    for (let i = 0; i < 120; i++) s = stepCar(s, { ...GAS, boost: true, steer: 1 }, CHASSIS.volt, track, { dt: DT, locked: true, boostEnabled: true }).state;
    expect(s.x).toBe(start.x);
    expect(s.y).toBe(start.y);
    expect(s.heading).toBe(start.heading);
    expect(s.boost).toBe(start.boost);
  });

  it('slows down off track: lower top speed and speed bleed on the run-off', () => {
    const road = runKeeping(placeCar(track, track.length - 700, 0), 60 * 3, track);
    const offOffset = track.halfWidth + track.runoff / 2 - 4;
    const off = run(placeCar(track, 300, offOffset), GAS, 60 * 3, track);
    expect(off.info.surface).toBe(Surface.Offroad);
    expect(off.info.speed).toBeLessThan(CHASSIS.volt.maxSpeed * 0.6);
    expect(road.info.speed).toBeGreaterThan(off.info.speed * 1.5);

    // Enter the run-off at full speed: speed bleeds toward the run-off top speed.
    const fast = run(placeCar(track, 300, offOffset), GAS, 1, track).state;
    const entering: CarState = { ...fast, vx: Math.fround(Math.cos(fast.heading) * 600), vy: Math.fround(Math.sin(fast.heading) * 600) };
    const bled = run(entering, GAS, 45, track);
    expect(bled.info.speed).toBeLessThan(470);
  });

  it('rumble strips are detected at the road edge', () => {
    const r = run(placeCar(track, 300, track.halfWidth - track.rumble / 2), { ...NEUTRAL_INPUT }, 1, track);
    expect(r.info.surface).toBe(Surface.Rumble);
  });

  it('barriers keep the car inside the corridor and report the impact', () => {
    // Aim straight at the outside barrier on the main straight.
    const p = pointAt(track, 400);
    let s = createCar(p.x, p.y, Math.atan2(p.ty, p.tx) + Math.PI / 2, track, 0);
    let impact = 0;
    for (let i = 0; i < 240; i++) {
      const r = stepCar(s, GAS, CHASSIS.volt, track, { dt: DT });
      s = r.state;
      impact = Math.max(impact, r.info.wallImpact);
      const proj = projectOnTrack(track, s.x, s.y, s.seg);
      expect(Math.abs(proj.d)).toBeLessThanOrEqual(track.wall);
    }
    expect(impact).toBeGreaterThan(50);
  });

  it('holding drift slides the tail out, turns tighter, keeps speed and charges boost — without spinning', () => {
    // A wide-open skid pad so barriers never interfere.
    const pad = buildTrack({ ...TRACK_DEFS['neon-loop'], halfWidth: 3000, runoff: 100, points: [[0, 0], [20000, 0], [20000, 20000], [0, 20000]] });
    const p = pointAt(pad, 5000);
    const h = Math.atan2(p.ty, p.tx);
    const start: CarState = { ...createCar(p.x, p.y, h, pad, 0.2), vx: Math.fround(Math.cos(h) * 560), vy: Math.fround(Math.sin(h) * 560) };
    const corner = (drift: boolean, steer = 1) => {
      let st = start;
      let turned = 0;
      let maxSlip = 0;
      let prev = Math.atan2(st.vy, st.vx);
      let info = stepCar(st, NEUTRAL_INPUT, CHASSIS.volt, pad, { dt: DT, locked: true }).info;
      for (let i = 0; i < 90; i++) {
        const r = stepCar(st, { ...GAS, steer, drift }, CHASSIS.volt, pad, { dt: DT, boostEnabled: true });
        st = r.state;
        info = r.info;
        const va = Math.atan2(st.vy, st.vx);
        turned += wrapAngle(va - prev);
        prev = va;
        maxSlip = Math.max(maxSlip, Math.abs(r.info.slip));
      }
      return { st, info, turned, maxSlip };
    };
    const grip = corner(false);
    const slide = corner(true);
    expect(slide.maxSlip).toBeGreaterThan(grip.maxSlip + 0.3);
    expect(slide.maxSlip).toBeLessThanOrEqual(0.75);
    expect(slide.info.drifting).toBe(true);
    expect(slide.turned).toBeGreaterThan(grip.turned * 1.08);
    expect(slide.info.speed).toBeGreaterThan(start.vx !== 0 ? 520 : 0);
    expect(slide.st.boost).toBeGreaterThan(grip.st.boost + 0.2);
    // Counter-steer flicks the tail the other way instead of spinning.
    const flick = corner(true, -1);
    expect(Math.sign(flick.turned)).toBe(-Math.sign(slide.turned));
    // Releasing drift grips the car back up: slip decays quickly.
    let st = slide.st;
    let info = slide.info;
    for (let i = 0; i < 30; i++) {
      const r = stepCar(st, { ...GAS, steer: 0 }, CHASSIS.volt, pad, { dt: DT, boostEnabled: true });
      st = r.state;
      info = r.info;
    }
    expect(Math.abs(info.slip)).toBeLessThan(0.05);
  });

  it('boost raises top speed and drains the meter; disabled boost does nothing', () => {
    const cruising = runKeeping(placeCar(track, track.length - 700, 0, 1), 150, track);
    const boosted = runKeeping(cruising.state, 60, track, { boost: true });
    expect(boosted.info.speed).toBeGreaterThan(cruising.info.speed + 60);
    expect(boosted.state.boost).toBeLessThan(cruising.state.boost - 0.3);
    expect(boosted.info.boosting).toBe(true);

    const disabled = runKeeping(cruising.state, 60, track, { boost: true }, false);
    expect(disabled.info.boosting).toBe(false);
    expect(disabled.info.speed).toBeLessThan(CHASSIS.volt.maxSpeed * 1.001);

    // An empty meter can't start a boost.
    const empty = run({ ...cruising.state, boost: 0.01 }, { ...GAS, boost: true }, 5, track);
    expect(empty.info.boosting).toBe(false);
  });

  it('steering turns the car in the requested direction', () => {
    const moving = run(placeCar(track, 200), GAS, 90, track).state;
    const left = run(moving, { ...GAS, steer: -1 }, 20, track).state;
    const right = run(moving, { ...GAS, steer: 1 }, 20, track).state;
    expect(left.heading).toBeLessThan(moving.heading);
    expect(right.heading).toBeGreaterThan(moving.heading);
  });
});
