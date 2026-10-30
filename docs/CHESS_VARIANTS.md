# DAS Chess variants

DAS Chess plays Standard chess plus the eight lichess variants. The host picks one in the lobby, and the Tournament Center organizer picks one for a tournament (`gameSettings.variant`). **Only Standard is rated.** Every other variant is casual, including in tournaments.

| id              | Title            | Family     | In one line                                                |
| --------------- | ---------------- | ---------- | ---------------------------------------------------------- |
| `standard`      | Standard         | Classic    | Normal chess, rated.                                       |
| `chess960`      | Chess960         | Classic    | A shuffled back rank, drawn for every game.                |
| `kingofthehill` | King of the Hill | New goals  | Bring your king to d4, e4, d5 or e5.                       |
| `threecheck`    | Three-Check      | New goals  | Give check three times.                                    |
| `racingkings`   | Racing Kings     | New goals  | Race your king to the 8th rank; checks aren't allowed.     |
| `antichess`     | Antichess        | Wild rules | Lose all your pieces; captures are compulsory.             |
| `atomic`        | Atomic           | Wild rules | Captures explode; blow up the enemy king.                  |
| `horde`         | Horde            | Wild rules | 36 white pawns against a full army.                        |
| `crazyhouse`    | Crazyhouse       | Wild rules | Captured pieces go to your pocket and can be dropped back. |

Titles, taglines, families and the player-facing rules live in `CHESS_VARIANT_INFO` (`packages/shared/src/games/chess.ts`). The lobby, the countdown and the Rules sheet all show those rules.

## Engines

- **Standard** stays on the chess.js-backed `ChessGame` (`packages/game-core/src/chess/index.ts`), so its behaviour is unchanged.
- **The variants** run on DASCADE's own pure, deterministic move generator, `variantRules.ts`:
  - Positions are immutable. Squares are 0–63, with a1 = 0.
  - Castling is encoded internally as "king takes own rook", so Chess960 needs no special cases.
  - `variantGame.ts` wraps it in a game record (history, undo, repetition counts, status).
  - No new dependency. chessops is GPL, and the repo has no license.
- **One API.** Both engines implement `ChessGameApi`. Get one with `createChessGame(variant, fen?)`; the room and the client only use this. Its extras:
  - `pocket` and `dropTargets` (Crazyhouse)
  - `checksGiven` (Three-Check)
  - `mustCapture` (Antichess)
  - `promotionChoices`, which adds the king in Antichess

### Verification

- `variantRules.test.ts` checks the generator against chess.js under Standard rules:
  - perft on the six well-known positions (start to depth 4)
  - move-by-move equality of the legal moves, SAN, UCI and FEN along random games
  - perft(3) from random positions
- `variantGame.test.ts` covers the variants themselves:
  - reference perft counts for every variant: python-chess/lichess suites, including five Chess960 positions and a Crazyhouse position with full pockets
  - the rules of each variant
  - random games in every variant, checking that they end legally, FENs round-trip, the UCI replays, and undo walks back to the start

## Rules, as implemented (lichess conventions)

- **Endings, in order:**
  1. the variant's own goal: hill, third check, race, explosion, Antichess no pieces or no moves, Horde wiped out
  2. checkmate
  3. stalemate
  4. insufficient material
  5. threefold repetition
  6. the fifty-move rule

  The draws are automatic, as in Standard. Mate-in-SAN follows chessops: any decisive result gets `#`.

- **Chess960:**
  - The start is Scharnagl position 0–959; 518 is the standard array.
  - The room draws a new one with its crypto RNG at every game setup. The lobby board shows 518.
  - To castle, move the king onto the rook. The king's g/c landing square is also accepted when it is two or more files away.
  - FEN castling is written as X-FEN; Shredder-FEN is accepted.
- **King of the Hill:** the king may not step onto the hill into check. Never insufficient material.
- **Three-Check:**
  - The FEN carries the remaining checks as `3+3` (the chessops style); the older `+N+M` checks-given suffix is also read.
  - Insufficient material means both sides have only a king.
- **Racing Kings:**
  - Moves that give check are illegal, and there is no castling.
  - If White's king reaches the 8th rank first, Black gets one more move. If Black's king can reach the 8th rank too, play goes on, and both kings there is a draw.
- **Antichess:**
  - There is no check, and captures (en passant included) are compulsory.
  - Pawns may promote to a king. There is no castling.
  - The side to move wins when it has no pieces or no legal move.
  - Insufficient material: only bishops are left, each side's on the opposite colour from the other's.
- **Atomic:**
  - A capture removes the capturing piece, the captured piece and every non-pawn on the eight neighbouring squares, kings included.
  - Kings can't capture, and a move that blows up your own king is illegal.
  - Kings that touch can't be in check.
  - Insufficient material means both sides have only a king.
- **Horde:**
  - White has no king and is never in check.
  - White pawns on the first rank may step twice. Those steps leave no en-passant square.
  - Black wins by capturing every white piece; stalemate is a draw.
- **Crazyhouse:**
  - Captured pieces go to the capturer's pocket. A promoted piece (`~` in the FEN) goes back as a pawn.
  - Drops are allowed on any empty square, except pawns on the 1st and 8th ranks. A drop may give check or mate.
  - A pawn drop resets the fifty-move counter. Never insufficient material.
- **Timeouts:** `canMate` decides whether the opponent's flag falling is a win:
  - Chess960 uses Standard's mating-material rule.
  - Three-Check and Atomic need a piece other than the king.
  - Every other variant always counts as able to win.

**Simplified versus lichess:** insufficient material in Atomic and Antichess covers only the cases above. Draws by repetition and the fifty-move rule catch the rest.

## Room (`apps/game-server/src/rooms/chess/ChessRoom.ts`)

- The settings field `variant` defaults to `'standard'`. The lobby state (`variant`, `fen`, `startFen`) follows it, and it locks at game setup.
- `isRatedMatch()` is true only for Standard. Variant games keep take-backs (if allowed) and hide ratings in the UI.
- The move message accepts `{ from, to, promotion?, ply }` or a Crazyhouse drop `{ to, drop, ply }`. The schema is strict, and the engine decides legality. Refusals say "You must capture." (Antichess) or "You can't drop that piece there." (Crazyhouse).
- Move entries carry `drop` and `exploded` (space-separated squares) for the client's sounds and effects.
- Outcome details include the `variant`.
- The PGN gets a `Variant` tag; Chess960 also gets `SetUp`/`FEN`. UCI is king → rook for Chess960 castling and `N@f3` for drops.

## Client (`apps/web/src/games/chess/`)

- `Settings.tsx`: the kit's `VariantPicker`/`VariantRulesCard` with a board icon per variant. The Rated toggle is shown for Standard only.
- `useChessBoard.ts`:
  - The engine per variant, via `createChessGame`.
  - Review replays from `startFen` using each move's UCI.
  - Crazyhouse drop selection (`pickDrop`, then a tap on a highlighted square).
  - Chess960 castling onto the rook.
  - Premove geometry for the variants (Standard keeps chess.js `premoveTargets`).
- `variants.tsx`:
  - Board marks (`hill`, `goal`, `boom`, `must` → `[data-mark~=…]`)
  - The pocket (`data-testid="pocket-w|b"`) and the Three-Check pips
  - The goal hints
- `sounds.ts`: the explosion and drop sounds, played through the shared synth.
- Explosions flash and leave a scorch mark. The flash is off under reduced motion, `fx` off, or the OS setting.
- Board marks are game information, so their colours are fixed in every theme. The lobby icons draw on the theme's board materials.

## Adding a variant

1. Add the id to `CHESS_VARIANTS` and its entry to `CHESS_VARIANT_INFO`.
2. Teach `rulesFor`, the move generator and `variantEnd` in `variantRules.ts` the new rule, and add the start FEN in `START`.
3. Add `canMate` and insufficient-material cases if needed, a result text in the room's `END_TEXT`, and an icon/goal in `variants.tsx`.
4. Add reference perft counts and rule tests in `variantGame.test.ts`. The random-game test picks the new variant up automatically.
