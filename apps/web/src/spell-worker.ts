// The as-you-type spell check's dictionary (M4-17, spell-check.ts): SPELL's bundled Hunspell
// en_US dictionary, built off the main thread so typing never waits on it. Answers each request
// with its id: whether each word is spelled right, or a word's suggestions.
import { checker } from './engine/spelling';

const dictionary = checker();

self.addEventListener(
  'message',
  (
    e: MessageEvent<
      | { readonly id: number; readonly op: 'correct'; readonly words: readonly string[] }
      | { readonly id: number; readonly op: 'suggest'; readonly word: string }
    >,
  ) => {
    const r = e.data;
    const result =
      r.op === 'correct' ? r.words.map((w) => dictionary.correct(w)) : dictionary.suggest(r.word);
    self.postMessage({ id: r.id, result });
  },
);
