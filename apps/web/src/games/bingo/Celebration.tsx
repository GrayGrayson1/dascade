/**
 * The big BINGO moment: letter tiles popping in, a pixel confetti burst (honors the
 * fx and reduced-motion settings) and the false-alarm stamp.
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import { PixelIcon } from '@dascade/ui';
import { BINGO_LETTERS, LETTER_COLORS, useFx, useReducedMotion } from './util.ts';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  spin: number;
  phase: number;
  life: number;
}

/** Full-screen pixel confetti. Re-fires whenever `burst` changes. */
export function Confetti({ burst, behind = false }: { burst: number; behind?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fx = useFx();
  const reduced = useReducedMotion();
  const amount = reduced || fx === 'off' ? 0 : fx === 'low' ? 70 : 200;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !burst || amount === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
    };
    resize();
    window.addEventListener('resize', resize);
    const W = () => canvas.width / dpr;
    const H = () => canvas.height / dpr;
    const particles: Particle[] = [];
    // Pure decoration (never gameplay), so plain Math.random is fine here.
    for (let i = 0; i < amount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const r = Math.random();
      particles.push({
        x: side < 0 ? W() * (0.05 + r * 0.25) : W() * (0.7 + r * 0.25),
        y: H() * (0.55 + Math.random() * 0.2),
        vx: -side * (1.5 + Math.random() * 5.5) * (Math.random() < 0.2 ? -1 : 1),
        vy: -(9 + Math.random() * 9),
        size: 4 + Math.floor(Math.random() * 4) * 2,
        color: LETTER_COLORS[i % LETTER_COLORS.length] as string,
        spin: 0.05 + Math.random() * 0.2,
        phase: Math.random() * Math.PI * 2,
        life: 0,
      });
    }
    let raf = 0;
    let last = performance.now();
    const started = last;
    const tick = (now: number) => {
      const dt = Math.min(2.5, (now - last) / 16.67);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W(), H());
      let alive = 0;
      for (const p of particles) {
        p.life += dt;
        p.vy += 0.32 * dt;
        p.vx *= 0.992;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.phase += p.spin * dt;
        if (p.y > H() + 20) continue;
        alive++;
        const w = Math.max(1, Math.abs(Math.cos(p.phase)) * p.size);
        ctx.globalAlpha = Math.max(0, Math.min(1, 1.3 - (now - started) / 2400));
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x - w / 2), Math.round(p.y - p.size / 2), Math.round(w), p.size);
      }
      if (alive > 0 && now - started < 3000) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, W(), H());
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [burst, amount]);

  if (amount === 0) return null;
  return <canvas ref={ref} className={behind ? 'bg-confetti bg-confetti--behind' : 'bg-confetti'} aria-hidden />;
}

export interface BurstInfo {
  id: number;
  round: number;
  winners: Array<{ id: string; name: string }>;
  patternName: string;
  meId: string | null;
  prize: string;
}

/** Giant BINGO letters + winner line. Dismisses itself. */
export function BingoBurst({ info, onDone }: { info: BurstInfo; onDone: () => void }) {
  const reduced = useReducedMotion();
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const t = setTimeout(() => doneRef.current(), reduced ? 2600 : 3400);
    return () => clearTimeout(t);
  }, [info.id, reduced]);
  const me = info.winners.some((w) => w.id === info.meId);
  const others = info.winners.filter((w) => w.id !== info.meId).map((w) => w.name);
  const who = me ? (others.length ? `You share it with ${others.join(' & ')}!` : 'You called it!') : `${others.join(' & ')} called it!`;
  return (
    <div className="bg-burst" role="alert" onClick={() => doneRef.current()}>
      <div className="bg-burst__letters" aria-label="BINGO!">
        {BINGO_LETTERS.map((l, i) => (
          <span key={l} className="bg-burst__tile" style={{ '--tone': LETTER_COLORS[i], '--i': i } as CSSProperties} aria-hidden>
            {l}
          </span>
        ))}
        <span className="bg-burst__bang" aria-hidden>
          !
        </span>
      </div>
      <div className="bg-burst__who">
        <PixelIcon name="trophy" />
        <strong>{who}</strong>
      </div>
      <div className="bg-burst__pattern">
        {info.patternName}
        {info.prize ? <span className="bg-burst__prize"> · {info.prize}</span> : null}
      </div>
    </div>
  );
}

/** Red rubber stamp shown on your card after a false claim. */
export function FalseAlarmStamp({ secondsLeft }: { secondsLeft: number }) {
  return (
    <div className="bg-stamp" role="status">
      <span className="bg-stamp__title">False alarm</span>
      {secondsLeft > 0 ? <span className="bg-stamp__sub">Benched · {secondsLeft}s</span> : <span className="bg-stamp__sub">Keep daubing!</span>}
    </div>
  );
}
