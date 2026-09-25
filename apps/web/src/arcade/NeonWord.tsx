/** "DASCADE" drawn with the same neon-tube strokes as the wall sign (crisp SVG at any size). */
import { NEON_LETTERS } from './room.ts';

const U = 10;
const TH = 3.6;
const LW = 4 * U;
const GAP = 1.35 * U;

export function NeonWord({ text = 'DASCADE', className }: { text?: string; className?: string }) {
  const chars = [...text];
  const pad = TH * 1.6;
  const width = chars.length * LW + (chars.length - 1) * GAP + pad * 2;
  const height = 6 * U + pad * 2;
  const d = chars
    .map((ch, i) => {
      const ox = pad + i * (LW + GAP);
      return (NEON_LETTERS[ch] ?? [])
        .map((stroke) => stroke.map(([x, y], k) => `${k ? 'L' : 'M'}${(ox + x * U).toFixed(1)} ${(pad + y * U).toFixed(1)}`).join(''))
        .join('');
    })
    .join('');
  return (
    <svg className={className} viewBox={`0 0 ${width.toFixed(1)} ${height.toFixed(1)}`} aria-hidden focusable="false">
      <g fill="none" strokeLinecap="square" strokeLinejoin="miter">
        <path d={d} stroke="#ff4fd8" strokeOpacity=".35" strokeWidth={TH * 2.4} />
        <path d={d} stroke="#ff4fd8" strokeWidth={TH} />
        <path d={d} stroke="#ffe6f8" strokeWidth={TH * 0.38} />
      </g>
    </svg>
  );
}
