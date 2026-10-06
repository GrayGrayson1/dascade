/**
 * Procedural art for Halloween Night (original SVG, generated once, served as data URIs). Deterministic:
 * the same haunted hall every visit. No text inside the SVGs (data-URI images can't use the page's fonts).
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

/** A little bat silhouette, 28 × 10, centred on (0, 0). */
const BAT_PATH =
  'M-14 -1C-11 -4 -7 -4 -5 -1C-4 -3 -3 -4 -2 -3L-1 -5L0 -3L1 -5L2 -3C3 -4 4 -3 5 -1C7 -4 11 -4 14 -1C11 0 9 2 8 5C6 3 4 3 3 5C2 3 -2 3 -3 5C-4 3 -6 3 -8 5C-9 2 -11 0 -14 -1Z';

const star = (x: number, y: number, r: number) =>
  `M${x} ${y - r}L${x + r * 0.3} ${y - r * 0.3}L${x + r} ${y}L${x + r * 0.3} ${y + r * 0.3}L${x} ${y + r}L${x - r * 0.3} ${y + r * 0.3}L${x - r} ${y}L${x - r * 0.3} ${y - r * 0.3}Z`;

/** Plum wallpaper with a faint damask of bats and twinkly stars. */
export const WALL = (() => {
  const r = prng(1031);
  const S = 220;
  const parts: string[] = [
    `<rect width="${S}" height="${S}" fill="#1c0b2a"/>`,
    `<rect width="${S / 2}" height="${S}" fill="#1f0c2f"/>`,
    `<path d="M${S / 2} 0V${S}" stroke="#2a1240" stroke-width="2"/>`,
  ];
  for (let gy = 0; gy < 2; gy++)
    for (let gx = 0; gx < 2; gx++) {
      const x = gx * 110 + 30 + r() * 50;
      const y = gy * 110 + 30 + r() * 50;
      if ((gx + gy) % 2 === 0) {
        parts.push(
          `<path d="${BAT_PATH}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(r() * 30 - 15).toFixed(0)})" fill="#33164d" opacity=".75"/>`,
        );
      } else {
        parts.push(`<path d="${star(x, y, 6)}" fill="#3a1a58" opacity=".8"/>`);
        parts.push(`<circle cx="${(x + 18).toFixed(1)}" cy="${(y - 14).toFixed(1)}" r="1.6" fill="#4a2470" opacity=".8"/>`);
      }
    }
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${parts.join('')}</svg>`);
})();

/** Purple-and-black checkerboard floor tiles with a few polished specks. */
export const CHECKER = (() => {
  const r = prng(1099);
  const specks: string[] = [];
  for (let i = 0; i < 10; i++) {
    specks.push(
      `<circle cx="${(r() * 120).toFixed(1)}" cy="${(r() * 120).toFixed(1)}" r="${(0.6 + r() * 0.8).toFixed(1)}" fill="#fff" opacity=".06"/>`,
    );
  }
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="#0f0717"/><rect width="60" height="60" fill="#2a1240"/><rect x="60" y="60" width="60" height="60" fill="#2a1240"/><path d="M0 60H120M60 0V120" stroke="#3a1a58" stroke-width="1" opacity=".6"/>${specks.join('')}</svg>`,
  );
})();

/** An arched window with a big, sleepy, smiling moon, a bare branch and two bats. */
export const WINDOW = svgUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="260" viewBox="0 0 200 260">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1660"/><stop offset="1" stop-color="#5a2a6e"/></linearGradient>
    <radialGradient id="glow" cx=".6" cy=".38" r=".5"><stop offset="0" stop-color="#ffe9b0" stop-opacity=".55"/><stop offset="1" stop-color="#ffe9b0" stop-opacity="0"/></radialGradient>
  </defs>
  <path d="M10 252V110A90 90 0 0 1 190 110V252Z" fill="#2a1240"/>
  <path d="M22 244V112A78 78 0 0 1 178 112V244Z" fill="url(#sky)"/>
  <path d="M22 244V112A78 78 0 0 1 178 112V244Z" fill="url(#glow)"/>
  <g fill="#fff6e6"><circle cx="48" cy="96" r="1.4"/><circle cx="70" cy="64" r="1"/><circle cx="160" cy="176" r="1.2"/><circle cx="44" cy="196" r="1"/><circle cx="150" cy="56" r="1"/></g>
  <circle cx="122" cy="102" r="44" fill="#ffe9b0"/>
  <g fill="#f3d898"><circle cx="102" cy="80" r="6"/><circle cx="146" cy="122" r="5"/><circle cx="140" cy="76" r="3.5"/></g>
  <g fill="none" stroke="#a57b3e" stroke-width="3" stroke-linecap="round"><path d="M104 98q6-7 12 0"/><path d="M128 98q6-7 12 0"/><path d="M112 114q10 9 20 0"/></g>
  <g fill="#ffb3a0" opacity=".75"><circle cx="100" cy="110" r="5"/><circle cx="144" cy="110" r="5"/></g>
  <path d="M22 176C52 166 74 160 100 168M58 170C66 158 74 152 86 148M74 162C82 160 90 162 96 158" fill="none" stroke="#140820" stroke-width="5" stroke-linecap="round"/>
  <path d="${BAT_PATH}" transform="translate(64 128) scale(.8)" fill="#140820"/>
  <path d="${BAT_PATH}" transform="translate(84 150) scale(.55) rotate(-12)" fill="#140820"/>
  <path d="M100 32V244M22 172H178" stroke="#2a1240" stroke-width="6"/>
  <rect x="0" y="244" width="200" height="16" rx="3" fill="#3a1f12"/>
  <rect x="0" y="244" width="200" height="4" rx="2" fill="#5a3420"/>
</svg>`,
);

/** A sagging string of party lights: pumpkin, witch purple, slime and candy corn. */
export const LIGHTS = (() => {
  const inks = ['#ff8a3d', '#b57bff', '#7df04a', '#ffc93c'];
  const bulbs = [20, 60, 100, 140].map((x, i) => {
    const y = 13.5;
    return `<g transform="translate(${x} ${y})"><rect x="-2.5" y="-3" width="5" height="4" rx="1" fill="#2a1a10"/><ellipse cy="5" rx="4" ry="5.5" fill="${inks[i]}"/><ellipse cx="-1.2" cy="3.2" rx="1.2" ry="2" fill="#fff" opacity=".55"/></g>`;
  });
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40" viewBox="0 0 160 40"><path d="M0 6Q40 26 80 6Q120 26 160 6" fill="none" stroke="#120818" stroke-width="2"/>${bulbs.join('')}</svg>`,
  );
})();

/** Paper bats dangling on strings at different heights. */
export const PAPER_BATS = (() => {
  const r = prng(1313);
  const parts: string[] = [];
  for (let i = 0; i < 3; i++) {
    const x = 50 + i * 100 + r() * 20;
    const y = 30 + r() * 40;
    const tilt = (r() * 24 - 12).toFixed(0);
    parts.push(
      `<path d="M${x.toFixed(1)} 0V${(y - 5).toFixed(1)}" stroke="#d6beff" stroke-width=".8" opacity=".35"/>`,
      `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${tilt}) scale(1.4)"><path d="${BAT_PATH}" fill="#1a0a26" stroke="#4a2470" stroke-width=".8"/><circle cx="-1.6" cy="0" r=".9" fill="#ffc93c"/><circle cx="1.6" cy="0" r=".9" fill="#ffc93c"/></g>`,
    );
  }
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="90" viewBox="0 0 300 90">${parts.join('')}</svg>`);
})();

/** CSS variables for the environment's inline style. */
export const ART_VARS: Readonly<Record<string, string>> = {
  '--hn-wall': WALL,
  '--hn-checker': CHECKER,
  '--hn-window': WINDOW,
  '--hn-lights': LIGHTS,
  '--hn-bats': PAPER_BATS,
};

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
