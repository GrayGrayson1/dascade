/**
 * Canvas-generated textures (all our own): asphalt with lane paint, curbs, off-road kinds,
 * start/finish checker, boost chevrons, walls, conveyors, particles, name tags and signs.
 *
 * Redrawable textures (asphalt, curbs, off-road) keep their canvas so a theme change repaints them
 * in place (`needsUpdate`), never recreating materials or restarting the scene.
 */
import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearMipmapLinearFilter,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { BiomeId, OffroadKind } from '@dascade/game-core/kart';
import { intToHex, mixInt, shadeInt } from '../art/palette.ts';
import type { OffroadStyle, WallStyle, WorldPalette } from './biomes.ts';
import { hash2, mulberry32 } from './rng.ts';

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return g;
}

export function canvasTexture(c: HTMLCanvasElement, repeat = true, aniso = 4): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.anisotropy = aniso;
  t.minFilter = LinearMipmapLinearFilter;
  return t;
}

const css = intToHex;

function speckle(g: CanvasRenderingContext2D, w: number, h: number, base: number, speck: number, n: number, seed: number, size = 2): void {
  g.fillStyle = css(base);
  g.fillRect(0, 0, w, h);
  const r = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const t = r();
    g.fillStyle = css(t < 0.5 ? speck : mixInt(base, 0x000000, 0.12));
    g.globalAlpha = 0.35 + r() * 0.5;
    g.fillRect(Math.floor(r() * w), Math.floor(r() * h), size, size);
  }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------
// Road
// ---------------------------------------------------------------------------------------------

/** Road texture tile: u = across the road (0 left edge → 1 right edge), v = one tile per ROAD_TILE u. */
export const ROAD_TILE = 16;

/**
 * Road tile. u = across (0 left edge → 1 right edge), v = along (one tile per ROAD_TILE u).
 * Every biome gets surface detail (wear, joints, dust, decals); sky and cyber add glowing rails and
 * chevrons through the glow canvas `gC` (used as the road's emissive map).
 */
export function paintAsphalt(c: HTMLCanvasElement, p: WorldPalette, biome: BiomeId = 'city', gC?: HTMLCanvasElement): void {
  const g = ctx2d(c);
  const w = c.width;
  const h = c.height;
  const gg = gC ? ctx2d(gC) : null;
  if (gg && gC) {
    gg.fillStyle = '#000';
    gg.fillRect(0, 0, gC.width, gC.height);
  }
  const panels = biome === 'sky' || biome === 'cyber' || biome === 'factory';
  speckle(g, w, h, p.asphalt, p.asphaltSpeck, panels ? 2600 : 5200, 11, 2);
  const r = mulberry32(21);
  // tyre-worn racing grooves (subtle, darker)
  g.globalAlpha = 0.09;
  g.fillStyle = '#000';
  for (const u of [0.28, 0.34, 0.66, 0.72]) g.fillRect(Math.round(u * w) - 7, 0, 14, h);
  g.globalAlpha = 1;
  // repaired patches / cracks
  if (!panels) {
    for (let i = 0; i < 5; i++) {
      g.fillStyle = css(mixInt(p.asphalt, 0x000000, 0.12 + r() * 0.1));
      g.globalAlpha = 0.6;
      g.fillRect(Math.floor(r() * w * 0.8 + w * 0.1), Math.floor(r() * h), 18 + r() * 40, 10 + r() * 30);
    }
    g.globalAlpha = 0.5;
    g.strokeStyle = css(mixInt(p.asphalt, 0x000000, 0.35));
    g.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      let x = r() * w;
      let y = r() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (r() - 0.5) * 30;
        y += r() * 30;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  // panel joints
  if (panels || biome === 'harbor') {
    g.fillStyle = css(mixInt(p.asphalt, 0x000000, 0.45));
    const rows = biome === 'harbor' ? 2 : 4;
    for (let k = 0; k < rows; k++) g.fillRect(0, Math.round((k * h) / rows), w, 3);
    for (const u of biome === 'harbor' ? [0.34, 0.66] : [0.25, 0.5, 0.75]) g.fillRect(Math.round(u * w) - 1, 0, 2, h);
    g.fillStyle = css(mixInt(p.asphalt, 0xffffff, 0.12));
    for (let k = 0; k < rows; k++) g.fillRect(0, Math.round((k * h) / rows) + 3, w, 1);
    if (biome === 'factory') {
      g.fillStyle = css(mixInt(p.asphalt, 0xffffff, 0.25));
      for (let k = 0; k < rows; k++) for (let x = 10; x < w; x += 24) g.fillRect(x, Math.round((k * h) / rows) + 8, 3, 3);
    }
  }
  // biome dust drifting onto the edges
  const edgeDust = biome === 'desert' ? 0xe6b579 : biome === 'snow' ? 0xf3f7fc : -1;
  if (edgeDust >= 0) {
    for (const [x0, dir] of [
      [0, 1],
      [w, -1],
    ] as const) {
      const grd = g.createLinearGradient(x0, 0, x0 + dir * w * 0.14, 0);
      grd.addColorStop(0, `${css(edgeDust)}cc`);
      grd.addColorStop(1, `${css(edgeDust)}00`);
      g.fillStyle = grd;
      g.fillRect(dir > 0 ? 0 : w - w * 0.14, 0, w * 0.14, h);
    }
    // wind-blown streaks across the lane
    g.globalAlpha = 0.25;
    g.fillStyle = css(edgeDust);
    for (let i = 0; i < 10; i++) g.fillRect(Math.floor(r() * w), Math.floor(r() * h), 30 + r() * 60, 2);
    g.globalAlpha = 1;
  }
  // harbor pier: cobble gutters along both edges + tar-sealed slab seams
  if (biome === 'harbor') {
    for (const [x0, x1] of [
      [Math.round(w * 0.045), Math.round(w * 0.12)],
      [Math.round(w * 0.88), Math.round(w * 0.955)],
    ] as const) {
      for (let y = 0; y < h; y += 9)
        for (let x = x0; x < x1; x += 11) {
          const off = (y / 9) % 2 ? 5 : 0;
          g.fillStyle = css(mixInt(p.asphalt, 0xb8b0a0, 0.3 + r() * 0.2));
          g.fillRect(x + off, y + 1, 9, 7);
        }
    }
    g.strokeStyle = 'rgba(10,10,14,0.55)';
    g.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      let x = w * (0.2 + r() * 0.6);
      g.moveTo(x, 0);
      for (let y = 0; y <= h; y += 32) {
        x += (r() - 0.5) * 10;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  // snow: packed-snow ruts where the tyres run + glassy ice glaze patches
  if (biome === 'snow') {
    g.globalAlpha = 0.22;
    g.fillStyle = '#e8f0fb';
    for (const u of [0.26, 0.37, 0.63, 0.74]) g.fillRect(Math.round(u * w) - 5, 0, 10, h);
    g.globalAlpha = 0.16;
    g.fillStyle = '#bfe4ff';
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.ellipse(w * (0.15 + r() * 0.7), r() * h, 12 + r() * 26, 20 + r() * 40, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  // carnival: painted candy racing stripes + sparse stars
  if (biome === 'carnival') {
    for (const [u, col] of [
      [0.2, '#ff7ac8'],
      [0.235, '#ffe07a'],
      [0.765, '#ffe07a'],
      [0.8, '#ff7ac8'],
    ] as const) {
      g.fillStyle = col;
      g.globalAlpha = 0.55;
      g.fillRect(Math.round(u * w) - 3, 0, 6, h);
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 6; i++) {
      const x = 0.15 * w + r() * w * 0.7;
      const y = r() * h;
      g.fillStyle = ['#ffd23f', '#ff4fd8', '#22d3ee'][i % 3]!;
      g.globalAlpha = 0.35;
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const rr = k % 2 ? 4 : 10;
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.fill();
      g.globalAlpha = 1;
    }
  }
  const lw = Math.max(3, Math.round(w * 0.022));
  // edge lines (sky/cyber: glowing rails)
  g.fillStyle = css(p.edgeLine);
  g.fillRect(Math.round(w * 0.018), 0, lw, h);
  g.fillRect(Math.round(w * 0.96), 0, lw, h);
  if (gg && (biome === 'sky' || biome === 'cyber')) {
    gg.fillStyle = css(p.edgeLine);
    gg.fillRect(Math.round(w * 0.018), 0, lw, h);
    gg.fillRect(Math.round(w * 0.96), 0, lw, h);
  }
  if (biome === 'sky' || biome === 'cyber') {
    // lane chevrons pointing along travel (+v = up the canvas), glowing
    for (const u of biome === 'sky' ? [0.33, 0.67] : [0.5]) {
      for (let k = 0; k < 2; k++) {
        const cx = u * w;
        const cy = h * (0.25 + k * 0.5);
        const draw = (ctx: CanvasRenderingContext2D) => {
          ctx.beginPath();
          ctx.moveTo(cx - 12, cy + 10);
          ctx.lineTo(cx, cy - 4);
          ctx.lineTo(cx + 12, cy + 10);
          ctx.lineTo(cx + 12, cy + 16);
          ctx.lineTo(cx, cy + 2);
          ctx.lineTo(cx - 12, cy + 16);
          ctx.closePath();
          ctx.fill();
        };
        g.fillStyle = css(p.lane);
        draw(g);
        if (gg) {
          gg.fillStyle = css(mixInt(p.lane, 0x000000, 0.35));
          draw(gg);
        }
      }
    }
    return;
  }
  // centre dashes (half the tile)
  g.fillStyle = css(p.lane);
  g.fillRect(Math.round(w / 2 - lw / 2), Math.round(h * 0.1), lw, Math.round(h * 0.4));
  if (biome === 'desert') {
    g.fillStyle = css(p.asphalt);
    g.globalAlpha = 0.35;
    for (let i = 0; i < 12; i++) g.fillRect(Math.round(w / 2 - lw / 2), Math.round(h * 0.1 + r() * h * 0.4), lw, 3);
    g.globalAlpha = 1;
  }
}

/** Sky shoulders: pale "cloud-foam" panels (clearly not road, not grass). */
export function paintSkyShoulder(c: HTMLCanvasElement): void {
  const g = ctx2d(c);
  const w = c.width;
  const h = c.height;
  speckle(g, w, h, 0xcfe3f5, 0xe8f3ff, 900, 17, 3);
  g.strokeStyle = 'rgba(90,130,180,0.35)';
  g.lineWidth = 2;
  for (let y = 0; y <= h; y += 64) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.6)';
  for (let y = 16; y < h; y += 32) for (let x = 16 + ((y / 32) % 2) * 16; x < w; x += 32) g.fillRect(x - 2, y - 2, 4, 4);
}

export function paintCurb(c: HTMLCanvasElement, a: number, b: number): void {
  const g = ctx2d(c);
  const w = c.width;
  const h = c.height;
  g.fillStyle = css(a);
  g.fillRect(0, 0, w, h / 2);
  g.fillStyle = css(b);
  g.fillRect(0, h / 2, w, h / 2);
  // bevel shading across (u)
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, 'rgba(0,0,0,0.25)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
}

export function paintOffroad(c: HTMLCanvasElement, kind: OffroadKind, s: OffroadStyle, seed: number): void {
  const g = ctx2d(c);
  const w = c.width;
  const h = c.height;
  speckle(g, w, h, s.base, s.speck, kind === 'snow' ? 900 : 2600, seed, kind === 'gravel' ? 3 : 2);
  const r = mulberry32(seed + 7);
  if (kind === 'grass') {
    g.globalAlpha = 0.35;
    g.fillStyle = css(s.stripe);
    for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 16);
    g.globalAlpha = 1;
    for (let i = 0; i < 260; i++) {
      g.fillStyle = css(r() < 0.5 ? shadeInt(s.base, 0.15) : shadeInt(s.base, -0.15));
      g.fillRect(Math.floor(r() * w), Math.floor(r() * h), 1, 3);
    }
  } else if (kind === 'sand') {
    g.strokeStyle = css(s.stripe);
    g.globalAlpha = 0.5;
    g.lineWidth = 2;
    for (let y = 8; y < h; y += 18) {
      g.beginPath();
      for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.round(3 * Math.sin((x / w) * Math.PI * 4 + y)));
      g.stroke();
    }
    g.globalAlpha = 1;
  } else if (kind === 'snow') {
    for (let i = 0; i < 140; i++) {
      g.fillStyle = '#ffffff';
      g.globalAlpha = 0.9;
      g.fillRect(Math.floor(r() * w), Math.floor(r() * h), 2, 2);
    }
    g.globalAlpha = 1;
  } else if (kind === 'metal') {
    g.strokeStyle = css(shadeInt(s.base, -0.35));
    g.lineWidth = 2;
    for (let y = 0; y <= h; y += 64) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    for (let x = 0; x <= w; x += 128) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    g.fillStyle = css(shadeInt(s.base, 0.25));
    for (let y = 8; y < h; y += 16) for (let x = 8 + ((y / 16) % 2) * 8; x < w; x += 16) g.fillRect(x, y, 3, 3);
  } else if (kind === 'dirt') {
    g.globalAlpha = 0.4;
    g.fillStyle = css(s.stripe);
    for (let i = 0; i < 40; i++) {
      g.beginPath();
      g.ellipse(r() * w, r() * h, 4 + r() * 12, 2 + r() * 5, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
}

export interface RoadTextures {
  asphalt: CanvasTexture;
  /** Emissive map for the road (glowing rails/chevrons on sky and cyber; black elsewhere). */
  asphaltGlow: CanvasTexture;
  curb: CanvasTexture;
  offroad: CanvasTexture;
  dirt: CanvasTexture;
  repaint(p: WorldPalette, kind: OffroadKind): void;
  dispose(): void;
}

export function makeRoadTextures(p: WorldPalette, kind: OffroadKind, aniso: number, biome: BiomeId = 'city'): RoadTextures {
  const aC = makeCanvas(256, 512);
  const agC = makeCanvas(256, 512);
  const asphaltGlow = canvasTexture(agC, true, aniso);
  const cC = makeCanvas(16, 64);
  const oC = makeCanvas(256, 256);
  const dC = makeCanvas(256, 256);
  const asphalt = canvasTexture(aC, true, aniso);
  const curb = canvasTexture(cC, true, aniso);
  curb.magFilter = NearestFilter;
  const offroad = canvasTexture(oC, true, aniso);
  const dirt = canvasTexture(dC, true, aniso);
  const repaint = (pal: WorldPalette, k: OffroadKind) => {
    paintAsphalt(aC, pal, biome, agC);
    paintCurb(cC, pal.curbA, pal.curbB);
    if (biome === 'sky') paintSkyShoulder(oC);
    else paintOffroad(oC, k, pal.offroad, 3);
    asphalt.needsUpdate = true;
    asphaltGlow.needsUpdate = true;
    curb.needsUpdate = true;
    offroad.needsUpdate = true;
  };
  repaint(p, kind);
  paintOffroad(dC, 'dirt', { base: 0x8a5a3a, speck: 0xa06d48, stripe: 0x7c5033 }, 5);
  // dirt branch: tyre ruts
  {
    const g = ctx2d(dC);
    g.globalAlpha = 0.35;
    g.fillStyle = '#4a2e1c';
    g.fillRect(60, 0, 26, 256);
    g.fillRect(170, 0, 26, 256);
    g.globalAlpha = 1;
  }
  dirt.needsUpdate = true;
  return {
    asphalt,
    asphaltGlow,
    curb,
    offroad,
    dirt,
    repaint,
    dispose() {
      asphalt.dispose();
      asphaltGlow.dispose();
      curb.dispose();
      offroad.dispose();
      dirt.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Decals and effects
// ---------------------------------------------------------------------------------------------

export function checkerTexture(): CanvasTexture {
  const c = makeCanvas(128, 32);
  const g = ctx2d(c);
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? '#111118' : '#f8fafc';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  const t = canvasTexture(c, true, 4);
  t.magFilter = NearestFilter;
  return t;
}

/** Boost pad chevrons: scroll `offset.y` to animate (texture v runs along the pad). Two chevrons per tile. */
export function chevronTexture(color = 0x35e0ff, glow = 0xffffff): CanvasTexture {
  const c = makeCanvas(64, 128);
  const g = ctx2d(c);
  // translucent energy field: the asphalt shows through, the chevrons glow
  const bg = g.createLinearGradient(0, 0, 64, 0);
  bg.addColorStop(0, 'rgba(20,140,230,0.6)');
  bg.addColorStop(0.5, 'rgba(30,120,220,0.25)');
  bg.addColorStop(1, 'rgba(20,140,230,0.6)');
  g.fillStyle = bg;
  g.fillRect(0, 0, 64, 128);
  for (const oy of [0, 64]) {
    // canvas y grows down; the texture's v grows up, and forward = +v, so chevrons point up
    g.fillStyle = css(color);
    g.beginPath();
    g.moveTo(6, oy + 50);
    g.lineTo(32, oy + 18);
    g.lineTo(58, oy + 50);
    g.lineTo(58, oy + 62);
    g.lineTo(32, oy + 32);
    g.lineTo(6, oy + 62);
    g.closePath();
    g.fill();
    g.fillStyle = css(glow);
    g.globalAlpha = 0.85;
    g.beginPath();
    g.moveTo(16, oy + 48);
    g.lineTo(32, oy + 28);
    g.lineTo(48, oy + 48);
    g.lineTo(48, oy + 52);
    g.lineTo(32, oy + 33);
    g.lineTo(16, oy + 52);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
  }
  g.fillStyle = css(color);
  g.fillRect(0, 0, 4, 128);
  g.fillRect(60, 0, 4, 128);
  return canvasTexture(c, true, 4);
}

/** Ramp stripes (yellow/black) + arrow. */
export function rampTexture(): CanvasTexture {
  const c = makeCanvas(64, 64);
  const g = ctx2d(c);
  g.fillStyle = '#ffd23f';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#1b1b22';
  for (let i = -64; i < 128; i += 22) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 11, 0);
    g.lineTo(i + 11 + 64, 64);
    g.lineTo(i + 64, 64);
    g.closePath();
    g.fill();
  }
  return canvasTexture(c, true, 4);
}

export function conveyorTexture(): CanvasTexture {
  const c = makeCanvas(64, 64);
  const g = ctx2d(c);
  g.fillStyle = '#26282f';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#3a3d47';
  for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 8, 64);
  g.fillStyle = '#ffd23f';
  g.globalAlpha = 0.85;
  // arrows pointing +u (the push direction; the mesh orients u to the push)
  for (const y of [16, 48]) {
    g.beginPath();
    g.moveTo(20, y - 8);
    g.lineTo(40, y);
    g.lineTo(20, y + 8);
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 1;
  return canvasTexture(c, true, 4);
}

export function iceTexture(): CanvasTexture {
  const c = makeCanvas(128, 128);
  const g = ctx2d(c);
  g.fillStyle = '#bfefff';
  g.fillRect(0, 0, 128, 128);
  const r = mulberry32(99);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 1.5;
  for (let i = 0; i < 18; i++) {
    g.globalAlpha = 0.4 + r() * 0.5;
    g.beginPath();
    let x = r() * 128;
    let y = r() * 128;
    g.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      x += (r() - 0.5) * 40;
      y += (r() - 0.5) * 40;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  return canvasTexture(c, true, 4);
}

export function mudTexture(): CanvasTexture {
  const c = makeCanvas(128, 128);
  const g = ctx2d(c);
  speckle(g, 128, 128, 0x6b4a2e, 0x856040, 900, 5, 3);
  const r = mulberry32(12);
  g.fillStyle = '#4f361f';
  for (let i = 0; i < 14; i++) {
    g.globalAlpha = 0.5;
    g.beginPath();
    g.ellipse(r() * 128, r() * 128, 6 + r() * 14, 4 + r() * 8, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  return canvasTexture(c, true, 4);
}

/** Soft radial dot (particles, blob shadows, glows). */
export function dotTexture(hard = 0.0): CanvasTexture {
  const c = makeCanvas(64, 64);
  const g = ctx2d(c);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(Math.max(0.01, hard), 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return canvasTexture(c, false, 1);
}

/** Shore foam: broken white lacework, opaque at the shore edge (v = 0) fading out to sea (v = 1). */
export function foamTexture(): CanvasTexture {
  const c = makeCanvas(256, 64);
  const g = ctx2d(c);
  g.clearRect(0, 0, 256, 64);
  const r = mulberry32(31);
  for (let i = 0; i < 260; i++) {
    const x = r() * 256;
    const v = Math.pow(r(), 1.6);
    const y = 64 - v * 64;
    g.fillStyle = `rgba(255,255,255,${(0.95 - v * 0.8).toFixed(2)})`;
    g.beginPath();
    g.ellipse(x, y, 3 + r() * 10, 1.5 + r() * 3, 0, 0, Math.PI * 2);
    g.fill();
  }
  const grd = g.createLinearGradient(0, 64, 0, 44);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 44, 256, 20);
  const t = canvasTexture(c, true, 4);
  t.wrapT = ClampToEdgeWrapping;
  return t;
}

/** Crisp contact shadow: a rounded rectangle with a short soft edge (kart footprint). */
export function contactShadowTexture(): CanvasTexture {
  const c = makeCanvas(128, 96);
  const g = ctx2d(c);
  g.clearRect(0, 0, 128, 96);
  g.filter = 'blur(5px)';
  g.fillStyle = '#fff';
  g.beginPath();
  g.roundRect(14, 14, 100, 68, 20);
  g.fill();
  g.filter = 'none';
  return canvasTexture(c, false, 1);
}

/** Wall texture (+ glow map) per style. u runs along the wall (one tile ≈ 4 u), v up the face. */
export function wallTextures(style: WallStyle, a: number, b: number): { map: CanvasTexture; glow: CanvasTexture } {
  const c = makeCanvas(128, 64);
  const gC = makeCanvas(128, 64);
  const g = ctx2d(c);
  const gg = ctx2d(gC);
  gg.fillStyle = '#000';
  gg.fillRect(0, 0, 128, 64);
  g.fillStyle = css(a);
  g.fillRect(0, 0, 128, 64);
  switch (style) {
    case 'neon':
    case 'data':
      g.fillStyle = css(shadeInt(a, -0.25));
      g.fillRect(0, 0, 128, 10);
      g.fillStyle = css(b);
      g.fillRect(0, 6, 128, 6);
      gg.fillStyle = css(b);
      gg.fillRect(0, 6, 128, 6);
      if (style === 'data') {
        for (let x = 4; x < 128; x += 16) {
          g.fillRect(x, 30, 8, 3);
          gg.fillRect(x, 30, 8, 3);
        }
      } else {
        g.fillStyle = css(shadeInt(a, 0.12));
        for (let x = 0; x < 128; x += 32) g.fillRect(x, 14, 2, 50);
      }
      break;
    case 'sandstone': {
      // layered strata with weathered blocks, cracks and darker bands (varies across the 4-tile repeat)
      const r = mulberry32(4);
      const bands = [0.0, 0.18, 0.34, 0.52, 0.7, 0.86, 1.0];
      for (let k = 0; k < bands.length - 1; k++) {
        const y0 = Math.round(bands[k]! * 64);
        const y1 = Math.round(bands[k + 1]! * 64);
        g.fillStyle = css(k % 2 ? shadeInt(a, -0.06 + r() * 0.04) : mixInt(a, b, 0.25 + r() * 0.2));
        g.fillRect(0, y0, 128, y1 - y0);
        g.fillStyle = css(shadeInt(b, -0.15));
        g.globalAlpha = 0.5;
        g.fillRect(0, y1 - 1, 128, 1);
        g.globalAlpha = 1;
      }
      for (let i = 0; i < 26; i++) {
        g.fillStyle = css(r() < 0.5 ? shadeInt(a, 0.12) : shadeInt(b, -0.1));
        g.globalAlpha = 0.55;
        g.fillRect(Math.floor(r() * 128), Math.floor(r() * 60), 6 + r() * 22, 2 + r() * 4);
      }
      g.globalAlpha = 0.45;
      g.strokeStyle = css(shadeInt(b, -0.35));
      g.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        let x = r() * 128;
        let y = 10 + r() * 30;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 3; k++) {
          x += (r() - 0.5) * 10;
          y += 6 + r() * 8;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
      // sun-bleached cap
      g.fillStyle = css(shadeInt(a, 0.18));
      g.fillRect(0, 0, 128, 6);
      break;
    }
    case 'dock':
    case 'hazard':
      g.fillStyle = css(shadeInt(a, 0.15));
      g.fillRect(0, 0, 128, 8);
      g.save();
      g.beginPath();
      g.rect(0, 16, 128, 22);
      g.clip();
      g.fillStyle = css(b);
      g.fillRect(0, 16, 128, 22);
      g.fillStyle = '#1b1b22';
      for (let x = -32; x < 160; x += 24) {
        g.beginPath();
        g.moveTo(x, 16);
        g.lineTo(x + 12, 16);
        g.lineTo(x + 34, 38);
        g.lineTo(x + 22, 38);
        g.closePath();
        g.fill();
      }
      g.restore();
      if (style === 'hazard') {
        gg.fillStyle = '#ff8a1f';
        gg.globalAlpha = 0.35;
        gg.fillRect(0, 0, 128, 4);
      }
      break;
    case 'snowbank': {
      const r = mulberry32(8);
      for (let i = 0; i < 90; i++) {
        g.fillStyle = css(r() < 0.5 ? b : 0xffffff);
        g.globalAlpha = 0.6;
        g.fillRect(Math.floor(r() * 128), Math.floor(r() * 64), 3, 3);
      }
      g.globalAlpha = 1;
      break;
    }
    case 'bumper':
      for (let x = 0; x < 128; x += 64) {
        g.fillStyle = css(a);
        g.fillRect(x, 0, 32, 64);
        g.fillStyle = css(b);
        g.fillRect(x + 32, 0, 32, 64);
      }
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(0, 8, 128, 6);
      gg.fillStyle = '#ffd23f';
      for (let x = 16; x < 128; x += 32) {
        gg.beginPath();
        gg.arc(x, 4, 3, 0, Math.PI * 2);
        gg.fill();
        g.fillStyle = '#ffd23f';
        g.beginPath();
        g.arc(x, 4, 3, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'glass':
      g.fillStyle = css(a);
      g.fillRect(0, 0, 128, 64);
      g.fillStyle = css(b);
      g.fillRect(0, 0, 128, 6);
      gg.fillStyle = css(b);
      gg.fillRect(0, 0, 128, 6);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      for (let x = 0; x < 128; x += 32) g.fillRect(x, 6, 3, 58);
      break;
  }
  const map = canvasTexture(c, true, 4);
  const glow = canvasTexture(gC, true, 4);
  return { map, glow };
}

/** Wall topper textures (alpha-tested): red/white snow fence, carnival pennant bunting. */
export function topperTexture(style: 'snowbank' | 'bumper'): CanvasTexture {
  const c = makeCanvas(128, 64);
  const g = ctx2d(c);
  g.clearRect(0, 0, 128, 64);
  if (style === 'snowbank') {
    // wooden post + two rails with red/white banner panels
    g.fillStyle = '#6b4a30';
    g.fillRect(0, 4, 8, 60);
    g.fillStyle = '#8a6040';
    g.fillRect(2, 4, 3, 60);
    for (let x = 8; x < 128; x += 30) {
      g.fillStyle = (x / 30) % 2 < 1 ? '#e8364f' : '#f8fafc';
      g.fillRect(x, 14, 30, 26);
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(8, 36, 120, 4);
    g.fillStyle = '#3b2a1a';
    g.fillRect(8, 12, 120, 3);
    g.fillRect(8, 40, 120, 2);
    // a cap of snow on the post
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 9, 6);
  } else {
    // rope sagging between poles with alternating pennants
    g.fillStyle = '#e2e8f0';
    g.fillRect(0, 0, 5, 64);
    g.strokeStyle = '#3b2a4a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(4, 8);
    g.quadraticCurveTo(64, 22, 128, 8);
    g.stroke();
    const cols = ['#ffd23f', '#ff4fd8', '#22d3ee', '#2de38f', '#ff5a5f'];
    for (let k = 0; k < 6; k++) {
      const x = 10 + k * 19;
      const y = 8 + Math.sin(((x - 4) / 124) * Math.PI) * 11;
      g.fillStyle = cols[k % cols.length]!;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 14, y);
      g.lineTo(x + 7, y + 22);
      g.closePath();
      g.fill();
    }
  }
  return canvasTexture(c, true, 4);
}

/** Name tag: rounded pill with the racer's name. Returns the texture + aspect (w/h). */
export function nameTagTexture(name: string, color: number): { tex: CanvasTexture; aspect: number } {
  const c = makeCanvas(256, 64);
  const g = ctx2d(c);
  g.font = '700 30px system-ui, sans-serif';
  const label = name.length > 14 ? name.slice(0, 13) + '…' : name;
  const tw = Math.min(236, Math.ceil(g.measureText(label).width) + 34);
  const x0 = (256 - tw) / 2;
  g.fillStyle = 'rgba(10,8,24,0.72)';
  g.beginPath();
  g.roundRect(x0, 10, tw, 44, 22);
  g.fill();
  g.fillStyle = css(color);
  g.beginPath();
  g.arc(x0 + 20, 32, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textBaseline = 'middle';
  g.fillText(label, x0 + 32, 33);
  const tex = canvasTexture(c, false, 1);
  return { tex, aspect: 4 };
}

/** Sign board text (gantry, billboards). */
export function signTexture(lines: readonly string[], bg: number, fg: number, w = 512, h = 128, accent?: number): CanvasTexture {
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  g.fillStyle = css(bg);
  g.fillRect(0, 0, w, h);
  if (accent !== undefined) {
    g.fillStyle = css(accent);
    g.fillRect(0, 0, w, 8);
    g.fillRect(0, h - 8, w, 8);
  }
  g.fillStyle = css(fg);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lh = h / (lines.length + 0.4);
  lines.forEach((line, i) => {
    g.font = `900 ${Math.round(lh * 0.72)}px system-ui, sans-serif`;
    g.fillText(line, w / 2, lh * (i + 0.7));
  });
  return canvasTexture(c, false, 4);
}

/**
 * Facade texture for buildings (tile = 4 u × 3.2 u: two window columns, one floor) or server racks.
 * The texel at u = 0 is plain white so untextured parts of facade models keep their vertex colour.
 */
export function facadeTextures(style: 'windows' | 'server', night: boolean, seed: number): { map: CanvasTexture; glow: CanvasTexture } {
  const W = 64;
  const H = 64;
  const c = makeCanvas(W * 4, H * 4);
  const gC = makeCanvas(W * 4, H * 4);
  const g = ctx2d(c);
  const gg = ctx2d(gC);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  gg.fillStyle = '#000';
  gg.fillRect(0, 0, c.width, c.height);
  // 4×4 tiles with different lighting so repetition isn't obvious
  for (let ty = 0; ty < 4; ty++)
    for (let tx = 0; tx < 4; tx++) {
      const ox = tx * W;
      const oy = ty * H;
      if (style === 'windows') {
        // floor slab line
        g.fillStyle = '#c9ccd6';
        g.fillRect(ox, oy + H - 6, W, 6);
        for (let k = 0; k < 2; k++) {
          const x = ox + 8 + k * 30;
          const lit = hash2(tx * 2 + k, ty, seed) < (night ? 0.5 : 0.18);
          g.fillStyle = lit ? '#ffe9b8' : night ? '#2a3150' : '#5f7396';
          g.fillRect(x, oy + 12, 20, 36);
          g.fillStyle = 'rgba(255,255,255,0.35)';
          g.fillRect(x + 2, oy + 14, 5, 32);
          if (lit && night) {
            const cool = hash2(ty, tx * 3 + k, seed) < 0.3;
            gg.fillStyle = cool ? '#7fdfff' : '#ffcf8a';
            gg.globalAlpha = 0.85;
            gg.fillRect(x, oy + 12, 20, 36);
            gg.globalAlpha = 1;
          }
        }
      } else {
        g.fillStyle = '#9aa3bd';
        g.fillRect(ox + 2, oy + 2, W - 4, H - 4);
        g.fillStyle = '#3a4466';
        for (let y = 6; y < H - 4; y += 7) g.fillRect(ox + 5, oy + y, W - 10, 4);
        for (let k = 0; k < 10; k++) {
          const lx = ox + 7 + Math.floor(hash2(k, tx + ty * 4, seed) * (W - 14));
          const ly = oy + 7 + Math.floor(hash2(tx + ty * 4, k, seed) * 7) * 7;
          const col = hash2(k, k + tx, seed + 3) < 0.6 ? '#35e0ff' : '#b6ff4a';
          g.fillStyle = col;
          g.fillRect(lx, ly, 3, 2);
          gg.fillStyle = col;
          gg.fillRect(lx, ly, 3, 2);
        }
      }
    }
  // keep the u = 0 column white (plain parts sample it)
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 2, c.height);
  gg.fillStyle = '#000';
  gg.fillRect(0, 0, 2, c.height);
  const map = canvasTexture(c, true, 8);
  const glow = canvasTexture(gC, true, 8);
  return { map, glow };
}

export function disposeAll(list: readonly (Texture | null | undefined)[]): void {
  for (const t of list) t?.dispose();
}
