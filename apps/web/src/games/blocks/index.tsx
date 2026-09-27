/**
 * Block Drop — client module. An original falling-block puzzle on the DAScade Classics kit:
 * local 60 Hz engine for instant feel, server-verified results, solo Marathon/Blitz and a
 * synchronized multiplayer score race with live rival stacks.
 */
import { BLITZ_SECONDS, type BlocksSettings } from '@dascade/shared/games/blocks';
import { Field, IconButton, Segmented } from '@dascade/ui';
import { useRoomSelector } from '../../net/hooks.ts';
import type { GameClientModule, SettingsPanelProps } from '../types.ts';
import { ClassicsResults, HowToList } from '../_classics/index.ts';
import { BLOCKS_INFO, BlocksPlay } from './BlocksPlay.tsx';
import '../_classics/classics.css';
import './blocks.css';

function BlocksView() {
  const phase = useRoomSelector((s) => s.phase);
  if (phase === 'RESULTS') return <ClassicsResults info={BLOCKS_INFO} />;
  return <BlocksPlay />;
}

function BlocksSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<BlocksSettings>) {
  const mode = settings.mode ?? 'marathon';
  const level = settings.startLevel ?? 1;
  return (
    <div className="bd-settings">
      <div className="dc-field">
        <span className="dc-field__label">Race mode</span>
        <Segmented
          label="Race mode"
          value={mode}
          disabled={!canEdit}
          options={[
            { value: 'marathon', label: 'Marathon' },
            { value: 'blitz', label: 'Blitz' },
          ]}
          onChange={(v) => update({ mode: v as BlocksSettings['mode'] })}
        />
        <span className="dc-field__hint">
          {mode === 'blitz' ? 'Everyone gets the same pieces; most points when the clock runs out wins.' : 'Everyone gets the same pieces; play until your stack tops out. Highest score wins.'}
        </span>
      </div>
      {mode === 'blitz' ? (
        <div className="dc-field">
          <span className="dc-field__label">Blitz length</span>
          <Segmented
            label="Blitz length"
            value={String(settings.blitzSeconds ?? 180)}
            disabled={!canEdit}
            options={BLITZ_SECONDS.map((s) => ({ value: String(s), label: `${s / 60} min` }))}
            onChange={(v) => update({ blitzSeconds: Number(v) as BlocksSettings['blitzSeconds'] })}
          />
        </div>
      ) : null}
      <Field label="Starting level" hint="Higher levels fall faster and score more per line.">
        {({ id }) => (
          <div className="bd-stepper" id={id}>
            <IconButton icon="minus" label="Lower starting level" size="sm" disabled={!canEdit || level <= 1} onClick={() => update({ startLevel: level - 1 })} />
            <output aria-live="polite" aria-label="Starting level">
              {level}
            </output>
            <IconButton icon="plus" label="Higher starting level" size="sm" disabled={!canEdit || level >= 10} onClick={() => update({ startLevel: level + 1 })} />
          </div>
        )}
      </Field>
      <details className="bd-rules">
        <summary>How to play</summary>
        <HowToList info={BLOCKS_INFO} compact />
      </details>
    </div>
  );
}

const module: GameClientModule = {
  GameView: BlocksView,
  SettingsPanel: BlocksSettingsPanel as unknown as GameClientModule['SettingsPanel'],
  immersive: true,
  ownCountdown: true,
  musicMood: 'arcade',
};

export default module;
