/**
 * The ringed gas giant outside the orbital window — "rendered on a 1996 workstation".
 * A banded texture is generated once (seamless horizontally, stored twice side by side), then each
 * frame maps it onto a disc in vertical strips (x → asin for a spherical look), adds a terminator,
 * an atmosphere rim, and a tilted ring drawn in two halves (behind / in front of the planet).
 * Decorative only; never used by game logic.
 */

export interface PlanetTexture {
  canvas: HTMLCanvasElement;
  /** Width of ONE period (the canvas holds two). */
  period: number;
  height: number;
}

const BANDS = ['#3b2a86', '#6a3fb5', '#9b59d0', '#e07ab8', '#f3b58a', '#f7d9b0', '#7fd6e0', '#4d8fd0', '#6a3fb5', '#2c2170'];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

export function makePlanetTexture(): PlanetTexture {
  const period = 512;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = period * 2;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, period, height };
  const cols = BANDS.map(hexToRgb);
  const TAU = Math.PI * 2;
  // Bands: each row's colour is a blend along the band list, warped by seamless horizontal waves.
  for (let x = 0; x < period; x += 2) {
    const u = x / period;
    for (let y = 0; y < height; y += 2) {
      const v = y / height;
      const warp = 0.018 * Math.sin(TAU * (u * 3) + v * 19) + 0.012 * Math.sin(TAU * (u * 7) + v * 41) + 0.006 * Math.sin(TAU * u * 13 + v * 90);
      const p = Math.min(0.9999, Math.max(0, v + warp)) * (cols.length - 1);
      const i = Math.floor(p);
      const t = p - i;
      ctx.fillStyle = mix(cols[i]!, cols[Math.min(cols.length - 1, i + 1)]!, t * t * (3 - 2 * t));
      ctx.fillRect(x, y, 2, 2);
    }
  }
  // Storms: a big "Great Spot" and a couple of small ovals.
  const storm = (cx: number, cy: number, rx: number, ry: number, inner: string, outer: string) => {
    for (const off of [0, -period, period]) {
      const g = ctx.createRadialGradient(cx + off, cy, 0, cx + off, cy, rx);
      g.addColorStop(0, inner);
      g.addColorStop(0.55, outer);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.translate(cx + off, cy);
      ctx.scale(1, ry / rx);
      ctx.translate(-(cx + off), -cy);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx + off, cy, rx, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  };
  storm(330, 158, 40, 20, 'rgba(255,120,150,0.95)', 'rgba(224,122,184,0.6)');
  storm(120, 88, 16, 8, 'rgba(255,255,255,0.8)', 'rgba(127,214,224,0.5)');
  storm(440, 196, 12, 6, 'rgba(255,240,220,0.8)', 'rgba(243,181,138,0.5)');
  // Duplicate the period so a strip never has to wrap.
  ctx.drawImage(canvas, 0, 0, period, height, period, 0, period, height);
  return { canvas, period, height };
}

/** Draws the planet + ring into a square canvas of `size`. `turn` is in revolutions (any real). */
export function drawPlanet(ctx: CanvasRenderingContext2D, tex: PlanetTexture, size: number, turn: number): void {
  const c = size / 2;
  const R = size * 0.3;
  const tilt = -0.38;
  const TAU = Math.PI * 2;
  ctx.clearRect(0, 0, size, size);

  const ring = (front: boolean) => {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(tilt);
    ctx.beginPath();
    // front half = lower half of the ellipse (in the ring's frame)
    if (front) ctx.rect(-size, 0, size * 2, size);
    else ctx.rect(-size, -size, size * 2, size);
    ctx.clip();
    const bands: [number, string, number][] = [
      [1.42, 'rgba(247,217,176,0.55)', 5],
      [1.58, 'rgba(224,122,184,0.5)', 7],
      [1.76, 'rgba(127,214,224,0.42)', 4],
      [1.9, 'rgba(238,246,255,0.3)', 3],
    ];
    for (const [k, col, lw] of bands) {
      ctx.strokeStyle = col;
      ctx.lineWidth = (lw * size) / 360;
      ctx.beginPath();
      ctx.ellipse(0, 0, R * k, R * k * 0.24, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  };

  ring(false);

  // Sphere: strips mapped with asin for longitude.
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, R, 0, TAU);
  ctx.clip();
  ctx.fillStyle = '#2c2170';
  ctx.fillRect(c - R, c - R, R * 2, R * 2);
  const strip = Math.max(2, Math.round(size / 150));
  const base = (((turn % 1) + 1) % 1) * tex.period;
  for (let x = -R; x < R; x += strip) {
    const mid = Math.max(-0.9999, Math.min(0.9999, (x + strip / 2) / R));
    const u0 = Math.asin(Math.max(-1, Math.min(1, x / R))) / Math.PI + 0.5;
    const u1 = Math.asin(Math.max(-1, Math.min(1, (x + strip) / R))) / Math.PI + 0.5;
    const sx = base + u0 * (tex.period / 2);
    const sw = Math.max(0.5, (u1 - u0) * (tex.period / 2));
    // slight vertical squash toward the limb reads as curvature
    const squash = Math.sqrt(1 - mid * mid);
    const hh = R * (0.94 + 0.06 * squash);
    ctx.drawImage(tex.canvas, sx, 0, sw, tex.height, c + x, c - hh, strip + 0.6, hh * 2);
  }
  // Terminator: lit from the upper left.
  const shade = ctx.createLinearGradient(c - R * 0.9, c - R * 0.7, c + R, c + R * 0.8);
  shade.addColorStop(0, 'rgba(255,255,255,0.12)');
  shade.addColorStop(0.45, 'rgba(0,0,0,0)');
  shade.addColorStop(0.72, 'rgba(4,6,26,0.55)');
  shade.addColorStop(1, 'rgba(4,6,26,0.92)');
  ctx.fillStyle = shade;
  ctx.fillRect(c - R, c - R, R * 2, R * 2);
  // Limb darkening.
  const limb = ctx.createRadialGradient(c, c, R * 0.6, c, c, R);
  limb.addColorStop(0, 'rgba(0,0,0,0)');
  limb.addColorStop(1, 'rgba(4,6,26,0.55)');
  ctx.fillStyle = limb;
  ctx.fillRect(c - R, c - R, R * 2, R * 2);
  ctx.restore();

  // Atmosphere rim.
  const rim = ctx.createRadialGradient(c, c, R * 0.96, c, c, R * 1.16);
  rim.addColorStop(0, 'rgba(127,214,224,0.5)');
  rim.addColorStop(1, 'rgba(127,214,224,0)');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(c, c, R * 1.16, 0, TAU);
  ctx.arc(c, c, R * 0.96, 0, TAU, true);
  ctx.fill();

  ring(true);
}
