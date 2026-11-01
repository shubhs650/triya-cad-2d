/**
 * Changelog fragments. Every PR adds one file under changes/ (for example changes/M1-04.md)
 * instead of a line at the top of CHANGELOG.md, so parallel PRs never conflict on the
 * changelog. This script assembles them.
 *
 *   pnpm changelog                    print CHANGELOG.md with the fragments under "Unreleased"
 *   pnpm changelog:check              validate changes/ and CHANGELOG.md (CI runs this)
 *   pnpm changelog --release 1.0.0    fold the fragments into "## 1.0.0 (date)" and delete them
 *
 * Runs under Node's TypeScript type stripping; no build step.
 */
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRAGMENT_DIR = 'changes';
const README = 'README.md';

// A roadmap task id (optionally split into parts), or `infra-<slug>` for work outside the roadmap.
const NAME = /^(M\d+-(\d{2}|GO)(-part-\d+)?|infra-[a-z0-9]+(-[a-z0-9]+)*)\.md$/;
const PR_REF = /\(#(\d+)\)/;

export interface Fragment {
  name: string;
  text: string;
}

export function validateFragment(name: string, text: string): string[] {
  const errors: string[] = [];
  if (!NAME.test(name)) {
    errors.push(
      `${name}: name must be <task-id>.md (e.g. M1-04.md, M1-04-part-2.md, M0-GO.md) or infra-<slug>.md`,
    );
  }
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0)
    errors.push(`${name}: empty; add one "- <task> (#PR): <what changed>" line`);
  if (lines[0] !== undefined && !lines[0].startsWith('- ')) {
    errors.push(`${name}: must start with a "- " bullet`);
  }
  for (const line of lines) {
    if (!line.startsWith('- ') && !line.startsWith('  ')) {
      errors.push(
        `${name}: "${line.slice(0, 40)}" is neither a bullet nor an indented continuation`,
      );
    }
    if (line.startsWith('- ') && !PR_REF.test(line)) {
      errors.push(`${name}: entry "${line.slice(0, 40)}" needs its PR number as (#N)`);
    }
  }
  return errors;
}

/** One bullet per entry (continuations joined back), newest PR first; ties by file name. */
export function assembleEntries(fragments: Fragment[]): string[] {
  const entries: { pr: number; name: string; text: string }[] = [];
  for (const f of fragments) {
    for (const block of f.text.trimEnd().split(/\n(?=- )/)) {
      const pr = Number(PR_REF.exec(block)?.[1] ?? 0);
      entries.push({ pr, name: f.name, text: block.trimEnd() });
    }
  }
  entries.sort((a, b) => b.pr - a.pr || a.name.localeCompare(b.name));
  return entries.map((e) => e.text);
}

function splitAtUnreleased(changelog: string): { head: string; tail: string } {
  const marker = '## Unreleased\n';
  const at = changelog.indexOf(marker);
  if (at < 0) throw new Error('CHANGELOG.md has no "## Unreleased" heading');
  const afterHeading = at + marker.length;
  const next = changelog.indexOf('\n## ', afterHeading);
  const end = next < 0 ? changelog.length : next + 1;
  return { head: changelog.slice(0, end).trimEnd() + '\n', tail: changelog.slice(end) };
}

/** The changelog as it would read today: fragments listed under "Unreleased". */
export function renderChangelog(changelog: string, entries: string[]): string {
  const { head, tail } = splitAtUnreleased(changelog);
  const body = entries.length > 0 ? entries.join('\n') + '\n' : '';
  return head + body + (tail ? '\n' + tail : '');
}

/** Release: entries become a dated version section right below "Unreleased". */
export function releaseChangelog(
  changelog: string,
  entries: string[],
  version: string,
  date: string,
): string {
  const { head, tail } = splitAtUnreleased(changelog);
  return `${head}\n## ${version} (${date})\n${entries.join('\n')}\n${tail ? '\n' + tail : ''}`;
}

export function readFragments(root: string): Fragment[] {
  return readdirSync(path.join(root, FRAGMENT_DIR))
    .filter((name) => name !== README)
    .sort()
    .map((name) => ({ name, text: readFileSync(path.join(root, FRAGMENT_DIR, name), 'utf8') }));
}

/** Errors that should fail CI: bad fragments, or entries hand-added under "Unreleased". */
export function checkRepo(root: string): string[] {
  const errors = readFragments(root).flatMap((f) => validateFragment(f.name, f.text));
  const { head } = splitAtUnreleased(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));
  for (const line of head.split('## Unreleased\n')[1]?.split('\n') ?? []) {
    if (line.startsWith('- ')) {
      errors.push(
        `CHANGELOG.md: "${line.slice(0, 40)}" is under Unreleased; move it to ${FRAGMENT_DIR}/<task-id>.md`,
      );
    }
  }
  return errors;
}

function main(argv: string[]): number {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const changelogPath = path.join(root, 'CHANGELOG.md');
  if (argv.includes('--check')) {
    const errors = checkRepo(root);
    for (const e of errors) console.error(e);
    if (errors.length === 0) console.log(`[changelog] ${readFragments(root).length} fragments OK`);
    return errors.length === 0 ? 0 : 1;
  }
  const fragments = readFragments(root);
  const entries = assembleEntries(fragments);
  const changelog = readFileSync(changelogPath, 'utf8');
  const releaseAt = argv.indexOf('--release');
  if (releaseAt >= 0) {
    const version = argv[releaseAt + 1];
    if (!version) throw new Error('usage: pnpm changelog --release <version>');
    const errors = checkRepo(root);
    if (errors.length > 0) throw new Error(errors.join('\n'));
    const date = new Date().toISOString().slice(0, 10);
    writeFileSync(changelogPath, releaseChangelog(changelog, entries, version, date));
    for (const f of fragments) unlinkSync(path.join(root, FRAGMENT_DIR, f.name));
    console.log(`[changelog] released ${version}: ${entries.length} entries, fragments removed`);
    return 0;
  }
  process.stdout.write(renderChangelog(changelog, entries));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
