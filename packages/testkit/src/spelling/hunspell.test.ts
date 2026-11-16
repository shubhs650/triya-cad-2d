// M4-09 part 4: the bundled spelling dictionary SPELL checks with (`assets/dictionaries/en-US`,
// Hunspell's en_US from SCOWL, read by nspell): words, their inflections and case, and
// suggestions for a word misspelled.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SUGGESTIONS_MAX, hunspellChecker } from '@triya/text';

const asset = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../../assets/dictionaries/en-US/${name}`, import.meta.url)),
    'utf8',
  );

const checker = hunspellChecker({
  name: 'American English',
  aff: asset('en_US.aff'),
  dic: asset('en_US.dic'),
});

describe('hunspellChecker', () => {
  it('knows words, their inflections and their capitals', () => {
    expect(checker.name).toBe('American English');
    for (const w of ['door', 'Doors', 'DOOR', 'schedule', 'gypsum', "don't", 'drywall', '10th']) {
      expect(checker.correct(w), w).toBe(true);
    }
    for (const w of ['dore', 'scedule', 'DIMENSOIN']) expect(checker.correct(w), w).toBe(false);
  });

  it('suggests what a word misspelled may be, in its case, at most a dozen', () => {
    expect(checker.suggest('scedule')).toContain('schedule');
    expect(checker.suggest('SCEDULE')).toContain('SCHEDULE');
    expect(checker.suggest('dimensoin')[0]).toBe('dimension');
    expect(checker.suggest('M12').length).toBeLessThanOrEqual(SUGGESTIONS_MAX);
  });
});
