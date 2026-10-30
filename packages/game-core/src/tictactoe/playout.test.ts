/**
 * Property tests: seeded random playouts of every variant must respect the rule invariants on
 * every ply and always end within the variant's bounds.
 */
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { TTT_MOVE_LIMIT, TTT_NUMBER_TARGET, TTT_VARIANTS, tttCellCount, type TttVariant } from '@dascade/shared/games/tictactoe';
import { legalMoves, linesOf, newGame, playMove, replay, resolveMove, visible, type TttGame } from './index.ts';

/** Reasons each variant's rules can end a game with. */
const REASONS: Record<TttVariant, readonly string[]> = {
  classic: ['line', 'full'],
  misere: ['misere', 'full'],
  bigboard: ['line', 'full'],
  gomoku: ['line', 'full'],
  ultimate: ['boards', 'full'],
  vanishing: ['line', 'repetition', 'move_limit'],
  wild: ['line', 'full'],
  numbers: ['sum', 'full'],
  gravity: ['line', 'full'],
  nesting: ['line', 'uncovered', 'repetition', 'move_limit', 'full'],
  notakto: ['last_board'],
  cube: ['line', 'full'],
  orderchaos: ['line', 'chaos'],
};

/** Most plies a game of the variant can last. */
function maxPlies(variant: TttVariant): number {
  return variant === 'vanishing' || variant === 'nesting' ? TTT_MOVE_LIMIT : tttCellCount(variant);
}

const GAMES: Partial<Record<TttVariant, number>> = { gomoku: 4, cube: 12, orderchaos: 12, ultimate: 20 };

describe('random playouts', () => {
  for (const variant of TTT_VARIANTS) {
    it(`${variant}: every game ends legally within its bounds`, () => {
      const rng = createSeededRng(`ttt:${variant}`);
      const reasons = new Set<string>();
      for (let n = 0; n < (GAMES[variant] ?? 40); n++) {
        let game: TttGame = newGame(variant);
        while (!game.result) {
          const moves = legalMoves(game.position);
          expect(moves.length).toBeGreaterThan(0);
          // Every listed move resolves to itself (the client may send it back unchanged).
          const move = moves[rng.int(moves.length)]!;
          expect(resolveMove(game.position, move)).toEqual(move);
          const played = playMove(game, move);
          expect(played.ok).toBe(true);
          if (!played.ok) break;
          const before = game.position;
          game = played.game;
          expect(game.position.turn).not.toBe(before.turn);
          expect(game.plies.length).toBeLessThanOrEqual(maxPlies(variant));
          if (variant === 'vanishing') {
            expect(game.position.cells.filter((c) => c === 'x').length).toBeLessThanOrEqual(3);
            expect(game.position.cells.filter((c) => c === 'o').length).toBeLessThanOrEqual(3);
          }
          if (variant === 'nesting') {
            // Pieces are conserved: hand + board = 6 per player, sizes strictly grow up a stack.
            for (const [owner, base] of [
              ['x', 0],
              ['o', 3],
            ] as const) {
              for (const size of [1, 2, 3]) {
                const onBoard = game.position.cells.join('').match(new RegExp(`${owner}${size}`, 'g'))?.length ?? 0;
                expect(onBoard + game.position.hands[base + size - 1]!).toBe(2);
              }
            }
            for (const stack of game.position.cells) {
              const sizes = (stack.match(/\d/g) ?? []).map(Number);
              expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
              expect(new Set(sizes).size).toBe(sizes.length);
            }
          }
        }
        const result = game.result!;
        reasons.add(result.reason);
        expect(REASONS[variant]).toContain(result.reason);
        if (variant === 'orderchaos' || variant === 'notakto') expect(result.winner).not.toBeNull();
        if (result.reason === 'full' || result.reason === 'repetition' || result.reason === 'move_limit') expect(result.winner).toBeNull();
        if (['line', 'misere', 'uncovered'].includes(result.reason) && variant !== 'ultimate') {
          // The deciding line is made of one visible mark, and covers at least one whole line.
          const shown = result.line.map((c) => visible(variant, game.position.cells[c]!));
          expect(new Set(shown).size).toBe(1);
          expect(shown[0]).not.toBe('');
          const whole = linesOf(variant).lines.some((l) => l.every((c) => result.line.includes(c)));
          expect(whole).toBe(true);
        }
        if (result.reason === 'sum') {
          const whole = linesOf(variant).lines.find((l) => l.every((c) => result.line.includes(c)))!;
          expect(whole.reduce((s, c) => s + Number(game.position.cells[c]), 0)).toBe(TTT_NUMBER_TARGET);
        }
        // Replaying the record reaches the same game (what take-backs rely on).
        expect(
          replay(
            variant,
            game.plies.map((p) => p.move),
          ),
        ).toEqual(game);
        expect(playMove(game, legalMoves(game.position)[0] ?? { cell: 0 })).toEqual({ ok: false, reason: 'over' });
      }
      expect(reasons.size).toBeGreaterThan(0);
    });
  }
});
