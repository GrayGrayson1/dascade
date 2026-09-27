/** DAS Chess — promotion picker shown over the board (queen first; Esc/Cancel keeps the pawn home). */
import { useEffect, useRef } from 'react';
import type { PromotionPiece } from '@dascade/game-core/chess';
import { Button } from '@dascade/ui';
import { ChessPiece, type PieceColor } from './pieces.tsx';

const CHOICES: Array<{ piece: PromotionPiece; name: string }> = [
  { piece: 'q', name: 'queen' },
  { piece: 'r', name: 'rook' },
  { piece: 'b', name: 'bishop' },
  { piece: 'n', name: 'knight' },
];

export function PromotionPicker({ color, onChoose }: { color: PieceColor; onChoose: (piece: PromotionPiece | null) => void }) {
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
          {CHOICES.map((c, i) => (
            <button
              key={c.piece}
              ref={i === 0 ? first : undefined}
              type="button"
              className="ch-promo__btn"
              aria-label={`Promote to ${c.name}`}
              onClick={() => onChoose(c.piece)}
            >
              <ChessPiece kind={c.piece} color={color} />
              <span className="ch-promo__name">{c.name}</span>
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
