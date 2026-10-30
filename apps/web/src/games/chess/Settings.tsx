/**
 * DAS Chess lobby settings: the variant picker (Classic / New goals / Wild rules), the chosen
 * variant's rules, and the boardroom kit fields (clock, sides, take-backs, and the Rated toggle —
 * Standard only: the variants never change ratings). Tournament match rooms show it all read-only.
 */
import {
  CHESS_FAMILIES,
  CHESS_VARIANTS,
  CHESS_VARIANT_INFO,
  DEFAULT_CHESS_SETTINGS,
  isChessVariant,
  type ChessSettings,
} from '@dascade/shared/games/chess';
import { useRoomSelector } from '../../net/hooks.ts';
import type { SettingsPanelProps } from '../types.ts';
import { BoardSettingsFields, VariantPicker, VariantRulesCard } from '../_boardroom/index.ts';
import { VariantIcon } from './variants.tsx';

const OPTIONS = CHESS_VARIANTS.map((id) => ({ ...CHESS_VARIANT_INFO[id], icon: <VariantIcon variant={id} /> }));

export function ChessSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<ChessSettings>) {
  const s: ChessSettings = { ...DEFAULT_CHESS_SETTINGS, ...settings };
  const variant = isChessVariant(s.variant) ? s.variant : 'standard';
  const tournament = Boolean(useRoomSelector((st) => st.tournamentJson));
  const info = CHESS_VARIANT_INFO[variant];
  return (
    <div className="ch-settings">
      <VariantPicker
        value={variant}
        options={OPTIONS}
        families={CHESS_FAMILIES}
        canEdit={canEdit && !tournament}
        onChange={(v) => update({ variant: v })}
        feature="standard"
      />
      <VariantRulesCard title={info.title} rules={info.rules} />
      <BoardSettingsFields
        settings={s}
        canEdit={canEdit}
        update={update}
        sideLabels={['White', 'Black']}
        ratings={variant === 'standard'}
      />
      <p className="ch-settings__note">
        {variant === 'standard'
          ? 'Draws are automatic on stalemate, insufficient material, threefold repetition and the fifty-move rule.'
          : `${info.title} games are casual: they never change your DASCADE rating. Repetition and the fifty-move rule still draw automatically.`}{' '}
        Players can also agree a draw.
      </p>
    </div>
  );
}
