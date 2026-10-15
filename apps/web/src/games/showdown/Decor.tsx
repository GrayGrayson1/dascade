/**
 * Set dressing for the two looks. DAS Showtime: sweeping spotlights, a sparkle field and a stage
 * floor. Halloween Night: a moon, drifting fog, bats, cobwebs, jack-o'-lanterns and a graveyard
 * skyline — spooky-cute, never gory. All decorative (aria-hidden, pointer-events none); motion is
 * CSS-only and switched off by reduced motion / effects off (showdown.css).
 */
import type { CSSProperties } from 'react';
import type { ShowdownLook } from '@dascade/shared/games/showdown';

export function Backdrop({ look, fx }: { look: ShowdownLook; fx: 'high' | 'low' | 'off' }) {
  return (
    <div className="sd-backdrop" aria-hidden>
      {look === 'halloween' ? <HalloweenSet fx={fx} /> : <ShowtimeSet fx={fx} />}
    </div>
  );
}

function ShowtimeSet({ fx }: { fx: 'high' | 'low' | 'off' }) {
  return (
    <>
      <div className="sd-sky" />
      <div className="sd-sparkles" />
      {fx !== 'off' ? (
        <>
          <div className="sd-spot sd-spot--a" />
          <div className="sd-spot sd-spot--b" />
          {fx === 'high' ? <div className="sd-spot sd-spot--c" /> : null}
        </>
      ) : null}
      <div className="sd-floor" />
    </>
  );
}

function HalloweenSet({ fx }: { fx: 'high' | 'low' | 'off' }) {
  const bats = fx === 'high' ? 5 : fx === 'low' ? 2 : 0;
  return (
    <>
      <div className="sd-sky" />
      <div className="sd-stars" />
      <Moon />
      {fx !== 'off' ? <div className="sd-fog sd-fog--back" /> : null}
      <Graveyard />
      {Array.from({ length: bats }, (_, i) => (
        <Bat key={i} i={i} />
      ))}
      <Cobweb corner="tl" />
      <Cobweb corner="tr" />
      {fx !== 'off' ? <div className="sd-fog sd-fog--front" /> : null}
    </>
  );
}

function Moon() {
  return (
    <svg className="sd-moon" viewBox="0 0 100 100" aria-hidden focusable="false">
      <defs>
        <radialGradient id="sd-moon-face" cx="0.4" cy="0.38" r="0.7">
          <stop offset="0" stopColor="#fff8dc" />
          <stop offset="0.7" stopColor="#ffe3a0" />
          <stop offset="1" stopColor="#f2c26b" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="40" fill="url(#sd-moon-face)" />
      <circle cx="36" cy="40" r="7" fill="#efc77a" opacity="0.55" />
      <circle cx="60" cy="62" r="9" fill="#efc77a" opacity="0.45" />
      <circle cx="62" cy="34" r="4" fill="#efc77a" opacity="0.5" />
    </svg>
  );
}

function Graveyard() {
  return (
    <svg className="sd-graveyard" viewBox="0 0 1600 220" preserveAspectRatio="none" aria-hidden focusable="false">
      <path d="M0 160 Q200 120 420 150 T860 140 T1260 150 T1600 130 L1600 220 L0 220 Z" fill="#0d0518" />
      <g fill="#140924">
        <path d="M120 160 v-46 a26 26 0 0 1 52 0 v46 z" />
        <rect x="236" y="120" width="12" height="44" />
        <rect x="222" y="132" width="40" height="11" />
        <path d="M1320 156 v-40 a22 22 0 0 1 44 0 v40 z" />
        <path d="M1420 150 v-30 a18 18 0 0 1 36 0 v30 z" />
        <rect x="1490" y="104" width="10" height="46" />
        <rect x="1478" y="116" width="34" height="10" />
      </g>
      {/* a crooked little tree */}
      <path d="M1180 150 C1176 110 1186 80 1170 52 M1176 92 C1196 82 1210 70 1216 56 M1174 74 C1158 66 1150 56 1146 44" stroke="#140924" strokeWidth="9" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Bat({ i }: { i: number }) {
  return (
    <svg
      className="sd-bat"
      viewBox="0 0 64 28"
      style={{ '--i': i, '--y': `${8 + ((i * 17) % 34)}%`, '--d': `${11 + (i % 3) * 3}s` } as CSSProperties}
      aria-hidden
      focusable="false"
    >
      <path
        className="sd-bat__wings"
        d="M32 10 C28 2 20 0 14 4 C10 2 4 4 0 10 C6 9 10 12 12 16 C15 13 20 13 24 16 C26 12 29 11 32 16 C35 11 38 12 40 16 C44 13 49 13 52 16 C54 12 58 9 64 10 C60 4 54 2 50 4 C44 0 36 2 32 10 Z"
        fill="#12081f"
      />
    </svg>
  );
}

function Cobweb({ corner }: { corner: 'tl' | 'tr' }) {
  return (
    <svg className={`sd-cobweb sd-cobweb--${corner}`} viewBox="0 0 120 120" aria-hidden focusable="false">
      <g stroke="#d9cdf5" strokeWidth="1.1" fill="none" opacity="0.5">
        <path d="M0 0 L120 6 M0 0 L104 54 M0 0 L58 104 M0 0 L8 120" />
        <path d="M30 2 Q26 14 28 26 Q14 24 2 30" />
        <path d="M62 3 Q52 28 56 50 Q30 50 3 62" />
        <path d="M92 5 Q78 44 84 78 Q42 80 5 92" />
      </g>
      <g className="sd-cobweb__spider">
        <line x1="58" y1="50" x2="58" y2="82" stroke="#d9cdf5" strokeWidth="1" opacity="0.6" />
        <circle cx="58" cy="86" r="5" fill="#1a0b2b" />
        <path d="M53 84 l-6 -3 M53 87 l-6 1 M63 84 l6 -3 M63 87 l6 1" stroke="#1a0b2b" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

/** A carved jack-o'-lantern with a flickering candle (Halloween board base). */
export function Pumpkin({ size = 1, face = 0 }: { size?: number; face?: 0 | 1 | 2 }) {
  return (
    <svg className="sd-pumpkin" viewBox="0 0 100 86" style={{ '--s': size } as CSSProperties} aria-hidden focusable="false">
      <path d="M50 12 C46 4 50 0 56 2 C54 6 54 9 53 13" fill="#3f7a2a" stroke="#244d16" strokeWidth="1.5" />
      <ellipse cx="30" cy="50" rx="24" ry="32" fill="#e8650f" />
      <ellipse cx="70" cy="50" rx="24" ry="32" fill="#e8650f" />
      <ellipse cx="50" cy="50" rx="24" ry="34" fill="#ff7f1f" />
      <path d="M50 16 C40 30 40 70 50 84 M50 16 C60 30 60 70 50 84" stroke="#c9520a" strokeWidth="1.5" fill="none" opacity="0.6" />
      <g className="sd-pumpkin__glow" fill="#ffd36b">
        {face === 0 ? (
          <>
            <path d="M28 40 L38 30 L42 44 Z" />
            <path d="M72 40 L62 30 L58 44 Z" />
            <path d="M26 56 Q50 74 74 56 L68 60 L62 56 L56 62 L50 56 L44 62 L38 56 L32 60 Z" />
          </>
        ) : face === 1 ? (
          <>
            <circle cx="34" cy="40" r="7" />
            <circle cx="66" cy="40" r="7" />
            <path d="M34 58 Q50 72 66 58 Q50 64 34 58 Z" />
          </>
        ) : (
          <>
            <path d="M26 38 L40 36 L34 46 Z" />
            <path d="M74 38 L60 36 L66 46 Z" />
            <ellipse cx="50" cy="62" rx="10" ry="8" />
          </>
        )}
      </g>
    </svg>
  );
}

/** The marquee frame of chasing bulbs around the stage. */
export function Bulbs() {
  return (
    <div className="sd-bulbs" aria-hidden>
      <i className="sd-bulbs__edge sd-bulbs__edge--top" />
      <i className="sd-bulbs__edge sd-bulbs__edge--bottom" />
      <i className="sd-bulbs__edge sd-bulbs__edge--left" />
      <i className="sd-bulbs__edge sd-bulbs__edge--right" />
    </div>
  );
}
