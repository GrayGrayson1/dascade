/**
 * DAS Checkers lobby settings: the variant picker (8×8 classics / big boards / twists, each with a
 * small drawing of its board), the chosen variant's rules, and the Boardroom kit fields (clock,
 * sides, take-backs; the Rated switch only for American checkers). Tournament match rooms show it
 * all read-only.
 */
import {
  CHECKERS_FAMILIES,
  CHECKERS_VARIANTS,
  CHECKERS_VARIANT_INFO,
  DEFAULT_CHECKERS_SETTINGS,
  checkersSideLabels,
  checkersVariantOf,
  isRatedCheckersVariant,
  type CheckersSettings,
  type CheckersVariant,
} from '@dascade/shared/games/checkers';
import { useRoomSelector } from '../../net/hooks.ts';
import { BoardSettingsFields, VariantPicker, VariantRulesCard } from '../_boardroom/index.ts';
import type { SettingsPanelProps } from '../types.ts';

/** Variants whose kings fly (drawn with a long diagonal on the icon). */
const FLYING = new Set<CheckersVariant>([
  'russian',
  'pool',
  'brazilian',
  'spanish',
  'czech',
  'international',
  'antidraughts',
  'breakthrough',
  'canadian',
]);

/**
 * A tiny drawing for the picker: a corner of the board with a man of each colour, the board size in
 * the corner, and a hint of the twist (a long diagonal for flying kings, a ghost piece for the
 * giveaway goal, a crown for Breakthrough).
 */
export function VariantIcon({ variant }: { variant: CheckersVariant }) {
  const { size } = CHECKERS_VARIANT_INFO[variant];
  const cell = 9;
  const at = (n: number) => 2 + (n + 0.5) * cell;
  const squares = [];
  for (let r = 0; r < 4; r++) {
    for (let c = (r + 1) % 2; c < 4; c += 2)
      squares.push(<rect key={`${r}-${c}`} x={2 + c * cell} y={2 + r * cell} width={cell} height={cell} />);
  }
  const giveaway = variant === 'giveaway' || variant === 'antidraughts';
  return (
    <svg className="ck-vicon" viewBox="0 0 40 40" aria-hidden focusable="false" data-variant={variant}>
      <rect className="ck-vicon__board" x="2" y="2" width="36" height="36" rx="2" />
      <g className="ck-vicon__dark">{squares}</g>
      {FLYING.has(variant) ? <line className="ck-vicon__fly" x1={at(0)} y1={at(3)} x2={at(3)} y2={at(0)} /> : null}
      <circle className="ck-vicon__man ck-vicon__man--dark" cx={at(1)} cy={at(0)} r={3.6} />
      <circle className={`ck-vicon__man ck-vicon__man--light${giveaway ? ' ck-vicon__man--gone' : ''}`} cx={at(0)} cy={at(3)} r={3.6} />
      {variant === 'breakthrough' ? <path className="ck-vicon__crown" d="M25 9 L26.5 4.5 L29.5 7.5 L32.5 4.5 L34 9 Z" /> : null}
      <text className="ck-vicon__size" x="36" y="36.5" textAnchor="end">
        {size}
      </text>
    </svg>
  );
}

export function CheckersSettingsPanel({ settings: raw, canEdit: hostCanEdit, update }: SettingsPanelProps<CheckersSettings>) {
  const s: CheckersSettings = { ...DEFAULT_CHECKERS_SETTINGS, ...raw };
  const variant = checkersVariantOf(s);
  const tournament = Boolean(useRoomSelector((st) => st.tournamentJson));
  const info = CHECKERS_VARIANT_INFO[variant];

  return (
    <div className="ck-settings">
      <VariantPicker
        value={variant}
        options={CHECKERS_VARIANTS.map((id) => ({ ...CHECKERS_VARIANT_INFO[id], icon: <VariantIcon variant={id} /> }))}
        families={CHECKERS_FAMILIES}
        canEdit={hostCanEdit && !tournament}
        onChange={(next) => update({ variant: next })}
        feature="american"
      />
      <VariantRulesCard title={info.title} rules={info.rules} />
      <BoardSettingsFields
        settings={s}
        canEdit={hostCanEdit}
        update={update}
        sideLabels={checkersSideLabels(variant)}
        ratings={isRatedCheckersVariant(variant)}
      />
    </div>
  );
}
