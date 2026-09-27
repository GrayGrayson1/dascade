/**
 * Pixel Paddle client module (DAScade Classics). Solo practice against the house paddle or a
 * 1v1 network duel, all server-simulated; see PaddleGame for the view and net.ts for the
 * prediction model.
 */
import { PADDLE_AI_LABELS, PADDLE_AI_LEVELS, PADDLE_SPEEDS, PADDLE_SPEED_LABELS, PADDLE_TARGETS, type PaddleSettings } from '@dascade/shared/games/paddle';
import { Segmented, Toggle } from '@dascade/ui';
import { useRoomSelector } from '../../net/hooks.ts';
import type { GameClientModule, SettingsPanelProps } from '../types.ts';
import { ClassicsResults } from '../_classics/index.ts';
import '../_classics/classics.css';
import './paddle.css';
import { PADDLE_INFO, PaddleGame } from './PaddleGame.tsx';

function PaddleView() {
  const phase = useRoomSelector((s) => s.phase);
  if (phase === 'RESULTS') return <ClassicsResults info={PADDLE_INFO} />;
  return <PaddleGame />;
}

function PaddleSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<PaddleSettings>) {
  return (
    <div className="pd-settings">
      <div className="dc-field">
        <span className="dc-field__label">Points to win</span>
        <Segmented
          label="Points to win"
          value={String(settings.target ?? 7)}
          disabled={!canEdit}
          options={PADDLE_TARGETS.map((t) => ({ value: String(t), label: String(t) }))}
          onChange={(v) => update({ target: Number(v) })}
        />
      </div>
      <Toggle label="Win by two clear points" checked={settings.winBy2 !== false} disabled={!canEdit} onChange={(winBy2) => update({ winBy2 })} />
      <div className="dc-field">
        <span className="dc-field__label">Ball pace</span>
        <Segmented
          label="Ball pace"
          value={settings.speed ?? 'classic'}
          disabled={!canEdit}
          options={PADDLE_SPEEDS.map((v) => ({ value: v, label: PADDLE_SPEED_LABELS[v] }))}
          onChange={(speed) => update({ speed })}
        />
      </div>
      <div className="dc-field">
        <span className="dc-field__label">House paddle</span>
        <Segmented
          label="House paddle level"
          value={settings.ai ?? 'pro'}
          disabled={!canEdit}
          options={PADDLE_AI_LEVELS.map((v) => ({ value: v, label: PADDLE_AI_LABELS[v] }))}
          onChange={(ai) => update({ ai })}
        />
        <p className="dc-field__hint">Plays an empty seat, and covers a player whose connection drops.</p>
      </div>
    </div>
  );
}

const module: GameClientModule = {
  GameView: PaddleView,
  SettingsPanel: PaddleSettingsPanel,
  immersive: true,
  ownCountdown: true,
  musicMood: 'arcade',
};
export default module;
