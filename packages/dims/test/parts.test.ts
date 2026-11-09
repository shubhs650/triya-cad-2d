// M2-10: what the dimension engine draws for each dimension type, by AutoCAD's rules (the
// rules are commented in src/linear.ts, radial.ts and angular.ts), and the health comparison.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  newDimension,
  placeDimension,
  type DimStyleRecord,
  type DimensionGeometry,
  type EntityGeometry,
  type HeaderValue,
  type TextMeasure,
} from '@triya/engine';
import {
  compareParts,
  dimensionParts,
  measuredText,
  regenerateDimension,
  type DimPart,
} from '../src/index';

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

describe('ordinate dimensions (part 2)', () => {
  const ordinate = (
    extra: Partial<Extract<DimensionGeometry, { dimType: 'ordinate' }>> = {},
  ): DimensionGeometry => ({
    ...common,
    dimType: 'ordinate',
    definitionPoint: { x: 0, y: 0 },
    axis: 'y',
    feature: { x: 10, y: 5 },
    leaderEnd: { x: 40, y: 8 },
    textPosition: { x: 0, y: 0 },
    ...extra,
  });

  it('jogs a leader whose end is off the feature: 4 × DIMASZ short, over 2 × DIMASZ', () => {
    const ps = parts(ordinate());
    expect(of(ps, 'LINE')).toEqual([
      { kind: 'LINE', start: { x: 10.625, y: 5 }, end: { x: 30, y: 5 } },
      { kind: 'LINE', start: { x: 30, y: 5 }, end: { x: 35, y: 8 } },
      // DIMTAD 1: on under the text, to its far end ("5" is 2.5 wide, a gap past the end).
      { kind: 'LINE', start: { x: 35, y: 8 }, end: { x: 43.125, y: 8 } },
    ]);
    // The Y ordinate is the feature's distance from the origin along Y, aligned with the leader.
    expect(of(ps, 'MTEXT')[0]).toMatchObject({
      contents: '5',
      position: { x: 41.875, y: 9.875 },
      rotation: 0,
    });
    expect(of(ps, 'SOLID')).toEqual([]);
    expect(
      ps.filter((p) => p.defpoint).map((p) => (p.geom as { position: unknown }).position),
    ).toEqual([
      { x: 10, y: 5 },
      { x: 40, y: 8 },
      { x: 0, y: 0 },
    ]);
  });

  it('runs a straight X leader downwards, text along it whatever DIMTIH says', () => {
    const geom = ordinate({
      axis: 'x',
      definitionPoint: { x: 5, y: 0 },
      feature: { x: 20, y: 30 },
      leaderEnd: { x: 20, y: 10 },
    });
    const ps = parts(geom, model({ ...ISO, DIMTAD: 0, DIMTIH: true, DIMTOH: true }));
    expect(of(ps, 'LINE')).toEqual([
      { kind: 'LINE', start: { x: 20, y: 29.375 }, end: { x: 20, y: 10 } },
    ]);
    const [text] = of(ps, 'MTEXT') as Extract<EntityGeometry, { kind: 'MTEXT' }>[];
    expect(text).toMatchObject({ contents: '\\A1;15' });
    close(text!.position.x, 20);
    close(text!.position.y, 10 - 0.625 - 2.5);
    close(text!.rotation, Math.PI / 2);
  });
});

describe('jogged radius dimensions (part 2)', () => {
  const jogged = (
    extra: Partial<Extract<DimensionGeometry, { dimType: 'jogged' }>> = {},
  ): DimensionGeometry => ({
    ...common,
    kind: 'LARGE_RADIAL_DIMENSION',
    dimType: 'jogged',
    definitionPoint: { x: 0, y: 0 },
    chordPoint: { x: 40, y: 0 },
    overrideCenter: { x: 0, y: 4 },
    jogPoint: { x: 20, y: 2 },
    leaderLength: 0,
    textPosition: { x: 30, y: 0 },
    textUserPositioned: true,
    ...extra,
  });

  it('draws from the displaced centre, jogs at DIMJOGANG through the jog point, and on to the arrow', () => {
    const ps = parts(jogged(), model({ ...ISO, DIMTAD: 0, DIMJOGANG: Math.PI / 4 }));
    const lines = (of(ps, 'LINE') as Extract<EntityGeometry, { kind: 'LINE' }>[]).map((l) => [
      l.start.x,
      l.start.y,
      l.end.x,
      l.end.y,
    ]);
    const want = [
      [0, 4, 22, 4],
      [22, 4, 18, 0],
      // The radius line, out of the centred text's box ("R40" 7.5 wide, DIMGAP either side).
      [18, 0, 25.625, 0],
      [34.375, 0, 37.5, 0],
    ];
    expect(lines).toHaveLength(want.length);
    lines.forEach((l, i) => l.forEach((v, j) => close(v, want[i]![j]!)));
    const [solid] = of(ps, 'SOLID') as Extract<EntityGeometry, { kind: 'SOLID' }>[];
    expect(solid!.corners[2]).toEqual({ x: 40, y: 0 });
    expect(of(ps, 'MTEXT')[0]).toMatchObject({ contents: '\\A1;R40', position: { x: 30, y: 0 } });
    expect(ps.filter((p) => p.defpoint)).toHaveLength(3);
  });

  it('jogs the other way when the displaced centre is on the right of the radius', () => {
    const ps = parts(
      jogged({ overrideCenter: { x: 0, y: -4 }, jogPoint: { x: 20, y: -2 } }),
      model({ ...ISO, DIMTAD: 0, DIMJOGANG: Math.PI / 4 }),
    );
    const [, jog] = of(ps, 'LINE') as Extract<EntityGeometry, { kind: 'LINE' }>[];
    close(jog!.start.x, 22);
    close(jog!.start.y, -4);
    close(jog!.end.x, 18);
    close(jog!.end.y, 0);
  });
});

describe('arc length dimensions (part 2)', () => {
  const r = 10;
  const sweep = Math.PI / 3;
  const arcLength = (extra: object = {}): DimensionGeometry => ({
    ...common,
    kind: 'ARC_DIMENSION',
    dimType: 'arc',
    center: { x: 0, y: 0 },
    first: { x: r, y: 0 },
    second: { x: r * Math.cos(sweep), y: r * Math.sin(sweep) },
    startAngle: 0,
    endAngle: sweep,
    partial: false,
    // The dimension arc's radius is 15.
    definitionPoint: { x: 15 * Math.cos(sweep / 2), y: 15 * Math.sin(sweep / 2) },
    textPosition: { x: 0, y: 0 },
    ...extra,
  });

  it('measures along the arc, with extension lines parallel under 90° and the arc symbol before the text', () => {
    const ps = parts(arcLength(), model({ ...ISO, DIMTAD: 0, DIMTIH: true }));
    const lines = of(ps, 'LINE') as Extract<EntityGeometry, { kind: 'LINE' }>[];
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      // Along the bisector (30°), from DIMEXO off the arc's end to DIMEXE past the dimension arc.
      close(Math.atan2(l.end.y - l.start.y, l.end.x - l.start.x), sweep / 2);
      close(Math.hypot(l.end.x, l.end.y) > 15 ? 1 : 0, 1);
    }
    close(lines[0]!.start.x, r + 0.625 * Math.cos(sweep / 2));
    const [text] = of(ps, 'MTEXT') as Extract<EntityGeometry, { kind: 'MTEXT' }>[];
    expect(text).toMatchObject({ contents: '\\A1;10.47', rotation: 0 });
    // Placed on the dimension arc's middle.
    close(text!.position.x, 15 * Math.cos(sweep / 2));
    close(text!.position.y, 15 * Math.sin(sweep / 2));
    const arcs = of(ps, 'ARC') as Extract<EntityGeometry, { kind: 'ARC' }>[];
    const dimArcs = arcs.filter((a) => Math.abs(a.radius - 15) < 1e-9);
    expect(dimArcs.length).toBeGreaterThanOrEqual(1);
    // The arc symbol: a half circle just before the text, in Continuous.
    const symbol = ps.find((p) => p.geom.kind === 'ARC' && p.geom.radius < 15);
    expect(symbol).toMatchObject({ linetype: '14' });
    const sg = symbol!.geom as Extract<EntityGeometry, { kind: 'ARC' }>;
    close(sg.startAngle, 0);
    close(sg.endAngle, Math.PI);
    close(sg.center.x + sg.radius, text!.position.x - (5 * 2.5) / 2);
    // DIMARCSYM 2: no symbol.
    const none = parts(arcLength(), model({ ...ISO, DIMTAD: 0, DIMARCSYM: 2 }));
    expect(of(none, 'ARC').every((a) => (a as { radius: number }).radius === 15)).toBe(true);
    expect(of(ps, 'SOLID')).toHaveLength(2);
    expect(ps.filter((p) => p.defpoint)).toHaveLength(4);
  });

  it('runs extension lines radially over 90°', () => {
    const wide = (2 * Math.PI) / 3;
    const ps = parts(
      arcLength({
        second: { x: r * Math.cos(wide), y: r * Math.sin(wide) },
        endAngle: wide,
        definitionPoint: { x: 15 * Math.cos(wide / 2), y: 15 * Math.sin(wide / 2) },
      }),
    );
    const lines = of(ps, 'LINE') as Extract<EntityGeometry, { kind: 'LINE' }>[];
    close(Math.atan2(lines[0]!.end.y - lines[0]!.start.y, lines[0]!.end.x - lines[0]!.start.x), 0);
    expect(lines[0]).toMatchObject({ start: { x: 10.625 } });
    close(lines[0]!.end.x, 15 + 1.25);
  });
});

describe('text over an extension line, DIMJUST 3 and 4 (part 2)', () => {
  it('turns the text along the extension line, past the dimension line, and leaves that line whole', () => {
    const ps = parts(linear(), model({ ...ISO, DIMJUST: 3 }));
    const [text] = of(ps, 'MTEXT') as Extract<EntityGeometry, { kind: 'MTEXT' }>[];
    close(text!.rotation, Math.PI / 2);
    // "100" is 7.5 wide: its middle a gap and half its width up the first extension line,
    // DIMTAD 1 putting it on the line's far side from the text's reading direction.
    close(text!.position.x, -1.875);
    close(text!.position.y, 20 + 0.625 + 3.75);
    const lines = of(ps, 'LINE') as Extract<EntityGeometry, { kind: 'LINE' }>[];
    expect(lines[2]).toEqual({ kind: 'LINE', start: { x: 2.5, y: 20 }, end: { x: 97.5, y: 20 } });
    const second = of(parts(linear(), model({ ...ISO, DIMJUST: 4 })), 'MTEXT')[0] as Extract<
      EntityGeometry,
      { kind: 'MTEXT' }
    >;
    close(second.position.x, 100 - 1.875);
  });
});

describe('tolerances, limits and alternate units (part 2)', () => {
  const textOf = (vars: DimStyleRecord['vars'], extra = {}) =>
    (of(parts(linear(extra), model({ ...ISO, ...vars })), 'MTEXT')[0] as { contents: string })
      .contents;

  it('appends DIMTOL deviations and alternate units to a linear dimension', () => {
    expect(
      textOf({ DIMTOL: true, DIMTP: 0.1, DIMTM: 0.05, DIMTFAC: 0.7, DIMTDEC: 2, DIMTZIN: 0 }),
    ).toBe('100{\\H0.7x;\\S+0.10^-0.05;}');
    expect(textOf({ DIMALT: true, DIMALTF: 0.03937, DIMALTD: 2, DIMALTU: 2, DIMALTZ: 0 })).toBe(
      '100 [3.94]',
    );
  });

  it('prefixes R to a radius in both units', () => {
    const geom: DimensionGeometry = {
      ...common,
      dimType: 'radius',
      definitionPoint: { x: 0, y: 0 },
      chordPoint: { x: 10, y: 0 },
      leaderLength: 0,
      textPosition: { x: 20, y: 0 },
      textUserPositioned: true,
    };
    const ps = parts(geom, model({ ...ISO, DIMALT: true, DIMALTF: 25.4, DIMALTD: 0, DIMALTU: 2 }));
    expect(of(ps, 'MTEXT')[0]).toMatchObject({ contents: 'R10 [R254]' });
  });
});

describe('regeneration on touch (M2-10 part 3)', () => {
  /** A model whose dimension keeps a stored `*D` block (empty: only its existence matters). */
  function stored(): DocumentModel {
    const m = model();
    const init = {
      handle: '60',
      name: '*D1',
      basePoint: { x: 0, y: 0 },
    };
    (m.blocks as Map<string, typeof init>).set('60', init);
    return m;
  }

  it('places the text afresh where the stored block kept it, and writes DXF 11 back', () => {
    const m = stored();
    // Stretched: the second origin moved to x = 120, the text still where it was stored.
    const geom = linear({ block: '60', second: { x: 120, y: 0 } });
    const kept = of(dimensionParts({ geom }, m, measure)!, 'MTEXT')[0];
    expect(kept).toMatchObject({ contents: '120', position: { x: 50, y: 21.875 } });
    const r = regenerateDimension({ geom }, m, measure)!;
    expect(of(r.parts, 'MTEXT')[0]).toMatchObject({
      contents: '120',
      position: { x: 60, y: 21.875 },
    });
    expect(r.geom.textPosition).toEqual({ x: 60, y: 21.875 });
    expect(r.geom.block).toBe('60');
    expect(r.parts.filter((p) => p.defpoint)).toHaveLength(3);
  });

  it('puts a linear DXF 10 back on the second extension line', () => {
    const geom = linear({ second: { x: 120, y: -5 }, definitionPoint: { x: 100, y: 20 } });
    const r = regenerateDimension({ geom }, model(), measure)!;
    expect(r.geom.definitionPoint).toEqual({ x: 120, y: 20 });
    const aligned = regenerateDimension(
      {
        geom: linear({
          dimType: 'aligned',
          second: { x: 100, y: 0 },
          definitionPoint: { x: 90, y: 20 },
        }),
      },
      model(),
      measure,
    )!;
    expect(aligned.geom.definitionPoint).toEqual({ x: 100, y: 20 });
  });

  it('keeps text the user placed (DXF 70 bit 128)', () => {
    const geom = linear({
      second: { x: 120, y: 0 },
      textUserPositioned: true,
      textPosition: { x: 30, y: 25 },
    });
    const r = regenerateDimension({ geom }, model(), measure)!;
    expect(r.geom.textPosition).toEqual({ x: 30, y: 25 });
    expect(of(r.parts, 'MTEXT')[0]).toMatchObject({ position: { x: 30, y: 25 } });
  });

  it('gives the text part DXF 11, and nothing for what it cannot measure or draw', () => {
    for (const geom of [linear(), linear({ dimType: 'aligned' })] as DimensionGeometry[]) {
      const r = regenerateDimension({ geom }, model(), measure)!;
      expect(r.parts.find((p) => p.geom.kind === 'MTEXT')?.textPosition).toEqual(
        r.geom.textPosition,
      );
    }
    expect(regenerateDimension({ geom: linear() }, model(), () => undefined)).toBeUndefined();
    expect(
      regenerateDimension({ geom: { kind: 'POINT', position: { x: 0, y: 0 } } }, model(), measure),
    ).toBeUndefined();
  });
});

describe('dimensions the commands make (M2-11)', () => {
  const base = newDimension(STYLE);
  const make = (p: Parameters<typeof placeDimension>[0], at: { x: number; y: number }) =>
    regenerateDimension({ geom: placeDimension(p, at)! }, model(), measure)!;

  it('says what each kind measures, formatted by the style', () => {
    const linear = make({ kind: 'linear', first: { x: 0, y: 0 }, second: { x: 30, y: 40 }, base }, { x: 15, y: 60 });
    expect(linear.measurement).toBe('30');
    const aligned = make({ kind: 'aligned', first: { x: 0, y: 0 }, second: { x: 30, y: 40 }, base }, { x: 0, y: 10 });
    expect(aligned.measurement).toBe('50');
    const radius = make({ kind: 'radius', center: { x: 0, y: 0 }, radius: 12.5, base }, { x: 20, y: 0 });
    expect(radius.measurement).toBe('12.5');
    const diameter = make({ kind: 'diameter', center: { x: 0, y: 0 }, radius: 12.5, base }, { x: 20, y: 0 });
    expect(diameter.measurement).toBe('25');
    const angle = make(
      { kind: 'angular3pt', vertex: { x: 0, y: 0 }, first: { x: 10, y: 0 }, second: { x: 0, y: 10 }, base },
      { x: 5, y: 5 },
    );
    expect(angle.measurement).toBe('90°');
    const lines = make(
      { kind: 'angular', line1: [{ x: 0, y: 0 }, { x: 10, y: 0 }], line2: [{ x: 0, y: 0 }, { x: 10, y: 10 }], base },
      { x: 8, y: 3 },
    );
    expect(lines.measurement).toBe('45°');
    expect(measuredText({ geom: { kind: 'POINT', position: { x: 0, y: 0 } } }, model())).toBeUndefined();
  });

  it('draws a new radius dimension with its text where the location put it', () => {
    const r = make({ kind: 'radius', center: { x: 0, y: 0 }, radius: 10, base }, { x: 30, y: 0 });
    expect(r.geom.textPosition).toEqual({ x: 30, y: 0 });
    expect(of(r.parts, 'MTEXT')[0]?.contents).toMatch(/R10$/);
  });

  it('measures the reflex angle when the arc point is outside the three-point angle', () => {
    const r = make(
      { kind: 'angular3pt', vertex: { x: 0, y: 0 }, first: { x: 10, y: 0 }, second: { x: 0, y: 10 }, base },
      { x: -5, y: -5 },
    );
    expect(r.measurement).toBe('270°');
  });
});
