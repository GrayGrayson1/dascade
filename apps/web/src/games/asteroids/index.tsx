/**
 * Asteroid Run client module (DAScade Classics): solo survival or co-op for up to four pilots,
 * server-simulated with a predicted own ship. See AsteroidsGame for the view.
 */
import { ASTEROIDS_DIFFICULTIES, ASTEROIDS_DIFFICULTY_LABELS, type AsteroidsSettings } from '@dascade/shared/games/asteroids';
import { Segmented, Toggle } from '@dascade/ui';
import { useRoomSelector } from '../../net/hooks.ts';
import type { GameClientModule, SettingsPanelProps } from '../types.ts';
import { ClassicsResults } from '../_classics/index.ts';
import '../_classics/classics.css';
import './asteroids.css';
import { ASTEROIDS_INFO, AsteroidsGame } from './AsteroidsGame.tsx';

function AsteroidsView() {
  const phase = useRoomSelector((s) => s.phase);
  if (phase === 'RESULTS') return <ClassicsResults info={ASTEROIDS_INFO} />;
  return <AsteroidsGame />;
}

function AsteroidsSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<AsteroidsSettings>) {
  return (
    <div className="as-settings">
      <div className="dc-field">
        <span className="dc-field__label">Difficulty</span>
        <Segmented
          label="Difficulty"
          value={settings.difficulty ?? 'pilot'}
          disabled={!canEdit}
          options={ASTEROIDS_DIFFICULTIES.map((v) => ({ value: v, label: ASTEROIDS_DIFFICULTY_LABELS[v] }))}
          onChange={(difficulty) => update({ difficulty })}
        />
      </div>
      <div className="dc-field">
        <span className="dc-field__label">Ships per pilot</span>
        <Segmented
          label="Ships per pilot"
          value={String(settings.lives ?? 3)}
          disabled={!canEdit}
          options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
          onChange={(v) => update({ lives: Number(v) })}
        />
      </div>
      <Toggle label="Revive downed pilots when the crew clears a wave" checked={settings.revive !== false} disabled={!canEdit} onChange={(revive) => update({ revive })} />
    </div>
  );
}

const module: GameClientModule = {
  GameView: AsteroidsView,
  SettingsPanel: AsteroidsSettingsPanel,
  immersive: true,
  ownCountdown: true,
  musicMood: 'arcade',
};
export default module;
