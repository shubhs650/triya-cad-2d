// M4-09 part 4: SPELL's custom dictionary as the user's settings keep it.
import { describe, expect, it } from 'vitest';
import {
  CUSTOM_WORDS_MAX,
  customDictionary,
  normalizeWords,
  validWord,
  wordsOfFile,
} from '../src/custom-dictionary';
import { normalizePreferences } from '../src/preferences';

describe('custom dictionary', () => {
  it('keeps words: no spaces, at most 63 characters, each once whatever its case', () => {
    expect(validWord('Triya')).toBe(true);
    expect(validWord('')).toBe(false);
    expect(validWord('two words')).toBe(false);
    expect(validWord('x'.repeat(64))).toBe(false);
    expect(normalizeWords(['ASTM', 'astm', 3, 'two words', 'Triya'])).toEqual(['ASTM', 'Triya']);
    expect(normalizeWords('ASTM')).toEqual([]);
    const many = Array.from({ length: CUSTOM_WORDS_MAX + 5 }, (_, i) => `w${i}`);
    expect(normalizeWords(many)).toHaveLength(CUSTOM_WORDS_MAX);
  });

  it('is part of the stored settings', () => {
    expect(normalizePreferences({}).customDictionary).toEqual([]);
    expect(normalizePreferences({ customDictionary: ['ASTM', 'ASTM'] }).customDictionary).toEqual([
      'ASTM',
    ]);
  });

  it('imports a word list or a .cus file', () => {
    expect(wordsOfFile('*header\r\nASTM ANSI\n\nTriya\n')).toEqual(['ASTM', 'ANSI', 'Triya']);
  });

  it('saves a change, and only a change', () => {
    const saved: (readonly string[])[] = [];
    customDictionary.bind(['ASTM'], (w) => saved.push(w));
    customDictionary.set(['ASTM']);
    customDictionary.set(['ASTM', 'Triya', 'triya']);
    expect(customDictionary.words).toEqual(['ASTM', 'Triya']);
    expect(saved).toEqual([['ASTM', 'Triya']]);
  });
});
