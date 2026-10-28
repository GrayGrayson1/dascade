/**
 * Fireworks over the awards' last winner (Awards A). Client-only canvas decoration: not a shared
 * simulation, so trig is fine here. Off with effects off; one still frame of bursts with reduced
 * motion. Bursts for a few seconds, then it stops (a Teams share spends its bandwidth on the people).
 * No sound of its own: the ceremony's applause cue plays on the sound station.
 *
 * It animates on the frames of the window it's drawn in (the stage window), so a console window
 * that's covered or in the background never stalls it.
 */
import { useEffect, useRef } from 'react';
import type { MotionPrefs } from './state.ts';

const COLOURS = ['#ffd36b', '#ff9a3c', '#b26bff', '#7df04a', '#fff3e0', '#ff6b81', '#4ad6ff'];
/** How long it bursts (ms), and the gap between bursts. */
const RUN_MS = 7000;
const GAP_MS = 520;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  colour: string;
}

function burst(sparks: Spark[], w: number, h: number, n: number, rand: () => number): void {
  const x = w * (0.15 + rand() * 0.7);
  const y = h * (0.12 + rand() * 0.32);
  const colour = COLOURS[Math.floor(rand() * COLOURS.length)]!;
  const speed = h * (0.006 + rand() * 0.004);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const s = speed * (0.55 + rand() * 0.6);
    sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, colour: rand() < 0.2 ? '#fff3e0' : colour });
  }
}

export function Fireworks({ motion }: { motion: MotionPrefs }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const still = !motion.motion;
  const off = motion.fx === 'off';
  const sparksPerBurst = Math.max(24, Math.min(70, Math.round(motion.particles * 1.1)));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || off) return;
    const win = canvas.ownerDocument.defaultView ?? window;
    const g = canvas.getContext('2d');
    if (!g) return;
    const fit = () => {
      const dpr = Math.min(2, win.devicePixelRatio || 1);
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (w && h && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
      }
      return { w: canvas.width, h: canvas.height };
    };
    const rand = Math.random;
    if (still) {
      // One quiet frame: three bursts, already open.
      const { w, h } = fit();
      const sparks: Spark[] = [];
      for (let b = 0; b < 3; b++) burst(sparks, w, h, sparksPerBurst, rand);
      g.clearRect(0, 0, w, h);
      for (const s of sparks) {
        g.fillStyle = s.colour;
        g.beginPath();
        g.arc(s.x + s.vx * 24, s.y + s.vy * 24, Math.max(1.5, h * 0.003), 0, Math.PI * 2);
        g.fill();
      }
      return;
    }
    let sparks: Spark[] = [];
    let raf = 0;
    const start = win.performance.now();
    let nextBurst = start;
    const frame = (now: number) => {
      const { w, h } = fit();
      if (now - start < RUN_MS && now >= nextBurst) {
        burst(sparks, w, h, sparksPerBurst, rand);
        nextBurst = now + GAP_MS + rand() * GAP_MS;
      }
      g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';
      const width = Math.max(2, h * 0.006);
      for (const s of sparks) {
        const px = s.x;
        const py = s.y;
        s.vx *= 0.976;
        s.vy = s.vy * 0.976 + h * 0.00011;
        s.x += s.vx * 2.2;
        s.y += s.vy * 2.2;
        s.life -= 0.011;
        const a = Math.max(0, s.life);
        // A soft, wide trail, then a bright core and a head: reads as light, not confetti.
        g.strokeStyle = s.colour;
        g.globalAlpha = a * 0.35;
        g.lineWidth = width * 2.4;
        g.beginPath();
        g.moveTo(px - s.vx * 5, py - s.vy * 5);
        g.lineTo(s.x, s.y);
        g.stroke();
        g.globalAlpha = a;
        g.lineWidth = width;
        g.beginPath();
        g.moveTo(px - s.vx * 3, py - s.vy * 3);
        g.lineTo(s.x, s.y);
        g.stroke();
        g.fillStyle = '#fff8ec';
        g.beginPath();
        g.arc(s.x, s.y, width * 0.6, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      sparks = sparks.filter((s) => s.life > 0);
      if (sparks.length || now - start < RUN_MS) raf = win.requestAnimationFrame(frame);
      else g.clearRect(0, 0, w, h);
    };
    raf = win.requestAnimationFrame(frame);
    return () => win.cancelAnimationFrame(raf);
  }, [still, off, sparksPerBurst]);

  if (off) return null;
  return <canvas ref={ref} className="sd-fireworks" aria-hidden data-part="showdown-fireworks" data-still={still ? 'true' : undefined} />;
}
