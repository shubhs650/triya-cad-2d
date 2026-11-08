// M2-01: the engine's alias table (`ALIASES`, packages/engine/src/commands/aliases.ts) is the
// alias column of docs/COMMANDS.md, which is normative. Every alias the document gives must
// name its row's command, and every alias in the table must be in the document.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ALIASES, CommandRegistry } from '@triya/engine';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const doc = readFileSync(path.join(root, 'docs/COMMANDS.md'), 'utf8');

interface Row {
  readonly names: readonly string[];
  readonly aliases: readonly { readonly alias: string; readonly target?: string }[];
}

/** The command rows whose second column is the aliases. */
function rows(): Row[] {
  const out: Row[] = [];
  let aliasColumn = false;
  for (const line of doc.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells[0] === 'Command') {
      aliasColumn = cells[1] === 'Aliases';
      continue;
    }
    if (!aliasColumn || /^-+$/.test(cells[0] ?? '')) continue;
    const names = cells[0]!
      .replace(/\(.*?\)|ᵀ/g, '')
      .split('/')
      .map((n) => n.trim())
      .filter((n) => /^-?[A-Z]+$/.test(n));
    const aliases = cells[1]!
      .split(/[/,]/)
      .map((a) => a.trim().replace(/…$/, ''))
      .filter((a) => a !== '—' && a !== '' && !/^Ctrl\+|^F\d+$/.test(a))
      .map((a) => {
        const [alias, target] = a.split('→');
        return target ? { alias: alias!, target } : { alias: alias! };
      });
    if (names.length > 0) out.push({ names, aliases });
  }
  return out;
}

describe('docs/COMMANDS.md aliases', () => {
  const registry = new CommandRegistry();
  const documented = rows();

  it('finds the command tables', () => {
    expect(documented.length).toBeGreaterThan(100);
    expect(documented.find((r) => r.names.includes('LINE'))?.aliases).toEqual([{ alias: 'L' }]);
  });

  it('names its row command for every documented alias', () => {
    const wrong: string[] = [];
    for (const row of documented) {
      for (const { alias, target } of row.aliases) {
        // "UNDO / U | U": U is a command of its own, not an alias.
        if (row.names.includes(alias)) continue;
        const command = registry.alias(alias);
        const allowed = target ? [target] : row.names;
        if (!command || !allowed.includes(command)) {
          wrong.push(`${alias} → ${command ?? 'nothing'} (COMMANDS.md: ${allowed.join(' / ')})`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('documents every alias in the table', () => {
    const inDoc = new Set(documented.flatMap((r) => r.aliases.map((a) => a.alias)));
    expect(Object.keys(ALIASES).filter((a) => !inDoc.has(a))).toEqual([]);
  });
});
