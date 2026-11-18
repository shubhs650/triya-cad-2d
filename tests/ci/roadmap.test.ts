// docs/ROADMAP.md keeps a blank line between task entries (CLAUDE.md "Avoiding merge conflicts").
//
// Every task is one long line, and parallel threads edit their own task's line (claim, part
// notes, PR numbers). Git treats edits to two *adjacent* lines as one conflict even when they
// belong to different tasks: on 2026-11-17/18, 19 of the 32 conflicted merges of main into a
// task branch were docs/ROADMAP.md, and every one was two neighbouring tasks (M5-04 against
// M5-05, M5-08 against M5-09, ...). One unchanged blank line between entries lets git merge
// such edits on its own.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const roadmap = readFileSync(new URL('../../docs/ROADMAP.md', import.meta.url), 'utf8');

const TASK = /^- \[.\]/;
const id = (line: string) => /\*\*([A-Z0-9]+-[0-9A-Z]+)\*\*/.exec(line)?.[1] ?? line.slice(0, 40);

/**
 * Pairs still adjacent when the separators were added (2026-11-18): the lines open PRs were
 * editing then (M5-03 #540, M5-04 #541, M5-09 #536), left alone so those PRs would not conflict
 * with the change. May only shrink: separate a pair and delete it here.
 */
const STILL_ADJACENT = [
  'M5-02 / M5-03',
  'M5-03 / M5-04',
  'M5-04 / M5-05',
  'M5-08 / M5-09',
  'M5-09 / M5-10',
];

describe('docs/ROADMAP.md layout', () => {
  const lines = roadmap.split('\n');
  const adjacent = lines.flatMap((line, i) =>
    i > 0 && TASK.test(line) && TASK.test(lines[i - 1]!)
      ? [`${id(lines[i - 1]!)} / ${id(line)}`]
      : [],
  );

  it('has a blank line between task entries, so edits to neighbouring tasks merge cleanly', () => {
    expect(adjacent.filter((pair) => !STILL_ADJACENT.includes(pair))).toEqual([]);
  });

  it('lists only pairs that are still adjacent as exceptions', () => {
    expect(STILL_ADJACENT.filter((pair) => !adjacent.includes(pair))).toEqual([]);
  });
});
