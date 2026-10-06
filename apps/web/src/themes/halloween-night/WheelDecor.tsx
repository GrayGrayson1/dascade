/**
 * Halloween Night's Wheel of DAStiny decor (ThemeSkin.wheel.Decor), inside the stage wheel:
 *   - always: two jack-o'-lanterns at the wheel's feet (they hop when it lands); after dark a friendly
 *     ghost peeks over the rim and ducks while it spins;
 *   - while it spins: the stage dims and ghostly wisps chase the rim, longer the faster it turns (with
 *     a spray of embers at FULL effects);
 *   - when it lands, a reaction picked from the winning slice (wheelReactions.ts): candy rain, a witch's
 *     brew, the ghost waving, a black cat's claw marks, a dancing skeleton, "BOO!", a shrink spell, a
 *     werewolf, a bat swarm or the crowned Pumpkin Jackpot — with a caption for its sound.
 * Presentation only, and the same on every screen (it follows the server's spin plan and landing).
 * Effects OFF or reduced motion: no motion at all — the lanterns and the caption only.
 */
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { celebrationSpriteCanvas } from '../celebration.ts';
import type { WheelDecorContext } from '../wheelSkin.ts';
import { useDocVisible } from './art.ts';
import { CANDY_CORN, LOLLIPOP, MINI_PUMPKIN, WRAPPED_CANDY } from './celebration.ts';
import { useHauntLevel } from './haunt.ts';
import { Bat, Cat, ClawMarks, JackpotPumpkin, Lantern, Monster, Skeleton, Sparkles } from './wheelArt.tsx';
import { REACTIONS, reactionFor, type WheelReaction } from './wheelReactions.ts';

const DEG = Math.PI / 180;
const RAIN_SPRITES = [CANDY_CORN, WRAPPED_CANDY, LOLLIPOP, MINI_PUMPKIN];

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  size: number;
  color: string;
}

interface Candy {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  cell: number;
  sprite: HTMLCanvasElement;
}

/** Wisps around the rim + candy rain: one canvas, one rAF loop that only runs while there's motion. */
function useHauntCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  live: { phase: WheelDecorContext['phase']; sample: WheelDecorContext['sample']; fx: WheelDecorContext['fx']; motion: boolean },
  rain: { key: string; amount: number } | null,
) {
  const liveRef = useRef(live);
  liveRef.current = live;
  const st = useRef({ raf: 0, last: 0, w: 0, h: 0, dpr: 1, embers: [] as Ember[], candies: [] as Candy[], wisp: 0, seed: 1 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const s = st.current;
    // Layout size (unaffected by the stage's push-in transform).
    const measure = () => {
      s.dpr = Math.min(2, window.devicePixelRatio || 1);
      s.w = canvas.clientWidth;
      s.h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(s.w * s.dpr));
      canvas.height = Math.max(1, Math.round(s.h * s.dpr));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(s.raf);
      s.raf = 0;
    };
  }, [canvasRef]);

  const rand = () => {
    // Decoration only (xorshift), so the shared UI random stream is untouched.
    const s = st.current;
    s.seed ^= s.seed << 13;
    s.seed ^= s.seed >>> 17;
    s.seed ^= s.seed << 5;
    return ((s.seed >>> 0) % 10_000) / 10_000;
  };

  const frame = (t: number) => {
    const s = st.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const wheel = canvas?.closest<HTMLElement>('.wh-wheel');
    if (!canvas || !ctx || !wheel || s.w <= 0) {
      s.raf = 0;
      return;
    }
    const dt = Math.min(0.05, (t - s.last) / 1000 || 0.016);
    s.last = t;
    const { phase, sample, fx, motion } = liveRef.current;
    // Wheel geometry in canvas px: the canvas overhangs the wheel box (.hn-wd covers it exactly).
    const cx = wheel.offsetWidth / 2 - canvas.offsetLeft;
    const cy = (parseFloat(wheel.style.getPropertyValue('--wh-cy')) || wheel.offsetHeight * 0.515) - canvas.offsetTop;
    const rw = parseFloat(wheel.style.getPropertyValue('--wh-rw')) || wheel.offsetWidth * 0.47;

    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.clearRect(0, 0, s.w, s.h);

    // Wisps: fixed points on the face, trailing an arc as long as the wheel is fast.
    const spinning = phase === 'spinning' && motion;
    const { rotation, speed } = spinning ? sample() : { rotation: 0, speed: 0 };
    s.wisp = spinning ? Math.min(1, s.wisp + dt * 3) : Math.max(0, s.wisp - dt * 2.5);
    const alpha = s.wisp * Math.min(1, speed * 5);
    if (alpha > 0.01) {
      const n = fx === 'high' ? 3 : 2;
      const R = rw * 1.045;
      const len = 30 + 150 * speed;
      const width = Math.max(2.5, rw * 0.06);
      const SEGS = 14;
      for (let i = 0; i < n; i++) {
        const head = rotation + (i * 360) / n;
        for (let j = 0; j < SEGS; j++) {
          const k = 1 - j / SEGS;
          ctx.beginPath();
          ctx.arc(cx, cy, R, (head - (len * (j + 1)) / SEGS - 90) * DEG, (head - (len * j) / SEGS - 90) * DEG);
          ctx.lineWidth = width * (0.25 + 0.75 * k);
          ctx.lineCap = 'round';
          ctx.strokeStyle = `rgba(214, 196, 255, ${(0.72 * k * alpha).toFixed(3)})`;
          ctx.stroke();
        }
        const hx = cx + Math.sin(head * DEG) * R;
        const hy = cy - Math.cos(head * DEG) * R;
        ctx.beginPath();
        ctx.arc(hx, hy, width * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(248, 244, 255, ${(0.75 * alpha).toFixed(3)})`;
        ctx.fill();
        // Embers fly off the heads (FULL effects).
        if (fx === 'high' && rand() < speed * 0.9) {
          const tx = Math.cos(head * DEG);
          const ty = Math.sin(head * DEG);
          s.embers.push({
            x: hx,
            y: hy,
            vx: tx * 140 * speed + Math.sin(head * DEG) * 40 + (rand() - 0.5) * 30,
            vy: ty * 140 * speed - Math.cos(head * DEG) * 40 + (rand() - 0.5) * 30,
            life: 0,
            ttl: 0.4 + rand() * 0.4,
            size: 1.5 + rand() * 2,
            color: rand() < 0.75 ? '#ff8a3d' : '#ffc93c',
          });
        }
      }
    }

    // Embers.
    s.embers = s.embers.filter((e) => (e.life += dt) < e.ttl);
    for (const e of s.embers) {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.vy += 60 * dt;
      ctx.globalAlpha = 1 - e.life / e.ttl;
      ctx.fillStyle = e.color;
      ctx.fillRect(e.x - e.size / 2, e.y - e.size / 2, e.size, e.size);
    }
    ctx.globalAlpha = 1;

    // Candy rain.
    ctx.imageSmoothingEnabled = false;
    s.candies = s.candies.filter((c) => c.y < s.h + 40);
    for (const c of s.candies) {
      c.vy += 520 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
      const w = c.sprite.width * c.cell;
      const h = c.sprite.height * c.cell;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(Math.sin(c.rot) * 0.5);
      ctx.drawImage(c.sprite, -w / 2, -h / 2, w, h);
      ctx.restore();
    }

    if (spinning || s.wisp > 0 || s.embers.length || s.candies.length) s.raf = requestAnimationFrame(frame);
    else {
      s.raf = 0;
      ctx.clearRect(0, 0, s.w, s.h);
    }
  };

  const kick = () => {
    const s = st.current;
    if (s.raf) return;
    s.last = performance.now();
    s.raf = requestAnimationFrame(frame);
  };

  useEffect(() => {
    if (live.phase === 'spinning' && live.motion) kick();
  });

  const rainKey = rain?.key ?? null;
  const rainAmount = rain?.amount ?? 0;
  useEffect(() => {
    if (!rainKey || !liveRef.current.motion) return;
    const s = st.current;
    const sprites = RAIN_SPRITES.map(celebrationSpriteCanvas).filter((c): c is HTMLCanvasElement => c !== null);
    if (!sprites.length || s.w <= 0) return;
    s.seed = (s.seed + rainKey.length * 7919) | 1;
    const count = Math.round((liveRef.current.fx === 'high' ? 34 : 14) * rainAmount);
    const cell = Math.max(2, Math.round(s.w / 150));
    for (let i = 0; i < count; i++) {
      s.candies.push({
        x: rand() * s.w,
        y: -rand() * s.h * 0.5 - 20,
        vx: (rand() - 0.5) * 60,
        vy: 60 + rand() * 140,
        rot: rand() * Math.PI * 2,
        vr: 2 + rand() * 5,
        cell: cell + (rand() < 0.3 ? 1 : 0),
        sprite: sprites[i % sprites.length]!,
      });
    }
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rainKey, rainAmount]);
}

export function HalloweenWheelDecor({ fx, reducedMotion, phase, sample, landing }: WheelDecorContext) {
  const visible = useDocVisible();
  const haunt = useHauntLevel();
  const motion = fx !== 'off' && !reducedMotion;
  const animate = fx === 'high' && !reducedMotion && visible;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The reaction for this landing, for its run time (ends early if the result card closes).
  const landingKey = landing?.key ?? null;
  const landingKind = landing ? reactionFor(landing) : null;
  const [react, setReact] = useState<{ key: string; kind: WheelReaction } | null>(null);
  useEffect(() => {
    if (!landingKey || !landingKind) {
      setReact(null);
      return;
    }
    setReact({ key: landingKey, kind: landingKind });
    const t = setTimeout(() => setReact((r) => (r?.key === landingKey ? null : r)), REACTIONS[landingKind].ms);
    return () => clearTimeout(t);
  }, [landingKey, landingKind]);

  const kind = react?.kind;
  const show = motion ? react : null;
  const rain =
    react && (react.kind === 'candy' || react.kind === 'jackpot') ? { key: react.key, amount: react.kind === 'jackpot' ? 1.6 : 1 } : null;
  useHauntCanvas(canvasRef, { phase, sample, fx, motion }, rain);

  return (
    <div
      className="hn-wd"
      data-phase={phase}
      data-fx={fx}
      data-haunt={haunt}
      data-motion={motion ? 'true' : undefined}
      data-animate={animate ? 'true' : undefined}
      data-landed={landing ? 'true' : undefined}
      data-react={kind}
    >
      {/* Behind the wheel (z-index -1 in skin.css). */}
      <i className="hn-wd__dim" />
      <i className="hn-wd__peek" />
      {show?.kind === 'cat' ? <Cat key={show.key} className="hn-wd__cat" /> : null}
      {show?.kind === 'monster' ? <Monster key={show.key} className="hn-wd__monster" /> : null}

      {/* Beside and over the wheel. */}
      <Lantern className="hn-wd__lantern hn-wd__lantern--l" />
      <Lantern className="hn-wd__lantern hn-wd__lantern--r" flip />
      <canvas className="hn-wd__fx" ref={canvasRef} />
      {show ? (
        <div className="hn-wd__show" key={show.key}>
          {kind === 'brew' ? (
            <>
              <i className="hn-wd__wash" />
              <span className="hn-wd__bubbles">
                {Array.from({ length: 8 }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
            </>
          ) : null}
          {kind === 'cat' ? <ClawMarks className="hn-wd__claws" /> : null}
          {kind === 'skeleton' ? <Skeleton className="hn-wd__skeleton" /> : null}
          {kind === 'boo' ? <b className="hn-wd__boo">BOO!</b> : null}
          {kind === 'shrink' ? <Sparkles className="hn-wd__poof" /> : null}
          {kind === 'bats' ? (
            <span className="hn-wd__bats">
              {Array.from({ length: 6 }, (_, i) => (
                <Bat key={i} className="hn-wd__bat" />
              ))}
            </span>
          ) : null}
          {kind === 'jackpot' ? <JackpotPumpkin className="hn-wd__jackpot" /> : null}
        </div>
      ) : null}
      {react ? (
        <p className="hn-wd__cc" key={`cc-${react.key}`} style={{ '--hn-cc-ms': `${REACTIONS[react.kind].ms}ms` } as CSSProperties}>
          {REACTIONS[react.kind].caption}
        </p>
      ) : null}
    </div>
  );
}
