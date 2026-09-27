/**
 * Mall Arcade '92 environment: a suspended fluorescent ceiling, the far wall with a row of distant
 * cabinets glowing in red/blue/purple, and the ridiculous geometric carpet running toward you.
 * Pure CSS/SVG (static data-URI tiles + a couple of cheap opacity animations).
 *   fx high: tube flicker + distant screens shimmer · low: static glow · off: flat, no pools/glow.
 *   Reduced motion / hidden tab: nothing animates. In games it dims right down.
 */
import type { CSSProperties } from 'react';
import type { SkinRenderContext } from '../types.ts';
import { CARPET, CEILING, POSTERS, WALL_ROW, WALL_SCREENS, useDocVisible } from './art.ts';

export function MallEnvironment({ fx, reducedMotion, place }: SkinRenderContext) {
  const visible = useDocVisible();
  const animate = fx === 'high' && !reducedMotion && visible && place !== 'game';
  return (
    <div
      className="ma-env"
      data-place={place}
      data-fx={fx}
      data-animate={animate ? 'true' : undefined}
      style={
        {
          '--ma-carpet': CARPET,
          '--ma-ceiling': CEILING,
          '--ma-wall-row': WALL_ROW,
          '--ma-wall-screens': WALL_SCREENS,
          '--ma-posters': POSTERS,
        } as CSSProperties
      }
    >
      <div className="ma-env__ceiling">
        <div className="ma-env__ceiling-plane" />
      </div>
      <div className="ma-env__wall">
        <div className="ma-env__neon ma-env__neon--hi" />
        <div className="ma-env__posters" />
        <div className="ma-env__row" />
        <div className="ma-env__screens" />
        <div className="ma-env__neon ma-env__neon--lo" />
      </div>
      <div className="ma-env__carpet">
        <div className="ma-env__carpet-plane" />
      </div>
      <div className="ma-env__pools" />
      <div className="ma-env__tubes" />
      <div className="ma-env__vignette" />
    </div>
  );
}
