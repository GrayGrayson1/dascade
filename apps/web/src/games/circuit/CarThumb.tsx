/** Static car thumbnail (canvas) for results, tower and pickers. */
import { useEffect, useRef } from 'react';
import type { CarLookView } from '@dascade/shared/games/circuit';
import { carDims, drawCar } from './art/carArt.ts';

export function CarThumb({ look, size = 56, rotate = -Math.PI / 2, label }: { look: CarLookView; size?: number; rotate?: number; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const lookRef = useRef(look);
  lookRef.current = look;
  const key = `${look.chassis}|${look.primary}|${look.secondary}|${look.decal}|${look.wheels}|${look.number}`;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const g = c.getContext('2d');
    if (!g) return;
    const current = lookRef.current;
    const { L } = carDims(current.chassis);
    const scale = (size * dpr * 0.82) / (L + 8);
    g.clearRect(0, 0, c.width, c.height);
    g.save();
    g.translate(c.width / 2, c.height / 2);
    g.rotate(rotate);
    g.scale(scale, scale);
    drawCar(g, current, { shadow: true });
    g.restore();
  }, [key, size, rotate]);
  return <canvas ref={ref} className="ci-thumb" style={{ width: size, height: size }} role="img" aria-label={label ?? `Car number ${look.number}`} />;
}
