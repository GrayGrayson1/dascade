/**
 * Speech bubbles over the tanks (the server's quips). A rounded box with a tail, the tank's
 * colour on the border, kept at a constant on-screen size like the name labels. Layout and
 * timing come from model/bubbles.ts.
 */
import Phaser from 'phaser';
import { layoutBubbles, wrapLine } from '../model/bubbles.ts';
import type { DisplayTank, Quip } from '../model/presenter.ts';
import { DISPLAY_FONT, hexToInt } from '../art/themes.ts';

interface BubbleView {
  box: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  text: Phaser.GameObjects.Text;
  w: number;
  h: number;
  color: string;
}

const PAD_X = 7;
const PAD_Y = 5;
const TAIL = 6;

export class QuipBubbles {
  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Layer;
  private readonly depth: number;
  private readonly dpr: number;
  private readonly views = new Map<number, BubbleView>();

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, depth: number, dpr: number) {
    this.scene = scene;
    this.layer = layer;
    this.depth = depth;
    this.dpr = dpr;
  }

  private make(key: number, line: string, color: string): BubbleView {
    const text = this.scene.add
      .text(0, 0, wrapLine(line).join('\n'), {
        fontFamily: DISPLAY_FONT,
        fontSize: '11px',
        color: '#130f22',
        align: 'center',
        lineSpacing: 1,
        resolution: this.dpr * 2,
      })
      .setOrigin(0.5, 1);
    const w = Math.ceil(text.width) + PAD_X * 2;
    const h = Math.ceil(text.height) + PAD_Y * 2;
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x07050f, 0.55);
    bg.fillRoundedRect(-w / 2 + 1.5, -h - TAIL + 2, w, h, 6);
    bg.fillStyle(0xfdfcff, 0.97);
    bg.fillRoundedRect(-w / 2, -h - TAIL, w, h, 6);
    bg.fillTriangle(-5, -TAIL - 0.5, 5, -TAIL - 0.5, 0, 0);
    bg.lineStyle(1.5, hexToInt(color), 1);
    bg.strokeRoundedRect(-w / 2, -h - TAIL, w, h, 6);
    text.setPosition(0, -TAIL - PAD_Y + 1);
    const box = this.scene.add.container(0, 0, [bg, text]).setDepth(this.depth);
    this.layer.add(box);
    const view = { box, bg, text, w, h, color };
    this.views.set(key, view);
    return view;
  }

  /**
   * Place every live bubble above its tank. `anchorY(t)` is the screen y (y-down world units)
   * just above the tank's label; `labelScale` keeps bubbles readable at any zoom.
   */
  update(
    now: number,
    quips: readonly Quip[],
    tanks: ReadonlyMap<string, DisplayTank>,
    anchorY: (t: DisplayTank) => number,
    labelScale: number,
  ): void {
    const slots = layoutBubbles(quips, now);
    const live = new Set<number>();
    // Row offsets need each tank's lower bubble height.
    const rowBase = new Map<string, number>();
    const sorted = [...slots].sort((a, b) => a.row - b.row);
    for (const s of sorted) {
      const t = tanks.get(s.id);
      if (!t) continue;
      live.add(s.key);
      const v = this.views.get(s.key) ?? this.make(s.key, s.line, t.color);
      const offset = rowBase.get(s.id) ?? 0;
      rowBase.set(s.id, offset + v.h + TAIL + 4);
      v.box
        .setPosition(t.x, anchorY(t) - offset * labelScale)
        .setScale(labelScale * s.scale)
        .setAlpha(s.alpha * (s.row > 0 ? 0.85 : 1))
        .setVisible(true);
    }
    for (const [key, v] of this.views) {
      if (live.has(key)) continue;
      v.box.destroy();
      this.views.delete(key);
    }
  }

  destroy(): void {
    for (const v of this.views.values()) v.box.destroy();
    this.views.clear();
  }
}
