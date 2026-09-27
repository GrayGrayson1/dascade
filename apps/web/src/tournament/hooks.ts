import { useEffect, useState } from 'react';

/** Reactive `matchMedia` (false during SSR / when unsupported). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** Wide enough for the spatial bracket (tablets in landscape and up). */
export const WIDE_QUERY = '(min-width: 900px)';
