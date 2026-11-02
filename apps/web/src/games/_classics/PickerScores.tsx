/**
 * The DAScade Classics picker's top three for the selected game's default board, lazy-loaded by
 * shell/CabinetPicker.tsx. Imports only the light high-score module (no room or session code).
 */
import { useEffect, useState } from 'react';
import type { GameId } from '@dascade/shared';
import { HighScoreBoard } from './Boards.tsx';
import { useHighScores } from './highScores.ts';
import './classics.css';

/** Browsing the menu remounts this per game: wait a moment so arrowing through doesn't fetch every board. */
const SETTLE_MS = 220;
const TITLE = 'Top scores';

export default function PickerScores({ gameId }: { gameId: GameId }) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="cl-picker-scores" data-part="picker-scores">
      {settled ? <Board gameId={gameId} /> : <HighScoreBoard data={null} loading compact title={TITLE} />}
    </div>
  );
}

function Board({ gameId }: { gameId: GameId }) {
  const { data, loading, error } = useHighScores(gameId, null);
  const top = data ? { ...data, entries: data.entries.slice(0, 3) } : null;
  return <HighScoreBoard data={top} loading={loading} error={error} compact title={TITLE} />;
}
