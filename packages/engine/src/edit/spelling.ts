// SPELL's words (M4-09 part 4; AutoCAD 2024 Help, "Check Spelling Dialog Box", "Check Spelling
// Settings Dialog Box"): the words of a text as it shows (`find-text.ts` reads it past its
// codes), each checked against the spelling dictionary the app gives the engine (`SpellService`,
// `@triya/text`'s Hunspell dictionary) and the user's custom dictionary.
//
// Where AutoCAD's documentation is silent (the most common drafter expectation is taken):
// - A word is a run of characters between spaces and line breaks, with the punctuation before
//   and after it left off ("(Doors," checks "Doors"); a measurement, field or stack ends one.
// - A hyphen or slash joins words: each part is checked ("cross-section", "and/or"). An
//   apostrophe is part of a word ("don't"). Any other punctuation inside a word ("e.g", "R&D")
//   is what Ignore words containing punctuation leaves out.
// - A run with no letter ("25", "1/2", "90°") is a number, never checked.
// - Capitalized: a capital then small letters ("Smith"); uppercase: no small letter ("ASTM",
//   a single "A"); mixed case: any other run with both ("iPhone").
import type { TextSyntax } from './find-text';
import { textTokens } from './find-text';

/** A spelling dictionary: whether a word is spelled right, and what it may have meant. */
export interface SpellChecker {
  /** The Main Dictionary's name, as the Check Spelling dialog lists it. */
  readonly name: string;
  correct(word: string): boolean;
  suggest(word: string): readonly string[];
}

/** Loads the spelling dictionary, once it is first needed (it is large). */
export type SpellService = () => Promise<SpellChecker>;

/** Check Spelling Settings' Options. */
export interface SpellOptions {
  readonly ignoreCapitalized: boolean;
  /** Ignore Words with Mixed Cases. */
  readonly ignoreMixed: boolean;
  readonly ignoreUppercase: boolean;
  readonly ignoreNumbers: boolean;
  readonly ignorePunctuation: boolean;
}

/** None ignored: AutoCAD's help gives no default, and every word is checked unless asked. */
export const DEFAULT_SPELL_OPTIONS: SpellOptions = {
  ignoreCapitalized: false,
  ignoreMixed: false,
  ignoreUppercase: false,
  ignoreNumbers: false,
  ignorePunctuation: false,
};

/** A word: shown characters [start, end). */
export interface SpellWord {
  readonly start: number;
  readonly end: number;
  readonly word: string;
}

const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
const LETTER = /\p{L}/u;
const DIGIT = /\p{N}/u;
/** What joins the parts of a compound, each checked alone. */
const JOINER = /[-/‐–]/u;
/** Punctuation that may sit inside a word without making it one "containing punctuation". */
const IN_WORD = /^[\p{L}\p{M}\p{N}'’]*$/u;
/** Ends a run: white space, and what stands for a measurement, field or stack. */
const BREAK = /[\s￼\0]/u;

/** Whether the options leave `word` out. */
function ignored(word: string, o: SpellOptions): boolean {
  if (o.ignoreNumbers && DIGIT.test(word)) return true;
  const letters = [...word].filter((c) => LETTER.test(c));
  const upper = (c: string) => c !== c.toLowerCase();
  const lower = (c: string) => c !== c.toUpperCase();
  const hasLower = letters.some(lower);
  const hasUpper = letters.some(upper);
  if (!hasLower) return hasUpper && o.ignoreUppercase;
  if (!hasUpper) return false;
  const capitalized = upper(letters[0]!) && letters.slice(1).every((c) => !upper(c));
  return capitalized ? o.ignoreCapitalized : o.ignoreMixed;
}

/** `s[from, to)` with the characters that are not letters or digits trimmed off its ends. */
function trimmed(s: string, from: number, to: number): [number, number] {
  let a = from;
  let b = to;
  while (a < b && !WORD_CHAR.test(s[a]!)) a++;
  while (b > a && !WORD_CHAR.test(s[b - 1]!)) b--;
  return [a, b];
}

/** The words of `shown` SPELL checks, as the options leave them, left to right. */
export function spellingWords(shown: string, o: SpellOptions): SpellWord[] {
  const out: SpellWord[] = [];
  const add = (a: number, b: number) => {
    const word = shown.slice(a, b);
    if (LETTER.test(word) && !ignored(word, o)) out.push({ start: a, end: b, word });
  };
  for (let i = 0; i < shown.length;) {
    if (BREAK.test(shown[i]!)) {
      i++;
      continue;
    }
    let j = i;
    while (j < shown.length && !BREAK.test(shown[j]!)) j++;
    const [a, b] = trimmed(shown, i, j);
    i = j;
    const run = shown.slice(a, b);
    const parts = run.split(JOINER);
    if (!parts.every((p) => IN_WORD.test(p))) {
      if (!o.ignorePunctuation) add(a, b);
      continue;
    }
    let at = a;
    for (const p of parts) {
      const [pa, pb] = trimmed(shown, at, at + p.length);
      add(pa, pb);
      at += p.length + 1;
    }
  }
  return out;
}

/** The words of a stored string `accept` does not take, in the characters it shows. */
export function misspelledWords(
  raw: string,
  syntax: TextSyntax,
  o: SpellOptions,
  accept: (word: string) => boolean,
): SpellWord[] {
  // A stack is one piece, which no word runs into; it shows as a break.
  const shown = textTokens(raw, syntax)
    .map((t) => (t.atom ? '\0'.repeat(t.text.length) : t.text))
    .join('');
  return spellingWords(shown, o).filter((w) => !accept(w.word));
}
