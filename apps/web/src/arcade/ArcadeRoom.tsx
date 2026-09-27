/**
 * The room backdrop: the pixel-art canvas plus a modern light layer on top
 * (sign bloom, ceiling light cones, neon pooling on the floor, vignette).
 */
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useApp } from '../app/store.ts';
import { RoomRenderer, type RoomGeometry, type RoomHints } from './room.ts';
import { addFrameJob, clockNow } from './scheduler.ts';

export interface RoomSize {
  w: number;
  h: number;
  hints: RoomHints;
}

export const ArcadeRoom = memo(function ArcadeRoom({ size }: { size: RoomSize | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<RoomRenderer | null>(null);
  const [geo, setGeo] = useState<RoomGeometry | null>(null);
  const reduced = useApp((s) => s.settings.reducedMotion);
  const fx = useApp((s) => s.settings.fx);
  const live = !reduced && fx !== 'off';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size || size.w < 10 || size.h < 10) return;
    const renderer = rendererRef.current ?? (rendererRef.current = new RoomRenderer(canvas));
    setGeo(renderer.layout(size.w, size.h, window.devicePixelRatio || 1, size.hints));
  }, [size]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !geo) return;
    renderer.frame(clockNow(), fx, live);
    if (!live) return;
    return addFrameJob((t) => renderer.frame(t, fx, true), { fps: fx === 'low' ? 12 : 20 });
  }, [geo, fx, live]);

  const s = geo?.scale ?? 1;
  return (
    <div className="af-room" data-part="arcade-room" aria-hidden data-ready={geo ? 'true' : undefined}>
      <canvas ref={canvasRef} className="af-room__canvas" />
      {geo ? (
        <div className="af-room__light">
          {geo.fixtures.map((x) => (
            <span
              key={x}
              className="af-room__cone"
              style={{ left: x * s, top: geo.ceilY * s, height: Math.max(0, geo.floorY - geo.ceilY) * s * 1.25 } as CSSProperties}
            />
          ))}
          {geo.sign ? (
            <span
              className="af-room__bloom"
              style={{
                left: (geo.sign.x + geo.sign.w / 2) * s,
                top: (geo.sign.y + geo.sign.h / 2) * s,
                width: geo.sign.w * s * 1.7,
                height: geo.sign.h * s * 2.6,
              }}
            />
          ) : null}
          <span className="af-room__pool" style={{ top: geo.floorY * s - 24 }} />
          <span className="af-room__vignette" />
        </div>
      ) : null}
    </div>
  );
});
