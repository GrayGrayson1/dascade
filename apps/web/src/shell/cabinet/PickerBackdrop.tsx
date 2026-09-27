/**
 * The in-world setting behind a cabinet's game-select screen:
 *  - DASino: a small neon casino floor (carpet, chip stacks, a lit sign glow);
 *  - DAS Boardroom: an executive lounge (walnut panelling, brass, banker's lamps);
 *  - DAStravaganza: a game-show stage (curtains, chaser bulbs, spotlights);
 *  - DAScade Classics: a retro-modern select screen (neon grid horizon, starfield).
 * Pure decoration (aria-hidden), CSS-driven, honours fx / reduced motion via CSS.
 */
import type { CSSProperties } from 'react';
import type { CabinetId } from '@dascade/shared';
import { Chip, SPADE, Suit, HEART, DIAMOND, CLUB } from '../../arcade/cabinetArt.tsx';

const BULBS = Array.from({ length: 22 }, (_, i) => i);
const STARS = Array.from({ length: 36 }, (_, i) => i);

function hashed(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function CasinoFloor() {
  return (
    <>
      <div className="cpb-casino__carpet" />
      <div className="cpb-casino__glow" />
      <svg className="cpb-casino__chips cpb-casino__chips--l" viewBox="0 0 90 70" aria-hidden focusable="false">
        <Chip x={26} y={52} r={13} color="#e8364f" rot={10} />
        <Chip x={46} y={44} r={13} color="#ffd23f" rot={40} />
        <Chip x={34} y={34} r={13} color="#1b6fb8" rot={70} />
        <Suit d={SPADE} x={72} y={20} s={1.4} fill="#c084fc" opacity={0.5} />
      </svg>
      <svg className="cpb-casino__chips cpb-casino__chips--r" viewBox="0 0 90 70" aria-hidden focusable="false">
        <Chip x={64} y={52} r={13} color="#2de38f" rot={20} />
        <Chip x={44} y={46} r={13} color="#c084fc" rot={50} />
        <Chip x={58} y={34} r={13} color="#ffd23f" rot={80} />
        <Suit d={HEART} x={18} y={22} s={1.3} fill="#ff5a5f" opacity={0.5} />
        <Suit d={DIAMOND} x={28} y={8} s={0.9} fill="#ffd23f" opacity={0.4} />
        <Suit d={CLUB} x={8} y={40} s={1} fill="#2de38f" opacity={0.35} />
      </svg>
    </>
  );
}

function Lounge() {
  return (
    <>
      <div className="cpb-lounge__panels" />
      <div className="cpb-lounge__rail" />
      <div className="cpb-lounge__lamp cpb-lounge__lamp--l">
        <i />
      </div>
      <div className="cpb-lounge__lamp cpb-lounge__lamp--r">
        <i />
      </div>
      <div className="cpb-lounge__floor" />
    </>
  );
}

function Stage() {
  return (
    <>
      <div className="cpb-stage__beams" />
      <div className="cpb-stage__curtain cpb-stage__curtain--l" />
      <div className="cpb-stage__curtain cpb-stage__curtain--r" />
      <div className="cpb-stage__valance" />
      <div className="cpb-stage__bulbs">
        {BULBS.map((i) => (
          <i key={i} style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
      <div className="cpb-stage__floor" />
    </>
  );
}

function RetroSelect() {
  return (
    <>
      <div className="cpb-retro__sky">
        {STARS.map((i) => (
          <i
            key={i}
            style={
              {
                left: `${(hashed(i, 1) * 100).toFixed(2)}%`,
                top: `${(hashed(i, 2) * 55).toFixed(2)}%`,
                '--tw': `${(hashed(i, 3) * 3).toFixed(2)}s`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="cpb-retro__sun" />
      <div className="cpb-retro__grid" />
    </>
  );
}

export function PickerBackdrop({ cabinet }: { cabinet: CabinetId }) {
  return (
    <div className="cpb" data-flavour={cabinet} aria-hidden>
      {cabinet === 'dasino' ? (
        <CasinoFloor />
      ) : cabinet === 'boardroom' ? (
        <Lounge />
      ) : cabinet === 'stravaganza' ? (
        <Stage />
      ) : (
        <RetroSelect />
      )}
      <div className="cpb__vignette" />
    </div>
  );
}
