/**
 * Settings → Sound: master, SFX, game music, jukebox and the mixer policy choices.
 * Rendered by the Settings modal (shell/modals.tsx); owned by audio-core.
 */
import { Field, Segmented, Slider, Toggle } from '@dascade/ui';
import { useApp, type GameMusicWithJukebox, type VisualizerPref } from '../app/store.ts';
import { sfx } from './audio.ts';
import { jukebox, useJukebox } from './jukebox/index.ts';
import { visualizerEnabled } from './mixPolicy.ts';

const pct = (v: number) => `${Math.round(v * 100)}%`;

function GroupTitle({ children }: { children: string }) {
  return (
    <h3 className="dc-label" style={{ margin: 0, color: 'var(--accent)' }}>
      {children}
    </h3>
  );
}

export function AudioSettings() {
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const jukeboxMuted = useJukebox((s) => s.jukeboxMuted);
  const visualizerOn = visualizerEnabled(settings);
  return (
    <div className="dc-col" style={{ gap: 18 }} data-part="audio-settings">
      <Toggle label="Mute everything" checked={settings.muted} onChange={(muted) => update({ muted })} />
      <Field label="Master volume" aside={pct(settings.masterVolume)}>
        {({ id }) => <Slider id={id} min={0} max={1} step={0.05} value={settings.masterVolume} onChange={(masterVolume) => update({ masterVolume })} />}
      </Field>
      <Field label="Sound effects" aside={pct(settings.sfxVolume)}>
        {({ id }) => (
          <Slider
            id={id}
            min={0}
            max={1}
            step={0.05}
            value={settings.sfxVolume}
            onChange={(sfxVolume) => update({ sfxVolume })}
            onPointerUp={() => sfx('coin')}
          />
        )}
      </Field>

      <hr className="dc-divider" style={{ margin: 0 }} />
      <GroupTitle>Game music</GroupTitle>
      <Toggle label="Game music (procedural, subtle)" checked={settings.musicEnabled} onChange={(musicEnabled) => update({ musicEnabled })} />
      <Field label="Game music volume" aside={pct(settings.musicVolume)}>
        {({ id }) => (
          <Slider
            id={id}
            min={0}
            max={1}
            step={0.05}
            value={settings.musicVolume}
            disabled={!settings.musicEnabled}
            onChange={(musicVolume) => update({ musicVolume })}
          />
        )}
      </Field>

      <hr className="dc-divider" style={{ margin: 0 }} />
      <GroupTitle>Jukebox</GroupTitle>
      <Toggle label="Mute the jukebox" checked={jukeboxMuted} onChange={(m) => m !== jukeboxMuted && jukebox.toggleMute()} />
      <Field label="Jukebox volume" aside={pct(settings.jukeboxVolume)}>
        {({ id }) => (
          <Slider id={id} min={0} max={1} step={0.05} value={settings.jukeboxVolume} disabled={jukeboxMuted} onChange={(v) => jukebox.setVolume(v)} />
        )}
      </Field>
      <div className="dc-field">
        <span className="dc-field__label">Game music while the jukebox plays</span>
        <Segmented<GameMusicWithJukebox>
          label="Game music while the jukebox plays"
          value={settings.gameMusicWithJukebox}
          onChange={(gameMusicWithJukebox) => update({ gameMusicWithJukebox })}
          options={[
            { value: 'mute', label: 'Mute' },
            { value: 'duck', label: 'Lower' },
            { value: 'keep', label: 'Keep' },
          ]}
        />
        <span className="dc-field__hint">Sound effects always play over the jukebox.</span>
      </div>
      <div className="dc-field">
        <span className="dc-field__label">Visualizer</span>
        <Segmented<VisualizerPref>
          label="Jukebox visualizer"
          value={settings.visualizer}
          onChange={(visualizer) => update({ visualizer })}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
        />
        <span className="dc-field__hint">
          {settings.visualizer === 'auto'
            ? `Auto follows reduce motion and visual effects (currently ${visualizerOn ? 'on' : 'off'}).`
            : 'The animated spectrum in the jukebox player.'}
        </span>
      </div>
      <p className="dc-field__hint">Sound starts after your first click or key press, as browsers require.</p>
    </div>
  );
}
