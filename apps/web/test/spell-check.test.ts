// M4-17: as-you-type spell checking in the in-place text editors. The word rules are SPELL's
// (packages/engine/test/edit/spelling.test.ts); these check what the editors add: the word being
// typed waits, the dictionary is asked once per word, Ignore All and Add to Dictionary take a word
// out of every editor's underlines, the setting turns the check off, and a TEXT line's codes and
// fields are no words.
import { describe, expect, it, vi } from 'vitest';
import { customDictionary } from '../src/custom-dictionary';
import { normalizePreferences } from '../src/preferences';
import { EditorSpelling, lineSpellText, wordsToCheck, type SpellBackend } from '../src/spell-check';

const RIGHT = new Set(['the', 'door', 'frame', 'see', 'note', 'is', 'fire']);

function fake(): SpellBackend & { asked: string[][] } {
  const asked: string[][] = [];
  return {
    asked,
    correct: (words) => {
      asked.push([...words]);
      return Promise.resolve(words.map((w) => RIGHT.has(w.toLowerCase())));
    },
    suggest: (word) => Promise.resolve(word === 'dooor' ? ['door', 'odor'] : []),
  };
}

const words = (list: readonly { word: string }[]) => list.map((w) => w.word);

describe('as-you-type spell checking', () => {
  it('checks every word but the one being typed at the caret', () => {
    expect(words(wordsToCheck('The dooor is', undefined))).toEqual(['The', 'dooor', 'is']);
    // The caret at the end of "is": that word is still being typed.
    expect(words(wordsToCheck('The dooor is', 12))).toEqual(['The', 'dooor']);
    // A space typed after it: every word is done.
    expect(words(wordsToCheck('The dooor is ', 13))).toEqual(['The', 'dooor', 'is']);
    // The caret inside a word (a right-click there) leaves it checked.
    expect(words(wordsToCheck('The dooor is', 6))).toEqual(['The', 'dooor', 'is']);
  });

  it("leaves a TEXT line's %% codes and fields out, keeping the characters' places", () => {
    const line = lineSpellText([
      { text: '%%uNOTE %%c25 dooor ' },
      { code: '\\AcVar Date', value: 'Mondy' },
    ]);
    expect(line).toHaveLength('%%uNOTE %%c25 dooor Mondy'.length);
    expect(words(wordsToCheck(line, undefined))).toEqual(['NOTE', 'dooor']);
    expect(wordsToCheck(line, undefined)[1]).toMatchObject({ start: 14, end: 19 });
  });

  it('underlines the words neither dictionary has, asking the dictionary once a word', async () => {
    const backend = fake();
    const s = new EditorSpelling(() => backend);
    const found = await s.misspelled(wordsToCheck('The dooor FRAME dooor', undefined));
    expect(words(found)).toEqual(['dooor', 'dooor']);
    expect(backend.asked).toEqual([['The', 'dooor', 'FRAME']]);
    await s.misspelled(wordsToCheck('The dooor', undefined));
    expect(backend.asked).toHaveLength(1);
    expect(await s.suggestions('dooor')).toEqual(['door', 'odor']);
  });

  it('Ignore All passes the word in every editor, as it is spelled, and tells them', async () => {
    const s = new EditorSpelling(() => fake());
    const heard = vi.fn();
    const stop = s.subscribe(heard);
    s.ignoreAll('dooor');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(words(await s.misspelled(wordsToCheck('dooor Dooor', undefined)))).toEqual(['Dooor']);
    stop();
  });

  it("Add to Dictionary keeps the word in SPELL's custom dictionary, whatever its case", async () => {
    let stored: readonly string[] = [];
    customDictionary.bind([], (w) => (stored = w));
    const s = new EditorSpelling(() => fake());
    const heard = vi.fn();
    s.subscribe(heard);
    s.addToDictionary('Triya');
    expect(stored).toEqual(['Triya']);
    expect(heard).toHaveBeenCalled();
    expect(await s.misspelled(wordsToCheck('TRIYA triya', undefined))).toEqual([]);
    // A word added from SPELL's Dictionaries dialog reaches the editors too.
    heard.mockClear();
    customDictionary.set(['Triya', 'Mondy']);
    expect(heard).toHaveBeenCalled();
    customDictionary.bind([], () => undefined);
  });

  it('is on unless the user turned it off, and kept in their settings', async () => {
    const backend = fake();
    let saved: boolean | undefined;
    const s = new EditorSpelling(() => backend);
    expect(s.enabled).toBe(true);
    s.bind(true, (on) => (saved = on));
    s.setEnabled(false);
    expect(saved).toBe(false);
    expect(s.enabled).toBe(false);
    expect(await s.misspelled(wordsToCheck('dooor', undefined))).toEqual([]);
    expect(backend.asked).toEqual([]);
    expect(normalizePreferences({}).spellCheck).toBe(true);
    expect(normalizePreferences({ spellCheck: false }).spellCheck).toBe(false);
    expect(normalizePreferences({ spellCheck: 'no' }).spellCheck).toBe(true);
  });

  it('underlines nothing when the dictionary cannot load', async () => {
    const s = new EditorSpelling(() => ({
      correct: () => Promise.reject(new Error('no worker')),
      suggest: () => Promise.reject(new Error('no worker')),
    }));
    expect(await s.misspelled(wordsToCheck('dooor', undefined))).toEqual([]);
    expect(await s.suggestions('dooor')).toEqual([]);
  });
});
