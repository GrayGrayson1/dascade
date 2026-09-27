/**
 * Shareware Casino '97 environment: the faux casino floor the whole FUN PACK runs on.
 * Damask wall with brass pilasters and glowing tube signs, a brass rail, and a gaudy carpet in
 * perspective. Pure CSS (skin.css draws everything from these empty elements), so it costs a few
 * static layers plus a couple of steps() animations that stop for reduced motion, fx off, games
 * and hidden tabs.
 */
import type { SkinRenderContext } from '../types.ts';
import { usePageVisible } from './usePageVisible.ts';

export function Environment({ fx, reducedMotion, place }: SkinRenderContext) {
  const visible = usePageVisible();
  const calm = place === 'game';
  const animate = visible && !reducedMotion && fx !== 'off' && !calm;
  const signs = place === 'floor' || place === 'cabinet' || place === 'entry';
  return (
    <div className="sw-env" data-place={place} data-fx={fx} data-animate={animate ? 'on' : 'off'}>
      <div className="sw-env__wall">
        <i className="sw-env__drape sw-env__drape--l" />
        <i className="sw-env__drape sw-env__drape--r" />
        {signs && fx !== 'off' ? (
          <>
            <span className="sw-env__tube sw-env__tube--l">
              <b>Free Play</b>
              <small>all nite</small>
            </span>
            <span className="sw-env__tube sw-env__tube--r">
              <b>Live Multiplayer</b>
              <small>1-30 users</small>
            </span>
          </>
        ) : null}
      </div>
      <i className="sw-env__rail" />
      <div className="sw-env__floor">
        <i className="sw-env__carpet" />
      </div>
      {fx === 'high' && !calm ? <i className="sw-env__pools" /> : null}
      <i className="sw-env__vignette" />
    </div>
  );
}
