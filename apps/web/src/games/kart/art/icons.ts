/**
 * Item HUD icons: small hand-built SVGs in the same chunky style as the 3D items (dark outline,
 * flat faces, one highlight). Pure strings — no three.js, no DOM — so the HUD can use them as
 * <img src={itemIconUrl(id)}> (no dangerouslySetInnerHTML needed). 64×64 viewBox.
 *
 * `'prism'` is the roulette/unknown icon (the prism cube with its star glyph).
 */
import type { KartItemId } from '@dascade/shared/games/kart';
import { ITEM_COLORS, PRISM, intToHex } from './palette.ts';

export type KartIconId = KartItemId | 'prism';

const O = '#120d1f'; // outline
const hex = intToHex;

function wrap(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${body}</svg>`;
}

const turboCell = (x: number, y: number, s: number) => {
  const c = ITEM_COLORS.turbo;
  return `<g transform="translate(${x} ${y}) scale(${s})">
<rect x="-10" y="-20" width="20" height="40" rx="4" fill="${hex(c.main)}" stroke="${O}" stroke-width="3"/>
<rect x="-5" y="-25" width="10" height="6" rx="1.5" fill="#d6dde8" stroke="${O}" stroke-width="2.5"/>
<rect x="-10" y="-6" width="20" height="12" fill="${hex(c.accent)}"/>
<path d="M3 -15 L-5 1 L0 1 L-3 15 L6 -2 L1 -2 Z" fill="${hex(c.glow)}" stroke="${O}" stroke-width="1.8" stroke-linejoin="round"/>
</g>`;
};

const puckDisc = (x: number, y: number, s: number) => {
  const c = ITEM_COLORS.puck;
  return `<g transform="translate(${x} ${y}) scale(${s})">
<ellipse cx="0" cy="5" rx="20" ry="9" fill="${hex(c.main)}" stroke="${O}" stroke-width="3"/>
<rect x="-20" y="-3" width="40" height="8" fill="${hex(c.main)}"/>
<ellipse cx="0" cy="-3" rx="20" ry="9" fill="${hex(c.glow)}" stroke="${O}" stroke-width="3"/>
<ellipse cx="0" cy="-3" rx="11" ry="4.5" fill="${hex(c.accent)}"/>
<path d="M-20 -3 V5 M20 -3 V5" stroke="${O}" stroke-width="3"/>
</g>`;
};

const ICONS: Record<KartIconId, () => string> = {
  prism: () =>
    wrap(`<defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${hex(PRISM.a)}"/><stop offset=".55" stop-color="${hex(PRISM.b)}"/><stop offset="1" stop-color="${hex(PRISM.c)}"/></linearGradient></defs>
<path d="M18 8 H46 L56 18 V46 L46 56 H18 L8 46 V18 Z" fill="url(#g)" fill-opacity=".85" stroke="${O}" stroke-width="3.5" stroke-linejoin="round"/>
<path d="M18 8 H46 L56 18 H8 Z" fill="#fff" fill-opacity=".28"/>
<path d="M32 16 L36 28 L48 32 L36 36 L32 48 L28 36 L16 32 L28 28 Z" fill="#fff" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>`),
  turbo: () => wrap(turboCell(32, 34, 1.1)),
  turbo3: () => wrap(turboCell(18, 38, 0.72) + turboCell(46, 38, 0.72) + turboCell(32, 26, 0.78)),
  puck: () => wrap(puckDisc(32, 34, 1.15)),
  puck3: () => wrap(puckDisc(20, 44, 0.66) + puckDisc(44, 44, 0.66) + puckDisc(32, 24, 0.7)),
  seeker: () => {
    const c = ITEM_COLORS.seeker;
    return wrap(`<g stroke="${O}" stroke-width="3" stroke-linejoin="round">
<path d="M10 22 L22 30 M54 22 L42 30 M10 46 L22 38 M54 46 L42 38" stroke-width="4"/>
<ellipse cx="10" cy="20" rx="8" ry="3" fill="#d6dde8"/><ellipse cx="54" cy="20" rx="8" ry="3" fill="#d6dde8"/>
<ellipse cx="10" cy="48" rx="8" ry="3" fill="#d6dde8"/><ellipse cx="54" cy="48" rx="8" ry="3" fill="#d6dde8"/>
<rect x="18" y="24" width="28" height="20" rx="5" fill="${hex(c.main)}"/>
<circle cx="32" cy="34" r="6" fill="${hex(c.accent)}"/></g>
<circle cx="30" cy="32" r="2" fill="#fff"/>`);
  },
  mine: () => {
    const c = ITEM_COLORS.mine;
    return wrap(`<g stroke="${O}" stroke-width="3" stroke-linejoin="round">
<rect x="27" y="5" width="10" height="10" fill="${hex(c.accent)}"/><rect x="27" y="49" width="10" height="10" fill="${hex(c.accent)}"/>
<rect x="5" y="27" width="10" height="10" fill="${hex(c.accent)}"/><rect x="49" y="27" width="10" height="10" fill="${hex(c.accent)}"/>
<rect x="15" y="15" width="34" height="34" rx="3" fill="${hex(c.main)}"/>
<rect x="24" y="24" width="16" height="16" fill="${hex(c.glow)}"/></g>
<rect x="27" y="27" width="5" height="5" fill="#fff" fill-opacity=".8"/>`);
  },
  fizz: () => {
    const c = ITEM_COLORS.fizz;
    return wrap(`<path d="M8 40 C6 30 18 26 26 30 C30 22 46 22 50 30 C60 30 60 44 50 46 C44 54 26 54 20 48 C10 50 6 46 8 40 Z" fill="${hex(c.main)}" stroke="${O}" stroke-width="3" stroke-linejoin="round"/>
<path d="M18 38 C22 34 30 36 34 34" stroke="${hex(c.accent)}" stroke-width="4" fill="none" stroke-linecap="round"/>
<g fill="#fff6e0" stroke="${O}" stroke-width="2"><circle cx="24" cy="16" r="5"/><circle cx="38" cy="12" r="3.5"/><circle cx="46" cy="20" r="4"/><circle cx="32" cy="22" r="2.5"/></g>`);
  },
  shield: () => {
    const c = ITEM_COLORS.shield;
    return wrap(`<circle cx="32" cy="32" r="24" fill="${hex(c.main)}" fill-opacity=".55" stroke="${O}" stroke-width="3.5"/>
<circle cx="32" cy="32" r="18" fill="none" stroke="${hex(c.accent)}" stroke-width="2.5" stroke-opacity=".7"/>
<path d="M18 24 A16 16 0 0 1 30 14" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/>`);
  },
  magnet: () => {
    const c = ITEM_COLORS.magnet;
    return wrap(`<path d="M14 12 V32 A18 18 0 0 0 50 32 V12 H38 V32 A6 6 0 0 1 26 32 V12 Z" fill="${hex(c.main)}" stroke="${O}" stroke-width="3.5" stroke-linejoin="round"/>
<rect x="14" y="8" width="12" height="10" fill="${hex(c.accent)}" stroke="${O}" stroke-width="3"/>
<rect x="38" y="8" width="12" height="10" fill="${hex(c.accent)}" stroke="${O}" stroke-width="3"/>
<path d="M19 34 A13 13 0 0 0 26 45" stroke="#fff" stroke-opacity=".6" stroke-width="3" fill="none" stroke-linecap="round"/>`);
  },
  warp: () => {
    const c = ITEM_COLORS.warp;
    return wrap(`<path d="M6 44 L40 20 L58 20 L24 44 Z" fill="${hex(c.main)}" stroke="${O}" stroke-width="3" stroke-linejoin="round"/>
<path d="M14 40 L42 22" stroke="${hex(c.accent)}" stroke-width="3" stroke-linecap="round"/>
<path d="M4 30 H20 M8 22 H26 M2 38 H12" stroke="${hex(c.glow)}" stroke-width="3.5" stroke-linecap="round"/>
<path d="M48 12 L51 18 L57 20 L51 22 L48 28 L45 22 L39 20 L45 18 Z" fill="#fff" stroke="${O}" stroke-width="1.8" stroke-linejoin="round"/>`);
  },
  pulse: () => {
    const c = ITEM_COLORS.pulse;
    return wrap(`<circle cx="32" cy="32" r="25" fill="none" stroke="${O}" stroke-width="8"/>
<circle cx="32" cy="32" r="25" fill="none" stroke="${hex(c.main)}" stroke-width="4"/>
<circle cx="32" cy="32" r="15" fill="none" stroke="${O}" stroke-width="7"/>
<circle cx="32" cy="32" r="15" fill="none" stroke="${hex(c.accent)}" stroke-width="3"/>
<circle cx="32" cy="32" r="6" fill="${hex(c.main)}" stroke="${O}" stroke-width="3"/>`);
  },
};

const urlCache = new Map<KartIconId, string>();

/** Raw SVG markup for an item icon. */
export function itemIconSvg(id: KartIconId): string {
  return (ICONS[id] ?? ICONS.prism)();
}

/** `data:image/svg+xml` URL for an <img> (cached). */
export function itemIconUrl(id: KartIconId): string {
  let u = urlCache.get(id);
  if (!u) {
    u = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(itemIconSvg(id));
    urlCache.set(id, u);
  }
  return u;
}
