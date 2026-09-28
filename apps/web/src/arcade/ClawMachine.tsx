/**
 * The claw machine at the right end of the cabinet row — the floor's Easter egg — plus its quick
 * button (where the floor has no room for the machine) and the host that opens the close-up.
 *
 * Built like the cabinets (flat SVG panels, cabinet body tokens, a side panel turned towards the
 * aisle): a lit CLAW marquee with chaser bulbs, a glass case with the parked claw and the pile of pixel
 * plushies, a prize chute, a control deck and a prize door. Walk up to it (click / Enter) and it grows
 * into the close-up (ClawCloseup.tsx, lazy loaded), where you operate it. The pile is shared
 * (clawInventory.ts): what you win there is missing here, and the prize door shows it for a moment.
 *
 * Cosmetic and local only (the pile and your prize shelf are kept in this browser).
 */
import { Component, Suspense, lazy, memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CLAW_ART, FLOOR_HOME_X, FLOOR_PLUSH_SCALE, floorOrder, floorPlacement } from './claw.ts';
import { spritePaths, spriteColor, spriteSize } from './clawArt.ts';
import { pileToToys, shelfTotal, useClaw, type ClawOpener } from './clawInventory.ts';
import type { ToyKind } from './clawPile.ts';
import { sfx } from '../audio/audio.ts';
import './claw.css';

/**
 * The close-up's chunk. If it fails to load, the app's stale-deploy handler (chunkReload.ts, on
 * `vite:preloadError`) would reload the page; a cosmetic floor attraction keeps its failure to itself
 * instead (ClawBoundary's in-place message). This listener is registered as this module loads — before
 * main.tsx installs that handler, so it runs first — and swallows the event while a claw load is on.
 */
let clawLoads = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (e) => {
    if (clawLoads > 0) e.stopImmediatePropagation();
  });
}
const loadCloseup = () => {
  clawLoads++;
  return import('./ClawCloseup.tsx').finally(() => {
    clawLoads--;
  });
};
/** Warms the close-up's chunk (hover / focus); a failure here is ignored — opening retries it. */
const preload = () => void loadCloseup().catch(() => undefined);
let ClawCloseup = lazy(loadCloseup);

/** Opens the close-up from `el` (the floor machine, or a quick button). */
export function openClaw(from: ClawOpener['from'], el: HTMLElement | null, rectEl: Element | null = el): void {
  const r = rectEl?.getBoundingClientRect();
  sfx('select');
  useClaw.getState().openCloseup({
    from,
    el,
    rect: r && r.width > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null,
  });
}

/** Mounts the close-up while it's open (lazy chunk). ArcadeFloor renders one. */
export function ClawHost() {
  const open = useClaw((s) => s.open !== null);
  // Leaving the floor (a route change) with the machine open: it closes (the close-up settles its try
  // as it unmounts), so coming back doesn't reopen it.
  useEffect(
    () => () => {
      if (useClaw.getState().open) useClaw.getState().closeCloseup();
    },
    [],
  );
  // Bumped by "Try again" after the chunk failed to load (a fresh lazy() re-imports it).
  const [attempt, setAttempt] = useState(0);
  if (!open) return null;
  return (
    <ClawBoundary
      key={attempt}
      onRetry={() => {
        ClawCloseup = lazy(loadCloseup);
        setAttempt((n) => n + 1);
      }}
    >
      <Suspense fallback={null}>
        <ClawCloseup />
      </Suspense>
    </ClawBoundary>
  );
}

/**
 * Keeps a failed close-up (its chunk didn't load: a network blip, a stale deploy) to itself: a small
 * "being serviced" message with Try again / Close, in place — never a reload or the floor's error screen.
 */
class ClawBoundary extends Component<{ onRetry: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(): void {
    /* handled in place: the message below */
  }
  override render(): ReactNode {
    return this.state.failed ? <ClawUnavailable onRetry={this.props.onRetry} /> : this.props.children;
  }
}

function ClawUnavailable({ onRetry }: { onRetry: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      try {
        d.showModal();
      } catch {
        d.setAttribute('open', '');
      }
    }
    retryRef.current?.focus();
  }, []);
  const close = () => {
    const op = useClaw.getState().open;
    if (ref.current?.open) ref.current.close();
    useClaw.getState().closeCloseup();
    if (op?.el?.isConnected) op.el.focus({ preventScroll: true });
  };
  return (
    <dialog
      ref={ref}
      className="clw-oops"
      data-part="claw-unavailable"
      aria-labelledby="clw-oops-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <p id="clw-oops-title" className="clw-oops__title">
        The claw machine is being serviced
      </p>
      <p className="clw-oops__text">It couldn't load just now. Nothing was lost — your plushies are safe.</p>
      <div className="clw-oops__actions">
        <button ref={retryRef} type="button" className="dc-btn dc-btn--primary" onClick={onRetry}>
          Try again
        </button>
        <button type="button" className="dc-btn dc-btn--secondary" onClick={close}>
          Close
        </button>
      </div>
    </dialog>
  );
}

/** The compact Claw control for floors without room for the machine (HUD / phone extras row). */
export function ClawQuickButton({ className }: { className?: string }) {
  const won = useClaw((s) => shelfTotal(s.inv.shelf));
  const label = `Claw machine${won ? ` (${won} prize${won === 1 ? '' : 's'} won)` : ''}`;
  return (
    <button
      type="button"
      className={`dc-btn dc-btn--ghost dc-btn--icon clw-quick ${className ?? ''}`}
      data-part="claw-quick"
      aria-label={label}
      title="Claw machine"
      onPointerEnter={preload}
      onClick={(e) => openClaw('quick', e.currentTarget)}
    >
      <svg viewBox="0 0 12 12" width="20" height="20" aria-hidden focusable="false" shapeRendering="crispEdges">
        <path
          d="M1 1h10v1H1zM5 2h2v2H5zM3 4h6v1H3zM2 5h2v1H2zM8 5h2v1H8zM1 6h2v2H1zM9 6h2v2H9zM2 8h2v1H2zM8 8h2v1H8zM3 9h1v1H3zM8 9h1v1H8zM5 8h2v1H5zM4 9h4v2H4z"
          fill="currentColor"
        />
      </svg>
    </button>
  );
}

type Display = 'idle' | 'playing' | 'won';
const MARQUEE: Record<Display, string> = { idle: 'CLAW', playing: 'CLAW', won: 'WINNER!' };

/** A floor-art plush (1 art unit a pixel), bottom-centre at (x, y). */
const FloorPlush = memo(function FloorPlush({ kind, color, x, y }: { kind: ToyKind; color: number; x: number; y: number }) {
  const { w, h } = spriteSize(kind);
  return (
    <g
      className="clw-toy"
      transform={`translate(${(x - (w * FLOOR_PLUSH_SCALE) / 2).toFixed(2)} ${(y - h * FLOOR_PLUSH_SCALE).toFixed(2)}) scale(${FLOOR_PLUSH_SCALE})`}
    >
      {spritePaths(kind).map(({ ch, d }) => (
        <path key={ch} d={d} fill={spriteColor(ch, color) ?? 'none'} />
      ))}
    </g>
  );
});

export const ClawMachine = memo(function ClawMachine() {
  const pile = useClaw((s) => s.inv.pile);
  const won = useClaw((s) => shelfTotal(s.inv.shelf));
  const floor = useClaw((s) => s.floor);
  const prize = useClaw((s) => s.lastPrize);
  const isOpen = useClaw((s) => s.open !== null);
  const uid = `clw${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const machineRef = useRef<HTMLSpanElement>(null);

  // The pile, settled, in draw order.
  const toys = useMemo(() => floorOrder(pileToToys(pile)), [pile]);

  // WINNER! lights for a few seconds after you come back with a prize.
  useEffect(() => {
    if (floor !== 'won' || isOpen) return;
    const t = window.setTimeout(() => useClaw.getState().settleFloor(), 5200);
    return () => window.clearTimeout(t);
  }, [floor, isOpen]);

  const display: Display = isOpen ? 'playing' : floor;
  const label = `Claw machine — step up and play${won ? ` (${won} prize${won === 1 ? '' : 's'} won)` : ''}`;
  const word = MARQUEE[display];
  const id = (k: string) => `${uid}-${k}`;
  const url = (k: string) => `url(#${id(k)})`;
  const showPrize = display === 'won' && prize;

  return (
    <button
      type="button"
      className="clw"
      data-part="claw-machine"
      data-state={display}
      aria-label={label}
      aria-haspopup="dialog"
      onPointerEnter={preload}
      onFocus={preload}
      onClick={(e) => openClaw('floor', e.currentTarget, machineRef.current)}
    >
      <span className="clw__machine" ref={machineRef}>
        <svg className="clw-art" viewBox={`0 0 ${CLAW_ART.w} ${CLAW_ART.h}`} aria-hidden focusable="false">
          <ClawDefs uid={uid} />
          <ClawBody uid={uid} />

          {/* marquee */}
          <rect x="20" y="3" width="122" height="24" rx="2" fill={url('sign')} />
          <rect x="24" y="8" width="114" height="14" rx="1.5" fill="#3a0c3a" opacity=".22" />
          <text className="clw-word" x="81" y={word.length > 5 ? 18.6 : 19.8} textAnchor="middle" fontSize={word.length > 5 ? 9.4 : 12.5}>
            {word}
          </text>
          {Array.from({ length: 20 }, (_, i) => (
            <g key={i} className={i % 2 ? 'clw-bulb clw-bulb--b' : 'clw-bulb'}>
              <circle cx={24 + i * 6} cy="5.2" r="1.1" />
              <circle cx={138 - i * 6} cy="24.8" r="1.1" />
            </g>
          ))}

          {/* inside the glass: the pile, the parked rig, the chute */}
          <g clipPath={url('glass')}>
            <rect x="24" y="104" width="30" height="44" fill="#fff" opacity=".04" />
            {toys.map((t) => {
              const p = floorPlacement(t);
              return <FloorPlush key={t.id} kind={t.kind} color={t.color} x={p.x} y={p.y} />;
            })}
            <g transform={`translate(${FLOOR_HOME_X.toFixed(2)} 0)`}>
              <rect x="-7" y="38.4" width="14" height="5.6" rx="1" fill="#c9c3e6" />
              <rect x="-4" y="40" width="8" height="1.4" fill="#6f6a8e" />
              <rect x="-0.6" y="44" width="1.2" height="6" fill="#8f88b3" />
            </g>
            <g transform={`translate(${FLOOR_HOME_X.toFixed(2)} 50)`}>
              <path d="M0 4V12.5" stroke="#8f88b3" strokeWidth="1.3" strokeLinecap="round" />
              <g transform="rotate(-6 -3 3)">
                <path
                  d="M-3 3L-8 9.5L-5.6 14"
                  fill="none"
                  stroke="#d7d2ec"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
              <g transform="rotate(6 3 3)">
                <path d="M3 3L8 9.5L5.6 14" fill="none" stroke="#d7d2ec" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </g>
              <rect x="-5" y="0" width="10" height="4.4" rx="1.2" fill="#c9c3e6" />
              <rect x="-5" y="2.6" width="10" height="1" fill="#6f6a8e" />
            </g>
            {/* the chute's clear front, then reflections on the glass */}
            <rect
              x="24"
              y="104"
              width="30"
              height="44"
              fill="#bfe9ff"
              opacity=".08"
              stroke="#c9c3e6"
              strokeOpacity=".55"
              strokeWidth=".8"
            />
            <rect x="23" y="102.6" width="32" height="2.4" rx=".6" fill="#c9c3e6" />
            <path d="M22 122L72 36H86L22 146Z" fill="#fff" opacity=".045" />
            <rect x="129" y="40" width="2" height="104" fill="#fff" opacity=".05" />
          </g>

          {/* prize door: your last win waits here for a moment */}
          <g clipPath={url('door')}>
            {showPrize ? (
              <g className="clw-prize">
                <FloorPlush kind={prize.kind} color={prize.color} x={46} y={212} />
              </g>
            ) : null}
            <rect
              className="clw-flap"
              data-open={showPrize ? 'true' : undefined}
              x="30.5"
              y="190.5"
              width="31"
              height="23"
              rx="1.4"
              fill={url('metal')}
            />
          </g>
        </svg>
      </span>
      <span className="clw__tag" aria-hidden>
        <span className="clw__name">Claw machine</span>
        <span className="clw__line">{display === 'won' ? 'You won a plush!' : won ? `Prizes won: ${won}` : 'Step up and play'}</span>
      </span>
    </button>
  );
});

/** Gradients, patterns and clips (static). */
const ClawDefs = memo(function ClawDefs({ uid }: { uid: string }) {
  const id = (k: string) => `${uid}-${k}`;
  return (
    <defs>
      {/* stop colours go through style so theme tokens (CSS variables) resolve */}
      <linearGradient id={id('body')} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" style={{ stopColor: 'var(--clw-body)' }} />
        <stop offset=".6" style={{ stopColor: 'color-mix(in srgb, var(--clw-body) 55%, var(--clw-body-2))' }} />
        <stop offset="1" style={{ stopColor: 'var(--clw-body-2)' }} />
      </linearGradient>
      <linearGradient id={id('side')} x1="1" y1="0" x2="0" y2="0">
        <stop offset="0" style={{ stopColor: 'color-mix(in srgb, var(--clw-body-2) 80%, #000)' }} />
        <stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--clw-body-2) 40%, #000)' }} />
      </linearGradient>
      <linearGradient id={id('sign')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style={{ stopColor: 'color-mix(in srgb, var(--clw-accent) 70%, #fff)' }} />
        <stop offset=".5" style={{ stopColor: 'var(--clw-accent)' }} />
        <stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--clw-accent) 70%, #000)' }} />
      </linearGradient>
      <linearGradient id={id('glassfill')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#141b4a" />
        <stop offset="1" stopColor="#070a22" />
      </linearGradient>
      <linearGradient id={id('metal')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#4a4668" />
        <stop offset=".5" stopColor="#2a2742" />
        <stop offset="1" stopColor="#1a1830" />
      </linearGradient>
      <linearGradient id={id('post')} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#8f8aa8" />
        <stop offset=".5" stopColor="#4a4668" />
        <stop offset="1" stopColor="#2a2742" />
      </linearGradient>
      <linearGradient id={id('deck')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style={{ stopColor: 'color-mix(in srgb, var(--clw-accent) 18%, #0d0a1c)' }} />
        <stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--clw-accent) 34%, #0d0a1c)' }} />
      </linearGradient>
      <radialGradient id={id('ball')} cx=".35" cy=".35" r=".75">
        <stop offset="0" stopColor="#fff" stopOpacity=".95" />
        <stop offset=".25" stopColor="#ff3d6e" />
        <stop offset="1" stopColor="#7a1030" />
      </radialGradient>
      <radialGradient id={id('shadow')} cx=".5" cy=".5" r=".5">
        <stop offset="0" stopColor="#000" stopOpacity=".7" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </radialGradient>
      <pattern id={id('print')} width="12" height="12" patternUnits="userSpaceOnUse">
        <path d="M3 1.4L3.7 2.3L4.6 3L3.7 3.7L3 4.6L2.3 3.7L1.4 3L2.3 2.3Z" style={{ fill: 'var(--clw-accent)' }} opacity=".35" />
        <circle cx="9" cy="9" r=".9" fill="#fff" opacity=".12" />
      </pattern>
      <clipPath id={id('glass')}>
        <rect x="22" y="36" width="118" height="112" />
      </clipPath>
      <clipPath id={id('door')}>
        <rect x="29" y="189" width="34" height="26" rx="1.6" />
      </clipPath>
    </defs>
  );
});

/** Everything that doesn't move: shadow, side panel, cabinet, glass case, deck, doors, plinth. */
const ClawBody = memo(function ClawBody({ uid }: { uid: string }) {
  const url = (k: string) => `url(#${uid}-${k})`;
  return (
    <g>
      <ellipse cx="78" cy="243.5" rx="74" ry="5" fill={url('shadow')} />

      {/* side panel, turned towards the aisle */}
      <polygon points="16,0 2,5 2,238 16,242" fill={url('side')} />
      <polygon points="16,0 2,5 2,29 16,30" style={{ fill: 'color-mix(in srgb, var(--clw-accent) 40%, #1a0620)' }} />
      <polygon points="16,36 2,40 2,145 16,148" fill="#0b1030" />
      <polygon points="16,36 2,40 2,145 16,148" fill="#fff" opacity=".04" />
      <polygon points="16,234 2,232 2,238 16,242" fill="#07060d" />
      <rect x="15.4" y="0" width="1.2" height="242" fill="#fff" opacity=".08" />

      {/* marquee housing */}
      <rect x="16" y="0" width="130" height="30" fill="#0b0918" />

      {/* glass case */}
      <rect x="16" y="30" width="130" height="6" fill="#0b0918" />
      <rect x="22" y="36" width="118" height="112" fill={url('glassfill')} />
      <rect x="22" y="36" width="118" height="1.6" fill="#fff" opacity=".45" />
      <polygon points="30,37.6 132,37.6 140,92 22,92" fill="#fff" opacity=".03" />
      <rect x="22" y="40" width="118" height="2.4" fill="#8f88b3" />
      <rect x="22" y="42.4" width="118" height=".8" fill="#000" opacity=".3" />
      <rect x="16" y="30" width="6" height="122" fill={url('post')} />
      <rect x="140" y="30" width="6" height="122" fill={url('post')} />
      <rect x="16" y="148" width="130" height="4" fill="#0b0918" />

      {/* control deck */}
      <polygon points="16,152 146,152 150,168 12,168" fill={url('deck')} />
      <rect x="16" y="152" width="130" height="1.2" fill="#fff" opacity=".12" />
      <rect className="clw-edge" x="12" y="168" width="138" height="2.6" />
      <rect x="12" y="170.6" width="138" height="3.4" fill="#0d0b19" />
      <ellipse cx="44" cy="163" rx="8" ry="2.8" fill="#06050c" />
      <ellipse cx="44" cy="162.2" rx="5.6" ry="2" fill="#23203a" />
      <rect x="43" y="152" width="2" height="10" rx=".8" fill="#b8b6cc" />
      <circle cx="44" cy="151.5" r="4.6" fill={url('ball')} />
      <ellipse cx="100" cy="162.4" rx="10" ry="4.2" fill="#06050c" />
      <g className="clw-go">
        <ellipse cx="100" cy="160" rx="8.6" ry="3.6" fill="#ff3d6e" />
        <ellipse cx="97.6" cy="158.9" rx="3.2" ry="1.1" fill="#fff" opacity=".55" />
      </g>
      <rect x="121" y="155.5" width="14" height="8" rx="1.2" fill={url('metal')} />
      <rect x="127.2" y="157" width="1.6" height="5" fill="#15121f" />
      <rect className="clw-coin" x="131" y="157.6" width="2" height="1.6" />

      {/* lower cabinet: print, prize door, coin door */}
      <rect x="16" y="174" width="130" height="60" fill={url('body')} />
      <rect x="16" y="174" width="130" height="60" fill={url('print')} />
      <rect className="clw-shade" x="16" y="174" width="130" height="60" />
      <text className="clw-door-label" x="46" y="185.4" textAnchor="middle">
        PRIZE
      </text>
      <rect x="28" y="188" width="36" height="28" rx="2" fill="#06050c" stroke="#6f6a8e" strokeWidth=".8" />
      <rect x="98" y="188" width="34" height="30" rx="2" fill={url('metal')} stroke="#6f6a8e" strokeWidth=".8" />
      {[104, 121].map((x) => (
        <g key={x}>
          <rect x={x} y="193" width="5" height="11" rx="1" fill="#15121f" />
          <rect className="clw-coin" x={x + 1.6} y="194.5" width="1.8" height="8" rx=".6" />
        </g>
      ))}
      <circle cx="115" cy="212" r="1.6" fill="#0b0916" />

      {/* plinth + LED strip */}
      <rect x="14" y="234" width="134" height="8" fill="#0b0918" />
      <rect className="clw-led" x="16" y="234" width="130" height="1.4" />
    </g>
  );
});
