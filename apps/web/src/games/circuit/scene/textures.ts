/** Small generated textures for particles, glows, shadows and markers. */
import Phaser from 'phaser';
import { CHASSIS_IDS, type ChassisId } from '@dascade/shared/games/circuit';
import { carDims, CAR_PAD } from '../art/carArt.ts';

export const TEX_SCALE = 3;

function canvasTex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  scene.textures.addCanvas(key, c);
}

export function makeFxTextures(scene: Phaser.Scene): void {
  canvasTex(scene, 'ci-glow', 64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
  canvasTex(scene, 'ci-puff', 48, 48, (g) => {
    const grad = g.createRadialGradient(24, 24, 2, 24, 24, 24);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 48, 48);
  });
  canvasTex(scene, 'ci-dot', 8, 8, (g) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(4, 4, 3.5, 0, Math.PI * 2);
    g.fill();
  });
  canvasTex(scene, 'ci-spark', 18, 4, (g) => {
    const grad = g.createLinearGradient(0, 0, 18, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 18, 4);
  });
  canvasTex(scene, 'ci-flare', 32, 32, (g) => {
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(15, 2, 2, 28);
    g.fillRect(2, 15, 28, 2);
  });
  canvasTex(scene, 'ci-confetti', 6, 10, (g) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 6, 10);
  });
  canvasTex(scene, 'ci-cone', 160, 90, (g) => {
    const grad = g.createRadialGradient(0, 45, 4, 0, 45, 160);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.3)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 38);
    g.lineTo(160, 0);
    g.lineTo(160, 90);
    g.lineTo(0, 52);
    g.closePath();
    g.fill();
  });
  canvasTex(scene, 'ci-skid', 8, 8, (g) => {
    g.fillStyle = 'rgba(8,8,12,1)';
    g.fillRect(0, 0, 8, 8);
  });
  canvasTex(scene, 'ci-rain', 2, 26, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 26);
    grad.addColorStop(0, 'rgba(180,220,255,0)');
    grad.addColorStop(1, 'rgba(180,220,255,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 26);
  });
  canvasTex(scene, 'ci-beam', 512, 128, (g) => {
    const grad = g.createLinearGradient(0, 0, 512, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 60);
    g.lineTo(512, 0);
    g.lineTo(512, 128);
    g.lineTo(0, 68);
    g.closePath();
    g.fill();
  });
  canvasTex(scene, 'ci-arrow', 24, 16, (g) => {
    g.fillStyle = '#0b0914';
    g.beginPath();
    g.moveTo(2, 2);
    g.lineTo(22, 2);
    g.lineTo(12, 14);
    g.closePath();
    g.fill();
    g.fillStyle = '#f8f6ff';
    g.beginPath();
    g.moveTo(5, 4);
    g.lineTo(19, 4);
    g.lineTo(12, 12);
    g.closePath();
    g.fill();
  });
  canvasTex(scene, 'ci-traffic', 14, 8, (g) => {
    g.fillStyle = '#fff';
    g.fillRect(1, 1, 12, 6);
    g.fillStyle = '#0c1222';
    g.fillRect(4, 2, 4, 4);
  });
  for (const chassis of CHASSIS_IDS) makeShadowTexture(scene, chassis);
}

function makeShadowTexture(scene: Phaser.Scene, chassis: ChassisId): void {
  const { L, W } = carDims(chassis);
  const pad = 10;
  canvasTex(scene, `ci-shadow-${chassis}`, Math.ceil((L + pad * 2) * 2), Math.ceil((W + pad * 2) * 2), (g) => {
    g.scale(2, 2);
    g.translate(L / 2 + pad, W / 2 + pad);
    g.filter = 'blur(4px)';
    g.fillStyle = 'rgba(0,0,0,0.75)';
    const r = chassis === 'pixel' ? W * 0.45 : 6;
    g.beginPath();
    g.roundRect(-L / 2, -W / 2, L, W, r);
    g.fill();
  });
}

/** World size of a car texture (texture px / TEX_SCALE). */
export function carTextureWorldSize(chassis: ChassisId): { w: number; h: number } {
  const { L, W } = carDims(chassis);
  return { w: L + CAR_PAD * 2, h: W + CAR_PAD * 2 };
}
