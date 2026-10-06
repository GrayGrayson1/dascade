/**
 * Halloween Night's Wheel of DAStiny cast (original SVG): the jack-o'-lanterns at the wheel's feet, a
 * black cat and its claw marks, a dancing skeleton (two frames), a friendly werewolf, bats and the
 * crowned Pumpkin Jackpot. Colours live here; motion lives in skin.css (`hn-wd-*`).
 */
import { BAT_PATH } from './art.ts';
import { Pumpkin } from './FloorDecor.tsx';

const svg = { 'aria-hidden': true, focusable: false } as const;

/** A jack-o'-lantern at the wheel's feet (faces glow through .hn-face). */
export function Lantern({ className, flip = false }: { className: string; flip?: boolean }) {
  return (
    <svg className={className} viewBox="-30 -32 60 56" {...svg}>
      <ellipse cx="0" cy="20" rx="24" ry="4" fill="rgba(4, 1, 8, 0.45)" />
      <g transform={flip ? 'scale(-1 1)' : undefined}>
        <Pumpkin x={0} y={0} s={1} tilt={-4} />
      </g>
    </svg>
  );
}

/** The Pumpkin Jackpot: a big grinning jack-o'-lantern wearing a crown. */
export function JackpotPumpkin({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="-40 -52 80 80" {...svg}>
      <Pumpkin x={0} y={0} s={1.3} />
      <path
        d="M-15 -30L-11 -45L-4 -35L0 -50L4 -35L11 -45L15 -30Z"
        fill="#ffd23f"
        stroke="#8a5a00"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M-15 -30H15" stroke="#8a5a00" strokeWidth="2.4" />
      <circle cx="0" cy="-37" r="2.4" fill="#ff4f81" />
      <circle cx="-8" cy="-34" r="1.7" fill="#7df04a" />
      <circle cx="8" cy="-34" r="1.7" fill="#7aa2ff" />
    </svg>
  );
}

/** A black cat sitting up, big slime-yellow eyes, tail curled (peeks from behind the wheel). */
export function Cat({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 80 74" {...svg}>
      <g fill="#1a0f24" stroke="#5a3a7a" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M58 64C74 64 78 46 69 40" fill="none" stroke="#1a0f24" strokeWidth="7" strokeLinecap="round" />
        <ellipse cx="40" cy="54" rx="21" ry="17" />
        <path d="M23 24L25 5L37 17ZM57 24L55 5L43 17Z" />
        <circle cx="40" cy="31" r="18" />
      </g>
      <path d="M27 19L28 10L33 15ZM53 19L52 10L47 15Z" fill="#ff8fb8" />
      <ellipse cx="32.5" cy="30" rx="5" ry="6" fill="#c8f04a" />
      <ellipse cx="47.5" cy="30" rx="5" ry="6" fill="#c8f04a" />
      <ellipse cx="32.5" cy="30.5" rx="1.7" ry="4.6" fill="#120a18" />
      <ellipse cx="47.5" cy="30.5" rx="1.7" ry="4.6" fill="#120a18" />
      <circle cx="34" cy="27.5" r="1.3" fill="#fff" />
      <circle cx="49" cy="27.5" r="1.3" fill="#fff" />
      <path d="M38 37h4l-2 2.4z" fill="#ff8fb8" />
      <g fill="none" stroke="#8a6aa8" strokeWidth="1.1" strokeLinecap="round">
        <path d="M36 41q2 2 4 0q2 2 4 0" />
        <path d="M30 38L18 36M30 40.5L19 42M50 38L62 36M50 40.5L61 42" />
      </g>
      <ellipse cx="32" cy="70" rx="6" ry="3.6" fill="#1a0f24" stroke="#5a3a7a" strokeWidth="1.2" />
      <ellipse cx="48" cy="70" rx="6" ry="3.6" fill="#1a0f24" stroke="#5a3a7a" strokeWidth="1.2" />
    </svg>
  );
}

/** Three claw scratches (each path draws itself in, see skin.css). */
export function ClawMarks({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" {...svg}>
      <g fill="none" strokeLinecap="round">
        {['M22 8Q40 50 30 94', 'M46 4Q62 48 55 92', 'M70 9Q84 45 77 87'].map((d) => (
          <g key={d}>
            <path d={d} stroke="#2a0a3a" strokeWidth="9" pathLength={100} />
            <path d={d} stroke="#e6daf7" strokeWidth="4.5" pathLength={100} />
          </g>
        ))}
      </g>
    </svg>
  );
}

const BONE = '#f8f4ff';
const BONE_EDGE = '#2a0a3a';

function SkeletonFrame({ arms, legs, className }: { arms: string; legs: string; className: string }) {
  return (
    <g className={className}>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={`${arms}${legs}M30 34V58`} stroke={BONE_EDGE} strokeWidth="6" />
        <path d={`${arms}${legs}M30 34V58`} stroke={BONE} strokeWidth="3.2" />
        <path d="M22 40q8-4 16 0M23 45q7-3.5 14 0M24 50q6-3 12 0" stroke={BONE_EDGE} strokeWidth="5" />
        <path d="M22 40q8-4 16 0M23 45q7-3.5 14 0M24 50q6-3 12 0" stroke={BONE} strokeWidth="2.6" />
      </g>
      <ellipse cx="30" cy="60" rx="7.5" ry="4.2" fill={BONE} stroke={BONE_EDGE} strokeWidth="1.6" />
    </g>
  );
}

/** A little skeleton mid-dance: frame A arms up, frame B arms out (CSS swaps them). */
export function Skeleton({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 60 82" {...svg}>
      <SkeletonFrame className="hn-wd__sk-a" arms="M23 40L13 30L9 20M37 40L47 30L51 20" legs="M26 63L20 74L15 78M34 63L40 74L45 78" />
      <SkeletonFrame className="hn-wd__sk-b" arms="M23 40L11 45L6 39M37 40L49 45L55 51" legs="M26 63L24 76L18 79M34 63L42 72L49 70" />
      <path d="M17 18a13 13 0 0 1 26 0v5q0 5-5 6v4h-16v-4q-5-1-5-6z" fill={BONE} stroke={BONE_EDGE} strokeWidth="1.8" />
      <ellipse cx="24.5" cy="18" rx="4" ry="4.8" fill="#2a0a3a" />
      <ellipse cx="35.5" cy="18" rx="4" ry="4.8" fill="#2a0a3a" />
      <path d="M30 22.5l-2 3.4h4z" fill="#2a0a3a" />
      <path d="M24 29.5v3.4M28 29.5v3.4M32 29.5v3.4M36 29.5v3.4" stroke="#2a0a3a" strokeWidth="1.2" />
      <circle cx="26" cy="16.6" r="1.1" fill="#ff8a3d" />
      <circle cx="37" cy="16.6" r="1.1" fill="#ff8a3d" />
    </svg>
  );
}

/** A friendly werewolf popping up mid-roar. */
export function Monster({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 90 80" {...svg}>
      <path d="M19 33L21 5L38 22ZM71 33L69 5L52 22Z" fill="#6b5a7a" stroke="#2a0a3a" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M24 26L25 13L33 21ZM66 26L65 13L57 21Z" fill="#3a2a4a" />
      <path
        d="M45 18C64 18 76 30 76 46q4 2 2 6q-4 0-5-1Q70 66 45 74Q20 66 17 51q-1 1-5 1q-2-4 2-6C14 30 26 18 45 18Z"
        fill="#6b5a7a"
        stroke="#2a0a3a"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <ellipse cx="45" cy="57" rx="15" ry="11" fill="#c9b8d6" />
      <path d="M36 61q9 12 18 0z" fill="#4a0a2a" />
      <path d="M38.5 61.5l2 4 2-4zM47.5 61.5l2 4 2-4z" fill="#fff" />
      <ellipse cx="45" cy="51" rx="5.5" ry="3.8" fill="#2a0a3a" />
      <circle cx="33" cy="41" r="6.4" fill="#ffc93c" stroke="#2a0a3a" strokeWidth="1.4" />
      <circle cx="57" cy="41" r="6.4" fill="#ffc93c" stroke="#2a0a3a" strokeWidth="1.4" />
      <circle cx="34" cy="42" r="2.7" fill="#2a0a3a" />
      <circle cx="56" cy="42" r="2.7" fill="#2a0a3a" />
      <circle cx="35" cy="40.6" r="1" fill="#fff" />
      <circle cx="57" cy="40.6" r="1" fill="#fff" />
      <path d="M26 32l9 3M64 32l-9 3" stroke="#2a0a3a" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** One flapping bat (wings beat through CSS on the inner group). */
export function Bat({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="-16 -8 32 16" {...svg}>
      <g className="hn-wd__wings">
        <path d={BAT_PATH} fill="#2c1240" stroke="#7b3fc4" strokeWidth="0.8" />
      </g>
      <circle cx="-1.6" cy="-1" r="0.8" fill="#ffc93c" />
      <circle cx="1.6" cy="-1" r="0.8" fill="#ffc93c" />
    </svg>
  );
}

/** A handful of four-point sparkles (the shrink spell's poof). */
export function Sparkles({ className }: { className: string }) {
  const star = (x: number, y: number, r: number) =>
    `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`;
  return (
    <svg className={className} viewBox="0 0 100 100" {...svg}>
      {[
        [20, 30, 9, '#ffc93c'],
        [78, 22, 7, '#b57bff'],
        [50, 12, 6, '#f4f0ff'],
        [84, 70, 8, '#7ed957'],
        [16, 76, 6, '#ff8a3d'],
        [52, 88, 7, '#ffc93c'],
      ].map(([x, y, r, fill]) => (
        <path key={`${x}-${y}`} d={star(x as number, y as number, r as number)} fill={fill as string} />
      ))}
    </svg>
  );
}
