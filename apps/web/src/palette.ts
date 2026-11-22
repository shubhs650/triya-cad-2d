// The Ctrl+K palette's search (M2-02 part 2, UI_SPEC.md §5, FR-C3): fuzzy search over the
// commands (with their aliases) and the app's settings and windows. Discoverability only: a
// command found here runs exactly as typed at the command line would.
import type { CommandRegistry } from '@triya/engine';

export interface PaletteItem {
  /** What runs: a command name, or an app action's id. */
  readonly id: string;
  readonly kind: 'command' | 'action';
  readonly label: string;
  /** The aliases of a command: `L`, `Z` (acad.pgp's, and the user alias file's, M3-10). */
  readonly aliases: readonly string[];
  /** Its keyboard shortcut: `F2`, `F12`, `Ctrl+O`. */
  readonly keys?: string;
  /** What it is, shown beside it: Command, View, Drafting, Options, Drawing (M7-06 part 2). */
  readonly group?: string;
  /**
   * Words it is found by but does not show: what a settings window holds (M7-06 part 2). Each
   * matches whole, or as the start of a word typed, as aliases do.
   */
  readonly keywords?: readonly string[];
}

/** The registered commands, each with the aliases that name it now and its keys, if any. */
export function commandItems(
  registry: CommandRegistry,
  keysOf: (name: string) => string = () => '',
): PaletteItem[] {
  return registry.names().map((name) => {
    const keys = keysOf(name);
    return {
      id: name,
      kind: 'command',
      label: name,
      aliases: registry.aliasesOf(name),
      ...(keys !== '' && { keys }),
    };
  });
}

/** How `query` matched a text: its score and the indexes of the letters matched. */
export interface FuzzyMatch {
  readonly score: number;
  readonly at: readonly number[];
}

/**
 * How well `query` matches `text`, or undefined: its letters in order, case ignored. Whole
 * matches beat prefixes, which beat matches at word starts, which beat scattered letters. `at`
 * names the letters matched, for the palette to mark them (M7-06 part 2).
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | undefined {
  const q = query.trim().toUpperCase();
  const t = text.toUpperCase();
  if (q === '') return { score: 0, at: [] };
  const run = (n: number) => Array.from({ length: n }, (_, i) => i);
  if (t === q) return { score: 1000, at: run(q.length) };
  if (t.startsWith(q)) return { score: 500 - t.length, at: run(q.length) };
  let score = 0;
  let at = -1;
  const found: number[] = [];
  const wordStart = (i: number) => i === 0 || /[^A-Z0-9]/.test(t[i - 1]!);
  for (const c of q) {
    // The next letter, else the letter at the next word start, else the next one anywhere.
    let next = t[at + 1] === c ? at + 1 : -1;
    if (next >= 0) score += 8;
    else {
      for (let i = t.indexOf(c, at + 1); i >= 0; i = t.indexOf(c, i + 1)) {
        if (wordStart(i)) {
          next = i;
          break;
        }
      }
      if (next >= 0) score += 6;
      else {
        next = t.indexOf(c, at + 1);
        if (next < 0) return undefined;
        score += 1;
      }
    }
    at = next;
    found.push(next);
  }
  return { score: score - t.length / 100, at: found };
}

/** `fuzzyMatch`'s score alone. */
export function fuzzyScore(query: string, text: string): number | undefined {
  return fuzzyMatch(query, text)?.score;
}

/** The letters of an item's label `query` matched, to mark; none when only an alias did. */
export function matchedLetters(item: PaletteItem, query: string): readonly number[] {
  return fuzzyMatch(query, item.label)?.at ?? [];
}

/** The most items the palette remembers as run last (M7-06 part 2). */
export const PALETTE_RECENT_MAX = 8;

/** The items run last, newest first: `id` first, once. */
export function rememberRun(recent: readonly string[], id: string): readonly string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, PALETTE_RECENT_MAX);
}

/** The kept list of items run last, as the preferences hold it: ids only, each once. */
export function normalizePaletteRecent(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter((r): r is string => typeof r === 'string' && r !== '' && r.length <= 260);
  return [...new Set(ids)].slice(0, PALETTE_RECENT_MAX);
}

/** The items with those run last first, newest first (ids no longer listed are skipped). */
export function recentFirst(
  items: readonly PaletteItem[],
  recent: readonly string[],
): PaletteItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const first = recent.flatMap((id) => byId.get(id) ?? []);
  const shown = new Set(first);
  return [...first, ...items.filter((i) => !shown.has(i))];
}

/** The items matching `query`, best first; an exact alias counts as the whole name. */
export function rankItems(items: readonly PaletteItem[], query: string): PaletteItem[] {
  if (query.trim() === '') return [...items];
  const scored: [PaletteItem, number][] = [];
  for (const item of items) {
    const scores = [item.label, ...item.aliases]
      .map((t, i) => {
        const s = fuzzyScore(query, t);
        // An alias matches only whole (Z is ZOOM), or it would drown the names' matches.
        return i === 0 ? s : s === 1000 ? 900 : undefined;
      })
      .filter((s): s is number => s !== undefined);
    const q = query.trim().toUpperCase();
    for (const k of item.keywords ?? []) {
      // A keyword whole ranks under a name's prefix; begun (three letters or more), under a
      // name's letters at word starts ("recent" finds Open recent: before Options: Open and
      // Save's Recently-used files) but above scattered letters.
      const word = k.toUpperCase();
      if (word === q) scores.push(450);
      else if (q.length >= 3 && word.startsWith(q)) scores.push(2 * q.length - word.length / 100);
    }
    if (scores.length > 0) scored.push([item, Math.max(...scores)]);
  }
  return scored.sort((a, b) => b[1] - a[1]).map(([item]) => item);
}
