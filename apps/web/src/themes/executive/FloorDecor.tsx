/**
 * Executive Edition floor decor: a green-shaded banker's lamp on a side table (left) and a framed
 * motivational print (right). Decorative only (aria-hidden, pointer-events none), roomy screens
 * only (skin.css). Static.
 */
import type { SkinRenderContext } from '../types.ts';

export function FloorDecor({ fx }: SkinRenderContext) {
  return (
    <div className="ex-decor" data-fx={fx}>
      <div className="ex-lamp">
        <i className="ex-lamp__glow" />
        <i className="ex-lamp__shade" />
        <i className="ex-lamp__stem" />
        <i className="ex-lamp__base" />
        <i className="ex-lamp__table" />
      </div>
      <div className="ex-print">
        <div className="ex-print__art">
          <i />
        </div>
        <b>SYNERGY</b>
        <span>Together, everyone achieves more checkmates.</span>
      </div>
    </div>
  );
}
