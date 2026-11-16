// The spelling dictionary SPELL checks with (M4-09 part 4): a Hunspell dictionary (an affix and
// a word file) read by nspell (MIT). The app bundles Hunspell's en_US dictionary from SCOWL
// (`assets/dictionaries/en-US`, permissive licence, ATTRIBUTION.md) and loads it in the engine
// worker when SPELL first runs; tests read the same files.
import nspell from 'nspell';

/** A Hunspell dictionary's files, and the name the Check Spelling dialog lists it by. */
export interface HunspellDictionary {
  readonly name: string;
  readonly aff: string;
  readonly dic: string;
}

/** The suggestions listed for a word: the likeliest first. */
export const SUGGESTIONS_MAX = 12;

/** A spell checker (the engine's `SpellChecker`) over a Hunspell dictionary. */
export function hunspellChecker(d: HunspellDictionary): {
  readonly name: string;
  correct(word: string): boolean;
  suggest(word: string): readonly string[];
} {
  const spell = nspell(d.aff, d.dic);
  return {
    name: d.name,
    correct: (word) => spell.correct(word),
    suggest: (word) => spell.suggest(word).slice(0, SUGGESTIONS_MAX),
  };
}
