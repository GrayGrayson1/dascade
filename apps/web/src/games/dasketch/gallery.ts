/**
 * Local gallery of finished drawings (thumbnails captured from this client's canvas at
 * each reveal). Shown on the results screen; never sent anywhere.
 */
import { useSyncExternalStore } from 'react';

export interface GalleryItem {
  turn: number;
  word: string;
  artistId: string;
  artistName: string;
  src: string;
}

const MAX_ITEMS = 60;
let items: GalleryItem[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of [...listeners]) l();
}

export function addToGallery(item: GalleryItem): void {
  if (!item.src) return;
  items = [...items.filter((i) => i.turn !== item.turn), item].sort((a, b) => a.turn - b.turn).slice(-MAX_ITEMS);
  notify();
}

export function resetGallery(): void {
  if (items.length === 0) return;
  items = [];
  notify();
}

export function useGallery(): GalleryItem[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
    () => items,
  );
}
