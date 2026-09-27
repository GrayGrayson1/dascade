/** HUD building blocks for the Classics header strip (numbers always in --font-num, tabular). */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PixelIcon, cx, type IconName } from '@dascade/ui';
import { useCountdown } from '../../net/hooks.ts';
import { useApp } from '../../app/store.ts';

export function formatScore(n: number): string {
  return Math.max(0, Math.floor(n)).toLocaleString('en-US');
}

/** A labelled HUD value. `emphasis` makes it the big score readout; `bump` flashes on change. */
export function HudStat({
  label,
  value,
  emphasis,
  icon,
  className,
  title,
  bump,
}: {
  label: string;
  value: ReactNode;
  emphasis?: boolean;
  icon?: IconName;
  className?: string;
  title?: string;
  /** Drives the change flash when `value` is an element (primitives bump automatically). */
  bump?: string | number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useApp((s) => s.settings.reducedMotion);
  // Only primitive values bump (elements are new objects every render).
  const key = bump ?? (typeof value === 'string' || typeof value === 'number' ? value : null);
  const prev = useRef(key);
  useEffect(() => {
    if (key === null || prev.current === key) return;
    prev.current = key;
    const el = ref.current;
    if (!el || reduced) return;
    el.classList.remove('is-bump');
    void el.offsetWidth;
    el.classList.add('is-bump');
  }, [key, reduced]);
  return (
    <div ref={ref} className={cx('cl-stat', emphasis && 'cl-stat--big', className)} title={title}>
      <span className="cl-stat__label">
        {icon ? <PixelIcon name={icon} size={12} /> : null}
        {label}
      </span>
      <span className="cl-stat__value">{value}</span>
    </div>
  );
}

/** Lives as pixel hearts (with a numeric fallback for screen readers and large counts). */
export function HudLives({ lives, max = 5, label = 'Lives' }: { lives: number; max?: number; label?: string }) {
  const shown = Math.min(lives, max);
  return (
    <div className="cl-stat cl-stat--lives" aria-label={`${label}: ${lives}`} role="group">
      <span className="cl-stat__label" aria-hidden>
        {label}
      </span>
      <span className="cl-stat__value cl-lives" aria-hidden>
        {Array.from({ length: shown }, (_, i) => (
          <PixelIcon key={i} name="heart" size={14} className="cl-lives__heart" />
        ))}
        {lives > max ? <span className="cl-lives__more">+{lives - max}</span> : null}
        {lives <= 0 ? <span className="cl-lives__none">—</span> : null}
      </span>
    </div>
  );
}

/** Race clock counting down to a server-epoch deadline (mm:ss). */
export function HudTimer({ endsAt, label = 'Time' }: { endsAt: number; label?: string }) {
  const ms = useCountdown(endsAt);
  const s = Math.ceil(ms / 1000);
  const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return <HudStat label={label} icon="clock" value={<span className={cx(s <= 10 && s > 0 && 'cl-warn')}>{text}</span>} />;
}

/** Counts up to `value` (skipped under reduced motion). */
export function CountUp({ value, ms = 900 }: { value: number; ms?: number }) {
  const reduced = useApp((s) => s.settings.reducedMotion);
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      setShown(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, reduced]);
  return <>{formatScore(shown)}</>;
}

/** HUD for spectators: who leads, their score, and how many are still playing. */
export function SpectatorHud({ rows }: { rows: Array<{ id: string; name: string; score: number; status: string }> }) {
  const leader = rows.find((r) => r.status !== 'out');
  const live = rows.filter((r) => r.status === 'playing').length;
  return (
    <>
      <HudStat label="Spectating" icon="eye" value={<span className="cl-hud-name">{leader?.name ?? '—'}</span>} />
      <HudStat label="Top score" value={formatScore(leader?.score ?? 0)} emphasis />
      <HudStat label="Still in" value={`${live}/${rows.length}`} />
    </>
  );
}
