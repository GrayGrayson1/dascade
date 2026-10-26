/**
 * JOI-01 B: the live name tag on the event join screen — the name as the server will seat it, on the
 * hot-seat podium (the stage) and on a seat of the spotlight grid (the picker). The caller passes the
 * cleaned name (joinNames.previewName), so what you see here is what everyone will see.
 */
import type { CSSProperties } from 'react';
import type { ShowdownLook } from '@dascade/shared/games/showdown';
import { LOOK_COPY } from './look.ts';

export function NameTag({ name, look }: { name: string; look: ShowdownLook }) {
  const empty = !name;
  const shown = empty ? 'Your name' : name;
  // Long names shrink to fit, as they do on the stage (never cut off with an ellipsis).
  const len = { '--len': Math.max(8, Array.from(shown).length) } as CSSProperties;
  return (
    <figure
      className="sdj-tag"
      data-look={look}
      data-empty={empty ? 'true' : undefined}
      aria-label={empty ? 'How you’ll appear: type your name to see it' : `How you’ll appear: ${name}`}
      data-part="event-join-nametag"
    >
      <div className="sdj-tag__row" aria-hidden>
        <div className="sdj-tag__where">
          <span className="sdj-tag__label">On the stage</span>
          <div className="sdj-podium">
            <span className="sdj-podium__kicker">{LOOK_COPY[look].showcase.hotSeat}</span>
            <b className="sdj-podium__name" style={len}>
              {shown}
            </b>
          </div>
        </div>
        <div className="sdj-tag__where">
          <span className="sdj-tag__label">In the picker</span>
          <div className="sdj-seat" style={len}>
            {shown}
          </div>
        </div>
      </div>
    </figure>
  );
}
