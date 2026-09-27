/**
 * Neon Snake client module (DAScade Classics): solo score attack and 2–12 player arenas
 * (Survival / Frenzy), all server-simulated. See SnakeGame for the view.
 */
import { SNAKE_ARENAS, SNAKE_ARENA_LABELS, SNAKE_MODES, SNAKE_MODE_LABELS, SNAKE_SPEEDS, SNAKE_SPEED_LABELS, type SnakeSettings } from '@dascade/shared/games/snake';
import { Segmented, Toggle } from '@dascade/ui';
import { useRoomSelector } from '../../net/hooks.ts';
import type { GameClientModule, SettingsPanelProps } from '../types.ts';
import { ClassicsResults } from '../_classics/index.ts';
import '../_classics/classics.css';
import './snake.css';
import { SNAKE_INFO, SnakeGame } from './SnakeGame.tsx';

function SnakeView() {
  const phase = useRoomSelector((s) => s.phase);
  if (phase === 'RESULTS') return <ClassicsResults info={SNAKE_INFO} />;
  return <SnakeGame />;
}

const ROUND_OPTIONS = [60, 120, 180, 300, 600] as const;

function SnakeSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<SnakeSettings>) {
  const mode = settings.mode ?? 'survival';
  return (
    <div className="sn-settings">
      <div className="dc-field">
        <span className="dc-field__label">Mode</span>
        <Segmented label="Mode" value={mode} disabled={!canEdit} options={SNAKE_MODES.map((v) => ({ value: v, label: SNAKE_MODE_LABELS[v] }))} onChange={(v) => update({ mode: v })} />
        <p className="dc-field__hint">
          {mode === 'survival' ? 'One life each. Last snake alive wins; at the time limit the longest snake wins.' : 'Crash and you respawn after 2 s (length resets, score stays). Highest score when time runs out wins.'}
        </p>
      </div>
      <div className="dc-field">
        <span className="dc-field__label">{mode === 'survival' ? 'Time limit' : 'Round length'}</span>
        <Segmented
          label="Round length"
          value={String(settings.roundSeconds ?? 180)}
          disabled={!canEdit}
          options={ROUND_OPTIONS.map((s) => ({ value: String(s), label: s < 120 ? `${s}s` : `${s / 60} min` }))}
          onChange={(v) => update({ roundSeconds: Number(v) })}
        />
      </div>
      <div className="dc-field">
        <span className="dc-field__label">Speed</span>
        <Segmented label="Speed" value={settings.speed ?? 'normal'} disabled={!canEdit} options={SNAKE_SPEEDS.map((v) => ({ value: v, label: SNAKE_SPEED_LABELS[v] }))} onChange={(speed) => update({ speed })} />
      </div>
      <div className="dc-field">
        <span className="dc-field__label">Arena</span>
        <Segmented label="Arena size" value={settings.arena ?? 'auto'} disabled={!canEdit} options={SNAKE_ARENAS.map((v) => ({ value: v, label: SNAKE_ARENA_LABELS[v] }))} onChange={(arena) => update({ arena })} />
      </div>
      <div className="sn-settings__toggles">
        <Toggle label="Wrap-around edges" checked={settings.wrap === true} disabled={!canEdit} onChange={(wrap) => update({ wrap })} />
        <Toggle label="Power-ups (gems, phase, magnet)" checked={settings.powerUps !== false} disabled={!canEdit} onChange={(powerUps) => update({ powerUps })} />
      </div>
    </div>
  );
}

const module: GameClientModule = {
  GameView: SnakeView,
  SettingsPanel: SnakeSettingsPanel,
  immersive: true,
  ownCountdown: true,
  musicMood: 'arcade',
};
export default module;
