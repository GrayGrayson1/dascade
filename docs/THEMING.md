# Theming DASCADE

DASCADE ships **eleven themes**. Delta Neon (`delta-neon`) is the default and the house style; the
others (Shareware Casino '97, Corporate Desktop '98, Cyber Café 2001, Mall Arcade '92, VHS After Dark,
Space Casino 2088, Basement LAN Party, Saturday Morning, Executive Edition, Neon Noir) restyle the
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
· `fade`; each tints itself from the target theme's `meta.swatches`.

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
  carousel). **JukeboxDecor**: inside the expanded jukebox.
- Decor components are wrapped in an error boundary: a crash renders nothing instead of breaking the app.

## Adding a theme end to end

1. **Data**: `packages/ui/src/theme/themes/<id>.ts` exporting a `ThemeDefinition` — start from Delta Neon
   (`tokens: { ...DELTA_NEON.tokens, … }`), add `meta` (era, tagline, 4 swatches, family), a complete
   `materials` set, optional `gameMaterials`, `effects`, `copy`, `overrides`, `renderer`. Add it to
   `BUILT_IN_THEMES`.
2. **Skin**: `apps/web/src/themes/<id>/{index.ts,skin.css}` and register the loader in
   `apps/web/src/themes/registry.ts`; add its keyframe alias to `KEYFRAME_ALIASES`.
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
`readThemeTokens(el)`.
