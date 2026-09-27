/**
 * Prompt dealing: themed rounds rotate through the enabled types without repeats, and prompts
 * are drawn without repeats for the whole match (a theme that runs dry is reshuffled).
 */
import { MP_PLAYER_TOKEN, MP_PROMPT_TYPES, type MpBuiltInType, type MpPromptType } from '@dascade/shared/games/masterpiece';
import { shuffleInPlace, type Rng } from '@dascade/shared';
import { PROMPT_PACK } from './prompts.ts';

export interface DeckPrompt {
  /** Stable within a match: `<type>-<index>`. */
  id: string;
  type: MpPromptType;
  text: string;
}

export interface DeckOptions {
  types: readonly MpBuiltInType[];
  custom: readonly string[];
  customOnly: boolean;
}

/** Themes a deck would rotate through (empty = nothing playable). */
export function deckThemes(opts: DeckOptions): MpPromptType[] {
  if (opts.customOnly) return opts.custom.length > 0 ? ['custom'] : [];
  const themes: MpPromptType[] = MP_PROMPT_TYPES.filter((t) => opts.types.includes(t));
  if (opts.custom.length > 0) themes.push('custom');
  return themes;
}

export class PromptDeck {
  private readonly themes: MpPromptType[];
  private readonly remaining = new Map<MpPromptType, DeckPrompt[]>();
  private readonly spent = new Map<MpPromptType, DeckPrompt[]>();
  private themeQueue: MpPromptType[] = [];
  private lastTheme: MpPromptType | null = null;

  constructor(
    opts: DeckOptions,
    private readonly rng: Rng,
  ) {
    const themes = deckThemes(opts);
    // Never stall: with nothing selected, fall back to every built-in theme.
    this.themes = themes.length > 0 ? themes : [...MP_PROMPT_TYPES];
    for (const theme of this.themes) {
      const source = theme === 'custom' ? opts.custom : PROMPT_PACK[theme];
      const prompts = source.map((text, i) => ({ id: `${theme}-${i}`, type: theme, text }));
      this.remaining.set(theme, shuffleInPlace(prompts, rng));
      this.spent.set(theme, []);
    }
  }

  get availableThemes(): readonly MpPromptType[] {
    return this.themes;
  }

  /** The next round theme: a shuffled rotation, never the same theme twice in a row (when there is a choice). */
  nextTheme(): MpPromptType {
    if (this.themeQueue.length === 0) {
      this.themeQueue = shuffleInPlace([...this.themes], this.rng);
      if (this.themeQueue.length > 1 && this.themeQueue[0] === this.lastTheme) {
        const swap = 1 + this.rng.int(this.themeQueue.length - 1);
        [this.themeQueue[0], this.themeQueue[swap]] = [this.themeQueue[swap]!, this.themeQueue[0]!];
      }
    }
    const theme = this.themeQueue.shift()!;
    this.lastTheme = theme;
    return theme;
  }

  /** Remaining unused prompts of a theme. */
  remainingOf(theme: MpPromptType): number {
    return this.remaining.get(theme)?.length ?? 0;
  }

  /**
   * Draws `count` prompts of a theme. Prompts are unique within the match until the theme runs dry,
   * then the spent ones are reshuffled (still unique within one draw when the theme has enough).
   */
  draw(theme: MpPromptType, count: number): DeckPrompt[] {
    const pool = this.remaining.get(theme);
    const dealt = this.spent.get(theme);
    if (!pool || !dealt) throw new RangeError(`Theme ${theme} is not in this deck`);
    const out: DeckPrompt[] = [];
    while (out.length < count) {
      if (pool.length === 0) {
        // New cycle: reshuffle what was dealt, keeping prompts from this very draw for later.
        const inDraw = new Set(out.map((p) => p.id));
        let refill = dealt.filter((p) => !inDraw.has(p.id));
        if (refill.length === 0) refill = dealt.slice(); // theme smaller than the draw: repeats allowed
        if (refill.length === 0) break; // empty theme
        const refillIds = new Set(refill.map((p) => p.id));
        const keep = dealt.filter((p) => !refillIds.has(p.id));
        dealt.length = 0;
        dealt.push(...keep);
        pool.push(...shuffleInPlace(refill, this.rng));
      }
      const next = pool.pop()!;
      out.push(next);
      if (!dealt.some((p) => p.id === next.id)) dealt.push(next);
    }
    return out;
  }
}

/** Replaces every {player} token with one player's name (chosen with the rng). */
export function fillPlayerToken(text: string, names: readonly string[], rng: Rng): string {
  if (!text.includes(MP_PLAYER_TOKEN)) return text;
  const name = names.length > 0 ? names[rng.int(names.length)]! : 'Someone';
  return text.split(MP_PLAYER_TOKEN).join(name);
}
