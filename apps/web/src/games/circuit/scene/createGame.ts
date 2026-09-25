/** Creates (and sizes) the Phaser game for the race view. */
import Phaser from 'phaser';
import { RaceScene, type SceneOptions } from './RaceScene.ts';

export interface RaceGame {
  game: Phaser.Game;
  scene: RaceScene;
  resize(cssW: number, cssH: number): void;
  destroy(): void;
}

export function pixelRatio(fx: SceneOptions['fx'], mobile: boolean): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const cap = fx === 'high' ? (mobile ? 1.75 : 2) : fx === 'low' ? 1.5 : 1;
  return Math.max(1, Math.min(cap, dpr));
}

export function createRaceGame(parent: HTMLElement, opts: SceneOptions): RaceGame {
  let dpr = pixelRatio(opts.fx, opts.mobile);
  let host: RaceGame | null = null;
  opts = {
    ...opts,
    onDegrade: () => {
      // Last resort on weak GPUs: render at CSS pixel resolution.
      if (dpr <= 1 || !host) return;
      dpr = 1;
      host.resize(parent.clientWidth, parent.clientHeight);
    },
  };
  const cssW = Math.max(1, parent.clientWidth);
  const cssH = Math.max(1, parent.clientHeight);
  const scene = new RaceScene(opts);
  scene.setView(cssW, cssH, dpr);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: Math.round(cssW * dpr),
    height: Math.round(cssH * dpr),
    backgroundColor: '#070814',
    scale: { mode: Phaser.Scale.NONE },
    render: { antialias: true, roundPixels: false, powerPreference: 'high-performance' },
    banner: false,
    audio: { noAudio: true },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    disableContextMenu: true,
    scene,
  });
  const styleCanvas = () => {
    const canvas = game.canvas;
    if (!canvas) return;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.setAttribute('aria-label', 'Race view');
    canvas.setAttribute('role', 'img');
  };
  game.events.once(Phaser.Core.Events.READY, styleCanvas);
  styleCanvas();
  host = {
    game,
    scene,
    resize(w: number, h: number) {
      const W = Math.max(1, Math.round(w * dpr));
      const H = Math.max(1, Math.round(h * dpr));
      scene.setView(w, h, dpr);
      if (game.scale.width !== W || game.scale.height !== H) game.scale.resize(W, H);
      styleCanvas();
    },
    destroy() {
      game.destroy(true);
    },
  };
  return host;
}
