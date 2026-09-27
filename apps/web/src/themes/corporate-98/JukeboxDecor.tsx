/**
 * Corporate Desktop '98 jukebox decor: the IT-approved media software's "licensed" stamp and a
 * little speaker whose sound waves step with the music level. Static under reduced motion or
 * MINIMAL effects (the waves just show the playing state).
 */
import type { JukeboxDecorContext } from '../types.ts';

export function JukeboxDecor({ playing, level, reducedMotion, fx }: JukeboxDecorContext) {
  const live = playing && !reducedMotion && fx !== 'off';
  const waves = !playing ? 0 : live ? Math.min(3, Math.round(level * 4)) : 2;
  return (
    <div className="c98-jbdecor">
      <svg viewBox="0 0 22 16" width="22" height="16" shapeRendering="crispEdges" aria-hidden focusable="false">
        <path d="M2 5h4l5-4v14l-5-4H2z" fill="#3aff5a" />
        {waves > 0 ? <rect x="13" y="6" width="1" height="4" fill="#3aff5a" /> : null}
        {waves > 1 ? <rect x="16" y="4" width="1" height="8" fill="#3aff5a" /> : null}
        {waves > 2 ? <rect x="19" y="2" width="1" height="12" fill="#3aff5a" /> : null}
      </svg>
      <span>IT APPROVED</span>
    </div>
  );
}
