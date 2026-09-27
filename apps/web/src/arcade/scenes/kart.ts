/**
 * DASphalt GP attract scene (DAS Raceway cabinet): a chase view down a neon boulevard toward the
 * giant arcade cabinet. Our kart drifts through a bend (sparks charge cyan → gold → magenta),
 * fires a mini-turbo, slips past a rival and smashes a row of prism cubes.
 * Pure 2D pixel art (no three.js in the arcade chunk); a pure function of time and size.
 */
import { clamp, cyc, disc, drawTextC, hash, layer, rect, sprite, type AttractFrame, type Scene } from '../attractKit.ts';

const LEN = 7.6;

const KART_BACK = [
  '....HHHHH....',
  '...HHVVVHH...',
  '....HHHHH....',
  '..SSOOOOOSS..',
  '.WWWWWWWWWWW.',
  'TT.PPEEEPP.TT',
  'TT.PPPPPPP.TT',
  'TT.RP...PR.TT',
];
const PLAYER = { H: '#f8fafc', V: '#1e2a4a', S: '#f97316', O: '#c2410c', W: '#22d3ee', P: '#22d3ee', E: '#3b4252', R: '#ff3048', T: '#15131d' };
const RIVAL = { H: '#ff4fd8', V: '#fff1f2', S: '#ff4fd8', O: '#be185d', W: '#fff1f2', P: '#ff4fd8', E: '#3b4252', R: '#ff3048', T: '#15131d' };
const STAGE = ['#ffffff', '#38e8ff', '#ffc82e', '#ff3df2'];
const CUBE = ['#39e6ff', '#ff4fd8', '#ffd23f'];

/** Road centre offset (0 = screen centre) at depth fraction p (0 horizon → 1 bottom) and time. */
function curveAt(tt: number, p: number, W: number): number {
  const bend = Math.sin((tt / LEN) * Math.PI * 2) * 0.9;
  return bend * (1 - p) * (1 - p) * W * 0.55;
}

export const kart: Scene = {
  label: 'DASPHALT GP',
  length: LEN,
  still: 3.9,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = f.still ? kart.still : cyc(f.t, LEN);
    const hz = Math.round(H * 0.44);
    const s = Math.max(1, Math.floor(W / 64));

    // --- sky, skyline and the giant cabinet (cached) ---------------------------------------------
    layer(ctx, 'kart-sky', W, H, (c) => {
      const bands = ['#0b0a2a', '#1a1045', '#2d1560', '#4a1d74', '#6b2a86', '#8f3b8f'];
      for (let y = 0; y < hz; y++) rect(c, 0, y, W, 1, bands[Math.min(bands.length - 1, Math.floor((y / hz) * bands.length))]!);
      for (let i = 0; i < W / 3; i++) rect(c, Math.floor(hash(i * 3.1) * W), Math.floor(hash(i * 7.7) * hz * 0.6), 1, 1, hash(i) > 0.7 ? '#ffffff' : '#8b7bd8');
      // skyline
      let x = 0;
      let k = 0;
      while (x < W) {
        const bw = 3 + Math.floor(hash(k * 5.3) * 6);
        const bh = 3 + Math.floor(hash(k * 2.9) * hz * 0.35);
        rect(c, x, hz - bh, bw, bh, '#150d33');
        for (let yy = hz - bh + 1; yy < hz - 1; yy += 2) for (let xx = x + 1; xx < x + bw - 1; xx += 2) if (hash(xx * 1.3 + yy * 7.1) > 0.6) rect(c, xx, yy, 1, 1, hash(xx + yy) > 0.5 ? '#ffd99a' : '#7df3ff');
        x += bw + (hash(k) > 0.7 ? 1 : 0);
        k++;
      }
      // giant cabinet landmark on the horizon
      const cw = Math.max(8, Math.round(W * 0.12));
      const ch = Math.round(hz * 0.55);
      const cx = Math.round(W * 0.5 - cw / 2);
      rect(c, cx, hz - ch, cw, ch, '#3b1d6e');
      rect(c, cx - 1, hz - ch, 1, ch, '#22d3ee');
      rect(c, cx + cw, hz - ch, 1, ch, '#ff4fd8');
      rect(c, cx + 1, hz - ch + 1, cw - 2, Math.max(2, Math.round(ch * 0.14)), '#ffd23f');
      rect(c, cx + 2, hz - ch + Math.round(ch * 0.22), cw - 4, Math.round(ch * 0.34), '#0b1a3a');
      rect(c, cx + 3, hz - ch + Math.round(ch * 0.3), cw - 6, 1, '#2de38f');
    });

    // --- road -------------------------------------------------------------------------------------
    const scroll = tt * 14 + (tt > 4.6 ? (tt - 4.6) * 10 : 0);
    const steer = Math.sin((tt / LEN) * Math.PI * 2) * 0.9;
    for (let y = hz; y < H; y++) {
      const p = (y - hz + 1) / (H - hz);
      const z = 1 / p;
      const band = Math.floor(z * 1.6 + scroll) % 2 === 0;
      const cx = W / 2 + curveAt(tt, p, W) - steer * p * W * 0.08;
      const half = W * 0.06 + p * W * 0.62;
      rect(ctx, 0, y, W, 1, band ? '#123b2a' : '#0f3324');
      const curb = Math.max(1, Math.round(half * 0.09));
      rect(ctx, Math.round(cx - half - curb), y, Math.round(half * 2 + curb * 2), 1, band ? '#ff3d8b' : '#f1f5f9');
      rect(ctx, Math.round(cx - half), y, Math.round(half * 2), 1, band ? '#2b2d3e' : '#262838');
      if (band) rect(ctx, Math.round(cx - Math.max(1, half * 0.02)), y, Math.max(1, Math.round(half * 0.04)), 1, '#ffd23f');
      // neon wall glow lines
      rect(ctx, Math.round(cx - half - curb - Math.max(2, half * 0.2)), y, 1, 1, '#22d3ee');
      rect(ctx, Math.round(cx + half + curb + Math.max(2, half * 0.2)), y, 1, 1, '#22d3ee');
    }

    const kartW = KART_BACK[0]!.length * s;
    const kartH = KART_BACK.length * s;
    const drifting = tt > 1.1 && tt < 4.6;
    const charge = clamp((tt - 1.1) / 3.2, 0, 1);
    const stage = drifting ? (charge < 0.34 ? 1 : charge < 0.7 ? 2 : 3) : 0;
    const turbo = tt >= 4.6 && tt < 5.8;

    // --- rival kart ahead (we reel it in and pass) --------------------------------------------------
    // road depth of our kart's wheels (bottom of the sprite at 78% of the height)
    const playerP = (H * 0.78 - hz) / (H - hz);
    const rp = 0.15 + (tt / LEN) * 0.62;
    const drawRival = () => {
      const rs = Math.max(1, Math.round((s * rp) / playerP));
      const rh = KART_BACK.length * rs;
      const ry = hz + rp * (H - hz) - rh;
      const aside = tt > 4.4 ? Math.min(1, (tt - 4.4) / 0.8) : 0;
      const rx = W / 2 + curveAt(tt, rp, W) + (0.06 + aside * 0.22) * W * (rp / playerP);
      if (ry > hz - rh) sprite(ctx, KART_BACK, rx - (KART_BACK[0]!.length * rs) / 2, ry, RIVAL, rs);
    };
    if (rp <= playerP) drawRival();

    // --- prism cube row rushing toward us -------------------------------------------------------------
    const cubeT = cyc(tt - 2.2, LEN) / 3.2;
    if (cubeT < 1) {
      const cp = 0.08 + cubeT * 0.95;
      const cy = Math.round(hz + cp * (H - hz) - 4 * s * cp);
      const ccx = W / 2 + curveAt(tt, cp, W);
      const half = W * 0.06 + cp * W * 0.62;
      const cs = Math.max(1, Math.round(3 * s * cp));
      for (let i = 0; i < 4; i++) {
        const x = Math.round(ccx - half * 0.6 + (i * half * 1.2) / 3 - cs / 2);
        const bob = Math.round(Math.sin(f.t * 5 + i) * cp);
        rect(ctx, x, cy + bob, cs, cs, CUBE[i % 3]!);
        if (cs >= 3) rect(ctx, x + 1, cy + bob + 1, 1, 1, '#ffffff');
      }
    }
    // shattered cube sparkle at our kart when the row arrives
    const hitT = cyc(tt - 5.4, LEN);
    if (hitT < 0.5) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r = hitT * W * 0.25;
        rect(ctx, Math.round(W / 2 + Math.cos(a) * r), Math.round(H * 0.78 - kartH + Math.sin(a) * r * 0.5), s, s, CUBE[i % 3]!);
      }
    }

    // --- our kart -------------------------------------------------------------------------------------
    const kx = Math.round(W / 2 - kartW / 2 + steer * W * 0.06);
    const ky = Math.round(H * 0.78) - kartH + (Math.floor(f.t * 20) % 2 === 0 && !f.still ? 0 : 1);
    // shadow
    rect(ctx, kx + s, ky + kartH, kartW - 2 * s, s, 'rgba(0,0,0,0.45)');
    sprite(ctx, KART_BACK, kx, ky, PLAYER, s, steer < 0);
    if (drifting && stage > 0) {
      const col = STAGE[stage]!;
      for (let i = 0; i < 6; i++) {
        const ph = f.t * 23 + i * 1.7;
        const sx = (i % 2 ? kx - s : kx + kartW) + Math.round((hash(ph) - 0.5) * 4 * s);
        const sy = ky + kartH - s - Math.round(hash(ph + 3) * 4 * s);
        rect(ctx, sx, sy, s, s, col);
      }
    }
    if (turbo) {
      const fl = f.still ? 2 : 2 + (Math.floor(f.t * 30) % 2);
      rect(ctx, kx + 5 * s, ky + kartH, 3 * s, fl * s, '#ffb04a');
      rect(ctx, kx + 6 * s, ky + kartH, s, (fl + 1) * s, '#fff1d6');
      for (let i = 0; i < 8; i++) {
        const lx = Math.round(hash(i * 9.2 + Math.floor(f.t * 12)) * W);
        const ly = hz + Math.round(hash(i * 4.4 + Math.floor(f.t * 12)) * (H - hz));
        rect(ctx, lx, ly, Math.max(2, s * 3), 1, 'rgba(255,255,255,0.55)');
      }
      if (tt < 4.75) disc(ctx, kx + kartW / 2, ky + kartH / 2, kartW * 0.7, 'rgba(255,61,242,0.35)');
    }
    if (rp > playerP) drawRival();
    if (f.hud && W >= 90) drawTextC(ctx, stage === 3 ? 'MAX DRIFT!' : turbo ? 'TURBO!' : '', W / 2, hz + 3, stage === 3 ? '#ff3df2' : '#ffd23f', 1, '#000000');
  },
};
