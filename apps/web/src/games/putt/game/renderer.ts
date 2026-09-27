/**
 * DAS Putt canvas renderer — neon-pixel 2.5D mini golf.
 *
 * A static layer (void, platform plinth, lit striped turf with pixel dither, sand, water beds,
 * slope shading, tee, cup, extruded glowing cushions, posts) is rendered once per hole/size into
 * an offscreen canvas. Each frame adds the living parts on top: water shimmer, sliding slope
 * chevrons, portals, bumper flashes, windmills/sweepers, the flag, the aim guide, balls with
 * trails, and particles. Everything is projected manually through the Camera so the 2.5D
 * extrusion always points "down" on screen, even when the hole is rotated for portrait phones.
 */
import { PUTT_POWER_MAX } from '@dascade/shared/games/putt';
import { PHYS, compileHole, moverBars, moverPose, pointInPoly, type HoleDef, type Pt } from '@dascade/game-core/putt';
import { Camera, type Insets } from './camera.ts';
import { ART, DISPLAY_FONT, NUM_FONT, artRng, rgba, shade } from './palette.ts';
import { Particles, type FxLevel } from './particles.ts';
import type { AimDraw, BallDraw, Frame, FxEvent, PuttController } from './controller.ts';

export interface RendererOptions {
  fx: FxLevel;
  reducedMotion: boolean;
}

type Ctx = CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

export class PuttRenderer {
  readonly cam = new Camera();
  private g: Ctx;
  private staticLayer: HTMLCanvasElement | null = null;
  private staticKey = '';
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private insetsList: Insets[] = [{ top: 0, right: 0, bottom: 0, left: 0 }];
  private raf = 0;
  private last = 0;
  private uiTick = 0;
  private readonly particles: Particles;
  private dither: CanvasPattern | null = null;
  private running = false;
  private hole: HoleDef | null = null;
  private turfPath: Path2D | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctrl: PuttController,
    private readonly opts: RendererOptions,
  ) {
    const g = canvas.getContext('2d', { alpha: false });
    if (!g) throw new Error('Canvas 2D is not available');
    this.g = g;
    this.particles = new Particles(opts.fx, opts.reducedMotion);
    ctrl.toWorldDir = (dx, dy) => this.cam.dirToWorld(dx, dy);
  }

  get glow(): number {
    return this.opts.fx === 'high' ? 1 : this.opts.fx === 'low' ? 0.5 : 0;
  }

  /** `insets`: one or more layouts of the HUD chrome; the camera uses whichever fits the hole largest. */
  resize(cssW: number, cssH: number, dpr: number, insets: Insets | Insets[]): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.dpr = dpr;
    this.insetsList = Array.isArray(insets) ? (insets.length ? insets : [{ top: 0, right: 0, bottom: 0, left: 0 }]) : [insets];
    const W = Math.round(this.cssW * dpr);
    const H = Math.round(this.cssH * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    this.staticKey = '';
    this.ctrl.maxDragPx = Math.max(120, Math.min(280, Math.min(this.cssW, this.cssH) * 0.42));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = this.last ? Math.min(0.1, (t - this.last) / 1000) : 1 / 60;
      this.last = t;
      try {
        this.draw(dt, t);
      } catch (err) {
        // Never let one bad frame kill the loop.
        console.error('[putt] render error', err);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.staticLayer = null;
    this.particles.clear();
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  private draw(dt: number, t: number): void {
    const frame = this.ctrl.frame();
    this.uiTick += dt;
    if (this.uiTick > 0.25) {
      this.uiTick = 0;
      this.ctrl.tick();
    }
    const g = this.g;
    const hole = frame.hole;
    if (hole !== this.hole) {
      this.hole = hole;
      this.staticKey = '';
      this.particles.clear();
    }
    if (hole) {
      const b = compileHole(hole).bounds;
      // Include wall thickness and the lamp posts in the fitted area.
      const bounds = { minX: b.minX - 16, minY: b.minY - 30, maxX: b.maxX + 16, maxY: b.maxY + 24 };
      let best: Insets = this.insetsList[0]!;
      let bestScale = -1;
      for (const ins of this.insetsList) {
        this.cam.fit(bounds, this.cssW, this.cssH, ins);
        if (this.cam.scale > bestScale + 1e-6) {
          bestScale = this.cam.scale;
          best = ins;
        }
      }
      this.cam.fit(bounds, this.cssW, this.cssH, best);
    }
    const ins = this.insetsList.map((i) => `${i.top},${i.bottom},${i.left},${i.right}`).join('|');
    const key = `${hole?.id ?? 'none'}:${this.cssW}x${this.cssH}@${this.dpr}:${ins}`;
    if (key !== this.staticKey || !this.staticLayer) {
      this.staticKey = key;
      this.buildStatic(hole);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.staticLayer!, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (hole) {
      this.drawLiving(hole, frame, t);
      this.handleFx(this.ctrl.drainFx());
      this.drawAim(frame.aim, t);
      for (const ball of frame.balls) this.drawBall(ball, t, frame);
    }
    this.particles.step(dt, g);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private path(pts: readonly Pt[], closed = true, dy = 0): Path2D {
    const p = new Path2D();
    const c = this.cam;
    pts.forEach(([x, y], i) => {
      const sx = c.sx(x, y);
      const sy = c.sy(x, y) + dy;
      if (i === 0) p.moveTo(sx, sy);
      else p.lineTo(sx, sy);
    });
    if (closed) p.closePath();
    return p;
  }

  /** Same polygon wound clockwise on screen (y down) — keeps nonzero unions seamless. */
  private clockwise(poly: readonly Pt[]): readonly Pt[] {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j]![0] * poly[i]![1] - poly[i]![0] * poly[j]![1];
    return a >= 0 ? poly : [...poly].reverse();
  }

  /** Canvas that is opaque everywhere EXCEPT the turf union (for inner shadows along the real outline). */
  private outsideMask(turf: Path2D): HTMLCanvasElement | null {
    const c = makeCanvas(Math.round(this.cssW * this.dpr), Math.round(this.cssH * this.dpr));
    const m = c.getContext('2d');
    if (!m) return null;
    m.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    m.fillStyle = '#000';
    m.fillRect(-10, -10, this.cssW + 20, this.cssH + 20);
    m.globalCompositeOperation = 'destination-out';
    m.fill(turf);
    return c;
  }

  private px(n: number): number {
    return n * this.cam.scale;
  }

  /** Draw only the blurred shadow of a shape (portable soft shadows: no ctx.filter needed). */
  private softShadow(draw: (g: Ctx) => void, blur: number, dx: number, dy: number, color: string): void {
    const g = this.g;
    const far = 20000;
    g.save();
    g.translate(-far, 0);
    g.shadowColor = color;
    g.shadowBlur = blur * this.dpr;
    g.shadowOffsetX = (far + dx) * this.dpr;
    g.shadowOffsetY = dy * this.dpr;
    draw(g);
    g.restore();
  }

  private makeDither(): CanvasPattern | null {
    const c = makeCanvas(96, 96);
    const g = c.getContext('2d');
    if (!g) return null;
    const rnd = artRng(7);
    for (let i = 0; i < 700; i++) {
      const x = Math.floor(rnd() * 48) * 2;
      const y = Math.floor(rnd() * 48) * 2;
      g.fillStyle = rnd() < 0.55 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)';
      g.fillRect(x, y, 2, 2);
    }
    return this.g.createPattern(c, 'repeat');
  }

  // ---------------------------------------------------------------------------
  // Static layer
  // ---------------------------------------------------------------------------

  private buildStatic(hole: HoleDef | null): void {
    const W = Math.round(this.cssW * this.dpr);
    const H = Math.round(this.cssH * this.dpr);
    if (!this.staticLayer || this.staticLayer.width !== W || this.staticLayer.height !== H) this.staticLayer = makeCanvas(W, H);
    const main = this.g;
    const sg = this.staticLayer.getContext('2d');
    if (!sg) return;
    // Draw with the same helpers by temporarily pointing `g` at the static layer.
    this.g = sg;
    try {
      sg.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (!this.dither) this.dither = this.makeDither();
      this.drawVoid();
      if (hole) this.drawCourse(hole);
    } finally {
      this.g = main;
    }
  }

  private drawVoid(): void {
    const g = this.g;
    const W = this.cssW;
    const H = this.cssH;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, ART.voidTop);
    bg.addColorStop(1, ART.voidBottom);
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // Neon horizon glow behind the course.
    const halo = g.createRadialGradient(W / 2, H * 0.55, 10, W / 2, H * 0.55, Math.max(W, H) * 0.7);
    halo.addColorStop(0, 'rgba(163, 230, 53, 0.10)');
    halo.addColorStop(0.45, 'rgba(34, 211, 238, 0.04)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, W, H);
    // Perspective grid floor.
    g.strokeStyle = ART.gridLine;
    g.lineWidth = 1;
    const horizon = H * 0.18;
    g.beginPath();
    for (let i = -12; i <= 12; i++) {
      g.moveTo(W / 2 + i * 40, horizon);
      g.lineTo(W / 2 + i * 220, H + 40);
    }
    for (let k = 0; k < 14; k++) {
      const y = horizon + Math.pow(k / 13, 1.8) * (H - horizon + 40);
      g.moveTo(0, y);
      g.lineTo(W, y);
    }
    g.stroke();
    // Pixel dust.
    const rnd = artRng(31);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = rgba(ART.star, 0.08 + rnd() * 0.25);
      const s = rnd() < 0.15 ? 2 : 1;
      g.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H), s, s);
    }
  }

  private drawCourse(hole: HoleDef): void {
    const g = this.g;
    const px = (n: number) => this.px(n);
    const plinth = Math.max(7, px(22));
    // Union of the turf decks (all subpaths wound the same way so nonzero fill/clip = union).
    const turf = new Path2D();
    for (const poly of hole.turf) turf.addPath(this.path(this.clockwise(poly)));
    this.turfPath = turf;
    const waterPaths = (hole.water ?? []).map((w) => this.path(w));

    // Course shadow on the void.
    this.softShadow(
      (sg) => {
        sg.fillStyle = '#000';
        sg.fill(turf);
        for (const w of waterPaths) sg.fill(w);
      },
      px(40) + 10,
      px(10),
      plinth + px(18),
      'rgba(0,0,0,0.65)',
    );

    // Water basins sit lower than the decks: basin walls, bed and shimmer first…
    for (let i = 3; i >= 1; i--) {
      g.save();
      g.translate(0, (plinth * i) / 3);
      g.fillStyle = shade(ART.waterDeep, -0.25 * i);
      for (const w of waterPaths) g.fill(w);
      g.restore();
    }
    for (const [i, w] of waterPaths.entries()) {
      const poly = hole.water![i]!;
      const cx = poly.reduce((s, p) => s + this.cam.sx(p[0], p[1]), 0) / poly.length;
      const cy = poly.reduce((s, p) => s + this.cam.sy(p[0], p[1]), 0) / poly.length;
      const grad = g.createRadialGradient(cx, cy, 4, cx, cy, px(360));
      grad.addColorStop(0, ART.waterMid);
      grad.addColorStop(1, ART.waterDeep);
      g.fillStyle = grad;
      g.fill(w);
      g.save();
      g.clip(w);
      this.softShadow((sg) => {
        sg.lineWidth = px(18);
        sg.strokeStyle = '#000';
        sg.stroke(w);
      }, px(20), 0, px(4), 'rgba(0,0,0,0.7)');
      g.restore();
      g.strokeStyle = rgba(ART.waterLight, 0.45);
      g.lineWidth = Math.max(1, px(2));
      g.stroke(w);
    }

    // …then the decks' plinth (2.5D thickness), which also shows above the water.
    for (let i = 4; i >= 1; i--) {
      g.save();
      g.translate(0, (plinth * i) / 4);
      g.fillStyle = i === 1 ? ART.plinthEdge : i === 4 ? shade(ART.plinth, -0.4) : shade(ART.plinth, -0.08 * i);
      g.fill(turf);
      g.restore();
    }

    // Turf top.
    const b = compileHole(hole).bounds;
    const lx = this.cam.sx(b.minX, b.minY);
    const ly = this.cam.sy(b.minX, b.minY);
    const light = g.createLinearGradient(lx, ly, this.cam.sx(b.maxX, b.maxY), this.cam.sy(b.maxX, b.maxY));
    light.addColorStop(0, ART.turfLight);
    light.addColorStop(0.55, ART.turfMid);
    light.addColorStop(1, ART.turfDark);
    g.fillStyle = light;
    g.fill(turf);
    g.save();
    g.clip(turf);
    // Mowing stripes (world-space bands, so they rotate with the hole).
    g.fillStyle = ART.stripe;
    const band = 44;
    for (let x = Math.floor(b.minX / band) * band, i = 0; x < b.maxX + band; x += band, i++) {
      if (i % 2) continue;
      g.fill(this.path([
        [x, b.minY - 40],
        [x + band, b.minY - 40],
        [x + band, b.maxY + 40],
        [x, b.maxY + 40],
      ]));
    }
    if (this.dither && this.opts.fx !== 'off') {
      g.fillStyle = this.dither;
      g.fill(turf);
    }
    // Top-left key light + soft edge darkening.
    const W = this.cssW;
    const H = this.cssH;
    const key = g.createRadialGradient(W * 0.42, H * 0.35, 10, W * 0.42, H * 0.35, Math.max(W, H) * 0.75);
    key.addColorStop(0, 'rgba(255,255,210,0.16)');
    key.addColorStop(0.5, 'rgba(255,255,210,0.03)');
    key.addColorStop(1, 'rgba(0,0,20,0.22)');
    g.fillStyle = key;
    g.fill(turf);
    this.drawSlopesStatic(hole);
    this.drawSand(hole);
    this.drawDecorStatic(hole);
    this.drawTee(hole);
    // Inner edge shade along the true outline of the decks (overlapping decks leave no seams).
    const outside = this.outsideMask(turf);
    if (outside) {
      this.softShadow((sg) => sg.drawImage(outside, 0, 0, this.cssW, this.cssH), this.px(34), 0, 0, 'rgba(0, 18, 6, 0.85)');
      this.softShadow((sg) => sg.drawImage(outside, 0, 0, this.cssW, this.cssH), this.px(6), 0, 0, 'rgba(0, 18, 6, 0.55)');
    }
    // Ambient occlusion along the cushions.
    this.softShadow(
      (sg) => {
        sg.lineCap = 'round';
        sg.lineJoin = 'round';
        sg.lineWidth = px(22);
        sg.strokeStyle = '#000';
        for (const w of hole.walls) sg.stroke(this.path(w.pts, Boolean(w.closed)));
      },
      px(18),
      px(3),
      px(9),
      'rgba(0,0,0,0.55)',
    );
    g.restore();

    // Lit lip on the decks' top edges (open edges over water / void read as a raised rim).
    if (outside) {
      g.save();
      g.clip(turf);
      this.softShadow((sg) => sg.drawImage(outside, 0, 0, this.cssW, this.cssH), 1.5, 0, Math.max(1, px(2)), 'rgba(214, 255, 170, 0.55)');
      g.restore();
    }

    this.drawCup(hole);
    this.drawPortalWells(hole);
    this.drawPosts(hole);
    this.drawBumpersStatic(hole);
    this.drawWalls(hole);
    this.drawLamps(hole);
  }

  private drawSlopesStatic(hole: HoleDef): void {
    const g = this.g;
    for (const s of hole.slopes ?? []) {
      const p = this.path(s.poly);
      g.save();
      g.clip(p);
      // Downhill = direction of the acceleration: light uphill, dark downhill.
      const xs = s.poly.map((q) => q[0]);
      const ys = s.poly.map((q) => q[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const mag = Math.hypot(s.accel[0], s.accel[1]) || 1;
      const ux = s.accel[0] / mag;
      const uy = s.accel[1] / mag;
      const reach = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
      const ax = cx - ux * reach;
      const ay = cy - uy * reach;
      const bx = cx + ux * reach;
      const by = cy + uy * reach;
      const grad = g.createLinearGradient(this.cam.sx(ax, ay), this.cam.sy(ax, ay), this.cam.sx(bx, by), this.cam.sy(bx, by));
      const steep = Math.min(1, mag / 420);
      grad.addColorStop(0, `rgba(255,255,255,${0.04 + steep * 0.1})`);
      grad.addColorStop(0.5, 'rgba(255,255,255,0)');
      grad.addColorStop(1, `rgba(0,0,0,${0.06 + steep * 0.14})`);
      g.fillStyle = grad;
      g.fill(p);
      // Contour lines across the slope.
      g.strokeStyle = 'rgba(255,255,255,0.07)';
      g.lineWidth = 1;
      const nx = -uy;
      const ny = ux;
      for (let k = -reach; k <= reach; k += 26) {
        const ox = cx + ux * k;
        const oy = cy + uy * k;
        g.beginPath();
        g.moveTo(this.cam.sx(ox - nx * reach * 2, oy - ny * reach * 2), this.cam.sy(ox - nx * reach * 2, oy - ny * reach * 2));
        g.lineTo(this.cam.sx(ox + nx * reach * 2, oy + ny * reach * 2), this.cam.sy(ox + nx * reach * 2, oy + ny * reach * 2));
        g.stroke();
      }
      g.restore();
    }
  }

  private drawSand(hole: HoleDef): void {
    const g = this.g;
    const rnd = artRng(hole.number * 97);
    for (const poly of hole.sand ?? []) {
      const p = this.path(poly);
      // Bunker lip shadow.
      this.softShadow((sg) => sg.fill(p), this.px(8), 0, this.px(2), 'rgba(0,0,0,0.5)');
      const xs = poly.map((q) => this.cam.sx(q[0], q[1]));
      const ys = poly.map((q) => this.cam.sy(q[0], q[1]));
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      const grad = g.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, ART.sandLight);
      grad.addColorStop(1, ART.sandDark);
      g.fillStyle = grad;
      g.fill(p);
      g.save();
      g.clip(p);
      // Raked lines + grain.
      g.strokeStyle = 'rgba(120, 84, 40, 0.18)';
      g.lineWidth = 1;
      for (let y = y0 - 10; y < y1 + 10; y += Math.max(4, this.px(7))) {
        g.beginPath();
        for (let x = x0 - 10; x <= x1 + 10; x += 8) {
          const yy = y + Math.sin(x * 0.05 + y * 0.02) * 1.6;
          if (x === x0 - 10) g.moveTo(x, yy);
          else g.lineTo(x, yy);
        }
        g.stroke();
      }
      for (let i = 0; i < (x1 - x0) * (y1 - y0) * 0.02; i++) {
        g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.25)' : 'rgba(110,70,30,0.22)';
        g.fillRect(x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0), 1, 1);
      }
      // Inner shade at the lip.
      g.lineWidth = this.px(10);
      g.strokeStyle = 'rgba(120, 80, 30, 0.25)';
      g.stroke(p);
      g.restore();
      g.lineWidth = Math.max(1, this.px(1.5));
      g.strokeStyle = rgba(ART.sandRim, 0.9);
      g.stroke(p);
    }
  }

  private drawDecorStatic(hole: HoleDef): void {
    const g = this.g;
    for (const d of hole.decor ?? []) {
      if (d.kind === 'chevrons') {
        const s = this.px(1);
        for (let i = 0; i < d.count; i++) {
          const off = (i - (d.count - 1) / 2) * 34;
          const cx = d.at[0] + d.dir[0] * off;
          const cy = d.at[1] + d.dir[1] * off;
          this.chevron(cx, cy, d.dir[0], d.dir[1], 16, 'rgba(255,255,255,0.12)', Math.max(2, 5 * s));
        }
      } else if (d.kind === 'sign') {
        const x = this.cam.sx(d.at[0], d.at[1]);
        const y = this.cam.sy(d.at[0], d.at[1]);
        g.save();
        g.translate(x, y);
        if (this.cam.rotated) g.rotate(-Math.PI / 2);
        g.font = `${Math.max(10, Math.round(this.px(34)))}px ${DISPLAY_FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = 'rgba(255,255,255,0.13)';
        g.fillText(d.text, 0, 0);
        g.restore();
      }
    }
  }

  /** A chevron pointing along (dx, dy) in world space. */
  private chevron(cx: number, cy: number, dx: number, dy: number, size: number, color: string, width: number): void {
    const g = this.g;
    const nx = -dy;
    const ny = dx;
    const tipX = cx + dx * size * 0.6;
    const tipY = cy + dy * size * 0.6;
    const aX = cx - dx * size * 0.4 + nx * size * 0.7;
    const aY = cy - dy * size * 0.4 + ny * size * 0.7;
    const bX = cx - dx * size * 0.4 - nx * size * 0.7;
    const bY = cy - dy * size * 0.4 - ny * size * 0.7;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(this.cam.sx(aX, aY), this.cam.sy(aX, aY));
    g.lineTo(this.cam.sx(tipX, tipY), this.cam.sy(tipX, tipY));
    g.lineTo(this.cam.sx(bX, bY), this.cam.sy(bX, bY));
    g.stroke();
  }

  private drawTee(hole: HoleDef): void {
    const g = this.g;
    const [tx, ty] = hole.tee;
    const r = 26;
    const mat = this.path([
      [tx - r, ty - r],
      [tx + r, ty - r],
      [tx + r, ty + r],
      [tx - r, ty + r],
    ]);
    g.fillStyle = rgba(ART.tee, 0.85);
    g.fill(mat);
    g.setLineDash([Math.max(2, this.px(5)), Math.max(2, this.px(4))]);
    g.strokeStyle = rgba(ART.teeEdge, 0.55);
    g.lineWidth = Math.max(1, this.px(2));
    g.stroke(mat);
    g.setLineDash([]);
    const x = this.cam.sx(tx, ty);
    const y = this.cam.sy(tx, ty);
    g.fillStyle = rgba(ART.teeEdge, 0.5);
    g.beginPath();
    g.arc(x, y, Math.max(2, this.px(4)), 0, Math.PI * 2);
    g.fill();
  }

  private drawCup(hole: HoleDef): void {
    const g = this.g;
    const x = this.cam.sx(hole.cup[0], hole.cup[1]);
    const y = this.cam.sy(hole.cup[0], hole.cup[1]);
    const r = this.px(PHYS.cupR);
    // Green collar around the cup.
    const collar = g.createRadialGradient(x, y, r, x, y, r * 3.2);
    collar.addColorStop(0, 'rgba(190, 255, 120, 0.22)');
    collar.addColorStop(1, 'rgba(190, 255, 120, 0)');
    g.fillStyle = collar;
    g.beginPath();
    g.arc(x, y, r * 3.2, 0, Math.PI * 2);
    g.fill();
    // The hole, with depth.
    const hole2 = g.createRadialGradient(x, y + r * 0.35, r * 0.1, x, y, r);
    hole2.addColorStop(0, '#000');
    hole2.addColorStop(0.7, ART.cupHole);
    hole2.addColorStop(1, '#1b2a1e');
    g.fillStyle = hole2;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = rgba(ART.cupRim, 0.9);
    g.lineWidth = Math.max(1.2, this.px(2.4));
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.stroke();
    // Inner lip shadow.
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = Math.max(1, this.px(3));
    g.beginPath();
    g.arc(x, y + this.px(1.5), r - this.px(2.5), Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
  }

  private drawPortalWells(hole: HoleDef): void {
    const g = this.g;
    for (const p of hole.portals ?? []) {
      const color = ART.portal[p.color] ?? '#22d3ee';
      for (const [wx, wy, entry] of [
        [p.from[0], p.from[1], true],
        [p.to[0], p.to[1], false],
      ] as const) {
        const x = this.cam.sx(wx, wy);
        const y = this.cam.sy(wx, wy);
        const r = this.px(PHYS.portalR + 4);
        const grad = g.createRadialGradient(x, y, 1, x, y, r);
        grad.addColorStop(0, entry ? '#020106' : rgba(color, 0.35));
        grad.addColorStop(0.7, entry ? rgba(color, 0.25) : rgba(color, 0.12));
        grad.addColorStop(1, rgba(color, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  private drawPosts(hole: HoleDef): void {
    const g = this.g;
    const h = Math.max(3, this.px(10));
    for (const post of hole.posts ?? []) {
      const x = this.cam.sx(post.at[0], post.at[1]);
      const y = this.cam.sy(post.at[0], post.at[1]);
      const r = this.px(post.r);
      this.softShadow((sg) => {
        sg.beginPath();
        sg.arc(x, y, r, 0, Math.PI * 2);
        sg.fill();
      }, this.px(10), this.px(4), h + this.px(4), 'rgba(0,0,0,0.6)');
      // Cylinder side.
      g.fillStyle = shade(ART.post, -0.5);
      g.beginPath();
      g.arc(x, y + h, r, 0, Math.PI);
      g.lineTo(x - r, y);
      g.arc(x, y, r, Math.PI, 0, true);
      g.closePath();
      g.fill();
      const top = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
      top.addColorStop(0, ART.postTop);
      top.addColorStop(1, ART.post);
      g.fillStyle = top;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawBumpersStatic(hole: HoleDef): void {
    const g = this.g;
    const h = Math.max(3, this.px(12));
    for (const b of hole.bumpers ?? []) {
      const x = this.cam.sx(b.at[0], b.at[1]);
      const y = this.cam.sy(b.at[0], b.at[1]);
      const r = this.px(b.r);
      this.softShadow((sg) => {
        sg.beginPath();
        sg.arc(x, y, r, 0, Math.PI * 2);
        sg.fill();
      }, this.px(12), this.px(4), h + this.px(5), 'rgba(0,0,0,0.6)');
      g.fillStyle = '#3b0a33';
      g.beginPath();
      g.arc(x, y + h, r, 0, Math.PI);
      g.lineTo(x - r, y);
      g.arc(x, y, r, Math.PI, 0, true);
      g.closePath();
      g.fill();
    }
  }

  private drawWalls(hole: HoleDef): void {
    const g = this.g;
    const width = this.px(PHYS.wallWidth);
    const h = Math.max(3, this.px(12));
    const paths = hole.walls.map((w) => ({ w, top: this.path(w.pts, Boolean(w.closed)), side: this.path(w.pts, Boolean(w.closed), h) }));
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // Drop shadows onto the void / turf.
    this.softShadow(
      (sg) => {
        sg.lineCap = 'round';
        sg.lineJoin = 'round';
        sg.lineWidth = width;
        sg.strokeStyle = '#000';
        for (const p of paths) sg.stroke(p.side);
      },
      this.px(10),
      this.px(4),
      this.px(6),
      'rgba(0,0,0,0.55)',
    );
    // Extruded faces: a few layers from the base up for a solid look.
    const steps = 4;
    for (let i = steps; i >= 1; i--) {
      g.save();
      g.translate(0, (h * i) / steps);
      g.lineWidth = width;
      for (const p of paths) {
        const base = p.w.kind === 'kicker' ? '#3a0f36' : p.w.kind === 'bank' ? '#3a3210' : ART.wallFace;
        g.strokeStyle = i === steps ? ART.wallFaceDark : shade(base, -0.12 * (i - 1));
        g.stroke(p.top);
      }
      g.restore();
    }
    // Tops: dark rails…
    g.lineWidth = width;
    for (const p of paths) {
      g.strokeStyle = p.w.kind === 'kicker' ? '#3d1638' : p.w.kind === 'bank' ? '#3b3514' : ART.wallTop;
      g.stroke(p.top);
    }
    // …with a lit bevel on the upper edge…
    g.save();
    g.translate(0, -Math.max(0.6, width * 0.18));
    g.lineWidth = Math.max(1, width * 0.28);
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    for (const p of paths) g.stroke(p.top);
    g.restore();
    // …and a glowing neon tube inlaid along the top.
    const glow = this.glow;
    for (const p of paths) {
      const neon = p.w.kind === 'kicker' ? ART.kickerGlow : p.w.kind === 'bank' ? ART.bankGlow : ART.wallGlow;
      g.save();
      if (glow > 0) {
        g.shadowColor = rgba(neon, 0.8);
        g.shadowBlur = 7 * glow * this.dpr;
      }
      g.strokeStyle = neon;
      g.lineWidth = Math.max(1.4, width * 0.24);
      g.stroke(p.top);
      g.shadowBlur = 0;
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.lineWidth = Math.max(0.8, width * 0.1);
      g.stroke(p.top);
      g.restore();
    }
  }

  private drawLamps(hole: HoleDef): void {
    const g = this.g;
    for (const d of hole.decor ?? []) {
      if (d.kind !== 'lamp') continue;
      const x = this.cam.sx(d.at[0], d.at[1]);
      const y = this.cam.sy(d.at[0], d.at[1]);
      const r = Math.max(2.5, this.px(6));
      const lift = Math.max(6, this.px(20));
      if (this.glow > 0) {
        const halo = g.createRadialGradient(x, y - lift, 1, x, y - lift, r * 7);
        halo.addColorStop(0, rgba(d.color, 0.55 * this.glow));
        halo.addColorStop(1, rgba(d.color, 0));
        g.fillStyle = halo;
        g.beginPath();
        g.arc(x, y - lift, r * 7, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = '#1b1b2e';
      g.lineWidth = Math.max(2, this.px(4));
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y - lift);
      g.stroke();
      g.fillStyle = d.color;
      g.beginPath();
      g.arc(x, y - lift, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.arc(x - r * 0.3, y - lift - r * 0.3, r * 0.35, 0, Math.PI * 2);
      g.fill();
    }
  }

  // ---------------------------------------------------------------------------
  // Living layer
  // ---------------------------------------------------------------------------

  private drawLiving(hole: HoleDef, frame: Frame, t: number): void {
    const g = this.g;
    const still = this.opts.reducedMotion;
    const time = still ? 0 : t / 1000;
    // Water shimmer (then the decks/bridges drawn back on top of it).
    if (hole.water?.length) {
      for (const poly of hole.water) {
        const p = this.path(poly);
        g.save();
        g.clip(p);
        const xs = poly.map((q) => this.cam.sx(q[0], q[1]));
        const ys = poly.map((q) => this.cam.sy(q[0], q[1]));
        const x0 = Math.min(...xs);
        const x1 = Math.max(...xs);
        const y0 = Math.min(...ys);
        const y1 = Math.max(...ys);
        g.strokeStyle = rgba(ART.waterLight, 0.22);
        g.lineWidth = Math.max(1, this.px(2));
        const step = Math.max(8, this.px(22));
        for (let y = y0 + ((time * 14) % step); y < y1; y += step) {
          g.beginPath();
          for (let x = x0; x <= x1; x += 6) {
            const yy = y + Math.sin(x * 0.045 + time * 1.7 + y * 0.1) * this.px(4);
            if (x === x0) g.moveTo(x, yy);
            else g.lineTo(x, yy);
          }
          g.stroke();
        }
        g.restore();
      }
      if (this.turfPath && this.staticLayer) {
        g.save();
        g.clip(this.turfPath);
        g.drawImage(this.staticLayer, 0, 0, this.cssW, this.cssH);
        g.restore();
      }
    }
    // Slope chevrons slide downhill.
    for (const s of hole.slopes ?? []) {
      const p = this.path(s.poly);
      g.save();
      g.clip(p);
      if (this.turfPath) g.clip(this.turfPath);
      const mag = Math.hypot(s.accel[0], s.accel[1]) || 1;
      const ux = s.accel[0] / mag;
      const uy = s.accel[1] / mag;
      const xs = s.poly.map((q) => q[0]);
      const ys = s.poly.map((q) => q[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const reach = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 30;
      const spacing = 70;
      const shift = (time * 26 * Math.min(1.6, mag / 300)) % spacing;
      const ring = s.poly.flat();
      const nx = -uy;
      const ny = ux;
      const alpha = mag > PHYS.friction ? 0.34 : 0.18;
      for (let k = -reach; k <= reach; k += spacing) {
        for (let m = -reach; m <= reach; m += 90) {
          const wx = cx + ux * (k + shift) + nx * m;
          const wy = cy + uy * (k + shift) + ny * m;
          if (this.nearWall(hole, wx, wy, 26)) continue;
          if (!pointInPoly(wx + ux * 10, wy + uy * 10, ring) || !pointInPoly(wx - ux * 8 + nx * 12, wy - uy * 8 + ny * 12, ring) || !pointInPoly(wx - ux * 8 - nx * 12, wy - uy * 8 - ny * 12, ring)) continue;
          this.chevron(wx, wy, ux, uy, 14, `rgba(253,224,71,${alpha})`, Math.max(1.5, this.px(3.5)));
        }
      }
      g.restore();
    }
    // Portals.
    const now = performance.now();
    (hole.portals ?? []).forEach((p, i) => {
      const color = ART.portal[p.color] ?? '#22d3ee';
      const flash = Math.max(0, 1 - (now - (frame.portalHits.get(i) ?? -1e9)) / 600);
      this.drawPortal(p.from[0], p.from[1], color, p.label, true, time, flash, 0, 0);
      this.drawPortal(p.to[0], p.to[1], color, p.label, false, time, flash, p.exit[0], p.exit[1]);
    });
    // Bumpers (lit, flash on hit).
    (hole.bumpers ?? []).forEach((b, i) => {
      const x = this.cam.sx(b.at[0], b.at[1]);
      const y = this.cam.sy(b.at[0], b.at[1]);
      const r = this.px(b.r);
      const flash = Math.max(0, 1 - (now - (frame.bumperHits.get(i) ?? -1e9)) / 350);
      const pulse = still ? 0.5 : 0.5 + 0.5 * Math.sin(time * 3 + i);
      g.save();
      if (this.glow > 0) {
        g.shadowColor = ART.bumper;
        g.shadowBlur = (10 + 14 * flash) * this.glow * this.dpr;
      }
      const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
      grad.addColorStop(0, flash > 0 ? '#ffffff' : ART.bumperCore);
      grad.addColorStop(0.55, ART.bumper);
      grad.addColorStop(1, shade(ART.bumper, -0.45));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r * (1 + flash * 0.08), 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.strokeStyle = `rgba(255,255,255,${0.35 + pulse * 0.3 + flash * 0.35})`;
      g.lineWidth = Math.max(1.2, this.px(3));
      g.beginPath();
      g.arc(x, y, r * 0.62, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(x, y, Math.max(1.5, r * 0.18), 0, Math.PI * 2);
      g.fill();
    });
    // Moving obstacles.
    for (const m of hole.movers ?? []) this.drawMover(m, frame.obstacleMs);
    // The flag.
    this.drawFlag(hole, frame, time);
  }

  /** Whether a world point is within `d` of any cushion (keeps painted marks off the rails). */
  private nearWall(hole: HoleDef, x: number, y: number, d: number): boolean {
    for (const s of compileHole(hole).segs) {
      const dx = s.bx - s.ax;
      const dy = s.by - s.ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((x - s.ax) * dx + (y - s.ay) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = s.ax + dx * t - x;
      const ey = s.ay + dy * t - y;
      if (ex * ex + ey * ey < d * d) return true;
    }
    return false;
  }

  private drawPortal(wx: number, wy: number, color: string, label: string, entry: boolean, time: number, flash: number, ex: number, ey: number): void {
    const g = this.g;
    const x = this.cam.sx(wx, wy);
    const y = this.cam.sy(wx, wy);
    const r = this.px(PHYS.portalR);
    g.save();
    if (this.glow > 0) {
      g.shadowColor = color;
      g.shadowBlur = (8 + flash * 16) * this.glow * this.dpr;
    }
    g.lineCap = 'round';
    if (entry) {
      for (let k = 0; k < 3; k++) {
        const rr = r * (1 - k * 0.24);
        const a0 = time * (2.2 + k * 0.9) * (k % 2 ? -1 : 1) + k * 2;
        g.strokeStyle = rgba(color, 0.95 - k * 0.2);
        g.lineWidth = Math.max(1.4, this.px(3.2 - k * 0.6));
        g.beginPath();
        g.arc(x, y, rr, a0, a0 + Math.PI * 1.25);
        g.stroke();
      }
    } else {
      g.strokeStyle = rgba(color, 0.9);
      g.lineWidth = Math.max(1.4, this.px(3));
      g.setLineDash([Math.max(2, this.px(6)), Math.max(2, this.px(4))]);
      g.lineDashOffset = -time * 20;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      // Exit arrow.
      const d = this.cam.dirToScreen(ex, ey);
      const ax = x + d.x * r * 1.55;
      const ay = y + d.y * r * 1.55;
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(ax + d.x * r * 0.5, ay + d.y * r * 0.5);
      g.lineTo(ax - d.y * r * 0.4, ay + d.x * r * 0.4);
      g.lineTo(ax + d.y * r * 0.4, ay - d.x * r * 0.4);
      g.closePath();
      g.fill();
    }
    g.restore();
    // Label chip (colour is never the only cue).
    const fs = Math.max(10, Math.round(this.px(19)));
    g.font = `700 ${fs}px ${NUM_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lx = x + r * 1.05;
    const ly = y - r * 1.05;
    g.fillStyle = 'rgba(5,4,11,0.8)';
    g.beginPath();
    g.arc(lx, ly, fs * 0.72, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = color;
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = color;
    g.fillText(label, lx, ly + 1);
  }

  private drawMover(m: NonNullable<HoleDef['movers']>[number], tMs: number): void {
    const g = this.g;
    const bars = moverBars(m, tMs);
    const width = this.px(m.width);
    const lift = Math.max(3, this.px(10));
    g.lineCap = 'round';
    // Shadow.
    this.softShadow(
      (sg) => {
        sg.lineCap = 'round';
        sg.lineWidth = width;
        sg.strokeStyle = '#000';
        for (const [ax, ay, bx, by] of bars) {
          sg.beginPath();
          sg.moveTo(this.cam.sx(ax, ay), this.cam.sy(ax, ay));
          sg.lineTo(this.cam.sx(bx, by), this.cam.sy(bx, by));
          sg.stroke();
        }
      },
      this.px(8),
      this.px(4),
      lift + this.px(6),
      'rgba(0,0,0,0.55)',
    );
    if (m.kind === 'sweeper') {
      // Rail the sweeper glides on.
      g.strokeStyle = 'rgba(251,146,60,0.25)';
      g.lineWidth = Math.max(1, this.px(3));
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(this.cam.sx(m.a[0] - m.axis[0] * m.halfLength, m.a[1] - m.axis[1] * m.halfLength), this.cam.sy(m.a[0] - m.axis[0] * m.halfLength, m.a[1] - m.axis[1] * m.halfLength));
      g.lineTo(this.cam.sx(m.b[0] + m.axis[0] * m.halfLength, m.b[1] + m.axis[1] * m.halfLength), this.cam.sy(m.b[0] + m.axis[0] * m.halfLength, m.b[1] + m.axis[1] * m.halfLength));
      g.stroke();
      g.setLineDash([]);
    }
    for (const [ax, ay, bx, by] of bars) {
      const x0 = this.cam.sx(ax, ay);
      const y0 = this.cam.sy(ax, ay);
      const x1 = this.cam.sx(bx, by);
      const y1 = this.cam.sy(bx, by);
      g.strokeStyle = shade(ART.blade, -0.5);
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(x0, y0 + lift * 0.5);
      g.lineTo(x1, y1 + lift * 0.5);
      g.stroke();
      g.save();
      if (this.glow > 0) {
        g.shadowColor = ART.blade;
        g.shadowBlur = 8 * this.glow * this.dpr;
      }
      g.strokeStyle = ART.blade;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      g.restore();
      g.strokeStyle = ART.bladeTop;
      g.lineWidth = Math.max(1, width * 0.3);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      g.fillStyle = '#fff7ed';
      g.beginPath();
      g.arc(x1, y1, Math.max(1.5, width * 0.28), 0, Math.PI * 2);
      g.fill();
    }
    if (m.kind === 'windmill') {
      const x = this.cam.sx(m.at[0], m.at[1]);
      const y = this.cam.sy(m.at[0], m.at[1]);
      const r = this.px(m.hubR);
      const pose = moverPose(m, tMs);
      g.fillStyle = ART.hub;
      g.beginPath();
      g.arc(x, y + lift * 0.6, r, 0, Math.PI * 2);
      g.fill();
      const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
      grad.addColorStop(0, '#fdba74');
      grad.addColorStop(1, '#9a3412');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      // Spinning cap detail.
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = Math.max(1, this.px(2.5));
      g.beginPath();
      g.arc(x, y, r * 0.55, pose.angle, pose.angle + Math.PI * 1.2);
      g.stroke();
    }
  }

  private drawFlag(hole: HoleDef, frame: Frame, time: number): void {
    const g = this.g;
    const x = this.cam.sx(hole.cup[0], hole.cup[1]);
    const y = this.cam.sy(hole.cup[0], hole.cup[1]);
    const near = frame.balls.some((b) => (b.x - hole.cup[0]) ** 2 + (b.y - hole.cup[1]) ** 2 < 70 * 70);
    const h = Math.max(22, Math.min(54, this.px(64)));
    g.save();
    g.globalAlpha = near ? 0.35 : 1;
    // Pole shadow.
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + h * 0.45, y + h * 0.2);
    g.stroke();
    g.strokeStyle = ART.flagPole;
    g.lineWidth = Math.max(1.5, this.px(3));
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y - h);
    g.stroke();
    const fw = h * 0.62;
    const fh = h * 0.38;
    const wave = (k: number) => Math.sin(time * 5 + k * 3) * fh * 0.12;
    g.fillStyle = ART.flag;
    if (this.glow > 0) {
      g.shadowColor = ART.flag;
      g.shadowBlur = 8 * this.glow * this.dpr;
    }
    g.beginPath();
    g.moveTo(x, y - h);
    g.quadraticCurveTo(x + fw * 0.5, y - h + wave(0.3), x + fw, y - h + fh * 0.5 + wave(1));
    g.quadraticCurveTo(x + fw * 0.5, y - h + fh + wave(0.6), x, y - h + fh);
    g.closePath();
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#1a1200';
    g.font = `${Math.max(9, Math.round(fh * 0.72))}px ${NUM_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(hole.number), x + fw * 0.38, y - h + fh * 0.52);
    g.restore();
  }

  // ---------------------------------------------------------------------------
  // Aim + balls
  // ---------------------------------------------------------------------------

  private drawAim(aim: AimDraw | null, t: number): void {
    if (!aim) return;
    const g = this.g;
    const bx = this.cam.sx(aim.x, aim.y);
    const by = this.cam.sy(aim.x, aim.y);
    const R = this.px(PHYS.ballR);
    const p = aim.power / PUTT_POWER_MAX;
    // Slingshot band (screen space): from where the drag started to the pointer.
    if (aim.drag) {
      const d = aim.drag;
      g.save();
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 2;
      g.setLineDash([3, 5]);
      g.beginPath();
      g.moveTo(d.ax, d.ay);
      g.lineTo(d.px, d.py);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath();
      g.arc(d.ax, d.ay, 7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = rgba(aim.color, 0.85);
      g.beginPath();
      g.arc(d.px, d.py, 9, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.stroke();
      g.restore();
    }
    if (!aim.mine) {
      // Someone else lining up: a faint dotted ray in their colour.
      const a = (aim.angle * Math.PI) / 18000;
      const d = this.cam.dirToScreen(Math.cos(a), Math.sin(a));
      const len = (40 + 120 * p) * this.cam.scale;
      g.save();
      g.strokeStyle = rgba(aim.color, 0.6);
      g.lineWidth = 2;
      g.setLineDash([2, 6]);
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(bx + d.x * len, by + d.y * len);
      g.stroke();
      g.restore();
      return;
    }
    if (p <= 0) return;
    // Preview (limited: until the first bounce).
    const pts = aim.preview;
    if (pts.length >= 4) {
      g.save();
      g.lineCap = 'round';
      const n = pts.length / 2;
      const dash = Math.max(3, R * 0.7);
      for (let i = 1; i < n; i++) {
        const a = 1 - i / n;
        g.strokeStyle = `rgba(255,255,255,${0.2 + a * 0.7})`;
        g.lineWidth = Math.max(1.5, R * 0.42);
        g.setLineDash([dash * 0.4, dash]);
        g.lineDashOffset = -(t / 40) % (dash * 1.4);
        g.beginPath();
        g.moveTo(this.cam.sx(pts[(i - 1) * 2]!, pts[(i - 1) * 2 + 1]!), this.cam.sy(pts[(i - 1) * 2]!, pts[(i - 1) * 2 + 1]!));
        g.lineTo(this.cam.sx(pts[i * 2]!, pts[i * 2 + 1]!), this.cam.sy(pts[i * 2]!, pts[i * 2 + 1]!));
        g.stroke();
      }
      g.restore();
      if (aim.contact) {
        const cx = this.cam.sx(aim.contact.x, aim.contact.y);
        const cy = this.cam.sy(aim.contact.x, aim.contact.y);
        g.strokeStyle = 'rgba(255,255,255,0.75)';
        g.lineWidth = 1.5;
        g.setLineDash([2, 3]);
        g.beginPath();
        g.arc(cx, cy, R, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
    }
    // Power ring + direction nib around my ball.
    const ringR = R + Math.max(8, this.px(12));
    const a = (aim.angle * Math.PI) / 18000;
    const dir = this.cam.dirToScreen(Math.cos(a), Math.sin(a));
    const hue = p < 0.5 ? '#a3e635' : p < 0.8 ? '#fde047' : p < 0.95 ? '#fb923c' : '#ff5a5f';
    g.save();
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = Math.max(4, this.px(6));
    g.beginPath();
    g.arc(bx, by, ringR, 0, Math.PI * 2);
    g.stroke();
    if (this.glow > 0) {
      g.shadowColor = hue;
      g.shadowBlur = 10 * this.glow * this.dpr;
    }
    g.strokeStyle = hue;
    const start = Math.atan2(dir.y, dir.x) + Math.PI;
    g.beginPath();
    g.arc(bx, by, ringR, start - Math.PI * p, start + Math.PI * p);
    g.stroke();
    g.shadowBlur = 0;
    // Arrow in the putt direction.
    const tipLen = ringR + Math.max(12, this.px(18)) + p * Math.max(14, this.px(26));
    const tx = bx + dir.x * tipLen;
    const ty = by + dir.y * tipLen;
    g.strokeStyle = hue;
    g.lineWidth = Math.max(2.5, this.px(4));
    g.beginPath();
    g.moveTo(bx + dir.x * (ringR + 3), by + dir.y * (ringR + 3));
    g.lineTo(tx, ty);
    g.stroke();
    g.fillStyle = hue;
    const hw = Math.max(5, this.px(8));
    g.beginPath();
    g.moveTo(tx + dir.x * hw * 1.3, ty + dir.y * hw * 1.3);
    g.lineTo(tx - dir.y * hw, ty + dir.x * hw);
    g.lineTo(tx + dir.y * hw, ty - dir.x * hw);
    g.closePath();
    g.fill();
    g.restore();
  }

  private drawBall(ball: BallDraw, t: number, frame: Frame): void {
    const g = this.g;
    const x = this.cam.sx(ball.x, ball.y);
    const y = this.cam.sy(ball.x, ball.y);
    const R = Math.max(3, this.px(PHYS.ballR)) * ball.scale;
    g.save();
    g.globalAlpha = ball.alpha * (ball.me ? 1 : 0.9);
    // Trail.
    const tr = ball.trail;
    if (tr.length >= 4 && this.opts.fx !== 'off') {
      g.lineCap = 'round';
      const n = tr.length / 2;
      for (let i = 1; i < n; i++) {
        const k = i / n;
        g.strokeStyle = rgba(ball.color, 0.35 * k);
        g.lineWidth = R * 1.4 * k;
        g.beginPath();
        g.moveTo(this.cam.sx(tr[(i - 1) * 2]!, tr[(i - 1) * 2 + 1]!), this.cam.sy(tr[(i - 1) * 2]!, tr[(i - 1) * 2 + 1]!));
        g.lineTo(this.cam.sx(tr[i * 2]!, tr[i * 2 + 1]!), this.cam.sy(tr[i * 2]!, tr[i * 2 + 1]!));
        g.stroke();
      }
    }
    // Turn highlight.
    const multi = frame.balls.length > 1;
    if (ball.active && !ball.moving && ball.scale >= 1) {
      const pulse = this.opts.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t / 220);
      g.strokeStyle = rgba(ball.color, 0.35 + pulse * 0.4);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, R + 5 + pulse * 3, 0, Math.PI * 2);
      g.stroke();
    }
    // Shadow.
    g.fillStyle = 'rgba(0,0,0,0.38)';
    g.beginPath();
    g.ellipse(x + R * 0.35, y + R * 0.55, R * 1.05, R * 0.8, 0, 0, Math.PI * 2);
    g.fill();
    // Body.
    const body = g.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.1, x, y, R);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.65, ART.ball);
    body.addColorStop(1, ART.ballShade);
    g.fillStyle = body;
    g.beginPath();
    g.arc(x, y, R, 0, Math.PI * 2);
    g.fill();
    // Identity ring in the player's colour.
    g.strokeStyle = ball.color;
    g.lineWidth = Math.max(1.5, R * 0.3);
    g.beginPath();
    g.arc(x, y, R + g.lineWidth * 0.4, 0, Math.PI * 2);
    g.stroke();
    // Name tag for other golfers (at rest).
    if (multi && !ball.me && !ball.moving && ball.scale >= 1) {
      const label = ball.name.length > 10 ? `${ball.name.slice(0, 9)}…` : ball.name;
      g.font = `600 11px ${NUM_FONT}`;
      const w = g.measureText(label).width + 10;
      const ty = y - R - 16;
      g.fillStyle = 'rgba(5,4,11,0.72)';
      g.beginPath();
      g.roundRect(x - w / 2, ty - 8, w, 16, 8);
      g.fill();
      g.fillStyle = ball.color;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, x, ty + 0.5);
    }
    g.restore();
  }

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  private handleFx(list: FxEvent[]): void {
    const s = this.cam.scale;
    for (const e of list) {
      const x = this.cam.sx(e.x, e.y);
      const y = this.cam.sy(e.x, e.y);
      switch (e.kind) {
        case 'impact':
          if (e.what === 'sand') this.particles.puff(x, y, ART.sandLight, Math.max(0.7, s));
          else if (e.what === 'bumper') {
            this.particles.sparks(x, y, 0, -1, 500, ART.bumper);
            this.particles.ring(x, y, this.px(26), ART.bumper, 0.4);
          } else this.particles.sparks(x, y, 0, -1, e.v, e.what === 'blade' ? ART.blade : '#e9ffd0');
          break;
        case 'cup':
          this.particles.confetti(x, y, [e.color, '#fde047', '#a3e635', '#22d3ee', '#ff4fd8'], Math.max(0.7, s), e.big);
          this.particles.ring(x, y, this.px(PHYS.cupR * 1.4), '#fde047', 0.6);
          break;
        case 'splash':
          this.particles.splash(x, y, Math.max(0.7, s));
          break;
        case 'fall':
          this.particles.ring(x, y, this.px(14), '#ff5a5f', 0.5);
          this.particles.motes(x, y, '#ff8a3d', Math.max(0.7, s));
          break;
        case 'portal':
          this.particles.motes(x, y, '#e0f7ff', Math.max(0.7, s));
          break;
        case 'strike':
          this.particles.ring(x, y, this.px(PHYS.ballR * 2), '#ffffff', 0.35);
          break;
      }
    }
  }
}
