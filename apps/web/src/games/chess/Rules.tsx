/** DAS Chess — in-game rules & controls reference (also explains the draw policy and clocks). */
import { Modal } from '@dascade/ui';

export function RulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="How DAS Chess works" wide>
      <div className="ch-rules">
        <section>
          <h3>Moving</h3>
          <ul>
            <li>Tap a piece to see its legal moves (dots; rings mark captures), then tap a target — or drag the piece.</li>
            <li>
              Castle by moving the king two squares (or onto its own rook). En passant and promotion work as usual; you choose the promotion
              piece.
            </li>
            <li>
              <b>Premove:</b> while your opponent thinks, move a piece anyway — it is queued (purple) and played the instant it is your
              turn, if it is still legal. Esc or tapping another piece cancels it. A premoved promotion becomes a queen.
            </li>
            <li>Keyboard: every square is a button (arrows + Enter). ← / → step through the moves, F flips the board.</li>
          </ul>
        </section>
        <section>
          <h3>Clocks</h3>
          <ul>
            <li>The server keeps both clocks. Your clock runs on your turn; the increment is added after each of your moves.</li>
            <li>
              Run out of time and you lose — unless your opponent has no way to ever checkmate (for example a lone king), which is a draw.
            </li>
            <li>If you disconnect, your clock keeps running. Stay away longer than two minutes and the game is scored as abandoned.</li>
          </ul>
        </section>
        <section>
          <h3>Draws</h3>
          <ul>
            <li>
              Automatic — nobody needs to claim them: <b>stalemate</b>, <b>insufficient material</b>, <b>threefold repetition</b> (the same
              position with the same player to move three times) and the <b>fifty-move rule</b> (50 moves each without a capture or pawn
              move).
            </li>
            <li>Offer a draw once per move; your opponent can accept or decline. Making a move instead of answering declines it.</li>
          </ul>
        </section>
        <section>
          <h3>Ratings & take-backs</h3>
          <ul>
            <li>
              Rated games change your DASCADE rating — an internal Elo-style rating, not FIDE. A “?” marks a provisional rating (fewer than
              10 games).
            </li>
            <li>
              Casual, unrated games may allow take-backs if the host enabled them; your opponent must accept each request. Never in rated or
              tournament games.
            </li>
            <li>After the game: rematch (colours swap), copy or download the PGN.</li>
          </ul>
        </section>
      </div>
    </Modal>
  );
}
