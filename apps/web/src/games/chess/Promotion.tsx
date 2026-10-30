/** DAS Chess — promotion picker shown over the board (queen first; Antichess adds the king; Esc/Cancel keeps the pawn home). */
import { useEffect, useRef } from 'react';
import { PROMOTION_PIECES, type PromotionChoice } from '@dascade/game-core/chess';
import { Button } from '@dascade/ui';
import { ChessPiece, type PieceColor } from './pieces.tsx';

const NAMES: Record<PromotionChoice, string> = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight', k: 'king' };

export function PromotionPicker({
  color,
  onChoose,
  choices = PROMOTION_PIECES,
}: {
  color: PieceColor;
  onChoose: (piece: PromotionChoice | null) => void;
  /** The pieces on offer, in order (default queen, rook, bishop, knight). */
  choices?: readonly PromotionChoice[];
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onChoose(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChoose]);
  return (
    <div className="ch-promo" role="dialog" aria-modal="true" aria-label="Choose a promotion piece">
      <div className="ch-promo__card">
        <p className="ch-promo__title">Promote to</p>
        <div className="ch-promo__row">
          {choices.map((piece, i) => (
            <button
              key={piece}
              ref={i === 0 ? first : undefined}
              type="button"
              className="ch-promo__btn"
              aria-label={`Promote to ${NAMES[piece]}`}
              onClick={() => onChoose(piece)}
            >
              <ChessPiece kind={piece} color={color} />
              <span className="ch-promo__name">{NAMES[piece]}</span>
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={() => onChoose(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
