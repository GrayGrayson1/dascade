# DAS Tic-Tac-Toe (`tictactoe`)

Noughts and crosses for two players, on the Boardroom kit next to chess and checkers. It has the classic 3×3
game plus twelve variants. The host picks the **variant** in the lobby. A game keeps its variant until it ends,
and rematches replay it with sides swapped. Spectators, optional clocks, take-backs, draw offers, rematches and
Tournament Center matches all come from the kit.

It lives in the DAS Boardroom cabinet (`/cabinet/boardroom`, or straight to `/play/tictactoe`).

| Piece                                                       | Path                                                                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Contract (variants, settings, messages, public state)       | `packages/shared/src/games/tictactoe.ts`                                                                         |
| Engine: lines, legal moves, every variant's rules, notation | `packages/game-core/src/tictactoe/`                                                                              |
| Room                                                        | `apps/game-server/src/rooms/tictactoe/`                                                                          |
| Client (board, marks, lobby variant picker)                 | `apps/web/src/games/tictactoe/`                                                                                  |
| Tests                                                       | `packages/game-core/src/tictactoe/*.test.ts`, `apps/game-server/test/tictactoe.test.ts`, `e2e/tictactoe.spec.ts` |

## Variants

Side `first` always moves first. It plays X in most variants, **Order** in Order & Chaos and **Odds** in Numbers.
In Wild and Notakto the sides are just **First** and **Second**.

### Classics

| Variant                    | Board | Rules                                                                                 |
| -------------------------- | ----- | ------------------------------------------------------------------------------------- |
| **Classic** (default)      | 3×3   | Three of your marks in a row (across, down or diagonal) wins. A full board is a draw. |
| **Misère** (`misere`)      | 3×3   | Complete three of your own marks in a row and you **lose**. A full board is a draw.   |
| **Big Board** (`bigboard`) | 5×5   | Four in a row wins. A full board is a draw.                                           |
| **Gomoku** (`gomoku`)      | 15×15 | Five **or more** in an unbroken row wins. A full board is a draw.                     |

### Twists

| Variant                          | Board | Rules                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vanishing** (`vanishing`)      | 3×3   | Each player keeps at most three marks: placing a fourth erases your oldest one (it glows before it goes). Three in a row wins. The same position three times is a draw.                                                                                                                                                                     |
| **Wild** (`wild`)                | 3×3   | Mark any empty square with your choice of X or O. Complete three of the same mark in a row (either mark) and you win. A full board is a draw.                                                                                                                                                                                               |
| **Numbers** (`numbers`)          | 3×3   | Odds play 1, 3, 5, 7, 9 and move first; Evens play 2, 4, 6, 8. Each number can be used once. Complete any full line that adds up to exactly 15, with anyone's numbers, to win. A full board with no 15 is a draw.                                                                                                                           |
| **Gravity** (`gravity`)          | 7 × 6 | Pick a column: your mark falls to the lowest empty square. Four in a row wins. A full board is a draw.                                                                                                                                                                                                                                      |
| **Nesting** (`nesting`)          | 3×3   | Each player has six pieces: two small, two medium and two large. Place a piece from your hand or move one of yours already on the board. A piece may cover any smaller piece, yours or your opponent's. Three of your **visible** pieces in a row wins. Uncover your opponent's line and they win. The same position three times is a draw. |
| **Order & Chaos** (`orderchaos`) | 6×6   | Both players may place an X or an O on any empty square; Order moves first. Order wins as soon as five of the same mark line up, whoever placed them. Chaos wins if the board fills up without such a line. There are no draws.                                                                                                             |

### Multi-board

| Variant                   | Board           | Rules                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ultimate** (`ultimate`) | 9 boards of 3×3 | X moves first, anywhere. The square you pick sends your opponent to the matching small board. Sent to a board that is already won or full? Play on any open board. Win a small board with three in a row; win three small boards in a row to win the game. A small board that fills up without a line belongs to nobody. |
| **Notakto** (`notakto`)   | 3 boards of 3×3 | Both players place X marks on any of the three boards. A board with three X in a row is dead and nobody plays there again. Whoever kills the last live board loses.                                                                                                                                                      |
| **3D Cube** (`cube`)      | 4 layers of 4×4 | Four in a row wins: within a layer, straight down through the layers, or diagonally across them (76 lines). A full cube with none is a draw.                                                                                                                                                                             |

The player-facing wording lives in `TTT_VARIANT_INFO` (title, tagline, family, side labels, board size, rules).
The lobby card and the in-game help both read it, so change rules text there and nowhere else.

## Endings

- **Lines.** The engine checks only the lines through the cell that just changed. Nesting checks every line,
  because lifting a piece can uncover one. The deciding cells are published as `winLine`. Ultimate lists the
  three small boards of its winning line instead.
- **Draws.** A full board, or no legal move left, is a draw (`full`). It is a win for Chaos in Order & Chaos;
  Notakto can't fill a board without killing it. Vanishing and Nesting never fill up, so they draw on threefold
  repetition (`repetition`) or after `TTT_MOVE_LIMIT` (150) plies (`move_limit`).
- The kit adds resignation, draws by agreement, time-outs (with a clock), the untimed idle rule, abandonment and
  forfeits (see the Boardroom kit in [GAME_GUIDE.md](GAME_GUIDE.md#6-kits)).
- The rules' reason codes are `TTT_REASONS`: `line`, `misere`, `sum`, `uncovered`, `boards`, `last_board`,
  `chaos`, `full`, `repetition`, `move_limit`.

## Cells, moves and notation

- **Cells** are numbered row by row from the top-left (0 = top-left). Multi-board variants number board by
  board: Ultimate and Notakto `cell = board × 9 + local cell`, the cube `cell = layer × 16 + row × 4 + column`
  (layer 0 on top). The largest board is Gomoku's 225 cells (`TTT_MAX_CELLS`).
- **One message**, `tictactoe:move` (`TttMoveSchema`, strict):
  `{ cell, ply, mark?, num?, size?, from? }`. Every variant sends `cell`. Wild and Order & Chaos add
  `mark` (`'x'` / `'o'`), Numbers adds `num`, and Nesting adds `size` (a piece from the hand) or `from` (a piece
  already on the board). Gravity accepts any cell of the column and lands the mark at the bottom. `ply` is the
  ply the client saw: the kit's `guardTurn` ignores stale and duplicate moves. The server resolves every move
  with the engine (`resolveMove` / `playMove`), and the client uses the same engine only for hints.
- **Notation** (`cellName`): a column letter and a row counted from the bottom, like chess (`b2` is the centre
  of a 3×3). Ultimate names cells on the whole 9×9 grid (`a1`–`i9`). Notakto and the cube add the board or
  layer first (`2·b3`). Wild and Order & Chaos prefix the mark (`Ob2`), Numbers the number (`7b2`), and Nesting
  the piece size (`Lb2` places a large piece, `Ma1-b2` moves a medium one).

## Public state

Everything is public (nothing is hidden in any variant). `TicTacToePublicState` extends the kit's
`BoardRoomView` with:

- `variant`: the variant of the current game.
- `cells`: one token per cell. `''` is empty, `'x'` / `'o'` are marks and `'1'`–`'9'` are Numbers. Nesting
  writes the stack bottom to top, two characters per piece (owner, then size): `'x1o3'` is O's large piece over
  X's small one.
- `boards`: Ultimate `.` open, `x` / `o` won, `=` full; Notakto `.` live, `#` dead.
- `active`: the small board Ultimate's side to move must play in (`-1` = any open board).
- `winLine`, plus `lastCell`, `lastFrom` and `lastRemoved` for highlighting the last move.
- `fading`: Vanishing's next mark to fade for each side.
- `hands`: Nesting's pieces in hand.
- `history`: the move list.
- `repetitions`: how many times the current position has occurred.

`tictactoe:moved` (`TttMoveEvent`) carries each move for animation and sound.

## Settings, ratings and tournaments

- **Lobby:** the variant (default Classic), plus the kit's clock (default **untimed**), sides and take-backs.
- **Not rated.** The catalog entry has no `rated` flag, because perfect play draws Classic. Games report
  outcomes for stats and brackets, but never change a DASCADE rating.
- **Tournament Center:** single elim, double elim, round robin and Swiss, best of 1, 3 or 5, up to 64 players;
  sides swap every game. The organizer picks the **variant** (default Classic) and the **time control**
  (default 3+0) in `TOURNAMENT_GAME_SETTINGS`, and every game of every match uses them.
