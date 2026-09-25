/**
 * Shared casino visuals: playing cards and virtual chips (SVG, original art).
 * Cards use DASCADE pixel suit glyphs; chips are virtual arcade tokens only.
 */
import type { CSSProperties } from 'react';
import { cx } from './core.tsx';

// ---------------------------------------------------------------------------
// Pixel suits (9×9)
// ---------------------------------------------------------------------------
const SUIT_ART: Record<string, string[]> = {
  s: ['....#....', '...###...', '..#####..', '.#######.', '#########', '#########', '.##.#.##.', '....#....', '...###...'],
  h: ['.##...##.', '####.####', '#########', '#########', '.#######.', '..#####..', '...###...', '....#....', '.........'],
  d: ['....#....', '...###...', '..#####..', '.#######.', '#########', '.#######.', '..#####..', '...###...', '....#....'],
  c: ['...###...', '..#####..', '..#####..', '##.###.##', '#########', '#########', '##.#.#.##', '....#....', '...###...'],
};

function suitPath(suit: string): string {
  const rows = SUIT_ART[suit] ?? SUIT_ART.s!;
  let d = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== '#') {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row[end] === '#') end++;
      d += `M${x} ${y}h${end - x}v1h-${end - x}z`;
      x = end;
    }
  });
  return d;
}

const SUIT_PATHS: Record<string, string> = { s: suitPath('s'), h: suitPath('h'), d: suitPath('d'), c: suitPath('c') };
const RANK_LABEL: Record<string, string> = { T: '10' };
const SUIT_WORD: Record<string, string> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
const RANK_WORD: Record<string, string> = {
  A: 'Ace',
  K: 'King',
  Q: 'Queen',
  J: 'Jack',
  T: '10',
};

function Suit({ suit, x, y, size, color }: { suit: string; x: number; y: number; size: number; color: string }) {
  return <path d={SUIT_PATHS[suit]} transform={`translate(${x} ${y}) scale(${size / 9})`} fill={color} shapeRendering="crispEdges" />;
}

export interface PlayingCardProps {
  /** 2-char code like "As", "Td". Omit (or pass faceDown) for a card back. */
  code?: string | null;
  faceDown?: boolean;
  width?: number;
  highlight?: boolean;
  dim?: boolean;
  /** Play the deal-in animation. */
  deal?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function PlayingCard({ code, faceDown, width = 64, highlight, dim, deal, className, style }: PlayingCardProps) {
  const showFace = Boolean(code) && !faceDown;
  const rank = code?.[0] ?? '';
  const suit = code?.[1] ?? 's';
  const red = suit === 'h' || suit === 'd';
  const ink = red ? '#e11d48' : '#1b1830';
  const label = RANK_LABEL[rank] ?? rank;
  const accessible = showFace ? `${RANK_WORD[rank] ?? rank} of ${SUIT_WORD[suit]}` : 'Face-down card';
  const isFace = rank === 'J' || rank === 'Q' || rank === 'K';
  return (
    <div
      className={cx('dc-card', className)}
      data-face={showFace ? 'up' : 'down'}
      data-highlight={highlight ? 'true' : undefined}
      data-dim={dim ? 'true' : undefined}
      data-deal={deal ? 'true' : undefined}
      style={{ '--w': `${width}px`, ...style } as CSSProperties}
      role="img"
      aria-label={accessible}
    >
      <div className="dc-card__inner">
        <div className="dc-card__face">
          {code ? (
            <svg viewBox="0 0 100 140" aria-hidden>
              <defs>
                <linearGradient id={`cf-${code}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="1" stopColor="#ece8f7" />
                </linearGradient>
              </defs>
              <rect x="0" y="0" width="100" height="140" rx="8" fill={`url(#cf-${code})`} />
              <rect x="3" y="3" width="94" height="134" rx="6" fill="none" stroke={red ? '#fecdd3' : '#dcd7ee'} strokeWidth="1.5" />
              <text
                x="10"
                y="30"
                fill={ink}
                fontFamily="'Tiny5', 'Silkscreen', monospace"
                fontWeight="700"
                fontSize={label.length > 1 ? 24 : 28}
              >
                {label}
              </text>
              <Suit suit={suit} x={10} y={36} size={15} color={ink} />
              <g transform="rotate(180 50 70)">
                <text
                  x="10"
                  y="30"
                  fill={ink}
                  fontFamily="'Tiny5', 'Silkscreen', monospace"
                  fontWeight="700"
                  fontSize={label.length > 1 ? 24 : 28}
                >
                  {label}
                </text>
                <Suit suit={suit} x={10} y={36} size={15} color={ink} />
              </g>
              {isFace ? (
                <g>
                  <rect x="30" y="38" width="40" height="64" rx="4" fill={red ? '#ffe4e9' : '#e9e6f7'} stroke={ink} strokeWidth="2" />
                  <text
                    x="50"
                    y="80"
                    textAnchor="middle"
                    fill={ink}
                    fontFamily="'Tiny5', 'Silkscreen', monospace"
                    fontWeight="700"
                    fontSize="34"
                  >
                    {rank}
                  </text>
                  <Suit suit={suit} x={42} y={84} size={16} color={ink} />
                </g>
              ) : (
                <Suit suit={suit} x={27} y={47} size={46} color={ink} />
              )}
            </svg>
          ) : null}
        </div>
        <div className="dc-card__back">
          <CardBack />
        </div>
      </div>
    </div>
  );
}

export function CardBack() {
  return (
    <svg viewBox="0 0 100 140" aria-hidden>
      <defs>
        <linearGradient id="cb-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a1d5c" />
          <stop offset="1" stopColor="#12093a" />
        </linearGradient>
        <pattern id="cb-lattice" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="12" height="12" fill="none" />
          <rect x="0" y="0" width="2" height="12" fill="rgba(255,79,216,0.35)" />
          <rect x="0" y="0" width="12" height="2" fill="rgba(34,211,238,0.3)" />
        </pattern>
      </defs>
      <rect width="100" height="140" rx="8" fill="#f4f1ff" />
      <rect x="5" y="5" width="90" height="130" rx="5" fill="url(#cb-grad)" />
      <rect x="5" y="5" width="90" height="130" rx="5" fill="url(#cb-lattice)" />
      <rect x="9" y="9" width="82" height="122" rx="3" fill="none" stroke="rgba(255,210,63,0.7)" strokeWidth="2" strokeDasharray="4 3" />
      <rect x="28" y="54" width="44" height="32" fill="#12093a" stroke="#ffd23f" strokeWidth="2" />
      <text x="50" y="76" textAnchor="middle" fill="#ffd23f" fontFamily="'Silkscreen', monospace" fontSize="14" fontWeight="700">
        DAS
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Virtual chips
// ---------------------------------------------------------------------------

const CHIP_TIERS: Array<{ min: number; body: string; edge: string; text: string }> = [
  { min: 25000, body: '#22d3ee', edge: '#083344', text: '#022028' },
  { min: 5000, body: '#ff8a3d', edge: '#fff1e6', text: '#2a1000' },
  { min: 1000, body: '#ffd23f', edge: '#3a2a00', text: '#261a00' },
  { min: 500, body: '#a78bfa', edge: '#f3efff', text: '#1a0f3d' },
  { min: 100, body: '#1f1b33', edge: '#ffd23f', text: '#ffd23f' },
  { min: 25, body: '#2de38f', edge: '#f0fff7', text: '#02170c' },
  { min: 5, body: '#ff5a5f', edge: '#fff0f0', text: '#2a0305' },
  { min: 0, body: '#f1eefc', edge: '#4c3fb0', text: '#1b1830' },
];

export function chipTier(value: number) {
  return CHIP_TIERS.find((t) => value >= t.min) ?? CHIP_TIERS[CHIP_TIERS.length - 1]!;
}

export const CHIP_DENOMINATIONS = [1, 5, 25, 100, 500, 1000, 5000, 25000] as const;

function shortValue(v: number): string {
  if (v >= 1000) return `${v / 1000}K`;
  return String(v);
}

export function CasinoChip({
  value,
  size = 44,
  label = true,
  className,
  style,
}: {
  value: number;
  size?: number;
  label?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const tier = chipTier(value);
  const notches = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg
      className={cx('dc-chip', className)}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={style}
      role="img"
      aria-label={`${value} chip`}
    >
      <circle cx="50" cy="52" r="46" fill="rgba(0,0,0,0.35)" />
      <circle cx="50" cy="50" r="46" fill={tier.body} />
      {notches.map((deg) => (
        <rect key={deg} x="44" y="4" width="12" height="16" fill={tier.edge} transform={`rotate(${deg} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="31" fill={tier.body} stroke={tier.edge} strokeWidth="3" strokeDasharray="5 4" />
      <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" />
      {label ? (
        <text
          x="50"
          y="59"
          textAnchor="middle"
          fill={tier.text}
          fontFamily="'Tiny5', 'Silkscreen', monospace"
          fontWeight="700"
          fontSize={shortValue(value).length > 3 ? 20 : 26}
        >
          {shortValue(value)}
        </text>
      ) : null}
    </svg>
  );
}

/** Break an amount into chip denominations (largest first). */
export function chipBreakdown(amount: number, maxChips = 12): number[] {
  const out: number[] = [];
  let rest = Math.max(0, Math.floor(amount));
  const denoms = [...CHIP_DENOMINATIONS].reverse();
  for (const d of denoms) {
    while (rest >= d && out.length < maxChips) {
      out.push(d);
      rest -= d;
    }
  }
  return out;
}

export function ChipStack({ amount, size = 36, maxChips = 8, className }: { amount: number; size?: number; maxChips?: number; className?: string }) {
  const chips = chipBreakdown(amount, maxChips).reverse();
  if (chips.length === 0) return null;
  return (
    <span className={cx('dc-chip-stack', className)} aria-label={`${amount} in chips`} role="img">
      {chips.map((v, i) => (
        <CasinoChip key={i} value={v} size={size} label={i === chips.length - 1} style={{ marginBottom: i === 0 ? 0 : -size * 0.82 }} />
      ))}
    </span>
  );
}
