/**
 * Procedural art for Mall Arcade '92 (original SVG, generated once, served as data URIs).
 * Deterministic: the same carpet every visit, like a real arcade that never replaced it.
 */
import { useEffect, useState } from 'react';

export const svgUrl = (svg: string): string => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/** Tiny deterministic PRNG (mulberry32) — decoration only. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CARPET_INKS = ['#ff3d9a', '#33d6ff', '#ffcc33', '#9d5cff', '#3d7bff', '#3fe07e', '#ff8c2e'];

/** The ridiculous geometric arcade carpet: triangles, squiggles, rings, bolts and confetti on black. */
export const CARPET = (() => {
  const r = prng(1992);
  const S = 240;
  const parts: string[] = [`<rect width="${S}" height="${S}" fill="#120a22"/>`];
  const ink = () => CARPET_INKS[Math.floor(r() * CARPET_INKS.length)]!;
  // Confetti dashes first (background layer).
  for (let i = 0; i < 34; i++) {
    const x = r() * S;
    const y = r() * S;
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="9" height="3" rx="1.5" fill="${ink()}" opacity=".55" transform="rotate(${Math.floor(r() * 180)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`,
    );
  }
  const shapes = [
    (x: number, y: number, c: string) =>
      `<path d="M${x} ${y - 16}L${x + 15} ${y + 11}H${x - 15}Z" fill="none" stroke="${c}" stroke-width="5" stroke-linejoin="round"/>`,
    (x: number, y: number, c: string) =>
      `<path d="M${x - 22} ${y}c7-12 14 12 22 0s14 12 22 0" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`,
    (x: number, y: number, c: string) => `<circle cx="${x}" cy="${y}" r="11" fill="none" stroke="${c}" stroke-width="5"/>`,
    (x: number, y: number, c: string) =>
      `<path d="M${x - 4} ${y - 18}L${x + 8} ${y - 2}H${x}L${x + 5} ${y + 18}L${x - 9} ${y}H${x - 1}Z" fill="${c}"/>`,
    (x: number, y: number, c: string) =>
      `<path d="M${x - 14} ${y - 14}h28v28h-28z" fill="none" stroke="${c}" stroke-width="4" transform="rotate(20 ${x} ${y})"/>`,
    (x: number, y: number, c: string) => `<circle cx="${x}" cy="${y}" r="6" fill="${c}"/>`,
  ];
  // A jittered 4×4 grid keeps the shapes spread out (no clumps), wrapping at the tile edges.
  for (let gy = 0; gy < 4; gy++)
    for (let gx = 0; gx < 4; gx++) {
      const x = Math.round(gx * 60 + 12 + r() * 36);
      const y = Math.round(gy * 60 + 12 + r() * 36);
      const draw = shapes[Math.floor(r() * shapes.length)]!;
      const c = ink();
      const rot = Math.floor(r() * 360);
      parts.push(`<g transform="rotate(${rot} ${x} ${y})">${draw(x, y, c)}</g>`);
    }
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${parts.join('')}</svg>`);
})();

/** Suspended ceiling: grey-violet tiles on a T-bar grid, one 2×4 fluorescent troffer per block. */
export const CEILING = svgUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
  <rect width="240" height="120" fill="#231b33"/>
  <g fill="#2a2140"><rect x="3" y="3" width="54" height="54"/><rect x="63" y="3" width="54" height="54"/><rect x="183" y="3" width="54" height="54"/>
  <rect x="3" y="63" width="54" height="54"/><rect x="63" y="63" width="54" height="54"/><rect x="123" y="63" width="54" height="54"/><rect x="183" y="63" width="54" height="54"/></g>
  <g fill="#fff" opacity=".04"><circle cx="20" cy="20" r="1"/><circle cx="90" cy="40" r="1"/><circle cx="40" cy="90" r="1"/><circle cx="210" cy="80" r="1"/><circle cx="150" cy="100" r="1"/></g>
  <rect x="123" y="3" width="54" height="54" fill="#d9ecff"/>
  <rect x="127" y="7" width="46" height="46" fill="#f4fbff"/>
  <g fill="#ffffff"><rect x="133" y="9" width="4" height="42"/><rect x="148" y="9" width="4" height="42"/><rect x="163" y="9" width="4" height="42"/></g>
  <path d="M127 7h46v46h-46z" fill="none" stroke="#b9cde6" stroke-width="1"/>
</svg>`,
);

/** The far wall: a row of distant cabinets (silhouettes with lit marquees). Screens are a separate layer. */
const CAB_COLORS = ['#ff3b5c', '#4d8dff', '#b77bff', '#ffcc33', '#3fe07e', '#ff8c2e', '#3fd4ff'];
export const WALL_ROW = (() => {
  const parts: string[] = [];
  for (let i = 0; i < 7; i++) {
    const x = i * 80 + 8;
    const c = CAB_COLORS[i]!;
    parts.push(
      `<path d="M${x} 20h64v6l-4 34h4v70h-64v-70h4l-4-34z" fill="#0a0613"/>`,
      `<rect x="${x + 4}" y="22" width="56" height="12" fill="${c}" opacity=".85"/>`,
      `<rect x="${x + 4}" y="22" width="56" height="4" fill="#fff" opacity=".35"/>`,
      `<rect x="${x - 2}" y="60" width="68" height="6" fill="#1a1128"/>`,
      `<rect x="${x + 26}" y="92" width="12" height="16" fill="#1a1128"/><rect x="${x + 29}" y="96" width="2" height="6" fill="#ff3b4e"/><rect x="${x + 33}" y="96" width="2" height="6" fill="#ff3b4e"/>`,
    );
  }
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="130" viewBox="0 0 560 130">${parts.join('')}</svg>`);
})();

export const WALL_SCREENS = (() => {
  const parts: string[] = [];
  for (let i = 0; i < 7; i++) {
    const x = i * 80 + 8;
    const c = CAB_COLORS[(i + 3) % CAB_COLORS.length]!;
    parts.push(
      `<rect x="${x + 12}" y="38" width="40" height="20" fill="${c}" opacity=".7"/><rect x="${x + 12}" y="38" width="40" height="20" fill="url(#g)"/>`,
    );
  }
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="130" viewBox="0 0 560 130"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></linearGradient></defs>${parts.join('')}</svg>`,
  );
})();

/** Wood-grain laminate (cabinet sides, prize counter). */
export const WOODGRAIN = (() => {
  const r = prng(7);
  const lines: string[] = [];
  for (let i = 0; i < 26; i++) {
    const y = i * 6 + r() * 4;
    const amp = 2 + r() * 5;
    lines.push(
      `<path d="M0 ${y.toFixed(1)}C40 ${(y + amp).toFixed(1)} 80 ${(y - amp).toFixed(1)} 120 ${y.toFixed(1)}S200 ${(y + amp).toFixed(1)} 240 ${y.toFixed(1)}" fill="none" stroke="${r() > 0.5 ? '#3a2412' : '#6b4424'}" stroke-width="${(0.6 + r() * 1.6).toFixed(1)}" opacity=".7"/>`,
    );
  }
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"><rect width="240" height="160" fill="#5a381c"/>${lines.join('')}</svg>`,
  );
})();

/** Fine scratches on plastic/glass (overlay at very low opacity). */
export const SCRATCHES = (() => {
  const r = prng(42);
  const parts: string[] = [];
  for (let i = 0; i < 18; i++) {
    const x = r() * 200;
    const y = r() * 200;
    const len = 10 + r() * 50;
    const a = r() * Math.PI;
    parts.push(
      `<path d="M${x.toFixed(1)} ${y.toFixed(1)}l${(Math.cos(a) * len).toFixed(1)} ${(Math.sin(a) * len).toFixed(1)}" stroke="#fff" stroke-width="${(0.4 + r() * 0.6).toFixed(2)}" opacity="${(0.3 + r() * 0.5).toFixed(2)}"/>`,
    );
  }
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">${parts.join('')}</svg>`);
})();

/** True while the document is visible (animations pause on hidden tabs). */
export function useDocVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/** Game posters on the far wall (original abstract art, no text), spaced out along the wall. */
export const POSTERS = svgUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="100" viewBox="0 0 900 100">
  <defs>
    <linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0f4a"/><stop offset="1" stop-color="#ff3b5c"/></linearGradient>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#061a3a"/><stop offset="1" stop-color="#3fd4ff"/></linearGradient>
    <linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a0a00"/><stop offset="1" stop-color="#ffcc33"/></linearGradient>
  </defs>
  <g transform="translate(40 8)"><rect width="56" height="80" fill="#0a0613"/><rect x="3" y="3" width="50" height="74" fill="url(#a)"/><circle cx="28" cy="34" r="12" fill="#ffcc33"/><ellipse cx="28" cy="34" rx="22" ry="5" fill="none" stroke="#fff7ea" stroke-width="2"/><rect x="8" y="62" width="40" height="5" fill="#fff7ea" opacity=".8"/></g>
  <g transform="translate(340 14)"><rect width="84" height="60" fill="#0a0613"/><rect x="3" y="3" width="78" height="54" fill="url(#b)"/><path d="M10 48L30 20L42 36L54 26L74 48Z" fill="#0a0613" opacity=".7"/><path d="M40 10l6 10h-4l4 12-10-14h5z" fill="#ffcc33"/></g>
  <g transform="translate(650 6)"><rect width="56" height="84" fill="#0a0613"/><rect x="3" y="3" width="50" height="78" fill="url(#c)"/><path d="M8 60L28 18L48 60Z" fill="none" stroke="#ff3b5c" stroke-width="4"/><circle cx="28" cy="46" r="6" fill="#0a0613"/><rect x="8" y="68" width="40" height="5" fill="#0a0613" opacity=".7"/></g>
</svg>`,
);
