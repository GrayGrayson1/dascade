/**
 * Fits a hole into the view (CSS pixels) and maps world ↔ screen. On portrait screens a
 * landscape hole is rotated 90° (tee at the bottom, putting "up" the screen) whenever that
 * makes it larger — mobile portrait is designed, not shrunk.
 */

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class Camera {
  scale = 1;
  rotated = false;
  /** Screen centre of the fitted area. */
  cx = 0;
  cy = 0;
  /** World centre of the hole bounds. */
  wx = 0;
  wy = 0;

  fit(b: Bounds, viewW: number, viewH: number, insets: Insets, pad = 26): void {
    const w = Math.max(1, b.maxX - b.minX + pad * 2);
    const h = Math.max(1, b.maxY - b.minY + pad * 2);
    const aw = Math.max(40, viewW - insets.left - insets.right);
    const ah = Math.max(40, viewH - insets.top - insets.bottom);
    const flat = Math.min(aw / w, ah / h);
    const turned = Math.min(aw / h, ah / w);
    this.rotated = turned > flat * 1.15;
    this.scale = this.rotated ? turned : flat;
    this.wx = (b.minX + b.maxX) / 2;
    this.wy = (b.minY + b.maxY) / 2;
    this.cx = insets.left + aw / 2;
    this.cy = insets.top + ah / 2;
  }

  /** World → screen (CSS px). */
  sx(x: number, y: number): number {
    return this.rotated ? this.cx + (y - this.wy) * this.scale : this.cx + (x - this.wx) * this.scale;
  }
  sy(x: number, y: number): number {
    return this.rotated ? this.cy - (x - this.wx) * this.scale : this.cy + (y - this.wy) * this.scale;
  }

  /** Screen → world. */
  toWorld(px: number, py: number): { x: number; y: number } {
    if (this.rotated) return { x: this.wx - (py - this.cy) / this.scale, y: this.wy + (px - this.cx) / this.scale };
    return { x: this.wx + (px - this.cx) / this.scale, y: this.wy + (py - this.cy) / this.scale };
  }

  /** Screen-space direction → world direction (no scaling). */
  dirToWorld(dx: number, dy: number): { x: number; y: number } {
    return this.rotated ? { x: -dy, y: dx } : { x: dx, y: dy };
  }

  /** World direction → screen direction. */
  dirToScreen(dx: number, dy: number): { x: number; y: number } {
    return this.rotated ? { x: dy, y: -dx } : { x: dx, y: dy };
  }
}
