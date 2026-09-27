/** Small generated textures for particles, glows, rings, projectiles and markers. */
import Phaser from 'phaser';

export function canvasTex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  scene.textures.addCanvas(key, c);
}

export function makeFxTextures(scene: Phaser.Scene): void {
  canvasTex(scene, 'tk-glow', 64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
  canvasTex(scene, 'tk-puff', 48, 48, (g) => {
    const grad = g.createRadialGradient(24, 24, 2, 24, 24, 24);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 48, 48);
  });
  canvasTex(scene, 'tk-dot', 8, 8, (g) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(4, 4, 3.5, 0, Math.PI * 2);
    g.fill();
  });
  canvasTex(scene, 'tk-px', 4, 4, (g) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 4, 4);
  });
  canvasTex(scene, 'tk-spark', 20, 4, (g) => {
    const grad = g.createLinearGradient(0, 0, 20, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 20, 4);
  });
  canvasTex(scene, 'tk-ring', 128, 128, (g) => {
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(64, 64, 58, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 12;
    g.beginPath();
    g.arc(64, 64, 52, 0, Math.PI * 2);
    g.stroke();
  });
  canvasTex(scene, 'tk-flare', 32, 32, (g) => {
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(15, 1, 2, 30);
    g.fillRect(1, 15, 30, 2);
  });
  // Projectile: bright pixel core.
  canvasTex(scene, 'tk-shell', 12, 12, (g) => {
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(2, 2, 8, 8);
    g.fillStyle = '#fff';
    g.fillRect(3, 4, 6, 4);
    g.fillRect(4, 3, 4, 6);
  });
  // Active-turn chevron.
  canvasTex(scene, 'tk-chevron', 28, 18, (g) => {
    g.fillStyle = '#07050f';
    g.beginPath();
    g.moveTo(1, 1);
    g.lineTo(27, 1);
    g.lineTo(14, 17);
    g.closePath();
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(5, 3);
    g.lineTo(23, 3);
    g.lineTo(14, 13);
    g.closePath();
    g.fill();
  });
  canvasTex(scene, 'tk-confetti', 6, 10, (g) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 6, 10);
  });
  // Soft cloud blob.
  canvasTex(scene, 'tk-cloud', 256, 96, (g) => {
    const blobs = [
      [60, 60, 38],
      [110, 46, 46],
      [160, 56, 40],
      [200, 64, 28],
      [86, 68, 30],
      [140, 70, 34],
    ];
    for (const [x, y, r] of blobs) {
      const grad = g.createRadialGradient(x!, y!, 0, x!, y!, r!);
      grad.addColorStop(0, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x!, y!, r!, 0, Math.PI * 2);
      g.fill();
    }
  });
}
