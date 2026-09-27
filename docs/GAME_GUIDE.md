# Building a DASCADE game

This guide describes the contract every game follows. Read it all before you touch a game. The shared platform code (the base room, platform services, lobby, session, hooks, design system and theme) and the three game-family **kits** are shared by many games. Build *on* them, and don't fork them.

## 0. Where your code goes

For a game with id `<id>`:

| What | Path | Notes |
|---|---|---|
| Catalog entry | `packages/shared/src/catalog.ts` | `GAME_IDS` + `GAME_CATALOG[<id>]`: title, taglines, `category`, `cabinet`, capacity, controls, how-to-play, accent. Optional `tournament`, `rated`, `reconnectGraceSeconds`. |
| Cabinet listing | `packages/shared/src/cabinets.ts` | Add the game to its cabinet's `games[]` (see the README for adding a cabinet). |
| Shared contract | `packages/shared/src/games/<id>.ts` | Settings Zod schema + defaults, message names, payload schemas and public types. Imported by both server and client. |
| Pure engine | `packages/game-core/src/<id>/` (`index.ts` + `*.test.ts`) | Pure TypeScript: no Colyseus, no DOM. Deterministic with an injected `Rng`. **Heavily unit tested.** |
| Server room | `apps/game-server/src/rooms/<id>/<Name>Room.ts` (+ schema file) | Extends `BaseGameRoom`, or a kit room (§6). Register it in `rooms/registry.ts`. |
| Server tests | `apps/game-server/test/<id>.test.ts` | Integration tests using `test/helpers.ts` (and `test/tournament-helpers.ts` for tournament games). |
| Client module | `apps/web/src/games/<id>/index.tsx` (+ any files in that folder) | Default-export a `GameClientModule` and register it in `games/registry.ts`. |
| Client styles | `apps/web/src/games/<id>/<id>.css` | Imported from your module. Prefix classes with a short game prefix (e.g. `.sk-`, `.bj-`). |
| Attract scene | `apps/web/src/arcade/scenes/*.ts` | Registered in `SCENES` and the cabinet's `CABINET_PLAYLISTS` (`arcade/attract.ts`). |
| E2E smoke | `e2e/<id>.spec.ts` | Playwright, using `e2e/helpers.ts` (plus `e2e/classics-helpers.ts` for Classics). |
| Load scenario | `scripts/load/<id>.ts` | Party games: a 30-client protocol scenario (§5). |

**Platform code.** `BaseGameRoom.ts`, `schema/base.ts`, `platform/*`, `apps/web/src/net/*`, `apps/web/src/shell/*`, `packages/ui/*`, the shared protocol, catalog and cabinet files, the kits, root configs and `package.json` files are shared by every game. Work inside your own folder first. If the platform or a kit truly lacks something, make a small, additive change with tests, and keep existing games working. New npm dependencies need a real evaluation: licence, maintenance, TypeScript types, bundle size, Node and browser support. Prefer procedural art and audio (Canvas, SVG, CSS, Phaser graphics, WebAudio).

## 1. Shared contract (`packages/shared/src/games/<id>.ts`)

```ts
import { z } from 'zod';
export const WheelSettingsSchema = z.object({ /* every field bounded: .min/.max, string .max, array .max */ });
export type WheelSettings = z.infer<typeof WheelSettingsSchema>;
export const DEFAULT_WHEEL_SETTINGS: WheelSettings = { ... };
export const WHEEL_MSG = { spin: 'wheel:spin', result: 'wheel:result' } as const;   // message names: '<id>:<action>'
export const WheelSpinSchema = z.object({ ... });                                   // client→server payloads
export interface WheelPublicState extends BaseRoomView { ... }                      // what state.toJSON() looks like
```
- Bound every size: string lengths, array lengths, numeric ranges. The server rejects anything invalid.
- Settings are replaced **per top-level key**: the lobby sends `{ settings: { segments: [...] } }` and the server merges and validates the whole object.
- Import from other files with the explicit `.ts` extension (`import { x } from './foo.ts'`).
- Import shared code as `@dascade/shared` and game-specific code as `@dascade/shared/games/<id>`. The package exports `./*` as `./src/*.ts`, so `@dascade/shared/games/wheel` resolves to `src/games/wheel.ts` and `@dascade/shared/party` resolves to `src/party.ts`.

## 2. Pure engine (`packages/game-core/src/<id>/`)

- Put all rules here: dealing, evaluation, settlement, validation, scoring, physics, content graphs.
- Take an `Rng` (`import type { Rng } from '@dascade/shared'`) as a parameter and never call `Math.random()`. Tests use `createSeededRng(seed)` and the server passes its crypto RNG.
- Import it as `@dascade/game-core/<id>`. The package exports `./*` as `./src/*/index.ts`.
- Shared card primitives are in `@dascade/game-core/cards` (`Deck`, `createDeck`, `createShoe`, `parseCard`, `cardToCode`, and more). Cards travel as 2-char codes such as `"As"` and `"Td"`.
- Chess rules come from `chess.js` (wrapped in `@dascade/game-core/chess`). Other engines are in-house.
- **Determinism.** If the client and server both run a simulation (prediction, replay verification, trajectory previews), the shared sim may only use `+ - * /`, `Math.sqrt`, `floor`, `round`, `abs`, `min`, `max` and integer math. `Math.sin`, `cos`, `atan2`, `pow` and `exp` can differ in the last bit between V8, JavaScriptCore and SpiderMonkey. Use direction tables (`@dascade/game-core/classics/shared`: `DIRS`, `dirVec`, `rotateBy`) or polynomial approximations (as DAS Putt and DAS Tanks do). The server's result is always authoritative.
- Write thorough Vitest tests next to the code (`*.test.ts`). The root `vitest.config.ts` already includes `packages/*/src/**/*.test.ts`. Add seeded random playouts or invariant tests where they help.

## 3. Server room

```ts
import { t, type SchemaType } from '@colyseus/schema';
import { z } from 'zod';
import { BaseRoomState } from '../../schema/base.ts';
import { BaseGameRoom, type PlayerRecord } from '../BaseGameRoom.ts';

export const WheelState = BaseRoomState.extend({
  spinning: t.boolean().default(false),
  history: t.array(WheelHistoryEntry),        // nested schemas via schema({...}, 'Name')
}, 'WheelState');
export type WheelState = SchemaType<typeof WheelState>;

export class WheelRoom extends BaseGameRoom<WheelState, WheelSettings> {
  readonly gameId = 'wheel' as const;
  protected readonly settingsSchema = WheelSettingsSchema;
  protected defaultSettings() { return structuredClone(DEFAULT_WHEEL_SETTINGS); }
  protected createState() { return new WheelState(); }
  override settingsEditablePhases = ['LOBBY', 'PLAYING'] as const; // if settings may change mid-game

  protected override onRoomCreated() {
    this.handle(WHEEL_MSG.spin, WheelSpinSchema, (player, payload) => { ... }, { phases: ['PLAYING'], hostOnly: true, rate: RATE.heavy });
  }
  protected onGameStart() { /* phase is PLAYING now */ }
}
```

### State (Colyseus Schema v5, `schema()` builder, no decorators)
- Primitives: `t.string()`, `t.number()`, `t.boolean()`, `t.uint8()`, `t.int32()`, `t.float32()` and so on. **Always add `.default(...)`**, because a number without a default encodes as `0` (NaN).
- Nested: `const Seat = schema({ ... }, 'Seat')`. Collections: `t.array(Seat)`, `t.map(Seat)`, `t.array('string')`, `t.map('number')`. Collections are auto-created. Mutate them with `.push`, `.splice`, `.clear()`, `.set` and `.delete`.
- Extend the base: `BaseRoomState.extend({...}, 'MyState')`. Each schema can hold at most 64 fields.
- Assign simple values directly (`this.state.pot = 50`). For arrays of primitives, `state.board.clear(); state.board.push(...cards)` works.
- A JSON string field is fine for complex data that changes rarely, e.g. `nodeJson: t.string()`. Large or frequently changing collections (brackets, standings) belong in Schema maps so patches stay small.
- **Hidden information never goes in state.** That includes hole cards, decks, the dealer hole card, secret words, other players' bingo cards, fleets, roles and night actions, answers and votes before the reveal, authors before the reveal, RNG seeds before reveal, and future race inputs.

### Messages
- Register **every** client→server message with `this.handle(type, zodSchema, handler, opts)`. It resolves the `PlayerRecord`, rate-limits (`opts.rate`, default `RATE.action`; see `RATE` in `@dascade/shared`; `opts.bucket` shares a bucket between types), rejects oversized payloads (`opts.maxBytes`), validates with Zod, checks `opts.phases`, `opts.hostOnly` and `opts.playersOnly`, and catches handler errors.
- Use `opts.silent: true` for high-frequency streams (drawing points, real-time input) so rejected packets don't trigger error replies.
- **Never trust ids, indices, scores or outcomes in payloads.** The acting player is always `player` (the resolved record). Check turn order, eligibility and balances inside the handler, then `this.reject(player, type, 'not_your_turn', 'Human readable')` to refuse. Carry a sequence or ply number in turn-based payloads so stale or duplicate messages are refused and never score twice.
- Handlers must be **synchronous** with respect to game state. Colyseus processes one message at a time, so synchronous handlers can't interleave. If you must `await`, re-check phase and state afterwards.

### Private information
- `this.sendTo(player, '<id>:private', payload)` sends to one player (`this.sendWhere(pred, …)` to a filtered set). Spectators and other players never receive it.
- Implement `protected override syncPrivate(player)` to (re)send **everything** that player should currently see. The base calls it after join, reconnect and seat-token rejoin, so reconnecting players get their hole cards, word choices, bingo card and so on back. On the client, read it with `useLatestMessage('<id>:private')`, which replays the last payload. (The party kit's `sendPrivate` mailbox does this for you.)
- Broadcast public events with `this.broadcast('<id>:event', payload)` for animations (spin results, deals). Keep the state the source of truth for anything a late joiner needs. Binary snapshots for real-time games: `this.broadcastBytes('<id>:snap', bytes, {})`.

### Lifecycle hooks (override what you need)
`onRoomCreated(options)`, `onCountdownStart()` (build the start position so clients can render it during 3-2-1), `onGameStart()` (required), `onPlayerJoined(p, {lateJoin})`, `onPlayerDisconnected(p)` (transient drop), `onPlayerReconnected(p)`, `onPlayerAway(p)` (grace expired mid-match; seat kept), `onPlayerRemoved(p, reason)` (left, kicked or disconnected; gone for good), `onHostChanged(next, prev)`, `validateStart()` (return a reason string to block), `settingsLockReason()` (refuse a settings change right now), `onSettingsChanged(prev, next)`, `onReturnToLobby()` (reset all game state here), `syncPrivate(p)`, `interceptChat(p, text)` (return true to consume, as DASketch does for guesses), `onRoomDisposed()`.

Policy hooks:
- `canBecomeHost(p)`: by default, mid-match only seated players can become host.
- `kickBlocker(target)`: return a reason to refuse a host kick. DASception blocks mid-match kicks of seated players so a Glitch host can't remove Sysops. The boardroom kit blocks a non-playing host from removing a player in a live rated game.
- `ratedOptIn()`: return true when a casual room of a `rated` game should change ratings. The boardroom kit returns its lobby **Rated** toggle.

Helpers:
- **Phases and timers:** `this.setPhase(phase, durationMs?)` publishes `phaseEndsAt` (server epoch ms); `this.setTimer(ms)`; `this.startMatch()` starts from code (e.g. instant solo); `this.returnToLobby()`; `this.promoteQueued()` seats queued late joiners between rounds or hands. `this.schedule(key, ms, fn)`, `this.cancel(key)`, `this.isScheduled(key)` and `this.clearAllTimers()` give you named timers that are cleaned up automatically.
- **Players:** `this.seatedPlayers()` returns non-spectators including disconnected ones; `this.activePlayers()` returns connected non-spectators; `this.players` is the `Map<id, PlayerRecord>`; `this.isHost(player)`.
- **Messaging:** `this.toast(player | 'all', kind, text)`; `this.systemChat(text)`.
- **Settings:** `this.getSettings()`; `this.updateSettings(next)` lets game code mutate settings (for example, removing a wheel winner).
- **RNG:** `this.rng` is a **crypto RNG, so use it for anything that decides outcomes**.
- **Platform:** `this.reportOutcome(...)`, `this.tournamentMatch`, `this.isRatedMatch()`, `this.ratingOf(player)` (see below).

Phases: `LOBBY → COUNTDOWN (3s, automatic on host Start) → PLAYING ↔ INTERMISSION → RESULTS → (host "Play again") LOBBY`. `ENDED` means the room is closing. Set `countdownMs = 0` to skip the countdown. The client shows a shared 3-2-1 overlay unless your module sets `ownCountdown: true`.

Spectators: `player.state.spectator` is true for spectators. They must never act. Use `playersOnly: true` or check it yourself. Late joiners in games where `lateJoinAsPlayer === false` arrive as spectators with `queued = true`.

Disconnects: during PLAYING, a dropped player's record stays put (`connected = false`). The reconnect grace comes from the catalog's `reconnectGraceSeconds` (default 45s). Games must never stall: skip, auto-play, auto-fold or forfeit disconnected or away players after a timeout, always keep a turn or stage timer, and end the game cleanly when too few players remain.

Solo mode: `this.isSolo` is true when the room was created with `{ solo: true }` and the catalog allows solo (the room is locked, max 1 player). If your game supports solo play, consider calling `this.startMatch()` from `onPlayerJoined` for instant play.

### Ending a game: `endMatch` + `reportOutcome`
Every ending, whether a win, draw, resign, timeout, forfeit, abandonment or "everyone left", must do two things:

```ts
this.reportOutcome({
  placements: [[winnerId], [runnerUpId, alsoSecondId], [lastId]],  // room player ids by place, best first; a draw = [[a, b]]
  scores: { [id]: 42 },          // optional; lowerIsBetter: true for golf-style scores
  reason: 'checkmate',           // short machine reason
  details: { playerStats: { [id]: { correctAnswers: 7, bestStreak: 4 } } },  // optional, small, JSON-safe
});
this.endMatch({ players: [...summary] });   // RESULTS phase + legacy match summary
```

- `reportOutcome` feeds DASCADE ratings, per-game stats (Profile → Stats) and Tournament Center advancement. It is accepted **once per match** (duplicates are logged and ignored) and filtered to the match roster, so players who left mid-game still count. List them in the place they earned, usually last (`this.matchLeaverIds()` returns the starters who have left the room).
- Stats extras aggregate by key prefix: `max…` and `best…` keep the highest value, `min…` and `fewest…` keep the lowest, and anything else is summed. Labels live in `STAT_EXTRA_LABELS` (`packages/shared/src/stats.ts`), and unknown keys are humanised.
- The kits call both for you (`finishParty`, `finish`, `finishMatch`).

### Tournament matches
When the Tournament Center creates your room for a match, `this.tournamentMatch` is a `TournamentMatchInfo` (round, series score, game number, decider, `participants[]` with `participantId`, `playerId` and `side: 'first' | 'second'`). The base room already:
- seats the two ticket holders and makes everyone else a spectator;
- locks the room and refuses lobby controls (start, kick, settings, spectate, rename, close);
- auto-starts each game when both participants are present;
- drives the series: an intermission, then the next game, then decided or closed;
- publishes `tournamentJson` for the client.

Your room must:
- give colours or first move from `participants[].side` in **every** game (sides swap between games of a series);
- use fixed tournament rules where the game has them (e.g. `PADDLE_TOURNAMENT_RULES`, `PUTT_TOURNAMENT_SETTINGS`) and ignore lobby toggles that would change the format;
- disable casual-only features such as take-backs, rematch votes and practice modes;
- call `reportOutcome()` at every ending, because the bracket only advances on reported outcomes. Tournament games of `rated` games are always rated.

To make a game tournament-capable, add `tournament: { formats, bestOf, maxField, draws, sides }` to its catalog entry. Optionally list organizer-settable options in `TOURNAMENT_GAME_SETTINGS` (`packages/shared/src/tournamentGames.ts`). Test it against a real kiosk with `test/tournament-helpers.ts` (`setupField`, `takeSeat`, `admin`; see `tournament-chess.test.ts`).

## 4. Client module

```tsx
// apps/web/src/games/wheel/index.tsx
import type { GameClientModule } from '../types.ts';
import './wheel.css';
const module: GameClientModule = { GameView: WheelView, SettingsPanel: WheelSettingsPanel, PlayerSetup?, lobbyPhases?, immersive?, ownCountdown?, musicMood? };
export default module;
```
- **GameView** renders for every phase except LOBBY (COUNTDOWN, PLAYING, INTERMISSION, RESULTS). Wrap it in `<GameStage gameId="wheel">` from `../../shell/common.tsx`, which applies your accent theme and backdrop. It sits under the shared 56px top bar, or fills the screen with a floating menu if `immersive`. `lobbyPhases: []` means your view renders in every phase (the tournament kiosk uses this).
- Hooks from `../../net/hooks.ts`:
  - `useGame<MyState, MySettings>()` returns `{ state, phase, settings, playerId, me, isHost, isSpectator, players, seated, send, serverNow }` (or null before the first state).
  - `useRoomSelector(s => s.someField)` re-renders only when the selected value changes. Prefer it for big or high-frequency states.
  - `useRoomMessage(type, handler)` handles event messages (animations, sounds).
  - `useLatestMessage<T>(type)` gives you the latest private or state-like message (replayed on mount).
  - `useCountdown(state.phaseEndsAt)` returns ms remaining against the synced server clock.
  - `session.send(type, payload)`; `session.room` is the raw Colyseus room, for Phaser scenes that want to read `room.state` directly without React.
- **SettingsPanel** gets `{ settings, canEdit, update(patch) }`. Render read-only when `!canEdit`, and in tournament match rooms (`tournamentJson` set). **Debounce** text inputs (about 400ms) before calling `update`, because settings messages are rate-limited to 5/s.
- **PlayerSetup** is per-player lobby setup (car builder, hero pick, team pick). It sends its own game messages.
- Results screens: use `<ResultsActions />` from `../../shell/common.tsx`. It gives the host **Play again** and everyone **Back to cabinet** and **Leave**. Tournament rooms show `<TournamentBanner />` (series score, next game, Back to tournament) from the shell.
- Reconnecting: the shell shows the RECONNECTING overlay, the RECONNECTED flash and the "Rejoin my seat" screen for every game (`shell/Reconnect.tsx`). Don't build your own.
- Chat: `<ChatPanel />` (shared chat log) takes an optional `onSend` override and `renderMessage`.
- UI kit: `import { Button, IconButton, Panel, Modal, Field, TextInput, TextArea, Select, NumberInput, Toggle, Slider, Segmented, Tabs, Badge, Kbd, Spinner, ProgressBar, TimerRing, EmptyState, Avatar, PlayerChip, ColorSwatches, PixelIcon, PixelArt, PlayingCard, CardBack, CasinoChip, ChipStack, chipBreakdown, GameTheme, cx } from '@dascade/ui'`. See `packages/ui/src/components/*.tsx` and `packages/ui/src/styles/*.css`. Icons are listed in `packages/ui/src/icons.ts`, and your own pixel art can use `<PixelArt rows={[...]} />`.
- **Theme tokens** (full reference: [`THEMING.md`](THEMING.md)):
  - Style chrome with tokens, never raw colours. Palette tokens are `--bg-*`, `--text-*`, `--line*` and `--glass*`. Semantic tokens include `--panel-*`, `--surface-*`, `--button-*`, `--input-*`, `--hud-*` (game HUD/scoreboards), `--success`, `--warning`, `--danger` and `--info`. Use `--accent`, `--accent-2` and `--glow-*` for accents, and `--sp-*`, `--radius*`, `--dur-*` and `--ease-*` for spacing and motion.
  - For translucent black or white, use `color-mix(in srgb, var(--shade) 35%, transparent)` or `var(--light)` instead of `rgba(0,0,0,…)`.
  - Fonts: `--font-display` (Tiny5) for headings and labels only, `--font-pixel` (Silkscreen) for small caps, `--font-ui` (Inter) for body text, and `--font-num` (Space Grotesk, `tabular-nums`) for **every number, clock, score and code**. Tiny5 digits are ambiguous.
  - Game art (boards, sprites, terrain, felt) may keep its own palette. Declare it once as CSS vars or constants in your folder, and use local ink colours for text on fixed art so light themes stay readable.
  - Canvas and Phaser: `useThemeTokens(ref)` / `readThemeTokens(el)` from `@dascade/ui` return resolved colours (including `int` values for Phaser), fonts, `glow` and `scanlines` already scaled by the effects setting, plus `fx` and `reducedMotion`.
- Audio: `import { sfx, synth, music } from '../../audio/audio.ts'`. Call `sfx('card' | 'chip' | 'spin' | 'win' | ...)`. `synth.tone({...})` and `synth.noise({...})` are available for custom sounds. Never autoplay before a user gesture (handled for you).
- Settings: `useApp(s => s.settings.reducedMotion)` and `useApp(s => s.settings.fx)` (`'high' | 'low' | 'off'`) come from `../../app/store.ts`. **Honor them**: no screen shake or large motion when reduced, and fewer particles when fx is low or off.
- Persistence (presets, car designs, custom packs, saves): `import { persistence } from '../../persistence/index.ts'`, then `persistence().listPresets(kind)`, `savePreset(kind, name, data)`, `loadDoc(key)`, `saveDoc(key, data)`. It works with or without Supabase.
- Phaser 4 (`import Phaser from 'phaser'` or `import * as Phaser from 'phaser'`, whichever the typings support). Import it **only inside your game folder** so it code-splits. Create the game in a `useEffect` and destroy it on unmount (`game.destroy(true)`). Remove every listener and room subscription. Keep per-frame data out of React state.
- Accessibility: every control is a real `<button>` or `<input>` with a label, focus is visible (global styles handle it), and meaning is never carried by colour alone (add text or icons). Touch targets are ≥ 40px.
- Responsive: design deliberately for 1920×1080, laptop, tablet (portrait and landscape) and phones (390×844 portrait and landscape). No horizontal scrolling. Respect safe areas (`var(--safe-*)`). Games that prefer landscape may show the `.dc-rotate-hint` banner but must still work in portrait and keep navigation reachable.
- Use React for text and UI. **Never** use `dangerouslySetInnerHTML`. User text is sanitized on the server (`cleanText`, `maskProfanity`, `cleanNickname`) and escaped by React.

## 5. Tests you must write

1. **Engine unit tests** (Vitest) covering every rule and edge case in the spec.
2. **Server integration test** `apps/game-server/test/<id>.test.ts`: boot with `bootTestServer(['<id>'])` (loads only your room), create a room with `colyseus.sdk.create('<id>', { name })`, join a second client with `colyseus.sdk.joinById(code, {...})`, start via `lobby:start`, then play meaningful actions. Cover:
   - state after meaningful actions;
   - private-message isolation: spectators and other players must **not** get private payloads;
   - rejection of invalid, out-of-turn and spectator actions;
   - duplicate messages never scoring twice;
   - disconnects never stalling the room;
   - reconnect restoring private state;
   - `reportOutcome` at each ending.

   See `apps/game-server/test/base-room.test.ts` for patterns (`collect`, `waitFor`, `quiet`), `party-kit.test.ts` for party wiring, `classicsBot.ts` for verified runs, and `tournament-helpers.ts` for tournament matches.
3. **E2E smoke** `e2e/<id>.spec.ts` using `e2e/helpers.ts` (`createRoom`, `joinRoom`, `startGame`, `roomState`, `waitForPhase`, `leaveRoom`): load, create, join a second player (where applicable), start, perform a meaningful action, and leave. Give your interactive elements stable accessible names so tests can use `getByRole`. `window.__DASCADE__.getState()` exposes the synced state for assertions. It must pass on the `chromium`, `mobile` (Pixel 7) and `mobile-safari` (iPhone 14) projects. The full matrix also runs `firefox` and `webkit`.
4. **Party games:** a 30-client protocol scenario in `scripts/load/<id>.ts` built on `scripts/load/helpers.ts` (`waitForStage`, `burst`, `timeUntil`, `leaked`, `errorCount`, `allConnected`). `scripts/load/index.ts` discovers it. Run it with `LOAD_URL=http://localhost:<port> LOAD_SCENARIOS=<id> pnpm load` against a server started with `DASCADE_RELAXED_LIMITS=1`.

Run just your tests: `pnpm vitest run packages/game-core/src/<id> apps/game-server/test/<id>.test.ts`.
Typecheck your files: `pnpm -C apps/web exec tsc --noEmit -p . | grep games/<id>` (and similarly for game-server and packages) when other work is in progress. Otherwise run `pnpm typecheck`.

## 6. Kits

Kits are shared by design: extend them additively (new optional props or hooks, with tests) instead of copying them into a game. If you override a lifecycle hook that a kit room implements, **call `super.<hook>(...)` first**.

### Party kit (DAStravaganza: trivia, deception, masterpiece, words, survey)
- **Shared** `@dascade/shared/party`: `PARTY_LIMITS`, team palette (`PARTY_TEAMS`, `partyTeamsFor`), `PARTY_MSG.host` (`party:host` pause/resume/skip), generic payloads (`PartyVoteSchema`, `PartyTextAnswerSchema`…, all carrying `seq`) and `PARTY_REASON_TEXT`. Your public state extends `PartyPublicView`:
  - `stage`, `stageSeq`, `stageMs`, `paused`;
  - `round` / `totalRounds`;
  - `seats[id]` (answered, eligible, teamId, delta, rank, streak), which says **whether** someone answered, never **what**;
  - `teams`, `scoreSeq`, `podiumJson`.
- **Pure** `@dascade/game-core/party`:
  - `AnswerBox`: one lock-in per player, idempotent duplicates.
  - `VoteBox`: private until the reveal, no self votes where disallowed, ranked ballots, tie rules `share`, `none`, `first` and `random`.
  - Scoring helpers: `speedBonus`, `streakBonus`, `rankStandings`, `placementGroups`, `closestWins`.
  - Teams: `assignTeams`, `balanceTeams`, `teamTotals`.
  - Answer matching: `normalizeAnswer`, `matchAnswer` (typo tolerance), `parseNumberAnswer`.
  - `anonymize` gives opaque keys for anonymous entries.
- **Server** `rooms/party/PartyRoom.ts` (`class MyRoom extends PartyRoom<MyState, MySettings>`, with state from `PartyRoomState.extend(...)`):
  - Stage machine: `runStage(stage, ms, onEnd)`, `finishStage()`, `endStageSoon()`, host pause/resume/skip (`skippableStages`), and an auto-resume after `maxPauseMs`. A skip carries the `stageSeq` the host is looking at (the kit's `HostBar` sends it); a stale skip is ignored, so a double tap never skips two stages. While paused nothing locks in: the kit's submit/lock helpers refuse, and handlers with their own collectors call `refuseWhilePaused(player, type)`. Resuming re-checks "everyone answered" (games with other completion checks re-run them in a `resumeStage()` override, calling `super` first).
  - Collection: `openAnswers()` / `openVote()`, or custom collectors via `track()`; `submitAnswer` / `submitVote` with friendly rejections. A stage ends early when every present eligible player has locked in. With `lateJoinersCanAnswer`, late joiners **and** seated players who were offline when the prompt opened may still answer it — for `openAnswers()`/`openVote()` without an explicit eligible list and for custom collectors that implement `addEligible()`; an explicit list stays fixed.
  - Private mailbox: `sendPrivate(player, type, payload)` is re-sent on reconnect, and spectators only receive it if you opt in.
  - Teams: `setupTeams`; late joiners go to the smallest team.
  - Scores: `addPoints` → `commitScores()` (deltas, ranks, team totals, `scoreSeq`).
  - `finishParty({ details?, extras?, placements? })` writes the podium, calls `reportOutcome` and `endMatch`. Pass `placements` for results that aren't score-ordered, such as hidden teams. Players who left mid-match are appended as the last place of the reported outcome (the podium lists only who's still there).
  - **Anonymous votes where some players can't vote:** don't `track()` per-seat flags, because a seat that never answers identifies the author. Show only an aggregate count.
- **Client** `games/_party/`:
  - `PartyStage`, `PartyTopBar`, `PromptCard`, `TimerBar` / `StageTimer`, `HostBar`, `PausedBanner`, `RulesDrawer`, `Interstitial`;
  - `AnswerGrid`, `TypedAnswer`, `AnsweredStrip` (who answered, never what), `VoteGrid`;
  - `Leaderboard` (animated reveal keyed on `scoreSeq`, `dense` for side columns), `TeamBoard`, `PartyResults`, `Confetti`;
  - hooks `usePartyGame`, `useStageTimer`, `useLatestPrivate`, `usePartyFx`.

  Trivia (`rooms/trivia`, `games/trivia`) is the reference integration, and `test/party-kit.test.ts` (fixture `test/fixtures/PartyKitRoom.ts`) exercises every feature.

### Boardroom kit (two-player board games: chess, checkers)
- **Shared** `@dascade/shared/games/boardroom`:
  - Settings: spread `BOARD_SETTINGS_SHAPE` / `DEFAULT_BOARD_SETTINGS` into your settings: `timeControl` (0 = untimed, presets `CLOCK_PRESETS`), `sides` (`random` / `host_first` / `host_second`), `rated` and `allowUndo`.
  - Public state extends `BoardRoomView`: `seats[2]` with rating and away deadline, `turn`, `ply`, `clock`, `offers`, `result`, `rated`, `undoAllowed`, and the idle-rule timestamps.
  - Sides are generic: `'first'` moves first (White in chess, Dark in checkers).
- **Server** `rooms/boardroom/BoardGameRoom.ts`:
  - Implement `sideName(side)` and `onBoardSetup()` (start position).
  - Register your move handler in `onBoardCreated()` as `const side = this.guardTurn(p, this.msg('move'), ply)` → validate with your engine → apply → `this.completeTurn(side)` → `this.finish({ winner: 'first' | 'second' | 'draw', reason })` when the rules end the game.
  - Optional: `supportsUndo` + `takeBack(plies)`, `canWinOnTime` (e.g. mating material), `resultDetails`, `onBoardEnd`, `onBoardReset`.
  - Kit messages `<id>:resign`, `<id>:draw`, `<id>:undo`, `<id>:rematch`, `<id>:claim` (and the server's `<id>:boardEvent`) are handled for you.
  - The kit owns:
    - the server clock (Fischer increment; flag detection on the server clock with a 150 ms grace);
    - draw offers, and take-backs (casual and unrated only, executed after the opponent accepts);
    - rematch with sides swapped;
    - the untimed idle rule: after 5 minutes the waiting player may claim the win, and after 20 minutes the idle side forfeits;
    - abandonment after the reconnect grace; leaving mid-game forfeits;
    - rating deltas.
  - Test hooks: `clockOverride`, `untimedClaimMs` and `untimedForfeitMs` on the room instance.
- **Client** `games/_boardroom/` (import `../_boardroom/boardroom.css`):
  - `SquareBoard`: a controlled board with coordinates, drag-and-click moves, legal-target dots, last-move paths, check and premove highlights, flip, multi-hop animation and a roving-tabindex keyboard. Every square is a `button[data-sq]`.
  - `PlayerCard`, `BoardClock` (driven by rAF with no re-renders), `MoveList`, `BoardActionBar`, `ResultBanner`.
  - `BoardSettingsFields` (read-only in tournaments), `useBoardroom`, `boardSounds` / `useBoardEventSounds`.
  - Board colours are CSS vars on `.br-board` (`--br-light`, `--br-dark`, …).

### Classics kit (DAScade Classics: paddle, snake, bricks, asteroids, memory, blocks)
- **Shared** `@dascade/shared/games/classics`:
  - `CLASSICS` constants (60 Hz, run caps, lag limits);
  - `CLASSICS_MSG` (`start`, `quit`, `rematch`, `input`, `run`, `ack`, `verdict`, `event`);
  - public `standings` + `classics` meta, `RunSummary`, and high-score types.
- **Pure** `@dascade/game-core/classics/shared`: fixed-step helpers, the deterministic math (`DIRS`, `dirVec`, `isqrt`…), the `ClassicsSim` contract, input logs, `ByteWriter` / `ByteReader`, `IntentQueue` (credit-limited real-time input) and `intentBits`.
- **Server** `rooms/classics/`. `ClassicsRoom` provides standings, **instant solo** (the room stays in PLAYING: instructions → `classics:start` → run → game over → Retry), the multiplayer match flow (entrants, the same content for everyone, placements via `matchPlacements()`, `reportOutcome`, rematch) and verified high scores (`playerFinished(id, summary, reason)` records them when `boardKey()` is non-empty). There are two authority models:
  1. **Server-driven** (paddle, snake, asteroids, memory): subclass `ClassicsRoom` and implement `statLabel`, `boardKey()`, `beginSoloRun`, `prepareMatch` and `abortRun`. Real-time games run a fixed-step sim on the server, feed per-player `IntentQueue`s from a silent `<id>:input` handler, and broadcast binary snapshots. Memory Matrix instead generates patterns with the room's RNG and judges every tap on the server clock.
  2. **Locally simulated, server-verified** (bricks, blocks): subclass `VerifiedClassicsRoom` and implement `createSim(seed, options)` (the same factory the client uses), `maxInputCode`, `statLabel` and `boardKey()`. The kit issues seeds and tickets, replays every input batch, enforces wall-clock, flood and lag caps, resumes after reconnect and issues the verdict. Engine rule: `over` may only become true inside `step()`. `input()` returns false only for codes outside the game's code space.

  High scores are served by `GET /api/classics/scores/:gameId?board=<key>`.
- **Client** `games/_classics/` (import `../_classics/classics.css`; module flags `immersive: true, ownCountdown: true`):
  - `ClassicsShell` (framed screen, header, pause, help);
  - cards: `InstructionsCard`, `CountdownCard`, `PauseCard`, `GameOverCard`, `ClassicsResults`;
  - HUD pieces and `createHudStore` / `useHud` for per-frame values;
  - input: `IntentInput` (keyboard, gamepad, touch), `TouchDeck`, `DPad`, `TouchButton`, `TouchStick`, `useGestures`;
  - loop and canvas: `useFixedLoop`, `useCanvasSurface`, `drawBlock`, and `Particles` / `Shake` (these honour fx and reduced motion);
  - `classicSfx`;
  - model 1 plumbing: `InputPump`, `subscribeBytes`, `SnapshotBuffer`;
  - model 2 in one hook: `useVerifiedFlow` + `verifiedOverlay`.

  `BricksPlay.tsx` is the reference for model 2. The test bot is `test/classicsBot.ts`, and the E2E helpers are `e2e/classics-helpers.ts`.

## 7. Running locally

Load only the rooms you need (`DASCADE_ONLY_GAMES`), so unrelated work in progress can't take down your server. Use your own ports and caches when several servers run on one machine:
```
DASCADE_ONLY_GAMES=<id> PORT=<server> DASCADE_RELAXED_LIMITS=1 pnpm --filter @dascade/game-server dev   # game server
VITE_CACHE_DIR=node_modules/.vite-<id> WEB_PORT=<web> VITE_SERVER_PORT=<server> pnpm --filter @dascade/web dev     # Vite
E2E_BASE_URL=http://localhost:<web> E2E_OUTPUT=test-results/<id> pnpm exec playwright test e2e/<id>.spec.ts --project=chromium
```
Tournament games also need the kiosk: `DASCADE_ONLY_GAMES=tournament,<id>`. For screenshots and visual QA, write throwaway Playwright scripts in `.scratch/` (git-ignored, and able to import `@playwright/test`). **Look at the images**: desktop, tablet, and phone in portrait and landscape. `tsx watch` does not reload on edits under `packages/*`, so restart your server after engine changes.

## 8. Gotchas

- In bash heredocs, `\uXXXX` escapes can get mangled into literal characters. In regexes, use `\u{XXXX}` with the `u` flag, or `String.fromCharCode`.
- `t.number()` without `.default(0)` breaks arithmetic, because it's undefined, which becomes NaN.
- `t.number()` sends non-integers as float32. Use `t.float64()` when precision matters, such as shared animation angles and timestamps.
- Schema `toJSON()` turns MapSchema into a plain object keyed by id and ArraySchema into an array.
- The client state is `null` until the first patch arrives. Handle it.
- `phaseEndsAt` and other absolute times are **server epoch ms**. Compare them against `serverNow()`, never `Date.now()`.
- Don't block the server event loop. Keep per-tick work O(players).
- Outside dev mode, Colyseus **disconnects a client that sends an unregistered message type**. Only send types your room registers with `this.handle()` (kit rooms register theirs), and don't send game messages before you're in that game's room.
- A CSS custom property resolves where it is declared. A `:root` token that mentions `var(--accent)` uses the root accent, not your game's. Write `color-mix(in srgb, var(--accent) 40%, transparent)` in your own rule instead.
- Anonymous features leak through structure too. Seat flags, counts with a per-player denominator, message timing and author-derived ids can all reveal who wrote or voted what. Use opaque random keys (`anonymize`) and aggregate counts.
- Test/debug hooks, such as stacked decks or scene jumps, must be gated on `process.env.NODE_ENV !== 'production'` **and** an explicit opt-in env var. They must never be reachable from a client payload alone.
