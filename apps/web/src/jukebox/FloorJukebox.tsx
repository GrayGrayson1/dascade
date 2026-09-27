/**
 * The jukebox on the arcade floor: a physical machine standing in the room's corner — arched crown,
 * a bubble-tube arch running up one side and down the other, a record turning behind the dome
 * glass, the title-strip window, selector buttons and a lit speaker grille on a chrome plinth.
 *
 * It's the jukebox's front door: one real <button> that opens the machine (the expanded player).
 * Colours come from theme tokens through the --jb-* / --cabinet-* variables (jukebox.css), so every
 * theme restyles it; motion (bubbles, record, grille lights) runs only while music plays and honours
 * reduced motion and the visual-effects setting (pure CSS, keyed off data attributes).
 */
import { memo, useId } from 'react';
import { JUKEBOX_H, JUKEBOX_W } from './geometry.ts';

const SLATS = [42, 48, 54, 60, 66, 72, 88, 94, 100, 106, 112, 118];
const BARS = [0, 1, 2, 3, 4, 5, 6];
const KEYS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const STRIPS = [0, 1, 2, 3, 4, 5];

/** The machine's body (viewBox JUKEBOX_W × JUKEBOX_H = 160 × 264; the arch's centre is (80, 102)). */
export const FloorJukeboxArt = memo(function FloorJukeboxArt() {
  const uid = `jbf${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const url = (name: string) => `url(#${uid}-${name})`;
  return (
    <svg className="jbf" viewBox={`0 0 ${JUKEBOX_W} ${JUKEBOX_H}`} aria-hidden focusable="false">
      <defs>
        <linearGradient id={`${uid}-body`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" className="jbf-stop-body2" />
          <stop offset="0.2" className="jbf-stop-body" />
          <stop offset="0.8" className="jbf-stop-body" />
          <stop offset="1" className="jbf-stop-body2" />
        </linearGradient>
        <linearGradient id={`${uid}-tube`} x1="0" x2="0" y1="1" y2="0">
          <stop offset="0" className="jbf-stop-a" />
          <stop offset="0.55" className="jbf-stop-b" />
          <stop offset="1" className="jbf-stop-a" />
        </linearGradient>
        <radialGradient id={`${uid}-dome`} cx="0.5" cy="0.9" r="0.85">
          <stop offset="0" className="jbf-stop-glow" />
          <stop offset="1" className="jbf-stop-glass" />
        </radialGradient>
        <linearGradient id={`${uid}-chrome`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" className="jbf-stop-chrome-hi" />
          <stop offset="0.5" className="jbf-stop-chrome-lo" />
          <stop offset="1" className="jbf-stop-chrome-hi" />
        </linearGradient>
        <linearGradient id={`${uid}-bar`} x1="0" x2="0" y1="1" y2="0">
          <stop offset="0" className="jbf-stop-a" />
          <stop offset="1" className="jbf-stop-b" />
        </linearGradient>
        <clipPath id={`${uid}-dome-clip`}>
          <path d="M36 132V106A44 58 0 0 1 124 106V132Z" />
        </clipPath>
        <clipPath id={`${uid}-grille-clip`}>
          <rect x="36" y="186" width="88" height="48" rx="6" />
        </clipPath>
      </defs>

      {/* floor shadow + light pool are DOM (jukebox.css); this is the machine itself */}
      <path className="jbf-body" d="M10 256V100A70 88 0 0 1 150 100V256Z" fill={url('body')} />
      <path className="jbf-trim" d="M16 254V101A64 82 0 0 1 144 101V254" />
      <ellipse className="jbf-finial" cx="80" cy="13" rx="11" ry="3.6" fill={url('chrome')} />

      {/* The bubble tube: up the left side, over the crown, down the right. */}
      <g className="jbf-tube">
        <path className="jbf-tube__glow" d="M22 244V102A58 74 0 0 1 138 102V244" />
        <path className="jbf-tube__glass" d="M22 244V102A58 74 0 0 1 138 102V244" stroke={url('tube')} />
        <path className="jbf-tube__bubbles" d="M22 244V102A58 74 0 0 1 80 28" />
        <path className="jbf-tube__bubbles" d="M138 244V102A58 74 0 0 0 80 28" />
        <path className="jbf-tube__shine" d="M20.4 240V102A59.6 75.6 0 0 1 80 26.4" />
      </g>

      {/* Dome window: the record changer seen through curved glass. */}
      <path className="jbf-dome" d="M36 132V106A44 58 0 0 1 124 106V132Z" fill={url('dome')} />
      <g clipPath={url('dome-clip')}>
        <ellipse className="jbf-platter" cx="80" cy="128" rx="40" ry="7" />
        <g className="jbf-record">
          <circle className="jbf-vinyl" cx="80" cy="98" r="26" />
          <circle className="jbf-groove" cx="80" cy="98" r="22.5" />
          <circle className="jbf-groove" cx="80" cy="98" r="19" />
          <circle className="jbf-groove" cx="80" cy="98" r="15.5" />
          <circle className="jbf-label" cx="80" cy="98" r="9" />
          <path className="jbf-label-mark" d="M80 90.6A7.4 7.4 0 0 1 87.2 96.4L84.2 97.1A4.4 4.4 0 0 0 80 93.6Z" />
          <circle className="jbf-spindle" cx="80" cy="98" r="1.6" />
        </g>
        <path className="jbf-vinyl-sheen" d="M62 84A26 26 0 0 1 90 74L86 80A19 19 0 0 0 67 88Z" />
        <g className="jbf-arm">
          <path className="jbf-arm__rod" d="M110 76L106 100L99.5 105.5" />
          <rect className="jbf-arm__head" x="96" y="103.5" width="6.5" height="4.5" rx="1" transform="rotate(-40 99.25 105.75)" />
          <circle className="jbf-arm__pivot" cx="110" cy="76" r="4" fill={url('chrome')} />
        </g>
      </g>
      <path className="jbf-dome-glare" d="M42 112A40 52 0 0 1 64 58L67 61A36 47 0 0 0 46 112Z" />
      <path className="jbf-dome-rim" d="M36 132V106A44 58 0 0 1 124 106V132Z" />

      {/* Title-strip window */}
      <rect className="jbf-window" x="38" y="138" width="84" height="30" rx="2.5" />
      {STRIPS.map((i) => {
        const x = 41 + (i % 2) * 40;
        const y = 141 + Math.floor(i / 2) * 8.6;
        return (
          <g key={i} className="jbf-strip">
            <rect x={x} y={y} width="38" height="7" rx="0.8" />
            <rect className={i % 3 === 1 ? 'jbf-strip__band jbf-strip__band--b' : 'jbf-strip__band'} x={x} y={y} width="38" height="1.8" />
            <rect className="jbf-strip__ink" x={x + 3} y={y + 3.4} width={i % 2 ? 22 : 27} height="1.1" />
          </g>
        );
      })}

      {/* Selector keys */}
      <rect className="jbf-keybed" x="36" y="172" width="88" height="10" rx="2" />
      {KEYS.map((i) => (
        <rect
          key={i}
          className={i === 3 ? 'jbf-key jbf-key--lit' : 'jbf-key'}
          x={39.5 + i * 8.3}
          y="174.5"
          width="5.8"
          height="5"
          rx="1.2"
        />
      ))}

      {/* Speaker grille with lights behind the slats */}
      <rect className="jbf-grille" x="36" y="186" width="88" height="48" rx="6" />
      <g clipPath={url('grille-clip')}>
        {BARS.map((i) => (
          <rect
            key={i}
            className="jbf-bar"
            style={{ ['--i' as string]: i }}
            x={40 + i * 12}
            y="190"
            width="8"
            height="44"
            fill={url('bar')}
          />
        ))}
      </g>
      {SLATS.map((x) => (
        <line key={x} className="jbf-slat" x1={x} y1="188" x2={x} y2="232" />
      ))}
      <circle className="jbf-badge" cx="80" cy="210" r="9.5" fill={url('chrome')} />
      <path className="jbf-badge__star" d="M80 203.2L81.9 208.1L87 210L81.9 211.9L80 216.8L78.1 211.9L73 210L78.1 208.1Z" />
      <rect className="jbf-grille-rim" x="36" y="186" width="88" height="48" rx="6" />

      {/* Plinth */}
      <rect className="jbf-plinth" x="4" y="246" width="152" height="14" rx="2.5" fill={url('chrome')} />
      <rect className="jbf-led" x="12" y="258.4" width="136" height="1.8" rx="0.9" />
    </svg>
  );
});
