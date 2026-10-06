/**
 * Halloween Night environment: a cozy haunted hall behind the whole app — plum bat-damask walls, an
 * arched window with a big sleepy moon, sagging string lights and paper bats, a purple-and-black
 * checkerboard floor, candle and cauldron glow, and (on a low-res canvas) drifting ground fog, friendly
 * ghosts, bats and falling leaves. It gets spookier after dark and peaks on Halloween night (haunt.ts).
 *
 *  - fx high: 24 fps canvas + slow CSS breathing/sway · low: 12 fps, fewer sprites, static CSS.
 *  - fx off / reduced motion / in a game: one still frame, no loop.
 * The loop runs on the arcade's shared scheduler, which parks while the tab is hidden.
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import { addFrameJob, clockNow } from '../../arcade/scheduler.ts';
import type { SkinRenderContext } from '../types.ts';
import { useHalloweenAmbience } from './ambience.ts';
import { ART_VARS, useDocVisible } from './art.ts';
import { hauntBudget, useHauntLevel } from './haunt.ts';
import { HauntScene } from './scene.ts';

export function HalloweenEnvironment({ fx, reducedMotion, place }: SkinRenderContext) {
  const visible = useDocVisible();
  const haunt = useHauntLevel();
  useHalloweenAmbience({ place, level: haunt / 2 });
  const budget = hauntBudget(haunt, { fx, reducedMotion, place });
  const animate = fx === 'high' && !reducedMotion && visible && place !== 'game';
  const ref = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HauntScene | null>(null);
  const { fps, ghosts, bats, leaves, fog } = budget;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let scene: HauntScene;
    try {
      scene = sceneRef.current ?? (sceneRef.current = new HauntScene(el));
    } catch {
      return; // no 2D canvas: the CSS hall underneath still reads as Halloween
    }
    const b = { fps, ghosts, bats, leaves, fog };
    const moving = fps > 0;
    const relayout = () => {
      scene.layout(window.innerWidth, window.innerHeight, b, place === 'floor');
      scene.frame(clockNow(), moving);
    };
    relayout();
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(relayout, 120);
    };
    window.addEventListener('resize', onResize);
    const stop = moving ? addFrameJob((t) => scene.frame(t, true), { fps }) : null;
    return () => {
      stop?.();
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
    };
  }, [fps, ghosts, bats, leaves, fog, place]);

  return (
    <div
      className="hn-env"
      data-place={place}
      data-fx={fx}
      data-haunt={haunt}
      data-animate={animate ? 'true' : undefined}
      style={ART_VARS as CSSProperties}
    >
      <div className="hn-env__wall" />
      <div className="hn-env__window" />
      <div className="hn-env__moonglow" />
      <div className="hn-env__sign">
        <span>Trick</span> <i>or</i> <span>Treat</span>
      </div>
      <div className="hn-env__lights" />
      <div className="hn-env__bats" />
      <div className="hn-env__floor">
        <div className="hn-env__floor-plane" />
      </div>
      <div className="hn-env__glow" />
      <canvas ref={ref} className="hn-env__fx" />
      <div className="hn-env__vignette" />
    </div>
  );
}
