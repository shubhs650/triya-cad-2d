// SPELL's custom dictionary (M4-09 part 4): the words the user added, which AutoCAD keeps per
// user in a .cus file (DCTCUST) and Triya in the user's settings (preferences.ts
// `customDictionary`). The Check Spelling dialog sends it to SPELL with each button and keeps
// what SPELL sends back (Add to Dictionary, Undo); its Dictionaries dialog adds, deletes and
// imports words.
import { CUSTOM_WORD_MAX } from '@triya/engine';

/** A dictionary bigger than this is cut, so the settings record stays small. */
export const CUSTOM_WORDS_MAX = 5000;

/** A word a custom dictionary takes: no spaces, at most 63 characters ("Dictionaries Dialog Box"). */
export const validWord = (w: string): boolean =>
  w !== '' && w.length <= CUSTOM_WORD_MAX && !/\s/.test(w);

/** Stored words: those not a word, and repeats whatever their case, left out. */
export function normalizeWords(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of raw) {
    if (typeof w !== 'string' || !validWord(w) || seen.has(w.toLowerCase())) continue;
    seen.add(w.toLowerCase());
    out.push(w);
    if (out.length === CUSTOM_WORDS_MAX) break;
  }
  return out;
}

/** The words of a word list file (Import): one or more to a line, a .cus file's `*` lines skipped. */
export const wordsOfFile = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('*'))
    .flatMap((line) => line.split(/\s+/))
    .filter(validWord);

class CustomDictionary {
  #words: readonly string[] = [];
  #persist: (words: readonly string[]) => void = () => undefined;

  get words(): readonly string[] {
    return this.#words;
  }

  /** The stored words (as they load or change) and where a change is saved. */
  bind(words: readonly string[], persist: (words: readonly string[]) => void): void {
    this.#words = words;
    this.#persist = persist;
  }

  set(words: readonly string[]): void {
    const next = normalizeWords(words);
    if (JSON.stringify(next) === JSON.stringify(this.#words)) return;
    this.#words = next;
    this.#persist(next);
  }
}

export const customDictionary = new CustomDictionary();
