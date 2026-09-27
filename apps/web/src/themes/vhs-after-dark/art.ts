/**
 * Procedural art for VHS After Dark (original SVG, generated once, served as data URIs):
 * rental shelves packed with tapes, the store's linoleum floor, and a couple of helpers.
 */
import { useEffect, useState } from 'react';

export const svgUrl = (svg: string): string => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

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

const SPINE = ['#c8303a', '#e8c547', '#2f5fb0', '#e9e4d6', '#3b8f5a', '#7a3fa0', '#d8702a', '#1d8f95'];
const COVER = [
  ['#1a0f2e', '#ff3d6e'],
  ['#08202a', '#4fe3e0'],
  ['#2a1206', '#ffb347'],
  ['#0d1a3a', '#5b8cff'],
  ['#200a0a', '#ff4d5a'],
  ['#0e2014', '#5fe39a'],
];

/** Three shelves of rental tapes: mostly black clamshell spines, a few bright ones, some faced out. */
export const SHELVES = (() => {
  const r = prng(1989);
  const W = 1180;
  const ROW = 132;
  const parts: string[] = [`<rect width="${W}" height="${ROW * 3}" fill="#0b0c12"/>`];
  for (let row = 0; row < 3; row++) {
    const y0 = row * ROW;
    parts.push(`<rect x="0" y="${y0}" width="${W}" height="${ROW}" fill="#101219"/>`);
    let x = 6;
    while (x < W - 24) {
      const faceOut = r() < 0.07 && x < W - 90;
      if (faceOut) {
        const [bg, ink] = COVER[Math.floor(r() * COVER.length)]!;
        const w = 70;
        const h = 104;
        const y = y0 + ROW - 16 - h;
        const shape = Math.floor(r() * 3);
        parts.push(
          `<g opacity=".7">`,
          `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${bg}"/>`,
          shape === 0
            ? `<circle cx="${x + w / 2}" cy="${y + 44}" r="20" fill="none" stroke="${ink}" stroke-width="4"/>`
            : shape === 1
              ? `<path d="M${x + 10} ${y + 70}L${x + w / 2} ${y + 22}L${x + w - 10} ${y + 70}Z" fill="${ink}" opacity=".85"/>`
              : `<path d="M${x + 8} ${y + 60}h${w - 16}M${x + 8} ${y + 48}h${w - 26}M${x + 8} ${y + 36}h${w - 36}" stroke="${ink}" stroke-width="5"/>`,
          `<rect x="${x + 6}" y="${y + 80}" width="${w - 12}" height="8" fill="${ink}" opacity=".9"/>`,
          `<rect x="${x + 6}" y="${y + 92}" width="${w - 30}" height="3" fill="#fff" opacity=".4"/>`,
          `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="url(#sh)"/>`,
          `</g>`,
        );
        x += w + 4;
        continue;
      }
      const w = 16 + Math.floor(r() * 5);
      const h = 96 + Math.floor(r() * 10);
      const y = y0 + ROW - 16 - h;
      const bright = r() < 0.24;
      const col = bright ? SPINE[Math.floor(r() * SPINE.length)]! : r() < 0.5 ? '#16171e' : '#1c1d25';
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${col}"/>`);
      // Tape label on the spine.
      const ly = y + 10 + Math.floor(r() * 30);
      parts.push(
        `<rect x="${x + 2}" y="${ly}" width="${w - 4}" height="${36 + Math.floor(r() * 20)}" fill="${bright ? '#f1e8d0' : '#d9d0b6'}" opacity="${bright ? 0.9 : 0.75}"/>`,
        `<rect x="${x + w / 2 - 1}" y="${ly + 5}" width="2" height="${22 + Math.floor(r() * 12)}" fill="#1b1c28" opacity=".6"/>`,
      );
      if (r() < 0.18) parts.push(`<circle cx="${x + w / 2}" cy="${y + h - 14}" r="5" fill="${r() < 0.5 ? '#ff7a1a' : '#5fe39a'}"/>`);
      parts.push(`<rect x="${x}" y="${y}" width="1.5" height="${h}" fill="#fff" opacity=".08"/>`);
      x += w + 1;
    }
    // Shelf lip + price rail with little tags.
    parts.push(
      `<rect x="0" y="${y0 + ROW - 16}" width="${W}" height="5" fill="#3a3f4c"/>`,
      `<rect x="0" y="${y0 + ROW - 11}" width="${W}" height="11" fill="#1c1f28"/>`,
    );
    for (let t = 20; t < W; t += 90 + Math.floor(r() * 60)) {
      parts.push(`<rect x="${t}" y="${y0 + ROW - 10}" width="26" height="8" fill="#e9e2cd" opacity=".75"/>`);
    }
  }
  // Uprights.
  parts.push(
    `<rect x="0" y="0" width="6" height="${ROW * 3}" fill="#23262f"/>`,
    `<rect x="${W - 6}" y="0" width="6" height="${ROW * 3}" fill="#23262f"/>`,
  );
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${ROW * 3}" viewBox="0 0 ${W} ${ROW * 3}"><defs><linearGradient id="sh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>${parts.join('')}</svg>`,
  );
})();

/** Commercial linoleum tiles, scuffed. */
export const LINO = (() => {
  const r = prng(88);
  const parts: string[] = [];
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++)
      parts.push(`<rect x="${x * 60}" y="${y * 60}" width="60" height="60" fill="${(x + y) % 2 ? '#1a1d27' : '#232733'}"/>`);
  for (let i = 0; i < 40; i++)
    parts.push(`<rect x="${(r() * 120).toFixed(1)}" y="${(r() * 120).toFixed(1)}" width="2" height="1" fill="#fff" opacity=".06"/>`);
  parts.push(`<path d="M0 .5H120M.5 0V120M60.5 0V120M0 60.5H120" stroke="#0c0d12" stroke-width="1"/>`);
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">${parts.join('')}</svg>`);
})();

/** True while the document is visible (animations/clocks pause on hidden tabs). */
export function useDocVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function vcrTime(): string {
  const d = new Date();
  const h = d.getHours();
  const h12 = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()} 1989  ${h12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The VCR's on-screen clock: today's date and time, in 1989. Refreshes while enabled (visible). */
export function useVcrClock(enabled: boolean): string {
  const [text, setText] = useState(vcrTime);
  useEffect(() => {
    if (!enabled) return;
    setText(vcrTime());
    const id = window.setInterval(() => setText(vcrTime()), 20_000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return text;
}
