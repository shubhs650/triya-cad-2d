// As-you-type spell checking in the in-place text editors (M4-17; AutoCAD 2024 Help, "To Check
// Spelling As You Type" and the Text Editor contextual tab's Spell Check panel): while TEXT's
// line or MTEXT's editor is open, the words in neither dictionary are underlined, and a
// right-click on one offers the main dictionary's suggestions, Add to Dictionary and Ignore All.
// The words and the dictionaries are SPELL's (M4-09 part 4): `spellingWords` cuts the text, the
// bundled Hunspell en_US dictionary and the user's custom dictionary (custom-dictionary.ts)
// judge them.
//
// The dictionary loads in a worker of its own the first time an editor opens with the check on
// (it takes a few hundred milliseconds to build, which typing should not wait on), and the
// verdict for each word is kept for the session, so the worker is asked once a word.
//
// Where AutoCAD's documentation is silent (the most common drafter expectation is taken):
// - The word the caret ends, while typing, is not underlined until the caret leaves it, as word
//   processors do: "dimen" is not flagged on the way to "dimension".
// - Ignore All passes the word, as it is spelled, in every editor until the app is closed (SPELL's
//   Ignore All is for that SPELL only); Add to Dictionary is SPELL's, whatever the case.
// - The check is on by default (AutoCAD's Spell Check button starts on) and the setting is the
//   user's, kept with their settings (preferences.ts `spellCheck`).
// - SPELL's Settings (ignore capitalized words and the like) are SPELL's own: the editors check
//   every word, as SPELL does by default.
import { DEFAULT_SPELL_OPTIONS, spellingWords, type SpellWord } from '@triya/engine';
import { customDictionary } from './custom-dictionary';
import type { LinePart } from './text-editor';

/** The dictionary, wherever it runs (a worker in the app, a stand-in in tests). */
export interface SpellBackend {
  /** Whether the main dictionary has each word. */
  correct(words: readonly string[]): Promise<readonly boolean[]>;
  /** The main dictionary's suggestions for a word, the likeliest first. */
  suggest(word: string): Promise<readonly string[]>;
}

/** The suggestions a right-click lists at most, as AutoCAD's shortcut menu shows a few. */
export const MENU_SUGGESTIONS = 6;

/**
 * The words of `shown` to check: SPELL's words, less the one ending at a collapsed caret (the
 * word being typed). A stack, field or line break in `shown` is a character that ends a word.
 */
export function wordsToCheck(shown: string, caret: number | undefined): SpellWord[] {
  return spellingWords(shown, DEFAULT_SPELL_OPTIONS).filter((w) => w.end !== caret);
}

/**
 * What TEXT's line shows, for its words: a `%%` code (`%%u`, `%%c`, `%%127`) and a field's
 * value are no words, so each is a run of breaks as long as it shows; every other character
 * keeps its place, so a word's offsets are the line's.
 */
export function lineSpellText(parts: readonly LinePart[]): string {
  return parts
    .map((p) =>
      'text' in p
        ? p.text.replace(/%%(\d{3}|[^%]|%(?!%))/g, (m) => '\0'.repeat(m.length))
        : '\0'.repeat(p.value.length),
    )
    .join('');
}

export class EditorSpelling {
  readonly #make: () => SpellBackend;
  #backend: SpellBackend | undefined;
  /** The main dictionary's verdict on each word asked about. */
  readonly #known = new Map<string, boolean>();
  /** Ignore All's words, as spelled. */
  readonly #ignored = new Set<string>();
  #enabled = true;
  #persist: (on: boolean) => void = () => undefined;
  readonly #listeners = new Set<() => void>();
  #version = 0;

  constructor(make: () => SpellBackend) {
    this.#make = make;
    customDictionary.subscribe(() => this.#tell());
  }

  subscribe = (l: () => void): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };

  /** Changes each time what is underlined may change (useSyncExternalStore's snapshot). */
  version = (): number => this.#version;

  get enabled(): boolean {
    return this.#enabled;
  }

  /** The user's setting (as it loads or changes) and where a change is saved. */
  bind(enabled: boolean, persist: (on: boolean) => void): void {
    this.#persist = persist;
    if (enabled === this.#enabled) return;
    this.#enabled = enabled;
    this.#tell();
  }

  /** The Spell Check button. */
  setEnabled(on: boolean): void {
    if (on === this.#enabled) return;
    this.#enabled = on;
    this.#persist(on);
    this.#tell();
  }

  /** The words of `words` to underline; none while the check is off. */
  async misspelled(words: readonly SpellWord[]): Promise<SpellWord[]> {
    if (!this.#enabled) return [];
    const ask = [
      ...new Set(words.map((w) => w.word).filter((w) => !this.#ours(w) && !this.#known.has(w))),
    ];
    if (ask.length > 0) {
      try {
        const verdicts = await this.#dictionary().correct(ask);
        ask.forEach((w, i) => this.#known.set(w, verdicts[i] ?? true));
      } catch {
        // No dictionary (the worker failed to load): nothing is underlined.
        return [];
      }
    }
    return words.filter((w) => !this.#ours(w.word) && this.#known.get(w.word) === false);
  }

  /** The main dictionary's suggestions for a right-clicked word. */
  async suggestions(word: string): Promise<readonly string[]> {
    try {
      return (await this.#dictionary().suggest(word)).slice(0, MENU_SUGGESTIONS);
    } catch {
      return [];
    }
  }

  ignoreAll(word: string): void {
    this.#ignored.add(word);
    this.#tell();
  }

  /** Add to Dictionary: the custom dictionary SPELL uses, which tells the editors itself. */
  addToDictionary(word: string): void {
    customDictionary.set([...customDictionary.words, word]);
  }

  /** Whether Ignore All or the custom dictionary passes the word. */
  #ours(word: string): boolean {
    if (this.#ignored.has(word)) return true;
    const lower = word.toLowerCase();
    return customDictionary.words.some((c) => c.toLowerCase() === lower);
  }

  #dictionary(): SpellBackend {
    return (this.#backend ??= this.#make());
  }

  #tell(): void {
    this.#version++;
    for (const l of this.#listeners) l();
  }
}

/** What spell-worker.ts is asked; each request also carries its `id`. */
type SpellAsk =
  | { readonly op: 'correct'; readonly words: readonly string[] }
  | { readonly op: 'suggest'; readonly word: string };

/** The spelling worker (spell-worker.ts), started on first use. */
function workerBackend(): SpellBackend {
  const worker = new Worker(new URL('./spell-worker.ts', import.meta.url), { type: 'module' });
  let next = 0;
  const waiting = new Map<number, { ok(v: unknown): void; fail(e: Error): void }>();
  worker.addEventListener('message', (e: MessageEvent<{ id: number; result: unknown }>) => {
    waiting.get(e.data.id)?.ok(e.data.result);
    waiting.delete(e.data.id);
  });
  worker.addEventListener('error', () => {
    for (const w of waiting.values()) w.fail(new Error('the spelling dictionary did not load'));
    waiting.clear();
  });
  const ask = <T>(request: SpellAsk): Promise<T> =>
    new Promise<T>((ok, fail) => {
      const id = ++next;
      waiting.set(id, { ok: ok as (v: unknown) => void, fail });
      worker.postMessage({ ...request, id });
    });
  return {
    correct: (words) => ask({ op: 'correct', words }),
    suggest: (word) => ask({ op: 'suggest', word }),
  };
}

export const editorSpelling = new EditorSpelling(workerBackend);
