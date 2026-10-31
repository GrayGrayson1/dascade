# DAS Reversi (`reversi`)

The disc-flipping duel for two players, on the Boardroom kit next to chess, checkers and tic-tac-toe. It has the
classic 8×8 game plus nine variants. The host picks the **variant** in the lobby. A game keeps its variant until
it ends, and rematches replay it with colours swapped. Spectators, clocks, take-backs, draw offers, rematches,
ratings and Tournament Center matches all come from the kit.

It lives in the DAS Boardroom cabinet (`/cabinet/boardroom`, or straight to `/play/reversi`). The product name
is generic on purpose: the commercial name of the 8×8 game is a trademark, so nothing in the app uses it.

| Piece                                                    | Path                                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Contract (variants, settings, messages, public state)    | `packages/shared/src/games/reversi.ts`                                                                     |
| Engine: flips, skipped turns, scoring, the random setups | `packages/game-core/src/reversi/`                                                                          |
| Room                                                     | `apps/game-server/src/rooms/reversi/`                                                                      |
| Client (board, discs, lobby variant picker)              | `apps/web/src/games/reversi/`                                                                              |
| Tests                                                    | `packages/game-core/src/reversi/*.test.ts`, `apps/game-server/test/reversi.test.ts`, `e2e/reversi.spec.ts` |

## Rules

Side `first` is **Black** and moves first; `second` is **White**. Place a disc so that a straight line of your
opponent's discs (across, down or diagonal) is trapped between it and one of your discs: every trapped disc, in
every direction, flips to your colour. A move must flip at least one disc. A player with no legal move is
skipped. When neither player can move (usually a full board) the game ends and the most discs wins; equal counts
are a draw.

## Variants

### Classics

| Variant                         | Board | Rules                                                                                                                                                                                                                       |
| ------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Classic** (default)           | 8×8   | The rules above, from the crosswise centre (White d4 and e5, Black e4 and d5). The only rated variant.                                                                                                                      |
| **Original** (`original`)       | 8×8   | The 1880s rules. The board starts empty and the first four discs (two each, Black first) go on the four centre squares in any arrangement, flipping nothing. Each player has 32 discs: run out and you can't move any more. |
| **Parallel Start** (`parallel`) | 8×8   | Classic rules from the side-by-side opening (White d4 and e4, Black d5 and e5).                                                                                                                                             |

### Boards

| Variant                   | Board        | Rules                                                                                                                           |
| ------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Mini 6×6** (`mini`)     | 6×6          | Classic rules on 36 squares (White wins with perfect play).                                                                     |
| **Grand 10×10** (`grand`) | 10×10        | Classic rules on 100 squares.                                                                                                   |
| **Octagon** (`octagon`)   | 8×8 − 12     | Three squares at each corner are out of play, so there are no corners to grab. A line ends at a missing square.                 |
| **Wraparound** (`torus`)  | 8×8, a torus | Lines continue across the edges (a line leaving the right edge comes back in on the left, diagonals too): no corners, no edges. |

### Twists

| Variant                     | Board | Rules                                                                                                                                                                                 |
| --------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Anti** (`anti`)           | 8×8   | Classic moves, reversed goal: the **fewest** discs wins.                                                                                                                              |
| **Blockers** (`blockers`)   | 8×8   | Four squares are blocked when the game starts: two random squares outside the centre 4×4 and their mirror images through the centre. Nobody plays there and lines can't pass through. |
| **Random Start** (`random`) | 8×8   | Four random legal opening moves (two each) are played for the players, then Black moves.                                                                                              |

Not included: four-player Reversi (the Boardroom kit is two-player) and hexagonal boards. The player-facing
wording lives in `REVERSI_VARIANT_INFO` (title, tagline, family, size, start, holes, wrap, goal, supply, rules,
tip); the lobby card and the in-game help both read it, so change rules text there and nowhere else.

## Turns, endings and take-backs

- **Skipped turns are automatic.** After a move, if the opponent has no legal move but the mover does, the
  engine appends a `pass` ply for the opponent and the room calls the kit's `completeTurn` a second time with
  `skipped = true` (the ply goes up by two; clocks switch twice; the skipped side's own move count and any
  standing draw offer are untouched). The client shows "White had no move — Black plays again" and plays a
  two-note "skip".
- **Endings.** Neither side can move: `discs` (the count decides; Anti: fewest wins) or `tie` (equal counts).
  Result text reads "Black wins 38–26", "Black wins 6–0 — a wipeout", "White wins with fewer discs, 20–44" or
  "Draw — 32 discs each". The kit adds resignation, draws by agreement, time-outs (a flag always loses: either
  side can always still win), the untimed idle rule, abandonment and forfeits.
- **Take-backs** (casual, unrated games) replay the remaining plies from the game's start (`fromPlies`, the
  drawn setup included). A take-back that would land right before a skipped turn is refused when accepted:
  that position has no move to play.

## Cells, moves and notation

- **Cells** are numbered row by row from the top-left (`0` = a1). Columns are lettered left to right and rows
  numbered **from the top**, as on a printed Reversi diagram (Black's first moves are d3, c4, f5 and e6). The
  board is never flipped: both players read the same coordinates. Largest board: Grand's 100 cells.
- **Board string** (`board` in state): one character per cell, `.` empty, `b` Black, `w` White, `#` out of play.
- **One message**, `reversi:move` (`ReversiMoveSchema`, strict): `{ cell, ply }`. `ply` is the ply the client
  saw: the kit's `guardTurn` ignores stale and duplicate moves. The server validates every placement with the
  engine; the client uses the same engine only for the legal-move marks, the hover preview and the optimistic
  move. Refusals explain themselves ("That move flips nothing…", "The first four discs go on the four centre
  squares.", "That square is out of play.").
- **Random setups** (Blockers' squares, Random Start's opening) are drawn by the room's crypto RNG at the
  countdown (`randomSetup(variant, this.rng)`); the lobby shows the plain start.
- **Notation** (`cellName`): `d3`, or `pass` for a skipped turn.

## Public state

Everything is public. `ReversiPublicState` extends the kit's `BoardRoomView` with `variant`, `size`, `board`,
`lastCell` and `lastFlips` (the last placement and the discs it turned), `lastPassed` (the side skipped right
after it), `supply` (Original: discs left, `[Black, White]`) and `history`. `reversi:moved`
(`ReversiMoveEvent`: `cell`, `flips`, `passed`, `notation`) drives the sounds.

## Client

- `ReversiBoard` adapts the kit's `SquareBoard` (squares out of play are its unplayable squares). Legal moves
  show as faint discs of the mover's colour; pointing at (or focusing) one shows a ghost disc and rings the
  discs it would flip.
- Discs are two-faced elements that turn over in 3D when their colour changes, staggered outward from the
  placed disc (`flipDelays`); reduced motion swaps them instantly. The disc just placed drops in and the
  flipped discs glint once.
- The side panel has a Black/White score bar, the variant's hints (skipped turns, Original's opening and discs
  left, Anti's goal, Wraparound's edges), the move list, rules and a strategy tip. Player cards show each
  side's disc count (and Original's discs left).
- Board art reads the theme's **table** materials (felt, felt line, rail) and the discs its **piece**
  materials, with the Delta Neon green baize as the fallback. The arcade has a Reversi attract scene (an
  opening that ends with one disc flipping six) and a Reversi motif on the Boardroom cabinet.

## Settings, ratings and tournaments

- **Lobby:** the variant (default Classic), plus the kit's clock (default **10+0**), sides and take-backs.
- **Rated:** the catalog has `rated: true`, but the room's `isRatedMatch()` is true only for **Classic**
  (`isRatedReversiVariant`). Other variants are always casual, in tournaments too.
- **Tournament Center:** single elim, double elim, round robin and Swiss, best of 1, 2, 3 or 5, up to 64
  players; colours swap every game. The organizer picks the **variant** (default Classic; Blockers and Random
  Start draw a new setup each game) and the **time control** (default 5+0).
