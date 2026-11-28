// M8-07: the Health palette's drawing checks (PRD FR-Z4: "duplicate (OVERKILL candidates) ...
// units/scale sanity ... one-click fixes", the roadmap's "dynamic blocks present, constraints
// present") and their fixes as engine edits, each one undo step.
import { describe, expect, it } from 'vitest';
import {
  EngineSession,
  healthChecks,
  unitSystem,
  type DocumentInit,
  type EntityGeometry,
  type EntityInit,
  type HeaderValue,
  type NonGraphicalObject,
} from '../../src/index';
import {
  LAYER_0,
  LAYER_WALLS,
  MODEL_SPACE,
  PAPER_SPACE,
  blockRecord,
  entityInit,
  layer,
  lineGeom,
  sampleInit,
} from '../model/fixtures';

const LOCKED = '12';
const DOOR = 'A0';
const DOOR_STATE = 'A1';
const PLAIN = 'A2';

const circle = (x: number, r: number): EntityGeometry => ({
  kind: 'CIRCLE',
  center: { x, y: 0 },
  radius: r,
});
const insert = (block: string): EntityGeometry => ({
  kind: 'INSERT',
  block,
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
});

function init(
  o: {
    entities?: EntityInit[];
    header?: [string, HeaderValue][];
    objects?: NonGraphicalObject[];
    dynamic?: boolean;
  } = {},
): DocumentInit {
  const s = sampleInit();
  const dynamic = o.dynamic ?? false;
  return {
    ...s,
    header: new Map([...(s.header ?? []), ...(o.header ?? [])]),
    tables: {
      ...s.tables,
      layers: [
        layer(LAYER_0, '0'),
        layer(LAYER_WALLS, 'WALLS'),
        { ...layer(LOCKED, 'LOCKED'), locked: true },
      ],
      blockRecords: [
        ...(s.tables?.blockRecords ?? []),
        blockRecord(DOOR, 'DOOR'),
        blockRecord(DOOR_STATE, '*U5'),
        blockRecord(PLAIN, 'PLAIN'),
      ],
    },
    blocks: [
      ...(s.blocks ?? []),
      {
        handle: DOOR,
        name: 'DOOR',
        basePoint: { x: 0, y: 0 },
        ...(dynamic && { dynamic: { name: 'DOOR' } }),
      },
      {
        handle: DOOR_STATE,
        name: '*U5',
        basePoint: { x: 0, y: 0 },
        ...(dynamic && { dynamicOf: DOOR }),
      },
      { handle: PLAIN, name: 'PLAIN', basePoint: { x: 0, y: 0 } },
    ],
    objects: [...(s.objects ?? []), ...(o.objects ?? [])],
    entities: o.entities ?? s.entities ?? [],
  };
}

// Model space: the sample's line 20 (0,0)-(10,0) drawn again (one duplicate) and a line lying on
// it (one overlap); paper space: two circles the same; a locked layer's copies are left alone.
const DUPLICATED: EntityInit[] = [
  ...sampleInit().entities!,
  entityInit('30', lineGeom(10, 0, 0, 0)),
  entityInit('31', lineGeom(2, 0, 4, 0)),
  entityInit('32', circle(100, 5), { owner: PAPER_SPACE }),
  entityInit('33', circle(100, 5), { owner: PAPER_SPACE }),
  entityInit('34', circle(200, 5), { layer: LOCKED }),
  entityInit('35', circle(200, 5), { layer: LOCKED }),
  // Inside a block definition: OVERKILL works on a space's objects only.
  entityInit('36', circle(1, 1), { owner: PLAIN }),
  entityInit('37', circle(1, 1), { owner: PLAIN }),
];

describe('Health checks: duplicates (OVERKILL candidates)', () => {
  it("counts what OVERKILL's initial settings delete in every space, locked layers left out", () => {
    const s = new EngineSession(init({ entities: DUPLICATED }));
    expect(s.healthChecks().duplicates).toEqual({ duplicates: 2, overlaps: 1 });
    expect(new EngineSession(init()).healthChecks().duplicates).toEqual({
      duplicates: 0,
      overlaps: 0,
    });
  });

  it('Delete Duplicates runs OVERKILL on each space as one OVERKILL undo step', async () => {
    const s = new EngineSession(init({ entities: DUPLICATED }));
    const r = s.edit({ kind: 'health-fix', what: 'duplicates' });
    expect(r.ok).toBe(true);
    const handles = (space: string) =>
      s.model.blockEntities(space).map((id) => s.model.entity(id)!.handle);
    // The later drawn of the two lines, the line on line 20 and the second circle go.
    expect(handles(MODEL_SPACE)).toEqual(['20', '21', '23', '34', '35']);
    expect(handles(PAPER_SPACE)).toEqual(['24', '32']);
    expect(handles(PLAIN)).toEqual(['36', '37']);
    expect(s.healthChecks().duplicates).toEqual({ duplicates: 0, overlaps: 0 });
    expect(s.undoState.undoList).toEqual(['OVERKILL']);
    expect(s.edit({ kind: 'health-fix', what: 'duplicates' })).toEqual({
      ok: false,
      message: 'No duplicate objects found.',
    });
    await s.command({ kind: 'submit', text: 'U' });
    expect(s.healthChecks().duplicates).toEqual({ duplicates: 2, overlaps: 1 });
  });
});

describe('Health checks: units', () => {
  it('names the system of each INSUNITS code', () => {
    expect([0, 1, 2, 4, 6, 10, 14, 18, 21, 25].map(unitSystem)).toEqual([
      undefined,
      'imperial',
      'imperial',
      'metric',
      'metric',
      'imperial',
      'metric',
      undefined,
      'imperial',
      undefined,
    ]);
  });

  it('finds nothing in a millimetre drawing measured metric', () => {
    expect(new EngineSession(init()).healthChecks().units).toEqual({
      insUnits: 4,
      measurement: 'metric',
      problems: [],
    });
    // Astronomical units belong to neither system.
    const au = init({ header: [['$INSUNITS', 18]] });
    expect(new EngineSession(au).healthChecks().units.problems).toEqual([]);
  });

  it('a unitless drawing: the fix sets the units the measurement suggests, one UNITS step', () => {
    const metric = new EngineSession(init({ header: [['$INSUNITS', 0]] }));
    expect(metric.healthChecks().units.problems).toEqual([{ kind: 'unitless', suggested: 4 }]);
    const imperial = new EngineSession(
      init({
        header: [
          ['$INSUNITS', 0],
          ['$MEASUREMENT', 0],
        ],
      }),
    );
    expect(imperial.healthChecks().units.problems).toEqual([{ kind: 'unitless', suggested: 1 }]);

    expect(imperial.edit({ kind: 'health-fix', what: 'units', insUnits: 2 }).ok).toBe(true);
    expect(imperial.model.header.get('$INSUNITS')).toBe(2);
    expect(imperial.healthChecks().units.problems).toEqual([]);
    expect(imperial.undoState.undoList).toEqual(['UNITS']);
    expect(imperial.edit({ kind: 'health-fix', what: 'units', insUnits: 4 })).toEqual({
      ok: false,
      message: 'The drawing has units.',
    });
    expect(metric.edit({ kind: 'health-fix', what: 'units', insUnits: 0 })).toEqual({
      ok: false,
      message: '0 is not an INSUNITS value.',
    });
  });

  it('MEASUREMENT against INSUNITS: the fix sets MEASUREMENT to the units’ system', () => {
    const s = new EngineSession(init({ header: [['$INSUNITS', 1]] }));
    expect(s.healthChecks().units.problems).toEqual([
      { kind: 'measurement', insUnits: 1, measurement: 'metric', suggested: 'imperial' },
    ]);
    expect(s.edit({ kind: 'health-fix', what: 'measurement' }).ok).toBe(true);
    expect(s.model.header.get('$MEASUREMENT')).toBe(0);
    expect(s.healthChecks().units.problems).toEqual([]);
    expect(s.undoState.undoList).toEqual(['MEASUREMENT']);
    expect(s.edit({ kind: 'health-fix', what: 'measurement' })).toEqual({
      ok: false,
      message: 'MEASUREMENT already matches the drawing units.',
    });

    const metres = new EngineSession(
      init({
        header: [
          ['$INSUNITS', 6],
          ['$MEASUREMENT', 0],
        ],
      }),
    );
    expect(metres.edit({ kind: 'health-fix', what: 'measurement' }).ok).toBe(true);
    expect(metres.model.header.get('$MEASUREMENT')).toBe(1);
  });
});

describe('Health checks: dynamic blocks and constraints present', () => {
  it('lists each dynamic block with its references, states and nested ones included', () => {
    const entities = [
      ...sampleInit().entities!,
      entityInit('30', insert(DOOR)),
      // A reference with changed parameters draws its anonymous state.
      entityInit('31', insert(DOOR_STATE), { owner: PAPER_SPACE }),
      entityInit('32', insert(DOOR), { owner: PLAIN }),
      entityInit('33', insert(PLAIN)),
    ];
    const s = new EngineSession(init({ entities, dynamic: true }));
    expect(s.healthChecks().dynamicBlocks).toEqual({
      blocks: [{ name: 'DOOR', references: 3 }],
      references: 3,
    });
    // Without the dynamic data the same drawing has none.
    expect(new EngineSession(init({ entities })).healthChecks().dynamicBlocks).toEqual({
      blocks: [],
      references: 0,
    });
  });

  it('counts geometric and dimensional constraints and user parameters', () => {
    const ref = { entity: '20', sub: 'edge' as const, index: 0 };
    const objects = [
      {
        handle: '50',
        type: 'TRIYA_GEOMCONSTRAINT',
        owner: 'C',
        kind: 'horizontal',
        refs: [ref],
      },
      { handle: '51', type: 'TRIYA_GEOMCONSTRAINT', owner: 'C', kind: 'fix', refs: [ref] },
      {
        handle: '52',
        type: 'TRIYA_DIMCONSTRAINT',
        owner: 'C',
        dimension: 'horizontal',
        refs: [ref],
        parameter: 'd1',
        expression: '10',
        form: 'dynamic',
      },
      {
        handle: '53',
        type: 'TRIYA_USERPARAMETER',
        owner: 'C',
        parameter: 'user1',
        expression: '2',
      },
    ] as unknown as NonGraphicalObject[];
    expect(new EngineSession(init({ objects })).healthChecks().constraints).toEqual({
      geometric: 2,
      dimensional: 1,
      userParameters: 1,
    });
    expect(healthChecks(new EngineSession(init()).model).constraints).toEqual({
      geometric: 0,
      dimensional: 0,
      userParameters: 0,
    });
  });
});

// Part 2: dimensions that override their style (the roadmap's "non-standard dim styles"), and
// the fonts multiline text names inline (`\F`, `\f`).
const ACAD_APP = 'B0';
const STANDARD = 'B1';
const ISO = 'B2';

/** Overrides as AutoCAD files them: the `DSTYLE` list in the dimension's ACAD xdata. */
const dstyle = (...pairs: [number, number, number][]) => [
  {
    appId: ACAD_APP,
    values: [
      { code: 1000, value: 'DSTYLE' },
      { code: 1002, value: '{' },
      ...pairs.flatMap(([code, group, value]) => [
        { code: 1070, value: code },
        { code: group, value },
      ]),
      { code: 1002, value: '}' },
    ],
  },
];

const linearDim = (x: number, style = STANDARD, text = ''): EntityGeometry => ({
  kind: 'DIMENSION',
  dimType: 'linear',
  style,
  first: { x, y: 0 },
  second: { x: x + 10, y: 0 },
  definitionPoint: { x: x + 10, y: 5 },
  textPosition: { x: x + 5, y: 6 },
  rotation: 0,
  textUserPositioned: false,
  text,
  textRotation: 0,
  horizontalDirection: 0,
  attachment: 5,
  lineSpacingStyle: 1,
  lineSpacing: 1,
});

// DIMTXT (140) 5 and DIMCLRD (176) 1 on two Standard dimensions, DIMTXT on an ISO one in paper
// space; one plain; one on a locked layer and one inside a block, both left out.
const OVERRIDDEN: EntityInit[] = [
  entityInit('60', linearDim(0), { xdata: dstyle([140, 1040, 5], [176, 1070, 1]) }),
  entityInit('61', linearDim(20), { xdata: dstyle([140, 1040, 5]) }),
  entityInit('62', linearDim(40, ISO), { owner: PAPER_SPACE, xdata: dstyle([140, 1040, 3]) }),
  entityInit('63', linearDim(60)),
  entityInit('64', linearDim(80), { layer: LOCKED, xdata: dstyle([140, 1040, 5]) }),
  entityInit('65', linearDim(0), { owner: PLAIN, xdata: dstyle([140, 1040, 5]) }),
];

function dimInit(entities: EntityInit[]): DocumentInit {
  const i = init({ entities });
  return {
    ...i,
    tables: {
      ...i.tables,
      appIds: [{ handle: ACAD_APP, name: 'ACAD' }],
      dimStyles: [
        { handle: STANDARD, name: 'Standard', vars: { DIMTXT: 2.5 } },
        { handle: ISO, name: 'ISO-25', vars: { DIMTXT: 2.5 } },
      ],
    },
  };
}

describe('Health checks: dimensions with style overrides', () => {
  it('counts them by style and by variable, in every space outside locked layers', () => {
    const s = new EngineSession(dimInit(OVERRIDDEN));
    expect(s.healthChecks().dimensionOverrides).toEqual({
      dimensions: 3,
      styles: [
        { name: 'ISO-25', dimensions: 1 },
        { name: 'Standard', dimensions: 2 },
      ],
      variables: [
        { name: 'DIMCLRD', dimensions: 1 },
        { name: 'DIMTXT', dimensions: 3 },
      ],
    });
    // A drawing written without LAYOUT objects still has its model space checked.
    const bare = new EngineSession({ ...dimInit(OVERRIDDEN), layouts: [] });
    expect(bare.healthChecks().dimensionOverrides.dimensions).toBe(2);
    expect(new EngineSession(dimInit([])).healthChecks().dimensionOverrides).toEqual({
      dimensions: 0,
      styles: [],
      variables: [],
    });
  });

  it('Clear Overrides takes every override off them as one DIMOVERRIDE undo step', async () => {
    const s = new EngineSession(dimInit(OVERRIDDEN));
    const said: string[] = [];
    s.onCommand((o) => {
      if (o.type === 'log') said.push(o.line);
    });
    await s.command({ kind: 'health-clear-overrides' });
    const xdata = (h: string) => s.model.entityByHandle(h)!.xdata;
    expect(xdata('60')).toBeUndefined();
    expect(xdata('61')).toBeUndefined();
    expect(xdata('62')).toBeUndefined();
    // Left alone: the locked layer's and the block's.
    expect(xdata('64')).toEqual(dstyle([140, 1040, 5]));
    expect(xdata('65')).toEqual(dstyle([140, 1040, 5]));
    expect(s.healthChecks().dimensionOverrides.dimensions).toBe(0);
    expect(s.undoState.undoList).toEqual(['DIMOVERRIDE']);
    expect(said).toContain('Overrides cleared from 3 dimensions.');
    await s.command({ kind: 'health-clear-overrides' });
    expect(said).toContain('No dimensions with style overrides found.');
    expect(s.undoState.undoList).toEqual(['DIMOVERRIDE']);
    await s.command({ kind: 'submit', text: 'U' });
    expect(xdata('60')).toEqual(dstyle([140, 1040, 5], [176, 1070, 1]));
    expect(s.healthChecks().dimensionOverrides.dimensions).toBe(3);
  });
});

const mtext = (contents: string): EntityGeometry => ({
  kind: 'MTEXT',
  contents,
  style: '',
  position: { x: 0, y: 0 },
  height: 2.5,
  width: 0,
  rotation: 0,
  attachment: 1,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
});

describe('Health checks: fonts multiline text names inline', () => {
  it('lists each font once with the objects naming it, escapes and empty codes skipped', () => {
    const entities = [
      entityInit('70', mtext('{\\fArial|b1|i0|c0|p34;Bold} and {\\fArial|b0|i0|c0|p34;plain}')),
      entityInit('71', mtext('\\fARIAL|b0|i0|c0|p34;Shouting \\Fromand.shx;Hershey')),
      // `\\F` is a backslash and an F, not a font; `\F;` names none.
      entityInit('72', mtext('C:\\\\Fonts\\\\romans \\F;text')),
      entityInit('73', linearDim(0, STANDARD, '\\fConsolas|b0|i0|c0|p49;<>'), {
        owner: PLAIN,
      }),
    ];
    expect(new EngineSession(init({ entities })).healthChecks().inlineFonts).toEqual([
      { code: 'f', value: 'Arial|b1|i0|c0|p34', objects: 2 },
      { code: 'f', value: 'Consolas|b0|i0|c0|p49', objects: 1 },
      { code: 'F', value: 'romand.shx', objects: 1 },
    ]);
    expect(new EngineSession(init()).healthChecks().inlineFonts).toEqual([]);
  });
});
