/** DAS Checkers lobby settings: the Boardroom kit fields plus a short rules card. */
import type { CheckersSettings } from '@dascade/shared/games/checkers';
import { PixelIcon } from '@dascade/ui';
import { BoardSettingsFields } from '../_boardroom/index.ts';
import type { SettingsPanelProps } from '../types.ts';

const SIDE_LABELS = ['Dark', 'Light'] as const;

export function CheckersSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<CheckersSettings>) {
  return (
    <div className="ck-settings">
      <BoardSettingsFields settings={settings} canEdit={canEdit} update={update} sideLabels={SIDE_LABELS} />
      <section className="ck-rules-card" aria-labelledby="ck-rules-title">
        <h3 id="ck-rules-title" className="ck-rules-card__title">
          <PixelIcon name="info" /> Standard American checkers
        </h3>
        <ul className="ck-rules-card__list">
          <li>Dark moves first. Men move one square diagonally forward; kings move one square in any diagonal direction.</li>
          <li>Captures are mandatory — you choose which one. A multi-jump must be finished with the same piece.</li>
          <li>A man reaching the far row is crowned and the move ends there.</li>
          <li>Win by taking every enemy piece or leaving your opponent without a legal move.</li>
          <li>Automatic draws: the same position three times, or 40 moves each without a capture or a man move.</li>
        </ul>
      </section>
    </div>
  );
}
