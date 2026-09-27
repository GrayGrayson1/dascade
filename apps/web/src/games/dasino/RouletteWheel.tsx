/**
 * The shared roulette wheel (Canvas 2D). The wheel head and bowl are pre-rendered
 * once per size; each frame only rotates the head, moves the ball and chases the
 * rim lights. Ball motion comes from wheelMath (server data only), so every
 * client shows the same spin and the ball lands on the server's number.
 */
import { useEffect, useRef } from 'react';
import { WHEEL_ORDER, rouletteColor } from '@dascade/game-core/dasino';
import type { RouletteTableView } from '@dascade/shared/games/dasino';
import { serverNow } from '../../net/hooks.ts';
import { POCKET_DEG, ballState, pocketAngle, wheelAngle, type SpinInfo } from './wheelMath.ts';
import { play, useMotion } from './ui.ts';
import { readThemeTokens, subscribeThemeTokens } from '@dascade/ui';
import { paletteKey, wheelPalette, type WheelPalette } from './palette.ts';

const DEG = Math.PI / 180;
const POCKET_COLORS = { red: '#d4234c', black: '#16111f', green: '#0f9f68' } as const;
const POCKET_DEEP = { red: '#8e1232', black: '#0a0710', green: '#086a45' } as const;

type WheelData = Pick<RouletteTableView, 'phase' | 'result' | 'spinStartAt' | 'spinMs' | 'spinSeed'>;

interface Layers {
  px: number;
  glow: boolean;
  key: string;
  bowl: HTMLCanvasElement;
  head: HTMLCanvasElement;
}

function makeCanvas(px: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  return [c, c.getContext('2d')!];
}

function ring(ctx: CanvasRenderingContext2D, r: number, color: string, width: number) {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function wedge(ctx: CanvasRenderingContext2D, r0: number, r1: number, a0: number, a1: number) {
  ctx.beginPath();
  ctx.arc(0, 0, r1, a0, a1);
  ctx.arc(0, 0, r0, a1, a0, true);
  ctx.closePath();
}

function buildLayers(px: number, glow: boolean, pal: WheelPalette, key: string): Layers {
  const R = px / 2;
  // ---- Static bowl -------------------------------------------------------
  const [bowl, b] = makeCanvas(px);
  b.translate(R, R);
  const rim = b.createRadialGradient(0, 0, R * 0.7, 0, 0, R);
  rim.addColorStop(0, pal.rim[0]);
  rim.addColorStop(0.85, pal.rim[1]);
  rim.addColorStop(1, pal.rim[2]);
  b.fillStyle = rim;
  b.beginPath();
  b.arc(0, 0, R * 0.995, 0, Math.PI * 2);
  b.fill();
  // Ball track: glossy dark channel.
  const track = b.createRadialGradient(0, 0, R * 0.79, 0, 0, R * 0.93);
  track.addColorStop(0, pal.track[0]);
  track.addColorStop(0.55, pal.track[1]);
  track.addColorStop(1, pal.track[0]);
  b.fillStyle = track;
  b.beginPath();
  b.arc(0, 0, R * 0.93, 0, Math.PI * 2);
  b.arc(0, 0, R * 0.79, 0, Math.PI * 2, true);
  b.fill();
  // Apron between track and wheel head.
  b.fillStyle = pal.apron;
  b.beginPath();
  b.arc(0, 0, R * 0.79, 0, Math.PI * 2);
  b.fill();
  ring(b, R * 0.93, pal.goldRing, R * 0.012);
  ring(b, R * 0.79, pal.goldRingSoft, R * 0.006);
  // Neon ring.
  b.save();
  if (glow) {
    b.shadowColor = pal.neon;
    b.shadowBlur = R * 0.08;
  }
  ring(b, R * 0.965, pal.neon, R * 0.014);
  b.restore();
  ring(b, R * 0.992, pal.outerRing, R * 0.008);
  // Deflector diamonds on the apron.
  for (let i = 0; i < 8; i++) {
    b.save();
    b.rotate((i * 45 + 22.5) * DEG);
    b.translate(0, -R * 0.765);
    b.fillStyle = pal.goldBright;
    b.beginPath();
    b.moveTo(0, -R * 0.022);
    b.lineTo(R * 0.012, 0);
    b.lineTo(0, R * 0.022);
    b.lineTo(-R * 0.012, 0);
    b.closePath();
    b.fill();
    b.restore();
  }

  // ---- Rotating wheel head ----------------------------------------------
  const [head, h] = makeCanvas(px);
  h.translate(R, R);
  const rNumOut = R * 0.735;
  const rNumIn = R * 0.615;
  const rPocketIn = R * 0.5;
  WHEEL_ORDER.forEach((n, i) => {
    const color = rouletteColor(n);
    const a0 = (i * POCKET_DEG - POCKET_DEG / 2 - 90) * DEG;
    const a1 = a0 + POCKET_DEG * DEG;
    h.fillStyle = POCKET_COLORS[color];
    wedge(h, rNumIn, rNumOut, a0, a1);
    h.fill();
    const deep = h.createRadialGradient(0, 0, rPocketIn, 0, 0, rNumIn);
    deep.addColorStop(0, POCKET_DEEP[color]);
    deep.addColorStop(1, POCKET_COLORS[color]);
    h.fillStyle = deep;
    wedge(h, rPocketIn, rNumIn, a0, a1);
    h.fill();
  });
  // Frets.
  h.strokeStyle = pal.goldRing;
  h.lineWidth = Math.max(1, R * 0.007);
  for (let i = 0; i < WHEEL_ORDER.length; i++) {
    const a = (i * POCKET_DEG - POCKET_DEG / 2 - 90) * DEG;
    h.beginPath();
    h.moveTo(Math.cos(a) * rPocketIn, Math.sin(a) * rPocketIn);
    h.lineTo(Math.cos(a) * rNumOut, Math.sin(a) * rNumOut);
    h.stroke();
  }
  ring(h, rNumOut, pal.goldBright, R * 0.012);
  ring(h, rNumIn, pal.goldRing, R * 0.006);
  ring(h, rPocketIn, pal.goldBright, R * 0.01);
  // Numbers (pixel font), reading outward.
  const fontPx = Math.max(8, Math.round(R * 0.068));
  h.font = `700 ${fontPx}px Silkscreen, 'Tiny5', monospace`;
  h.textAlign = 'center';
  h.textBaseline = 'middle';
  h.fillStyle = '#fff8e6';
  WHEEL_ORDER.forEach((n, i) => {
    h.save();
    h.rotate(i * POCKET_DEG * DEG);
    h.fillText(String(n), 0, -(rNumIn + rNumOut) / 2);
    h.restore();
  });
  // Cone: faceted violet metal.
  const cone = h.createRadialGradient(-R * 0.1, -R * 0.12, R * 0.05, 0, 0, rPocketIn);
  cone.addColorStop(0, pal.cone[0]);
  cone.addColorStop(0.45, pal.cone[1]);
  cone.addColorStop(1, pal.cone[2]);
  h.fillStyle = cone;
  h.beginPath();
  h.arc(0, 0, rPocketIn - R * 0.005, 0, Math.PI * 2);
  h.fill();
  for (let i = 0; i < 12; i++) {
    h.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)';
    wedge(h, R * 0.12, rPocketIn - R * 0.01, (i * 30 - 90) * DEG, ((i + 1) * 30 - 90) * DEG);
    h.fill();
  }
  // Turret: four tapered gold spokes with ball finials + a domed cap.
  const gold = h.createLinearGradient(-R * 0.3, -R * 0.3, R * 0.3, R * 0.3);
  gold.addColorStop(0, pal.turret[0]);
  gold.addColorStop(0.5, pal.turret[1]);
  gold.addColorStop(1, pal.turret[2]);
  for (let i = 0; i < 4; i++) {
    h.save();
    h.rotate((i * 90 + 45) * DEG);
    h.fillStyle = 'rgba(0,0,0,0.35)';
    h.beginPath();
    h.moveTo(R * 0.012, -R * 0.07);
    h.lineTo(R * 0.052, -R * 0.15);
    h.lineTo(R * 0.012, -R * 0.26);
    h.lineTo(-R * 0.028, -R * 0.15);
    h.closePath();
    h.fill();
    h.fillStyle = gold;
    h.beginPath();
    h.moveTo(0, -R * 0.08);
    h.lineTo(R * 0.04, -R * 0.16);
    h.lineTo(0, -R * 0.27);
    h.lineTo(-R * 0.04, -R * 0.16);
    h.closePath();
    h.fill();
    h.beginPath();
    h.arc(0, -R * 0.29, R * 0.028, 0, Math.PI * 2);
    h.fill();
    h.restore();
  }
  const dome = h.createRadialGradient(-R * 0.03, -R * 0.04, R * 0.01, 0, 0, R * 0.1);
  dome.addColorStop(0, pal.dome[0]);
  dome.addColorStop(0.55, pal.dome[1]);
  dome.addColorStop(1, pal.dome[2]);
  h.fillStyle = dome;
  h.beginPath();
  h.arc(0, 0, R * 0.1, 0, Math.PI * 2);
  h.fill();
  h.fillStyle = pal.capInset;
  h.beginPath();
  h.arc(0, 0, R * 0.075, 0, Math.PI * 2);
  h.fill();
  // Pixel star on the cap.
  const star = ['..#..', '.###.', '#####', '.###.', '.#.#.'];
  const cell = Math.max(1, Math.round(R * 0.022));
  h.fillStyle = pal.goldBright;
  star.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '#') h.fillRect((x - 2.5) * cell, (y - 2.5) * cell, cell, cell);
    }),
  );
  return { px, glow, key, bowl, head };
}

export function RouletteWheel({ roulette, className, label }: { roulette: WheelData; className?: string; label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { reduced, fx } = useMotion();
  const live = useRef({ roulette, reduced, fx });
  live.current = { roulette, reduced, fx };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let layers: Layers | null = null;
    let raf = 0;
    let lastDraw = 0;
    let lastTick = Number.NaN;
    let lastSpinKey = '';
    let disposed = false;
    // Theme materials (live): re-read on theme change and rebuild the pre-rendered layers only.
    // The spin itself is driven by server data + serverNow(), so nothing about the game resets.
    let pal = wheelPalette(readThemeTokens(canvas).materials);
    let palKey = paletteKey(pal);
    const build = (px: number) => buildLayers(px, live.current.fx === 'high', pal, palKey);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const px = Math.max(64, Math.round(rect.width * dpr));
      if (canvas.width !== px || canvas.height !== px) {
        canvas.width = px;
        canvas.height = px;
      }
      if (!layers || layers.px !== px) layers = build(px);
    };
    const ensureGlow = () => {
      const glow = live.current.fx === 'high';
      if (layers && (layers.glow !== glow || layers.key !== palKey)) layers = build(layers.px);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    // Rebuild once the pixel font is ready so the numbers use it.
    void document.fonts?.load(`700 16px Silkscreen`).then(() => {
      if (!disposed && layers) layers = build(layers.px);
    });
    let themeRaf = 0;
    const offTheme = subscribeThemeTokens(() => {
      cancelAnimationFrame(themeRaf);
      // Next frame: the new theme's CSS is in place before we read it.
      themeRaf = requestAnimationFrame(() => {
        if (disposed) return;
        pal = wheelPalette(readThemeTokens(canvas).materials);
        palKey = paletteKey(pal);
      });
    });

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const { roulette: r, reduced: rm, fx: fxLevel } = live.current;
      const spinning = r.phase === 'SPINNING';
      if (!spinning && t - lastDraw < 32) return; // ~30fps when idle
      lastDraw = t;
      ensureGlow();
      if (!layers) return;
      const px = layers.px;
      const R = px / 2;
      const now = serverNow();
      const spin: SpinInfo = { startAt: r.spinStartAt, durationMs: r.spinMs, result: Math.max(0, r.result), seed: r.spinSeed };
      const head = rm ? 0 : wheelAngle(now);

      ctx.clearRect(0, 0, px, px);
      ctx.drawImage(layers.bowl, 0, 0);

      // Chasing rim lights.
      const bulbs = 36;
      const chase = rm || fxLevel === 'off' ? 0 : Math.floor(now / (spinning ? 70 : 380));
      for (let i = 0; i < bulbs; i++) {
        const a = (i * (360 / bulbs) - 90) * DEG;
        const lit = (i + chase) % 3 === 0;
        ctx.fillStyle = lit ? pal.bulbLit : i % 2 ? pal.bulbA : pal.bulbB;
        const s = Math.max(2, R * (lit ? 0.022 : 0.016));
        ctx.fillRect(R + Math.cos(a) * R * 0.965 - s / 2, R + Math.sin(a) * R * 0.965 - s / 2, s, s);
      }

      ctx.save();
      ctx.translate(R, R);
      ctx.rotate(head * DEG);
      ctx.drawImage(layers.head, -R, -R);
      // Winning pocket highlight.
      if (r.result >= 0 && (r.phase === 'RESULT' || (r.phase === 'BETTING' && !rm))) {
        const pulse = r.phase === 'RESULT' ? 0.55 + 0.45 * Math.sin(now / 160) : 0.35;
        const a = (pocketAngle(r.result) - 90) * DEG;
        ctx.save();
        ctx.globalAlpha = rm ? 0.9 : pulse;
        ctx.strokeStyle = '#fff1a8';
        ctx.lineWidth = R * 0.018;
        if (fxLevel === 'high') {
          ctx.shadowColor = '#ffd23f';
          ctx.shadowBlur = R * 0.06;
        }
        wedge(ctx, R * 0.5, R * 0.735, a - (POCKET_DEG / 2) * DEG, a + (POCKET_DEG / 2) * DEG);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();

      // Ball.
      let ball: { angle: number; lift: number } | null = null;
      if (spinning) {
        if (!rm) {
          const s = ballState(spin, now);
          ball = s;
          const key = `${r.spinStartAt}`;
          if (key !== lastSpinKey) {
            lastSpinKey = key;
            lastTick = s.pocketTick;
          }
          if (s.lift < 0.45 && !s.settled && s.pocketTick !== lastTick) {
            lastTick = s.pocketTick;
            play('tick', 45);
          }
        }
      } else if (r.result >= 0 && r.phase !== 'CLOSED') {
        ball = { angle: head + pocketAngle(r.result), lift: 0 };
      }
      if (ball) {
        const rad = (0.555 + ball.lift * 0.31) * R;
        const a = (ball.angle - 90) * DEG;
        const bx = R + Math.cos(a) * rad;
        const by = R + Math.sin(a) * rad;
        const br = R * 0.034;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.ellipse(bx + br * 0.35, by + br * 0.45, br, br * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        const g = ctx.createRadialGradient(bx - br * 0.35, by - br * 0.4, br * 0.1, bx, by, br);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.6, '#e8e4f5');
        g.addColorStop(1, '#8f88b3');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }

      // Glass sheen.
      const sheen = ctx.createLinearGradient(0, 0, px, px);
      sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
      sheen.addColorStop(0.35, 'rgba(255,255,255,0)');
      sheen.addColorStop(1, 'rgba(0,0,0,0.12)');
      ctx.fillStyle = sheen;
      ctx.beginPath();
      ctx.arc(R, R, R * 0.93, 0, Math.PI * 2);
      ctx.fill();
    };
    raf = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(themeRaf);
      offTheme();
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={className ?? 'dn-wheel'} role="img" aria-label={label ?? 'Roulette wheel'} />;
}
