# Theming DASCADE

DASCADE ships one theme, **Delta Neon** (`delta-neon`): deep violet-black glass, neon accents, pixel
bevels and restrained CRT textures. The theme architecture exists so future aesthetic packs (say, a
1990s-desktop skin) can restyle the whole arcade **without touching game logic, networking,
tournaments, saves or matchmaking**. A theme is data: a set of CSS custom-property values plus a small
palette for canvas renderers.

```
packages/ui/src/styles/tokens.css        token layers; its :root values ARE Delta Neon
packages/ui/src/theme/tokens.ts          the token contract (required / optional / derived / foundation)
packages/ui/src/theme/types.ts           ThemeDefinition, RendererPalette, ThemeTokens
packages/ui/src/theme/themes/*.ts        theme definitions (delta-neon.ts mirrors tokens.css)
packages/ui/src/theme/registry.ts        registry, validation, fallback to Delta Neon
packages/ui/src/theme/apply.ts           applyTheme(id): html[data-theme] + generated CSS + theme-color
packages/ui/src/theme/read.ts, react.ts  readThemeTokens() / useThemeTokens() for Canvas & Phaser
apps/web/src/app/settings.ts             `settings.theme` + versioned, fail-safe settings migration
```

## Token layers

| Layer          | Examples                                                                                                                                                                                                                                        | Themed?                                                                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Foundation** | `--fs-*`, `--sp-*`, `--z-*`, `--topbar-h`, `--safe-*`, `--content-max`                                                                                                                                                                          | Never. Scales and layout metrics are shared so games lay out identically in every theme.                                                                                              |
| **Palette**    | `--bg-0…5`, `--glass*`, `--line*`, `--text-0…3`, `--text-inverse`, neon hues (`--pink`, `--cyan`, …), `--shade`, `--light`                                                                                                                      | Yes. Raw colours; lots of game CSS references them directly.                                                                                                                          |
| **Semantic**   | page, typography, shape, shadows, surfaces, windows/panels (title bar, brackets, backdrop), buttons, form controls, shell chrome (top bar, docks, toasts), HUD, cabinet chrome, marquee, textures, glow inputs, motion inputs, renderer palette | Yes. Roles, not colours. Components read these.                                                                                                                                       |
| **Derived**    | `--glow-sm/md/lg`, `--text-glow`, `--scanline-opacity`, `--render-glow`, `--render-scanlines`, `--dur-1…4`                                                                                                                                      | Never set by a theme. They are scaled by the player's **Visual effects** (`html[data-fx]`) and **Reduce motion** settings from the theme's `*-full` / `*-soft` / `--motion-*` inputs. |

The complete, grouped list lives in `THEME_TOKEN_GROUPS` (`packages/ui/src/theme/tokens.ts`).

### Optional overrides (accent-following recipes)

A custom property resolves **where it is declared**. Games set `--accent` on their stage (`<GameStage>`),
so a `:root` token whose value mentions `var(--accent)` would always use the _root_ accent. Components
that should follow the game's accent therefore compute it in their own rule, behind an optional token:

```css
.dc-btn--primary {
  --btn-bg: var(--button-primary-bg, color-mix(in srgb, var(--accent) 88%, var(--light)));
}
```

Delta Neon leaves these unset. A theme may set them to **fixed** values (a grey bevelled primary button,
a navy control accent). The list is `OPTIONAL_THEME_TOKENS`: `--title-shadow`, `--button-primary-*`,
`--button-secondary-edge`, `--bracket-color`, `--titlebar-marker`, `--panel-glow-border`,
`--panel-glow-shadow`, `--control-accent` (+ `--control-accent-ink`), `--input-focus-ring`,
`--game-backdrop`, `--shell-bar-rule`. Don't reference `var(--accent)` inside them.

## Adding a theme

1. Create `packages/ui/src/theme/themes/<id>.ts` exporting a `ThemeDefinition`. Start from Delta Neon and
   override: `tokens: { ...DELTA_NEON.tokens, '--bg-0': '#008080', … }`. Every required token must be
   present (the type and `validateTheme()` enforce it).
2. Add it to `BUILT_IN_THEMES` in `registry.ts`.
3. Give players a way to pick it: `useApp.getState().updateSettings({ theme: '<id>' })`. The Settings →
   Display "Theme" line is where a picker goes (today it is a read-only line because only one theme ships).
4. Run `pnpm vitest run packages/ui/src/theme` — it checks that every registered theme defines every
   required token, never sets derived or foundation tokens, and uses safe values.
5. Look at it: arcade floor, a cabinet picker, a title screen, a lobby, Settings, a toast, a results
   screen and a few games, at desktop and phone sizes, with Visual effects on High/Low/Off.

`applyTheme()` injects the theme as `:root[data-theme='<id>'] { … }` (a `<style id="dc-theme">`), which
out-ranks the `:root` defaults. Delta Neon needs no injected CSS. Unknown or removed ids fall back to
Delta Neon, and the stored preference is kept (so the theme comes back if it is re-added).

### Values that work well

- `--panel-sheen: none` removes the glass highlight (`background: none, <panel-bg>` is valid).
- `--panel-blur` / `--shell-bar-blur` / `--overlay-blur` accept `none`.
- Kill glow by setting the eight `--glow-*-full/-soft` inputs to `0 0 0 transparent` (`--text-glow-*`: `none`).
- Remove CRT texture with `--scanline-opacity-full/-soft: 0`, `--noise-opacity: 0`, `--grid-ink: transparent`.
- Snappier/softer motion: `--motion-1…4` and `--ease-*`. Reduced motion still collapses durations.
- Square everything with `--radius-sm/--radius/--radius-lg/--panel-radius/--input-radius: 0px`.
- Window chrome: `--titlebar-bg` (e.g. a gradient), `--titlebar-fg`, `--titlebar-font`,
  `--titlebar-transform: none`, `--titlebar-marker-size: 0px`, `--bracket-size: 0px`.

## Rules for game and arcade code

- Use tokens for chrome (panels, HUD, buttons, text, lines, shadows): `--hud-*` for in-game scoreboards
  and status strips, `--surface-*` for wells and rows, `--panel-*` for windows, `--shadow-*`.
- Never write `rgba(0,0,0,x)` / `#fff` for chrome; use `color-mix(in srgb, var(--shade) 35%, transparent)`,
  `var(--light)` or a semantic token.
- **Game art** (boards, sprites, terrain, card faces, per-cabinet marquee art) may keep its own palette —
  declare it once as CSS variables or constants in your folder so a theme could override it later.
- Don't put theme text tokens on fixed art: if a surface is a hard-coded dark illustration, text on it
  needs a local light ink declared next to the art (a light theme turns `--text-0` dark).
- Your accent comes from the catalog via `<GameStage gameId>`; keep using `var(--accent)` in component
  rules (it resolves to your game's accent there).
- Fonts: `--font-display` (headings/labels), `--font-pixel` (tiny caps), `--font-ui` (body),
  `--font-num` with `font-variant-numeric: tabular-nums` for every number, clock, score and code.
  As a safety net `--font-display` starts with `'DASCADE Digits'` (declared in `apps/web/src/styles/app.css`):
  Space Grotesk for the digits 0–9 only, so a number that slips into a pixel heading, button or segmented
  option still reads clearly. A theme that swaps `--font-display` should keep that family first.
- Honour `settings.reducedMotion` and `settings.fx` (use the derived tokens and they are honoured for you).

### Canvas and Phaser renderers

Renderers can't read CSS, so read the resolved values:

```ts
import { readThemeTokens, subscribeThemeTokens, useThemeTokens } from '@dascade/ui';

// React: pass an element inside your <GameStage> so `accent` is your game's accent.
const stageRef = useRef<HTMLDivElement>(null);
const t = useThemeTokens(stageRef); // re-reads on theme / fx / reduced-motion change
ctx.fillStyle = t.background; // CSS strings for Canvas 2D
ctx.shadowBlur = 16 * t.glow; // glow is 0 when Visual effects are off
ctx.globalAlpha = t.gridAlpha; // grid lines in t.line

// Phaser (outside React):
const t = readThemeTokens(parentEl);
this.cameras.main.setBackgroundColor(t.int.background); // 0xRRGGBB integers in t.int
const off = subscribeThemeTokens(() => applyPalette(readThemeTokens(parentEl)));
this.events.once('shutdown', off);
```

`ThemeTokens` also carries `surface`, `text`, `textMuted`, `accent2`, `accentDeep`, `success`,
`warning`, `danger`, `info`, `scanlines` (fx-scaled), `fx`, `reducedMotion` and the font stacks.

## Settings persistence

`AppSettings.theme` (default `'delta-neon'`) is stored with the other settings
(`localStorage` key `dascade:v1:settings`, or the Supabase profile). `migrateSettings()` upgrades
whatever is stored — v1 blobs get `theme`, invalid values fall back per key, **unknown keys are kept**,
and a `settingsVersion` stamp is written. The boot script reads the stored theme synchronously
(`peekStoredTheme`) and applies it before React renders.

## Proving a theme end to end

`e2e/theme.spec.ts` registers a throwaway "1995 desktop" theme at runtime through
`window.__DASCADE_THEME__` (`registerTheme`, `setTheme`, `listThemes`, `activeThemeId`, `readThemeTokens`) and asserts that
the page background, top bar, lobby panels, buttons, dialog title bar and the cabinet picker change —
and that after a reload the unknown id falls back to Delta Neon. That test theme is not shipped.
