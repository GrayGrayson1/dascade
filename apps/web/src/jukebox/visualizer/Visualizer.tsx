/**
 * The ONE jukebox visualizer canvas. Draws the active theme's `effects.visualizer` style from the
 * shared analyser (`jukebox.analyser()`), at ≤ 30 fps, devicePixelRatio-aware (capped at 2).
 *
 * The loop runs only while: the player is open (`active`), the tab is visible, the canvas is on
 * screen, the visualizer setting allows it, and music is playing. Otherwise it paints one static
 * idle frame and stops. No React state per frame: level updates for skins go out as a CSS variable
 * (`--jb-level` on `levelTarget`) every frame and as a quantised callback at most ~8×/s.
 */
import { useEffect, useRef } from 'react';
import { readThemeTokens, subscribeThemeTokens } from '@dascade/ui';
import { jukebox, useJukebox } from '../../audio/jukebox/index.ts';
import { useJukeboxPrefs, visualizerEnabled } from '../prefs.ts';
import { drawVisualizer, idleBands, type VisFrame, type VisPalette, type VisualizerStyle } from './draw.ts';

const FRAME_MS = 1000 / 30;
const BANDS = 48;
const WAVE = 128;
const LEVEL_CB_MS = 125;

export interface VisualizerProps {
  /** Player open (the loop never runs while collapsed). */
  active: boolean;
  /** Element that receives `--jb-level` (0–1) each frame. */
  levelTarget?: React.RefObject<HTMLElement | null>;
  /** Quantised (0.05) level, at most ~8×/s, only when it changes. */
  onLevel?: (level: number) => void;
  label?: string;
}

function paletteFrom(el: Element): { style: VisualizerStyle; palette: VisPalette; still: boolean } {
  const t = readThemeTokens(el);
  return {
    style: t.effects.visualizer,
    still: t.reducedMotion,
    palette: {
      accent: t.accent,
      accent2: t.accent2,
      text: t.text,
      muted: t.textMuted,
      line: t.line,
      surface: t.surface,
      background: t.background,
      success: t.success,
      warning: t.warning,
      danger: t.danger,
      info: t.info,
      gridAlpha: t.gridAlpha,
      glow: t.glow,
    },
  };
}

export function Visualizer({ active, levelTarget, onLevel, label = 'Music visualizer' }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playing = useJukebox((s) => s.playing);
  const prefs = useJukeboxPrefs();
  const enabled = visualizerEnabled(prefs);
  const onLevelRef = useRef(onLevel);
  onLevelRef.current = onLevel;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let theme = paletteFrom(canvas);
    let raf = 0;
    let last = 0;
    let onScreen = true;
    let disposed = false;
    const started = performance.now();
    let frozenT = 0;

    const bands = new Float32Array(BANDS);
    const peaks = new Float32Array(BANDS);
    const wave = new Float32Array(WAVE);
    let freqBytes: Uint8Array<ArrayBuffer> | null = null;
    let timeBytes: Uint8Array<ArrayBuffer> | null = null;
    let edges: Int32Array | null = null;
    let lastLevelCb = 0;
    let lastLevelSent = -1;
    const frame: VisFrame = { bands, peaks, wave, level: 0, levelL: 0, levelR: 0, t: 0, playing: false, still: theme.still, dpr: 1 };

    const resize = () => {
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      frame.dpr = dpr;
    };

    const pushLevel = (level: number, now: number) => {
      levelTarget?.current?.style.setProperty('--jb-level', level.toFixed(3));
      if (onLevelRef.current && now - lastLevelCb >= LEVEL_CB_MS) {
        const q = Math.round(level * 20) / 20;
        if (q !== lastLevelSent) {
          lastLevelSent = q;
          lastLevelCb = now;
          onLevelRef.current(q);
        }
      }
    };

    const analyse = (an: AnalyserNode) => {
      const bins = an.frequencyBinCount;
      if (!freqBytes || freqBytes.length !== bins) {
        freqBytes = new Uint8Array(new ArrayBuffer(bins));
        // Log-spaced band edges from ~40 Hz to ~16 kHz.
        const nyquist = an.context.sampleRate / 2;
        edges = new Int32Array(BANDS + 1);
        const lo = Math.log(40);
        const hi = Math.log(Math.min(16000, nyquist));
        for (let i = 0; i <= BANDS; i++) {
          const f = Math.exp(lo + ((hi - lo) * i) / BANDS);
          edges[i] = Math.min(bins - 1, Math.max(0, Math.round((f / nyquist) * bins)));
        }
      }
      if (!timeBytes || timeBytes.length !== an.fftSize) timeBytes = new Uint8Array(new ArrayBuffer(an.fftSize));
      an.getByteFrequencyData(freqBytes);
      an.getByteTimeDomainData(timeBytes);
      let sum = 0;
      let low = 0;
      let high = 0;
      for (let i = 0; i < BANDS; i++) {
        const a = edges![i]!;
        const b = Math.max(a + 1, edges![i + 1]!);
        let m = 0;
        for (let k = a; k < b && k < freqBytes.length; k++) m = Math.max(m, freqBytes[k]!);
        // Gentle high-frequency lift so the right side isn't always flat.
        const v = Math.min(1, (m / 255) * (0.85 + (i / BANDS) * 0.45));
        const prev = bands[i]!;
        bands[i] = v > prev ? v : prev * 0.82 + v * 0.18;
        peaks[i] = Math.max(bands[i]!, peaks[i]! - 0.012);
        sum += bands[i]!;
        if (i < BANDS / 2) low += bands[i]!;
        else high += bands[i]!;
      }
      const step = timeBytes.length / WAVE;
      for (let i = 0; i < WAVE; i++) wave[i] = ((timeBytes[Math.floor(i * step)] ?? 128) - 128) / 128;
      const lvl = Math.min(1, (sum / BANDS) * 1.8);
      frame.level = frame.level * 0.6 + lvl * 0.4;
      frame.levelL = frame.levelL * 0.7 + Math.min(1, (low / (BANDS / 2)) * 1.6) * 0.3;
      frame.levelR = frame.levelR * 0.7 + Math.min(1, (high / (BANDS / 2)) * 2.4) * 0.3;
    };

    const paintIdle = () => {
      resize();
      idleBands(bands);
      peaks.set(bands);
      wave.fill(0);
      frame.level = 0;
      frame.levelL = 0.04;
      frame.levelR = 0.04;
      frame.playing = false;
      frame.t = frozenT;
      frame.still = true;
      drawVisualizer(theme.style, ctx, canvas.width, canvas.height, frame, theme.palette);
      pushLevel(0, performance.now());
    };

    const shouldRun = () => active && enabled && playing && onScreen && !document.hidden && !disposed;

    const tick = (now: number) => {
      raf = 0;
      if (!shouldRun()) {
        paintIdle();
        return;
      }
      raf = requestAnimationFrame(tick);
      if (now - last < FRAME_MS - 1) return;
      last = now;
      const an = jukebox.analyser();
      resize();
      if (an) analyse(an);
      else {
        // No analyser (not unlocked yet): decay towards the idle contour.
        for (let i = 0; i < BANDS; i++) bands[i] = bands[i]! * 0.9;
        frame.level *= 0.9;
      }
      frame.playing = true;
      frame.still = theme.still;
      frame.t = (now - started) / 1000;
      frozenT = frame.t;
      drawVisualizer(theme.style, ctx, canvas.width, canvas.height, frame, theme.palette);
      pushLevel(frame.level, now);
    };

    const kick = () => {
      if (raf) return;
      if (shouldRun()) raf = requestAnimationFrame(tick);
      else paintIdle();
    };

    const offTheme = subscribeThemeTokens(() => {
      theme = paletteFrom(canvas);
      if (!raf) paintIdle();
    });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => (raf ? undefined : paintIdle())) : null;
    ro?.observe(canvas);
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((entries) => {
            onScreen = entries.some((e) => e.isIntersecting);
            kick();
          })
        : null;
    io?.observe(canvas);
    const onVis = () => kick();
    document.addEventListener('visibilitychange', onVis);
    kick();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      offTheme();
      ro?.disconnect();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [active, enabled, playing, levelTarget]);

  return (
    <canvas
      ref={canvasRef}
      className="jb-vis"
      data-part="visualizer"
      data-enabled={enabled ? 'true' : 'false'}
      role="img"
      aria-label={label}
    />
  );
}
