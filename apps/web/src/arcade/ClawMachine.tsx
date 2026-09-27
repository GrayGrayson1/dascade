/**
 * The claw machine at the right end of the cabinet row — the floor's Easter egg.
 *
 * Built like the cabinets (flat SVG panels, cabinet body tokens, a side panel turned towards the
 * aisle): a lit CLAW marquee with chaser bulbs, a glass case with a gantry, the claw and a pile of
 * pixel plushies, a prize chute, a control deck and a prize door. Press it and the claw goes for a
 * toy: across, down, grab, up — and either it slips, it misses, or it carries the plush to the chute,
 * the plush pops out of the prize door and confetti flies (claw.ts has the odds and the timing).
 *
 * Cosmetic and local only (a prize count is kept in this browser). Motion runs on one
 * requestAnimationFrame loop while a try is on; reduced motion skips straight to the result and
 * visual effects set to off/low drop or thin the confetti. Sounds go through sfx()/synth.
 */
import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useApp } from '../app/store.ts';
import { sfx, synth } from '../audio/audio.ts';
import { CLAW_ART, IDLE_OPEN, RIG, TOY_SPOTS, clawPose, planClaw, type ClawOutcome, type ClawPhase, type ClawPlan, type ClawPose } from './claw.ts';
import './claw.css';

const PLUSH = ['.a..a.', 'aaaaaa', 'awaawa', 'aaaaaa', '.aaaa.'];
const PLUSH_COLORS = ['#ff4fd8', '#22d3ee', '#ffd23f', '#2de38f', '#a78bfa', '#ff8a3d'];
const CONFETTI = ['#ff4fd8', '#ffd23f', '#22d3ee', '#2de38f', '#a78bfa', '#ff8a3d', '#ffffff'];

/** One path per colour of a pixel sprite (1 unit a pixel). */
function spritePath(rows: readonly string[], ch: string): string {
  let d = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === ch) d += `M${x} ${y}h1v1h-1z`;
  });
  return d;
}
const PLUSH_BODY = spritePath(PLUSH, 'a');
const PLUSH_EYES = spritePath(PLUSH, 'w');

const toyTransform = (x: number, y: number) => `translate(${(x - 6).toFixed(2)} ${y.toFixed(2)}) scale(2)`;
const prongAngle = (open: number) => -12 + 40 * open;

interface Toy {
  id: number;
  spot: number;
  color: number;
  /** Restocked: drops into the machine. */
  fresh?: boolean;
}
let toyIds = 0;
function stock(shift: number, fresh = false): Toy[] {
  return TOY_SPOTS.map((_, spot) => ({ id: ++toyIds, spot, color: (spot * 5 + shift) % PLUSH_COLORS.length, fresh }));
}

type Display = 'idle' | 'playing' | 'won' | 'slipped' | 'missed';
const MARQUEE: Record<Display, string> = { idle: 'CLAW', playing: 'CLAW', won: 'WINNER!', slipped: 'SO CLOSE', missed: 'TRY AGAIN' };
const RESULT: Record<ClawOutcome, Display> = { win: 'won', slip: 'slipped', miss: 'missed' };
const TAG_LINE: Record<Exclude<Display, 'idle'>, string> = {
  playing: 'Good luck!',
  won: 'You won a plush!',
  slipped: 'So close — it slipped!',
  missed: 'Missed — try again',
};

const PRIZES_KEY = 'dascade:v1:claw';
function readPrizes(): number {
  try {
    const n = Number(JSON.parse(localStorage.getItem(PRIZES_KEY) ?? '{}')?.won);
    return Number.isInteger(n) && n > 0 ? Math.min(n, 99_999) : 0;
  } catch {
    return 0;
  }
}
function writePrizes(won: number): void {
  try {
    localStorage.setItem(PRIZES_KEY, JSON.stringify({ won }));
  } catch {
    /* private mode / storage off: the count just isn't kept */
  }
}

/** Motor and mechanism noises for the start of each phase. */
function phaseSound(phase: ClawPhase, plan: ClawPlan): void {
  switch (phase) {
    case 'move':
    case 'carry':
      synth.tone({ type: 'sawtooth', freq: 58, to: 63, dur: phase === 'move' ? plan.move : plan.carry, gain: 0.03 });
      break;
    case 'drop':
      synth.tone({ type: 'square', freq: 150, to: 92, dur: plan.drop * 0.9, gain: 0.018 });
      break;
    case 'grab':
      synth.tone({ type: 'square', freq: 260, to: 110, dur: 0.07, gain: 0.08 });
      break;
    case 'lift':
      synth.tone({ type: 'square', freq: 92, to: 150, dur: plan.lift * 0.9, gain: 0.018 });
      break;
    case 'back':
      if (plan.outcome === 'miss') {
        synth.tone({ type: 'triangle', freq: 330, to: 300, dur: 0.18, gain: 0.07 });
        synth.tone({ type: 'triangle', freq: 250, to: 185, start: 0.2, dur: 0.32, gain: 0.07 });
      } else synth.tone({ type: 'sawtooth', freq: 58, to: 63, dur: plan.back, gain: 0.025 });
      break;
    default:
      break;
  }
}

export const ClawMachine = memo(function ClawMachine() {
  const reduced = useApp((s) => s.settings.reducedMotion);
  const fx = useApp((s) => s.settings.fx);
  const [toys, setToys] = useState<Toy[]>(() => stock(0));
  const [display, setDisplay] = useState<Display>('idle');
  const [prize, setPrize] = useState<Toy | null>(null);
  const [burst, setBurst] = useState(0);
  const [prizes, setPrizes] = useState(readPrizes);
  const prizesRef = useRef(prizes);
  const [said, setSaid] = useState('');
  const uid = `clw${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const busy = useRef(false);
  const streak = useRef(0);
  const raf = useRef(0);
  const timers = useRef<number[]>([]);
  const toysRef = useRef(toys);
  toysRef.current = toys;
  const gantry = useRef<SVGGElement>(null);
  const cable = useRef<SVGRectElement>(null);
  const head = useRef<SVGGElement>(null);
  const prongL = useRef<SVGGElement>(null);
  const prongR = useRef<SVGGElement>(null);
  const toyEls = useRef(new Map<number, SVGGElement>());

  const later = useCallback((ms: number, fn: () => void) => {
    const t = window.setTimeout(() => {
      timers.current = timers.current.filter((x) => x !== t);
      fn();
    }, ms);
    timers.current.push(t);
  }, []);
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      for (const t of timers.current) window.clearTimeout(t);
    },
    [],
  );

  /** Writes a pose straight onto the rig (no React render per frame). Null parks everything. */
  const apply = useCallback((pose: ClawPose | null, target: Toy | null) => {
    const x = pose?.x ?? RIG.homeX;
    const drop = pose?.drop ?? 0;
    const a = prongAngle(pose?.open ?? IDLE_OPEN);
    gantry.current?.setAttribute('transform', `translate(${x.toFixed(2)} 0)`);
    cable.current?.setAttribute('height', (RIG.hubY - 44 + drop).toFixed(2));
    head.current?.setAttribute('transform', `translate(${x.toFixed(2)} ${(RIG.hubY + drop).toFixed(2)})`);
    prongL.current?.setAttribute('transform', `rotate(${a.toFixed(1)} -3 3)`);
    prongR.current?.setAttribute('transform', `rotate(${(-a).toFixed(1)} 3 3)`);
    if (!target) return;
    const el = toyEls.current.get(target.id);
    if (!el) return;
    const toy = pose?.toy ?? null;
    if (toy === 'gone') {
      el.setAttribute('visibility', 'hidden');
      return;
    }
    const spot = TOY_SPOTS[target.spot]!;
    el.removeAttribute('visibility');
    el.setAttribute('transform', toyTransform(toy?.x ?? spot.x, toy?.y ?? spot.y));
  }, []);

  const celebrate = useCallback(
    (target: Toy) => {
      sfx('pop');
      setToys((list) => list.filter((t) => t.id !== target.id));
      setPrize(target);
      setDisplay('won');
      if (!useApp.getState().settings.reducedMotion && useApp.getState().settings.fx !== 'off') setBurst((n) => n + 1);
      later(160, () => sfx('win'));
      later(5200, () => setPrize((p) => (p?.id === target.id ? null : p)));
    },
    [later],
  );

  const finish = useCallback(
    (plan: ClawPlan, target: Toy) => {
      busy.current = false;
      apply(null, plan.outcome === 'win' ? null : target);
      if (plan.outcome === 'win') {
        streak.current = 0;
        const won = prizesRef.current + 1;
        prizesRef.current = won;
        writePrizes(won);
        setPrizes(won);
        setSaid(`You won a plush! Prizes won: ${won}.`);
        // Nearly cleaned out: the attendant restocks the machine.
        if (toysRef.current.filter((t) => t.id !== target.id).length < 4) later(1200, () => setToys(stock(toyIds % PLUSH_COLORS.length, true)));
      } else {
        streak.current += 1;
        setDisplay(RESULT[plan.outcome]);
        setSaid(plan.outcome === 'slip' ? 'So close — the plush slipped out of the claw.' : 'Missed! The claw came up empty.');
      }
      later(plan.outcome === 'win' ? 2600 : 1800, () => {
        if (!busy.current) setDisplay('idle');
      });
    },
    [apply, later],
  );

  const play = useCallback(() => {
    if (busy.current) return;
    const current = toysRef.current;
    const plan = planClaw(
      current.map((t) => t.spot),
      streak.current,
      Math.random,
    );
    const target = plan ? current.find((t) => t.spot === plan.toy) : undefined;
    if (!plan || !target) return;
    busy.current = true;
    sfx('coin');
    setDisplay('playing');
    setSaid('');
    if (useApp.getState().settings.reducedMotion) {
      // No motion: straight to the result.
      if (plan.outcome === 'win') celebrate(target);
      finish(plan, target);
      return;
    }
    const t0 = performance.now();
    let phase: ClawPhase | null = null;
    let slipped = false;
    let landed = false;
    const slipAt = plan.move + plan.drop + plan.grab + plan.lift * plan.slipAt;
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      const pose = clawPose(plan, t);
      if (pose.phase !== phase) {
        phase = pose.phase;
        phaseSound(phase, plan);
      }
      if (plan.outcome === 'slip' && !slipped && t >= slipAt) {
        slipped = true;
        synth.tone({ type: 'triangle', freq: 520, to: 150, dur: 0.32, gain: 0.09 });
      }
      apply(pose, target);
      if (plan.outcome === 'win' && !landed && t >= plan.prizeAt) {
        landed = true;
        celebrate(target);
      }
      if (pose.phase === 'done') {
        raf.current = 0;
        finish(plan, target);
        return;
      }
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
  }, [apply, celebrate, finish]);

  const confetti = reduced || fx === 'off' ? 0 : fx === 'low' ? 40 : 110;
  const label = `Claw machine — try your luck${prizes ? ` (${prizes} prize${prizes === 1 ? '' : 's'} won)` : ''}`;
  const word = MARQUEE[display];
  const id = (k: string) => `${uid}-${k}`;
  const url = (k: string) => `url(#${id(k)})`;

  return (
    <>
      <button type="button" className="clw" data-part="claw-machine" data-state={display} aria-label={label} onClick={play}>
        <span className="clw__machine">
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

            {/* inside the glass: the pile, the rig, the chute */}
            <g clipPath={url('glass')}>
              <rect x="24" y="104" width="30" height="44" fill="#fff" opacity=".04" />
              {toys.map((t) => {
                const spot = TOY_SPOTS[t.spot]!;
                return (
                  <g
                    key={t.id}
                    ref={(el) => {
                      if (el) toyEls.current.set(t.id, el);
                      else toyEls.current.delete(t.id);
                    }}
                    className="clw-toy"
                    data-fresh={t.fresh ? 'true' : undefined}
                    style={t.fresh ? { ['--d' as string]: t.spot } : undefined}
                    transform={toyTransform(spot.x, spot.y)}
                  >
                    <path d={PLUSH_BODY} fill={PLUSH_COLORS[t.color]} />
                    <path d={PLUSH_EYES} fill="#fff" />
                    <rect x="1" y="4" width="4" height="1" fill="#000" opacity=".22" />
                  </g>
                );
              })}
              <g ref={gantry} transform={`translate(${RIG.homeX} 0)`}>
                <rect x="-7" y="38.4" width="14" height="5.6" rx="1" fill="#c9c3e6" />
                <rect x="-4" y="40" width="8" height="1.4" fill="#6f6a8e" />
                <rect ref={cable} x="-0.6" y="44" width="1.2" height={RIG.hubY - 44} fill="#8f88b3" />
              </g>
              <g ref={head} transform={`translate(${RIG.homeX} ${RIG.hubY})`}>
                <path d="M0 4V12.5" stroke="#8f88b3" strokeWidth="1.3" strokeLinecap="round" />
                <g ref={prongL} transform={`rotate(${prongAngle(IDLE_OPEN)} -3 3)`}>
                  <path d="M-3 3L-8 9.5L-5.6 14" fill="none" stroke="#d7d2ec" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </g>
                <g ref={prongR} transform={`rotate(${-prongAngle(IDLE_OPEN)} 3 3)`}>
                  <path d="M3 3L8 9.5L5.6 14" fill="none" stroke="#d7d2ec" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </g>
                <rect x="-5" y="0" width="10" height="4.4" rx="1.2" fill="#c9c3e6" />
                <rect x="-5" y="2.6" width="10" height="1" fill="#6f6a8e" />
              </g>
              {/* the chute's clear front, then reflections on the glass */}
              <rect x="24" y="104" width="30" height="44" fill="#bfe9ff" opacity=".08" stroke="#c9c3e6" strokeOpacity=".55" strokeWidth=".8" />
              <rect x="23" y="102.6" width="32" height="2.4" rx=".6" fill="#c9c3e6" />
              <path d="M22 122L72 36H86L22 146Z" fill="#fff" opacity=".045" />
              <rect x="129" y="40" width="2" height="104" fill="#fff" opacity=".05" />
            </g>

            {/* prize door: the win pops out here */}
            <g clipPath={url('door')}>
              {prize ? (
                <g className="clw-prize" transform="translate(40 200) scale(2)">
                  <path d={PLUSH_BODY} fill={PLUSH_COLORS[prize.color]} />
                  <path d={PLUSH_EYES} fill="#fff" />
                </g>
              ) : null}
              <rect className="clw-flap" data-open={prize ? 'true' : undefined} x="30.5" y="190.5" width="31" height="23" rx="1.4" fill={url('metal')} />
            </g>
          </svg>
        </span>
        <span className="clw__tag" aria-hidden>
          <span className="clw__name">Claw machine</span>
          <span className="clw__line">{display === 'idle' ? (prizes ? `Prizes won: ${prizes}` : 'Press to play') : TAG_LINE[display]}</span>
        </span>
      </button>
      {burst && confetti ? <Confetti key={burst} amount={confetti} /> : null}
      <span className="visually-hidden" role="status" aria-live="polite">
        {said}
      </span>
    </>
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

/** A burst of pixel confetti from the marquee, raining down over the floor; unmounts itself when done. */
function Confetti({ amount }: { amount: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The canvas spans the machine plus the floor to its left and the air above (.clw-confetti): the
    // confetti bursts out of the marquee.
    const cr = c.getBoundingClientRect();
    const mr = c.parentElement?.querySelector('.clw__machine')?.getBoundingClientRect();
    const ox = mr ? mr.left + mr.width / 2 - cr.left : w * 0.8;
    const oy = mr ? mr.top + mr.height * 0.06 - cr.top : h * 0.45;
    const spread = mr ? mr.width * 0.7 : w * 0.2;
    const size = Math.max(3.5, Math.min(8, (mr?.width ?? w / 2.7) / 24));
    const parts = Array.from({ length: amount }, () => ({
      x: ox + (Math.random() - 0.5) * spread,
      y: oy + Math.random() * 6,
      vx: -Math.random() * 7 + 1.8,
      vy: -(3.5 + Math.random() * 6),
      s: size * (0.7 + Math.random() * 0.6),
      c: CONFETTI[Math.floor(Math.random() * CONFETTI.length)]!,
      r: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 0.5,
    }));
    const start = performance.now();
    let last = start;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(2.5, (now - last) / 16.67);
      last = now;
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      for (const p of parts) {
        p.vy += 0.17 * k;
        p.vx *= 1 - 0.012 * k;
        p.x += p.vx * k;
        p.y += p.vy * k;
        p.r += p.vr * k;
        if (p.y > h + 8) continue;
        alive++;
        const flip = Math.abs(Math.cos(p.r));
        ctx.fillStyle = p.c;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.round(p.s), Math.max(1, Math.round(p.s * 0.65 * flip)));
      }
      if (alive > 0 && now - start < 4000) raf = requestAnimationFrame(tick);
      else setDone(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [amount]);
  return done ? null : <canvas ref={ref} className="clw-confetti" aria-hidden />;
}
