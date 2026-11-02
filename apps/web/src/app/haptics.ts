/**
 * Phone vibration, behind the player's settings. Every buzz in the app goes through buzz(), so
 * "Mute everything" and the Vibration switch (Settings → Sound) silence all of them.
 */
import type { AppSettings } from './settings.ts';
import { useApp } from './store.ts';

/** Vibration is allowed: the Vibration switch is on (absent = on) and "Mute everything" is off. */
export function hapticsAllowed(settings: Pick<AppSettings, 'haptics' | 'muted'>): boolean {
  return settings.haptics !== false && !settings.muted;
}

/**
 * Vibrates where the device supports it and the settings allow it. Returns whether a vibration was
 * started. Never throws (some browsers refuse vibrate() outside a user gesture or in a frame).
 */
export function buzz(pattern: number | number[]): boolean {
  if (!hapticsAllowed(useApp.getState().settings)) return false;
  try {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' ? navigator.vibrate(pattern) : false;
  } catch {
    return false;
  }
}
