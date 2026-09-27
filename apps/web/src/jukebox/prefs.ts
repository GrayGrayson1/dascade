/** Settings the jukebox UI reads from the app store (settings v3: jukeboxVolume, visualizer). */
import { useShallow } from 'zustand/react/shallow';
import { useApp } from '../app/store.ts';
import { visualizerEnabled as enabledByPolicy, type VisualizerPref } from '../audio/mixPolicy.ts';

export type { VisualizerPref };

export interface JukeboxPrefs {
  volume: number;
  visualizer: VisualizerPref;
  reducedMotion: boolean;
  fx: 'high' | 'low' | 'off';
  masterMuted: boolean;
}

export function useJukeboxPrefs(): JukeboxPrefs {
  return useApp(
    useShallow((st) => ({
      volume: st.settings.jukeboxVolume,
      visualizer: st.settings.visualizer,
      reducedMotion: st.settings.reducedMotion,
      fx: st.settings.fx,
      masterMuted: st.settings.muted,
    })),
  );
}

/** 'auto' = on unless reduced motion or visual effects are off (the mixer's policy, one source of truth). */
export function visualizerEnabled(p: Pick<JukeboxPrefs, 'visualizer' | 'reducedMotion' | 'fx'>): boolean {
  return enabledByPolicy(p);
}
