/**
 * The Neon 7s reels (Canvas 2D). Reels may start turning on click, but they can
 * only land once the server's stops arrive: `land(stops)` plans each reel's
 * deceleration so it stops exactly on the server-chosen stop. Nothing here
 * decides or predicts an outcome.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { SLOT_REELS, SLOT_STRIP_LENGTH, type SlotStops } from '@dascade/game-core/dasino';
import { SLOT_SPRITES, spriteCanvas } from './sprites.ts';

const STRIP = SLOT_STRIP_LENGTH;
/** Cruise speed in symbols per ms. */
const V = 0.042;
const ACCEL_MS = 170;
const BRAKE_MS = 300;
const BACK = 1.25;
/** Initial slope of easeOutBack(c1 = BACK) is 3(c1+1) − 2c1. */
const BRAKE_DIST = (V * BRAKE_MS) / (3 * (BACK + 1) - 2 * BACK);

export interface SlotReelsHandle {
  /** Start spinning (outcome unknown yet). */
  start(): void;
  /** Land on the server's stops. Calls onReelStop(r) per reel and onDone when all stopped. */
  land(stops: SlotStops, onReelStop: (reel: number) => void, onDone: () => void): void;
  /** Jump straight to stops (reduced motion / reconnect). */
  snap(stops: SlotStops): void;
  /** Stop spinning where the reels were (e.g. the server rejected the spin). */
  abort(): void;
  isSpinning(): boolean;
}

interface Plan {
  tR: number;
  pR: number[];
  pT: number[];
  brakeAt: number[];
  vc: number[];
  stopped: boolean[];
  onReelStop: (reel: number) => void;
  onDone: () => void;
}

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

function easeOutBack(u: number) {
  const c3 = BACK + 1;
  return 1 + c3 * (u - 1) ** 3 + BACK * (u - 1) ** 2;
}

export const SlotReels = forwardRef<SlotReelsHandle, { initial: SlotStops; label: string }>(function SlotReels({ initial, label }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sim = useRef({
    mode: 'idle' as 'idle' | 'spinning',
    pos: [...initial] as number[],
    from: [...initial] as number[],
    t0: 0,
    plan: null as Plan | null,
  });

  const reelPos = (r: number, t: number): number => {
    const s = sim.current;
    if (s.mode === 'idle') return s.pos[r]!;
    const plan = s.plan;
    if (!plan || t < plan.tR) {
      const tau = t - s.t0;
      const dist = tau < ACCEL_MS ? (V * tau * tau) / (2 * ACCEL_MS) : V * (tau - ACCEL_MS / 2);
      return s.from[r]! - dist;
    }
    if (t < plan.brakeAt[r]!) return plan.pR[r]! - plan.vc[r]! * (t - plan.tR);
    const u = Math.min(1, (t - plan.brakeAt[r]!) / BRAKE_MS);
    return plan.pT[r]! + BRAKE_DIST - BRAKE_DIST * easeOutBack(u);
  };

  useImperativeHandle(ref, () => ({
    start() {
      const s = sim.current;
      if (s.mode === 'spinning') return;
      s.mode = 'spinning';
      s.t0 = performance.now();
      s.from = s.pos.map((p) => mod(p, STRIP));
      s.plan = null;
    },
    land(stops, onReelStop, onDone) {
      const s = sim.current;
      const now = performance.now();
      if (s.mode !== 'spinning') {
        s.mode = 'spinning';
        s.t0 = now;
        s.from = s.pos.map((p) => mod(p, STRIP));
        s.plan = null;
      }
      const pR = [0, 1, 2].map((r) => reelPos(r, now));
      const brakeAt = [0, 1, 2].map((r) => Math.max(now + 520, s.t0 + 950) + r * 330);
      const pT: number[] = [];
      const vc: number[] = [];
      for (let r = 0; r < 3; r++) {
        const cruise = brakeAt[r]! - now;
        const ideal = pR[r]! - V * cruise - BRAKE_DIST;
        // Nearest position showing the server's stop on the middle row.
        let target = ideal - mod(ideal - stops[r]!, STRIP);
        if (ideal - target > STRIP / 2) target += STRIP;
        let speed = (pR[r]! - (target + BRAKE_DIST)) / cruise;
        while (speed < V * 0.45) {
          target -= STRIP;
          speed = (pR[r]! - (target + BRAKE_DIST)) / cruise;
        }
        pT.push(target);
        vc.push(speed);
      }
      s.plan = { tR: now, pR, pT, brakeAt, vc, stopped: [false, false, false], onReelStop, onDone };
    },
    snap(stops) {
      const s = sim.current;
      s.mode = 'idle';
      s.plan = null;
      s.pos = [...stops];
    },
    abort() {
      const s = sim.current;
      const now = performance.now();
      s.pos = [0, 1, 2].map((r) => Math.round(reelPos(r, now)));
      s.mode = 'idle';
      s.plan = null;
    },
    isSpinning() {
      return sim.current.mode === 'spinning';
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    let cell = 0;
    let dpr = 1;
    const lastPos = [0, 0, 0];
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(30, Math.round(rect.width * dpr));
      canvas.height = Math.max(30, Math.round(rect.height * dpr));
      cell = canvas.height / 3;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const s = sim.current;
      const W = canvas.width;
      const H = canvas.height;
      const gap = Math.round(6 * dpr);
      const reelW = (W - gap * 2) / 3;
      const scale = Math.max(1, Math.floor((Math.min(reelW, cell) * 0.7) / 16));
      const spriteSize = 16 * scale;
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = false;
      for (let r = 0; r < 3; r++) {
        const x0 = r * (reelW + gap);
        let p = reelPos(r, t);
        const plan = s.plan;
        if (plan && !plan.stopped[r] && t >= plan.brakeAt[r]! + BRAKE_MS) {
          plan.stopped[r] = true;
          p = plan.pT[r]!;
          plan.onReelStop(r);
          if (plan.stopped.every(Boolean)) {
            s.pos = plan.pT.map((v) => mod(Math.round(v), STRIP));
            s.mode = 'idle';
            s.plan = null;
            plan.onDone();
          }
        }
        const speed = Math.abs(p - lastPos[r]!);
        lastPos[r] = p;
        // Reel body.
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#07040f');
        g.addColorStop(0.3, '#1c1036');
        g.addColorStop(0.5, '#27164a');
        g.addColorStop(0.7, '#1c1036');
        g.addColorStop(1, '#07040f');
        ctx.fillStyle = g;
        ctx.fillRect(x0, 0, reelW, H);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, 0, reelW, H);
        ctx.clip();
        const strip = SLOT_REELS[r]!;
        const base = Math.floor(p);
        const frac = p - base;
        const blur = speed > 0.12;
        for (let k = -2; k <= 2; k++) {
          const idx = mod(base + k, STRIP);
          const sym = strip[idx]!;
          const cy = H / 2 + (k - frac) * cell;
          const sprite = spriteCanvas(SLOT_SPRITES[sym], scale, sym);
          const sx = Math.round(x0 + (reelW - spriteSize) / 2);
          const sy = Math.round(cy - spriteSize / 2);
          if (blur) {
            const trail = Math.min(cell * 0.45, speed * cell * 0.9);
            ctx.globalAlpha = 0.22;
            ctx.drawImage(sprite, sx, sy - trail);
            ctx.drawImage(sprite, sx, sy + trail);
            ctx.globalAlpha = 0.6;
          } else ctx.globalAlpha = 1;
          ctx.drawImage(sprite, sx, sy);
          ctx.globalAlpha = 1;
        }
        ctx.restore();
      }
      // Row separators (subtle).
      ctx.fillStyle = 'rgba(192,132,252,0.10)';
      ctx.fillRect(0, Math.round(cell) - 1, W, 2);
      ctx.fillRect(0, Math.round(cell * 2) - 1, W, 2);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="dn-reels__canvas" role="img" aria-label={label} />;
});
