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
    expect(rowOf(one, 'Associative')!.readOnly).toBe(true);

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

    // A gradient's rows are its own (left for later): read only.
    const gradient = propertySheet(s.model, s.ids('73'));
    expect(rowOf(gradient, 'Pattern name')).toMatchObject({ value: 'LINEAR', readOnly: true });
    expect(rowOf(gradient, 'Angle')!.readOnly).toBe(true);

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
