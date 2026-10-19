/**
 * The show's host, drawn in SVG: DASbot (a chrome CRT robot in a tux) for DAS Showtime and Boo (a
 * top-hatted ghost) for Halloween Night. Moods swap the eyes and the arms; while a line is up the
 * mouth talks. Presenter Showcase adds character moments: celebrate (arms up, a jump and a spin), bye
 * (a wave and a hat tip / a bow), shiver (a wrong answer), peek (hands over the eyes during the
 * drumroll, one eye peeking) and startled (time up). `crowd` = the audience is cheering hard right now.
 *
 * Purely decorative (aria-hidden); every animation lives in showdown.css and stops under reduced
 * motion / effects off.
 */
import { useId } from 'react';
import type { ShowdownLook } from '@dascade/shared/games/showdown';
import type { HostMood } from './look.ts';

export function HostFigure({ look, mood, talking, crowd = false }: { look: ShowdownLook; mood: HostMood; talking: boolean; crowd?: boolean }) {
  return look === 'halloween' ? <Ghost mood={mood} talking={talking} crowd={crowd} /> : <Bot mood={mood} talking={talking} crowd={crowd} />;
}

interface FigureProps {
  mood: HostMood;
  talking: boolean;
  crowd: boolean;
}

function Bot({ mood, talking, crowd }: FigureProps) {
  const id = useId().replace(/:/g, '');
  const chrome = `${id}-chrome`;
  const tux = `${id}-tux`;
  const glow = `${id}-glow`;
  return (
    <svg
      className="sd-host__svg"
      viewBox="0 0 200 270"
      data-mood={mood}
      data-talking={talking ? 'true' : undefined}
      data-crowd={crowd ? 'true' : undefined}
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id={chrome} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7f9ff" />
          <stop offset="0.45" stopColor="#aab3c7" />
          <stop offset="0.55" stopColor="#e6ebf6" />
          <stop offset="1" stopColor="#6b7389" />
        </linearGradient>
        <linearGradient id={tux} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2378" />
          <stop offset="1" stopColor="#1a0f3d" />
        </linearGradient>
        <radialGradient id={glow}>
          <stop offset="0" stopColor="#67e8f9" stopOpacity="0.8" />
          <stop offset="1" stopColor="#67e8f9" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse className="sd-host__hover" cx="100" cy="258" rx="58" ry="9" fill={`url(#${glow})`} />
      <g className="sd-host__body">
        {/* antenna */}
        <line x1="100" y1="44" x2="100" y2="18" stroke="#8a93a8" strokeWidth="5" strokeLinecap="round" />
        <circle className="sd-host__bulb" cx="100" cy="14" r="8" fill="#ffd36b" />
        <g className="sd-host__spark" stroke="#ffd36b" strokeWidth="4" strokeLinecap="round">
          <path d="M84 6l-8-6M116 6l8-6M100 -2v-9M80 18h-10M120 18h10" />
        </g>
        {/* ear bolts */}
        <circle cx="34" cy="92" r="9" fill="#ffd36b" stroke="#b8860b" strokeWidth="2" />
        <circle cx="166" cy="92" r="9" fill="#ffd36b" stroke="#b8860b" strokeWidth="2" />
        {/* head */}
        <rect x="38" y="42" width="124" height="100" rx="24" fill={`url(#${chrome})`} stroke="#4b5366" strokeWidth="2.5" />
        <rect x="52" y="56" width="96" height="72" rx="15" fill="#08122b" stroke="#22304f" strokeWidth="2" />
        <rect x="56" y="60" width="88" height="26" rx="10" fill="#ffffff" opacity="0.06" />
        {/* eyes */}
        <g className="sd-host__eyes sd-host__eyes--idle" fill="#67e8f9">
          <rect className="sd-host__eye" x="74" y="74" width="15" height="22" rx="7.5" />
          <rect className="sd-host__eye" x="111" y="74" width="15" height="22" rx="7.5" />
        </g>
        <g className="sd-host__eyes sd-host__eyes--wow" fill="#ffd36b">
          <path d="M81 72l4 9 10 1-7.5 6.5 2.5 9.5-9-5-9 5 2.5-9.5L67 82l10-1z" />
          <path d="M119 72l4 9 10 1-7.5 6.5 2.5 9.5-9-5-9 5 2.5-9.5L105 82l10-1z" />
        </g>
        <g className="sd-host__eyes sd-host__eyes--joy" fill="none" stroke="#67e8f9" strokeWidth="5" strokeLinecap="round">
          <path d="M72 90 Q81 76 90 90" />
          <path d="M110 90 Q119 76 128 90" />
        </g>
        <g className="sd-host__eyes sd-host__eyes--oops" stroke="#ff5a7a" strokeWidth="5" strokeLinecap="round">
          <path d="M73 76l14 16M87 76l-14 16" />
          <path d="M113 76l14 16M127 76l-14 16" />
        </g>
        <g className="sd-host__eyes sd-host__eyes--think" fill="#67e8f9">
          <rect x="74" y="82" width="15" height="9" rx="4.5" />
          <rect x="111" y="78" width="15" height="13" rx="6.5" />
        </g>
        <g className="sd-host__eyes sd-host__eyes--shiver" fill="#9fe7ff">
          <rect x="74" y="80" width="15" height="14" rx="5" />
          <rect x="111" y="80" width="15" height="14" rx="5" />
        </g>
        {/* mouth */}
        <path className="sd-host__smile" d="M82 108 Q100 120 118 108" fill="none" stroke="#67e8f9" strokeWidth="4.5" strokeLinecap="round" />
        <path className="sd-host__grin" d="M80 106 Q100 126 120 106 Z" fill="#67e8f9" />
        <path className="sd-host__teeth" d="M80 112 l6 -5 l6 5 l6 -5 l6 5 l6 -5 l6 5 l6 -5 l6 5" fill="none" stroke="#9fe7ff" strokeWidth="3" strokeLinejoin="round" />
        <ellipse className="sd-host__mouth" cx="100" cy="112" rx="12" ry="7" fill="#67e8f9" />
        {/* neck + tux */}
        <rect x="88" y="141" width="24" height="12" fill="#8a93a8" />
        <path d="M50 160 Q100 146 150 160 L160 238 Q100 250 40 238 Z" fill={`url(#${tux})`} stroke="#120a2b" strokeWidth="2" />
        <path d="M86 156 L100 214 L114 156 Q100 152 86 156 Z" fill="#f4f1ff" />
        <path d="M86 156 L70 196 L100 214 Z" fill="#241552" />
        <path d="M114 156 L130 196 L100 214 Z" fill="#241552" />
        <circle cx="100" cy="190" r="3.4" fill="#ffd36b" />
        <circle cx="100" cy="202" r="3.4" fill="#ffd36b" />
        {/* bow tie */}
        <g className="sd-host__tie">
          <path d="M100 162 L80 152 L80 172 Z" fill="#ff4fd8" />
          <path d="M100 162 L120 152 L120 172 Z" fill="#ff4fd8" />
          <circle cx="100" cy="162" r="5.5" fill="#d9269f" />
        </g>
        {/* mic arm */}
        <g className="sd-host__arm">
          <path d="M150 180 Q174 168 168 132" fill="none" stroke="#aab3c7" strokeWidth="9" strokeLinecap="round" />
          <rect x="161" y="118" width="12" height="26" rx="4" fill="#2b2f3a" transform="rotate(-18 167 131)" />
          <circle cx="163" cy="114" r="11" fill="#d7dce8" stroke="#6b7389" strokeWidth="2" />
          <path d="M156 110h14M155 115h16M157 120h12" stroke="#6b7389" strokeWidth="1.5" />
        </g>
        {/* the free arm, raised (cheer, celebrate, bye) */}
        <g className="sd-host__wave">
          <path d="M50 180 Q26 168 30 140" fill="none" stroke="#aab3c7" strokeWidth="9" strokeLinecap="round" />
          <circle cx="30" cy="136" r="8" fill="#d7dce8" />
        </g>
        {/* hands over the screen, one eye peeking (suspense) */}
        <g className="sd-host__peek">
          <path d="M52 182 Q34 142 70 112" fill="none" stroke="#aab3c7" strokeWidth="9" strokeLinecap="round" />
          <path d="M148 182 Q166 128 128 94" fill="none" stroke="#aab3c7" strokeWidth="9" strokeLinecap="round" />
          {/* left hand low (that eye peeks over it), right hand over the eye */}
          <path d="M62 112 Q62 99 77 100 Q93 100 94 110 Q94 121 80 122 Q64 122 62 112 Z" fill="#e6ebf6" stroke="#6b7389" strokeWidth="2" />
          <path d="M102 86 Q101 71 118 71 Q135 71 135 85 Q135 99 119 100 Q102 100 102 86 Z" fill="#e6ebf6" stroke="#6b7389" strokeWidth="2" />
          <path d="M70 102 v7 M77 101 v8 M85 102 v7 M110 75 v8 M118 74 v9 M126 75 v8" stroke="#8a93a8" strokeWidth="2" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
}

function Ghost({ mood, talking, crowd }: FigureProps) {
  const id = useId().replace(/:/g, '');
  const sheet = `${id}-sheet`;
  const aura = `${id}-aura`;
  return (
    <svg
      className="sd-host__svg"
      viewBox="0 0 200 270"
      data-mood={mood}
      data-talking={talking ? 'true' : undefined}
      data-crowd={crowd ? 'true' : undefined}
      aria-hidden
      focusable="false"
    >
      <defs>
        <radialGradient id={sheet} cx="0.45" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#efe8ff" />
          <stop offset="1" stopColor="#bba8ee" />
        </radialGradient>
        <radialGradient id={aura}>
          <stop offset="0" stopColor="#c9b6ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#c9b6ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="sd-host__body">
        <ellipse className="sd-host__hover" cx="100" cy="150" rx="96" ry="112" fill={`url(#${aura})`} />
        {/* ghost sheet */}
        <path
          className="sd-host__sheet"
          d="M40 118 C40 66 68 44 100 44 C132 44 160 66 160 118 L160 226 Q150 246 140 228 Q130 210 120 228 Q110 246 100 228 Q90 210 80 228 Q70 246 60 228 Q50 210 40 228 Z"
          fill={`url(#${sheet})`}
          stroke="#9f8ad9"
          strokeWidth="2"
        />
        {/* arms */}
        <path className="sd-host__wave" d="M42 150 Q22 140 24 118" fill="none" stroke="#e6ddff" strokeWidth="12" strokeLinecap="round" />
        <g className="sd-host__arm">
          <path d="M158 156 Q178 146 172 120" fill="none" stroke="#e6ddff" strokeWidth="12" strokeLinecap="round" />
          <rect x="165" y="104" width="11" height="24" rx="4" fill="#2a1840" transform="rotate(-14 170 116)" />
          <circle cx="167" cy="100" r="10" fill="#3b2a55" stroke="#ff8a1f" strokeWidth="2" />
        </g>
        {/* top hat */}
        <g className="sd-host__hat">
          <rect x="62" y="38" width="76" height="10" rx="5" fill="#140a22" stroke="#8b6cc9" strokeWidth="2" />
          <rect x="74" y="4" width="52" height="38" rx="4" fill="#1d0f31" stroke="#8b6cc9" strokeWidth="2" />
          <rect x="79" y="8" width="5" height="18" rx="2" fill="#ffffff" opacity="0.18" />
          <rect x="74" y="28" width="52" height="8" fill="#ff8a1f" />
          <path d="M120 30l5-6 2 7z" fill="#a8ff3c" />
        </g>
        {/* eyes */}
        <g className="sd-host__eyes sd-host__eyes--idle" fill="#1b0b2b">
          <ellipse className="sd-host__eye" cx="82" cy="100" rx="9" ry="13" />
          <ellipse className="sd-host__eye" cx="118" cy="100" rx="9" ry="13" />
          <circle cx="85" cy="95" r="3" fill="#ffffff" />
          <circle cx="121" cy="95" r="3" fill="#ffffff" />
        </g>
        <g className="sd-host__eyes sd-host__eyes--wow" fill="#1b0b2b">
          <ellipse cx="82" cy="99" rx="12" ry="16" />
          <ellipse cx="118" cy="99" rx="12" ry="16" />
          <circle cx="86" cy="93" r="4" fill="#ffffff" />
          <circle cx="122" cy="93" r="4" fill="#ffffff" />
        </g>
        <g className="sd-host__eyes sd-host__eyes--joy" fill="none" stroke="#1b0b2b" strokeWidth="5" strokeLinecap="round">
          <path d="M72 104 Q82 88 92 104" />
          <path d="M108 104 Q118 88 128 104" />
        </g>
        <g className="sd-host__eyes sd-host__eyes--oops" stroke="#1b0b2b" strokeWidth="5" strokeLinecap="round" fill="none">
          <path d="M74 92l14 8-14 8" />
          <path d="M126 92l-14 8 14 8" />
        </g>
        <g className="sd-host__eyes sd-host__eyes--think" fill="#1b0b2b">
          <ellipse cx="82" cy="104" rx="9" ry="6" />
          <ellipse cx="118" cy="100" rx="9" ry="11" />
        </g>
        <g className="sd-host__eyes sd-host__eyes--shiver" fill="#1b0b2b">
          <ellipse cx="82" cy="100" rx="7" ry="9" />
          <ellipse cx="118" cy="100" rx="7" ry="9" />
          <path d="M70 88 Q76 82 85 82 M130 88 Q124 82 115 82" fill="none" stroke="#1b0b2b" strokeWidth="3.5" strokeLinecap="round" />
        </g>
        {/* cheeks */}
        <ellipse className="sd-host__cheek" cx="68" cy="122" rx="9" ry="5" fill="#ff9ec7" opacity="0.7" />
        <ellipse className="sd-host__cheek" cx="132" cy="122" rx="9" ry="5" fill="#ff9ec7" opacity="0.7" />
        {/* mouth */}
        <path className="sd-host__smile" d="M88 124 Q100 134 112 124" fill="none" stroke="#1b0b2b" strokeWidth="4" strokeLinecap="round" />
        <path className="sd-host__grin" d="M86 122 Q100 142 114 122 Z" fill="#1b0b2b" />
        <path className="sd-host__teeth" d="M84 128 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l3 3" fill="none" stroke="#1b0b2b" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        <ellipse className="sd-host__mouth" cx="100" cy="130" rx="8" ry="10" fill="#1b0b2b" />
        {/* bow tie */}
        <g className="sd-host__tie">
          <path d="M100 156 L82 147 L82 165 Z" fill="#ff8a1f" />
          <path d="M100 156 L118 147 L118 165 Z" fill="#ff8a1f" />
          <circle cx="100" cy="156" r="5" fill="#c24d00" />
        </g>
        {/* mitts over the eyes, one eye peeking (suspense) */}
        <g className="sd-host__peek">
          <path d="M44 160 Q28 128 68 116" fill="none" stroke="#b9a8ea" strokeWidth="16" strokeLinecap="round" />
          <path d="M156 160 Q174 118 130 100" fill="none" stroke="#b9a8ea" strokeWidth="16" strokeLinecap="round" />
          <path d="M44 160 Q28 128 68 116" fill="none" stroke="#f1ecff" strokeWidth="11" strokeLinecap="round" />
          <path d="M156 160 Q174 118 130 100" fill="none" stroke="#f1ecff" strokeWidth="11" strokeLinecap="round" />
          {/* left mitt low (that eye peeks over it), right mitt over the eye */}
          <path d="M62 116 Q62 103 76 104 Q92 104 93 114 Q93 124 80 125 Q64 125 62 116 Z" fill="#f6f2ff" stroke="#b9a8ea" strokeWidth="2" />
          <path d="M103 98 Q102 84 118 84 Q134 84 134 97 Q134 110 119 111 Q103 111 103 98 Z" fill="#f6f2ff" stroke="#b9a8ea" strokeWidth="2" />
          <path d="M70 106 v6 M77 105 v7 M84 106 v6 M111 88 v7 M118 87 v8 M125 88 v7" stroke="#cbbcf0" strokeWidth="2" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
}
