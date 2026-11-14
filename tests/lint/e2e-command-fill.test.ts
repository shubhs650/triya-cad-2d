// M2-75: UI specs never `fill` the command line themselves. A fill replaces the field's text at
// once, while the keys typed ahead of a prompt not shown yet are held and replayed in order
// (M2-71, #343): a fill made while the engine still reads the input before replaced that input's
// text, and export.spec.ts lost a point and repeated LINE in CI. `enterCommand` in
// tests/e2e/app/page.ts waits until the engine has read every input sent, then fills.
// Keys typed with `page.keyboard` are held in order and need no wait.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const e2e = path.join(root, 'tests/e2e');
const HELPERS = path.join(e2e, 'app/page.ts');

const COMMAND_INPUT = /getByLabel\(\s*'Command',\s*\{\s*exact:\s*true\s*\}\s*\)/;

function specs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return specs(p);
    return /\.ts$/.test(e.name) ? [p] : [];
  });
}

/** Lines of `source` that fill the command line: directly, or through a name bound to it. */
export function commandFills(source: string): number[] {
  const names = new Set<string>();
  const bind = new RegExp(`(?:const|let)\\s+(\\w+)\\s*=\\s*page\\.${COMMAND_INPUT.source}`, 'g');
  for (const m of source.matchAll(bind)) names.add(m[1]!);
  const lines: number[] = [];
  source.split('\n').forEach((line, i) => {
    const direct = new RegExp(`${COMMAND_INPUT.source}\\s*\\.fill\\(`).test(line);
    const named = [...names].some((n) => new RegExp(`\\b${n}\\.fill\\(`).test(line));
    if (direct || named) lines.push(i + 1);
  });
  return lines;
}

describe('UI specs enter commands through enterCommand (M2-75)', () => {
  it('finds a fill of the command line, direct or through a name', () => {
    expect(
      commandFills(
        [
          "  const input = page.getByLabel('Command', { exact: true });",
          "  await input.fill('PLOT');",
          "  await page.getByLabel('Command', { exact: true }).fill('U');",
          "  await d.getByLabel('File name').fill('window');",
        ].join('\n'),
      ),
    ).toEqual([2, 3]);
  });

  it('no spec fills the command line but the shared helper', () => {
    const found = specs(e2e)
      .filter((f) => f !== HELPERS)
      .flatMap((f) =>
        commandFills(readFileSync(f, 'utf8')).map((l) => `${path.relative(root, f)}:${l}`),
      );
    expect(found).toEqual([]);
  });
});
