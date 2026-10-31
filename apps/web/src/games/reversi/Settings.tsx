/**
 * DAS Reversi lobby settings: the variant picker (Classics / Boards / Twists, each with a small
 * drawing of its board), the chosen variant's rules, and the Boardroom kit fields (clock, sides,
 * take-backs; the Rated switch only for Classic). Tournament match rooms show it all read-only.
 */
import {
  DEFAULT_REVERSI_SETTINGS,
  REVERSI_FAMILIES,
  REVERSI_SIDE_LABELS,
  REVERSI_VARIANTS,
  REVERSI_VARIANT_INFO,
  isRatedReversiVariant,
  reversiVariantOf,
  type ReversiSettings,
  type ReversiVariant,
} from '@dascade/shared/games/reversi';
import { useRoomSelector } from '../../net/hooks.ts';
import { BoardSettingsFields, VariantPicker, VariantRulesCard } from '../_boardroom/index.ts';
import type { SettingsPanelProps } from '../types.ts';

/**
 * A tiny drawing for the picker: the board with its grid (6, 8 or 10 squares a side) and the four
 * centre discs, plus the twist — cut corners, wrap-around arrows, blocked squares, a minus for Anti,
 * an empty centre for Original, a die for Random Start.
 */
export function VariantIcon({ variant }: { variant: ReversiVariant }) {
  const info = REVERSI_VARIANT_INFO[variant];
  const n = info.size;
  const x0 = 4;
  const w = 32;
  const cell = w / n;
  const grid = [];
  for (let i = 1; i < n; i++) {
    const p = x0 + i * cell;
    grid.push(<line key={`v${i}`} x1={p} y1={x0} x2={p} y2={x0 + w} />, <line key={`h${i}`} x1={x0} y1={p} x2={x0 + w} y2={p} />);
  }
  const mid = n / 2;
  const at = (col: number, row: number) => ({ cx: x0 + (col + 0.5) * cell, cy: x0 + (row + 0.5) * cell });
  const r = cell * 0.4;
  const centre: Array<[number, number, 'b' | 'w']> =
    info.start === 'parallel'
      ? [
          [mid - 1, mid - 1, 'w'],
          [mid, mid - 1, 'w'],
          [mid - 1, mid, 'b'],
          [mid, mid, 'b'],
        ]
      : [
          [mid - 1, mid - 1, 'w'],
          [mid, mid - 1, 'b'],
          [mid - 1, mid, 'b'],
          [mid, mid, 'w'],
        ];
  const cut = cell * 2;
  return (
    <svg className="rv-vicon" viewBox="0 0 40 40" aria-hidden focusable="false" data-variant={variant}>
      {info.holes === 'corners' ? (
        <path
          className="rv-vicon__board"
          d={`M${x0 + cut} ${x0} H${x0 + w - cut} L${x0 + w} ${x0 + cut} V${x0 + w - cut} L${x0 + w - cut} ${x0 + w} H${x0 + cut} L${x0} ${x0 + w - cut} V${x0 + cut} Z`}
        />
      ) : (
        <rect className="rv-vicon__board" x={x0} y={x0} width={w} height={w} rx="1.5" />
      )}
      <g className="rv-vicon__grid">{grid}</g>
      {info.start === 'empty'
        ? centre.map(([c, row]) => <circle key={`${c}-${row}`} className="rv-vicon__slot" {...at(c, row)} r={r} />)
        : centre.map(([c, row, tone]) => (
            <circle key={`${c}-${row}`} className={`rv-vicon__disc rv-vicon__disc--${tone}`} {...at(c, row)} r={r} />
          ))}
      {info.start === 'random' ? (
        <>
          <circle className="rv-vicon__disc rv-vicon__disc--b" {...at(mid - 2, mid - 1)} r={r} />
          <circle className="rv-vicon__disc rv-vicon__disc--w" {...at(mid + 1, mid)} r={r} />
          <rect className="rv-vicon__die" x="25" y="25" width="12" height="12" rx="2.5" />
          {[
            [28, 28],
            [31, 31],
            [34, 34],
          ].map(([cx, cy]) => (
            <circle key={cx} className="rv-vicon__pip" cx={cx} cy={cy} r="1.1" />
          ))}
        </>
      ) : null}
      {info.holes === 'random' ? (
        <>
          {[at(1, 1), at(n - 2, n - 2)].map((p, i) => (
            <g key={i} className="rv-vicon__block">
              <rect x={p.cx - cell / 2} y={p.cy - cell / 2} width={cell} height={cell} />
              <path
                d={`M${p.cx - cell / 3} ${p.cy - cell / 3} L${p.cx + cell / 3} ${p.cy + cell / 3} M${p.cx + cell / 3} ${p.cy - cell / 3} L${p.cx - cell / 3} ${p.cy + cell / 3}`}
              />
            </g>
          ))}
        </>
      ) : null}
      {info.wrap ? <path className="rv-vicon__wrap" d="M1.5 14 L1.5 26 M38.5 14 L38.5 26 M14 1.5 L26 1.5 M14 38.5 L26 38.5" /> : null}
      {info.goal === 'fewest' ? (
        <g className="rv-vicon__minus">
          <circle cx="32" cy="8" r="5.5" />
          <path d="M29 8 H35" />
        </g>
      ) : null}
    </svg>
  );
}

export function ReversiSettingsPanel({ settings: raw, canEdit: hostCanEdit, update }: SettingsPanelProps<ReversiSettings>) {
  const s: ReversiSettings = { ...DEFAULT_REVERSI_SETTINGS, ...raw };
  const variant = reversiVariantOf(s);
  const tournament = Boolean(useRoomSelector((st) => st.tournamentJson));
  const info = REVERSI_VARIANT_INFO[variant];

  return (
    <div className="rv-settings">
      <VariantPicker
        value={variant}
        options={REVERSI_VARIANTS.map((id) => ({ ...REVERSI_VARIANT_INFO[id], icon: <VariantIcon variant={id} /> }))}
        families={REVERSI_FAMILIES}
        canEdit={hostCanEdit && !tournament}
        onChange={(next) => update({ variant: next })}
        feature="classic"
      />
      <VariantRulesCard title={info.title} rules={info.rules} />
      <BoardSettingsFields
        settings={s}
        canEdit={hostCanEdit}
        update={update}
        sideLabels={REVERSI_SIDE_LABELS}
        ratings={isRatedReversiVariant(variant)}
      />
    </div>
  );
}
