/**
 * Cover art: the track's artwork when the manifest has one, else a generated pixel sigil
 * (deterministic per track id, coloured by theme tokens via CSS classes — no inline colours).
 */
import { memo, useState } from 'react';
import type { JukeboxTrack } from '@dascade/shared';
import { coverCells, hash32 } from './format.ts';
import { Glyph } from './icons.tsx';

export const Art = memo(function Art({ track, size = 'md' }: { track: JukeboxTrack | null; size?: 'sm' | 'md' }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!track) {
    return (
      <span className="jb-art" data-part="art" data-size={size} data-empty="true" aria-hidden>
        <Glyph name="jukebox" size={size === 'sm' ? 18 : 34} />
      </span>
    );
  }
  if (track.artwork && failed !== track.artwork) {
    return (
      <span className="jb-art" data-part="art" data-size={size} aria-hidden>
        <img
          src={track.artwork}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(track.artwork ?? null)}
        />
      </span>
    );
  }
  const cells = coverCells(track.id);
  // Two gradient variants + a hue slot chosen from the hash, so neighbours look different.
  const h = hash32(track.id);
  return (
    <span className="jb-art" data-part="art" data-size={size} data-generated="true" data-variant={h % 4} aria-hidden>
      <svg viewBox="0 0 8 8" shapeRendering="crispEdges" focusable="false">
        {cells.map((c, i) => (
          <rect key={i} x={c.x} y={c.y} width={1} height={1} className={`jb-art__px jb-art__px--${c.tone}`} />
        ))}
      </svg>
    </span>
  );
});
