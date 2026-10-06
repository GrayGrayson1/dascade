/**
 * Halloween Night floor ambience (called by the skin's Environment): now and then, a distant thunder
 * roll, an owl, a gust of wind or a friendly ghost. Floor only, and only while it can't bother anyone:
 * audio unlocked by a gesture, tab visible, not muted, SFX and master volume up, and the jukebox not
 * playing. Everything goes through one gain node on the SFX bus (so mute/volume always win) at gains
 * that never dip the jukebox, and stops cleanly when you leave the floor. Timers only, no rAF.
 */
import { useEffect, useRef } from 'react';
import { useApp } from '../../app/store.ts';
import { synth } from '../../audio/audio.ts';
import { mixer } from '../../audio/mixer.ts';
import type { SfxKit } from '../../audio/voices.ts';
import type { ThemePlace } from '../types.ts';
import { AMBIENCE, startAmbience } from './ambienceCore.ts';

export interface AmbienceOptions {
  place: ThemePlace;
  /** Haunt intensity 0–1 (more frequent events when higher). */
  level?: number;
  enabled?: boolean;
}

function canPlay(): boolean {
  if (!synth.context || typeof document === 'undefined' || document.visibilityState !== 'visible') return false;
  const s = useApp.getState().settings;
  if (s.muted || s.masterVolume <= 0 || s.sfxVolume <= 0) return false;
  return !mixer.jukeboxAudible();
}

export function useHalloweenAmbience({ place, level = 0, enabled = true }: AmbienceOptions): void {
  const levelRef = useRef(level);
  levelRef.current = level;
  const onFloor = place === 'floor';

  useEffect(() => {
    if (!onFloor || !enabled) return;
    let bus: GainNode | null = null;
    const ensureBus = (): GainNode | null => {
      const ctx = synth.context;
      const out = synth.sfxBus;
      if (!ctx || !out) return null;
      if (!bus || bus.context !== ctx) {
        bus = ctx.createGain();
        bus.connect(out);
      }
      return bus;
    };
    const kit: SfxKit = {
      tone: (o) => {
        const out = ensureBus();
        if (out) synth.tone({ ...o, bus: out });
      },
      noise: (o) => {
        const out = ensureBus();
        if (out) synth.noise({ ...o, bus: out });
      },
      note: synth.note,
    };
    const stop = startAmbience({
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id as number),
      random: () => Math.random(),
      canPlay,
      play: (name) => AMBIENCE[name](kit),
      level: () => levelRef.current,
    });
    return () => {
      stop();
      const b: GainNode | null = bus;
      bus = null;
      if (!b) return;
      try {
        const t = b.context.currentTime;
        b.gain.cancelScheduledValues(t);
        b.gain.setValueAtTime(b.gain.value, t);
        b.gain.linearRampToValueAtTime(0, t + 0.3);
      } catch {
        /* context closed */
      }
      window.setTimeout(() => {
        try {
          b.disconnect();
        } catch {
          /* already disconnected */
        }
      }, 400);
    };
  }, [onFloor, enabled]);
}
