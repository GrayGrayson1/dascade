/**
 * Halloween Night floor props (original SVG): cobwebs in the top corners with a dangling spider, and in
 * the gutters beside the plaque a hay bale with a jack-o'-lantern trio and a black-cat figurine (left)
 * and a bubbling cauldron on its embers (right). After dark the lanterns burn bright and the cat's eyes
 * glow; on Halloween night a friendly ghost peeks out from behind the hay and a candy bucket appears.
 * Also defines the witch-stocking stripe pattern skin.css paints on the cabinets' side panels.
 *   fx high: candle flicker, bubbles, the spider bobs · low/off/reduced motion: still.
 */
import type { SkinRenderContext } from '../types.ts';
import { useDocVisible } from './art.ts';
import { useHauntLevel } from './haunt.ts';

/** A corner cobweb (origin top-left, 120 × 120): radial threads and sagging rings. */
const WEB = (() => {
  const angles = [0, 16, 34, 52, 72, 90].map((d) => (d * Math.PI) / 180);
  const pt = (a: number, r: number) => [Math.cos(a) * r, Math.sin(a) * r] as const;
  const parts = angles.map((a) => {
    const [x, y] = pt(a, 118);
    return `M0 0L${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  for (const r of [26, 52, 80, 108]) {
    for (let i = 0; i < angles.length - 1; i++) {
      const [x1, y1] = pt(angles[i]!, r);
      const [x2, y2] = pt(angles[i + 1]!, r);
      const [cx, cy] = pt((angles[i]! + angles[i + 1]!) / 2, r * 0.82);
      parts.push(`M${x1.toFixed(1)} ${y1.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
    }
  }
  return parts.join('');
})();

/** A jack-o'-lantern centred on (0, 0), about 52 × 44 before scaling. */
export function Pumpkin({ x, y, s, tilt = 0 }: { x: number; y: number; s: number; tilt?: number }) {
  return (
    <g className="hn-pumpkin" transform={`translate(${x} ${y}) rotate(${tilt}) scale(${s})`}>
      <ellipse rx="26" ry="20" fill="#d9541a" />
      <ellipse cx="-12" rx="13" ry="19" fill="#ea6a1e" />
      <ellipse cx="12" rx="13" ry="19" fill="#ea6a1e" />
      <ellipse rx="10" ry="20" fill="#f7812a" />
      <path d="M-2 -19c1-6 4-9 8-10" fill="none" stroke="#3f6b1f" strokeWidth="4" strokeLinecap="round" />
      <path d="M4 -24c5-2 9 0 10 4" fill="none" stroke="#5f9a2a" strokeWidth="2" strokeLinecap="round" />
      <g className="hn-face">
        <path d="M-15 -4l6-9 6 9z" />
        <path d="M3 -4l6-9 6 9z" />
        <path d="M-3 1l3-4 3 4z" />
        <path d="M-17 6c10 9 24 9 34 0l-3 7-4-3-4 4-4-4-4 4-4-4-4 4-4-3z" />
      </g>
    </g>
  );
}

export function HalloweenFloorDecor({ fx, reducedMotion }: SkinRenderContext) {
  const visible = useDocVisible();
  const haunt = useHauntLevel();
  // MINIMAL effects keep the extras to "after dark" at most.
  const level = fx === 'off' ? Math.min(haunt, 1) : haunt;
  const animate = fx === 'high' && !reducedMotion && visible;
  return (
    <div className="hn-decor" data-fx={fx} data-haunt={level} data-animate={animate ? 'true' : undefined}>
      <svg className="hn-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="hn-stripes" patternUnits="userSpaceOnUse" width="22" height="22" patternTransform="rotate(-32)">
            <rect width="22" height="22" fill="#1e0b2c" />
            <rect width="11" height="22" fill="#38134f" />
          </pattern>
        </defs>
      </svg>

      <svg className="hn-prop hn-prop--web-l" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <path d={WEB} />
      </svg>
      <svg className="hn-prop hn-prop--web-r" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <path d={WEB} transform="matrix(-1 0 0 1 120 0)" />
      </svg>

      <svg className="hn-prop hn-prop--spider" viewBox="0 0 40 140" aria-hidden="true" focusable="false">
        <path className="hn-thread" d="M20 0V98" />
        <g className="hn-spider">
          <path
            d="M11 104l-9-8M11 110l-10-2M12 115l-9 6M14 119l-6 9M29 104l9-8M29 110l10-2M28 115l9 6M26 119l6 9"
            fill="none"
            stroke="#1a0a26"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle cx="20" cy="110" r="11" fill="#1a0a26" />
          <circle cx="16" cy="108" r="3.4" fill="#fff" />
          <circle cx="24" cy="108" r="3.4" fill="#fff" />
          <circle cx="16.6" cy="108.6" r="1.6" fill="#1a0a26" />
          <circle cx="24.6" cy="108.6" r="1.6" fill="#1a0a26" />
          <path d="M17 114q3 2.4 6 0" fill="none" stroke="#ff8a3d" strokeWidth="1.4" strokeLinecap="round" />
        </g>
      </svg>

      <svg className="hn-prop hn-prop--patch" viewBox="0 0 300 160" aria-hidden="true" focusable="false">
        <ellipse className="hn-pool" cx="150" cy="150" rx="140" ry="12" />
        <g className="hn-extra hn-peek">
          <path d="M28 108C28 82 42 70 56 70s28 12 28 38z" fill="#f4f0ff" />
          <ellipse cx="49" cy="88" rx="3.5" ry="5" fill="#2a0a3a" />
          <ellipse cx="64" cy="88" rx="3.5" ry="5" fill="#2a0a3a" />
          <circle cx="43" cy="97" r="3" fill="#ffb3cf" />
          <circle cx="70" cy="97" r="3" fill="#ffb3cf" />
          <path d="M84 96c6-6 10-6 14-2" fill="none" stroke="#f4f0ff" strokeWidth="6" strokeLinecap="round" />
        </g>
        <g className="hn-hay">
          <rect x="8" y="98" width="128" height="54" rx="10" fill="#d9a441" />
          <rect x="8" y="98" width="128" height="12" rx="6" fill="#ecc163" />
          <path d="M20 116h104M18 130h108M22 144h100" stroke="#b8862b" strokeWidth="3" strokeLinecap="round" />
          <path d="M38 99v52M106 99v52" stroke="#8a5a1a" strokeWidth="4" />
        </g>
        <Pumpkin x={112} y={84} s={0.62} tilt={-6} />
        <Pumpkin x={170} y={126} s={1} />
        <Pumpkin x={226} y={136} s={0.7} tilt={8} />
        <g className="hn-cat" transform="translate(268 0)">
          <path d="M14 152c10-4 14-16 8-26" fill="none" stroke="#14081c" strokeWidth="6" strokeLinecap="round" />
          <ellipse cy="130" rx="15" ry="22" fill="#14081c" />
          <circle cy="100" r="13" fill="#14081c" />
          <path d="M-12 96l2-16 9 9zM12 96l-2-16-9 9z" fill="#14081c" />
          <ellipse className="hn-lit hn-eye" cx="-5" cy="99" rx="2.6" ry="3.4" />
          <ellipse className="hn-lit hn-eye" cx="5" cy="99" rx="2.6" ry="3.4" />
          <path d="M-2 105l2 1.6 2-1.6" fill="none" stroke="#ff8fb3" strokeWidth="1.4" strokeLinecap="round" />
        </g>
      </svg>

      <svg className="hn-prop hn-prop--cauldron" viewBox="0 0 260 170" aria-hidden="true" focusable="false">
        <ellipse className="hn-pool" cx="120" cy="160" rx="118" ry="10" />
        <ellipse className="hn-embers" cx="118" cy="154" rx="62" ry="10" />
        <path d="M70 158l40-12M168 158l-40-12" stroke="#3a1f12" strokeWidth="9" strokeLinecap="round" />
        <path d="M58 92Q58 152 118 154Q178 152 178 92Z" fill="#1a1020" />
        <path d="M70 104Q72 140 104 148" fill="none" stroke="#3a2a48" strokeWidth="5" strokeLinecap="round" />
        <path d="M74 150l-8 10M162 150l8 10" stroke="#1a1020" strokeWidth="7" strokeLinecap="round" />
        <ellipse cx="118" cy="92" rx="66" ry="12" fill="#2a1a30" />
        <ellipse className="hn-brew" cx="118" cy="92" rx="56" ry="8" />
        <g className="hn-bubbles">
          <circle className="hn-bubble" cx="96" cy="84" r="6" />
          <circle className="hn-bubble" cx="122" cy="80" r="8" />
          <circle className="hn-bubble" cx="146" cy="85" r="5" />
          <circle className="hn-bubble" cx="110" cy="70" r="4" />
        </g>
        <g className="hn-extra hn-bucket" transform="translate(222 128)">
          <circle cx="-10" cy="-20" r="5" fill="#ff6fb5" />
          <circle cx="2" cy="-23" r="5" fill="#7df04a" />
          <circle cx="13" cy="-19" r="5" fill="#ffc93c" />
          <path d="M-18 -16h36l-3 30h-30z" fill="#f07a1a" />
          <path d="M-18 -16q18-8 36 0" fill="none" stroke="#2a0a3a" strokeWidth="2" />
          <path d="M-9 -6l4-5 4 5zM5 -6l4-5 4 5zM-9 4c6 5 12 5 18 0" fill="#2a0a3a" />
        </g>
      </svg>
    </div>
  );
}
