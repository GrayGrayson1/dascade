/**
 * React shell around WheelRenderer: sizes the wheel to its box, forwards props
 * to the renderer and renders the DOM parts (hub, pointer, gloss).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { PixelIcon, cx, useThemeTokens } from '@dascade/ui';
import type { WheelSnapshotSegment } from '@dascade/shared/games/wheel';
import { useApp } from '../../app/store.ts';
import { formatPercent } from './model.ts';
import { WheelRenderer, type RenderLayout, type RenderSpin } from './WheelRenderer.ts';
import { wheelPalette } from './palette.ts';

export interface WheelDisplayProps {
  layout: RenderLayout;
  /** Rotation used when there is no spin. */
  rest: number;
  spin: RenderSpin | null;
  highlight: { id: string; color: string } | null;
  variant?: 'stage' | 'preview';
  /** Accessible description of the wheel. */
  label: string;
  className?: string;
  /** Hub click (spins when allowed). */
  onHubClick?: () => void;
  hubActive?: boolean;
  onTick?: (speed: number) => void;
  onPointer?: (segment: WheelSnapshotSegment | null) => void;
  /** Largest size (CSS px) the wheel may take. */
  maxSize?: number;
  /** Show a slice's name on hover / tap (thin slices hide their labels). */
  hoverLabels?: boolean;
  children?: ReactNode;
}

export function WheelDisplay({
  layout,
  rest,
  spin,
  highlight,
  variant = 'stage',
  label,
  className,
  onHubClick,
  hubActive,
  onTick,
  onPointer,
  maxSize = 1400,
  hoverLabels = false,
  children,
}: WheelDisplayProps) {
  const [tip, setTip] = useState<{ x: number; y: number; seg: WheelSnapshotSegment } | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const totalWeight = useMemo(() => layout.segments.reduce((sum, s) => sum + s.weight, 0), [layout.segments]);
  const boxRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const rimRef = useRef<HTMLCanvasElement>(null);
  const faceRef = useRef<HTMLCanvasElement>(null);
  const lightsRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WheelRenderer | null>(null);
  const [size, setSize] = useState(0);
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const fx = useApp((s) => s.settings.fx);
  const callbacks = useRef({ onTick, onPointer });
  callbacks.current = { onTick, onPointer };
  const gradientId = useId().replace(/:/g, '');
  // Theme materials (read in scope of the wheel so per-game nudges apply); live on theme change.
  const materials = useThemeTokens(rootRef).materials;

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const r = box.getBoundingClientRect();
      setSize(Math.max(0, Math.floor(Math.min(r.width, r.height, maxSize))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [maxSize]);

  useEffect(() => {
    const root = rootRef.current;
    const rim = rimRef.current;
    const face = faceRef.current;
    const lights = lightsRef.current;
    const pointer = pointerRef.current;
    if (!root || !rim || !face || !lights || !pointer) return;
    const renderer = new WheelRenderer(
      { root, rim, face, lights, pointer },
      {
        onTick: (speed) => callbacks.current.onTick?.(speed),
        onPointer: (seg) => callbacks.current.onPointer?.(seg),
      },
    );
    rendererRef.current = renderer;
    return () => {
      renderer.destroy();
      if (rendererRef.current === renderer) rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setPalette(wheelPalette(materials));
  }, [materials]);
  useEffect(() => {
    rendererRef.current?.setOptions({ reducedMotion, fx, preview: variant === 'preview' });
  }, [reducedMotion, fx, variant]);
  useEffect(() => {
    rendererRef.current?.setSize(size);
  }, [size]);
  useEffect(() => {
    rendererRef.current?.setLayout(layout);
  }, [layout]);
  useEffect(() => {
    rendererRef.current?.setRest(rest);
  }, [rest]);
  useEffect(() => {
    rendererRef.current?.setSpin(spin);
  }, [spin]);
  useEffect(() => {
    rendererRef.current?.setHighlight(highlight);
  }, [highlight]);
  useEffect(
    () => () => {
      if (tipTimer.current) clearTimeout(tipTimer.current);
    },
    [],
  );

  const probe = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!hoverLabels) return;
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const seg = rendererRef.current?.sliceAt(x, y) ?? null;
    setTip((prev) => (seg ? (prev && prev.seg.id === seg.id && Math.abs(prev.x - x) < 2 && Math.abs(prev.y - y) < 2 ? prev : { x, y, seg }) : null));
    if (tipTimer.current) clearTimeout(tipTimer.current);
    if (e.pointerType !== 'mouse') tipTimer.current = setTimeout(() => setTip(null), 2200);
  };

  return (
    <div className={cx('wh-wheel-box', `wh-wheel-box--${variant}`, className)} ref={boxRef}>
      <div
        className="wh-wheel"
        ref={rootRef}
        style={{ width: size, height: size }}
        role="img"
        aria-label={label}
        data-variant={variant}
        data-part="wheel"
        onPointerMove={(e) => e.pointerType === 'mouse' && probe(e)}
        onPointerDown={(e) => e.pointerType !== 'mouse' && probe(e)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setTip(null)}
      >
        <div className="wh-wheel__halo" aria-hidden />
        <canvas className="wh-wheel__rim" ref={rimRef} aria-hidden />
        <div className="wh-wheel__face-wrap" aria-hidden>
          <canvas className="wh-wheel__face" ref={faceRef} />
        </div>
        <div className="wh-wheel__gloss" aria-hidden />
        <canvas className="wh-wheel__lights" ref={lightsRef} aria-hidden />
        <div
          className={cx('wh-hub', hubActive && 'wh-hub--active')}
          data-part="wheel-hub"
          aria-hidden
          onClick={hubActive ? onHubClick : undefined}
          title={hubActive ? 'Spin!' : undefined}
        >
          <PixelIcon name="star" className="wh-hub__icon" />
        </div>
        <div className="wh-pointer" data-part="wheel-pointer" ref={pointerRef} aria-hidden>
          <svg viewBox="0 0 60 100" className="wh-pointer__svg">
            <defs>
              <linearGradient id={`${gradientId}-body`} x1="0" y1="0" x2="1" y2="0">
                {/* Themeable (--wh-pointer-*); the fallbacks are the pointer's own colours. */}
                <stop offset="0" style={{ stopColor: 'var(--wh-pointer-1, #ff9dbd)' }} />
                <stop offset="0.45" style={{ stopColor: 'var(--wh-pointer-2, #ff4f81)' }} />
                <stop offset="1" style={{ stopColor: 'var(--wh-pointer-3, #a80f45)' }} />
              </linearGradient>
              <radialGradient id={`${gradientId}-pin`} cx="0.35" cy="0.3" r="0.8">
                <stop offset="0" style={{ stopColor: 'var(--wh-pin-1, #fff6d8)' }} />
                <stop offset="0.5" style={{ stopColor: 'var(--wh-pin-2, #ffbf3f)' }} />
                <stop offset="1" style={{ stopColor: 'var(--wh-pin-3, #8a4a00)' }} />
              </radialGradient>
            </defs>
            <path
              d="M30 97 L12 42 A19 19 0 1 1 48 42 Z"
              fill={`url(#${gradientId}-body)`}
              style={{ stroke: 'var(--wh-pointer-edge, #3b0016)' }}
              strokeWidth="3.5"
              strokeLinejoin="round"
            />
            <path d="M22 40 L30 84 L27 44 Z" fill="rgba(255,255,255,0.45)" />
            <circle cx="30" cy="20" r="11" fill={`url(#${gradientId}-pin)`} stroke="#3b1800" strokeWidth="3" />
            <rect x="26" y="19" width="8" height="2.4" fill="#3b1800" />
            <rect x="28.8" y="16.2" width="2.4" height="8" fill="#3b1800" />
          </svg>
        </div>
        {children}
        {tip ? (
          <div className="wh-tip" style={{ left: tip.x, top: tip.y, '--c': tip.seg.color } as CSSProperties} aria-hidden>
            <span className="wh-tip__label">
              {tip.seg.emoji && tip.seg.label ? `${tip.seg.emoji} ` : ''}
              {tip.seg.label || tip.seg.emoji}
            </span>
            {totalWeight > 0 ? <span className="wh-tip__pct dc-num">{formatPercent(tip.seg.weight / totalWeight)}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
