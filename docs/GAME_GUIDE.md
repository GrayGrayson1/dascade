# Building a DASCADE game

This guide describes the contract each cabinet follows. Read it all before you touch a game. The shared platform code (the base room, lobby, session, hooks and design system) is **owned by the platform**. Build *on* it and don't fork it.

## 0. Where your code goes

For a game with id `<id>` (see `packages/shared/src/catalog.ts`):

| What | Path | Notes |
|---|---|---|
| Shared contract | `packages/shared/src/games/<id>.ts` | Settings Zod schema + defaults, message names, payload schemas and public types. Imported by both server and client. |
| Pure engine | `packages/game-core/src/<id>/` (`index.ts` + `*.test.ts`) | Pure TypeScript: no Colyseus, no DOM. Deterministic with an injected `Rng`. **Heavily unit tested.** |
| Server room | `apps/game-server/src/rooms/<id>/<Name>Room.ts` (+ schema file) | Extends `BaseGameRoom`. Replace the STUB file. |
| Server tests | `apps/game-server/test/<id>.test.ts` | Integration tests using the helpers in `test/helpers.ts`. |
| Client module | `apps/web/src/games/<id>/index.tsx` (+ any files in that folder) | Default-export a `GameClientModule`. Replace the STUB. |
| Client styles | `apps/web/src/games/<id>/<id>.css` | Imported from your module. Prefix classes with your id (e.g. `.sk-`, `.bj-`). |
| E2E smoke | `e2e/<id>.spec.ts` | Playwright, using `e2e/helpers.ts`. |

**Do not edit** `BaseGameRoom.ts`, `schema/base.ts`, `apps/web/src/net/*`, `apps/web/src/shell/*`, `packages/ui/*`, `packages/shared/src/{protocol,catalog,...}.ts`, root configs or `package.json` files. If the platform is missing something you truly need, first work around it inside your own folder. If that's impossible, describe the platform change you need in your final report. Don't add npm dependencies. Everything should be procedural (Canvas/SVG/CSS/Phaser graphics/WebAudio).

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
- Import shared code as `@dascade/shared` and game-specific code as `@dascade/shared/games/<id>`. The package exports `./*` as `./src/*.ts`, so `@dascade/shared/games/wheel` resolves to `src/games/wheel.ts`.

## 2. Pure engine (`packages/game-core/src/<id>/`)

- Put all rules here: dealing, evaluation, settlement, validation, scoring, physics, content graphs.
- Take an `Rng` (`import type { Rng } from '@dascade/shared'`) as a parameter and never call `Math.random()`. Tests use `createSeededRng(seed)` and the server passes its crypto RNG.
- Import it as `@dascade/game-core/<id>`. The package exports `./*` as `./src/*/index.ts`.
- Shared card primitives are in `@dascade/game-core/cards` (`Deck`, `createDeck`, `createShoe`, `parseCard`, `cardToCode`, and more). Cards travel as 2-char codes such as `"As"` and `"Td"`.
- Write thorough Vitest tests next to the code (`*.test.ts`). The root `vitest.config.ts` already includes `packages/*/src/**/*.test.ts`.

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
- A JSON string field is fine for complex data that changes rarely, e.g. `nodeJson: t.string()`.
- **Hidden information never goes in state.** That includes hole cards, the deck, the dealer hole card, the secret word, other players' bingo cards, RNG seeds before reveal, and future race inputs.

### Messages
- Register **every** client→server message with `this.handle(type, zodSchema, handler, opts)`. It resolves the `PlayerRecord`, rate-limits (`opts.rate`, default `RATE.action`; see `RATE` in `@dascade/shared`), validates with Zod, checks `opts.phases`, `opts.hostOnly` and `opts.playersOnly`, and catches handler errors.
- Use `opts.silent: true` for high-frequency streams (drawing points, racing input) so rejected packets don't trigger error replies.
- **Never trust ids in payloads.** The acting player is always `player` (the resolved record). Check turn order, eligibility and balances inside the handler, then `this.reject(player, type, 'not_your_turn', 'Human readable')` to refuse.
- Handlers must be **synchronous** with respect to game state. Colyseus processes one message at a time, so synchronous handlers can't interleave. If you must `await`, re-check phase and state afterwards.

### Private information
- `this.sendTo(player, '<id>:private', payload)` sends to one player. Spectators and other players never receive it.
- Implement `protected override syncPrivate(player)` to (re)send **everything** that player should currently see. The base calls it after join, reconnect and seat-token rejoin, so reconnecting players get their hole cards, word choices, bingo card and so on back. On the client, read it with `useLatestMessage('<id>:private')`, which replays the last payload.
- Broadcast public events with `this.broadcast('<id>:event', payload)` for animations (spin results, deals). Keep the state the source of truth for anything a late joiner needs.

### Lifecycle hooks (override what you need)
`onRoomCreated(options)`, `onGameStart()` (required), `onPlayerJoined(p, {lateJoin})`, `onPlayerDisconnected(p)` (transient drop), `onPlayerReconnected(p)`, `onPlayerAway(p)` (grace expired mid-match; seat kept), `onPlayerRemoved(p, reason)` (left, kicked or disconnected; gone for good), `onHostChanged(next, prev)`, `validateStart()` (return a reason string to block), `onSettingsChanged(prev, next)`, `onReturnToLobby()` (reset all game state here), `syncPrivate(p)`, `interceptChat(p, text)` (return true to consume, as DASketch does for guesses), `onRoomDisposed()`.

Helpers: `this.setPhase(phase, durationMs?)` publishes `phaseEndsAt` (server epoch ms); `this.setTimer(ms)`; `this.endMatch({ players: [...summary] })` moves to RESULTS and records stats; `this.returnToLobby()`; `this.promoteQueued()` seats queued late joiners between rounds or hands; `this.schedule(key, ms, fn)`, `this.cancel(key)` and `this.clearAllTimers()` give you named timers that are cleaned up automatically; `this.seatedPlayers()` returns non-spectators including disconnected ones; `this.activePlayers()` returns connected non-spectators; `this.players` is the `Map<id, PlayerRecord>`; `this.rng` is a **crypto RNG, so use it for anything that decides outcomes**; `this.toast(player | 'all', kind, text)`; `this.systemChat(text)`; `this.isHost(player)`; `this.getSettings()`; `this.updateSettings(next)` lets game code mutate settings (for example, removing a wheel winner).

Phases: `LOBBY → COUNTDOWN (3s, automatic on host Start) → PLAYING ↔ INTERMISSION → RESULTS → (host "Play again") LOBBY`. `ENDED` means the room is closing. Set `countdownMs = 0` to skip the countdown. The client shows a shared 3-2-1 overlay unless your module sets `ownCountdown: true`.

Spectators: `player.state.spectator` is true for spectators. They must never act. Use `playersOnly: true` or check it yourself. Late joiners in games where `lateJoinAsPlayer === false` arrive as spectators with `queued = true`.

Disconnects: during PLAYING, a dropped player's record stays put (`connected = false`). Games with turns must not stall. Skip, auto-fold or auto-stand disconnected or away players after a timeout, and always keep a turn timer.

Solo mode: `this.isSolo` is true when the room was created with `{ solo: true }` (the room is locked, max 1 player). If your game supports solo play, consider calling `this.startMatch()` from `onPlayerJoined` for instant play.

## 4. Client module

```tsx
// apps/web/src/games/wheel/index.tsx
import type { GameClientModule } from '../types.ts';
import './wheel.css';
const module: GameClientModule = { GameView: WheelView, SettingsPanel: WheelSettingsPanel, PlayerSetup?, lobbyPhases?, immersive?, ownCountdown?, musicMood? };
export default module;
```
- **GameView** renders for every phase except LOBBY (COUNTDOWN, PLAYING, INTERMISSION, RESULTS). Wrap it in `<GameStage gameId="wheel">` from `../../shell/common.tsx`, which applies your accent theme and backdrop. It sits under the shared 56px top bar, or fills the screen with a floating menu if `immersive`.
- Hooks from `../../net/hooks.ts`:
  - `useGame<MyState, MySettings>()` returns `{ state, phase, settings, playerId, me, isHost, isSpectator, players, seated, send, serverNow }` (or null before the first state).
  - `useRoomSelector(s => s.someField)` re-renders only when the selected value changes. Prefer it for big or high-frequency states.
  - `useRoomMessage(type, handler)` handles event messages (animations, sounds).
  - `useLatestMessage<T>(type)` gives you the latest private or state-like message (replayed on mount).
  - `useCountdown(state.phaseEndsAt)` returns ms remaining against the synced server clock.
  - `session.send(type, payload)`; `session.room` is the raw Colyseus room, for Phaser scenes that want to read `room.state` directly without React.
- **SettingsPanel** gets `{ settings, canEdit, update(patch) }`. Render read-only when `!canEdit`. **Debounce** text inputs (about 400ms) before calling `update`, because settings messages are rate-limited to 5/s.
- **PlayerSetup** is per-player lobby setup (car builder, hero pick). It sends its own game messages.
- Results screens: use `<ResultsActions />` from `../../shell/common.tsx`. It gives the host a Play Again button and everyone a Leave button.
- Chat: `<ChatPanel />` (shared chat log) takes an optional `onSend` override and `renderMessage`.
- UI kit: `import { Button, IconButton, Panel, Modal, Field, TextInput, TextArea, Select, NumberInput, Toggle, Slider, Segmented, Tabs, Badge, Kbd, Spinner, ProgressBar, TimerRing, EmptyState, Avatar, PlayerChip, ColorSwatches, PixelIcon, PixelArt, PlayingCard, CardBack, CasinoChip, ChipStack, chipBreakdown, GameTheme, cx } from '@dascade/ui'`. Look at `packages/ui/src/components/*.tsx` and `packages/ui/src/styles/*.css` (tokens: `--accent`, `--accent-2`, `--bg-*`, `--text-*`, `--font-display` (pixel), `--font-pixel` (tiny caps), `--font-ui`, `--font-tech` (numbers), `--glow-*`, `--sp-*`). Icons are listed in `packages/ui/src/icons.ts`. Your own pixel art can use `<PixelArt rows={[...]} />`.
- Audio: `import { sfx, synth, music } from '../../audio/audio.ts'`. Call `sfx('card' | 'chip' | 'spin' | 'win' | ...)`. `synth.tone({...})` and `synth.noise({...})` are available for custom sounds. Never autoplay before a user gesture (handled for you).
- Settings: `useApp(s => s.settings.reducedMotion)` and `useApp(s => s.settings.fx)` (`'high' | 'low' | 'off'`) come from `../../app/store.ts`. **Honor them**: no screen shake or large motion when reduced, and fewer particles when fx is low or off.
- Persistence (presets, car designs, saves): `import { persistence } from '../../persistence/index.ts'`, then `persistence().listPresets(kind)`, `savePreset(kind, name, data)`, `loadDoc(key)`, `saveDoc(key, data)`. It works with or without Supabase.
- Phaser 4 (`import Phaser from 'phaser'` or `import * as Phaser from 'phaser'`, whichever the typings support). Import it **only inside your game folder** so it code-splits. Create the game in a `useEffect` and destroy it on unmount (`game.destroy(true)`). Remove every listener and room subscription. Keep per-frame data out of React state.
- Accessibility: every control is a real `<button>` or `<input>` with a label, focus is visible (global styles handle it), and meaning is never carried by colour alone (add text or icons). Touch targets are ≥ 40px.
- Responsive: design deliberately for 1920×1080, laptop, tablet (portrait and landscape) and phones (390×844 portrait and landscape). No horizontal scrolling. Respect safe areas (`var(--safe-*)`). Games that need landscape (racing) may show the `.dc-rotate-hint` banner but must keep navigation reachable.
- Use React for text and UI. **Never** use `dangerouslySetInnerHTML`. User text is escaped automatically.

## 5. Tests you must write

1. **Engine unit tests** (Vitest) covering every rule and edge case in the spec.
2. **Server integration test** `apps/game-server/test/<id>.test.ts`: boot with `bootTestServer(['<id>'])` (loads only your room), create a room with `colyseus.sdk.create('<id>', { name })`, join a second client with `colyseus.sdk.joinById(code, {...})`, start via `lobby:start`, then play meaningful actions. Assert state, private-message isolation (spectators and other players must **not** get private payloads), rejection of invalid or out-of-turn actions, and reconnect restoring private state. See `apps/game-server/test/base-room.test.ts` for patterns (`collect`, `waitFor`, `quiet`).
3. **E2E smoke** `e2e/<id>.spec.ts` using `e2e/helpers.ts` (`createRoom`, `joinRoom`, `startGame`, `roomState`, `waitForPhase`, `leaveRoom`): load, create, join a second player (where applicable), start, perform a meaningful action, and leave. Give your interactive elements stable accessible names so tests can use `getByRole`. `window.__DASCADE__.getState()` exposes the synced state for assertions.

Run just your tests: `pnpm vitest run packages/game-core/src/<id> apps/game-server/test/<id>.test.ts`.
Typecheck your files: `pnpm -C apps/web exec tsc --noEmit -p . | grep games/<id>` (and similarly for game-server and packages), since other games are being built in parallel.

## 6. Running locally while other agents also run servers

Use your assigned ports so you don't collide with anyone. Load only your game's room (`DASCADE_ONLY_GAMES=<id>`) so another cabinet's half-finished code can't take down your server:
```
DASCADE_ONLY_GAMES=<id> PORT=<server> pnpm --filter @dascade/game-server dev   # game server
VITE_CACHE_DIR=node_modules/.vite-<id> WEB_PORT=<web> VITE_SERVER_PORT=<server> pnpm --filter @dascade/web dev     # Vite
E2E_BASE_URL=http://localhost:<web> pnpm exec playwright test e2e/<id>.spec.ts --project=chromium
```
For screenshots and visual QA, write throwaway Playwright scripts in `.scratch/` (git-ignored, and able to import `@playwright/test`). Save the images to the scratchpad and **look at them** with the Read tool. Check desktop and mobile.

## 7. Gotchas

- In bash heredocs, `\uXXXX` escapes can get mangled into literal characters. In regexes, use `\u{XXXX}` with the `u` flag, or `String.fromCharCode`.
- `t.number()` without `.default(0)` breaks arithmetic, because it's undefined, which becomes NaN.
- `t.number()` sends non-integers as float32. Use `t.float64()` when precision matters, such as shared animation angles and timestamps.
- Schema `toJSON()` turns MapSchema into a plain object keyed by id and ArraySchema into an array.
- The client state is `null` until the first patch arrives. Handle it.
- `phaseEndsAt` and other absolute times are **server epoch ms**. Compare them against `serverNow()`, never `Date.now()`.
- Don't block the server event loop. Keep per-tick work O(players).
- Outside dev mode, Colyseus **disconnects a client that sends an unregistered message type**. Only send types your room registers with `this.handle()`, and don't send game messages before you're in that game's room.
- Test/debug hooks, such as stacked decks or scene jumps, must be gated on `process.env.NODE_ENV !== 'production'` **and** an explicit opt-in env var. They must never be reachable from a client payload alone.
