/**
 * Napalm on the ground: every burning pool is drawn as flickering flame tongues along its
 * columns (the shape comes from model/fire.ts), with a soft glow under the pool, rising embers
 * and a little smoke. Hot napalm burns blue-white. Reduced motion keeps the flames steady.
 */
import Phaser from 'phaser';
import type { Terrain } from '@dascade/game-core/tanks';
import { fireFlames, fireSpan } from '../model/fire.ts';
import type { FireLayer } from '../model/presenter.ts';
import type { Effects, FxQuality } from './fx.ts';

/** Flame colours, outer → inner, by fuel type. */
const NORMAL = { outer: 0xff4a12, mid: 0xff9a2a, core: 0xfff1a8, glow: 0xff6a1f };
const HOT = { outer: 0x3a7bff, mid: 0x9fd8ff, core: 0xffffff, glow: 0x6aa8ff };

export class FireRenderer {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly glow: Phaser.GameObjects.Graphics;
  private readonly H: number;
  private q: FxQuality;
  private nextEmber = 0;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, H: number, q: FxQuality, depth: number) {
    this.H = H;
    this.q = q;
    this.glow = scene.add
      .graphics()
      .setDepth(depth - 1)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.g = scene.add.graphics().setDepth(depth).setBlendMode(Phaser.BlendModes.ADD);
    layer.add([this.glow, this.g]);
  }

  degrade(): void {
    this.q = { ...this.q, amount: Math.max(0.15, this.q.amount * 0.5) };
  }

  update(now: number, fires: readonly FireLayer[], terrain: Terrain, fx: Effects): void {
    const g = this.g;
    const glow = this.glow;
    g.clear();
    glow.clear();
    if (fires.length === 0) return;
    const still = this.q.reducedMotion;
    const step = this.q.amount >= 0.7 ? 3 : this.q.amount >= 0.4 ? 4 : 6;
    const emberDue = now >= this.nextEmber;
    if (emberDue) this.nextEmber = now + 70 / Math.max(0.2, this.q.amount);
    for (const layer of fires) {
      const pal = layer.hot ? HOT : NORMAL;
      const elapsed = now - layer.start;
      const flicker = still ? () => 0.8 : (col: number) => 0.55 + 0.45 * Math.sin(now / 70 + col * 1.7) * Math.sin(now / 113 + col * 0.37);
      const flames = fireFlames(layer, terrain, elapsed, step, flicker);
      if (flames.length === 0) continue;
      // Glow pooled under the fire.
      for (let i = 0; i < flames.length; i += 3) {
        const f = flames[i]!;
        glow.fillStyle(pal.glow, 0.12 * f.alpha);
        glow.fillCircle(f.x, this.H - f.base - 4, 16 + f.heat * 2.2);
      }
      for (const f of flames) {
        const baseY = this.H - f.base + 1.5;
        const w = step * 1.15 + f.heat * 0.25;
        const sway = still ? 0 : Math.sin(now / 160 + f.x * 0.21) * 2.2;
        const tipX = f.x + sway;
        // Outer tongue, mid flame, white-hot core.
        g.fillStyle(pal.outer, 0.55 * f.alpha);
        g.fillTriangle(f.x - w, baseY, f.x + w, baseY, tipX, baseY - f.height);
        g.fillStyle(pal.mid, 0.7 * f.alpha);
        g.fillTriangle(f.x - w * 0.62, baseY, f.x + w * 0.62, baseY, tipX * 0.5 + f.x * 0.5, baseY - f.height * 0.68);
        g.fillStyle(pal.core, 0.8 * f.alpha);
        g.fillTriangle(f.x - w * 0.3, baseY, f.x + w * 0.3, baseY, f.x, baseY - f.height * 0.34);
      }
      if (emberDue) {
        const pick = flames[Math.floor(Math.random() * flames.length)]!;
        fx.ember(pick.x, pick.base + pick.height * 0.5, layer.hot);
        if (Math.random() < 0.25 * this.q.amount) {
          const span = fireSpan(layer);
          if (span) fx.smokeAt(span.x0 + Math.random() * (span.x1 - span.x0), pick.base + pick.height + 6);
        }
      }
    }
  }

  destroy(): void {
    this.g.destroy();
    this.glow.destroy();
  }
}
