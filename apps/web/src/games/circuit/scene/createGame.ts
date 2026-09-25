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
  // Phaser's VisibilityHandler (run from Game#start, right after the postBoot callback) adds a
  // document 'visibilitychange' listener and sets window.onblur/onfocus, and never removes them:
  // every destroyed race would leave a dead listener behind. Capture them so destroy() can.
  const leftovers: { visibility: EventListenerOrEventListenerObject | null; onblur: Window['onblur']; onfocus: Window['onfocus'] } = {
    visibility: null,
    onblur: null,
    onfocus: null,
  };
  const captureVisibility = () => {
    const hadOwn = Object.prototype.hasOwnProperty.call(document, 'addEventListener');
    const original = document.addEventListener;
    const restore = () => {
      if (hadOwn) document.addEventListener = original;
      else delete (document as { addEventListener?: unknown }).addEventListener;
    };
    document.addEventListener = function (this: Document, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      if (type === 'visibilitychange' && listener && !leftovers.visibility) leftovers.visibility = listener;
      return listener ? original.call(this, type, listener, options) : undefined;
    } as Document['addEventListener'];
    // VisibilityHandler runs synchronously after postBoot; restore right after it.
    queueMicrotask(() => {
      restore();
      leftovers.onblur = window.onblur;
      leftovers.onfocus = window.onfocus;
    });
  };
  const releaseLeftovers = () => {
    if (leftovers.visibility) document.removeEventListener('visibilitychange', leftovers.visibility);
    leftovers.visibility = null;
    if (leftovers.onblur && window.onblur === leftovers.onblur) window.onblur = null;
    if (leftovers.onfocus && window.onfocus === leftovers.onfocus) window.onfocus = null;
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
    callbacks: { postBoot: captureVisibility },
    scene,
  });
  // Grab the GL context now: after destroy() Phaser drops its references.
  let gl: WebGLRenderingContext | null = null;
  game.events.once(Phaser.Core.Events.READY, () => {
    const r = game.renderer as unknown as { gl?: WebGLRenderingContext } | null;
    gl = r?.gl ?? null;
  });
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    releaseLeftovers();
    // Phaser never loses its context: release the GPU memory now instead of whenever GC runs
    // (browsers cap live WebGL contexts, and racers cycle lobby ⇄ race many times per session).
    const ctx = gl;
    gl = null;
    if (ctx) setTimeout(() => ctx.getExtension('WEBGL_lose_context')?.loseContext(), 0);
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
