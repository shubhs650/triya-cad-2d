// M4-09 part 4: the words SPELL checks in a text as it shows (AutoCAD 2024 Help, "Check
// Spelling Settings Dialog Box"): runs of letters cut at spaces, hyphens and slashes, with the
// punctuation around them left off; the Ignore options leave words out by their case, digits
// and punctuation.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPELL_OPTIONS,
  misspelledWords,
  spellingWords,
  type SpellOptions,
} from '../../src/index';

const words = (shown: string, o: Partial<SpellOptions> = {}) =>
  spellingWords(shown, { ...DEFAULT_SPELL_OPTIONS, ...o }).map((w) => w.word);

describe('spellingWords', () => {
  it('cuts a text into words, the punctuation around them left off', () => {
    expect(words('"Doors," (see note 3) don’t open.')).toEqual([
      'Doors',
      'see',
      'note',
      'don’t',
      'open',
    ]);
    // Where each word is, in the characters shown.
    expect(spellingWords('  (fire door)', DEFAULT_SPELL_OPTIONS)).toEqual([
      { start: 3, end: 7, word: 'fire' },
      { start: 8, end: 12, word: 'door' },
    ]);
  });

  it('checks each part of a hyphenated or slashed word; numbers are no words', () => {
    expect(words('cross-section and/or 25 1/2 3.5mm')).toEqual([
      'cross',
      'section',
      'and',
      'or',
      '3.5mm',
    ]);
  });

  it('a line break, a measurement or a field ends a word', () => {
    expect(words('fire\ndoor￼frame')).toEqual(['fire', 'door', 'frame']);
  });

  it('the Ignore options leave words out by case, digits and punctuation', () => {
    const text = 'Smith ASTM iPhone M12 e.g. R&D plain';
    expect(words(text)).toEqual(['Smith', 'ASTM', 'iPhone', 'M12', 'e.g', 'R&D', 'plain']);
    expect(words(text, { ignoreCapitalized: true })).not.toContain('Smith');
    expect(words(text, { ignoreUppercase: true })).toEqual(['Smith', 'iPhone', 'e.g', 'plain']);
    expect(words(text, { ignoreMixed: true })).toEqual([
      'Smith',
      'ASTM',
      'M12',
      'e.g',
      'R&D',
      'plain',
    ]);
    expect(words(text, { ignoreNumbers: true })).not.toContain('M12');
    expect(words(text, { ignorePunctuation: true })).toEqual([
      'Smith',
      'ASTM',
      'iPhone',
      'M12',
      'plain',
    ]);
    // A single capital is an uppercase word, not a capitalized one.
    expect(words('A note', { ignoreCapitalized: true })).toEqual(['A', 'note']);
    expect(words('A note', { ignoreUppercase: true })).toEqual(['note']);
  });
});

describe('misspelledWords', () => {
  const known = new Set(['fire', 'door', 'see', 'note']);
  const accept = (w: string) => known.has(w.toLowerCase());

  it('finds the words not accepted in a stored string, read as it shows', () => {
    // MTEXT codes show nothing; `\P` is a line break.
    const found = misspelledWords(
      '{\\fArial|b1;Fire} dore\\Psee nott',
      'mtext',
      DEFAULT_SPELL_OPTIONS,
      accept,
    );
    expect(found).toEqual([
      { start: 5, end: 9, word: 'dore' },
      { start: 14, end: 18, word: 'nott' },
    ]);
    // A dimension's measurement is never a word.
    expect(misspelledWords('<> dore', 'dimension', DEFAULT_SPELL_OPTIONS, accept)).toEqual([
      { start: 2, end: 6, word: 'dore' },
    ]);
    // TEXT's %%d shows a degree sign.
    expect(misspelledWords('90%%d dore', 'text', DEFAULT_SPELL_OPTIONS, accept)).toEqual([
      { start: 4, end: 8, word: 'dore' },
    ]);
  });
});
