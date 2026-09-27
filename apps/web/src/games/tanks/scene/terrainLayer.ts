/**
 * Terrain rendering: the heightmap is painted column by column into chunked canvas
 * textures (1 texel per world unit, crisp pixel filtering) — a glowing rim, topsoil,
 * strata bands, grit, neon ore flecks and scorch marks around craters — plus a vector
 * neon rim line on top. Only the columns an explosion touched are repainted.
 */
import Phaser from 'phaser';
import { TANKS_WORLD } from '@dascade/shared/games/tanks';
import type { Terrain } from '@dascade/game-core/tanks';
import { hash2, hexToInt, hexToRgb, mixRgb, type ThemePalette } from '../art/themes.ts';

const CHUNK = 200;

interface Chunk {
  x0: number;
  w: number;
  key: string;
  tex: Phaser.Textures.CanvasTexture;
  img: Phaser.GameObjects.Image;
  data: ImageData;
}

let serial = 0;

export class TerrainLayer {
  private readonly scene: Phaser.Scene;
  private readonly terrain: Terrain;
  private theme: ThemePalette;
  private readonly scorch: Float32Array | null;
  private readonly chunks: Chunk[] = [];
  private readonly rimG: Phaser.GameObjects.Graphics;
  private readonly depthLut: Uint8ClampedArray;
  private readonly strata: Float32Array;
  private readonly wobble: Float32Array;
  private rimRgb: [number, number, number] = [0, 0, 0];
  private topRgb: [number, number, number] = [0, 0, 0];
  private readonly h0: Float64Array;
  private scorchRgb: [number, number, number] = [0, 0, 0];
  private strataRgb: [number, number, number] = [0, 0, 0];
  private ore: Array<[number, number, number]> = [];
  private readonly id = ++serial;
  private pending: { x0: number; x1: number } | null = null;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, terrain: Terrain, theme: ThemePalette, scorch: Float32Array | null, depth: number) {
    this.scene = scene;
    this.terrain = terrain;
    this.theme = theme;
    this.scorch = scorch;
    const H = terrain.height;
    this.depthLut = new Uint8ClampedArray((H + 1) * 3);
    this.setPalette(theme);
    // Strata bands by absolute height, gently wobbling along x.
    this.strata = new Float32Array(H + 64);
    for (let y = 0; y < this.strata.length; y++) {
      const band = Math.floor(y / 17);
      this.strata[y] = band % 3 === 0 ? 0.3 : band % 5 === 1 ? 0.14 : 0;
    }
    this.h0 = Float64Array.from(terrain.h);
    this.wobble = new Float32Array(terrain.width);
    let a = 0;
    let v = 0;
    for (let x = 0; x < terrain.width; x++) {
      if (x % 40 === 0) a = (hash2(x, 7, 3) - 0.5) * 0.9;
      v += (a - v) * 0.08;
      this.wobble[x] = v * 18 + Math.sin(x * 0.013) * 9;
    }

    for (let x0 = 0; x0 < terrain.width; x0 += CHUNK) {
      const w = Math.min(CHUNK, terrain.width - x0);
      const key = `tk-terrain-${this.id}-${x0}`;
      const tex = scene.textures.createCanvas(key, w, H)!;
      tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
      const data = tex.getContext().createImageData(w, H);
      const img = scene.add.image(x0, 0, key).setOrigin(0, 0).setDepth(depth);
      layer.add(img);
      this.chunks.push({ x0, w, key, tex, img, data });
    }
    this.rimG = scene.add.graphics().setDepth(depth + 1).setBlendMode(Phaser.BlendModes.ADD);
    layer.add(this.rimG);
    this.redraw(0, terrain.width);
  }

  /** Colour by depth below the surface (palette → lookup tables). */
  private setPalette(theme: ThemePalette): void {
    this.theme = theme;
    const H = this.terrain.height;
    const rim = hexToRgb(theme.rim);
    const top = hexToRgb(theme.topsoil);
    const soil = hexToRgb(theme.soil);
    const rock = hexToRgb(theme.rock);
    const deep = hexToRgb(theme.deep);
    this.rimRgb = rim;
    this.scorchRgb = hexToRgb(theme.scorch);
    this.strataRgb = hexToRgb(theme.strata);
    this.ore = theme.ore.map(hexToRgb);
    this.topRgb = top;
    // Body colour by depth below the ORIGINAL surface (so craters expose the same strata the
    // column always had, instead of re-colouring everything beneath them).
    for (let d = 0; d <= H; d++) {
      let c: [number, number, number];
      if (d < 30) c = mixRgb(top, soil, d / 30);
      else if (d < 150) c = mixRgb(soil, rock, (d - 30) / 120);
      else c = mixRgb(rock, deep, Math.min(1, (d - 150) / 320));
      this.depthLut[d * 3] = c[0];
      this.depthLut[d * 3 + 1] = c[1];
      this.depthLut[d * 3 + 2] = c[2];
    }
  }

  /** Theme change: repaint every column in place with a new palette (same textures, same terrain). */
  restyle(theme: ThemePalette): void {
    if (theme === this.theme) return;
    this.setPalette(theme);
    this.pending = null;
    this.redraw(0, this.terrain.width);
  }

  /** Queue columns [x0, x1) for repaint (flushed once per frame). */
  invalidate(x0: number, x1: number): void {
    const lo = Math.max(0, Math.floor(x0) - 3);
    const hi = Math.min(this.terrain.width, Math.ceil(x1) + 3);
    this.pending = this.pending ? { x0: Math.min(this.pending.x0, lo), x1: Math.max(this.pending.x1, hi) } : { x0: lo, x1: hi };
  }

  flush(): void {
    if (!this.pending) return;
    const p = this.pending;
    this.pending = null;
    this.redraw(p.x0, p.x1);
  }

  private redraw(x0: number, x1: number): void {
    for (const c of this.chunks) {
      const a = Math.max(x0, c.x0);
      const b = Math.min(x1, c.x0 + c.w);
      if (b <= a) continue;
      for (let x = a; x < b; x++) this.paintColumn(c, x);
      c.tex.putData(c.data, 0, 0, a - c.x0, 0, b - a, this.terrain.height);
      c.tex.refresh();
    }
    this.drawRim();
  }

  private paintColumn(c: Chunk, x: number): void {
    const H = this.terrain.height;
    const w = c.w;
    const px = c.data.data;
    const lx = x - c.x0;
    const surface = this.terrain.h[x]!;
    // Dirt piled above the original ground counts as fresh topsoil.
    const ref = Math.max(this.h0[x]!, surface - 30);
    const lut = this.depthLut;
    const scorch = this.scorch ? this.scorch[x]! : 0;
    const wob = this.wobble[x]!;
    const bedrock = TANKS_WORLD.bedrock;
    const left = x > 0 ? this.terrain.h[x - 1]! : surface;
    const right = x < this.terrain.width - 1 ? this.terrain.h[x + 1]! : surface;
    const flat = Math.abs(right - left) < 1.6;
    // Decorative tufts / crystals on flat ground.
    const tuft = flat && scorch < 0.2 ? hash2(x, 11, 5) : 1;
    const tuftH = tuft < 0.06 ? 3 : tuft < 0.16 ? 2 : tuft < 0.32 ? 1 : 0;
    for (let r = 0; r < H; r++) {
      const wy = H - r - 0.5;
      const i = (r * w + lx) * 4;
      const d = surface - wy;
      if (d < 0) {
        if (d > -tuftH - 0.01 && tuftH > 0) {
          px[i] = this.rimRgb[0];
          px[i + 1] = this.rimRgb[1];
          px[i + 2] = this.rimRgb[2];
          px[i + 3] = 150 + 30 * (tuftH + d);
        } else {
          px[i + 3] = 0;
        }
        continue;
      }
      const dRef = Math.max(0, ref - wy);
      const di = Math.min(H, Math.floor(dRef)) * 3;
      let R = lut[di]!;
      let G = lut[di + 1]!;
      let B = lut[di + 2]!;
      // The current surface: a bright rim and a thin freshly exposed layer.
      if (d < 2) {
        R = this.rimRgb[0];
        G = this.rimRgb[1];
        B = this.rimRgb[2];
      } else if (d < 14) {
        const k = d < 6 ? 1 - (d - 2) / 4 : 0;
        const e = (1 - (d - 2) / 12) * 0.55;
        R += (this.topRgb[0] - R) * e + (this.rimRgb[0] - R) * k * 0.6;
        G += (this.topRgb[1] - G) * e + (this.rimRgb[1] - G) * k * 0.6;
        B += (this.topRgb[2] - B) * e + (this.rimRgb[2] - B) * k * 0.6;
      }
      if (dRef > 18 && d > 6) {
        const s = this.strata[Math.max(0, Math.floor(wy + wob))] ?? 0;
        if (s > 0) {
          const k = s * Math.min(1, (dRef - 18) / 30);
          R += (this.strataRgb[0] - R) * k;
          G += (this.strataRgb[1] - G) * k;
          B += (this.strataRgb[2] - B) * k;
        }
      }
      if (scorch > 0 && d < 30) {
        const k = scorch * (1 - d / 30) * 0.88;
        R += (this.scorchRgb[0] - R) * k;
        G += (this.scorchRgb[1] - G) * k;
        B += (this.scorchRgb[2] - B) * k;
      }
      const n = hash2(x, Math.floor(wy), 1);
      if (d > 70 && n > 0.99965) {
        const ore = this.ore[Math.floor(n * 1000) % this.ore.length]!;
        R = ore[0];
        G = ore[1];
        B = ore[2];
      } else {
        // Pixel grit + a touch of darkness toward bedrock.
        const grit = 0.95 + ((n * 8) | 0) / 100;
        const floor = wy < bedrock ? 0.55 : 1 - Math.max(0, (60 - wy) / 60) * 0.25;
        const k = grit * floor;
        R *= k;
        G *= k;
        B *= k;
      }
      px[i] = R;
      px[i + 1] = G;
      px[i + 2] = B;
      px[i + 3] = 255;
    }
  }

  private drawRim(): void {
    const g = this.rimG;
    const t = this.terrain;
    const H = t.height;
    g.clear();
    const pts: Phaser.Math.Vector2[] = [];
    for (let x = 0; x < t.width; x += 2) pts.push(new Phaser.Math.Vector2(x + 1, H - t.h[x]!));
    pts.push(new Phaser.Math.Vector2(t.width, H - t.h[t.width - 1]!));
    const glow = hexToInt(this.theme.rimGlow);
    g.lineStyle(9, glow, 0.08);
    g.strokePoints(pts, false, false);
    g.lineStyle(4, glow, 0.2);
    g.strokePoints(pts, false, false);
    g.lineStyle(1.6, hexToInt(this.theme.rim), 0.85);
    g.strokePoints(pts, false, false);
  }

  destroy(): void {
    for (const c of this.chunks) {
      c.img.destroy();
      if (this.scene.textures.exists(c.key)) this.scene.textures.remove(c.key);
    }
    this.chunks.length = 0;
    this.rimG.destroy();
  }
}
