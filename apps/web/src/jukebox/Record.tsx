/**
 * The record on the machine's turntable, seen through the dome glass: a vinyl disc whose centre
 * label is the track's cover (artwork or its generated pixel sigil), turning at 33⅓ while music
 * plays, with the tone arm swung onto the groove; idle, the arm rests off to the side.
 * Decorative (aria-hidden): the now-playing text beside it carries the information. Motion is CSS
 * keyed off data-playing (jukebox.css), so reduced motion / effects off keep it still.
 */
import { memo, useId } from 'react';
import type { JukeboxTrack } from '@dascade/shared';
import { Art } from './Art.tsx';

const GROOVES = [46, 41, 36, 31, 26];

export const Record = memo(function Record({ track, playing }: { track: JukeboxTrack | null; playing: boolean }) {
  const uid = `jbr${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <span
      className="jb-record"
      data-part="record"
      data-playing={playing ? 'true' : undefined}
      data-empty={track ? undefined : 'true'}
      aria-hidden
    >
      <span className="jb-record__platter" />
      <span className="jb-record__disc">
        <svg className="jb-record__vinyl" viewBox="0 0 100 100" focusable="false">
          <circle className="jb-record__body" cx="50" cy="50" r="49.5" />
          {GROOVES.map((r) => (
            <circle key={r} className="jb-record__groove" cx="50" cy="50" r={r} />
          ))}
        </svg>
        <span className="jb-record__label">
          <Art track={track} />
        </span>
        <span className="jb-record__spindle" />
      </span>
      <svg className="jb-record__over" viewBox="0 0 130 100" focusable="false">
        <defs>
          <linearGradient id={`${uid}-chrome`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="jb-record__chrome-hi" />
            <stop offset="0.5" className="jb-record__chrome-lo" />
            <stop offset="1" className="jb-record__chrome-hi" />
          </linearGradient>
        </defs>
        {/* Light on the vinyl: it doesn't turn with the record, which is what makes the record read as turning. */}
        <path className="jb-record__sheen" d="M22 20A40 40 0 0 1 64 12L60 22A30 30 0 0 0 30 27Z" />
        <path className="jb-record__sheen" d="M78 80A40 40 0 0 1 36 88L40 78A30 30 0 0 0 70 73Z" />
        <g className="jb-record__arm">
          <path className="jb-record__rod" d="M118 12L106 52L94 62" />
          <rect className="jb-record__head" x="88.5" y="58.5" width="10" height="7" rx="1.5" transform="rotate(-40 93.5 62)" />
          <circle className="jb-record__pivot" cx="118" cy="12" r="7" fill={`url(#${uid}-chrome)`} />
          <circle className="jb-record__pivot-cap" cx="118" cy="12" r="2.4" />
        </g>
      </svg>
    </span>
  );
});
