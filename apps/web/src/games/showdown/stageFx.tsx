/**
 * Stage effects shared by both formats: themed confetti (pumpkins, candy corn, wrapped sweets and
 * paper in Halloween Night; stars, streamers and paper in DAS Showtime), a burst of bats, and the
 * celebration's sweeping light beams. All decorative (aria-hidden, pointer-events none), CSS-only
 * motion; the stage only mounts them when motion is on (reduced motion / effects off: none).
 *
 * Positions come from the piece's index (no randomness), so every screen rains the same way.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { ShowdownLook } from '@dascade/shared/games/showdown';
import { LOOK_COPY } from './look.ts';
import { REACTION_LIFE, type ShowFeed } from './fx.ts';
import type { MotionPrefs } from './state.ts';

/** True for `ms` after `at` (performance.now() time), then false — re-renders itself when it expires. */
export function useRecent(at: number | undefined, ms: number): boolean {
  const [, force] = useState(0);
  const live = at !== undefined && at > 0 && performance.now() - at < ms;
  useEffect(() => {
    if (!live || at === undefined) return;
    const t = setTimeout(() => force((n) => n + 1), Math.max(0, ms - (performance.now() - at)) + 16);
    return () => clearTimeout(t);
  }, [live, at, ms]);
  return live;
}

/** The audience's cheers floating up the stage (team side, or the middle). */
export function Reactions({ feed, look, motion }: { feed: ShowFeed; look: ShowdownLook; motion: MotionPrefs }) {
  const [, force] = useState(0);
  const now = performance.now();
  const alive = motion.motion ? feed.reactions.filter((r) => now - r.at < REACTION_LIFE) : [];
  // Expire floating emoji even when nothing new arrives.
  const next = alive.length ? Math.min(...alive.map((r) => r.at + REACTION_LIFE - now)) : 0;
  useEffect(() => {
    if (next <= 0) return;
    const t = setTimeout(() => force((n) => n + 1), next + 20);
    return () => clearTimeout(t);
  }, [next, feed.reactions]);
  if (!alive.length) return null;
  const emoji = LOOK_COPY[look].reactions;
  return (
    <div className="sd-reactions" aria-hidden>
      {alive.map((r) => (
        <span
          key={r.id}
          className="sd-float"
          data-side={r.side === 0 ? 'left' : r.side === 1 ? 'right' : 'mid'}
          style={{ '--x': r.x, '--delay': `${Math.max(0, r.at - now)}ms` } as CSSProperties}
        >
          {emoji[r.kind] ?? '👏'}
        </span>
      ))}
    </div>
  );
}

const HALLOWEEN_COLORS = ['#ff8a1f', '#b26bff', '#a8ff3c', '#fff1d6', '#ffd36b'];
const SHOWTIME_COLORS = ['#ffd36b', '#ff4fd8', '#22d3ee', '#2de38f', '#ffffff'];

type Shape = 'chip' | 'dot' | 'pumpkin' | 'corn' | 'candy' | 'star' | 'ribbon';

const HALLOWEEN_SHAPES: readonly Shape[] = ['pumpkin', 'chip', 'corn', 'candy', 'chip', 'pumpkin', 'dot', 'corn', 'candy', 'chip'];
const SHOWTIME_SHAPES: readonly Shape[] = ['star', 'chip', 'ribbon', 'dot', 'star', 'chip', 'ribbon', 'star', 'dot', 'chip'];

function ShapeArt({ shape, color }: { shape: Shape; color: string }): ReactNode {
  switch (shape) {
    case 'pumpkin':
      return (
        <svg viewBox="0 0 24 22" focusable="false">
          <path d="M12 4 C11.5 1.5 13 0.5 14.5 1 C13.6 2.3 13.5 3 13.3 4.4" fill="#3f7a2a" />
          <ellipse cx="7.5" cy="13" rx="6" ry="8" fill="#e8650f" />
          <ellipse cx="16.5" cy="13" rx="6" ry="8" fill="#e8650f" />
          <ellipse cx="12" cy="13" rx="6.2" ry="8.6" fill="#ff8a24" />
          <path d="M7.4 11.4 l2.6 -2.4 l0.9 3.2 z M16.6 11.4 l-2.6 -2.4 l-0.9 3.2 z M7 15.6 Q12 19.6 17 15.6 L15 16.6 L13.5 15.6 L12 17 L10.5 15.6 L9 16.6 Z" fill="#ffe08a" />
        </svg>
      );
    case 'corn':
      return (
        <svg viewBox="0 0 20 22" focusable="false">
          <path d="M10 21 L1.5 3.5 Q10 -0.5 18.5 3.5 Z" fill="#fff4dc" />
          <path d="M10 21 L4.6 9.8 Q10 7.4 15.4 9.8 Z" fill="#ff9a1f" />
          <path d="M10 21 L7.4 15.4 Q10 14.4 12.6 15.4 Z" fill="#ffd23c" />
        </svg>
      );
    case 'candy':
      return (
        <svg viewBox="0 0 30 16" focusable="false">
          <path d="M8 8 L1 2 L1 14 Z M22 8 L29 2 L29 14 Z" fill={color} opacity="0.85" />
          <ellipse cx="15" cy="8" rx="8" ry="6.5" fill={color} />
          <path d="M10 4.5 Q15 8 11 12 M15 2 Q20 8 15 14" fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1.6" />
        </svg>
      );
    case 'star':
      return (
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M12 1.5 l3 6.6 7.2 0.8 -5.4 4.9 1.5 7.1 -6.3 -3.7 -6.3 3.7 1.5 -7.1 -5.4 -4.9 7.2 -0.8 z" fill={color} />
        </svg>
      );
    default:
      return null;
  }
}

/** Falling confetti. `big` = the crescendo (more pieces, larger, longer). */
export function Confetti({ count, look, big = false }: { count: number; look: ShowdownLook; big?: boolean }) {
  const colors = look === 'halloween' ? HALLOWEEN_COLORS : SHOWTIME_COLORS;
  const shapes = look === 'halloween' ? HALLOWEEN_SHAPES : SHOWTIME_SHAPES;
  const n = Math.round(count * (big ? 1.5 : 1));
  return (
    <div className="sd-confetti" data-big={big ? 'true' : undefined} aria-hidden>
      {Array.from({ length: n }, (_, i) => {
        const shape = shapes[i % shapes.length] ?? 'chip';
        const color = colors[(i * 7) % colors.length] ?? '#fff';
        return (
          <i
            key={i}
            data-shape={shape}
            style={
              {
                '--x': `${(i * 37 + 11) % 100}%`,
                '--dur': `${(big ? 3.2 : 2.6) + ((i * 7) % 10) * 0.18}s`,
                '--delay': `${((i * 3) % 14) * (big ? 0.11 : 0.08)}s`,
                '--drift': `${((i * 13) % 9) - 4}cqw`,
                '--spin': `${((i * 29) % 7) - 3}`,
                '--s': `${0.8 + ((i * 17) % 5) * 0.12}`,
                '--c': color,
              } as CSSProperties
            }
          >
            <ShapeArt shape={shape} color={color} />
          </i>
        );
      })}
    </div>
  );
}

/** Bats bursting out of the middle of the stage (Halloween Night's celebration). */
export function BatBurst({ count }: { count: number }) {
  return (
    <div className="sd-batburst" aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        // Fan out over the upper half: -160° … -20° (left to right), alternating sides.
        const k = count > 1 ? i / (count - 1) : 0.5;
        const angle = -160 + k * 140;
        const rad = (angle * Math.PI) / 180;
        return (
          <svg
            key={i}
            className="sd-batburst__bat"
            viewBox="0 0 64 28"
            style={{ '--dx': `${Math.cos(rad) * 62}cqw`, '--dy': `${Math.sin(rad) * 48}cqh`, '--d': `${(i % 3) * 0.09}s` } as CSSProperties}
            focusable="false"
          >
            <path
              className="sd-bat__wings"
              d="M32 10 C28 2 20 0 14 4 C10 2 4 4 0 10 C6 9 10 12 12 16 C15 13 20 13 24 16 C26 12 29 11 32 16 C35 11 38 12 40 16 C44 13 49 13 52 16 C54 12 58 9 64 10 C60 4 54 2 50 4 C44 0 36 2 32 10 Z"
              fill="#12081f"
            />
            <circle cx="29.5" cy="9" r="1.2" fill="#ffb347" />
            <circle cx="34.5" cy="9" r="1.2" fill="#ffb347" />
          </svg>
        );
      })}
    </div>
  );
}

/** Coloured light beams sweeping from the top of the stage (the celebration's "lights up"). */
export function Beams({ look }: { look: ShowdownLook }) {
  const colors = look === 'halloween' ? ['#ff8a1f', '#b26bff', '#a8ff3c', '#ffb347'] : ['#ffd36b', '#ff4fd8', '#22d3ee', '#ffffff'];
  return (
    <div className="sd-beams" aria-hidden>
      {colors.map((c, i) => (
        <i key={i} style={{ '--c': c, '--i': i } as CSSProperties} />
      ))}
    </div>
  );
}
