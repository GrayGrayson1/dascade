/**
 * Memory Matrix — client module. A fast visual memory challenge on the DAScade Classics kit:
 * server-generated patterns played on the synced clock, server-judged taps, solo high scores
 * and synchronized multiplayer rounds (tournament-ready head-to-head).
 */
import type { MemorySettings } from '@dascade/shared/games/memory';
import { Segmented } from '@dascade/ui';
import { useRoomSelector } from '../../net/hooks.ts';
import type { GameClientModule, SettingsPanelProps } from '../types.ts';
import { ClassicsResults, HowToList } from '../_classics/index.ts';
import { MEMORY_INFO, MemoryPlay } from './MemoryPlay.tsx';
import '../_classics/classics.css';
import './memory.css';

function MemoryView() {
  const phase = useRoomSelector((s) => s.phase);
  if (phase === 'RESULTS') return <ClassicsResults info={MEMORY_INFO} />;
  return <MemoryPlay />;
}

function MemorySettingsPanel({ settings, canEdit, update }: SettingsPanelProps<MemorySettings>) {
  return (
    <div className="mm-settings">
      <div className="dc-field">
        <span className="dc-field__label">Pattern</span>
        <Segmented
          label="Pattern"
          value={settings.variant ?? 'mixed'}
          disabled={!canEdit}
          options={[
            { value: 'mixed', label: 'Mixed' },
            { value: 'sequence', label: 'Sequence' },
            { value: 'flash', label: 'Flash' },
          ]}
          onChange={(v) => update({ variant: v as MemorySettings['variant'] })}
        />
        <span className="dc-field__hint">Sequence: repeat tiles in order. Flash: tap every lit tile. Mixed alternates.</span>
      </div>
      <div className="dc-field">
        <span className="dc-field__label">Rule</span>
        <Segmented
          label="Rule"
          value={settings.rule ?? 'lives'}
          disabled={!canEdit}
          options={[
            { value: 'lives', label: '3 lives' },
            { value: 'sudden', label: 'Sudden death' },
          ]}
          onChange={(v) => update({ rule: v as MemorySettings['rule'] })}
        />
        <span className="dc-field__hint">Everyone gets the same pattern each round. Highest score wins; equal scores tie.</span>
      </div>
      <details className="mm-rules">
        <summary>How to play</summary>
        <HowToList info={MEMORY_INFO} compact />
      </details>
    </div>
  );
}

const module: GameClientModule = {
  GameView: MemoryView,
  SettingsPanel: MemorySettingsPanel as unknown as GameClientModule['SettingsPanel'],
  immersive: true,
  ownCountdown: true,
  musicMood: 'chill',
};

export default module;
