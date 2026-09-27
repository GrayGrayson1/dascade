/**
 * Standalone sports/action cabinets: DAS Putt (a windmill hole, bank shot,
 * hole in one) and DAS Tanks (a shell arcs over the hills: direct hit).
 */
import {
  banner,
  blinkOn,
  clamp,
  confetti,
  cyc,
  disc,
  easeOut,
  frame,
  hash,
  layer,
  line,
  rect,
  sparkle,
  sprite,
  starfield,
  type AttractFrame,
  type Scene,
} from '../attractKit.ts';

// ---------------------------------------------------------------------------
// DAS Putt
// ---------------------------------------------------------------------------
const PUTT_C = 8.2;

export const putt: Scene = {
  label: 'DAS PUTT',
  length: PUTT_C,
  still: 5.3,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, PUTT_C);
    const m = 4;
    const cx0 = m;
    const cy0 = m;
    const cw = W - m * 2;
    const ch = H - m * 2;
    const wallX = Math.round(cx0 + cw * 0.56);
    const wallTop = Math.round(cy0 + ch * 0.42);
    layer(ctx, 'putt', W, H, (c) => {
      rect(c, 0, 0, W, H, '#051018');
      // turf with mowing stripes + dither
      for (let y = cy0; y < cy0 + ch; y++)
        for (let x = cx0; x < cx0 + cw; x++) {
          const stripe = Math.floor((x - cx0) / 6) % 2;
          const n = hash(x * 13.7 + y * 7.1) > 0.95;
          rect(c, x, y, 1, 1, n ? '#2fb866' : stripe ? '#1c9450' : '#188546');
        }
      // glowing walls
      frame(c, cx0 - 1, cy0 - 1, cw + 2, ch + 2, '#22d3ee');
      frame(c, cx0 - 2, cy0 - 2, cw + 4, ch + 4, '#0b5566');
      // inner wall (dog-leg)
      rect(c, wallX, wallTop, 2, cy0 + ch - wallTop, '#22d3ee');
      rect(c, wallX + 2, wallTop, 1, cy0 + ch - wallTop, '#0b5566');
      // sand trap
      const sx = Math.round(cx0 + cw * 0.18);
      const sy = Math.round(cy0 + ch * 0.2);
      for (let y = 0; y < 5; y++)
        for (let x = 0; x < 10; x++)
          if ((x - 4.5) ** 2 / 25 + (y - 2) ** 2 / 6 <= 1) rect(c, sx + x, sy + y, 1, 1, hash(x + y * 7) > 0.7 ? '#f5dca0' : '#e6c67a');
    });
    // cup + flag
    const hx = Math.round(cx0 + cw * 0.8);
    const hy = Math.round(cy0 + ch * 0.72);
    disc(ctx, hx, hy, 2.2, '#062014');
    disc(ctx, hx, hy, 1.2, '#000000');
    const inCup = tt > 4.35;
    const flagWave = f.still ? 0 : Math.floor(f.t * 4) % 2;
    if (!inCup || tt > 6.2) {
      rect(ctx, hx, hy - 11, 1, 11, '#e6e6f0');
      rect(ctx, hx + 1, hy - 11, 4, 3, '#ff4f81');
      rect(ctx, hx + 5, hy - 10 + flagWave, 1, 1, '#ff4f81');
    }
    // windmill (spinning blades) at the corner of the dog-leg
    const wx = Math.round(cx0 + cw * 0.36);
    const wy = Math.round(cy0 + ch * 0.62);
    rect(ctx, wx - 3, wy - 2, 7, 7, '#8a3b1a');
    rect(ctx, wx - 2, wy - 5, 5, 3, '#b8542a');
    rect(ctx, wx - 1, wy + 2, 3, 3, '#2a0f06');
    const spin = f.still ? 0.4 : f.t * 2.2;
    for (let b = 0; b < 4; b++) {
      const a = spin + (b * Math.PI) / 2;
      line(ctx, wx, wy - 3, wx + Math.cos(a) * 7, wy - 3 + Math.sin(a) * 7, b % 2 ? '#fff3b0' : '#ffd23f');
    }
    disc(ctx, wx, wy - 3, 1, '#ffffff');
    // the ball: aim, strike, bank off the top wall, roll into the cup
    const tee: [number, number] = [cx0 + cw * 0.12, cy0 + ch * 0.8];
    const bank: [number, number] = [cx0 + cw * 0.62, cy0 + 1.5];
    const cup: [number, number] = [hx, hy];
    const strike = 1.8;
    let bx = tee[0];
    let by = tee[1];
    if (tt < strike) {
      // aim line + power meter
      const aim = clamp((tt - 0.3) / 1.2, 0, 1);
      const dx = bank[0] - tee[0];
      const dy = bank[1] - tee[1];
      for (let k = 0.08; k < 0.45 * aim + 0.08; k += 0.06) rect(ctx, tee[0] + dx * k, tee[1] + dy * k, 1, 1, '#ffffff');
      const mh = Math.max(8, Math.round(ch * 0.5));
      const mx = cx0 + 2;
      const my = cy0 + ch - mh - 2;
      rect(ctx, mx, my, 3, mh, '#062014');
      const p = Math.round(mh * aim * 0.82);
      rect(ctx, mx, my + mh - p, 3, p, aim > 0.7 ? '#ff8a3d' : '#ffd23f');
    } else if (tt < 4.35) {
      const leg1 = 1.1;
      const s = tt - strike;
      if (s < leg1) {
        const k = easeOut(s / leg1) * 0.98 + 0.02 * (s / leg1);
        bx = tee[0] + (bank[0] - tee[0]) * k;
        by = tee[1] + (bank[1] - tee[1]) * k;
      } else {
        const k = easeOut(clamp((s - leg1) / (4.35 - strike - leg1), 0, 1));
        bx = bank[0] + (cup[0] - bank[0]) * k;
        by = bank[1] + (cup[1] - bank[1]) * k;
      }
      // trail
      for (let i = 1; i < 6; i++) {
        const back = Math.max(0, s - i * 0.035);
        let tx: number;
        let ty: number;
        if (back < leg1) {
          const k = easeOut(back / leg1);
          tx = tee[0] + (bank[0] - tee[0]) * k;
          ty = tee[1] + (bank[1] - tee[1]) * k;
        } else {
          const k = easeOut(clamp((back - leg1) / (4.35 - strike - leg1), 0, 1));
          tx = bank[0] + (cup[0] - bank[0]) * k;
          ty = bank[1] + (cup[1] - bank[1]) * k;
        }
        rect(ctx, tx, ty, 1, 1, `rgba(255,255,255,${(0.5 - i * 0.08).toFixed(2)})`);
      }
      if (Math.abs(s - leg1) < 0.12) sparkle(ctx, bank[0], bank[1] + 1, s * 8, '#22d3ee');
    }
    if (!inCup) {
      disc(ctx, bx + 0.5, by + 1, 1.2, 'rgba(0,0,0,0.45)');
      disc(ctx, bx, by, 1.2, '#ffffff');
    }
    if (inCup && tt < PUTT_C - 0.4) {
      const since = tt - 4.35;
      confetti(ctx, hx, hy - 4, since, 20, W, H, 5);
      for (let i = 0; i < 4; i++)
        sparkle(ctx, hx + Math.cos(i * 1.6 + f.t) * 6, hy + Math.sin(i * 1.6 + f.t) * 5, since * 3 + i * 0.3, '#fff3b0');
      if (f.hud) banner(ctx, 'HOLE IN ONE!', W, H * 0.3, blinkOn(f, tt) ? '#ffd23f' : '#ffffff', '#051018', W >= 120 ? 2 : 1);
    }
  },
};

// ---------------------------------------------------------------------------
// DAS Tanks
// ---------------------------------------------------------------------------
const TANKS_C = 8.6;
const TANK = ['..tt...', '.tttt..', 'bbbbbbb', 'wwwwwww', '.w.w.w.'];

function terrainY(x: number, W: number, H: number, crater: { x: number; r: number; k: number } | null): number {
  const u = x / W;
  let y = H * 0.66 + Math.sin(u * 5.2 + 0.6) * H * 0.08 + Math.sin(u * 11.3 + 2.1) * H * 0.035 + (hash(Math.floor(x / 3)) - 0.5) * 1.2;
  if (crater && crater.k > 0) {
    const d = Math.abs(x - crater.x);
    if (d < crater.r) y += Math.sqrt(crater.r * crater.r - d * d) * 0.7 * crater.k;
  }
  return y;
}

export const tanks: Scene = {
  label: 'DAS TANKS',
  length: TANKS_C,
  still: 4.1,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, TANKS_C);
    // sky gradient
    for (let y = 0; y < H; y++) {
      const k = y / H;
      const r = Math.round(18 + k * 50);
      const g = Math.round(8 + k * 14);
      const b = Math.round(40 + k * 30);
      rect(ctx, 0, y, W, 1, `rgb(${r},${g},${b})`);
    }
    starfield(ctx, W, H * 0.5, f.still ? 0 : f.t, 18, 0.6, 4);
    // far hills (parallax silhouette)
    for (let x = 0; x < W; x++) {
      const y = H * 0.5 + Math.sin(x * 0.09 + 1.3) * H * 0.06 + Math.sin(x * 0.23) * H * 0.02;
      rect(ctx, x, y, 1, H - y, '#2a1846');
    }
    const lx = Math.round(W * 0.16);
    const rxT = Math.round(W * 0.8);
    const fireAt = 1.9;
    const flight = 1.45;
    const impact = fireAt + flight;
    const craterK = clamp((tt - impact) / 0.25, 0, 1);
    const crater = { x: rxT - 1, r: Math.max(4, W * 0.06), k: tt > impact ? craterK : 0 };
    // terrain with glowing edge
    for (let x = 0; x < W; x++) {
      const y = Math.round(terrainY(x, W, H, crater));
      rect(ctx, x, y, 1, H - y, '#1e3a1a');
      rect(ctx, x, y + 2, 1, H - y, '#162c14');
      rect(ctx, x, y, 1, 1, '#7cf57a');
      if (hash(x * 3.7) > 0.8) rect(ctx, x, y + 3 + Math.floor(hash(x) * 6), 1, 1, '#2d5a26');
    }
    const lY = Math.round(terrainY(lx + 3, W, H, null)) - 5;
    const rY = Math.round(terrainY(rxT + 3, W, H, crater)) - 5;
    // turret angle sweeps up while aiming
    const aim = clamp((tt - 0.4) / 1.2, 0, 1);
    const angle = (-0.25 - aim * 0.55) * Math.PI * 0.5;
    const hitShake = tt > impact && tt < impact + 0.3 && !f.still ? (Math.floor(tt * 30) % 2 ? 1 : -1) : 0;
    sprite(ctx, TANK, lx, lY, { t: '#ff4fd8', b: '#c02aa8', w: '#3a1440' });
    line(ctx, lx + 3, lY + 1, lx + 3 + Math.cos(angle) * 5, lY + 1 + Math.sin(angle) * 5, '#ffb3ee');
    sprite(ctx, TANK, rxT + hitShake, rY, { t: '#22d3ee', b: '#1597b0', w: '#0a3440' }, 1, true);
    line(ctx, rxT + 3 + hitShake, rY + 1, rxT + hitShake - 1, rY - 2, '#a6f3ff');
    // health bars
    const hp = tt > impact ? 1 - 0.55 * craterK : 1;
    rect(ctx, rxT - 1, rY - 5, 9, 2, '#1a0d24');
    rect(ctx, rxT - 1, rY - 5, Math.round(9 * hp), 2, hp < 0.6 ? '#ff5a5f' : '#2de38f');
    rect(ctx, lx - 1, lY - 5, 9, 2, '#2de38f');
    // wind sock
    const windX = W - 12;
    rect(ctx, windX, 3, 1, 7, '#c9c3e6');
    const flap = f.still ? 0 : Math.floor(f.t * 5) % 2;
    rect(ctx, windX - 5, 3 + flap, 5, 2, '#ffd23f');
    // the shell
    const x0 = lx + 3 + Math.cos(angle) * 5;
    const y0 = lY + 1 + Math.sin(angle) * 5;
    const x1 = rxT + 2;
    const y1 = rY + 2;
    const apex = Math.min(y0, y1) - H * 0.42;
    const arc = (k: number): [number, number] => {
      const x = x0 + (x1 - x0) * k;
      const a = (1 - k) * (1 - k) * y0 + 2 * (1 - k) * k * apex + k * k * y1;
      return [x, a];
    };
    if (tt > fireAt && tt < impact) {
      const k = (tt - fireAt) / flight;
      for (let i = 1; i < 10; i++) {
        const kk = k - i * 0.025;
        if (kk < 0) break;
        const [px, py] = arc(kk);
        rect(ctx, px, py, 1, 1, i < 3 ? '#fff3b0' : i < 6 ? '#ff8a3d' : '#7a2a10');
      }
      const [px, py] = arc(k);
      disc(ctx, px, py, 1.1, '#ffffff');
      if (tt - fireAt < 0.15) disc(ctx, x0, y0, 2.5, '#fff3b0');
    }
    if (tt >= impact && tt < impact + 0.7) {
      const e = (tt - impact) / 0.7;
      const r = 2 + e * Math.max(6, W * 0.08);
      disc(ctx, x1, y1, r, e < 0.3 ? '#fff3b0' : e < 0.6 ? '#ff8a3d' : 'rgba(255,90,60,0.5)');
      disc(ctx, x1, y1, r * 0.55, e < 0.5 ? '#ffffff' : '#ffd23f');
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI * (0.1 + hash(i * 3.1) * 0.8);
        const v = 8 + hash(i * 1.7) * 14;
        const dx = Math.cos(a) * v * e * 1.5;
        const dy = Math.sin(a) * v * e * 1.5 + 18 * e * e;
        rect(ctx, x1 + dx, y1 + dy, 1, 1, i % 2 ? '#7cf57a' : '#ffd23f');
      }
    }
    if (tt > impact + 0.2 && tt < TANKS_C - 0.4 && f.hud) {
      banner(ctx, 'DIRECT HIT!', W, Math.max(H * 0.24, f.top + 9), blinkOn(f, tt) ? '#ffd23f' : '#ffffff', '#12082a', W >= 120 ? 2 : 1);
    }
  },
};
