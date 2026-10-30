# DAS Checkers variants (`checkers`)

DAS Checkers plays twelve draughts variants on the Boardroom kit. **American checkers** is the default and the
only rated one. The host picks the **variant** in the lobby, and the board follows the choice so everyone sees
the starting position. A game keeps its variant until it ends, and rematches replay it with sides swapped.
Spectators, clocks, take-backs, draw offers, rematches and Tournament Center matches all come from the kit, in
every variant.

| Piece                                                    | Path                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contract (variants, rules text, settings, public state)  | `packages/shared/src/games/checkers.ts`                                                                                                                            |
| American engine (unchanged)                              | `packages/game-core/src/checkers/{board,moves,game}.ts`                                                                                                            |
| Variants engine: N×N geometry, rule sets, moves, records | `packages/game-core/src/checkers/variants/`                                                                                                                        |
| Room                                                     | `apps/game-server/src/rooms/checkers/`                                                                                                                             |
| Client (board, lobby picker, game screen)                | `apps/web/src/games/checkers/`                                                                                                                                     |
| Tests                                                    | `packages/game-core/src/checkers/**/*.test.ts`, `apps/game-server/test/checkers*.test.ts`, `apps/web/src/games/checkers/selection.test.ts`, `e2e/checkers.spec.ts` |

## The variants

Side `first` plays the colour that moves first: **Dark** in American, Giveaway and Pool, **Light** everywhere
else. Light always starts at the bottom of the diagram and Dark at the top; each player sees their own colour
at the bottom.

Common to every variant: men move one square diagonally forward. Capturing is mandatory, and a capture
sequence is one move that must be completed. Variants with flying kings also use the **Turkish strike**: jumped
pieces stay on the board until the move ends, so they can't be jumped twice and nothing can pass over them.

### 8×8 classics

| Variant       | First | Men capture backwards | Kings      | Which capture                                                                                          | Crowning mid-capture                       |
| ------------- | ----- | --------------------- | ---------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| **American**  | Dark  | no                    | one square | any                                                                                                    | crowned, the move ends                     |
| **Russian**   | Light | yes                   | flying     | any (a king must land where it can keep capturing)                                                     | crowned at once, keeps capturing as a king |
| **Pool**      | Dark  | yes                   | flying     | any                                                                                                    | passes through as a man                    |
| **Brazilian** | Light | yes                   | flying     | the most pieces                                                                                        | passes through as a man                    |
| **Italian**   | Light | no                    | one square | most pieces → with a king rather than a man → most kings → a king taken earliest; men can't take kings | crowned, the move ends                     |
| **Spanish**   | Light | no                    | flying     | most pieces → most kings                                                                               | crowned, the move ends                     |
| **Czech**     | Light | no                    | flying     | a king must capture when one can; otherwise any                                                        | crowned, the move ends                     |

### Big boards

| Variant           | Board | Men a side | Rules                                                                                                                          |
| ----------------- | ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **International** | 10×10 | 20         | FMJD rules: Light first, men capture backwards, flying kings, the most pieces must be taken, a man passes through the far row. |
| **Canadian**      | 12×12 | 30         | International rules on a 12×12 board.                                                                                          |

### Twists

| Variant          | Board | Rules                                                                                                          |
| ---------------- | ----- | -------------------------------------------------------------------------------------------------------------- |
| **Giveaway**     | 8×8   | American rules, but you **win** when you have no pieces left or none of them can move.                         |
| **Antidraughts** | 10×10 | International rules, but you **win** when you have no pieces left or none of them can move.                    |
| **Breakthrough** | 10×10 | International rules; the first player to crown a king wins at once (the man must end its move on the far row). |

Captures that take the same pieces from the same square to the same square with the same result (a flying king
landing on different squares along the way) count as one move. The room accepts the full path or the
unambiguous from → to shortcut.

## Automatic draws

Every variant draws on the **third repetition** of a position with the same side to move. On top of that:

| Variant family                     | Move limit (no capture, no man move) | Endgame rules (counted since the last capture or crowning)                                                                                                      |
| ---------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| American, Giveaway, Italian, Czech | 40 moves each                        | —                                                                                                                                                               |
| Russian, Pool, Brazilian           | 15 moves each                        | 3+ kings (no men) vs a lone king: 15 moves; 2 pieces or fewer with a king vs a lone king: 5 moves; king endings with 4–5 pieces: 30 moves, 6–7 pieces: 60 moves |
| Spanish                            | 20 moves each                        | 3+ kings (no men) vs a lone king: 13 moves                                                                                                                      |
| International, Canadian            | 25 moves each                        | 3 pieces with a king vs a lone king: 16 moves; 2 pieces or fewer with a king vs a lone king: 5 moves                                                            |
| Antidraughts                       | —                                    | —                                                                                                                                                               |
| Breakthrough                       | — (the first king ends the game)     | —                                                                                                                                                               |

The side panel counts down the nearest automatic draw.

## Sources and simplifications

- Rules follow the FMJD rules (International; Brazilian and Canadian are International rules on 8×8 and
  12×12), the Russian draughts rules, American Pool rules, the Italian federation's capture priorities, the
  Spanish "cantidad / calidad" laws and Czech dáma, checked against lidraughts and playstrategy.
- Italian draughts is traditionally played on a board turned 90° (a dark corner square on each player's right).
  DAS Checkers uses one orientation for every 8×8 variant, so an Italian game is the mirror image of the
  traditional one: every line plays the same, but squares are numbered the international way.
- Russian's 5-move rule for a lone king on the long diagonal isn't implemented; the 15-move rule ends those
  endings a little later.
- The endgame rules restart their count when the material changes, including when a man is crowned.
- Pool's, Italian's and Czech's move limits are house rules (the federations leave them to the arbiter).
- Turkish draughts (orthogonal moves), Frisian draughts (orthogonal captures and piece values) and Thai
  draughts are out of scope for now.

## Ratings and tournaments

Only American checkers changes DASCADE ratings: the room's `isRatedMatch()` is false for every other variant,
including Tournament Center matches. In the lobby, the Rated switch, the rating tags and the rated/casual note
only appear for American. Tournament organizers can pick any variant; the match room locks it like a lobby
setting.

## Tests

- `variants/oracle.test.ts`: the variants engine with American rules matches the original engine over 300 random
  games, plus the published perft numbers.
- `variants/variants.test.ts`: each rule above, in its own position.
- `variants/playout.test.ts`: seeded random games in every variant keep the move invariants and end legally.
- `apps/game-server/test/checkers-variants.test.ts`: the lobby follows the variant, the variant is locked at the
  start, maximum capture and flying kings through the room, Giveaway and Breakthrough wins, rated only in
  American, a variant tournament match, take-backs.
- `e2e/checkers.spec.ts`: International and Russian games next to the American ones.
