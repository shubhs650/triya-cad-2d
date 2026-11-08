// The Ctrl+K palette's search (M2-02 part 2, UI_SPEC.md §5, FR-C3): fuzzy search over the
// commands (with their aliases) and the app's settings and windows. Discoverability only: a
// command found here runs exactly as typed at the command line would.
import { ALIASES, type CommandRegistry } from '@triya/engine';

export interface PaletteItem {
  /** What runs: a command name, or an app action's id. */
  readonly id: string;
  readonly kind: 'command' | 'action';
  readonly label: string;
  /** The acad.pgp aliases of a command: `L`, `Z`. */
  readonly aliases: readonly string[];
  /** Its keyboard shortcut: `F2`, `F12`, `Ctrl+O`. */
  readonly keys?: string;
}

/** The registered commands, each with the aliases that name it. */
export function commandItems(registry: CommandRegistry): PaletteItem[] {
  return registry.names().map((name) => ({
    id: name,
    kind: 'command',
    label: name,
    aliases: Object.entries(ALIASES)
      .filter(([, n]) => n === name)
      .map(([a]) => a)
      .sort(),
  }));
}

/**
 * How well `query` matches `text`, or undefined: its letters in order, case ignored. Whole
 * matches beat prefixes, which beat matches at word starts, which beat scattered letters.
 */
export function fuzzyScore(query: string, text: string): number | undefined {
  const q = query.trim().toUpperCase();
  const t = text.toUpperCase();
  if (q === '') return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500 - t.length;
  let score = 0;
  let at = -1;
  const wordStart = (i: number) => i === 0 || /[^A-Z0-9]/.test(t[i - 1]!);
  for (const c of q) {
    // The next letter, else the letter at the next word start, else the next one anywhere.
    let found = t[at + 1] === c ? at + 1 : -1;
    if (found >= 0) score += 8;
    else {
      for (let i = t.indexOf(c, at + 1); i >= 0; i = t.indexOf(c, i + 1)) {
        if (wordStart(i)) {
          found = i;
          break;
        }
      }
      if (found >= 0) score += 6;
      else {
        found = t.indexOf(c, at + 1);
        if (found < 0) return undefined;
        score += 1;
      }
    }
    at = found;
  }
  return score - t.length / 100;
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
    if (scores.length > 0) scored.push([item, Math.max(...scores)]);
  }
  return scored.sort((a, b) => b[1] - a[1]).map(([item]) => item);
}
