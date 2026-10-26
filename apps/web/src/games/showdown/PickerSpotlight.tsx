/**
 * PCK-01 D — the Spotlight picker on the showcase stage (a layer at z 14, over the board).
 *
 * The server has already drawn the winner (`pick` → public `hotSeat`, `pickAt`, `landAt`); this layer
 * only replays it. The audience is a grid of seats (useSeatGrid: everyone with a seat, in join order,
 * away / done written on the seat). Three spotlights sweep the room from `pickAt` along paths seeded by
 * the draw number (spotlight.ts: the same sweep on every screen), converge during the last 1.5 s from
 * where they actually are, and land on the winner at `landAt`; a big card names them for 2.5 s, then
 * the layer fades and the hot-seat podium (HotSeat.tsx) holds the name for the rest of the turn.
 *
 * The light is real DOM: an unlit copy of the seats (the dark house) and a lit copy masked by the union
 * of three radial gradients, with SVG beams from three lamps. During the sweep the mask and the beams
 * are moved straight in the DOM (≈ 30 fps, the stream's own rate): React renders the seats once a draw.
 *
 * Reduced motion / effects off: no sweep. The room dims, and at the landing one still spot sits on the
 * chosen seat while the card appears. Nothing flashes; light changes take about 1.5 s.
 *
 * A screen that first sees a draw after its landing (a reload, a reconnect, a restored show) replays
 * nothing; one that joins mid-sweep picks it up at the right moment.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { serverNow } from '../../net/hooks.ts';
import { fill, type ShowcaseCopy } from './look.ts';
import { usePicker, useSeatGrid, type GridSeat, type MotionPrefs } from './state.ts';
import { Numbered } from './HotSeat.tsx';
import {
  SPOT_CARD_MS,
  SPOT_OUT_MS,
  pickPhase,
  seatCenter,
  seatFont,
  seatLayout,
  spotFrame,
  spotPaths,
  type PickPhase,
  type SeatLayout,
} from './spotlight.ts';

/** Where the picker is right now, for the stage (the overlay, the podium, the host). */
export interface PickMoment {
  phase: PickPhase;
  drawNo: number;
  /** The hot seat ('' = nobody) and their name. */
  hotSeat: string;
  name: string;
  pickAt: number;
  landAt: number;
  poolSize: number;
  /** Someone is in the hot seat and the stage has landed on them (or this screen came in after the landing). */
  landed: boolean;
}

/**
 * The picker's moment on this screen. It remembers when this screen first saw each draw, so a draw
 * seen only after its landing never replays, and re-renders itself at each boundary (the sweep, the
 * landing, the card's end, the fade's end).
 */
export function usePickMoment(): PickMoment {
  const { drawNo, hotSeat, hotName, pickAt, landAt, poolSize } = usePicker();
  const seen = useRef<{ drawNo: number; at: number } | null>(null);
  if (hotSeat && pickAt && seen.current?.drawNo !== drawNo) seen.current = { drawNo, at: serverNow() };
  const [tick, setTick] = useState(0);
  const now = serverNow();
  const seenAt = seen.current?.drawNo === drawNo ? seen.current.at : Number.POSITIVE_INFINITY;
  const phase: PickPhase = hotSeat ? pickPhase({ pickAt, landAt, seenAt }, now) : 'idle';
  const landed = Boolean(hotSeat) && (!landAt || now >= landAt);

  useEffect(() => {
    if (!hotSeat || !landAt) return;
    const at = serverNow();
    const next = [pickAt - 250, landAt, landAt + SPOT_CARD_MS, landAt + SPOT_CARD_MS + SPOT_OUT_MS].find((b) => b > at);
    if (next === undefined) return;
    const t = setTimeout(() => setTick((n) => n + 1), next - at + 20);
    return () => clearTimeout(t);
  }, [hotSeat, pickAt, landAt, drawNo, tick]);

  return { phase, drawNo, hotSeat, name: hotName, pickAt, landAt, poolSize, landed };
}

export function PickerSpotlight({ moment, copy, motion }: { moment: PickMoment; copy: ShowcaseCopy; motion: MotionPrefs }) {
  if (moment.phase === 'idle' || !moment.hotSeat) return null;
  return <SpotlightLayer key={moment.drawNo} moment={moment} copy={copy} sweep={motion.motion} />;
}

// ---------------------------------------------------------------------------

/** About 30 frames a second: the share runs at 15, and the console may be drawing two stages. */
const FRAME_MS = 32;
/** The lamps along the top of the room (fractions of the area's width). */
const LAMPS = [0.17, 0.5, 0.83] as const;

interface Size {
  w: number;
  h: number;
}

function SpotlightLayer({ moment, copy, sweep }: { moment: PickMoment; copy: ShowcaseCopy; sweep: boolean }) {
  const seats = useSeatGrid();
  const areaRef = useRef<HTMLDivElement>(null);
  const litRef = useRef<HTMLDivElement>(null);
  const beamRefs = useRef<Array<SVGPolygonElement | null>>([]);
  const lampRefs = useRef<Array<SVGCircleElement | null>>([]);
  const size = useAreaSize(areaRef);
  const gradient = `sd-pick-beam-${useId().replace(/:/g, '')}`;

  const { phase, drawNo, hotSeat, name, pickAt, landAt, poolSize } = moment;
  const landedHere = phase === 'card' || phase === 'out';
  const layout = useMemo(
    () => (size.w > 0 && size.h > 0 ? seatLayout(seats.length, size.w, size.h) : null),
    [seats.length, size.w, size.h],
  );
  const index = seats.findIndex((s) => s.id === hotSeat);
  const centre = layout && index >= 0 ? seatCenter(layout, index, seats.length) : { x: size.w / 2, y: size.h / 2 };
  const target: [number, number] = size.w > 0 && size.h > 0 ? [centre.x / size.w, centre.y / size.h] : [0.5, 0.5];
  const landT = Math.max(0, landAt - pickAt);
  const paths = useMemo(() => spotPaths(drawNo, landT + 400), [drawNo, landT]);
  const radius = layout ? spotRadius(layout, size) : { sweep: 0, land: 0 };

  // Everything a frame needs, current (the frame loop itself starts once per draw).
  const live = useRef({ size, target, radius, paths, pickAt, landT, sweeping: sweep && phase === 'sweep', landedHere });
  live.current = { size, target, radius, paths, pickAt, landT, sweeping: sweep && phase === 'sweep', landedHere };

  /** Puts the light where it is right now. */
  const paintNow = () => {
    const cur = live.current;
    if (cur.size.w <= 0) return;
    if (cur.sweeping) {
      const f = spotFrame(cur.paths, serverNow() - cur.pickAt, cur.landT, cur.target);
      const r = cur.radius.sweep + (cur.radius.land - cur.radius.sweep) * f.converge;
      paint(
        litRef.current,
        beamRefs.current,
        lampRefs.current,
        f.spots.map(([x, y]) => ({ x: x * cur.size.w, y: y * cur.size.h, r })),
        cur.size,
        true,
      );
    } else {
      // Still: nothing lit while the room waits; once landed, one spot on the winner.
      const spot = cur.landedHere ? [{ x: cur.target[0] * cur.size.w, y: cur.target[1] * cur.size.h, r: cur.radius.land }] : [];
      paint(litRef.current, beamRefs.current, lampRefs.current, spot, cur.size, false);
    }
  };
  // Before every paint React makes (a resize, the landing)…
  useLayoutEffect(paintNow);
  // …and frame by frame during the sweep, in the window the stage is drawn in.
  useEffect(() => {
    if (!sweep || phase !== 'sweep') return;
    const view = areaRef.current?.ownerDocument.defaultView ?? window;
    let raf = 0;
    let last = -FRAME_MS;
    const frame = (stamp: number) => {
      raf = view.requestAnimationFrame(frame);
      if (stamp - last < FRAME_MS) return;
      last = stamp;
      paintNow();
    };
    raf = view.requestAnimationFrame(frame);
    return () => view.cancelAnimationFrame(raf);
    // paintNow reads `live`, which is always current.
  }, [sweep, phase]);

  const renderSeats = (lit: boolean) =>
    layout
      ? seats.map((seat, i) => (
          <Seat
            key={seat.id}
            seat={seat}
            layout={layout}
            centre={seatCenter(layout, i, seats.length)}
            areaWidth={size.w}
            // The winner looks like everyone else until the stage lands on them.
            state={seat.id === hotSeat ? (landedHere ? 'hot' : 'pool') : seat.state}
            win={lit && landedHere && seat.id === hotSeat}
            copy={copy}
          />
        ))
      : null;

  const status = landedHere ? `${copy.pickUp} ${name}` : `${copy.pickTitle} ${fill(copy.pickPool, { n: poolSize })}`;
  return (
    <div
      className="sd-pick"
      data-phase={phase}
      data-sweep={sweep ? 'true' : undefined}
      data-part="showdown-spotlight"
      data-winner={landedHere ? hotSeat : undefined}
    >
      <i className="sd-pick__veil" aria-hidden />
      <p className="sd-pick__status" role="status">
        {status}
      </p>
      <div className="sd-pick__stage" aria-hidden>
        <header className="sd-pick__head">
          <span className="sd-pick__title">{copy.pickTitle}</span>
          <span className="sd-pick__pool">
            <Numbered text={fill(copy.pickPool, { n: poolSize })} />
          </span>
        </header>
        <div className="sd-pick__area" ref={areaRef}>
          <div className="sd-pick__house">{renderSeats(false)}</div>
          <div className="sd-pick__lit" ref={litRef}>
            {renderSeats(true)}
          </div>
          <svg
            className="sd-pick__beams"
            width={size.w || 1}
            height={size.h || 1}
            viewBox={`0 0 ${size.w || 1} ${size.h || 1}`}
            aria-hidden
            focusable="false"
          >
            <defs>
              <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                <stop className="sd-pick__beam-top" offset="0" />
                <stop className="sd-pick__beam-end" offset="1" />
              </linearGradient>
            </defs>
            {LAMPS.map((_, i) => (
              <polygon
                key={i}
                ref={(node) => {
                  beamRefs.current[i] = node;
                }}
                className="sd-pick__beam"
                points=""
                fill={`url(#${gradient})`}
              />
            ))}
            {LAMPS.map((x, i) => (
              <g key={i} className="sd-pick__lamp" transform={`translate(${x * (size.w || 1)} ${-Math.max(10, size.h * 0.035)})`}>
                <rect x="-16" y="-10" width="32" height="18" rx="5" />
                <circle
                  ref={(node) => {
                    lampRefs.current[i] = node;
                  }}
                  cx="0"
                  cy="8"
                  r="6.5"
                />
              </g>
            ))}
          </svg>
          {landedHere ? (
            <div className="sd-pick__card" data-side={target[1] < 0.42 ? 'low' : target[1] > 0.58 ? 'high' : undefined}>
              <div className="sd-pick__plate">
                <span className="sd-pick__kicker">{copy.pickUp}</span>
                <b className="sd-pick__name" style={{ '--len': Math.max(6, Array.from(name).length) } as CSSProperties}>
                  {name}
                </b>
                <span className="sd-pick__ask">{copy.pickAsk}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Seat({
  seat,
  layout,
  centre,
  state,
  win,
  copy,
  areaWidth,
}: {
  seat: GridSeat;
  layout: SeatLayout;
  centre: { x: number; y: number };
  areaWidth: number;
  state: GridSeat['state'];
  win: boolean;
  copy: ShowcaseCopy;
}) {
  const word = state === 'away' ? copy.seatAway : state === 'done' ? copy.seatDone : state === 'hot' ? copy.seatHot : '';
  const style = {
    left: centre.x - layout.w / 2,
    top: centre.y - layout.h / 2,
    width: layout.w,
    height: layout.h,
    '--seat-font': `${seatFont(layout, seat.name).toFixed(1)}px`,
    '--seat-tag': `${Math.max(9, layout.h * 0.2).toFixed(1)}px`,
    '--seat-pad': `${(layout.w * 0.06).toFixed(1)}px`,
    // The winner's seat grows from its edge of the room, never past it.
    '--seat-origin': centre.x - layout.w < 0 ? 'left center' : centre.x + layout.w > areaWidth ? 'right center' : 'center',
  } as CSSProperties;
  return (
    <div className="sd-seat" data-state={state} data-win={win ? 'true' : undefined} style={style}>
      <span className="sd-seat__name">{seat.name}</span>
      {word ? <span className="sd-seat__tag">{word}</span> : null}
    </div>
  );
}

/** The spot's radius while sweeping and once landed (px): landed, it covers the whole seat. */
function spotRadius(layout: SeatLayout, size: Size): { sweep: number; land: number } {
  const land = 0.95 * Math.sqrt(layout.w * layout.w + layout.h * layout.h);
  return { sweep: Math.max(land, Math.min(size.w, size.h) * 0.2), land };
}

type Spot = { x: number; y: number; r: number } | null;

/** Puts the light where the spots are: the lit layer's mask, the beams and the lamps. */
function paint(
  lit: HTMLDivElement | null,
  beams: Array<SVGPolygonElement | null>,
  lamps: Array<SVGCircleElement | null>,
  spots: Spot[],
  size: Size,
  sweeping: boolean,
): void {
  if (lit) {
    const on = spots.filter((s): s is NonNullable<Spot> => s !== null && s.r > 0);
    const mask = on.length
      ? on
          .map(
            (s) =>
              `radial-gradient(circle ${Math.round(s.r)}px at ${Math.round(s.x)}px ${Math.round(s.y)}px, #000 0%, #000 55%, transparent 100%)`,
          )
          .join(', ')
      : 'linear-gradient(transparent, transparent)';
    lit.style.setProperty('-webkit-mask-image', mask);
    lit.style.setProperty('mask-image', mask);
  }
  const lampY = -Math.max(10, size.h * 0.035) + 8;
  LAMPS.forEach((lx, i) => {
    // Still: the landing's single spot comes from the middle lamp.
    const spot = sweeping ? (spots[i] ?? null) : i === 1 ? (spots[0] ?? null) : null;
    const beam = beams[i];
    const lamp = lamps[i];
    const x = lx * size.w;
    if (beam) {
      if (spot) {
        const half = spot.r * 0.5;
        beam.setAttribute('points', `${x - 9},${lampY} ${x + 9},${lampY} ${spot.x + half},${spot.y} ${spot.x - half},${spot.y}`);
      } else beam.setAttribute('points', '');
    }
    if (lamp) lamp.setAttribute('data-on', spot ? 'true' : 'false');
  });
}

/** The area's layout size (px, unaffected by transforms such as a scaled preview), kept current. */
function useAreaSize(ref: RefObject<HTMLDivElement | null>): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    update();
    const view = el.ownerDocument.defaultView as (Window & typeof globalThis) | null;
    const Observer = view?.ResizeObserver ?? (typeof ResizeObserver !== 'undefined' ? ResizeObserver : null);
    if (!Observer) return;
    const ro = new Observer(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
