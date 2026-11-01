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
  // Roller: a ball with a stripe so its spin reads.
  canvasTex(scene, 'tk-ball', 16, 16, (g) => {
    const grad = g.createRadialGradient(6, 6, 1, 8, 8, 8);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#8d86ad');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(8, 8, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(7,5,15,0.75)';
    g.fillRect(7, 1, 2, 14);
  });
  // Dirt clod: an irregular lump.
  canvasTex(scene, 'tk-clod', 12, 12, (g) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(2, 6);
    g.lineTo(4, 2);
    g.lineTo(8, 1);
    g.lineTo(11, 5);
    g.lineTo(10, 10);
    g.lineTo(5, 11);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(6, 6, 3, 3);
  });
  // Flame tongue: bright base fading to a point.
  canvasTex(scene, 'tk-flame', 16, 32, (g) => {
    const grad = g.createLinearGradient(0, 32, 0, 0);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(8, 0);
    g.quadraticCurveTo(15, 18, 12, 28);
    g.quadraticCurveTo(8, 32, 4, 28);
    g.quadraticCurveTo(1, 18, 8, 0);
    g.fill();
  });
  // Shield shard.
  canvasTex(scene, 'tk-shard', 8, 8, (g) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(0, 8);
    g.lineTo(4, 0);
    g.lineTo(8, 6);
    g.closePath();
    g.fill();
  });
  // Volley lock-in badge.
  canvasTex(scene, 'tk-check', 24, 24, (g) => {
    g.fillStyle = '#07050f';
    g.beginPath();
    g.arc(12, 12, 11.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2de38f';
    g.beginPath();
    g.arc(12, 12, 9.5, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#07050f';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(7, 12.5);
    g.lineTo(10.5, 16);
    g.lineTo(17, 8.5);
    g.stroke();
  });
  // Sky Lance target reticle.
  canvasTex(scene, 'tk-reticle', 64, 64, (g) => {
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(32, 32, 26, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 2;
    g.beginPath();
    g.arc(32, 32, 12, 0, Math.PI * 2);
    g.stroke();
    for (const [x0, y0, x1, y1] of [
      [32, 0, 32, 14],
      [32, 50, 32, 64],
      [0, 32, 14, 32],
      [50, 32, 64, 32],
    ]) {
      g.beginPath();
      g.moveTo(x0!, y0!);
      g.lineTo(x1!, y1!);
      g.stroke();
    }
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
