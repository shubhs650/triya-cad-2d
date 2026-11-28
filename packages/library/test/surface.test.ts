// M8-02 part 3: surface texture symbols (ISO 1302 and ASME Y14.36). Each symbol's drawing is
// pinned by a snapshot under surface-snapshots/ (one line per part, to four decimals); rewrite
// with `pnpm vitest run packages/library/test/surface -u` and review the diff. The rules the
// standards set (60° legs, the bar and the circle, where each requirement stands) are asserted
// on their own below.
import { describe, expect, it } from 'vitest';
import { ChangeSetBuilder, type EntityGeometry, type TextGeometry } from '@triya/engine';
import {
  SURFACE_FINISH_DEFAULTS,
  SURFACE_LAYS,
  addSurfaceFinishBlock,
  checkSurfaceFinish,
  surfaceFinishDefaults,
  surfaceFinishDescription,
  surfaceFinishName,
  surfaceFinishParts,
  type LibraryPart,
  type SurfaceFinishSpec,
} from '../src/index';
import { NOTES_STYLE, STYLE, drawing, partsText } from './fixtures';

const H = 0.125;
const ROOT3 = Math.sqrt(3);

const spec = (change: Partial<SurfaceFinishSpec> = {}): SurfaceFinishSpec => ({
  ...SURFACE_FINISH_DEFAULTS,
  ...change,
});
const iso = (change: Partial<SurfaceFinishSpec> = {}) =>
  spec({ standard: 'ISO', requirement: 'Ra 3.2', ...change });

type Line = Extract<EntityGeometry, { kind: 'LINE' }>;
const lines = (parts: readonly LibraryPart[]) =>
  parts.filter((p) => p.geom.kind === 'LINE').map((p) => p.geom as Line);
const circles = (parts: readonly LibraryPart[]) =>
  parts
    .filter((p) => p.geom.kind === 'CIRCLE')
    .map((p) => p.geom as Extract<EntityGeometry, { kind: 'CIRCLE' }>);
const texts = (parts: readonly LibraryPart[]) =>
  parts.filter((p) => p.geom.kind === 'TEXT').map((p) => p.geom as TextGeometry);
const textNamed = (parts: readonly LibraryPart[], value: string) =>
  texts(parts).find((t) => t.value === value)!;
const horizontal = (l: Line) => Math.abs(l.start.y - l.end.y) < 1e-12;

/** The legs: the two lines from the base point, short one first. */
function legs(parts: readonly LibraryPart[]): [Line, Line] {
  const from = lines(parts).filter((l) => Math.hypot(l.start.x, l.start.y) < 1e-12);
  expect(from).toHaveLength(2);
  return from.sort((a, b) => a.end.y - b.end.y) as [Line, Line];
}
/** The extension: the horizontal line from the long leg's top. */
const extension = (parts: readonly LibraryPart[]) => {
  const top = legs(parts)[1].end;
  return lines(parts).find(
    (l) => horizontal(l) && Math.abs(l.start.x - top.x) < 1e-12 && l.start.y === top.y,
  );
};
/** The long leg's x at height y: a text left of it ends before, one right of it starts after. */
const legX = (y: number) => y / ROOT3;

describe('surface texture symbol geometry (M8-02)', () => {
  it('draws the basic symbol: two legs at 60° from the base point, 1.4h and 3h high', () => {
    const [short, long] = legs(surfaceFinishParts(iso({ process: 'any' }), STYLE));
    expect(short.end.x).toBeLessThan(0);
    expect(short.end.y).toBeCloseTo(1.4 * H, 12);
    expect(Math.atan2(short.end.y, -short.end.x)).toBeCloseTo(Math.PI / 3, 12);
    expect(long.end.x).toBeGreaterThan(0);
    expect(long.end.y).toBeCloseTo(3 * H, 12);
    expect(Math.atan2(long.end.y, long.end.x)).toBeCloseTo(Math.PI / 3, 12);
  });

  it('closes the V with a bar when material removal is required, and has neither bar nor circle for any process', () => {
    const any = surfaceFinishParts(iso({ process: 'any' }), STYLE);
    const mrr = surfaceFinishParts(iso({ process: 'removal-required' }), STYLE);
    const [short, long] = legs(mrr);
    const bar = lines(mrr).find((l) => horizontal(l) && Math.abs(l.start.y - short.end.y) < 1e-12);
    expect(bar).toBeDefined();
    expect(Math.min(bar!.start.x, bar!.end.x)).toBeCloseTo(short.end.x, 12);
    // It meets the long leg where the leg is as high as the short one.
    expect(Math.max(bar!.start.x, bar!.end.x)).toBeCloseTo(legX(short.end.y), 12);
    expect(long.end.y).toBeGreaterThan(bar!.start.y);
    expect(lines(any)).toHaveLength(lines(mrr).length - 1);
    expect(circles(any)).toHaveLength(0);
    expect(circles(mrr)).toHaveLength(0);
  });

  it("puts a circle in the V, touching both legs and the short leg's height, when material removal is prohibited", () => {
    const parts = surfaceFinishParts(iso({ process: 'removal-prohibited' }), STYLE);
    const [c] = circles(parts);
    expect(circles(parts)).toHaveLength(1);
    expect(c!.center.x).toBeCloseTo(0, 12);
    expect(c!.center.y + c!.radius).toBeCloseTo(1.4 * H, 12);
    // Its distance from either leg (lines through the origin at ±60°) is its radius.
    expect(
      Math.abs(Math.cos(Math.PI / 3) * c!.center.y - Math.sin(Math.PI / 3) * c!.center.x),
    ).toBeCloseTo(c!.radius, 12);
    expect(
      lines(parts)
        .filter(horizontal)
        .every((l) => l.start.y !== 1.4 * H),
    ).toBe(true);
  });

  it('ISO 1302: the requirement under the extension right of the long leg, the method above it', () => {
    const parts = surfaceFinishParts(iso({ method: 'milled' }), STYLE);
    const ext = extension(parts)!;
    expect(ext).toBeDefined();
    expect(ext.end.x - ext.start.x).toBeCloseTo(SURFACE_FINISH_DEFAULTS.extensionLength, 12);
    const a = textNamed(parts, 'Ra 3.2');
    expect(a).toMatchObject({ halign: 0, valign: 3, height: H, style: STYLE });
    expect(a.alignmentPoint!.y).toBeLessThan(ext.start.y);
    expect(a.alignmentPoint!.x).toBeGreaterThan(legX(a.alignmentPoint!.y));
    const c = textNamed(parts, 'milled');
    expect(c).toMatchObject({ halign: 0, valign: 1 });
    expect(c.alignmentPoint!.y).toBeGreaterThan(ext.start.y);
    expect(c.alignmentPoint!.x).toBeGreaterThanOrEqual(ext.start.x);
  });

  it('ISO 1302: a second requirement stands under the first, the long leg made longer for it', () => {
    const parts = surfaceFinishParts(iso({ secondRequirement: 'Rz 12.5' }), STYLE);
    const [, long] = legs(parts);
    expect(long.end.y).toBeCloseTo(4.25 * H, 12);
    const a = textNamed(parts, 'Ra 3.2');
    const b = textNamed(parts, 'Rz 12.5');
    expect(b).toMatchObject({ halign: 0, valign: 3 });
    expect(a.alignmentPoint!.y - b.alignmentPoint!.y).toBeCloseTo(1.25 * H, 12);
    expect(b.alignmentPoint!.x).toBeGreaterThan(legX(b.alignmentPoint!.y));
    // Clear of the lay symbol's band at the foot of the long leg.
    expect(b.alignmentPoint!.y - H).toBeGreaterThan(1.2 * H);
  });

  it('ASME Y14.36: the roughness value in the V above the short leg, left of the long leg, with no extension', () => {
    const parts = surfaceFinishParts(spec({ requirement: '63' }), STYLE);
    expect(extension(parts)).toBeUndefined();
    const a = textNamed(parts, '63');
    expect(a).toMatchObject({ halign: 2, valign: 1 });
    expect(a.alignmentPoint!.y).toBeGreaterThan(1.4 * H);
    expect(a.alignmentPoint!.x).toBeLessThan(legX(a.alignmentPoint!.y));
    const [, long] = legs(parts);
    expect(long.end.y).toBeGreaterThanOrEqual(a.alignmentPoint!.y + H);
  });

  it('ASME Y14.36: a maximum over a minimum, each clear of the long leg', () => {
    const parts = surfaceFinishParts(spec({ requirement: '63', secondRequirement: '32' }), STYLE);
    const max = textNamed(parts, '63');
    const min = textNamed(parts, '32');
    expect(max.alignmentPoint!.y - min.alignmentPoint!.y).toBeCloseTo(1.25 * H, 12);
    for (const t of [max, min]) expect(t.alignmentPoint!.x).toBeLessThan(legX(t.alignmentPoint!.y));
    expect(legs(parts)[1].end.y).toBeGreaterThanOrEqual(max.alignmentPoint!.y + H);
  });

  it('ASME Y14.36: the extension comes with a method or all around', () => {
    expect(extension(surfaceFinishParts(spec({ method: 'GRIND' }), STYLE))).toBeDefined();
    expect(extension(surfaceFinishParts(spec({ allAround: true }), STYLE))).toBeDefined();
  });

  it('draws all around as a circle at the corner of the long leg and the extension', () => {
    for (const s of [iso({ allAround: true }), spec({ allAround: true, method: 'CAST' })]) {
      const parts = surfaceFinishParts(s, STYLE);
      const top = legs(parts)[1].end;
      const [c] = circles(parts).filter((c) => c.center.y > 2 * H);
      expect(c!.center.x).toBeCloseTo(top.x, 12);
      expect(c!.center.y).toBeCloseTo(top.y, 12);
      expect(c!.radius).toBeCloseTo(0.4 * H, 12);
      // The texts along the extension start clear of it.
      for (const t of texts(parts).filter((t) => t.alignmentPoint!.y > 2 * H))
        expect(t.alignmentPoint!.x).toBeGreaterThan(c!.center.x + c!.radius);
    }
  });

  it('puts the lay at the foot of the long leg (= and ⊥ drawn, the letters as text) and the allowance left of the short leg', () => {
    const base = surfaceFinishParts(iso(), STYLE);
    const parallel = surfaceFinishParts(iso({ lay: 'parallel' }), STYLE);
    const perpendicular = surfaceFinishParts(iso({ lay: 'perpendicular' }), STYLE);
    expect(lines(parallel).length - lines(base).length).toBe(2);
    expect(lines(perpendicular).length - lines(base).length).toBe(2);
    for (const l of lines(parallel).slice(-2)) {
      expect(horizontal(l)).toBe(true);
      expect(Math.min(l.start.x, l.end.x)).toBeGreaterThan(legX(1.2 * H));
      expect(Math.max(l.start.y, l.end.y)).toBeLessThanOrEqual(1.2 * H);
    }
    for (const [lay, letter] of [
      ['crossed', 'X'],
      ['multidirectional', 'M'],
      ['circular', 'C'],
      ['radial', 'R'],
      ['particulate', 'P'],
    ] as const) {
      const t = textNamed(surfaceFinishParts(iso({ lay }), STYLE), letter);
      expect(t).toMatchObject({ halign: 0, valign: 2 });
      expect(t.alignmentPoint!.x).toBeGreaterThan(legX(t.alignmentPoint!.y + H / 2));
    }
    const e = textNamed(surfaceFinishParts(iso({ allowance: '0.5' }), STYLE), '0.5');
    expect(e).toMatchObject({ halign: 2, valign: 2 });
    // Left of the short leg at the text's top, where the leg is furthest left.
    expect(e.alignmentPoint!.x).toBeLessThan(-(e.alignmentPoint!.y + H / 2) / ROOT3);
  });

  it("scales the defaults to the drawing and picks each standard's usual requirement", () => {
    expect(surfaceFinishDefaults()).toEqual(SURFACE_FINISH_DEFAULTS);
    expect(SURFACE_FINISH_DEFAULTS).toMatchObject({ standard: 'ASME', requirement: '125' });
    const mm = surfaceFinishDefaults(25.4, 'ISO');
    expect(mm).toMatchObject({ standard: 'ISO', requirement: 'Ra 3.2' });
    expect(mm.height).toBeCloseTo(3.175, 12);
    expect(mm.extensionLength).toBeCloseTo(SURFACE_FINISH_DEFAULTS.extensionLength * 25.4, 12);
    expect(checkSurfaceFinish(mm)).toBeUndefined();
  });

  it('refuses what the standards do not draw', () => {
    expect(checkSurfaceFinish(spec())).toBeUndefined();
    expect(checkSurfaceFinish(spec({ standard: 'DIN' as never }))).toBe('DIN is not a standard');
    expect(checkSurfaceFinish(spec({ process: 'cast' as never }))).toBe('cast is not a process');
    expect(checkSurfaceFinish(spec({ lay: 'spiral' as never }))).toBe('spiral is not a lay');
    expect(checkSurfaceFinish(spec({ height: 0 }))).toBe('height must be more than 0');
    expect(checkSurfaceFinish(spec({ extensionLength: Number.NaN }))).toBe(
      'extension length must be a number',
    );
    expect(checkSurfaceFinish(iso({ extensionLength: H }))).toBe(
      'extension length must be at least twice the height',
    );
    expect(checkSurfaceFinish(spec({ requirement: undefined, secondRequirement: '32' }))).toBe(
      'a second requirement needs a first',
    );
    expect(checkSurfaceFinish(spec({ method: 'a\nb' }))).toBe('method must be one line');
  });

  it('names the block by standard, process and a digest of the description', () => {
    const s = iso({ process: 'removal-prohibited', lay: 'crossed', allAround: true });
    expect(surfaceFinishDescription(s)).toBe(
      'Surface texture, ISO 1302: material removal prohibited; Ra 3.2; lay X (crossed); all around; height 0.125, extension 0.75',
    );
    expect(surfaceFinishName(s)).toMatch(/^TRIYA_SURF_ISO_NMR_[0-9A-F]{8}$/);
    expect(surfaceFinishName(spec())).toMatch(/^TRIYA_SURF_ASME_MRR_[0-9A-F]{8}$/);
    expect(surfaceFinishName(spec({ process: 'any' }))).toMatch(/^TRIYA_SURF_ASME_APA_/);
    expect(surfaceFinishName(s)).not.toBe(surfaceFinishName({ ...s, requirement: 'Ra 1.6' }));
  });
});

describe('surface texture symbol snapshots (M8-02)', () => {
  const cases: [string, Partial<SurfaceFinishSpec>][] = [
    ['ASME-removal-required-125', {}],
    ['ASME-any-process', { process: 'any', requirement: undefined }],
    [
      'ASME-max-min-lay-allowance',
      { requirement: '63', secondRequirement: '32', lay: 'perpendicular', allowance: '0.02' },
    ],
    [
      'ASME-prohibited-method-all-around',
      { process: 'removal-prohibited', requirement: '250', method: 'CAST', allAround: true },
    ],
    ['ISO-removal-required-ra', { standard: 'ISO', requirement: 'Ra 3.2' }],
    [
      'ISO-two-requirements-method-lay',
      {
        standard: 'ISO',
        requirement: 'Ra 1.6',
        secondRequirement: 'Rz 6.3',
        method: 'ground',
        lay: 'parallel',
        allowance: '0.3',
      },
    ],
    [
      'ISO-prohibited-all-around-radial',
      {
        standard: 'ISO',
        process: 'removal-prohibited',
        requirement: 'Ra 12.5',
        lay: 'radial',
        allAround: true,
      },
    ],
    [
      'ISO-any-process-multidirectional',
      { standard: 'ISO', process: 'any', requirement: 'Ra 6.3', lay: 'multidirectional' },
    ],
  ];
  for (const [file, change] of cases)
    it(`pins ${file}`, async () => {
      const s = spec(change);
      expect(checkSurfaceFinish(s)).toBeUndefined();
      const text = `# ${surfaceFinishName(s)}\n# ${surfaceFinishDescription(s)}\n${partsText(surfaceFinishParts(s, STYLE))}\n`;
      await expect(text).toMatchFileSnapshot(`surface-snapshots/${file}.txt`);
    });
  it('lists every lay in the snapshots or the tests above', () => {
    expect([...SURFACE_LAYS].sort()).toEqual([
      'circular',
      'crossed',
      'multidirectional',
      'parallel',
      'particulate',
      'perpendicular',
      'radial',
    ]);
  });
});

describe('surface texture blocks (M8-02)', () => {
  it("adds a block on layer 0 ByBlock in the drawing's current text style, and finds one it has", () => {
    const model = drawing({ header: [['$TEXTSTYLE', 'Notes']] });
    const s = surfaceFinishDefaults(25.4, 'ISO');
    const b = new ChangeSetBuilder(model);
    const made = addSurfaceFinishBlock(b, model, s)!;
    expect(addSurfaceFinishBlock(b, model, { ...s, height: 0 })).toBeUndefined();
    model.apply(b.build());
    expect(model.blocks.get(made)).toMatchObject({
      name: surfaceFinishName(s),
      basePoint: { x: 0, y: 0 },
      description: surfaceFinishDescription(s),
    });
    const parts = model.blockEntities(made).map((id) => model.entity(id)!);
    expect(parts).toHaveLength(surfaceFinishParts(s, NOTES_STYLE).length);
    for (const e of parts) {
      expect(model.tables.layers.get(e.layer)?.name).toBe('0');
      expect(e).toMatchObject({ color: { kind: 'byBlock' }, lineweight: 'ByBlock' });
    }
    expect(
      parts.filter((e) => e.geom.kind === 'TEXT').map((e) => (e.geom as TextGeometry).style),
    ).toEqual([NOTES_STYLE]);
    const again = new ChangeSetBuilder(model);
    expect(addSurfaceFinishBlock(again, model, s)).toBe(made);
  });
});
