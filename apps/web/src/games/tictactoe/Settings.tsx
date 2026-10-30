/**
 * DAS Tic-Tac-Toe lobby settings: the variant picker (grouped Classics / Twists / Multi-board, each
 * with a small drawing of its board), the chosen variant's rules, and the Boardroom kit fields
 * (clock, sides, take-backs; no rating). Tournament match rooms show it all read-only.
 */
import {
  DEFAULT_TICTACTOE_SETTINGS,
  TTT_FAMILIES,
  TTT_VARIANTS,
  TTT_VARIANT_INFO,
  type TicTacToeSettings,
  type TttVariant,
} from '@dascade/shared/games/tictactoe';
import { useRoomSelector } from '../../net/hooks.ts';
import { BoardSettingsFields, VariantPicker, VariantRulesCard } from '../_boardroom/index.ts';
import type { SettingsPanelProps } from '../types.ts';

/** A tiny drawing of the variant's board for the picker. */
export function VariantIcon({ variant }: { variant: TttVariant }) {
  const v = TTT_VARIANT_INFO[variant];
  const grid = (x: number, y: number, size: number, cols: number, rows: number, key: string) => {
    const lines = [];
    for (let i = 1; i < cols; i++)
      lines.push(<line key={`${key}v${i}`} x1={x + (size * i) / cols} y1={y} x2={x + (size * i) / cols} y2={y + (size * rows) / cols} />);
    for (let i = 1; i < rows; i++)
      lines.push(<line key={`${key}h${i}`} x1={x} y1={y + (size * i) / cols} x2={x + size} y2={y + (size * i) / cols} />);
    return lines;
  };
  let body;
  if (variant === 'ultimate') {
    body = [
      ...grid(2, 2, 36, 3, 3, 'm'),
      ...[0, 1, 2].flatMap((r) => [0, 1, 2].flatMap((c) => grid(3.5 + c * 12, 3.5 + r * 12, 9, 3, 3, `${r}${c}`))),
    ];
  } else if (variant === 'notakto') {
    body = [...grid(2, 3, 16, 3, 3, 'a'), ...grid(22, 3, 16, 3, 3, 'b'), ...grid(12, 22, 16, 3, 3, 'c')];
  } else if (variant === 'cube') {
    body = [0, 1, 2, 3].flatMap((z) =>
      grid(4 + z * 3, 2 + z * 9, 26, 4, 1, `z${z}`).concat(
        <rect key={`r${z}`} x={4 + z * 3} y={2 + z * 9} width={26} height={6.5} fill="none" />,
      ),
    );
  } else {
    const cols = Math.min(v.cols, 8);
    const rows = Math.min(v.rows, 8);
    const size = variant === 'gravity' ? 36 : 34;
    body = grid(3 + (34 - size) / 2, 3 + (34 - (size * rows) / cols) / 2, size, cols, rows, 'g');
  }
  return (
    <svg className="tt-vicon" viewBox="0 0 40 40" aria-hidden focusable="false" data-variant={variant}>
      <g className="tt-vicon__lines">{body}</g>
      {variant === 'classic' || variant === 'misere' || variant === 'vanishing' || variant === 'wild' ? (
        <>
          <path className="tt-vicon__x" d="M6 6 L12 12 M12 6 L6 12" />
          <circle className="tt-vicon__o" cx="20" cy="20" r="3.4" />
        </>
      ) : null}
    </svg>
  );
}

export function TicTacToeSettingsPanel({ settings: raw, canEdit: hostCanEdit, update }: SettingsPanelProps<TicTacToeSettings>) {
  const s: TicTacToeSettings = { ...DEFAULT_TICTACTOE_SETTINGS, ...raw };
  const tournament = Boolean(useRoomSelector((st) => st.tournamentJson));
  const info = TTT_VARIANT_INFO[s.variant];

  return (
    <div className="tt-settings">
      <VariantPicker
        value={s.variant}
        options={TTT_VARIANTS.map((id) => ({ ...TTT_VARIANT_INFO[id], icon: <VariantIcon variant={id} /> }))}
        families={TTT_FAMILIES}
        canEdit={hostCanEdit && !tournament}
        onChange={(variant) => update({ variant })}
        feature="classic"
      />
      <VariantRulesCard title={info.title} rules={info.rules} />
      <BoardSettingsFields settings={s} canEdit={hostCanEdit} update={update} sideLabels={info.sides} ratings={false} />
    </div>
  );
}
