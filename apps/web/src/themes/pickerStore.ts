/** Open/closed state of the quick theme picker (a self-contained sheet rendered by ThemeHost). */
import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();

export function setThemePickerOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const l of [...listeners]) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useThemePickerOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => open,
  );
}
