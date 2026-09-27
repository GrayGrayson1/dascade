/**
 * Client-side test autopilot: a simple pure-pursuit driver that follows the track's racing line
 * through the normal input path (sampled → quantized → predicted → sent), exactly like a player.
 * Used by E2E (`kartTest` opt-in only) to finish races in production builds, where server test
 * hooks are disabled. It never touches game state directly and has no advantage over a player.
 */
import type { KartInput } from '@dascade/shared/games/kart';

export interface LineLike {
  xs: ArrayLike<number>;
  ys: ArrayLike<number>;
}

export interface PilotState {
  x: number;
  y: number;
  heading: number;
  /** Forward speed (u/s). */
  speed: number;
}

export class TestAutopilot {
  private hint = -1;
  private frame = 0;
  /** Frames spent nearly stopped, and frames left of a reverse-out manoeuvre. */
  private slow = 0;
  private backing = 0;

  constructor(
    private readonly line: LineLike,
    private readonly lookahead = 9,
    /** Item cubes to aim for when one is close ahead (so tests exercise the item flow). */
    private readonly cubes: ReadonlyArray<{ x: number; y: number }> = [],
  ) {}

  /** A cube 6–32 u ahead within ~30° of the nose, if any. */
  private cubeAhead(s: PilotState): { x: number; y: number } | null {
    const c = Math.cos(s.heading);
    const n = Math.sin(s.heading);
    let best: { x: number; y: number } | null = null;
    let bestF = Infinity;
    for (const b of this.cubes) {
      const dx = b.x - s.x;
      const dy = b.y - s.y;
      const f = dx * c + dy * n;
      const l = -dx * n + dy * c;
      if (f < 6 || f > 32 || Math.abs(l) > f * 0.55) continue;
      if (f < bestF) {
        bestF = f;
        best = b;
      }
    }
    return best;
  }

  private nearest(x: number, y: number): number {
    const n = this.line.xs.length;
    const { xs, ys } = this.line;
    let best = 0;
    let bestD = Infinity;
    // Local search around the last hint (fast, and never snaps to a crossing section of track).
    const span = this.hint < 0 ? n : 40;
    const start = this.hint < 0 ? 0 : this.hint - 10;
    for (let k = 0; k < span; k++) {
      const i = (((start + k) % n) + n) % n;
      const dx = xs[i]! - x;
      const dy = ys[i]! - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.hint = best;
    return best;
  }

  reset(): void {
    this.hint = -1;
  }

  drive(s: PilotState): KartInput {
    const n = this.line.xs.length;
    if (!n) return { throttle: 1, brake: 0, steer: 0, drift: false, item: false, back: false, ahead: false };
    const i = this.nearest(s.x, s.y);
    const ahead = Math.round(this.lookahead + Math.max(0, s.speed) * 0.12);
    const j = (i + ahead) % n;
    const cube = this.cubeAhead(s);
    const tx = (cube ? cube.x : this.line.xs[j]!) - s.x;
    const ty = (cube ? cube.y : this.line.ys[j]!) - s.y;
    let diff = Math.atan2(ty, tx) - s.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    // Positive = target to the left = steer left (positive in the contract).
    const steer = Math.max(-1, Math.min(1, diff * 2.4));
    // Pinned against a wall: back out with the wheel turned the other way, then carry on.
    this.slow = Math.abs(s.speed) < 2.5 ? this.slow + 1 : 0;
    if (this.slow > 50 && !this.backing) this.backing = 45;
    if (this.backing > 0) {
      this.backing--;
      this.slow = 0;
      return { throttle: 0, brake: 1, steer: -Math.sign(steer || 1), drift: false, item: false, back: false, ahead: false };
    }
    const sharp = Math.abs(diff) > 0.9 && s.speed > 12;
    // Tap the item button now and then (press = use; trailed items fire on release).
    this.frame++;
    const item = this.frame % 90 < 8;
    return { throttle: sharp ? 0.4 : 1, brake: sharp ? 0.3 : 0, steer, drift: false, item, back: false, ahead: false };
  }
}
