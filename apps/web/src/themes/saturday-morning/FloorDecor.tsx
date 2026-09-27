/**
 * The arcade floor as a Saturday-morning TV set: a rounded set wall framed in chasing marquee bulbs,
 * an "APPLAUSE" light box and an ON AIR lamp, and a checkerboard stage floor in perspective.
 * Pure CSS (see skin.css); animation honours fx / reduced motion.
 */
import type { SkinRenderContext } from '../types.ts';

export function SaturdayFloorDecor({ fx }: SkinRenderContext) {
  return (
    <div className="sm-set" data-fx={fx}>
      <div className="sm-set__wall">
        <i className="sm-set__bulbs sm-set__bulbs--a" />
        <i className="sm-set__bulbs sm-set__bulbs--b" />
        <i className="sm-set__stripes" />
      </div>
      <div className="sm-set__sign">
        <span>APPLAUSE</span>
      </div>
      <div className="sm-set__onair">
        <i />
        <span>ON AIR</span>
      </div>
      <div className="sm-set__floor">
        <div className="sm-set__checks" />
      </div>
    </div>
  );
}
