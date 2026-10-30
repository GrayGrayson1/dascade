/**
 * DAS Chess variants on the client: the lobby icons, the board marks of a variant (King of the Hill's
 * centre, Racing Kings' finish rank, Atomic explosions), Crazyhouse pockets (tap a piece, then a
 * square, to drop it), Three-Check counters and the variant hints for the status line.
 */
import { CHESS_VARIANT_INFO, isChessVariant, type ChessVariant } from '@dascade/shared/games/chess';
import { HILL, type ChessColor, type ChessPocket, type DropPiece } from '@dascade/game-core/chess';
import { cx } from '@dascade/ui';
import { ChessPiece, pieceName } from './pieces.tsx';

export function variantOf(state: { variant?: string } | null | undefined): ChessVariant {
  return isChessVariant(state?.variant) ? state.variant : 'standard';
}

export function variantTitle(variant: ChessVariant): string {
  return CHESS_VARIANT_INFO[variant].title;
}

const RANK_8 = ['a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8'];

/**
 * Square marks (space-separated tokens, read by CSS as [data-mark~='…']). `must`: Antichess pieces
 * that can (and so must) capture.
 */
export function boardMarks(variant: ChessVariant, exploded: readonly string[], must: readonly string[] = []): Record<string, string> {
  const marks: Record<string, string> = {};
  const add = (sq: string, token: string) => {
    marks[sq] = marks[sq] ? `${marks[sq]} ${token}` : token;
  };
  if (variant === 'kingofthehill') for (const sq of HILL) add(sq, 'hill');
  if (variant === 'racingkings') for (const sq of RANK_8) add(sq, 'goal');
  for (const sq of exploded) add(sq, 'boom');
  for (const sq of must) add(sq, 'must');
  return marks;
}

/** What a variant asks of the player, for the status line (null for Standard). */
export function variantGoal(variant: ChessVariant): string | null {
  switch (variant) {
    case 'chess960':
      return 'Castle by moving your king onto a rook.';
    case 'kingofthehill':
      return 'Bring your king to d4, e4, d5 or e5 to win.';
    case 'threecheck':
      return 'Give check three times to win.';
    case 'racingkings':
      return 'Race your king to the 8th rank. No checks allowed.';
    case 'antichess':
      return 'Lose all your pieces to win. Captures are compulsory.';
    case 'atomic':
      return 'Captures explode. Blow up the enemy king.';
    case 'horde':
      return 'White: checkmate Black. Black: capture every pawn.';
    case 'crazyhouse':
      return 'Tap a pocket piece, then an empty square, to drop it.';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Lobby icons
// ---------------------------------------------------------------------------

/** A 4×4 board tile with the variant's sign on it. */
export function VariantIcon({ variant }: { variant: ChessVariant }) {
  const squares = [];
  for (let r = 0; r < 4; r++) {
    for (let f = 0; f < 4; f++) {
      if ((r + f) % 2 === 1)
        squares.push(<rect key={`${r}${f}`} x={4 + f * 8} y={4 + r * 8} width="8" height="8" className="ch-vicon__dark" />);
    }
  }
  let sign = null;
  let piece: { kind: 'k' | 'n' | 'p' | 'q'; color: ChessColor } | null = null;
  switch (variant) {
    case 'standard':
      piece = { kind: 'n', color: 'w' };
      break;
    case 'chess960':
      sign = (
        <g className="ch-vicon__mark">
          <path d="M9 14 h14 l-3 -3 M31 26 h-14 l3 3" />
        </g>
      );
      piece = { kind: 'k', color: 'w' };
      break;
    case 'kingofthehill':
      sign = <rect x="12" y="12" width="16" height="16" className="ch-vicon__hill" />;
      piece = { kind: 'k', color: 'w' };
      break;
    case 'threecheck':
      sign = (
        <g className="ch-vicon__mark">
          {[10, 20, 30].map((x) => (
            <path key={x} d={`M${x - 3} 33 h6 M${x} 30 v6`} />
          ))}
        </g>
      );
      piece = { kind: 'k', color: 'b' };
      break;
    case 'racingkings':
      sign = (
        <g>
          <rect x="4" y="4" width="32" height="8" className="ch-vicon__flag-bg" />
          {[0, 1, 2, 3].map((f) => (
            <rect key={f} x={4 + f * 8} y={4} width="4" height="4" className="ch-vicon__flag" />
          ))}
          {[0, 1, 2, 3].map((f) => (
            <rect key={`b${f}`} x={8 + f * 8} y={8} width="4" height="4" className="ch-vicon__flag" />
          ))}
        </g>
      );
      piece = { kind: 'k', color: 'w' };
      break;
    case 'antichess':
      sign = (
        <g className="ch-vicon__mark">
          <path d="M8 8 L32 32" />
        </g>
      );
      piece = { kind: 'q', color: 'w' };
      break;
    case 'atomic':
      sign = (
        <path
          className="ch-vicon__boom"
          d="M20 5 l3 9 l9 -4 l-4 9 l9 3 l-9 3 l4 9 l-9 -4 l-3 9 l-3 -9 l-9 4 l4 -9 l-9 -3 l9 -3 l-4 -9 l9 4 z"
        />
      );
      break;
    case 'horde':
      sign = (
        <g className="ch-vicon__pawns">
          {[0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3].map((f) => <circle key={`${r}${f}`} cx={8 + f * 8} cy={8 + r * 8} r="2.4" />))}
        </g>
      );
      break;
    case 'crazyhouse':
      sign = (
        <g className="ch-vicon__mark">
          <path d="M28 6 v9 M24 11 l4 4 l4 -4" />
        </g>
      );
      piece = { kind: 'n', color: 'b' };
      break;
  }
  return (
    <span className="ch-vicon" data-variant={variant} aria-hidden>
      <svg viewBox="0 0 40 40" focusable="false">
        <rect x="4" y="4" width="32" height="32" className="ch-vicon__light" />
        {squares}
        {sign}
      </svg>
      {piece ? <ChessPiece kind={piece.kind} color={piece.color} className="ch-vicon__piece" /> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Player-card extras
// ---------------------------------------------------------------------------

const POCKET_ORDER: readonly DropPiece[] = ['q', 'r', 'b', 'n', 'p'];

/**
 * A Crazyhouse pocket. `onPick` makes the pieces buttons (the player's own pocket on their turn);
 * the picked piece is pressed until it is dropped or put back.
 */
export function Pocket({
  pocket,
  color,
  selected,
  onPick,
}: {
  pocket: ChessPocket;
  color: ChessColor;
  selected?: DropPiece | null;
  onPick?: (piece: DropPiece | null) => void;
}) {
  const items = POCKET_ORDER.filter((p) => pocket[p] > 0);
  const total = items.reduce((n, p) => n + pocket[p], 0);
  const label = total ? `Pocket: ${items.map((p) => `${pocket[p]} ${pieceName(p, color).split(' ')[1]}`).join(', ')}` : 'Pocket: empty';
  return (
    <span className={cx('ch-pocket', onPick && 'ch-pocket--live')} role="group" aria-label={label} data-testid={`pocket-${color}`}>
      {items.length === 0 ? <span className="ch-pocket__empty">Pocket empty</span> : null}
      {items.map((p) =>
        onPick ? (
          <button
            key={p}
            type="button"
            className="ch-pocket__piece"
            aria-pressed={selected === p}
            aria-label={`Drop a ${pieceName(p, color).split(' ')[1]} (${pocket[p]} in pocket)`}
            data-piece={p}
            onClick={() => onPick(selected === p ? null : p)}
          >
            <ChessPiece kind={p} color={color} />
            {pocket[p] > 1 ? <span className="ch-pocket__n br-num">{pocket[p]}</span> : null}
          </button>
        ) : (
          <span key={p} className="ch-pocket__piece" data-piece={p}>
            <ChessPiece kind={p} color={color} />
            {pocket[p] > 1 ? <span className="ch-pocket__n br-num">{pocket[p]}</span> : null}
          </span>
        ),
      )}
    </span>
  );
}

/** Three-Check: the checks a side has given, as three pips. */
export function CheckPips({ given }: { given: number }) {
  const n = Math.min(3, Math.max(0, given));
  return (
    <span className="ch-checks" role="img" aria-label={`${n} of 3 checks given`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="ch-checks__pip" data-on={i < n || undefined} />
      ))}
      <span className="ch-checks__n br-num">{n}/3</span>
    </span>
  );
}
