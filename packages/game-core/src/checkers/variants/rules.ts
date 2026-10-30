/**
 * The rule sets of the draughts variants as data. The player-facing summary of each lives in
 * CHECKERS_VARIANT_INFO (@dascade/shared/games/checkers); board size, men per side and the colour
 * that moves first are read from there so the two can't drift apart.
 *
 * Sources: FMJD rules (International, and Brazilian / Canadian which are International rules on
 * 8×8 / 12×12), the Russian draughts rules, American Pool rules, the Italian federation (FID)
 * capture priorities, the Spanish "cantidad / calidad" laws and Czech dáma — cross-checked against
 * lidraughts / playstrategy, which implement these variants.
 */
import { CHECKERS_VARIANT_INFO, type CheckersVariant } from '@dascade/shared/games/checkers';
import type { Color, Material } from '../board.ts';

/**
 * How a capture is chosen when several are possible (capturing is always mandatory):
 *  - free     — any capture (the sequence must still be completed);
 *  - max      — the sequence that takes the most pieces (kings and men count the same);
 *  - italian  — most pieces; then capture with a king rather than a man; then most kings taken;
 *               then the sequence that meets a king earliest;
 *  - spanish  — most pieces; then most kings taken;
 *  - czech    — a king must capture if one can; otherwise free.
 */
export type CaptureRule = 'free' | 'max' | 'italian' | 'spanish' | 'czech';

/**
 * A man reaching the far row in the middle of a capture:
 *  - stop — it is crowned and the move ends (American, Italian, Spanish, Czech);
 *  - king — it is crowned at once and keeps capturing as a king (Russian);
 *  - pass — it keeps capturing as a man; crowned only if the move ends on the far row (FMJD, Pool).
 */
export type PromotionRule = 'stop' | 'king' | 'pass';

/** normal: no pieces / no move loses; giveaway: no pieces / no move WINS; breakthrough: the first king wins. */
export type GoalRule = 'normal' | 'giveaway' | 'breakthrough';

/**
 * An endgame draw rule: when `applies` holds for the material, the game is drawn once `moves`
 * moves each (2 × moves plies) have passed without the material changing (no capture, no crowning).
 */
export interface EndgameDrawRule {
  id: string;
  /** Player-facing description, e.g. "three or more kings against a lone king". */
  label: string;
  moves: number;
  applies: (dark: Material, light: Material) => boolean;
}

export interface DraughtsRules {
  variant: CheckersVariant;
  size: number;
  /** Rows of men each side starts with. */
  rows: number;
  first: Color;
  menCaptureBackward: boolean;
  flyingKings: boolean;
  /** Italian: men can't capture kings. */
  menCaptureKings: boolean;
  capture: CaptureRule;
  promotion: PromotionRule;
  goal: GoalRule;
  /** Plies without a capture or a man move that draw the game (0 = no such rule). */
  quietPlies: number;
  endgame: readonly EndgameDrawRule[];
}

const loneKing = (m: Material) => m.total === 1 && m.kings === 1;
/** The rule holds for either colour as the stronger side. */
const eitherWay = (test: (strong: Material, weak: Material) => boolean) => (dark: Material, light: Material) =>
  test(dark, light) || test(light, dark);

/** FMJD 16-move rule: three pieces including a king against a lone king. */
const FMJD_THREE: EndgameDrawRule = {
  id: 'fmjd_three',
  label: 'three pieces with a king against a lone king',
  moves: 16,
  applies: eitherWay((s, w) => loneKing(w) && s.total === 3 && s.kings >= 1),
};
/** FMJD / Russian 5-move rule: two pieces or fewer including a king against a lone king. */
const FEW_VS_KING: EndgameDrawRule = {
  id: 'few_vs_king',
  label: 'two pieces or fewer with a king against a lone king',
  moves: 5,
  applies: eitherWay((s, w) => loneKing(w) && s.total <= 2 && s.kings >= 1),
};
/** Russian: three or more kings (no men) against a lone king. */
const KINGS_VS_KING_15: EndgameDrawRule = {
  id: 'kings_vs_king',
  label: 'three or more kings against a lone king',
  moves: 15,
  applies: eitherWay((s, w) => loneKing(w) && s.kings >= 3 && s.men === 0),
};
/** Spanish: three or more kings (no men) against a lone king, 13 moves. */
const KINGS_VS_KING_13: EndgameDrawRule = { ...KINGS_VS_KING_15, id: 'kings_vs_king_13', moves: 13 };
/** Russian: kings on both sides and unchanged material — 4–5 pieces in all: 30 moves; 6–7: 60 moves. */
const KING_ENDING_SMALL: EndgameDrawRule = {
  id: 'king_ending_5',
  label: 'a king ending with four or five pieces',
  moves: 30,
  applies: (d, l) => d.kings >= 1 && l.kings >= 1 && d.total + l.total >= 4 && d.total + l.total <= 5,
};
const KING_ENDING_LARGE: EndgameDrawRule = {
  id: 'king_ending_7',
  label: 'a king ending with six or seven pieces',
  moves: 60,
  applies: (d, l) => d.kings >= 1 && l.kings >= 1 && d.total + l.total >= 6 && d.total + l.total <= 7,
};

const RUSSIAN_DRAWS = [KINGS_VS_KING_15, FEW_VS_KING, KING_ENDING_SMALL, KING_ENDING_LARGE] as const;
const FMJD_DRAWS = [FMJD_THREE, FEW_VS_KING] as const;

type RuleFlags = Omit<DraughtsRules, 'variant' | 'size' | 'rows' | 'first'>;

const AMERICAN: RuleFlags = {
  menCaptureBackward: false,
  flyingKings: false,
  menCaptureKings: true,
  capture: 'free',
  promotion: 'stop',
  goal: 'normal',
  quietPlies: 80,
  endgame: [],
};
const INTERNATIONAL: RuleFlags = {
  menCaptureBackward: true,
  flyingKings: true,
  menCaptureKings: true,
  capture: 'max',
  promotion: 'pass',
  goal: 'normal',
  quietPlies: 50,
  endgame: FMJD_DRAWS,
};

const FLAGS: Record<CheckersVariant, RuleFlags> = {
  american: AMERICAN,
  giveaway: { ...AMERICAN, goal: 'giveaway' },
  russian: { ...INTERNATIONAL, capture: 'free', promotion: 'king', quietPlies: 30, endgame: RUSSIAN_DRAWS },
  pool: { ...INTERNATIONAL, capture: 'free', quietPlies: 30, endgame: RUSSIAN_DRAWS },
  brazilian: { ...INTERNATIONAL, quietPlies: 30, endgame: RUSSIAN_DRAWS },
  italian: { ...AMERICAN, menCaptureKings: false, capture: 'italian' },
  spanish: { ...AMERICAN, flyingKings: true, capture: 'spanish', quietPlies: 40, endgame: [KINGS_VS_KING_13] },
  czech: { ...AMERICAN, flyingKings: true, capture: 'czech' },
  international: INTERNATIONAL,
  antidraughts: { ...INTERNATIONAL, goal: 'giveaway', quietPlies: 0, endgame: [] },
  breakthrough: { ...INTERNATIONAL, goal: 'breakthrough', quietPlies: 0, endgame: [] },
  canadian: INTERNATIONAL,
};

const cache = new Map<CheckersVariant, DraughtsRules>();

export function rulesFor(variant: CheckersVariant): DraughtsRules {
  const hit = cache.get(variant);
  if (hit) return hit;
  const info = CHECKERS_VARIANT_INFO[variant];
  const rules: DraughtsRules = {
    variant,
    size: info.size,
    rows: (info.pieces * 2) / info.size,
    first: info.first,
    ...FLAGS[variant],
  };
  cache.set(variant, rules);
  return rules;
}
