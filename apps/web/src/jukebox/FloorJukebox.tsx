/**
 * The jukebox on the arcade floor: a 1940s "bubbler" standing at the left end of the cabinet row,
 * drawn the way the cabinets are (flat SVG panels, cabinet body tokens, a dotted print, chrome
 * trim and a side panel turned towards the aisle) so it belongs to the same room in every theme.
 *
 * Its lights are the jukebox's: bubble tubes up both sides and over the crown, the record on its
 * turntable behind the dome glass, the title-strip rack, selector keys and a speaker grille lit from
 * behind. While music plays the bubbles rise, the record turns under the tone arm, the grille's
 * light bars dance and a few notes drift up out of the crown; idle, it's dimmed and still.
 *
 * It's the jukebox's front door (Dock.tsx wraps it in one real <button> that opens the player).
 * Colours: cabinet tokens for the body, --jb-* accents for the lights (jukebox.css); motion is pure
 * CSS keyed off data attributes and honours reduced motion and the visual-effects setting.
 */
import { memo, useId } from 'react';
import { JUKEBOX_H, JUKEBOX_W } from './geometry.ts';

/** Front silhouette: straight sides under a round crown (the crown's centre is (54, 54)). */
const BODY = 'M0 190V54A54 54 0 0 1 108 54V190Z';
/** The bubble tube's centre line: up the left side, over the crown, down the right. */
const TUBE = 'M8 186V54A46 46 0 0 1 100 54V186';
const DOME = 'M16 104V54A38 38 0 0 1 92 54V104Z';
const GRILLE = 'M18 184V160A8 8 0 0 1 26 152H82A8 8 0 0 1 90 160V184Z';
const STAR = 'M54 162.4L55.5 166.5L59.6 168L55.5 169.5L54 173.6L52.5 169.5L48.4 168L52.5 166.5Z';
/** The side panel: the silhouette pushed back towards the aisle, in steps from far (dark) to near. */
const SIDE_STEPS = [8, 7, 6, 5, 4, 3, 2, 1];
const BUBBLES = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const STRIPS = [0, 1, 2, 3, 4, 5];
const KEYS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const BARS = [0, 1, 2, 3, 4, 5, 6, 7];
const SLATS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const NOTES = [0, 1, 2];
const NOTE = 'M-2 0A2 1.6 0 1 0 2 0A2 1.6 0 1 0 -2 0ZM1.2 0V-7H2V0ZM2 -7L5 -5V-3.8L2 -5.6Z';
const NOTE_PAIR =
  'M-2 0A2 1.6 0 1 0 2 0A2 1.6 0 1 0 -2 0ZM3 -1A2 1.6 0 1 0 7 -1A2 1.6 0 1 0 3 -1ZM1.2 0V-7H2V0ZM6.2 -1V-8H7V-1ZM1.2 -7L7 -8V-6.6L1.2 -5.6Z';

export const FloorJukeboxArt = memo(function FloorJukeboxArt() {
  const uid = `jbf${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const id = (k: string) => `${uid}-${k}`;
  const url = (k: string) => `url(#${id(k)})`;
  return (
    <svg className="jbf" viewBox={`0 0 ${JUKEBOX_W} ${JUKEBOX_H}`} aria-hidden focusable="false">
      <defs>
        {/* stop colours go through style so theme tokens (CSS variables) resolve */}
        <linearGradient id={id('body')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--jbf-body-2)' }} />
          <stop offset=".34" style={{ stopColor: 'var(--jbf-body)' }} />
          <stop offset=".7" style={{ stopColor: 'var(--jbf-body)' }} />
          <stop offset="1" style={{ stopColor: 'var(--jbf-body-2)' }} />
        </linearGradient>
        <linearGradient id={id('tube')} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--jb-accent-2)' }} />
          <stop offset=".5" style={{ stopColor: 'var(--jbf-warm)' }} />
          <stop offset="1" style={{ stopColor: 'var(--jb-accent)' }} />
        </linearGradient>
        <linearGradient id={id('metal')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bdb8d6" />
          <stop offset=".5" stopColor="#6f6a8e" />
          <stop offset="1" stopColor="#a39ec0" />
        </linearGradient>
        <radialGradient id={id('dome')} cx=".5" cy="1" r=".9">
          <stop offset="0" style={{ stopColor: 'var(--jb-accent)', stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: 'var(--jb-accent)', stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id={id('grille')} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--jb-accent-2)', stopOpacity: 0.7 }} />
          <stop offset="1" style={{ stopColor: 'var(--jb-accent-2)', stopOpacity: 0 }} />
        </linearGradient>
        <linearGradient id={id('bar')} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--jb-accent-2)' }} />
          <stop offset="1" style={{ stopColor: 'var(--jb-accent)' }} />
        </linearGradient>
        <linearGradient id={id('edge')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity=".5" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={id('shadow')} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#000" stopOpacity=".7" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <pattern id={id('print')} width="10" height="10" patternUnits="userSpaceOnUse">
          <circle cx="2.5" cy="2.5" r=".9" fill="#fff" opacity=".07" />
          <circle cx="7.5" cy="7.5" r=".9" style={{ fill: 'var(--jb-accent)' }} opacity=".16" />
        </pattern>
        <clipPath id={id('body-clip')}>
          <path d={BODY} />
        </clipPath>
        <clipPath id={id('dome-clip')}>
          <path d={DOME} />
        </clipPath>
        <clipPath id={id('grille-clip')}>
          <path d={GRILLE} />
        </clipPath>
        <clipPath id={id('tube-l')}>
          <rect x="4.5" y="58" width="7" height="128" />
        </clipPath>
        <clipPath id={id('tube-r')}>
          <rect x="96.5" y="58" width="7" height="128" />
        </clipPath>
      </defs>

      <ellipse cx="62" cy="199" rx="66" ry="4.6" fill={url('shadow')} />

      {/* side panel, turned towards the aisle */}
      <g className="jbf-side">
        {SIDE_STEPS.map((k) => (
          <path
            key={k}
            d={BODY}
            transform={`translate(${(1.75 * k).toFixed(2)} ${(0.7 * k).toFixed(2)}) scale(1 ${(1 - 0.00625 * k).toFixed(4)})`}
            style={{ fill: `color-mix(in srgb, var(--jbf-body-2) ${100 - k * 7}%, #000)` }}
          />
        ))}
        <rect x="108" y="191" width="13" height="6.4" fill="#07060d" />
      </g>

      {/* body */}
      <path d={BODY} fill={url('body')} />
      <path d={BODY} fill={url('print')} />
      <g clipPath={url('body-clip')}>
        <rect x="0" y="0" width="6" height="190" fill={url('edge')} />
        <rect x="102" y="0" width="6" height="190" fill={url('edge')} transform="rotate(180 105 95)" />
      </g>
      <path className="jbf-shade" d={BODY} />
      <path className="jbf-trim" d={BODY} />
      <ellipse cx="54" cy="1.6" rx="7" ry="2.2" fill={url('metal')} />

      {/* the bubble tube */}
      <path className="jbf-tube__bed" d={TUBE} />
      <path className="jbf-tube" d={TUBE} stroke={url('tube')} />
      <path className="jbf-tube__core" d="M6.6 184V54A47.4 47.4 0 0 1 101.4 54V184" />
      <g clipPath={url('tube-l')}>
        <g className="jbf-bubbles">
          {BUBBLES.map((i) => (
            <circle key={i} cx={i % 2 ? 7.2 : 8.8} cy={66 + i * 16} r="1.3" />
          ))}
        </g>
      </g>
      <g clipPath={url('tube-r')}>
        <g className="jbf-bubbles jbf-bubbles--r">
          {BUBBLES.map((i) => (
            <circle key={i} cx={i % 2 ? 100.8 : 99.2} cy={74 + i * 16} r="1.3" />
          ))}
        </g>
      </g>
      <path className="jbf-chrome" d="M3 190V54A51 51 0 0 1 105 54V190" />
      <path className="jbf-chrome" d="M13 188V54A41 41 0 0 1 95 54V188" />

      {/* dome window: the record on its turntable */}
      <path className="jbf-glass" d={DOME} />
      <path className="jbf-glow" d={DOME} fill={url('dome')} />
      <g clipPath={url('dome-clip')}>
        <ellipse cx="54" cy="83" rx="29" ry="12.4" fill="#2a2742" />
        <ellipse cx="54" cy="84.4" rx="29" ry="12.4" fill="none" stroke="#12101f" strokeWidth="1.2" />
        <g transform="translate(54 80) scale(1 .42)">
          <g className="jbf-disc">
            <circle r="27" fill="#0d0c12" />
            <circle r="22" fill="none" stroke="#2b2838" strokeWidth="1.4" />
            <circle r="17" fill="none" stroke="#2b2838" strokeWidth="1.4" />
            <circle className="jbf-label" r="9" />
            <path d="M0 -7A7 7 0 0 1 6.6 -2.3L3.8 -1.3A4 4 0 0 0 0 -4Z" fill="#fff" opacity=".75" />
            <circle r="1.6" fill="#d7d2ec" />
          </g>
        </g>
        <path d="M36 74A22 9 0 0 1 64 71.4L62 74A18 7 0 0 0 40 76Z" fill="#fff" opacity=".1" />
        <g className="jbf-arm">
          <path d="M84 62L80 76L73 81" fill="none" stroke="#c9c4e0" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="70.4" y="79.4" width="5" height="3.2" rx=".8" fill="#8d88ad" transform="rotate(-30 72.9 81)" />
          <circle cx="84" cy="62" r="2.8" fill={url('metal')} />
        </g>
      </g>
      <path d="M22 100V62A32 32 0 0 1 38 28L42 31A28 28 0 0 0 26 62V100Z" fill="#fff" opacity=".07" />
      <path className="jbf-rim" d={DOME} />

      {/* nameplate */}
      <rect className="jbf-plate" x="24" y="107" width="60" height="10" rx="1.6" />
      <text className="jbf-name" x="54.6" y="114.6" textAnchor="middle">
        JUKEBOX
      </text>

      {/* title-strip rack */}
      <rect className="jbf-rack" x="18" y="120" width="72" height="20" rx="1.6" />
      {STRIPS.map((i) => {
        const x = 21 + (i % 2) * 34;
        const y = 122.6 + Math.floor(i / 2) * 5.8;
        return (
          <g key={i} className={i === 2 ? 'jbf-strip jbf-strip--lit' : 'jbf-strip'}>
            <rect x={x} y={y} width="32" height="4.6" rx=".5" />
            <rect className={i % 3 === 1 ? 'jbf-strip__band jbf-strip__band--b' : 'jbf-strip__band'} x={x} y={y} width="32" height="1.2" />
            <rect className="jbf-strip__ink" x={x + 3} y={y + 2.5} width={i % 2 ? 18 : 23} height=".9" />
          </g>
        );
      })}

      {/* selector keys */}
      <rect className="jbf-rack" x="18" y="142" width="72" height="7" rx="1.5" />
      {KEYS.map((i) => (
        <rect key={i} className={i === 3 ? 'jbf-key jbf-key--lit' : 'jbf-key'} x={20.6 + i * 6.9} y="143.5" width="5" height="4" rx=".9" />
      ))}

      {/* speaker grille, lit from behind */}
      <path d={GRILLE} fill="#06050c" />
      <g clipPath={url('grille-clip')}>
        <rect className="jbf-backlight" x="18" y="152" width="72" height="32" fill={url('grille')} />
        {BARS.map((i) => (
          <rect key={i} className="jbf-bar" style={{ ['--i' as string]: i }} x={21 + i * 8.6} y="158" width="5.4" height="26" fill={url('bar')} />
        ))}
      </g>
      {SLATS.map((i) => (
        <rect key={i} className="jbf-slat" x={21.4 + i * 6.4} y="153.6" width="1.1" height="30.4" />
      ))}
      <circle cx="54" cy="168" r="6.6" fill={url('metal')} />
      <path className="jbf-star" d={STAR} />
      <path className="jbf-rim" d={GRILLE} />

      {/* kick strip + coin slot */}
      <rect x="0" y="185" width="108" height="5" fill="#000" opacity=".28" />
      <rect x="78" y="185.8" width="8" height="3.2" rx=".8" fill="#15121f" />
      <rect className="jbf-coin" x="80.8" y="186.6" width="2.4" height="1.6" />

      {/* plinth + LED strip */}
      <rect x="-1" y="190" width="110" height="8" fill="#0b0918" />
      <rect className="jbf-led" x="1" y="190" width="106" height="1.4" />
      <rect className="jbf-led jbf-led--spill" x="1" y="191.4" width="106" height="3" />

      {/* notes drifting up out of the crown while it plays */}
      <g className="jbf-notes">
        {NOTES.map((i) => (
          <path
            key={i}
            className="jbf-note"
            style={{ ['--i' as string]: i }}
            transform={`translate(${72 + i * 10} ${14 - (i % 2) * 5})`}
            d={i === 1 ? NOTE_PAIR : NOTE}
          />
        ))}
      </g>
    </svg>
  );
});
