/** Per-car display objects: body, shadow, neon underglow, lights and nameplate. */
import Phaser from 'phaser';
import type { ChassisId } from '@dascade/shared/games/circuit';
import { CarFlag } from '@dascade/game-core/circuit';
import { carDims, renderCarCanvas, renderNameplate } from '../art/carArt.ts';
import { hexToInt } from '../art/palette.ts';
import type { RaceCar } from '../race/controller.ts';
import { TEX_SCALE } from './textures.ts';
import { DEPTH } from './world.ts';

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export class CarView {
  readonly slot: number;
  private lookKey = '';
  private local = false;
  chassis: ChassisId = 'volt';
  primary = 0x22d3ee;
  L = 46;
  W = 24;
  private readonly scene: Phaser.Scene;
  private body: Phaser.GameObjects.Image;
  private shadow: Phaser.GameObjects.Image;
  private glow: Phaser.GameObjects.Image;
  private head: Phaser.GameObjects.Image;
  private tailL: Phaser.GameObjects.Image;
  private tailR: Phaser.GameObjects.Image;
  private label: Phaser.GameObjects.Image;
  private arrow: Phaser.GameObjects.Image | null = null;
  private readonly glowAlpha: number;
  seen = 0;

  constructor(scene: Phaser.Scene, car: RaceCar, local: boolean, glowAlpha: number) {
    this.scene = scene;
    this.slot = car.slot;
    this.glowAlpha = glowAlpha;
    this.shadow = scene.add.image(car.x, car.y, 'ci-shadow-volt');
    this.glow = scene.add.image(car.x, car.y, 'ci-glow').setBlendMode(Phaser.BlendModes.ADD);
    this.head = scene.add.image(car.x, car.y, 'ci-cone').setOrigin(0, 0.5).setBlendMode(Phaser.BlendModes.ADD).setTint(0xdff6ff);
    this.tailL = scene.add.image(car.x, car.y, 'ci-glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xff2a4a);
    this.tailR = scene.add.image(car.x, car.y, 'ci-glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xff2a4a);
    this.body = scene.add.image(car.x, car.y, 'ci-dot');
    this.label = scene.add.image(car.x, car.y, 'ci-dot').setDepth(DEPTH.label);
    this.applyLook(car, local);
  }

  private applyLook(car: RaceCar, local: boolean): void {
    if (car.lookKey === this.lookKey && local === this.local) return;
    this.lookKey = car.lookKey;
    this.local = local;
    this.chassis = car.look.chassis;
    const dims = carDims(this.chassis);
    this.L = dims.L;
    this.W = dims.W;
    this.primary = hexToInt(car.look.primary);
    const h = hash(car.lookKey);
    const carKey = `ci-car-${h}`;
    if (!this.scene.textures.exists(carKey)) this.scene.textures.addCanvas(carKey, renderCarCanvas(car.look, TEX_SCALE));
    this.body.setTexture(carKey).setScale(1 / TEX_SCALE);
    const npKey = `ci-np-${h}-${local ? 1 : 0}`;
    if (!this.scene.textures.exists(npKey)) this.scene.textures.addCanvas(npKey, renderNameplate(car.look, 3, local));
    this.label.setTexture(npKey).setScale(1 / 3);
    this.shadow.setTexture(`ci-shadow-${this.chassis}`);
    this.glow.setTint(this.primary);
    if (local && !this.arrow) this.arrow = this.scene.add.image(car.x, car.y, 'ci-arrow').setDepth(DEPTH.label).setScale(0.8);
    if (!local && this.arrow) {
      this.arrow.destroy();
      this.arrow = null;
    }
  }

  update(car: RaceCar, local: boolean, now: number, labelScale: number, showLabel: boolean): void {
    this.applyLook(car, local);
    this.seen = now;
    const elev = car.elevated;
    const upper = elev > 0.5;
    const cos = Math.cos(car.heading);
    const sin = Math.sin(car.heading);
    const ghost = (car.flags & CarFlag.ghost) !== 0 && !local;
    const alpha = ghost ? 0.45 : 1;
    const scaleUp = 1 + elev * 0.1;

    this.body
      .setPosition(car.x, car.y)
      .setRotation(car.heading)
      .setScale((1 / TEX_SCALE) * scaleUp)
      .setAlpha(alpha)
      .setDepth(upper ? DEPTH.upperCar : DEPTH.car);
    this.shadow
      .setPosition(car.x + 4 + elev * 16, car.y + 6 + elev * 22)
      .setRotation(car.heading)
      .setScale(0.5 * (1 + elev * 0.06))
      .setAlpha((0.62 - elev * 0.2) * alpha)
      .setDepth(upper ? DEPTH.upperShadow : DEPTH.shadow);
    const boosting = (car.flags & CarFlag.boosting) !== 0;
    this.glow
      .setPosition(car.x, car.y)
      .setScale((this.L / 64) * 2.1, (this.W / 64) * 2.6)
      .setRotation(car.heading)
      .setAlpha(this.glowAlpha * (boosting ? 1.5 : 1) * alpha)
      .setDepth(upper ? DEPTH.upperShadow + 0.5 : DEPTH.glow);
    const hl = this.L / 2;
    this.head
      .setPosition(car.x + cos * (hl - 2), car.y + sin * (hl - 2))
      .setRotation(car.heading)
      .setScale(1.05, 0.9)
      .setAlpha((0.2 + Math.min(0.08, car.speed / 8000)) * alpha)
      .setDepth(upper ? DEPTH.upperFx : DEPTH.carFx);
    const brake = Math.max(car.brake, car.speed < 5 ? 0.3 : 0);
    const rx = car.x - cos * (hl - 1);
    const ry = car.y - sin * (hl - 1);
    const off = this.W * 0.3;
    const tailScale = 0.18 + brake * 0.22;
    const tailAlpha = (0.45 + brake * 0.55) * alpha;
    const depthFx = upper ? DEPTH.upperFx : DEPTH.carFx;
    this.tailL.setPosition(rx + sin * off, ry - cos * off).setScale(tailScale).setAlpha(tailAlpha).setDepth(depthFx);
    this.tailR.setPosition(rx - sin * off, ry + cos * off).setScale(tailScale).setAlpha(tailAlpha).setDepth(depthFx);

    this.label.setVisible(showLabel).setPosition(car.x, car.y - 30 - elev * 6).setScale((1 / 3) * labelScale).setAlpha(ghost ? 0.6 : 1);
    if (this.arrow) {
      const bob = Math.sin(now / 180) * 2;
      this.arrow.setVisible(showLabel).setPosition(car.x, car.y - 46 - elev * 6 + bob).setScale(0.7 * labelScale);
    }
  }

  /** World position of the rear wheels (for skids/smoke). */
  rearWheels(car: RaceCar): [[number, number], [number, number]] {
    const cos = Math.cos(car.heading);
    const sin = Math.sin(car.heading);
    const ax = car.x - cos * this.L * 0.29;
    const ay = car.y - sin * this.L * 0.29;
    const off = this.W / 2 - 2.5;
    return [
      [ax + sin * off, ay - cos * off],
      [ax - sin * off, ay + cos * off],
    ];
  }

  rear(car: RaceCar): [number, number] {
    return [car.x - Math.cos(car.heading) * (this.L / 2 + 2), car.y - Math.sin(car.heading) * (this.L / 2 + 2)];
  }

  destroy(): void {
    for (const o of [this.body, this.shadow, this.glow, this.head, this.tailL, this.tailR, this.label, this.arrow]) o?.destroy();
  }
}
