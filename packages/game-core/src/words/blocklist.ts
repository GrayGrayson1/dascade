/**
 * DASwords office-safe blocklist.
 *
 * DASwords is meant for office game nights, so the dictionary refuses a small set of words:
 * profanity, sexual vocabulary, and slurs (ethnic, religious, homophobic, transphobic, ableist).
 * Blocked words are removed from the shipped dictionary when it is generated
 * (scripts/words/build-dictionary.ts) and checked again at runtime, so they can never be
 * accepted, scored, used as a puzzle seed, listed as a "missed word", or echoed back unmasked.
 *
 * Two lists:
 *  - BLOCKED_STEMS: any word CONTAINING one of these is blocked. Only stems with (almost) no
 *    innocent carriers are listed here (e.g. not "twat" — saltwater, not "wank" — swanky). The few
 *    legitimate casualties ("shittah", a tree) are accepted on purpose: better to refuse a rare word
 *    than to display a slur.
 *  - BLOCKED_WORDS: exact words (inflections listed explicitly). Several have innocent senses
 *    ("cock" the rooster, "ass" the donkey, "tit" the bird, "coon" for raccoon); they are refused
 *    anyway because the offensive sense is the one people see first.
 *
 * This is a courtesy filter for a party game, not a moderation system. Edit with care and re-run
 * the dictionary build; words.test.ts checks that no blocked word survives in the shipped data.
 */

export const BLOCKED_STEMS: readonly string[] = [
  'fuck',
  'shit',
  'cunt',
  'nigger',
  'nigga',
  'bitch',
  'whore',
  'slut',
  'jizz',
  'dildo',
  'faggot',
  'cocksuck',
  'masturbat',
  'orgasm',
  'pedophil',
  'paedophil',
  'asshole',
  'arsehole',
  'goddam',
  'skank',
];

/** Innocent words that happen to contain a blocked stem. */
const STEM_EXCEPTIONS: ReadonlySet<string> = new Set([
  'mishit',
  'mishits',
  'mishitting',
  'snigger',
  'sniggers',
  'sniggered',
  'sniggering',
  'sniggerer',
  'sniggerers',
]);

export const BLOCKED_WORDS: readonly string[] = [
  // Profanity and crude vocabulary
  'ass', 'asses', 'arse', 'arses', 'jackass', 'jackasses', 'badass', 'badasses', 'dumbass',
  'bastard', 'bastards', 'bastardy', 'bastardly',
  'bugger', 'buggers', 'buggered', 'buggering', 'buggery', 'bollocks',
  'crap', 'crappy', 'crapped', 'crapping', 'crapper', 'crappers', 'crappier', 'crappiest',
  'damn', 'damns', 'dammit',
  'piss', 'pissed', 'pisses', 'pissing', 'pisser', 'pissers', 'pissoir', 'pissoirs', 'pissant', 'pissants',
  'turd', 'turds', 'fart', 'farts', 'farted', 'farting',
  // Sexual and anatomical vocabulary
  'cock', 'cocks', 'dick', 'dicks', 'dickhead', 'dickheads', 'pussy', 'pussies',
  'tit', 'tits', 'titty', 'titties', 'tittie', 'boob', 'boobs', 'boobies',
  'cum', 'cums', 'cumming', 'jism', 'jisms', 'jissom', 'jissoms', 'smegma', 'smegmas',
  'porn', 'porns', 'porno', 'pornos', 'porny', 'pornier', 'porniest',
  'pornography', 'pornographies', 'pornographer', 'pornographers', 'pornographic', 'pornographically',
  'horny', 'hornier', 'horniest', 'boner', 'boners', 'nooky', 'nookie', 'nookies', 'poon', 'poons', 'poontang',
  'cooch', 'cooches', 'coochie', 'schlong', 'schlongs', 'clit', 'clits', 'clitoris', 'clitorises', 'clitoral', 'clitoric',
  'penis', 'penises', 'penile', 'vagina', 'vaginas', 'vaginae', 'vaginal', 'vaginally',
  'scrotum', 'scrotums', 'scrota', 'scrotal', 'testicle', 'testicles', 'anus', 'anuses', 'anal', 'anally',
  'sodomy', 'sodomies', 'sodomize', 'sodomized', 'sodomizes', 'sodomizing', 'sodomite', 'sodomites', 'sodomist', 'sodomists',
  'incest', 'incests', 'incestuous', 'incestuously',
  'rape', 'rapes', 'raped', 'raping', 'rapist', 'rapists',
  'twat', 'twats', 'wank', 'wanks', 'wanked', 'wanker', 'wankers', 'wanking',
  'bimbo', 'bimbos', 'bimboes', 'milf', 'milfs', 'douche', 'douches', 'douchebag', 'douchebags',
  // Ethnic, racial and religious slurs
  'negro', 'negroes', 'niggard', 'niggards', 'niggarded', 'niggarding', 'niggardly', 'niggardliness', 'niggardlinesses',
  'kike', 'kikes', 'spic', 'spics', 'spick', 'spicks', 'chink', 'chinks', 'gook', 'gooks',
  'wop', 'wops', 'dago', 'dagos', 'dagoes', 'kraut', 'krauts', 'coon', 'coons', 'honky', 'honkies', 'honkey', 'honkeys',
  'wetback', 'wetbacks', 'redskin', 'redskins', 'squaw', 'squaws', 'yid', 'yids', 'hebe', 'hebes',
  'sheeny', 'sheenies', 'jigaboo', 'jigaboos', 'pickaninny', 'pickaninnies', 'darky', 'darkie', 'darkies',
  'jew', 'jews', 'jewed', 'jewing', 'gyp', 'gyps', 'gypped', 'gypping', 'gypper', 'gyppers',
  'wog', 'wogs', 'papist', 'papists', 'papistry', 'mulatto', 'mulattos', 'mulattoes', 'coolie', 'coolies',
  'gringo', 'gringos', 'chinaman', 'nazi', 'nazis',
  // Homophobic and transphobic slurs
  'fag', 'fags', 'fagot', 'fagots', 'faggy', 'dyke', 'dykes', 'dykey', 'homo', 'homos',
  'lezzie', 'lezzies', 'lezzy', 'lesbo', 'lesbos', 'poof', 'poofs', 'pooftah', 'pooftahs', 'poofter', 'poofters',
  'nance', 'nances', 'tranny', 'trannies',
  // Ableist slurs
  'retard', 'retards', 'retarded', 'spastic', 'spastics', 'spaz', 'spazz', 'spazzes', 'mongoloid', 'mongoloids',
  'midget', 'midgets',
];

const WORD_SET: ReadonlySet<string> = new Set(BLOCKED_WORDS);

/** True when a lowercase a–z word is refused by DASwords (exact list or a blocked stem). */
export function isBlockedWord(word: string): boolean {
  const w = word.toLowerCase();
  if (WORD_SET.has(w)) return true;
  if (STEM_EXCEPTIONS.has(w)) return false;
  for (const stem of BLOCKED_STEMS) if (w.includes(stem)) return true;
  return false;
}

/** True when any space-separated word of a phrase is blocked. */
export function containsBlockedWord(phrase: string): boolean {
  return phrase
    .toLowerCase()
    .split(/[^a-z]+/u)
    .some((w) => w.length > 0 && isBlockedWord(w));
}

/** True when a raw letter string (e.g. a displayed anagram rack) contains a blocked word or stem as a substring. */
export function spellsBlockedWord(letters: string): boolean {
  const s = letters.toLowerCase();
  for (const stem of BLOCKED_STEMS) if (s.includes(stem)) return true;
  for (const w of BLOCKED_WORDS) if (w.length >= 4 && s.includes(w)) return true;
  return false;
}

/** Masks a word for display: first letter kept, the rest replaced ("f***"). */
export function maskBlocked(word: string): string {
  const chars = Array.from(word);
  if (chars.length <= 1) return '*';
  return chars[0] + '*'.repeat(chars.length - 1);
}
