/**
 * Corporate Desktop '98 environment: the company wallpaper. A flat teal desktop with a faint,
 * tiled "Delta Alpha Sierra Inc." watermark (dropped at MINIMAL effects). Entirely static CSS —
 * no animation, no timers — so it costs nothing and needs no pausing.
 */
import type { SkinRenderContext } from '../types.ts';

export function Environment({ fx, place }: SkinRenderContext) {
  return <div className="c98-env" data-fx={fx} data-place={place} />;
}
