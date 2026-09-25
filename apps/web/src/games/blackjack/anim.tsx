/**
 * Table animation plumbing: cards fly from the shoe, payouts slide to and from the
 * dealer's chip rack. Everything measures real DOM positions so it works for any
 * layout, and degrades to a simple fade when reduced motion or effects are off.
 */
import { createContext, useContext, useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { PlayingCard, cx } from '@dascade/ui';
import { useApp } from '../../app/store.ts';
import { sfx } from '../../audio/audio.ts';

interface TableAnim {
  shoeRef: RefObject<HTMLDivElement | null>;
  rackRef: RefObject<HTMLDivElement | null>;
  seen: Set<string>;
  mountedAt: number;
  reduced: boolean;
  fx: 'high' | 'low' | 'off';
}

const AnimContext = createContext<TableAnim | null>(null);

export function TableAnimProvider({ children }: { children: ReactNode }) {
  const shoeRef = useRef<HTMLDivElement>(null);
  const rackRef = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<string>());
  const mountedAt = useRef(performance.now());
  const reduced = useApp((s) => s.settings.reducedMotion);
  const fx = useApp((s) => s.settings.fx);
  const value = useMemo<TableAnim>(
    () => ({ shoeRef, rackRef, seen: seen.current, mountedAt: mountedAt.current, reduced, fx }),
    [reduced, fx],
  );
  return <AnimContext.Provider value={value}>{children}</AnimContext.Provider>;
}

export function useTableAnim(): TableAnim {
  const ctx = useContext(AnimContext);
  if (!ctx) throw new Error('useTableAnim outside TableAnimProvider');
  return ctx;
}

function centerDelta(from: DOMRect, to: DOMRect): { dx: number; dy: number } {
  return { dx: from.left + from.width / 2 - (to.left + to.width / 2), dy: from.top + from.height / 2 - (to.top + to.height / 2) };
}

/** Views mounted mid-round (refresh / reconnect) should not replay the deal. */
function isFreshMount(ctx: TableAnim): boolean {
  return performance.now() - ctx.mountedAt < 450;
}

export interface TableCardProps {
  /** Unique per round/position/card, e.g. `r12:p1:h0:c2:Kh`. */
  animKey: string;
  code?: string | null;
  faceDown?: boolean;
  /** 'deal' flies from the shoe; 'slide' is the short move used when a pair is split. */
  entry?: 'deal' | 'slide';
  highlight?: boolean;
  dim?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function TableCard({ animKey, code, faceDown, entry = 'deal', highlight, dim, className, style }: TableCardProps) {
  const ctx = useTableAnim();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || ctx.seen.has(animKey)) return;
    ctx.seen.add(animKey);
    if (isFreshMount(ctx)) return;
    sfx('card', 45);
    if (ctx.reduced || ctx.fx === 'off') {
      el.classList.add('bj-card--fade');
      return;
    }
    if (entry === 'slide') {
      el.classList.add('bj-card--slide');
      return;
    }
    const shoe = ctx.shoeRef.current?.getBoundingClientRect();
    if (!shoe || shoe.width === 0) {
      el.classList.add('bj-card--fade');
      return;
    }
    const { dx, dy } = centerDelta(shoe, el.getBoundingClientRect());
    el.style.setProperty('--from-x', `${dx}px`);
    el.style.setProperty('--from-y', `${dy}px`);
    el.classList.add('bj-card--deal');
    const done = () => el.classList.remove('bj-card--deal');
    el.addEventListener('animationend', done, { once: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animKey]);
  return (
    <div ref={ref} className={cx('bj-card', className)} style={style}>
      <PlayingCard code={code ?? undefined} faceDown={faceDown} width={64} highlight={highlight} dim={dim} style={{ '--w': 'var(--bj-card-w)' } as CSSProperties} />
    </div>
  );
}

/**
 * A short-lived chip flight between a betting circle and the dealer's rack.
 * `direction="in"` = winnings arriving from the rack, `"out"` = losses collected.
 */
export function ChipFlight({ direction, children, playKey }: { direction: 'in' | 'out'; children: ReactNode; playKey: string }) {
  const ctx = useTableAnim();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (isFreshMount(ctx) || ctx.reduced || ctx.fx === 'off') {
      el.classList.add(direction === 'in' ? 'bj-flight--static-in' : 'bj-flight--static-out');
      return;
    }
    const rack = ctx.rackRef.current?.getBoundingClientRect();
    if (!rack || rack.width === 0) {
      el.classList.add(direction === 'in' ? 'bj-flight--static-in' : 'bj-flight--static-out');
      return;
    }
    const { dx, dy } = centerDelta(rack, el.getBoundingClientRect());
    el.style.setProperty('--rack-x', `${dx}px`);
    el.style.setProperty('--rack-y', `${dy}px`);
    el.classList.add(direction === 'in' ? 'bj-flight--in' : 'bj-flight--out');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey]);
  return (
    <div ref={ref} className="bj-flight" aria-hidden>
      {children}
    </div>
  );
}
