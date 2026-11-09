// M2-10: what the dimension engine draws for each dimension type, by AutoCAD's rules (the
// rules are commented in src/linear.ts, radial.ts and angular.ts), and the health comparison.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  type DimStyleRecord,
  type DimensionGeometry,
  type EntityGeometry,
  type HeaderValue,
  type TextMeasure,
} from '@triya/engine';
import { compareParts, dimensionParts, type DimPart } from '../src/index';

const STYLE = '27';
const TICK = 'A1';
const MODEL_SPACE = '1F';

const ISO: DimStyleRecord['vars'] = {
  DIMSCALE: 1,
  DIMASZ: 2.5,
  DIMEXO: 0.625,
  DIMEXE: 1.25,
  DIMGAP: 0.625,
  DIMTXT: 2.5,
  DIMCEN: 2.5,
  DIMTAD: 1,
  DIMTIH: false,
  DIMTOH: false,
  DIMDEC: 2,
  DIMZIN: 8,
  DIMDSEP: '.',
  DIMTOFL: true,
  DIMATFIT: 3,
};

function model(vars: DimStyleRecord['vars'] = ISO): DocumentModel {
  return DocumentModel.create({
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '100',
    header: new Map<string, HeaderValue>(),
    tables: {
      layers: [
        {
          handle: '10',
          name: '0',
          color: { kind: 'aci', index: 7 },
          linetype: '14',
          lineweight: 'Default',
          transparency: { alpha: 255 },
          plot: true,
          on: true,
          frozen: false,
          locked: false,
        },
      ],
      linetypes: [
        {
          handle: '14',
          name: 'Continuous',
          description: '',
          alignment: 'A',
          patternLength: 0,
          elements: [],
        },
      ],
      appIds: [{ handle: '12', name: 'ACAD' }],
      dimStyles: [{ handle: STYLE, name: 'ISO-25', vars }],
      blockRecords: [
        { handle: MODEL_SPACE, name: '*Model_Space', units: 0, explodable: true, scalable: true },
        { handle: TICK, name: '_ArchTick', units: 0, explodable: true, scalable: true },
      ],
    },
    blocks: [
      { handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } },
      { handle: TICK, name: '_ArchTick', basePoint: { x: 0, y: 0 } },
    ],
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE }],
    entities: [],
  });
}

/** Each visible character one text height wide. */
const measure: TextMeasure = (t) =>
  t.contents.replace(/\\[A-Za-z][^;]*;|[{}]/g, '').length * t.height;

const common = {
  style: STYLE,
  textUserPositioned: false,
  text: '',
  textRotation: 0,
  horizontalDirection: 0,
  attachment: 5,
  lineSpacingStyle: 1,
  lineSpacing: 1,
  kind: 'DIMENSION',
} as const;

function linear(
  extra: Partial<Extract<DimensionGeometry, { dimType: 'linear' }>> = {},
): DimensionGeometry {
  return {
    ...common,
    dimType: 'linear',
    first: { x: 0, y: 0 },
    second: { x: 100, y: 0 },
    definitionPoint: { x: 100, y: 20 },
    // Above the line (DIMTAD 1): a gap and half the text height.
    textPosition: { x: 50, y: 21.875 },
    rotation: 0,
    ...extra,
  };
}

const parts = (geom: EntityGeometry, m = model(), xdata?: never) =>
  dimensionParts({ geom, ...(xdata ? { xdata } : {}) }, m, measure)!;
const of = (ps: DimPart[], kind: EntityGeometry['kind']) =>
  ps.filter((p) => p.geom.kind === kind).map((p) => p.geom);
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe('linear dimensions', () => {
  it('draws extension lines, a dimension line trimmed at closed filled arrows, text and definition points', () => {
    const ps = parts(linear());
    const lines = of(ps, 'LINE') as Extract<EntityGeometry, { kind: 'LINE' }>[];
    expect(lines).toHaveLength(3);
    // Extension lines: DIMEXO off the origin, DIMEXE past the dimension line.
    expect(lines[0]).toEqual({ kind: 'LINE', start: { x: 0, y: 0.625 }, end: { x: 0, y: 21.25 } });
    expect(lines[1]).toEqual({
      kind: 'LINE',
      start: { x: 100, y: 0.625 },
      end: { x: 100, y: 21.25 },
    });
    // Text above the line (DIMTAD 1): the line is whole between the arrows' backs.
    expect(lines[2]).toEqual({ kind: 'LINE', start: { x: 2.5, y: 20 }, end: { x: 97.5, y: 20 } });
    const solids = of(ps, 'SOLID') as Extract<EntityGeometry, { kind: 'SOLID' }>[];
    expect(solids.map((s) => s.corners[2])).toEqual([
      { x: 0, y: 20 },
      { x: 100, y: 20 },
    ]);
    // A sixth of DIMASZ either side of the back.
    close(solids[0]!.corners[0].y - solids[0]!.corners[1].y, 2.5 / 3);
    const [text] = of(ps, 'MTEXT') as Extract<EntityGeometry, { kind: 'MTEXT' }>[];
    expect(text).toMatchObject({
      contents: '100',
      position: { x: 50, y: 21.875 },
      rotation: 0,
      height: 2.5,
      attachment: 5,
    });
    expect(ps.filter((p) => p.defpoint)).toHaveLength(3);
  });

  it('keeps a centred text clear of the dimension line by DIMGAP and writes it \\A1;', () => {
    const ps = parts(linear({ textPosition: { x: 50, y: 20 } }), model({ ...ISO, DIMTAD: 0 }));
    const lines = of(ps, 'LINE') as Extract<EntityGeometry, { kind: 'LINE' }>[];
    // "100" is 7.5 wide: the line stops 3.75 + 0.625 either side of the text's middle.
    expect(lines.slice(2)).toEqual([
      { kind: 'LINE', start: { x: 2.5, y: 20 }, end: { x: 45.625, y: 20 } },
      { kind: 'LINE', start: { x: 54.375, y: 20 }, end: { x: 97.5, y: 20 } },
    ]);
    expect(of(ps, 'MTEXT')[0]).toMatchObject({ contents: '\\A1;100' });
  });

  it('moves the arrows outside with tails when only the text fits (DIMATFIT 3)', () => {
    const geom = linear({
      second: { x: 5, y: 0 },
      definitionPoint: { x: 5, y: 10 },
      textPosition: { x: 2.5, y: 10 },
    });
    const ps = parts(geom, model({ ...ISO, DIMTAD: 0, DIMTOFL: false }));
    const lines = of(ps, 'LINE') as Extract<EntityGeometry, { kind: 'LINE' }>[];
    // No line between the extension lines (DIMTOFL off), a DIMASZ tail beyond each arrow.
    expect(lines.slice(2)).toEqual([
      { kind: 'LINE', start: { x: -2.5, y: 10 }, end: { x: -5, y: 10 } },
      { kind: 'LINE', start: { x: 7.5, y: 10 }, end: { x: 10, y: 10 } },
    ]);
    const solids = of(ps, 'SOLID') as Extract<EntityGeometry, { kind: 'SOLID' }>[];
    // Arrows from outside: their backs beyond the extension lines.
    expect(solids[0]!.corners[0].x).toBeCloseTo(-2.5);
    expect(solids[1]!.corners[0].x).toBeCloseTo(7.5);
    // DIMSOXD drops arrows that do not fit inside.
    const none = parts(geom, model({ ...ISO, DIMTAD: 0, DIMTOFL: false, DIMSOXD: true }));
    expect(of(none, 'SOLID')).toEqual([]);
  });

  it('draws tick blocks at the tips with the line run through and on by DIMDLE', () => {
    const ps = parts(linear(), model({ ...ISO, DIMBLK: TICK, DIMDLE: 2 }));
    const lines = of(ps, 'LINE') as Extract<EntityGeometry, { kind: 'LINE' }>[];
    expect(lines[2]).toEqual({ kind: 'LINE', start: { x: -2, y: 20 }, end: { x: 102, y: 20 } });
    const ticks = of(ps, 'INSERT') as Extract<EntityGeometry, { kind: 'INSERT' }>[];
    expect(ticks.map((t) => [t.block, t.position, t.scale.x])).toEqual([
      [TICK, { x: 0, y: 20 }, 2.5],
      [TICK, { x: 100, y: 20 }, 2.5],
    ]);
    close(Math.abs(ticks[0]!.rotation), Math.PI);
    close(ticks[1]!.rotation, 0);
  });

  it('takes DSTYLE overrides, suppresses an extension line, and hides text overridden by a space', () => {
    const m = model();
    const xdata = [
      {
        appId: '12',
        values: [
          { code: 1000, value: 'DSTYLE' },
          { code: 1002, value: '{' },
          { code: 1070, value: 75 },
          { code: 1070, value: 1 },
          { code: 1002, value: '}' },
        ],
      },
    ];
    const ps = dimensionParts({ geom: linear({ text: ' ' }), xdata } as never, m, measure)!;
    expect(of(ps, 'LINE')).toHaveLength(2);
    expect(of(ps, 'MTEXT')).toEqual([]);
  });

  it('places the text itself when there are no stored graphics, keeps it where they put it', () => {
    // No block: centred over the line (DIMTAD 1), whatever DXF 11 says.
    const placed = parts(linear({ textPosition: { x: 0, y: 0 } }));
    expect(of(placed, 'MTEXT')[0]).toMatchObject({ position: { x: 50, y: 21.875 } });
    // Text that does not fit goes beyond the second extension line and its outside arrow.
    // Too narrow for its text ("1", 2.5 wide) or arrows: both go outside, the text past the second arrow.
    const narrow = linear({ second: { x: 1, y: 0 }, definitionPoint: { x: 1, y: 20 } });
    const [t] = of(parts(narrow), 'MTEXT') as Extract<EntityGeometry, { kind: 'MTEXT' }>[];
    close(t!.position.x, 1 + 2 * 2.5 + 0.625 + 2.5 / 2);
    // Moved by the user (DXF 70 bit 128): DXF 11 is kept.
    const moved = parts(linear({ textPosition: { x: 30, y: 21.875 }, textUserPositioned: true }));
    expect(of(moved, 'MTEXT')[0]).toMatchObject({ position: { x: 30, y: 21.875 } });
  });

  it('measures an aligned dimension along its points and turns the text with it, upright', () => {
    const geom: DimensionGeometry = {
      ...common,
      dimType: 'aligned',
      first: { x: 30, y: 40 },
      second: { x: 0, y: 0 },
      definitionPoint: { x: -8, y: 6 },
      textPosition: { x: 7, y: 26 },
    };
    const ps = parts(geom);
    const [text] = of(ps, 'MTEXT') as Extract<EntityGeometry, { kind: 'MTEXT' }>[];
    expect(text!.contents).toBe('50');
    close(text!.rotation, Math.atan2(4, 3));
  });
});

describe('radius, diameter and angular dimensions', () => {
  it('draws a radius with text outside: the arrow from outside, DIMTOFL line from the centre', () => {
    const geom: DimensionGeometry = {
      ...common,
      dimType: 'radius',
      definitionPoint: { x: 0, y: 0 },
      chordPoint: { x: 10, y: 0 },
      leaderLength: 0,
      textPosition: { x: 20, y: 0 },
      textUserPositioned: true,
    };
    const ps = parts(geom);
    const lines = of(ps, 'LINE') as Extract<EntityGeometry, { kind: 'LINE' }>[];
    // Under the text to its far end ("R10" is 7.5 wide), then the centre line.
    expect(lines[0]).toEqual({ kind: 'LINE', start: { x: 23.75, y: 0 }, end: { x: 12.5, y: 0 } });
    expect(lines[1]).toEqual({ kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    const [solid] = of(ps, 'SOLID') as Extract<EntityGeometry, { kind: 'SOLID' }>[];
    expect(solid!.corners[2]).toEqual({ x: 10, y: 0 });
    // Moved by the user with DIMTAD 1: a gap and half the text height above the line.
    expect(of(ps, 'MTEXT')[0]).toMatchObject({ contents: 'R10', position: { x: 20, y: 1.875 } });
    // Without DIMTOFL the centre gets DIMCEN's mark instead.
    const mark = of(parts(geom, model({ ...ISO, DIMTOFL: false })), 'LINE');
    expect(mark).toContainEqual({ kind: 'LINE', start: { x: -2.5, y: 0 }, end: { x: 2.5, y: 0 } });
  });

  it('measures a diameter across its two points, %%c first', () => {
    const geom: DimensionGeometry = {
      ...common,
      dimType: 'diameter',
      definitionPoint: { x: -10, y: 0 },
      chordPoint: { x: 10, y: 0 },
      leaderLength: 0,
      textPosition: { x: 0, y: 0 },
    };
    expect(of(parts(geom), 'MTEXT')[0]).toMatchObject({ contents: '%%c20' });
  });

  it("draws a three-point angle: arc trimmed to the arrows' backs, extension lines past short legs", () => {
    const geom: DimensionGeometry = {
      ...common,
      dimType: 'angular3pt',
      vertex: { x: 0, y: 0 },
      first: { x: 10, y: 0 },
      second: { x: 0, y: 10 },
      definitionPoint: { x: 14.142135623730951, y: 14.142135623730951 },
      textPosition: { x: 25, y: 25 },
    };
    const ps = parts(geom);
    const [arc] = of(ps, 'ARC') as Extract<EntityGeometry, { kind: 'ARC' }>[];
    close(arc!.radius, 20);
    const step = 2 * Math.asin(2.5 / 40);
    close(arc!.startAngle, step);
    close(arc!.endAngle, Math.PI / 2 - step);
    const lines = of(ps, 'LINE') as Extract<EntityGeometry, { kind: 'LINE' }>[];
    expect(lines).toHaveLength(2);
    close(lines[0]!.start.x, 10.625);
    close(lines[0]!.end.x, 21.25);
    expect(of(ps, 'MTEXT')[0]).toMatchObject({ contents: '90%%d' });
  });

  it('picks the two-line angle that holds the arc point', () => {
    const geom: DimensionGeometry = {
      ...common,
      dimType: 'angular',
      line1Start: { x: 0, y: 0 },
      line1End: { x: 10, y: 0 },
      line2Start: { x: 0, y: 0 },
      definitionPoint: { x: 10, y: 10 },
      // In the 135° angle between the negative x axis and the 45° line.
      arcPoint: { x: -1, y: 5 },
      textPosition: { x: 0, y: 8 },
    };
    expect(of(parts(geom), 'MTEXT')[0]).toMatchObject({ contents: '135%%d' });
  });
});

describe('health comparison', () => {
  it('matches a dimension against itself and reports a moved line', () => {
    const ps = parts(linear());
    expect(compareParts(ps, ps, 2.5)).toEqual({ ok: true, problems: [] });
    const moved = ps.map((p) =>
      p.geom.kind === 'LINE' && p.geom.start.y === 20
        ? { ...p, geom: { ...p.geom, start: { x: 2.5, y: 21 }, end: { x: 97.5, y: 21 } } }
        : p,
    );
    expect(compareParts(ps, moved, 2.5).ok).toBe(false);
    // Stored true colours stand for the ACI the generator draws when the matcher says so.
    const red = ps.map((p) => ({ ...p, color: { kind: 'aci', index: 1 } as const }));
    const rgb = ps.map((p) => ({ ...p, color: { kind: 'rgb', r: 255, g: 0, b: 0 } as const }));
    expect(compareParts(red, rgb, 2.5).ok).toBe(false);
    expect(compareParts(red, rgb, 2.5, (g, s) => g.kind === 'aci' && s.kind === 'rgb').ok).toBe(
      true,
    );
  });
});
