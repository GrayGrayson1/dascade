import { describe, expect, it } from 'vitest';
import { advanceProgress, createProgress, MAX_STEP_DISTANCE, rankDistance, WRONG_WAY_ON_MS, type ProgressEvent, type RaceProgress } from './race.ts';
import { getTrack } from './tracks.ts';
import { mod } from './math.ts';

const track = getTrack('neon-loop');
const L = track.length;
const STEP = 10; // px per sample, well under MAX_STEP_DISTANCE

/** Drive progress from `from` to `to` (unwrapped arc lengths) in small forward/backward steps. */
function drive(p: RaceProgress, from: number, to: number, clock: { t: number }, laps = 3, dir = { headingDot: 1, velDot: 400 }): ProgressEvent[] {
  const events: ProgressEvent[] = [];
  const n = Math.ceil(Math.abs(to - from) / STEP);
  for (let i = 1; i <= n; i++) {
    const s = mod(from + ((to - from) * i) / n, L);
    const t0 = clock.t;
    clock.t += 16;
    events.push(...advanceProgress(p, { s, headingDot: dir.headingDot, velDot: dir.velDot, speed: 400, t0, t1: clock.t }, track, laps));
  }
  return events;
}

const gridS = () => L - 150;

describe('race progress', () => {
  it('starts lap 1 on the first line crossing and completes a lap only after every gate in order', () => {
    const p = createProgress(gridS());
    const clock = { t: 0 };
    const start = drive(p, gridS(), L + 50, clock);
    expect(start).toContainEqual({ type: 'lap-start', lap: 1, atMs: 0 });
    expect(p.lap).toBe(1);
    expect(p.nextGate).toBe(1);

    const lap = drive(p, 50, L + 50, clock);
    const gates = lap.filter((e) => e.type === 'gate').map((e) => (e as { gate: number }).gate);
    expect(gates).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const done = lap.find((e) => e.type === 'lap');
    expect(done).toMatchObject({ type: 'lap', lap: 1, best: true });
    expect(p.lap).toBe(2);
    expect(p.lapTimes.length).toBe(1);
    expect(p.bestLapMs).toBe(p.lapTimes[0]);
    // Lap 1 is timed from the green light, so it includes the run-up from the grid.
    expect(p.lapTimes[0]).toBeGreaterThan(Math.round((L / STEP) * 16) - 40);
  });

  it('a shortcut (teleport past gates) never counts, even after reaching the line', () => {
    const p = createProgress(gridS());
    const clock = { t: 0 };
    drive(p, gridS(), L + 50, clock);
    drive(p, 50, track.gates[2]! + 30, clock); // legitimately pass gates 1 and 2
    expect(p.nextGate).toBe(3);
    // Jump across the infield to just before gate 6.
    const jumpTo = track.gates[6]! - 40;
    expect(jumpTo - (track.gates[2]! + 30)).toBeGreaterThan(MAX_STEP_DISTANCE);
    const jumpEvents = advanceProgress(p, { s: jumpTo, headingDot: 1, velDot: 400, speed: 400, t0: clock.t, t1: clock.t + 16 }, track, 3);
    expect(jumpEvents.filter((e) => e.type === 'gate')).toEqual([]);
    expect(p.nextGate).toBe(3);
    const rest = drive(p, jumpTo, L + 40, clock);
    expect(rest.filter((e) => e.type === 'gate' || e.type === 'lap')).toEqual([]);
    expect(p.lap).toBe(1);
    // Ranking is capped at the next unpassed gate.
    expect(rankDistance(p, track)).toBeLessThanOrEqual(track.gates[3]!);
  });

  it('skipping a single gate blocks the lap until the car goes back through it', () => {
    const p = createProgress(gridS());
    const clock = { t: 0 };
    drive(p, gridS(), L + 20, clock);
    p.nextGate = 2; // pretend gate 1 was passed
    drive(p, 20, track.gates[3]! + 10, clock);
    // Now pretend the car skipped gate 4 by teleporting past it.
    advanceProgress(p, { s: track.gates[4]! + 100, headingDot: 1, velDot: 400, speed: 400, t0: clock.t, t1: clock.t + 16 }, track, 3);
    expect(p.nextGate).toBe(4);
    const noLap = drive(p, track.gates[4]! + 100, L + 20, clock);
    expect(noLap.some((e) => e.type === 'lap')).toBe(false);
  });

  it('rocking back and forth over the line cannot farm laps', () => {
    const p = createProgress(gridS());
    const clock = { t: 0 };
    drive(p, gridS(), L + 30, clock);
    expect(p.lap).toBe(1);
    drive(p, 30, -30, clock, 3, { headingDot: -1, velDot: -200 });
    expect(p.lap).toBe(0);
    drive(p, -30, 30, clock);
    expect(p.lap).toBe(1);

    // Complete lap 1, then back over the line: the completed lap is undone.
    drive(p, 30, L + 30, clock);
    expect(p.lap).toBe(2);
    expect(p.lapTimes.length).toBe(1);
    const undo = drive(p, 30, -30, clock, 3, { headingDot: -1, velDot: -200 });
    expect(undo).toContainEqual({ type: 'lap-undo', lap: 1 });
    expect(p.lap).toBe(1);
    expect(p.lapTimes.length).toBe(0);
    expect(p.bestLapMs).toBe(0);
    drive(p, -30, 30, clock);
    expect(p.lap).toBe(2);
    expect(p.lapTimes.length).toBe(1);
  });

  it('finishes after the final lap and records the finish time', () => {
    const p = createProgress(gridS());
    const clock = { t: 0 };
    drive(p, gridS(), L + 20, clock, 2);
    drive(p, 20, L + 20, clock, 2);
    const last = drive(p, 20, L + 20, clock, 2);
    const fin = last.find((e) => e.type === 'finish');
    expect(fin).toBeDefined();
    expect(p.finished).toBe(true);
    expect(p.lap).toBe(3);
    expect(p.finishMs).toBeGreaterThan(0);
    expect(p.lapTimes.length).toBe(2);
    expect(p.bestLapMs).toBe(Math.min(...p.lapTimes));
    // Nothing changes after the finish.
    expect(drive(p, 20, 800, clock, 2)).toEqual([]);
  });

  it('flags wrong-way driving after a second and clears it when back on course', () => {
    const p = createProgress(gridS());
    const clock = { t: 0 };
    drive(p, gridS(), L + 1200, clock);
    const back = drive(p, 1200, 1200 - 80 * STEP, clock, 3, { headingDot: -0.9, velDot: -300 });
    const onAt = back.findIndex((e) => e.type === 'wrong-way' && e.on);
    expect(onAt).toBeGreaterThan(-1);
    expect(p.wrongWay).toBe(true);
    expect(p.wrongWayMs).toBeGreaterThanOrEqual(WRONG_WAY_ON_MS);
    const fwd = drive(p, 1200 - 80 * STEP, 1300, clock);
    expect(fwd).toContainEqual({ type: 'wrong-way', on: false });
    expect(p.wrongWay).toBe(false);
  });

  it('ranks by validated distance', () => {
    const a = createProgress(gridS());
    const b = createProgress(gridS() - 200);
    expect(rankDistance(a, track)).toBeGreaterThan(rankDistance(b, track));
    const clock = { t: 0 };
    drive(a, gridS(), L + 500, clock);
    drive(b, gridS() - 200, L + 300, clock);
    expect(rankDistance(a, track)).toBeGreaterThan(rankDistance(b, track));
    expect(rankDistance(a, track)).toBeGreaterThan(0);
  });
});
