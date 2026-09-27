/**
 * Brick Blitz — client module. An original brick breaker on the DAScade Classics kit: local
 * 60 Hz engine for an instant paddle, server-verified results, solo Arcade/Blitz and a
 * synchronized multiplayer high-score race on the same seeded levels.
 */
import { BRICKS_BLITZ_SECONDS, type BricksSettings } from '@dascade/shared/games/bricks';
import { Segmented } from '@dascade/ui';
import { useRoomSelector } from '../../net/hooks.ts';
import type { GameClientModule, SettingsPanelProps } from '../types.ts';
import { ClassicsResults, HowToList } from '../_classics/index.ts';
import { BRICKS_INFO, BricksPlay } from './BricksPlay.tsx';
import '../_classics/classics.css';
import './bricks.css';

function BricksView() {
  const phase = useRoomSelector((s) => s.phase);
  if (phase === 'RESULTS') return <ClassicsResults info={BRICKS_INFO} />;
  return <BricksPlay />;
}

function BricksSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<BricksSettings>) {
  const mode = settings.mode ?? 'arcade';
  return (
    <div className="bb-settings">
      <div className="dc-field">
        <span className="dc-field__label">Race mode</span>
        <Segmented
          label="Race mode"
          value={mode}
          disabled={!canEdit}
          options={[
            { value: 'arcade', label: 'Arcade' },
            { value: 'blitz', label: 'Blitz' },
          ]}
          onChange={(v) => update({ mode: v as BricksSettings['mode'] })}
        />
        <span className="dc-field__hint">
          {mode === 'blitz'
            ? 'Everyone plays the same levels; most points when the clock runs out wins.'
            : 'Everyone plays the same levels with three lives; highest score wins.'}
        </span>
      </div>
      {mode === 'blitz' ? (
        <div className="dc-field">
          <span className="dc-field__label">Blitz length</span>
          <Segmented
            label="Blitz length"
            value={String(settings.blitzSeconds ?? 180)}
            disabled={!canEdit}
            options={BRICKS_BLITZ_SECONDS.map((s) => ({ value: String(s), label: `${s / 60} min` }))}
            onChange={(v) => update({ blitzSeconds: Number(v) as BricksSettings['blitzSeconds'] })}
          />
        </div>
      ) : null}
      <details className="bb-rules">
        <summary>How to play</summary>
        <HowToList info={BRICKS_INFO} compact />
      </details>
    </div>
  );
}

const module: GameClientModule = {
  GameView: BricksView,
  SettingsPanel: BricksSettingsPanel as unknown as GameClientModule['SettingsPanel'],
  immersive: true,
  ownCountdown: true,
  musicMood: 'arcade',
};

export default module;
