/**
 * A simple autopilot for Asteroid Run (tests, load scripts and demos): it leads the nearest
 * rock, fires when lined up, closes in on far targets and backs off when something gets
 * close. It produces the same control frames a player sends.
 */
import { packControls } from '@dascade/shared/games/asteroids';
import { dirIndexOf, mod } from '../classics/shared/index.ts';
import { SHIP, WORLD, delta } from './ship.ts';
import { ROCK, type World } from './world.ts';

export function botFrame(w: World, slot: number): number {
  const s = w.ships[slot];
  if (!s || !s.alive) return 0;
  let best: { dx: number; dy: number; d2: number; r: number; vx: number; vy: number } | null = null;
  for (const r of w.rocks) {
    const dx = delta(s.x, r.x, WORLD.width);
    const dy = delta(s.y, r.y, WORLD.height);
    const d2 = dx * dx + dy * dy;
    if (!best || d2 < best.d2) best = { dx, dy, d2, r: ROCK.radius[r.size]!, vx: r.vx - s.vx, vy: r.vy - s.vy };
  }
  if (!best) return 0;
  // Lead the target: where will it be when a bullet gets there?
  const dist = Math.sqrt(best.d2);
  const t = dist / SHIP.bulletSpeed;
  const aimDir = dirIndexOf(best.dx + best.vx * t, best.dy + best.vy * t);
  const off = Math.abs(mod(aimDir - s.h + 32, 64) - 32);
  const close = dist < best.r + 120;
  const far = dist > 520;
  const flee = close && off > 20;
  return packControls({
    left: false,
    right: false,
    thrust: flee || (far && off <= 4),
    fire: off <= 2 && !far,
    aim: true,
    aimDir: flee ? mod(aimDir + 32, 64) : aimDir,
  });
}
