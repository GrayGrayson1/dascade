/**
 * Procedural pixel-art scene: a 240×135 canvas scaled with image-rendering: pixelated,
 * plus a blurred bloom canvas for soft light. Parallax follows the pointer and a slow
 * drift; everything freezes on a still frame when reduced motion is on, and particles /
 * bloom scale with the visual-effects setting.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { cx } from '@dascade/ui';
import { QUEST_THEMES, type QuestThemeId } from '@dascade/shared/games/quest';
import { useApp } from '../../../app/store.ts';
import { H, W, type Paint } from './pixel.ts';
import { THEMES, THEME_TINT, paintFallback } from './themes.ts';
import { PROPS } from './props.ts';

function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}

export function isTheme(value: string): value is QuestThemeId {
  return (QUEST_THEMES as readonly string[]).includes(value);
}

export interface SceneCanvasProps {
  theme: string;
  art?: readonly string[];
  seed: string;
  label: string;
  className?: string;
  children?: ReactNode;
}

export function SceneCanvas({ theme, art = [], seed, label, className, children }: SceneCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pixRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLCanvasElement>(null);
  const reduced = useApp((s) => s.settings.reducedMotion);
  const fx = useApp((s) => s.settings.fx);
  const artKey = art.join('|');
  const safeTheme: QuestThemeId | null = isTheme(theme) ? theme : null;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = pixRef.current;
    const glowCanvas = glowRef.current;
    if (!wrap || !canvas || !glowCanvas) return;
    const g = canvas.getContext('2d');
    const glow = glowCanvas.getContext('2d');
    if (!g || !glow) return;
    g.imageSmoothingEnabled = false;
    const motion = !reduced;
    const props = artKey ? artKey.split('|') : [];
    const painter = safeTheme ? THEMES[safeTheme] : paintFallback;
    const seedN = seedOf(seed);
    const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    const onMove = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      pointer.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      pointer.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    };
    const onLeave = () => {
      pointer.x = 0;
      pointer.y = 0;
    };
    const start = performance.now();
    const paint = (now: number) => {
      const t = motion ? Math.max(0, now - start) / 1000 : 2.4;
      pointer.sx += (pointer.x - pointer.sx) * 0.08;
      pointer.sy += (pointer.y - pointer.sy) * 0.08;
      const drift = motion ? Math.sin(t * 0.22) * 0.35 : 0;
      const p: Paint = { g, glow, t, px: motion ? pointer.sx * 0.65 + drift : 0, py: motion ? pointer.sy * 0.5 : 0, seed: seedN, motion, fx };
      g.clearRect(0, 0, W, H);
      glow.clearRect(0, 0, W, H);
      painter(p);
      for (const id of props) PROPS[id]?.(p);
    };
    paint(performance.now());
    if (!motion) return;

    let raf = 0;
    let last = 0;
    let visible = true;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden || now - last < 1000 / 30) return;
      last = now;
      paint(now);
    };
    raf = requestAnimationFrame(loop);
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerleave', onLeave);
    const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => (visible = entries.some((e) => e.isIntersecting))) : null;
    io?.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
      wrap.removeEventListener('pointermove', onMove);
      wrap.removeEventListener('pointerleave', onLeave);
    };
  }, [safeTheme, artKey, seed, reduced, fx]);

  return (
    <div
      ref={wrapRef}
      className={cx('qs-scene', className)}
      role="img"
      aria-label={label}
      data-theme={theme}
      style={{ '--tint': safeTheme ? THEME_TINT[safeTheme] : '#a3e635' } as CSSProperties}
    >
      <canvas ref={pixRef} width={W} height={H} className="qs-scene__px" />
      <canvas ref={glowRef} width={W} height={H} className="qs-scene__glow" aria-hidden />
      <span className="qs-scene__vignette" aria-hidden />
      {children}
    </div>
  );
}
