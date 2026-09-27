/**
 * Racer portrait: a PNG rendered from the real 3D racer by the render lane
 * (`renderRacerPortrait`, loaded on demand so the lobby paints before three.js arrives).
 * Until it's ready (or if WebGL is unavailable) a flat badge in the racer's colours stands in.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { KART_RACERS, type KartBodyId, type KartRacerId } from '@dascade/shared/games/kart';
import { cx } from '@dascade/ui';

type PortraitView = 'kart' | 'face';
type PortraitFn = (racer: KartRacerId, body: KartBodyId, paint: string, size?: number, view?: PortraitView) => Promise<string>;
let loader: Promise<PortraitFn | null> | null = null;

function portraitFn(): Promise<PortraitFn | null> {
  loader ??= import('../art/portrait.ts').then((m) => m.renderRacerPortrait as PortraitFn).catch(() => null);
  return loader;
}

const cache = new Map<string, string>();

export function usePortrait(racer: KartRacerId, body: KartBodyId, paint: string, size: number, view: PortraitView = 'kart'): string | null {
  const key = `${racer}|${body}|${paint}|${size}|${view}`;
  const [url, setUrl] = useState<string | null>(() => cache.get(key) ?? null);
  useEffect(() => {
    const hit = cache.get(key);
    if (hit) {
      setUrl(hit);
      return;
    }
    setUrl(null);
    let alive = true;
    void portraitFn().then(async (fn) => {
      if (!fn || !alive) return;
      try {
        const u = await fn(racer, body, paint, size, view);
        cache.set(key, u);
        if (alive) setUrl(u);
      } catch {
        /* keep the badge */
      }
    });
    return () => {
      alive = false;
    };
  }, [key, racer, body, paint, size, view]);
  return url;
}

export function Portrait({
  racer,
  body = 'buggy',
  paint,
  size = 128,
  className,
  label,
  view = 'kart',
}: {
  racer: KartRacerId;
  body?: KartBodyId;
  paint?: string;
  size?: number;
  className?: string;
  /** Accessible name; omit for decorative use. */
  label?: string;
  /** 'kart' = racer in the kart (3/4 view), 'face' = head-and-shoulders close-up. */
  view?: PortraitView;
}) {
  const info = KART_RACERS[racer] ?? KART_RACERS.nova;
  const colour = paint ?? info.colors.main;
  // Render at 2x for crisp HiDPI; sizes are bucketed to keep the cache small.
  const px = size <= 48 ? 96 : size <= 96 ? 192 : 256;
  const url = usePortrait(info.id, body, colour, px, view);
  const style = {
    '--kp-main': info.colors.main,
    '--kp-trim': info.colors.trim,
    '--kp-paint': colour,
    width: size,
    height: size,
  } as CSSProperties;
  return (
    <span
      className={cx('kp-portrait', className)}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {url ? <img src={url} alt="" draggable={false} /> : <span className="kp-portrait__badge">{info.name.slice(0, 1)}</span>}
    </span>
  );
}
