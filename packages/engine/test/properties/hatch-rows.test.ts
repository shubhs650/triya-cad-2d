// M2-35 part 3: a hatch's Pattern rows in the Properties palette are edited, as AutoCAD 2024's
// are: Pattern name (a pattern the app's library holds, or SOLID), Angle and Scale (predefined
// and custom patterns), Spacing and Double (user-defined ones) and Island detection style.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  propertySheet,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type EntityGeometry,
  type HatchPatternLine,
  type PropertyRow,
  type PropertySheet,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { entityInit, sampleInit } from '../model/fixtures';

type Hatch = Extract<EntityGeometry, { kind: 'HATCH' }>;

const SQUARE = {
  flags: 1,
  polyline: {
    closed: true,
    vertices: [
      { x: 0, y: 0, bulge: 0 },
      { x: 20, y: 0, bulge: 0 },
      { x: 20, y: 20, bulge: 0 },
      { x: 0, y: 20, bulge: 0 },
    ],
  },
};

const Q = Math.PI / 4;
const ANSI31_GAP = 3.175;

/** ANSI31 at angle 0 and scale 1 about (10, 0), as AutoCAD stores it (DXF 53–49). */
const ansi31: HatchPatternLine = {
  angle: Q,
  base: { x: 10, y: 0 },
  offset: { x: -ANSI31_GAP * Math.sin(Q), y: ANSI31_GAP * Math.cos(Q) },
  dashes: [],
};

const hatchGeom = (over: Partial<Hatch> = {}): Hatch => ({
  kind: 'HATCH',
  pattern: 'ANSI31',
  solid: false,
  associative: false,
  style: 0,
  patternType: 1,
  patternAngle: 0,
  patternScale: 1,
  double: false,
  loops: [SQUARE],
  patternLines: [ansi31],
  seedPoints: [],
  ...over,
});

/** A user-defined hatch: lines at 30°, 2 apart, from (1, 1). */
const userGeom = (): Hatch =>
  hatchGeom({
    pattern: '_USER',
    patternType: 0,
    patternAngle: Math.PI / 6,
    patternScale: 2,
    patternLines: [
      {
        angle: Math.PI / 6,
        base: { x: 1, y: 1 },
        offset: { x: -2 * Math.sin(Math.PI / 6), y: 2 * Math.cos(Math.PI / 6) },
        dashes: [],
      },
    ],
  });

const solidGeom = (): Hatch =>
  hatchGeom({ pattern: 'SOLID', solid: true, patternLines: [], patternScale: 1 });

const gradientGeom = (): Hatch =>
  hatchGeom({
    pattern: 'SOLID',
    solid: true,
    patternLines: [],
    gradient: {
      name: 'LINEAR',
      angle: 0,
      shift: 0,
      singleColor: false,
      tint: 0,
      colors: [
        { value: 0, color: { kind: 'aci', index: 1 } },
        { value: 1, color: { kind: 'aci', index: 5 } },
      ],
    },
  } as Partial<Hatch>);

function init(extra: NonNullable<DocumentInit['entities']>): DocumentInit {
  const base = sampleInit();
  return { ...base, entities: [...(base.entities ?? []), ...extra] };
}

/** `answer` replies to the app's `hatchPattern` request (the pattern library is the app's). */
function setup(
  i: DocumentInit,
  answer?: (r: Extract<ViewRequest, { op: 'hatchPattern' }>) => ViewReply,
) {
  const model = DocumentModel.create(i);
  const requests: ViewRequest[] = [];
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r) => {
        requests.push(r);
        if (r.op === 'hatchPattern' && answer) return Promise.resolve(answer(r));
        return Promise.resolve({ ok: true });
      },
    },
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const byHandle = (h: string): Entity => model.entityByHandle(h)!;
  const ids = (...hs: string[]) => hs.map((h) => byHandle(h).id);
  const g = (h: string) => byHandle(h).geom as Hatch;
  return { model, bus, log, byHandle, ids, requests, g };
}

const rowOf = (sheet: PropertySheet, label: string): PropertyRow | undefined => {
  for (const s of sheet.sections) {
    const r = s.rows.find((x) => x.label === label);
    if (r) return r;
  }
  return undefined;
};

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);

function expectLine(l: HatchPatternLine | undefined, want: HatchPatternLine): void {
  expect(l).toBeDefined();
  close(l!.angle, want.angle);
  close(l!.base.x, want.base.x);
  close(l!.base.y, want.base.y);
  close(l!.offset.x, want.offset.x);
  close(l!.offset.y, want.offset.y);
  expect(l!.dashes.length).toBe(want.dashes.length);
  l!.dashes.forEach((d, i) => close(d, want.dashes[i]!));
}

describe('a hatch’s Pattern rows (M2-35 part 3)', () => {
  it('lists the rows a predefined, a user-defined, a solid and a gradient hatch edit', () => {
    const s = setup(
      init([
        entityInit('70', hatchGeom()),
        entityInit('71', userGeom()),
        entityInit('72', solidGeom()),
        entityInit('73', gradientGeom()),
      ]),
    );
    const one = propertySheet(s.model, s.ids('70'));
    expect(rowOf(one, 'Type')).toMatchObject({ value: 'Predefined', readOnly: true });
    const name = rowOf(one, 'Pattern name')!;
    expect(name).toMatchObject({ kind: 'text', value: 'ANSI31' });
    expect(name.readOnly).toBeUndefined();
    expect(rowOf(one, 'Angle')!.readOnly).toBeUndefined();
    expect(rowOf(one, 'Scale')).toMatchObject({ kind: 'number', value: 1 });
    expect(rowOf(one, 'Scale')!.readOnly).toBeUndefined();
    expect(rowOf(one, 'Spacing')).toBeUndefined();
    expect(rowOf(one, 'Double')).toBeUndefined();
    const island = rowOf(one, 'Island detection style')!;
    expect(island).toMatchObject({ kind: 'choice', value: '0' });
    expect(island.options?.map((o) => o.label)).toEqual(['Normal', 'Outer', 'Ignore']);
    // M2-35 part 13: Associative is a choice (Yes lets go of the boundary only one way).
    expect(rowOf(one, 'Associative')).toMatchObject({ kind: 'choice', value: 'no' });
    expect(rowOf(one, 'Associative')!.readOnly).toBeUndefined();

    const user = propertySheet(s.model, s.ids('71'));
    expect(rowOf(user, 'Type')!.value).toBe('User defined');
    expect(rowOf(user, 'Scale')).toBeUndefined();
    expect(rowOf(user, 'Spacing')).toMatchObject({ kind: 'distance', value: 2 });
    expect(rowOf(user, 'Double')).toMatchObject({ kind: 'choice', value: 'no' });

    // A solid fill has no lines to turn or scale: AutoCAD greys its Angle and Scale.
    const solid = propertySheet(s.model, s.ids('72'));
    expect(rowOf(solid, 'Angle')!.readOnly).toBe(true);
    expect(rowOf(solid, 'Scale')!.readOnly).toBe(true);
    expect(rowOf(solid, 'Pattern name')!.readOnly).toBeUndefined();

    // A gradient has its own rows (M2-35 part 13), not a pattern's.
    const gradient = propertySheet(s.model, s.ids('73'));
    expect(rowOf(gradient, 'Pattern name')).toBeUndefined();
    expect(rowOf(gradient, 'Angle')).toBeUndefined();
    expect(rowOf(gradient, 'Gradient name')).toMatchObject({ kind: 'choice', value: 'LINEAR' });

    // Mixed: the rows edit the hatches they apply to.
    const all = propertySheet(s.model, s.ids('70', '71', '72'));
    expect(rowOf(all, 'Scale')).toMatchObject({ value: 1 });
    expect(rowOf(all, 'Scale')!.readOnly).toBeUndefined();
    expect(rowOf(all, 'Spacing')).toMatchObject({ value: 2 });
    expect(rowOf(all, 'Angle')!.varies).toBe(true);
  });

  it('turns a pattern about its origin when its angle changes, as one undo step', async () => {
    const s = setup(init([entityInit('70', hatchGeom()), entityInit('72', solidGeom())]));
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'patternAngle', value: '90' }, 'HATCH');
    const g = s.g('70');
    close(g.patternAngle, Math.PI / 2);
    // ANSI31's 45° lines now run at 135°, still through the origin (10, 0), 3.175 apart.
    expectLine(g.patternLines[0], {
      angle: Q + Math.PI / 2,
      base: { x: 10, y: 0 },
      offset: { x: -ANSI31_GAP * Math.sin(3 * Q), y: ANSI31_GAP * Math.cos(3 * Q) },
      dashes: [],
    });
    // The solid fill has nothing to turn.
    expect(s.g('72')).toEqual(solidGeom());
    expect(s.bus.undo.state.undoable).toBe(1);
    await s.bus.submit('U');
    expect(s.g('70')).toEqual(hatchGeom());
  });

  it('scales a pattern’s spacing and dashes about its origin', async () => {
    const dashed = hatchGeom({
      patternLines: [{ ...ansi31, dashes: [1, -0.5] }],
    });
    const s = setup(init([entityInit('70', dashed), entityInit('71', userGeom())]));
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'patternScale', value: '2' }, 'HATCH');
    const g = s.g('70');
    expect(g.patternScale).toBe(2);
    expectLine(g.patternLines[0], {
      angle: Q,
      base: { x: 10, y: 0 },
      offset: { x: -2 * ANSI31_GAP * Math.sin(Q), y: 2 * ANSI31_GAP * Math.cos(Q) },
      dashes: [2, -1],
    });
    // A user-defined hatch's lines are set by its Spacing.
    expect(s.log.at(-1)).toBe('1 object was not changed: user defined (its Spacing sets it).');
    expect(s.g('71')).toEqual(userGeom());
    await s.bus.setProperty({ key: 'patternScale', value: '0' }, 'HATCH');
    expect(s.log.at(-1)).toBe('Invalid input.');
    expect(s.g('70').patternScale).toBe(2);
  });

  it('sets a user-defined hatch’s spacing and doubles it', async () => {
    const s = setup(init([entityInit('71', userGeom())]));
    const a = Math.PI / 6;
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'patternSpacing', value: '5' }, 'HATCH');
    expect(s.g('71').patternScale).toBe(5);
    expectLine(s.g('71').patternLines[0], {
      angle: a,
      base: { x: 1, y: 1 },
      offset: { x: -5 * Math.sin(a), y: 5 * Math.cos(a) },
      dashes: [],
    });
    await s.bus.setProperty({ key: 'double', value: 'yes' }, 'HATCH');
    const g = s.g('71');
    expect(g.double).toBe(true);
    // The second family at 90° to the first, through the same origin (AutoCAD's Double).
    expect(g.patternLines).toHaveLength(2);
    expectLine(g.patternLines[1], {
      angle: a + Math.PI / 2,
      base: { x: 1, y: 1 },
      offset: { x: -5 * Math.sin(a + Math.PI / 2), y: 5 * Math.cos(a + Math.PI / 2) },
      dashes: [],
    });
    // Turning a doubled hatch turns both families.
    await s.bus.setProperty({ key: 'patternAngle', value: '0' }, 'HATCH');
    close(s.g('71').patternLines[0]!.angle, 0);
    close(s.g('71').patternLines[1]!.angle, Math.PI / 2);
    await s.bus.setProperty({ key: 'double', value: 'no' }, 'HATCH');
    expect(s.g('71').double).toBe(false);
    expect(s.g('71').patternLines).toHaveLength(1);
    await s.bus.setProperty({ key: 'patternSpacing', value: '-1' }, 'HATCH');
    expect(s.log.at(-1)).toBe('Invalid input.');
  });

  it('sets the island detection style', async () => {
    const s = setup(init([entityInit('70', hatchGeom())]));
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'islandStyle', value: '1' }, 'HATCH');
    expect(s.g('70').style).toBe(1);
    await s.bus.setProperty({ key: 'islandStyle', value: '7' }, 'HATCH');
    expect(s.log.at(-1)).toBe('Invalid input.');
  });

  it('makes a pattern hatch a solid fill without asking the app', async () => {
    const s = setup(init([entityInit('70', hatchGeom())]));
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'patternName', value: 'solid' }, 'HATCH');
    expect(s.requests.filter((r) => r.op === 'hatchPattern')).toHaveLength(0);
    expect(s.g('70')).toMatchObject({
      pattern: 'SOLID',
      solid: true,
      patternType: 1,
      patternLines: [],
      double: false,
    });
  });

  it('gives a hatch another pattern from the app’s library, at its angle, scale and origin', async () => {
    const placed = (angle: number, scale: number, origin: { x: number; y: number }) => [
      { angle, base: origin, offset: { x: 0, y: scale }, dashes: [scale] },
    ];
    const s = setup(
      init([
        entityInit('70', hatchGeom({ patternAngle: 0.5, patternScale: 3 })),
        entityInit('71', userGeom()),
        entityInit('72', solidGeom()),
        entityInit('73', hatchGeom({ pattern: 'triya_brick' })),
      ]),
      (r) =>
        r.name.toUpperCase() === 'TRIYA_BRICK'
          ? {
              ok: true,
              pattern: {
                name: 'TRIYA_BRICK',
                custom: true,
                lines: r.placements.map((p) => placed(p.angle, p.scale, p.origin)),
              },
            }
          : { ok: false, message: `Pattern "${r.name}" is not in the pattern library.` },
    );
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'patternName', value: 'Triya_Brick' }, 'HATCH');
    const asked = s.requests.filter((r) => r.op === 'hatchPattern');
    expect(asked).toHaveLength(1);
    // The hatch already named TRIYA_BRICK keeps its lines; the others are placed as they lie:
    // a pattern at its angle and scale about its first line's origin, a user-defined one at
    // scale 1 (its spacing is not a scale), a solid fill at the drawing's origin.
    expect(asked[0]).toMatchObject({
      name: 'Triya_Brick',
      placements: [
        { angle: 0.5, scale: 3, origin: { x: 10, y: 0 } },
        { angle: Math.PI / 6, scale: 1, origin: { x: 1, y: 1 } },
        { angle: 0, scale: 1, origin: { x: 0, y: 0 } },
      ],
    });
    expect(s.g('70')).toMatchObject({
      pattern: 'TRIYA_BRICK',
      patternType: 2,
      solid: false,
      patternAngle: 0.5,
      patternScale: 3,
      patternLines: placed(0.5, 3, { x: 10, y: 0 }),
    });
    expect(s.g('71')).toMatchObject({ pattern: 'TRIYA_BRICK', patternType: 2, patternScale: 1 });
    expect(s.g('72')).toMatchObject({ pattern: 'TRIYA_BRICK', solid: false });
    expect(s.g('73')).toEqual(hatchGeom({ pattern: 'triya_brick' }));
    expect(s.bus.undo.state.undoable).toBe(1);

    await s.bus.setProperty({ key: 'patternName', value: 'NOPE' }, 'HATCH');
    expect(s.log.at(-1)).toBe('Pattern "NOPE" is not in the pattern library.');
    expect(s.g('70').pattern).toBe('TRIYA_BRICK');
    expect(s.bus.undo.state.undoable).toBe(1);
  });

  it('refuses another pattern for a gradient fill and an empty name', async () => {
    const s = setup(init([entityInit('73', gradientGeom())]));
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'patternName', value: 'SOLID' }, 'HATCH');
    expect(s.log.at(-1)).toBe('1 object was not changed: a gradient fill.');
    await s.bus.setProperty({ key: 'patternName', value: '  ' }, 'HATCH');
    expect(s.log.at(-1)).toBe('Invalid input.');
  });
});

// M2-35 part 13: a gradient's own rows (ActiveX AcadHatch's GradientName, GradientColor1 and 2,
// GradientAngle and GradientCentered; a one-colour gradient's tint, GFCLRLUM), a pattern's
// Origin X and Y (AcadHatch.Origin) and Associative (HATCHEDIT's Associative off).
describe('a hatch’s gradient, origin and associative rows (M2-35 part 13)', () => {
  const oneColour = (): Hatch => {
    const g = gradientGeom();
    return { ...g, gradient: { ...g.gradient!, singleColor: true, tint: 0.25 } };
  };

  it('lists a gradient’s rows, and a pattern’s origin', () => {
    const s = setup(
      init([
        entityInit('70', hatchGeom()),
        entityInit('73', gradientGeom()),
        entityInit('74', oneColour()),
      ]),
    );
    const two = propertySheet(s.model, s.ids('73'));
    expect(rowOf(two, 'Type')!.value).toBe('Gradient');
    const name = rowOf(two, 'Gradient name')!;
    expect(name.options?.map((o) => o.value)).toEqual([
      'LINEAR',
      'CYLINDER',
      'INVCYLINDER',
      'SPHERICAL',
      'INVSPHERICAL',
      'HEMISPHERICAL',
      'INVHEMISPHERICAL',
      'CURVED',
      'INVCURVED',
    ]);
    const c1 = rowOf(two, 'Color 1')!;
    expect(c1).toMatchObject({ kind: 'choice', value: 'aci:1', colorDialog: 'true' });
    // A gradient's colours are index or true colours: no ByLayer or ByBlock.
    expect(c1.options?.map((o) => o.value)).not.toContain('ByLayer');
    expect(rowOf(two, 'Color 2')).toMatchObject({ value: 'aci:5', colorDialog: 'true' });
    expect(rowOf(two, 'Gradient tint')).toBeUndefined();
    expect(rowOf(two, 'Gradient angle')).toMatchObject({ kind: 'angle', value: 0 });
    expect(rowOf(two, 'Centered')).toMatchObject({ kind: 'choice', value: 'yes' });
    expect(rowOf(two, 'Origin X')).toBeUndefined();

    const one = propertySheet(s.model, s.ids('74'));
    expect(rowOf(one, 'Color 2')).toBeUndefined();
    expect(rowOf(one, 'Gradient tint')).toMatchObject({ kind: 'number', value: 0.25 });

    const pattern = propertySheet(s.model, s.ids('70'));
    expect(rowOf(pattern, 'Origin X')).toMatchObject({ kind: 'distance', value: 10 });
    expect(rowOf(pattern, 'Origin Y')).toMatchObject({ kind: 'distance', value: 0 });
    expect(rowOf(pattern, 'Gradient name')).toBeUndefined();

    // Mixed: each row shows for the hatches it edits.
    const all = propertySheet(s.model, s.ids('70', '73', '74'));
    expect(rowOf(all, 'Pattern name')).toMatchObject({ value: 'ANSI31' });
    expect(rowOf(all, 'Pattern name')!.readOnly).toBeUndefined();
    expect(rowOf(all, 'Gradient name')).toMatchObject({ value: 'LINEAR' });
    expect(rowOf(all, 'Color 2')).toMatchObject({ value: 'aci:5' });
    expect(rowOf(all, 'Gradient tint')).toMatchObject({ value: 0.25 });
    expect(rowOf(all, 'Origin X')).toMatchObject({ value: 10 });
  });

  it('edits a gradient’s name, colours, angle and centring, each one undo step', async () => {
    const s = setup(init([entityInit('70', hatchGeom()), entityInit('73', gradientGeom())]));
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'gradientName', value: 'INVSPHERICAL' }, 'HATCH');
    expect(s.g('73').gradient!.name).toBe('INVSPHERICAL');
    // The pattern hatch has no gradient to change.
    expect(s.g('70')).toEqual(hatchGeom());
    await s.bus.setProperty({ key: 'gradientColor1', value: 'rgb:10,20,30' }, 'HATCH');
    expect(s.g('73').gradient!.colors[0]).toEqual({
      value: 0,
      color: { kind: 'rgb', r: 10, g: 20, b: 30 },
    });
    await s.bus.setProperty({ key: 'gradientColor2', value: 'aci:3' }, 'HATCH');
    expect(s.g('73').gradient!.colors[1]).toEqual({ value: 1, color: { kind: 'aci', index: 3 } });
    await s.bus.setProperty({ key: 'gradientAngle', value: '45' }, 'HATCH');
    close(s.g('73').gradient!.angle, Q);
    await s.bus.setProperty({ key: 'gradientCentered', value: 'no' }, 'HATCH');
    expect(s.g('73').gradient!.shift).toBe(1);
    expect(s.bus.undo.state.undoable).toBe(5);
    await s.bus.setProperty({ key: 'gradientCentered', value: 'yes' }, 'HATCH');
    expect(s.g('73').gradient!.shift).toBe(0);
    for (let i = 0; i < 6; i++) await s.bus.submit('U');
    expect(s.g('73')).toEqual(gradientGeom());
  });

  it('refuses colours and values a gradient cannot take', async () => {
    const s = setup(init([entityInit('73', gradientGeom()), entityInit('74', oneColour())]));
    await s.bus.selectAll();
    for (const [key, value] of [
      ['gradientName', 'RADIAL'],
      ['gradientColor1', 'ByLayer'],
      ['gradientColor1', 'ByBlock'],
      // The save writes no colour-book name for a gradient's colours (DXF 421 only).
      ['gradientColor1', 'rgb:1,2,3;RAL CLASSIC;RAL 1000'],
      ['gradientColor2', 'nonsense'],
      ['gradientTint', '1.5'],
      ['gradientTint', '-0.1'],
      ['gradientCentered', 'maybe'],
    ] as const) {
      await s.bus.setProperty({ key, value }, 'HATCH');
      expect(s.log.at(-1), `${key} ${value}`).toBe('Invalid input.');
    }
    expect(s.bus.undo.state.undoable).toBe(0);
    // Colour 2 is a two-colour gradient's; a one-colour gradient's is its tint of colour 1.
    await s.bus.setProperty({ key: 'gradientColor2', value: 'aci:2' }, 'HATCH');
    expect(s.log.at(-1)).toBe(
      '1 object was not changed: a one-colour gradient (its Gradient tint sets colour 2).',
    );
    expect(s.g('73').gradient!.colors[1]!.color).toEqual({ kind: 'aci', index: 2 });
    await s.bus.setProperty({ key: 'gradientTint', value: '0.75' }, 'HATCH');
    expect(s.log.at(-1)).toBe('1 object was not changed: a two-colour gradient.');
    expect(s.g('74').gradient!.tint).toBe(0.75);
  });

  it('moves a pattern’s origin, every family with it', async () => {
    const user = userGeom();
    const doubled: Hatch = {
      ...user,
      double: true,
      patternLines: [user.patternLines[0]!, { ...user.patternLines[0]!, angle: 2 }],
    };
    const s = setup(
      init([
        entityInit('70', hatchGeom()),
        entityInit('71', doubled),
        entityInit('72', solidGeom()),
      ]),
    );
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'patternOriginX', value: '4' }, 'HATCH');
    expectLine(s.g('70').patternLines[0], { ...ansi31, base: { x: 4, y: 0 } });
    // Each hatch keeps its own origin's other coordinate; its families move together.
    expect(s.g('71').patternLines.map((l) => l.base)).toEqual([
      { x: 4, y: 1 },
      { x: 4, y: 1 },
    ]);
    expect(s.g('72')).toEqual(solidGeom());
    await s.bus.setProperty({ key: 'patternOriginY', value: '-2.5' }, 'HATCH');
    expect(s.g('70').patternLines[0]!.base).toEqual({ x: 4, y: -2.5 });
    expect(rowOf(propertySheet(s.model, s.ids('70')), 'Origin X')!.value).toBe(4);
    await s.bus.setProperty({ key: 'patternOriginY', value: 'east' }, 'HATCH');
    expect(s.log.at(-1)).toBe('Invalid input.');
    expect(s.bus.undo.state.undoable).toBe(2);
  });

  it('lets an associative hatch go of its boundary, and refuses to make one associative', async () => {
    const square = (h: string) =>
      entityInit(
        h,
        {
          kind: 'LWPOLYLINE',
          closed: true,
          constantWidth: 0,
          elevation: 0,
          vertices: SQUARE.polyline.vertices,
        } as unknown as EntityGeometry,
        { reactors: ['70'] },
      );
    const s = setup(
      init([
        square('80'),
        entityInit('70', hatchGeom({ associative: true, loops: [{ ...SQUARE, sources: ['80'] }] })),
        entityInit('71', hatchGeom()),
      ]),
    );
    expect(rowOf(propertySheet(s.model, s.ids('70')), 'Associative')!.value).toBe('yes');
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'associative', value: 'yes' }, 'HATCH');
    expect(s.log.at(-1)).toBe(
      '1 object was not changed: not associative (its boundary objects are not known).',
    );
    expect(s.bus.undo.state.undoable).toBe(0);
    await s.bus.setProperty({ key: 'associative', value: 'no' }, 'HATCH');
    expect(s.g('70').associative).toBe(false);
    expect(s.g('70').loops[0]!.sources).toBeUndefined();
    expect(s.byHandle('80').reactors).toBeUndefined();
    expect(s.bus.undo.state.undoable).toBe(1);
    await s.bus.submit('U');
    expect(s.g('70').associative).toBe(true);
    expect(s.byHandle('80').reactors).toEqual(['70']);
    await s.bus.setProperty({ key: 'associative', value: 'perhaps' }, 'HATCH');
    expect(s.log.at(-1)).toBe('Invalid input.');
  });
});
