/** Minimap thumbnail of a track (built geometry from the core), for picker cards. */
import { useEffect, useRef } from 'react';
import type { KartTrackId } from '@dascade/shared/games/kart';
import { buildMapBase } from '../hud/minimap.ts';
import { trackPolylines } from '../core.ts';

export function TrackThumb({ trackId, small = false }: { trackId: KartTrackId; small?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = small ? 64 : 150;
    const h = small ? 44 : 96;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    const lines = trackPolylines(trackId);
    if (!lines) return;
    const base = buildMapBase(lines.main, lines.branches, c.width, c.height, (small ? 4 : 8) * dpr);
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(base.canvas, 0, 0);
  }, [trackId, small]);
  return <canvas ref={ref} className={small ? 'kp-thumb kp-thumb--small' : 'kp-thumb'} aria-hidden />;
}
