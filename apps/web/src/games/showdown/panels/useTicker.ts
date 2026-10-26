import { useEffect, useState } from 'react';
import { serverNow } from '../../../net/hooks.ts';
import { shortcutBlockedBy } from './shortcuts.ts';

/** serverNow(), refreshed every `ms` while `on` (else frozen at the last value). */
export function useServerNow(on: boolean, ms = 250): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!on) return;
    setNow(serverNow());
    const t = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return on ? now : serverNow();
}

/** True when keyboard shortcuts must stay quiet: typing, a dialog (native or ARIA) open, or a modifier held. */
export function shortcutBlocked(e: KeyboardEvent): boolean {
  return shortcutBlockedBy(e, typeof document === 'undefined' ? null : document);
}
