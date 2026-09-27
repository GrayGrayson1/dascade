/** DAS Chess lobby settings: the boardroom kit fields (clock, sides, rated, take-backs). */
import { DEFAULT_CHESS_SETTINGS, type ChessSettings } from '@dascade/shared/games/chess';
import type { SettingsPanelProps } from '../types.ts';
import { BoardSettingsFields } from '../_boardroom/index.ts';

export function ChessSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<ChessSettings>) {
  return (
    <div className="ch-settings">
      <BoardSettingsFields
        settings={{ ...DEFAULT_CHESS_SETTINGS, ...settings }}
        canEdit={canEdit}
        update={update}
        sideLabels={['White', 'Black']}
      />
      <p className="ch-settings__note">
        Draws are automatic on stalemate, insufficient material, threefold repetition and the fifty-move rule. Players can also agree a
        draw.
      </p>
    </div>
  );
}
