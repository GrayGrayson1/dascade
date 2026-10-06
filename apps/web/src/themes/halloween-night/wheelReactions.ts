/**
 * Halloween Night's Wheel of DAStiny reactions: which little show (and sting) a landing gets, read from
 * what's printed on the winning slice. The slice's emoji decides first (the host picked it), then words
 * in its label, most specific first. A slice that matches nothing gets the theme's plain celebration.
 * Pure: every screen derives the same reaction from the same slice, at the same moment.
 */
import type { WheelSlice } from '../wheelSkin.ts';

export type WheelReaction = 'candy' | 'brew' | 'ghost' | 'cat' | 'skeleton' | 'boo' | 'shrink' | 'monster' | 'bats' | 'jackpot';

export interface ReactionInfo {
  /** Closed caption for its sound, shown while it plays (also for players who can't hear it). */
  caption: string;
  /** How long the show runs (ms); the sting is shorter. */
  ms: number;
}

export const REACTIONS: Readonly<Record<WheelReaction, ReactionInfo>> = {
  candy: { caption: '[music-box chime, crinkling wrappers]', ms: 2600 },
  brew: { caption: '[cauldron bubbles and sparkles]', ms: 2600 },
  ghost: { caption: '[friendly ghost: “ooOOooo”]', ms: 2800 },
  cat: { caption: '[a cat meows]', ms: 2600 },
  skeleton: { caption: '[bones rattle a tune]', ms: 2800 },
  boo: { caption: '[“BOO!”]', ms: 2200 },
  shrink: { caption: '[slide whistle: fwoooop]', ms: 3200 },
  monster: { caption: '[a friendly monster roars]', ms: 2600 },
  bats: { caption: '[bats flutter and squeak]', ms: 2400 },
  jackpot: { caption: '[thunder rumbles, fanfare]', ms: 3400 },
};

interface Rule {
  kind: WheelReaction;
  /** Emoji (without the variation selector); a slice emoji matches when it starts with one (🐈‍⬛ ⊃ 🐈). */
  emoji: readonly string[];
  words: RegExp;
}

// Order = precedence for the label words: the jackpot, then the tricks, then creatures, treats last.
const RULES: readonly Rule[] = [
  { kind: 'jackpot', emoji: ['🎃'], words: /\bjackpot\b/i },
  { kind: 'shrink', emoji: ['🤏'], words: /\b(shrink\w*|shrunk\w*|shrank|tiny|teeny)\b/i },
  { kind: 'boo', emoji: ['😱', '🙀', '😨'], words: /\b(boo+|tricks?|fright\w*)\b/i },
  { kind: 'cat', emoji: ['🐈', '🐱', '😺', '😸', '😼', '🐾'], words: /\b(cats?|kitty|kittens?|meow\w*)\b/i },
  { kind: 'skeleton', emoji: ['💀', '☠', '🦴'], words: /\b(skeletons?|skulls?|bones?|bony)\b/i },
  { kind: 'bats', emoji: ['🦇', '🧛'], words: /\b(bats?|vampires?|dracula)\b/i },
  { kind: 'monster', emoji: ['🐺', '🧟', '👹', '👺', '👾'], words: /\b(monsters?|werewol\w*|zombies?|mummy|mummies|howl\w*|roar\w*)\b/i },
  { kind: 'ghost', emoji: ['👻'], words: /\b(ghosts?|ghostly|phantoms?|spirits?|haunt\w*)\b/i },
  { kind: 'brew', emoji: ['🧪', '🧙', '⚗', '🔮', '🪄'], words: /\b(brew\w*|potions?|witch\w*|cauldrons?|spells?|cackle\w*)\b/i },
  {
    kind: 'candy',
    emoji: ['🍬', '🍭', '🍫', '🍪', '🍩', '🧁', '🍰', '🍯'],
    words: /\b(cand(y|ies)|treats?|sweets?|chocolates?|cookies?|lollipops?|caramels?|snacks?)\b/i,
  },
];

const plain = (s: string) => s.replace(/\uFE0F/g, '').trim();

/** The reaction for a landed slice, or null for the plain celebration. */
export function reactionFor(slice: Pick<WheelSlice, 'label' | 'emoji'>): WheelReaction | null {
  const emoji = plain(slice.emoji ?? '');
  if (emoji) {
    for (const rule of RULES) if (rule.emoji.some((e) => emoji.startsWith(e))) return rule.kind;
  }
  const label = slice.label ?? '';
  if (label) {
    for (const rule of RULES) if (rule.words.test(label)) return rule.kind;
  }
  return null;
}
