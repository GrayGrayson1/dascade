/** DAS Chess — client PGN export (same builder the server uses for the final record). */
import { timeControlPgn, type BoardSide } from '@dascade/shared/games/boardroom';
import type { ChessPublicState, ChessSettings } from '@dascade/shared/games/chess';
import { buildGamePgn, pgnResultFor, sideColor } from '@dascade/game-core/chess';
import { parseTournament } from '../_boardroom/index.ts';

/** The server's final PGN once the game is over, otherwise a live PGN of the game so far. */
export function currentPgn(state: ChessPublicState, settings: ChessSettings, startedAt: number): string {
  if (state.result.over && state.pgn) return state.pgn;
  const t = parseTournament(state.tournamentJson);
  const winner = state.result.winner as BoardSide | 'draw' | '';
  return buildGamePgn({
    event: t ? `DASCADE — ${t.tournamentName}` : 'DASCADE',
    site: `DASCADE room ${state.code}`,
    startedAt,
    round: t ? `${t.roundLabel} · game ${t.gameNumber}` : String(state.gameNumber || 1),
    white: state.seats[0]?.name || 'White',
    black: state.seats[1]?.name || 'Black',
    result: pgnResultFor(winner === '' ? '' : winner === 'draw' ? 'draw' : sideColor(winner)),
    timeControl: timeControlPgn(state.clock.enabled ? settings.timeControl : { baseMinutes: 0, incrementSeconds: 0 }),
    reason: state.result.reason,
    moves: state.moves.map((m) => ({ san: m.san, clockMs: m.clockMs })),
    timed: state.clock.enabled,
  });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers without async clipboard permission.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-chess-pgn' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
