# Theming DASCADE

DASCADE ships **twelve themes**. Delta Neon (`delta-neon`) is the default and the house style; the
others (Shareware Casino '97, Corporate Desktop '98, Cyber Café 2001, Mall Arcade '92, VHS After Dark,
Space Casino 2088, Basement LAN Party, Saturday Morning, Executive Edition, Neon Noir, and the seasonal
Halloween Night) restyle the
**whole** arcade: floor, cabinets, pickers, title screens, lobbies, dialogs, Tournament Center, results,
the jukebox, game chrome and playfield materials.

Themes are **presentation only** and **local**. They never touch rules, scoring, networking, hidden
state, timers, tournaments, saves, ratings or anything server-side, and they are never synchronized to a
room: two players in the same room can use different themes.

## Architecture: data + skin

A theme has two halves.

| Half     | Where                                  | Loaded                              | What it holds                                                                                                                 |
| -------- | -------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Data** | `packages/ui/src/theme/themes/<id>.ts` | eagerly (small)                     | `ThemeDefinition`: tokens, overrides, renderer palette, **materials**, per-game materials, **effects**, **copy**, picker meta |
| **Skin** | `apps/web/src/themes/<id>/`            | lazily: one chunk per theme, cached | `skin.css` (structural restyling) + optional `Environment`, `FloorDecor`, `JukeboxDecor` components                           |

```
packages/ui/src/styles/tokens.css        token layers; its :root values ARE Delta Neon
packages/ui/src/theme/tokens.ts          token contract (required / optional / derived / foundation)
packages/ui/src/theme/materials.ts       MATERIAL_GROUPS / ThemeMaterials / ThemeEffects / DEFAULT_EFFECTS
packages/ui/src/theme/copy.ts            THEME_COPY_KEYS (themed headings & flavour)
packages/ui/src/theme/registry.ts        BUILT_IN_THEMES, validateTheme, getTheme (unknown → Delta Neon)
packages/ui/src/theme/apply.ts           applyTheme(id): html[data-theme] + generated CSS + theme-color
packages/ui/src/theme/read.ts, react.ts, watch.ts   readThemeTokens / useThemeTokens / subscribeThemeTokens / watchThemeTokens
apps/web/src/themes/registry.ts          lazy skin loader (loadThemeSkin, useSkin, loadThemeSkinWithin)
apps/web/src/themes/ThemeHost.tsx        environment layer, floor-decor slot, transition overlay, quick picker
apps/web/src/themes/switcher.ts, controller.ts   switchTheme(id): load → cover → apply → reveal
apps/web/src/themes/ThemePicker.tsx      picker (Settings → Display + quick sheet), live previews (preview.ts)
apps/web/src/themes/copy.ts, ThemedText.tsx      useThemeCopy / useThemeFlavour / <ThemedText>
apps/web/src/themes/place.ts             place detection (floor/cabinet/entry/lobby/game/tournament/other)
apps/web/src/themes/cssScope.ts          skin.css scoping lint (skins.test.ts)
apps/web/src/app/settings.ts             settings.theme + versioned, fail-safe migration
```

### Boot and switching

0. `index.html` loads `/boot-theme.js` (a tiny classic script in `apps/web/public/`) before the app:
   it reads the stored theme id and sets `data-theme`, the page background and `theme-color`, so even
   the very first paint (and a phone's browser chrome) is in the right colours. Its small id → colours
   map must match the theme definitions (`themes/boot-theme.test.ts` fails until it does).
1. `main.tsx` calls `applyDocumentSettings()` before React renders: the stored theme id is read
   synchronously (`peekStoredTheme`) and `applyTheme()` injects its token CSS, so tokens never flash.
2. It then waits for the stored theme's **skin** chunk — at most **800 ms** (`loadThemeSkinWithin`) —
   before the first render, so structure doesn't flash unskinned on a normal connection.
3. `switchTheme(id)` (picker, `window.__DASCADE_THEME__.switchTheme`) loads the target skin first, covers
   the screen with the target theme's `effects.transition` (cover 300 ms), applies the theme while
   covered (`updateSettings({ theme })` → localStorage + Supabase profile when signed in), waits two
   frames and reveals (360 ms). Reduced motion or fx MINIMAL → a 150 ms fade. Rapid switching retargets
   the one running transition — overlays never stack. Nothing remounts (no React keys on routes), and the
   session, room, jukebox and music are never touched.
4. Unknown or removed ids render Delta Neon (tokens and skin) while the stored preference is kept.

The transition overlay is a manual **popover** (top layer, above open dialogs), `pointer-events: none`.
Styles implemented: `power` · `boot` · `shutter` · `fluorescent` · `tracking` · `warp` · `crt-off` · `wipe`
· `haunt` (the screen dims once while a friendly ghost swoops across) · `fade`; each tints itself from the
target theme's `meta.swatches`. `themes/engine.test.ts` checks every style has rules in `host.css`.

## Layering

```
<body>            background: var(--page-bg)                  (canvas, bottom)
#root             isolation: isolate
  .theme-env      fixed, inset 0, z-index -1                  ← skin Environment   [data-part=theme-environment]
  screens         floor / title / picker / room / tournament  (paint above the environment)
    floor:  .af-room (pixel room)  →  [data-part=floor-decor]  →  HUD / carousel / plaque
  top bar 50 · overlays 100 · modals 200 · toasts 300          (--z-* foundation tokens)
  .theme-xfade    top-layer popover (z 10000 fallback)        ← transition overlay
```

Screens paint their own backdrops. To let an Environment show through, a theme makes them translucent:

| Screen                                   | Token / hook                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Arcade floor                             | `--arcade-floor-bg` (required token) + `arcadeRoom: 'hide'` on the ThemeSkin (skips Delta Neon's pixel room and its render loop) |
| Cabinet title                            | `--entry-backdrop` (optional override)                                                                                           |
| Cabinet picker                           | `--picker-backdrop` (optional override); the per-cabinet world art (`.cpb > *`) can be toned via skin CSS                        |
| Game stages                              | `--game-backdrop` (optional override)                                                                                            |
| Lobby, Tournament Center, loading, error | already transparent over the page                                                                                                |

`<html data-place="…">` mirrors the current place, so skin CSS can react:
`:root[data-theme='x'][data-place='game'] …`. Environments get `place` as a prop and must calm down
when `place === 'game'`.

## Token layers

| Layer          | Examples                                                                                                                                    | Themed?                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Foundation** | `--fs-*`, `--sp-*`, `--z-*`, `--topbar-h`, `--safe-*`, `--content-max`                                                                      | Never. Games lay out identically in every theme.                                                                            |
| **Palette**    | `--bg-0…5`, `--glass*`, `--line*`, `--text-0…3`, neon hues, `--shade`, `--light`                                                            | Yes.                                                                                                                        |
| **Semantic**   | page, typography, shape, shadows, surfaces, windows/panels, buttons, controls, shell, HUD, cabinet, marquee, textures, glow & motion inputs | Yes. Roles, not colours.                                                                                                    |
| **Optional**   | `--button-primary-*`, `--control-accent`, `--game-backdrop`, `--entry-backdrop`, `--picker-backdrop`…                                       | Fixed-value replacements for accent-following recipes (`OPTIONAL_THEME_TOKENS`). Never reference `var(--accent)` in them.   |
| **Derived**    | `--glow-sm/md/lg`, `--text-glow`, `--scanline-opacity`, `--render-glow`, `--render-scanlines`, `--dur-*`                                    | Never set by a theme; scaled by fx (`html[data-fx]`) and reduced motion from the `*-full` / `*-soft` / `--motion-*` inputs. |
| **Materials**  | `--mat-felt`, `--mat-board-light`, `--mat-water`, `--mat-grass`, `--mat-asphalt`, `--mat-card-face`…                                        | Generated from `materials` (see below). Absent under Delta Neon.                                                            |

`applyTheme()` injects `:root[data-theme='<id>'] { … }` (plus per-game material rules) as
`<style id="dc-theme">`; Delta Neon needs none (its values are the `:root` defaults in tokens.css).

## Materials (playfield)

Chrome tokens restyle UI; **materials** restyle the playfield: felt and rails, board squares and pieces,
water/radar, grass/sand/hazards, sky/ground, asphalt/curbs, card faces/backs, paper, stage/podium,
screens/bezels, metal/LEDs (`MATERIAL_GROUPS`, ~50 keys). Every non-default theme defines **all** of
them (enforced by `validateTheme`); Delta Neon defines **none**, so every game keeps its own hand-tuned
palette there. A theme can nudge one game with `gameMaterials: { chess: { boardLight: '#…' } }`, emitted
as `:root[data-theme='<id>'] [data-game='chess'] { --mat-board-light: … }`. `<GameStage>` sets
`data-game` on every game (and the cabinet title screen carries it too).

### The adapter rule (everyone touching games)

- **DOM/CSS**: replace hard-coded playfield colours with `var(--mat-<key>, <today's colour>)`. The
  fallback MUST be the exact current colour, so Delta Neon stays pixel-identical.
- **Canvas / Phaser**: `const m = tokens.materials; fill = m.boardLight ?? CURRENT_HEX;` and re-render on
  theme change. Missing materials are `undefined`, never a throw.
- **Chrome** (panels, HUD, buttons, text) uses the existing tokens (`--hud-*`, `--panel-*`, …).
- **Keep meaning**: accent colours, player/team/suit colours, piece identity, legal-move dots and danger
  zones stay distinguishable in every theme — themes restyle materials, not meaning.

```ts
import { readThemeTokens, useThemeTokens, watchThemeTokens } from '@dascade/ui';

// React: a ref inside <GameStage> → the game's accent and per-game materials are in scope.
const t = useThemeTokens(stageRef); // re-reads on theme / fx / reduced-motion change
ctx.fillStyle = t.materials.felt ?? '#0f5132';
ctx.shadowBlur = 16 * t.glow; // 0 when effects are MINIMAL

// Phaser / plain canvas: called now and on every change, coalesced to one call per frame.
const stop = watchThemeTokens(stageEl, (t) => scene.applyPalette(t));
this.events.once('shutdown', stop);
scene.cameras.main.setBackgroundColor(readThemeTokens(stageEl).int.background);
```

`ThemeTokens` carries `background`, `surface`, `text`, `textMuted`, `line`, `accent*`, status colours,
`gridAlpha`, fx-scaled `glow`/`scanlines`, `fx`, `reducedMotion`, font stacks, `materials`, `effects`
and `int` (0xRRGGBB for Phaser).

## Effects

`effects` (`ThemeEffects`, merged over `DEFAULT_EFFECTS`) are hints for renderers:
`surface` (glass/bevel/flat/plastic/wood/chrome/paper/felt), `crt`, `grain`, `analog` (transitions and
decorative screens only — never over a board), `ambient` (backdrop particles), `visualizer` (jukebox
drawing style) and `transition` (the switch animation). Every renderer must look fine at neutral values.

## Copy

`copy` renames a handful of **headings and flavour lines** (`THEME_COPY_KEYS`). Functional labels,
buttons, form labels, errors and accessible names stay plain.

```tsx
const t = useThemeCopy(); // t(key, fallback)
<ThemedText k="results.title" plain="Results" />; // themed text visible, plain text for AT and tests
const badge = useThemeFlavour('arcade.badge'); // optional slot: string | null (Delta Neon → null)
```

Slots wired today: `arcade.tagline` (under the floor logo), `arcade.badge`, `arcade.status` (floor
footer ticker; `|`-separated, placeholders `{cabinets}` `{rooms}` `{online}`), `cabinet.heading`,
`lobby.title`, `lobby.players`, `results.title` (kicker above `ResultsShell` titles), `tournament.title`,
`tournament.subtitle`, `settings.title`, `jukebox.title` (jukebox window), `state.loading`, `state.connecting`,
`state.error`.

## Skins

`apps/web/src/themes/<id>/index.ts` default-exports a `ThemeSkin` and imports `./skin.css`:

```ts
import './skin.css';
import type { ThemeSkin } from '../types.ts';
import { Environment } from './Environment.tsx';
export default { id: 'lan-party', Environment, FloorDecor, JukeboxDecor, arcadeRoom: 'hide' } satisfies ThemeSkin;
```

- **skin.css**: every selector starts with `:root[data-theme='<id>']` (or `:where(…)`/`:is(…)` of it),
  also inside `@media`/`@supports`/`@container`/`@layer`. `@keyframes`/`@property` names use `<id>-` or
  the theme's alias in `KEYFRAME_ALIASES` (`cssScope.ts`). No `@import`. Enforced by
  `apps/web/src/themes/skins.test.ts`, which also fails on keyframe name clashes. Because every rule is
  scoped, a loaded-but-inactive skin is inert, so skins are never unloaded.
- **Target stable hooks**, not hashed/implementation classes: `data-part="…"` attributes on the floor,
  carousel, cabinets (body/marquee/screen/control-panel), HUD, plaque, kiosk, picker, title screen,
  lobby, room code, player list/rows, top bar, results, dialogs, toasts, loading/error screens, Tournament
  Center, jukebox, game stages and playfields. The full list lives in the components (grep `data-part=`).
- **Environment** (`SkinRenderContext { fx, reducedMotion, place }`): full-viewport ambience, already
  `pointer-events: none` + `aria-hidden`. Pause when the tab is hidden (reuse `addFrameJob` from
  `apps/web/src/arcade/scheduler.ts`), static at fx MINIMAL / reduced motion, subtle in games.
- **FloorDecor**: rendered in the floor's `[data-part=floor-decor]` slot (over the room, under the
  carousel). **JukeboxDecor**: inside the expanded jukebox's now-playing screen.
- **The jukebox is a physical machine in every theme.** On the floor it stands at the left end of the
  cabinet row (`[data-dock=floor]`, `[data-part=machine-open]`, art classes `.jbf-*`, hover tag
  `[data-part=machine-tag]`), built like the cabinets: its body uses the theme's `--cabinet-*` tokens
  and its lights `--jb-accent` / `--jb-accent-2` (`--jbf-shade` sets how far it's dimmed with the far
  cabinets). Up close (the expanded player),
  the arched dome glass with the record (`[data-part=dome-glass]`, `[data-part=record]`) sits on top of
  the now-playing screen (`[data-part=display]`, which keeps whatever shape the skin gives it), with
  bubble-tube pillars (`.jb-pillar`), selector keys and title strips (`[data-part=track]`, one per
  song with its `data-code`) and a plinth (`[data-part=plinth]`). Its physical materials keep their own
  colours in every theme (chrome, black vinyl, cream strip paper and ink, the dark grille); tune them
  with `--jb-chrome-hi/-lo/-ink`, `--jb-vinyl`, `--jb-strip-bg/-fg/-muted/-lit/-band/-band-2` and the
  dome's `--jb-arch` rather than overriding colours on the parts. The quick control (`[data-part=mini-open]`,
  `[data-part=mini]`) is the small button in the floor HUD, top bar or shell menu.
- **The claw machine** stands at the right end of the row (`[data-part=claw-machine]`, `.clw-*`,
  `apps/web/src/arcade/claw.css`): body from `--cabinet-*`, marquee and trim from `--clw-accent` (set it on
  `.clw, .clwx`, where it's declared). Its close-up (`[data-part=claw-closeup]`, `.clwx*`, `clawCloseup.css`)
  uses the same tokens for its cabinet; the inside of the glass (the plushies, the claw) is fixed printed/lit
  art like the cabinets' screens — **except** that a skin may dress it in a costume (`ThemeSkin.claw`, below).
  Where the floor has no room for the machine, a quick Claw button (`[data-part=claw-quick]`) sits in the
  HUD or the phone extras row.
- **Keep the row's ends free for them.** On floors wide enough for the machines, the lineup carries
  `data-jukebox="floor"` / `data-claw="floor"`; a FloorDecor prop that would stand in the same spot steps
  aside with `:root[data-theme='<id>'] .af-floor:has(.af-lineup[data-claw='floor']) .<prop> { display: none }`
  (see Mall Arcade '92 and VHS After Dark), and still shows where the machines don't fit.
- Decor components are wrapped in an error boundary: a crash renders nothing instead of breaking the app.
- **Avatars** carry `data-avatar="<id>"` on `.dc-avatar` (no paint of its own), so a skin can dress them per
  kind with a pseudo-element (Halloween Night's hats). Keep it inside the avatar's width and hide it on tiny
  avatars; it's local decoration, nobody else sees it.
- **Wheel of DAStiny**: `--wh-pointer-1/-2/-3` (pointer gradient), `--wh-pointer-edge`, `--wh-pointer-glow`
  and `--wh-pin-1..3` recolour the pointer — set them on `.wh-pointer` (wheel.css's
  `:root[data-theme]:not([data-theme='delta-neon']) .wh` outranks `.wh`). The stage carries
  `[data-spinning='true']` while a spin runs and `[data-revealed='true']` while the result shows. Slice colours
  never theme.

### Optional data hooks: claw costume, celebration, sounds

A skin may also export plain data (no DOM, no state) that the app reads only while that theme is active
(`activeSkin()` / `useActiveSkin()` in `themes/registry.ts`). Leave a hook out and everything stays exactly as
it is in Delta Neon.

- **`claw?: ClawCostume`** (`apps/web/src/arcade/clawArt.ts`) dresses the claw machine's plushies and the inside
  of its glass: per kind, new sprite rows (**exactly** the base sprite's width × height and visible bounding box,
  letters `. a d e w k p`; only rows with a `w` blink, so keep mouths off eye rows), six colours/shades/lights,
  eye/pupil/cheek inks and a display name (lower case, no leading vowel, ≤ 10 characters: "You won a ghost
  plush!"); the close-up's case/wall/floor colours, neon, optional `webs`, a sign of ≤ 14 capitals (shrunk to fit),
  the floor machine's glass and plate/restock/floor-tag flavour. It is the same four kinds at the same sizes, so
  saved prize shelves (`dascade:v2:claw`), the pile and the physics never see it — never add kinds (a stored pile
  with an unknown kind is discarded, shelf included). The claw itself (chrome, grip tips, aim marks) and
  functional text ("INSERT TOKEN", miss reasons, the shelf count) stay fixed. `clawCostumeProblems()` validates
  a costume; invalid fields fall back to the machine's own art one by one.
- **`celebration?: SkinCelebration`** (`themes/celebration.ts`): `{ colors, sprites?, spriteShare? }` — confetti
  colours (`#rrggbb`, after the winner's own colour) and ≤ 12×12 pixel sprites with an `ink` map for Wheel of
  DAStiny landings and claw wins. Without it the built-in confetti runs with the same random sequence.
  `celebrationProblems()` validates it (`skinExtras.test.ts`).
- **`sounds?: SfxVoices`** (`audio/voices.ts`): see **Sounds** below.

### Sounds

A skin may re-voice `sfx()` names with recipes built only from the kit (`tone`, `noise`, `note`). They play on
the SFX bus, and `sfx()` still applies mute, volume, the rate limit and the jukebox dip exactly as for the
built-in sounds. Only the active skin's voices play (ThemeHost registers them); a theme switch never touches the
jukebox or music. Keep each voice's length, loudness and meaning close to the built-in sound, and leave quiet UI
chatter (hover, click, tick, message) and functional cues alone. Sounds games play directly through `synth` are
not re-voiced. QA: `window.__DASCADE_AUDIO__.voices()` lists the active theme's re-voiced names.

**Ambient sound** belongs to the Environment and plays on the floor only: after a gesture has unlocked audio,
with the tab visible, not muted, SFX and master volume above 0 and the jukebox not audible; on its own GainNode
on `synth.sfxBus`, every gain below 0.04 so it never dips or holds the jukebox; noise layers ≤ 0.9 s (the shared
noise buffer is 1 s and doesn't loop); timers, not animation frames; full clean-up when the place changes or the
component unmounts; nothing at module top touches the DOM.

### Halloween Night extras

- **Progressive haunting** (`halloween-night/haunt.ts`): by the player's local clock the hall is calm by day,
  spookier after dark (18:00–06:00) and peaks on Halloween night (Oct 31 until dawn on Nov 1) — more ghosts and
  bats, thicker fog, brighter jack-o'-lanterns, a peeking ghost and a candy bucket — always capped by fx and
  reduced motion (`hauntBudget`). One shared timer re-checks at 06:00 / 18:00 / midnight; nothing reads the
  clock per frame.
- **Avatar hats** (witch hat, pumpkin cap, bat bow by avatar kind) through `.dc-avatar[data-avatar]`.
- **`haunt` transition** into the theme; Creepster (`@fontsource/creepster`, OFL) only on a few big fixed titles
  through the skin's `--hn-spooky` (never on tokens, so buttons and body text stay in the house faces).

## Seasonal themes (Halloween Night)

Halloween Night (`halloween-night`) is a normal theme — in the picker all year — plus a small seasonal layer:
`themes/seasonal.ts` (pure logic with an injectable clock), `themes/seasonalController.ts` (wiring),
`SeasonalHost.tsx` and `ExitHalloween.tsx` (UI). Like every theme it is local and never reaches the server.

- **Invite:** in October (the device's local date) a floor-only `<aside data-part="seasonal-invite">` appears
  1.2 s after the floor settles. It is not a dialog and doesn't take focus, and it never shows in cabinets,
  lobbies, games or the Tournament Center, or while a modal, the claw close-up, the expanded jukebox, the theme
  picker or a theme transition is open. "Turn on Halloween" calls `switchTheme()`; "Not now" ends invites for
  the season.
- **Exit** (`[data-part="exit-halloween"]`): a HUD pumpkin at ≥ 1024 × 541 px, plus a row in Settings → Display
  and at the top of the Themes sheet everywhere. It confirms "Back to <theme>?" and returns to the remembered
  theme (Delta Neon if that theme is gone).
- **Season's end:** an invite-activated Halloween Night reverts after October 31 — checked when settings are
  ready and when the tab becomes visible, never mid-match. A hand-picked one stays. An invite from an earlier
  year seen in a later October moves to that season instead of reverting.
- **State:** `AppSettings.seasonal.halloween = { year?, dismissed?, via?: 'invite' | 'picker', prev? }`,
  validated by `parseSeasonal` (no settings-version bump; it roams with the Supabase profile). One store
  subscription on `settings.theme` writes `via`/`prev`; unknown seasons are kept.
- **QA:** `?season=off|live|halloween|YYYY-MM-DD[THH:MM]` (local time; noon when no time is given) is copied to
  `sessionStorage['dascade:qa:season']`; `localStorage['dascade:qa:season']` works too. Precedence: URL ›
  sessionStorage › localStorage › the real clock. `seasonClock()` gives seasonal visuals the same date (the
  haunting in `halloween-night/haunt.ts`). `[data-part="seasonal-status"][data-state=off|idle|ineligible|waiting|blocked|shown]`
  is always present for tests.
- **E2E:** `playwright.config.ts` seeds `dascade:qa:season=off` into every browser context, so no spec meets
  October's invite by accident; `e2e/seasonal.spec.ts` opts in with `?season=…`. A spec that passes its own
  `storageState` must add that entry.

## Adding a theme end to end

1. **Data**: `packages/ui/src/theme/themes/<id>.ts` exporting a `ThemeDefinition` — start from Delta Neon
   (`tokens: { ...DELTA_NEON.tokens, … }`), add `meta` (era, tagline, 4 swatches, family), a complete
   `materials` set, optional `gameMaterials`, `effects`, `copy`, `overrides`, `renderer`. Add it to
   `BUILT_IN_THEMES`.
2. **Skin**: `apps/web/src/themes/<id>/{index.ts,skin.css}` and register the loader in
   `apps/web/src/themes/registry.ts`; add its keyframe alias to `KEYFRAME_ALIASES`. Add its page
   background / `theme-color` to the map in `apps/web/public/boot-theme.js`.
3. **Test**: `pnpm vitest run packages/ui/src/theme apps/web/src/themes` (validation, materials, effects,
   copy keys, scoping lint, loader, switcher) and `e2e/theme.spec.ts` (iterates every theme id).
4. **Look at it** at 1920×1080, 1440×900, 1024×768, 768×1024, 390×844 and 844×390, with fx
   FULL/REDUCED/MINIMAL and reduced motion: floor, a picker, a title screen, a lobby, Settings, a toast,
   results, the jukebox and several games.

## Performance rules

- Skins are separate chunks, loaded on demand and cached; only the active theme's skin is fetched at
  boot. Token data for all themes is small and eager. The picker's live previews inject one
  `<style id="dc-theme-previews">` while a picker is open and remove it when it closes.
- Switching never accumulates `<style>` tags (one `dc-theme`, one stylesheet per skin, ever), listeners,
  overlays or environment instances (one `.theme-env`); `e2e/theme.spec.ts` checks this.
- Environments: one rAF loop at ≤ 30 fps, paused when hidden, cheap at fx REDUCED, static at MINIMAL.
  Prefer CSS/SVG/procedural canvas over images; no heavy art in the default bundle.
- Canvas renderers re-read tokens only on change (`watchThemeTokens` / `useThemeTokens`), never per frame.

## Settings persistence

`AppSettings.theme` (default `'delta-neon'`) is stored with the other settings (`localStorage`
`dascade:v1:settings`, or the Supabase profile). `migrateSettings()` keeps unknown-but-valid ids (they
render Delta Neon until the theme exists again), corrects invalid values per key and keeps unknown keys.
The fx setting is labelled **FULL / REDUCED / MINIMAL** (stored as `'high' | 'low' | 'off'`).

## QA hooks

`window.__DASCADE_THEME__`: `listThemes`, `registerTheme` (runtime test themes), `activeThemeId`,
`setTheme(id)` (instant), `switchTheme(id)` (animated, what the picker does), `skinLoaded(id)`,
`readThemeTokens(el)`. `window.__DASCADE_AUDIO__.voices()`: the sfx names the active theme re-voices.
