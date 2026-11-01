// .pat files and pattern placement (M1-16 part 3): AutoCAD's documented pattern format, the
// lines a HATCH stores for a pattern at its angle and scale, user-defined patterns, and the
// pattern library with the bundled re-authored set.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HatchGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  PatternLibrary,
  bundledPatterns,
  hatchLines,
  parsePat,
  patternLines,
  userDefinedLines,
  type PatPattern,
} from '../src/index';
import { TRIYA_ISO_PAT } from '../src/bundled';

const round = (v: number) => Math.round(v * 1e12) / 1e12 + 0;

describe('parsePat', () => {
  it('reads names, descriptions and lines, ignoring blank lines and comments', () => {
    const f = parsePat(
      [
        ';; a comment',
        '*ONE, First pattern',
        '45, 0,0, 0,.125 ; inline comment',
        '',
        '*Two_2',
        '0, 1,2, 3,4, 0.5,-0.25, 0,-0.25',
        '90, 0,0, 0,1',
        '',
      ].join('\r\n'),
    );
    expect(f.errors).toEqual([]);
    expect(f.warnings).toEqual([]);
    expect(f.patterns).toEqual([
      {
        name: 'ONE',
        description: 'First pattern',
        lines: [{ angle: 45, origin: { x: 0, y: 0 }, delta: { x: 0, y: 0.125 }, dashes: [] }],
      },
      {
        name: 'Two_2',
        description: '',
        lines: [
          {
            angle: 0,
            origin: { x: 1, y: 2 },
            delta: { x: 3, y: 4 },
            dashes: [0.5, -0.25, 0, -0.25],
          },
          { angle: 90, origin: { x: 0, y: 0 }, delta: { x: 0, y: 1 }, dashes: [] },
        ],
      },
    ]);
  });

  it('reports a definition it cannot read and leaves it out', () => {
    const f = parsePat(
      [
        '0, 0,0, 0,1', // 1: before any name
        '*EMPTY', // 2: no lines
        '*SHORT', // 3
        '0, 0,0, 1', // 4: too few fields
        '*NAN', // 5
        '0, 0,0, 0,x', // 6
        '*_BAD', // 7: must begin with a letter or digit
        '0, 0,0, 0,1',
        '*GOOD',
        '0, 0,0, 0,1',
      ].join('\n'),
    );
    expect(f.patterns.map((p) => p.name)).toEqual(['GOOD']);
    expect(f.errors.map((e) => e.line)).toEqual([1, 2, 4, 6, 7]);
    expect(f.errors[3]!.message).toContain('"x" is not a number');
  });

  it('warns about a line over 80 characters', () => {
    const f = parsePat(`*LONG, ${'x'.repeat(80)}\n0, 0,0, 0,1\n`);
    expect(f.patterns).toHaveLength(1);
    expect(f.warnings).toEqual([{ line: 1, message: 'line exceeds 80 characters' }]);
  });
});

describe('patternLines', () => {
  const lines45: PatPattern = {
    name: 'L45',
    description: '',
    lines: [{ angle: 45, origin: { x: 0, y: 0 }, delta: { x: 0, y: 0.125 }, dashes: [] }],
  };

  it('turns the delta into the line’s direction, as AutoCAD stores it', () => {
    // sample_AC1014.dwg (acadsharp corpus, saved by AutoCAD) stores its ANSI31 hatch at
    // scale 1 as a 45° line with offset (−0.0884, 0.0884): 0.125 across the line.
    const [l] = patternLines(lines45, { angle: 0, scale: 1 });
    expect(l!.angle).toBeCloseTo(Math.PI / 4, 15);
    expect(round(l!.offset.x)).toBe(round(-0.08838834764831845));
    expect(round(l!.offset.y)).toBe(round(0.08838834764831845));
    expect(l!.dashes).toEqual([]);
  });

  it('scales and turns origins, deltas and dashes by the hatch scale and angle', () => {
    const p: PatPattern = {
      name: 'P',
      description: '',
      lines: [{ angle: 0, origin: { x: 1, y: 0 }, delta: { x: 0.5, y: 2 }, dashes: [1, -0.5, 0] }],
    };
    const [l] = patternLines(p, { angle: Math.PI / 2, scale: 2, origin: { x: 10, y: 0 } });
    expect(l!.angle).toBeCloseTo(Math.PI / 2, 15);
    expect([round(l!.base.x), round(l!.base.y)]).toEqual([10, 2]);
    // Along the line (now +y) 1, across it (now −x) 4.
    expect([round(l!.offset.x), round(l!.offset.y)]).toEqual([-4, 1]);
    expect(l!.dashes).toEqual([2, -1, 0]);
  });
});

describe('userDefinedLines', () => {
  it('makes one family at the angle and spacing, and a second at 90° when doubled', () => {
    expect(userDefinedLines(0, 2, false)).toEqual([
      { angle: 0, base: { x: 0, y: 0 }, offset: { x: -0, y: 2 }, dashes: [] },
    ]);
    const [a, b] = userDefinedLines(0, 2, true);
    expect(a!.angle).toBe(0);
    expect(b!.angle).toBeCloseTo(Math.PI / 2, 15);
    expect([round(b!.offset.x), round(b!.offset.y)]).toEqual([-2, 0]);
  });
});

describe('the pattern library', () => {
  it('bundles assets/patterns/triya-iso.pat, read with no errors or warnings', () => {
    const asset = fileURLToPath(new URL('../../../assets/patterns/triya-iso.pat', import.meta.url));
    expect(TRIYA_ISO_PAT).toBe(readFileSync(asset, 'latin1'));
    const f = parsePat(TRIYA_ISO_PAT);
    expect(f.errors).toEqual([]);
    expect(f.warnings).toEqual([]);
    expect(TRIYA_ISO_PAT.endsWith('\n')).toBe(true);
    const names = bundledPatterns().names();
    expect(names).toContain('TRIYA_LINES45');
    expect(names.every((n) => n.startsWith('TRIYA_'))).toBe(true);
    // The ISO 128-20 line types: long dash 24d, dash 12d, short dash 6d, gap 3d (18d), dot.
    const iso = f.patterns.filter((p) => /^TRIYA_ISO\d\dW100$/.test(p.name));
    expect(iso).toHaveLength(14);
    for (const p of iso)
      for (const d of p.lines[0]!.dashes) expect([24, 12, 6, 0, -3, -18]).toContain(d);
  });

  it('finds patterns by name in any case, a later file winning', () => {
    const lib = new PatternLibrary('*A\n0, 0,0, 0,1\n', '*a, mine\n0, 0,0, 0,2\n');
    expect(lib.get('A')?.description).toBe('mine');
    expect(lib.get('a')?.lines[0]!.delta.y).toBe(2);
    expect(lib.get('B')).toBeUndefined();
    const added = lib.add('*B\n90, 0,0, 0,1\n');
    expect(added.patterns).toHaveLength(1);
    expect(lib.names()).toEqual(['a', 'B']);
  });
});

describe('hatchLines', () => {
  const g = (extra: Partial<HatchGeometry>) => ({
    pattern: 'TRIYA_LINES0',
    patternType: 1,
    patternAngle: 0,
    patternScale: 1,
    double: false,
    patternLines: [],
    ...extra,
  });
  const lib = bundledPatterns();

  it('keeps the lines a hatch stores, which AutoCAD draws whatever the pattern file says', () => {
    const stored = [{ angle: 1, base: { x: 0, y: 0 }, offset: { x: 0, y: 9 }, dashes: [] }];
    expect(hatchLines(g({ patternLines: stored }), lib)).toBe(stored);
  });

  it('makes the lines of a hatch stored without them from its pattern', () => {
    const [l] = hatchLines(g({ patternScale: 2 }), lib);
    expect([round(l!.offset.x), round(l!.offset.y)]).toEqual([0, 6]);
    expect(hatchLines(g({ pattern: 'triya_cross45' }), lib)).toHaveLength(2);
    expect(hatchLines(g({ pattern: 'NOT_BUNDLED' }), lib)).toEqual([]);
  });

  it('makes user-defined lines from the angle, the spacing (DXF 41) and the double flag', () => {
    const lines = hatchLines(
      g({ patternType: 0, pattern: '_USER', patternScale: 1.5, double: true }),
      lib,
    );
    expect(lines).toHaveLength(2);
    expect(round(lines[0]!.offset.y)).toBe(1.5);
  });
});
