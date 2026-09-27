/**
 * VHS After Dark environment: the video store after close. Walls of rental shelves in dim
 * fluorescent light, a linoleum aisle, the blue glow of a TV left on, hanging aisle cards in marker,
 * and the VCR's on-screen display (PLAY ▶ and a clock stuck in 1989) in the corners.
 * Pure CSS/SVG. It sits BEHIND the app, so none of it can cover text.
 *   fx high: tube flicker, TV glow breathing, a rare faint tracking band on the wall (never on UI)
 *   fx low: static light · off: flat, no glow/OSD. Reduced motion / hidden tab: nothing moves.
 */
import type { CSSProperties } from 'react';
import type { SkinRenderContext } from '../types.ts';
import { LINO, SHELVES, useDocVisible, useVcrClock } from './art.ts';

export function VhsEnvironment({ fx, reducedMotion, place }: SkinRenderContext) {
  const visible = useDocVisible();
  const calm = place === 'game';
  const animate = fx === 'high' && !reducedMotion && visible && !calm;
  const osd = fx !== 'off' && !calm && place !== 'lobby';
  const clock = useVcrClock(osd && visible);
  return (
    <div
      className="vh-env"
      data-place={place}
      data-fx={fx}
      data-animate={animate ? 'true' : undefined}
      style={{ '--vh-shelves': SHELVES, '--vh-lino': LINO } as CSSProperties}
    >
      <div className="vh-env__ceiling" />
      <div className="vh-env__wall">
        <div className="vh-env__shelves" />
        <div className="vh-env__track" />
      </div>
      <div className="vh-env__floor">
        <div className="vh-env__floor-plane" />
      </div>
      <div className="vh-env__tube" />
      <div className="vh-env__signs">
        <span className="vh-env__sign" style={{ '--x': '18%', '--r': '-2deg' } as CSSProperties}>
          New releases
        </span>
        <span className="vh-env__sign vh-env__sign--pink" style={{ '--x': '50%', '--r': '1.5deg' } as CSSProperties}>
          Late night
        </span>
        <span className="vh-env__sign" style={{ '--x': '82%', '--r': '-1deg' } as CSSProperties}>
          Games &amp; more
        </span>
      </div>
      <div className="vh-env__tv" />
      <div className="vh-env__vignette" />
      {osd ? (
        <>
          <div className="vh-env__osd vh-env__osd--play">
            PLAY <b>{'\u25B6\uFE0E'}</b>
          </div>
          <div className="vh-env__osd vh-env__osd--clock">{clock}</div>
        </>
      ) : null}
    </div>
  );
}
