/**
 * Layered parallax sky, rendered by the background camera in screen pixels: gradient,
 * twinkling stars, a synthwave sun / moon / ember giant, aurora curtains, far ridges, a
 * mid-distance skyline with lit windows, horizon haze, wind-driven clouds and drifting
 * motes. Layers slide with the battle camera at different rates for depth.
 */
import Phaser from 'phaser';
import { hash2, hexToInt, hexToRgb, rgbCss, shade, type ThemePalette } from '../art/themes.ts';

export interface SkyView {
  /** Device-pixel screen size. */
  w: number;
  h: number;
  /** World x at the screen centre and device px per world unit. */
  camX: number;
  zoom: number;
  /** Screen y (device px) of a world height, for anchoring the horizon layers. */
  screenY: (worldY: number) => number;
  worldWidth: number;
}

export interface SkyQuality {
  stars: number;
  clouds: number;
  motes: number;
  animate: boolean;
}

let serial = 0;

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  return c;
}

export class Sky {
  private readonly scene: Phaser.Scene;
  private readonly theme: ThemePalette;
  private readonly q: SkyQuality;
  private readonly id = ++serial;
  private readonly keys: string[] = [];
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private gradient: Phaser.GameObjects.Image;
  private starsA: Phaser.GameObjects.TileSprite | null = null;
  private starsB: Phaser.GameObjects.TileSprite | null = null;
  private body: Phaser.GameObjects.Image;
  private bodyGlow: Phaser.GameObjects.Image;
  private aurora: Phaser.GameObjects.TileSprite[] = [];
  private far: Phaser.GameObjects.TileSprite;
  private mid: Phaser.GameObjects.TileSprite;
  private haze: Phaser.GameObjects.Image;
  private clouds: Array<{ img: Phaser.GameObjects.Image; x: number; y: number; speed: number; scale: number }> = [];
  private motes: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private windSmoothed = 0;
  private zoneW = 0;
  private zoneH = 0;
  private sizedW = 0;
  private sizedScale = 0;
  private starW = 0;
  private starH = 0;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, theme: ThemePalette, q: SkyQuality) {
    this.scene = scene;
    this.theme = theme;
    this.q = q;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      layer.add(o);
      this.objects.push(o);
      return o;
    };
    const tex = (name: string, c: HTMLCanvasElement) => {
      const key = `tk-sky-${this.id}-${name}`;
      scene.textures.addCanvas(key, c);
      this.keys.push(key);
      return key;
    };

    this.gradient = add(
      scene.add.image(0, 0, tex('grad', canvas(4, 512, (g) => {
        const grad = g.createLinearGradient(0, 0, 0, 512);
        grad.addColorStop(0, theme.sky[0]);
        grad.addColorStop(0.55, theme.sky[1]);
        grad.addColorStop(1, theme.sky[2]);
        g.fillStyle = grad;
        g.fillRect(0, 0, 4, 512);
      }))).setOrigin(0, 0),
    );

    if (q.stars > 0 && theme.stars > 0) {
      const starTex = (seed: number, count: number) =>
        canvas(512, 512, (g) => {
          for (let i = 0; i < count; i++) {
            const x = Math.floor(hash2(i, seed, 1) * 512);
            const y = Math.floor(hash2(i, seed, 2) * 512);
            const b = hash2(i, seed, 3);
            const size = b > 0.93 ? 2 : 1;
            g.fillStyle = `rgba(255,255,255,${0.35 + b * 0.6})`;
            g.fillRect(x, y, size, size);
            if (b > 0.97) {
              g.fillStyle = 'rgba(255,255,255,0.25)';
              g.fillRect(x - 2, y, 5 + size, 1);
              g.fillRect(x, y - 2, 1, 5 + size);
            }
          }
        });
      const n = Math.round(theme.stars * q.stars);
      this.starsA = add(scene.add.tileSprite(0, 0, 16, 16, tex('stars-a', starTex(1, n))).setOrigin(0, 0));
      this.starsB = add(scene.add.tileSprite(0, 0, 16, 16, tex('stars-b', starTex(2, Math.round(n * 0.5)))).setOrigin(0, 0));
    }

    const sun = theme.sun;
    this.bodyGlow = add(scene.add.image(0, 0, 'tk-glow').setTint(hexToInt(sun.glow)).setBlendMode(Phaser.BlendModes.ADD).setAlpha(sun.kind === 'moon' ? 0.35 : 0.6));
    this.body = add(scene.add.image(0, 0, tex('body', this.drawBody())).setAlpha(sun.kind === 'moon' ? 0.82 : 1));

    if (theme.aurora) {
      for (let i = 0; i < 2; i++) {
        const c = canvas(512, 256, (g) => {
          for (let x = 0; x < 512; x += 2) {
            const wave = Math.sin((x / 512) * Math.PI * 4 + i * 1.7) * 30 + Math.sin((x / 512) * Math.PI * 10 + i) * 10;
            const top = 40 + wave;
            const len = 120 + Math.sin((x / 512) * Math.PI * 6 + i * 2.3) * 50;
            const grad = g.createLinearGradient(0, top, 0, top + len);
            const col = i === 0 ? '45,227,143' : '124,245,255';
            grad.addColorStop(0, `rgba(${col},0)`);
            grad.addColorStop(0.35, `rgba(${col},0.32)`);
            grad.addColorStop(1, `rgba(${col},0)`);
            g.fillStyle = grad;
            g.fillRect(x, top, 2, len);
          }
        });
        this.aurora.push(add(scene.add.tileSprite(0, 0, 16, 16, tex(`aurora-${i}`, c)).setOrigin(0, 0).setBlendMode(Phaser.BlendModes.ADD)));
      }
    }

    // Nearest filtering: crisp pixel silhouettes and no bleed across the tile's vertical wrap.
    const farKey = tex('far', this.drawRidges());
    const midKey = tex('mid', this.drawSkyline());
    scene.textures.get(farKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
    scene.textures.get(midKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.far = add(scene.add.tileSprite(0, 0, 16, 16, farKey).setOrigin(0, 1));
    this.mid = add(scene.add.tileSprite(0, 0, 16, 16, midKey).setOrigin(0, 1));
    this.haze = add(
      scene.add
        .image(0, 0, tex('haze', canvas(4, 128, (g) => {
          const [r, gg, b] = hexToRgb(theme.haze);
          const grad = g.createLinearGradient(0, 0, 0, 128);
          grad.addColorStop(0, `rgba(${r},${gg},${b},0)`);
          grad.addColorStop(0.6, `rgba(${r},${gg},${b},0.28)`);
          grad.addColorStop(1, `rgba(${r},${gg},${b},0.05)`);
          g.fillStyle = grad;
          g.fillRect(0, 0, 4, 128);
        })))
        .setOrigin(0, 1)
        .setBlendMode(Phaser.BlendModes.ADD),
    );

    for (let i = 0; i < q.clouds; i++) {
      const img = add(scene.add.image(0, 0, 'tk-cloud').setTint(hexToInt(theme.cloud)).setAlpha(0.18 + hash2(i, 4, 4) * 0.14));
      this.clouds.push({ img, x: hash2(i, 5, 5), y: 0.12 + hash2(i, 6, 6) * 0.3, speed: 0.4 + hash2(i, 7, 7) * 0.8, scale: 0.8 + hash2(i, 8, 8) * 1.4 });
    }

    if (q.motes > 0 && theme.weather === 'rain') {
      // Theme weather (e.g. Neon Noir): thin rain streaks in the backdrop, behind the battlefield.
      this.motes = add(
        scene.add.particles(0, 0, 'tk-px', {
          lifespan: { min: 900, max: 1500 },
          speedY: { min: 420, max: 620 },
          speedX: { min: -10, max: 10 },
          scaleX: { min: 0.1, max: 0.16 },
          scaleY: { min: 1.6, max: 2.8 },
          alpha: { start: 0.42, end: 0.08 },
          tint: hexToInt(theme.motes),
          frequency: Math.round(36 / q.motes),
          maxAliveParticles: Math.round(140 * q.motes),
          emitting: true,
        }),
      );
    } else if (q.motes > 0) {
      const tint = hexToInt(theme.motes);
      this.motes = add(
        scene.add.particles(0, 0, theme.moteKind === 'snow' ? 'tk-dot' : 'tk-px', {
          lifespan: { min: 5000, max: 9000 },
          speedY: theme.moteKind === 'snow' ? { min: 12, max: 30 } : { min: -22, max: -6 },
          speedX: { min: -8, max: 8 },
          scale: theme.moteKind === 'snow' ? { min: 0.25, max: 0.55 } : { min: 0.35, max: 0.8 },
          alpha: { start: 0.8, end: 0 },
          tint,
          blendMode: Phaser.BlendModes.ADD,
          frequency: Math.round(260 / q.motes),
          maxAliveParticles: Math.round(60 * q.motes),
          emitting: true,
        }),
      );
    }
  }

  private drawBody(): HTMLCanvasElement {
    const sun = this.theme.sun;
    return canvas(256, 256, (g) => {
      const cx = 128;
      const cy = 128;
      const r = 118;
      if (sun.kind === 'sun') {
        const grad = g.createLinearGradient(0, cy - r, 0, cy + r);
        grad.addColorStop(0, '#fff3b0');
        grad.addColorStop(0.45, sun.color);
        grad.addColorStop(1, '#ff4fd8');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
        // Synthwave cut lines, thicker toward the horizon.
        g.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < 9; i++) {
          const y = cy + 6 + i * 13;
          g.fillRect(0, y, 256, 1 + i * 0.9);
        }
        g.globalCompositeOperation = 'source-over';
      } else if (sun.kind === 'moon') {
        const grad = g.createRadialGradient(cx - 30, cy - 30, 10, cx, cy, r);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(1, sun.color);
        g.fillStyle = grad;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(80,110,160,0.18)';
        for (const [x, y, rr] of [
          [90, 100, 22],
          [150, 150, 30],
          [160, 80, 14],
          [100, 170, 12],
        ] as const) {
          g.beginPath();
          g.arc(x, y, rr, 0, Math.PI * 2);
          g.fill();
        }
      } else {
        const grad = g.createRadialGradient(cx, cy, 20, cx, cy, r);
        grad.addColorStop(0, '#ffcf5a');
        grad.addColorStop(0.5, sun.color);
        grad.addColorStop(1, '#7a1405');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
        g.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < 6; i++) g.fillRect(0, cy + 20 + i * 16, 256, 2 + i);
        g.globalCompositeOperation = 'source-over';
      }
    });
  }

  private drawRidges(): HTMLCanvasElement {
    const t = this.theme;
    const W = 1024;
    const H = 320;
    return canvas(W, H, (g) => {
      const layers = [
        { base: 170, amp: 90, color: shade(t.far, 0.08), rim: 0.25, seed: 1 },
        { base: 120, amp: 70, color: t.far, rim: 0.55, seed: 2 },
      ];
      for (const L of layers) {
        g.fillStyle = L.color;
        g.beginPath();
        g.moveTo(0, H);
        const pts: Array<[number, number]> = [];
        for (let x = 0; x <= W; x += 8) {
          const u = x / W;
          const y =
            H -
            L.base -
            Math.sin(u * Math.PI * 2 * 3 + L.seed) * L.amp * 0.45 -
            Math.sin(u * Math.PI * 2 * 7 + L.seed * 2) * L.amp * 0.22 -
            (hash2(x, L.seed, 9) - 0.5) * 14;
          pts.push([x, y]);
          g.lineTo(x, y);
        }
        g.lineTo(W, H);
        g.closePath();
        g.fill();
        const [r, gg, b] = hexToRgb(t.farRim);
        g.strokeStyle = `rgba(${r},${gg},${b},${L.rim})`;
        g.lineWidth = 2;
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
      }
    });
  }

  private drawSkyline(): HTMLCanvasElement {
    const t = this.theme;
    const W = 1024;
    const H = 260;
    const lights = t.midLights.map(hexToRgb);
    const spires = t.moteKind === 'snow';
    const ruins = t.moteKind === 'ash';
    return canvas(W, H, (g) => {
      g.fillStyle = t.mid;
      let x = 0;
      let i = 0;
      while (x < W) {
        const w = 18 + Math.floor(hash2(i, 3, 1) * 46);
        const h = 40 + Math.floor(hash2(i, 3, 2) * (spires ? 190 : 150));
        const top = H - h;
        if (spires) {
          g.beginPath();
          g.moveTo(x, H);
          g.lineTo(x + w / 2, top);
          g.lineTo(x + w, H);
          g.closePath();
          g.fill();
        } else {
          g.fillRect(x, top, w, h);
          if (ruins && hash2(i, 3, 5) > 0.5) {
            g.clearRect(x + w * 0.5, top, w * 0.5, 10 + hash2(i, 3, 6) * 24);
          } else if (hash2(i, 3, 3) > 0.7) {
            g.fillRect(x + w / 2 - 1, top - 16, 2, 16);
          }
          // Windows.
          for (let wy = top + 6; wy < H - 6; wy += 7) {
            for (let wx = x + 4; wx < x + w - 4; wx += 6) {
              const n = hash2(wx, wy, i);
              if (n > (ruins ? 0.93 : 0.78)) {
                const c = lights[Math.floor(n * 97) % lights.length]!;
                g.fillStyle = rgbCss(c, 0.35 + (n - 0.78) * 2.4);
                g.fillRect(wx, wy, 2, 3);
              }
            }
          }
          g.fillStyle = t.mid;
        }
        x += w + Math.floor(hash2(i, 3, 4) * 10);
        i++;
      }
    });
  }

  update(now: number, dt: number, v: SkyView, wind: number): void {
    const { w, h } = v;
    this.gradient.setDisplaySize(w, h);
    const scale = Math.max(0.6, Math.min(2.2, h / 700));
    const par = (f: number) => (v.camX - v.worldWidth / 2) * v.zoom * f;
    if (this.starsA && this.starsB) {
      const resize = w !== this.starW || h !== this.starH;
      this.starW = w;
      this.starH = h;
      for (const s of [this.starsA, this.starsB]) {
        if (resize) s.setSize(w, h * 0.8);
        s.tilePositionX = par(0.03) + (s === this.starsB ? 211 : 0);
      }
      this.starsB.setAlpha(this.q.animate ? 0.45 + 0.35 * Math.sin(now / 900) : 0.6);
      this.starsA.setAlpha(this.q.animate ? 0.75 + 0.2 * Math.sin(now / 1300 + 1) : 0.85);
    }
    const sun = this.theme.sun;
    const r = sun.r * Math.min(w, h * 1.6);
    const sx = sun.x * w - par(0.05);
    const sy = sun.y * h + (v.screenY(260) - h * 0.7) * 0.15;
    this.body.setPosition(sx, sy).setDisplaySize(r * 2, r * 2);
    this.bodyGlow.setPosition(sx, sy).setDisplaySize(r * 7, r * 7);
    this.aurora.forEach((a, i) => {
      if (a.width !== w || a.height !== Math.round(h * 0.5)) {
        a.setPosition(0, h * 0.06);
        a.setSize(w, Math.round(h * 0.5));
        a.setTileScale(Math.max(1, w / 900), (h * 0.5) / 256);
      }
      a.tilePositionX = par(0.04) / Math.max(1, w / 900) + (this.q.animate ? now / (90 + i * 40) : 0);
      a.setAlpha(this.q.animate ? 0.55 + 0.35 * Math.sin(now / (1700 + i * 600) + i) : 0.7);
    });

    // Horizon layers anchored to the battle camera (they rise and fall with it, gently).
    const horizon = v.screenY(170);
    const anchor = (base: number, f: number) => h * 0.78 + (base - h * 0.78) * f;
    if (w !== this.sizedW || scale !== this.sizedScale) {
      this.sizedW = w;
      this.sizedScale = scale;
      // Show texture rows 1..H-2 only: the tile never samples across its vertical wrap
      // (which would draw the opaque bottom row as a hairline along the top edge).
      this.far.setSize(w, 318 * scale).setTileScale(scale, scale);
      this.mid.setSize(w, 258 * scale).setTileScale(scale, scale);
      this.far.tilePositionY = 1;
      this.mid.tilePositionY = 1;
      this.haze.setDisplaySize(w, 220 * scale);
    }
    this.far.setPosition(0, anchor(horizon, 0.35) + 30 * scale);
    this.far.tilePositionX = par(0.12) / scale;
    this.mid.setPosition(0, anchor(horizon, 0.6) + 40 * scale);
    this.mid.tilePositionX = par(0.3) / scale + 300;
    this.haze.setPosition(0, anchor(horizon, 0.6) + 40 * scale);

    this.windSmoothed += (wind - this.windSmoothed) * Math.min(1, dt * 1.5);
    for (const c of this.clouds) {
      if (this.q.animate) c.x += ((c.speed * 0.004 + this.windSmoothed * 0.0032) * dt * 1000) / 1000;
      if (c.x > 1.2) c.x -= 1.4;
      if (c.x < -0.2) c.x += 1.4;
      c.img.setPosition(c.x * w - par(0.2), c.y * h).setScale(c.scale * scale);
    }
    if (this.motes) {
      if (w !== this.zoneW || h !== this.zoneH) {
        this.zoneW = w;
        this.zoneH = h;
        this.motes.clearEmitZones();
        this.motes.addEmitZone({
          type: 'random',
          source: {
            getRandomPoint: (pt) => {
              pt.x = Math.random() * w;
              pt.y = Math.random() * h;
            },
          },
        });
      }
      this.motes.gravityX = this.windSmoothed * 4;
    }
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
    for (const k of this.keys) if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
  }
}
