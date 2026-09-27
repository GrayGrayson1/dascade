/**
 * Executive Edition jukebox decor: the stereo's engraved brass model badge and a standby LED that
 * turns green while music plays (the visualizer itself draws the VU meters). Static.
 */
import type { JukeboxDecorContext } from '../types.ts';

export function JukeboxDecor({ playing }: JukeboxDecorContext) {
  return (
    <div className="ex-jbdecor" data-playing={playing ? 'true' : undefined}>
      <i className="ex-jbdecor__led" />
      <span className="ex-jbdecor__badge">Model EX-9000</span>
    </div>
  );
}
