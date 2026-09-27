/**
 * Custom trivia packs: validation with readable errors, sanitation, JSON import/export and CSV import.
 * Isomorphic (the host editor validates before upload; the server validates again — never trust it).
 *
 * JSON: `{ "format": "dascade-trivia", "version": 1, "title": "…", "questions": [ …TriviaQuestion ] }`
 *       (a bare array of questions is accepted too).
 *
 * CSV (header row required, column order free, names case-insensitive):
 *   type, category, difficulty, prompt, answer, alt1…alt5, explanation, unit, from, to
 *   - mc:     answer = the correct option, alt1…alt5 = wrong options (at least one)
 *   - tf:     answer = true / false (also yes/no, t/f)
 *   - text:   answer = accepted answer, alt1…alt5 = more accepted answers
 *   - number: answer = the number ("1,234" ok), unit optional
 *   - order:  answer, alt1…alt5 = the items in the CORRECT order (3–6), from / to = end labels
 *   category defaults to "custom", difficulty to "medium", type to "mc".
 */
import { cleanText, maskProfanity } from '@dascade/shared';
import {
  TRIVIA_ANY_CATEGORY_IDS,
  TRIVIA_DIFFICULTIES,
  TRIVIA_LIMITS,
  TRIVIA_TYPES,
  TriviaPackSchema,
  type TriviaPack,
  type TriviaQuestion,
} from '@dascade/shared/games/trivia';
import { parseNumberAnswer } from '../party/index.ts';

export interface PackResult {
  pack: TriviaPack | null;
  errors: string[];
}

const MAX_ERRORS = 12;

/** Validates an unknown value as a pack; returns a sanitized pack or human-readable errors. */
export function validatePack(input: unknown): PackResult {
  const raw = Array.isArray(input) ? { questions: input } : input;
  const parsed = TriviaPackSchema.safeParse(raw);
  if (!parsed.success) return { pack: null, errors: issueErrors(parsed.error.issues) };
  const pack = sanitizePack(parsed.data);
  // Sanitation strips invisible characters, so it can empty a field ("\u200B") or make two
  // options identical ("Paris" / "Paris\u200B"): the cleaned pack must pass the schema too.
  const again = TriviaPackSchema.safeParse(pack);
  if (!again.success) return { pack: null, errors: issueErrors(again.error.issues) };
  return { pack, errors: [] };
}

type Issue = { path: PropertyKey[]; message: string };

function issueErrors(issues: readonly Issue[]): string[] {
  const errors = issues.slice(0, MAX_ERRORS).map((issue) => {
    const [first, index, ...rest] = issue.path;
    if (first === 'questions' && typeof index === 'number') {
      const field = rest.length ? `${rest.map(String).join('.')}: ` : '';
      return `Question ${index + 1} — ${field}${friendly(issue.message)}`;
    }
    return `${issue.path.length ? `${issue.path.map(String).join('.')}: ` : ''}${friendly(issue.message)}`;
  });
  if (issues.length > MAX_ERRORS) errors.push(`…and ${issues.length - MAX_ERRORS} more problems.`);
  return errors;
}

function friendly(message: string): string {
  if (/Invalid input: expected "mc"|No matching discriminator/i.test(message)) return `type must be one of ${TRIVIA_TYPES.join(', ')}`;
  return message.replace(/^Invalid input: /, '');
}

const clean = (s: string, max: number) => maskProfanity(cleanText(s, max));

/** Strips control/invisible characters, bounds lengths and masks profanity on every text field. */
export function sanitizePack(pack: TriviaPack): TriviaPack {
  const questions: TriviaQuestion[] = pack.questions.map((q) => {
    const base = {
      ...q,
      prompt: clean(q.prompt, TRIVIA_LIMITS.prompt),
      explanation: q.explanation ? clean(q.explanation, TRIVIA_LIMITS.explanation) : undefined,
    };
    if (!base.explanation) delete base.explanation;
    delete base.id;
    switch (q.type) {
      case 'mc':
        return {
          ...base,
          type: 'mc',
          options: q.options.map((o) => clean(o, TRIVIA_LIMITS.option)),
          correct: q.correct,
          ...(q.fixedOrder ? { fixedOrder: true } : {}),
        } as TriviaQuestion;
      case 'text':
        return { ...base, type: 'text', accept: q.accept.map((o) => clean(o, TRIVIA_LIMITS.acceptLen)) } as TriviaQuestion;
      case 'order':
        return {
          ...base,
          type: 'order',
          items: q.items.map((o) => clean(o, TRIVIA_LIMITS.item)),
          ends: [clean(q.ends[0], TRIVIA_LIMITS.endLabel), clean(q.ends[1], TRIVIA_LIMITS.endLabel)],
        } as TriviaQuestion;
      case 'number':
        return {
          ...base,
          type: 'number',
          correct: q.correct,
          ...(q.unit ? { unit: clean(q.unit, TRIVIA_LIMITS.unit) } : {}),
        } as TriviaQuestion;
      case 'tf':
        return { ...base, type: 'tf', correct: q.correct } as TriviaQuestion;
    }
  });
  // Cleaning can empty a field (e.g. a prompt made only of invisible characters): validatePack
  // re-validates the result.
  const out: TriviaPack = {
    format: 'dascade-trivia',
    version: 1,
    title: clean(pack.title ?? '', TRIVIA_LIMITS.packTitle) || 'Custom pack',
    questions,
  };
  return out;
}

/** Parses JSON text into a validated pack. */
export function parsePackJson(text: string): PackResult {
  if (text.length > TRIVIA_LIMITS.packBytes)
    return { pack: null, errors: [`That file is too big (max ${Math.round(TRIVIA_LIMITS.packBytes / 1000)} KB).`] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { pack: null, errors: [`That isn’t valid JSON (${(err as Error).message.replace(/^JSON\.parse: /, '')}).`] };
  }
  return validatePack(data);
}

/** Pretty JSON for download / sharing. */
export function packToJson(pack: TriviaPack): string {
  return JSON.stringify({ format: 'dascade-trivia', version: 1, title: pack.title ?? 'Custom pack', questions: pack.questions }, null, 2);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180-style CSV parsing (quoted fields, doubled quotes, newlines inside quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field.length === 0) quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

const TRUE_WORDS = new Set(['true', 't', 'yes', 'y', '1']);
const FALSE_WORDS = new Set(['false', 'f', 'no', 'n', '0']);

/** Parses a CSV question sheet (see module doc) into a validated pack. */
export function parsePackCsv(text: string, title = 'Imported pack'): PackResult {
  if (text.length > TRIVIA_LIMITS.packBytes)
    return { pack: null, errors: [`That file is too big (max ${Math.round(TRIVIA_LIMITS.packBytes / 1000)} KB).`] };
  const rows = parseCsv(text);
  if (rows.length < 2) return { pack: null, errors: ['The CSV needs a header row and at least one question.'] };
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  if (col('prompt') < 0 || col('answer') < 0)
    return { pack: null, errors: ['The header row must include at least "prompt" and "answer" columns.'] };
  const errors: string[] = [];
  const questions: unknown[] = [];
  const get = (r: string[], name: string) => {
    const i = col(name);
    return i >= 0 ? (r[i] ?? '').trim() : '';
  };
  const alts = (r: string[]) =>
    [1, 2, 3, 4, 5].map((n) => get(r, `alt${n}`) || get(r, `wrong${n}`) || get(r, `option${n + 1}`)).filter(Boolean);
  rows.slice(1, TRIVIA_LIMITS.packQuestions + 1).forEach((r, i) => {
    const line = i + 2;
    const type = (get(r, 'type') || 'mc').toLowerCase();
    const category = (get(r, 'category') || 'custom').toLowerCase();
    const difficulty = (get(r, 'difficulty') || 'medium').toLowerCase();
    const prompt = get(r, 'prompt');
    const answer = get(r, 'answer');
    const explanation = get(r, 'explanation');
    const problems: string[] = [];
    if (!(TRIVIA_TYPES as readonly string[]).includes(type)) problems.push(`type "${type}" is not one of ${TRIVIA_TYPES.join(', ')}`);
    if (!(TRIVIA_ANY_CATEGORY_IDS as readonly string[]).includes(category))
      problems.push(`category "${category}" is unknown (use ${TRIVIA_ANY_CATEGORY_IDS.join(', ')})`);
    if (!(TRIVIA_DIFFICULTIES as readonly string[]).includes(difficulty)) problems.push(`difficulty must be easy, medium or hard`);
    if (!prompt) problems.push('prompt is empty');
    if (!answer) problems.push('answer is empty');
    let q: Record<string, unknown> | null = null;
    if (problems.length === 0) {
      const base = { category, difficulty, prompt, ...(explanation ? { explanation } : {}) };
      if (type === 'mc') {
        const wrong = alts(r);
        if (wrong.length === 0) problems.push('multiple choice needs at least one wrong option in alt1…alt5');
        q = { ...base, type, options: [answer, ...wrong], correct: 0 };
      } else if (type === 'tf') {
        const v = answer.toLowerCase();
        if (!TRUE_WORDS.has(v) && !FALSE_WORDS.has(v)) problems.push('true/false answer must be true or false');
        q = { ...base, type, correct: TRUE_WORDS.has(v) };
      } else if (type === 'text') {
        q = { ...base, type, accept: [answer, ...alts(r)] };
      } else if (type === 'number') {
        const n = parseNumberAnswer(answer);
        if (n === null) problems.push(`"${answer}" is not a number`);
        const unit = get(r, 'unit');
        q = { ...base, type, correct: n ?? 0, ...(unit ? { unit } : {}) };
      } else if (type === 'order') {
        const items = [answer, ...alts(r)];
        if (items.length < 3) problems.push('order questions need 3–6 items (answer + alt1…alt5)');
        q = { ...base, type, items, ends: [get(r, 'from') || 'First', get(r, 'to') || 'Last'] };
      }
    }
    if (problems.length) {
      if (errors.length < MAX_ERRORS) errors.push(`Row ${line} — ${problems.join('; ')}`);
      return;
    }
    questions.push(q);
  });
  if (rows.length - 1 > TRIVIA_LIMITS.packQuestions) errors.push(`Only the first ${TRIVIA_LIMITS.packQuestions} questions were read.`);
  if (errors.length) return { pack: null, errors };
  const result = validatePack({ title, questions });
  if (!result.pack) {
    // Map "Question N" back to CSV rows (row = N + 1).
    return { pack: null, errors: result.errors.map((e) => e.replace(/^Question (\d+)/, (_, n: string) => `Row ${Number(n) + 1}`)) };
  }
  return result;
}

/** A small example CSV for the editor's help text. */
export const PACK_CSV_EXAMPLE = [
  'type,category,difficulty,prompt,answer,alt1,alt2,alt3,explanation,unit,from,to',
  'mc,custom,easy,Which floor is the coffee machine on?,Third,First,Second,Fourth,,,,',
  'tf,custom,easy,Our team mascot is a llama.,true,,,,,,,',
  'text,custom,medium,What is the name of our office plant?,Fernando,Fern,,,,,,',
  'number,custom,hard,How many stairs are in the lobby staircase?,42,,,,,steps,,',
  'order,custom,medium,Order these launches,Alpha,Beta,Gamma,,,,Earliest,Latest',
].join('\n');
