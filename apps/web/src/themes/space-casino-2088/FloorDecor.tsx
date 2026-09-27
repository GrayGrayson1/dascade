/**
 * The arcade floor as Orbital Recreation Deck 7: a panoramic window wall (chrome struts over the
 * environment's starfield/planet), a chrome sill with far too many status lights, a holographic
 * deck sign and a futuristic orbit-pattern carpet in perspective. Pure CSS; animations honour
 * fx / reduced motion via skin.css.
 */
import type { SkinRenderContext } from '../types.ts';

const LEDS = Array.from({ length: 24 }, (_, i) => i);

export function SpaceFloorDecor({ fx }: SkinRenderContext) {
  return (
    <div className="sc-deck" data-fx={fx}>
      <div className="sc-deck__struts">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="sc-deck__sign">
        <span className="sc-deck__sign-top">Orbital Recreation Deck</span>
        <span className="sc-deck__sign-num">7</span>
      </div>
      <div className="sc-deck__sill">
        <span className="sc-deck__plate">GRAV-PLATING 0.98G</span>
        <span className="sc-deck__leds">
          {LEDS.map((i) => (
            <i key={i} style={{ ['--i' as string]: i }} />
          ))}
        </span>
        <span className="sc-deck__plate">AIRLOCK SEALED</span>
      </div>
      <div className="sc-deck__floor">
        <div className="sc-deck__carpet" />
      </div>
    </div>
  );
}
