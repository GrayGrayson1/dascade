import { useSyncExternalStore } from 'react';

function subscribe(cb: () => void): () => void {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
}

/** false while the tab is hidden (decor pauses its CSS animations). */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !document.hidden,
    () => true,
  );
}
