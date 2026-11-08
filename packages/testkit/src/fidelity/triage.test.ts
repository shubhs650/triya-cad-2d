// M1-106: what the fidelity harness says about a failing render, and the entity-level report
// (TESTING.md §4) it writes after a run.
import { describe, expect, it } from 'vitest';
import {
  describeRegion,
  formatFidelityReport,
  isCompleteRun,
  typeCounts,
  type FileTriage,
} from './triage.ts';

const region = { x: 32, y: 64, width: 96, height: 32 };

describe('a differing region', () => {
  it('names the entities drawn there by type and handle', () => {
    expect(
      describeRegion(region, [
        { handle: '2F', type: 'LINE' },
        { handle: '30', type: 'CIRCLE' },
      ]),
    ).toBe('96×32@32,64 (LINE 2F, CIRCLE 30)');
  });

  it('says when nothing is drawn there: what differs was drawn by the golden image only', () => {
    expect(describeRegion(region, [])).toBe('96×32@32,64 (no entity drawn there)');
  });

  it('lists at most eight entities and counts the rest', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ handle: `${20 + i}`, type: 'TEXT' }));
    expect(describeRegion(region, many)).toBe(
      '96×32@32,64 (TEXT 20, TEXT 21, TEXT 22, TEXT 23, TEXT 24, TEXT 25, TEXT 26, TEXT 27, and 3 more)',
    );
  });
});

describe('type counts', () => {
  it('counts the entities by type', () => {
    expect(
      typeCounts([
        { handle: '1', type: 'LINE' },
        { handle: '2', type: 'LINE' },
        { handle: '3', type: 'TEXT' },
      ]),
    ).toEqual({ LINE: 2, TEXT: 1 });
  });
});

const files: FileTriage[] = [
  {
    path: 'public/third-party/a.dxf',
    spaces: [
      { space: 'Model', pass: true, drawn: { LINE: 4, TEXT: 2 }, regions: [] },
      {
        space: 'Layout1',
        pass: false,
        reason: 'mismatch 3.10 % > 0.5 %',
        drawn: { VIEWPORT: 1, LINE: 4 },
        regions: [
          { region, entities: [{ handle: '2F', type: 'LINE' }] },
          { region: { x: 0, y: 0, width: 32, height: 32 }, entities: [] },
        ],
      },
    ],
  },
  { path: 'public/third-party/b.dxf', unreadable: 'damaged', spaces: [] },
  {
    path: 'public/third-party/c.dwg',
    spaces: [
      {
        space: 'Model',
        pass: false,
        reason: 'no golden image',
        drawn: { CIRCLE: 1 },
        regions: [],
      },
    ],
  },
];

describe('the fidelity report', () => {
  const report = formatFidelityReport(files, { title: 'Fidelity report: public corpus' });

  it('summarises files and spaces', () => {
    expect(report).toContain('# Fidelity report: public corpus');
    expect(report).toContain('3 files (1 unreadable), 3 spaces, 2 failing.');
  });

  it('tables each entity type: entities in view, spaces showing it, entities in differing regions', () => {
    expect(report).toContain('| Type | In view | Spaces | In differing regions | Failing spaces |');
    expect(report).toContain('| CIRCLE | 1 | 1 | 0 | 1 |');
    expect(report).toContain('| LINE | 8 | 2 | 1 | 1 |');
    expect(report).toContain('| TEXT | 2 | 1 | 0 | 0 |');
    expect(report).toContain('| VIEWPORT | 1 | 1 | 0 | 1 |');
    // Sorted by type, so the report is the same bytes for the same run.
    expect(report.indexOf('| CIRCLE')).toBeLessThan(report.indexOf('| LINE'));
  });

  it('lists each failing space with its regions and their entities', () => {
    expect(report).toContain(
      '- `public/third-party/a.dxf` Layout1: mismatch 3.10 % > 0.5 %\n  - 96×32@32,64 (LINE 2F)\n  - 32×32@0,0 (no entity drawn there)',
    );
    expect(report).toContain('- `public/third-party/c.dwg` Model: no golden image');
    expect(report).not.toContain('a.dxf` Model');
  });

  it('leaves out file names and handles for the private corpus (TESTING.md §2.2)', () => {
    const anon = formatFidelityReport(files, { title: 'private', names: false });
    expect(anon).toContain('| LINE | 8 | 2 | 1 | 1 |');
    expect(anon).not.toContain('a.dxf');
    expect(anon).not.toContain('2F');
    expect(anon).toContain('2 failing spaces; file names are left out of the private report.');
  });

  it('says so when every space matches its golden image', () => {
    const passing = formatFidelityReport(
      [files[0]!].map((f) => ({ ...f, spaces: [f.spaces[0]!] })),
      {
        title: 't',
      },
    );
    expect(passing).toContain('Every space matches its golden image.');
  });
});

describe('a complete run', () => {
  it('has a result for every manifest file and nothing else', () => {
    const paths = files.map((f) => f.path);
    expect(isCompleteRun(files, paths)).toBe(true);
    expect(isCompleteRun(files.slice(1), paths)).toBe(false);
    expect(isCompleteRun(files, paths.slice(1))).toBe(false);
  });
});
