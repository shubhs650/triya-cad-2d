// Changelog fragments: each PR adds its own file under changes/ instead of editing the top of
// CHANGELOG.md, so parallel threads stop conflicting on the same line (owner request,
// 2026-11-01). These tests pin the fragment rules and the assembly order.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assembleEntries,
  checkRepo,
  FRAGMENT_DIR,
  releaseChangelog,
  renderChangelog,
  validateFragment,
} from '../../scripts/changelog.ts';

const root = path.resolve(import.meta.dirname, '../..');

describe('fragment names', () => {
  it.each([
    'M1-04.md',
    'M1-04-part-2.md',
    'M1-04-part-3a.md',
    'M0-GO.md',
    'M10-06.md',
    'infra-changelog-fragments.md',
  ])('accepts %s', (name) => {
    expect(validateFragment(name, '- M1-04 (#19): mapped things.\n')).toEqual([]);
  });

  it.each(['notes.md', 'M1-4.md', 'm1-04.md', 'M1-04.txt', 'infra-.md', 'M1-04-part2.md'])(
    'rejects %s',
    (name) => {
      expect(validateFragment(name, '- M1-04 (#19): mapped things.\n')).not.toEqual([]);
    },
  );
});

describe('fragment contents', () => {
  it('requires one or more bullet lines', () => {
    expect(validateFragment('M1-04.md', '')).not.toEqual([]);
    expect(validateFragment('M1-04.md', 'Mapped things.\n')).not.toEqual([]);
  });

  it('requires the PR number on every entry so the order is the merge order', () => {
    expect(validateFragment('M1-04.md', '- M1-04: mapped things.\n')).not.toEqual([]);
  });

  it('rejects headings, which would break the assembled section', () => {
    expect(validateFragment('M1-04.md', '## M1-04\n- M1-04 (#19): x.\n')).not.toEqual([]);
  });

  it('allows indented continuation lines under a bullet', () => {
    expect(validateFragment('M1-04.md', '- M1-04 (#19): x,\n  continued.\n')).toEqual([]);
  });
});

describe('assembly', () => {
  const fragments = [
    { name: 'M1-02-part-1.md', text: '- M1-02 part 1 (#11): kernel.\n' },
    { name: 'infra-x.md', text: '- Infra (#20): fragments.\n' },
    { name: 'M0-01.md', text: '- M0-01 (#1): scaffold.\n' },
    { name: 'M1-30.md', text: '- M1-30 (#9): raw objects.\n' },
  ];

  it('orders entries newest PR first, whatever the file names', () => {
    expect(assembleEntries(fragments)).toEqual([
      '- Infra (#20): fragments.',
      '- M1-02 part 1 (#11): kernel.',
      '- M1-30 (#9): raw objects.',
      '- M0-01 (#1): scaffold.',
    ]);
  });

  it('prints the entries under Unreleased without touching older sections', () => {
    const base = '# Changelog\n\nIntro.\n\n## Unreleased\n\n## Kickoff (2026-11-01)\n- Kit.\n';
    const out = renderChangelog(base, assembleEntries(fragments));
    expect(out).toContain('## Unreleased\n- Infra (#20): fragments.\n');
    expect(out.indexOf('- M0-01 (#1)')).toBeLessThan(out.indexOf('## Kickoff'));
    expect(out).toContain('## Kickoff (2026-11-01)\n- Kit.\n');
  });

  it('folds the entries into a dated version section on release', () => {
    const base = '# Changelog\n\n## Unreleased\n<!-- marker -->\n\n## Kickoff\n- Kit.\n';
    const out = releaseChangelog(base, ['- A (#2): a.', '- B (#1): b.'], '1.0.0', '2027-01-31');
    expect(out).toContain(
      '## Unreleased\n<!-- marker -->\n\n## 1.0.0 (2027-01-31)\n- A (#2): a.\n- B (#1): b.\n\n## Kickoff',
    );
  });
});

describe('repository state', () => {
  it('has only valid fragments in changes/', () => {
    expect(checkRepo(root)).toEqual([]);
  });

  it('keeps hand-written entries out of the Unreleased section of CHANGELOG.md', () => {
    const text = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    const unreleased = text.split('## Unreleased')[1]?.split(/\n## /)[0] ?? '';
    expect(unreleased.split('\n').filter((l) => l.startsWith('- '))).toEqual([]);
  });

  it('carries every pre-fragment entry over as a fragment', () => {
    const names = readdirSync(path.join(root, FRAGMENT_DIR));
    for (const id of ['M0-01', 'M0-02', 'M0-GO', 'M1-02-part-3', 'M1-30']) {
      expect(names).toContain(`${id}.md`);
    }
  });
});
