// M2-35 part 29: a dynamic block reference's custom properties, read-only in the Properties
// palette's Custom section (AutoCAD 2024 Help, "Properties Palette": a dynamic block reference
// lists the parameters whose Show properties is on). The values are what AutoCAD saved with the
// reference (its AcDbBlockRepresentation's ACAD_ENHANCEDBLOCKDATA XRECORDs, by node id), else
// the definition's own; the codes below are those of acadsharp's dynamic-blocks samples.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  dynamicProperties,
  propertySheet,
  type DocumentInit,
  type EntityGeometry,
  type PropertySheet,
} from '../../src/index';
import { blockRecord, entityInit, sampleInit } from '../model/fixtures';

type Code = { code: number; value: string | number };
const c = (code: number, value: string | number): Code => ({ code, value });
const coded = (handle: string, owner: string, dxfName: string, body: Code[], key?: string) => ({
  handle,
  type: 'CODED_OBJECT' as const,
  owner,
  dxfName,
  ...(key !== undefined ? { key } : {}),
  codes: [c(5, handle), c(330, owner), ...body],
});
const xyz = (x: number, y: number, base = 1010): Code[] => [
  c(base, x),
  c(base + 10, y),
  c(base + 20, 0),
];
const node = (id: number, label: string, show = 1): Code[] => [
  c(100, 'AcDbEvalExpr'),
  c(90, id),
  c(98, 33),
  c(99, 329),
  c(100, 'AcDbBlockElement'),
  c(300, label),
  c(1071, 0),
  c(100, 'AcDbBlockParameter'),
  c(280, show),
  c(281, 0),
];
const twoPoints = (a: [number, number], b: [number, number]): Code[] => [
  c(100, 'AcDbBlock2PtParameter'),
  ...xyz(...a),
  ...xyz(...b, 1011),
  c(170, 4),
];
const authorEnv: Code[] = [c(1001, 'ACAUTHENVIRON'), ...xyz(9, 9)];

/** DOOR's evaluation graph (A2) and its parameter nodes. */
const graph = [
  coded(
    'A2',
    'A1',
    'ACAD_EVALUATION_GRAPH',
    [
      c(100, 'AcDbEvalGraph'),
      ...['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'BA'].map((h) => c(360, h)),
    ],
    'ACAD_ENHANCEDBLOCK',
  ),
  coded('B1', 'A2', 'BLOCKLINEARPARAMETER', [
    ...node(1, 'Linear'),
    ...twoPoints([0, 0], [5, 0]),
    c(100, 'AcDbBlockLinearParameter'),
    c(305, 'Width'),
    c(306, 'door width'),
    ...authorEnv,
  ]),
  coded('B2', 'A2', 'BLOCKVISIBILITYPARAMETER', [
    ...node(2, 'Visibility'),
    c(100, 'AcDbBlock1PtParameter'),
    ...xyz(5, 5),
    c(100, 'AcDbBlockVisibilityParameter'),
    c(281, 1),
    c(301, 'Visibility1'),
    c(302, ''),
    c(92, 2),
    c(303, 'Open'),
    c(94, 0),
    c(303, 'Closed'),
    c(94, 0),
  ]),
  coded('B3', 'A2', 'BLOCKFLIPPARAMETER', [
    ...node(3, 'Flip'),
    ...twoPoints([0, 0], [0, 7]),
    c(100, 'AcDbBlockFlipParameter'),
    c(305, 'Flip state1'),
    c(306, ''),
    c(307, 'Not flipped'),
    c(308, 'Flipped'),
  ]),
  coded('B4', 'A2', 'BLOCKROTATIONPARAMETER', [
    ...node(4, 'Rotation'),
    ...twoPoints([0, 0], [0, 5]),
    c(100, 'AcDbBlockRotationParameter'),
    c(305, 'Angle1'),
    c(306, ''),
    ...xyz(5, 0, 1011),
  ]),
  coded('B5', 'A2', 'BLOCKPOLARPARAMETER', [
    ...node(5, 'Polar'),
    ...twoPoints([1, 1], [4, 5]),
    c(100, 'AcDbBlockPolarParameter'),
    c(305, 'Distance2'),
    c(306, ''),
    c(307, 'Angle2'),
  ]),
  coded('B6', 'A2', 'BLOCKXYPARAMETER', [
    ...node(6, 'XY'),
    ...twoPoints([0, 5], [5, 0]),
    c(100, 'AcDbBlockXYParameter'),
    c(305, 'Y Distance1'),
    c(306, 'X Distance1'),
  ]),
  coded('B7', 'A2', 'BLOCKPOINTPARAMETER', [
    ...node(7, 'Point'),
    c(100, 'AcDbBlock1PtParameter'),
    ...xyz(2, 3),
    c(100, 'AcDbBlockPointParameter'),
    c(303, 'Position1'),
  ]),
  coded('B8', 'A2', 'BLOCKLOOKUPPARAMETER', [
    ...node(8, 'Lookup'),
    c(100, 'AcDbBlock1PtParameter'),
    ...xyz(6, 1),
    c(100, 'AcDbBlockLookUpParameter'),
    c(303, 'Size'),
  ]),
  // Show properties off: not listed.
  coded('B9', 'A2', 'BLOCKLINEARPARAMETER', [
    ...node(9, 'Hidden', 0),
    ...twoPoints([0, 0], [1, 0]),
    c(100, 'AcDbBlockLinearParameter'),
    c(305, 'Hidden'),
  ]),
  // A base point parameter lists nothing; a grip is not a parameter.
  coded('BA', 'A2', 'BLOCKBASEPOINTPARAMETER', [...node(10, 'Base Point')]),
];

/** Reference 62's saved values (extension dictionary C0, AcDbBlockRepresentation C1). */
const xrecord = (handle: string, body: Code[]) =>
  coded(handle, 'C4', 'XRECORD', [
    c(100, 'AcDbXrecord'),
    c(280, 1),
    c(1071, 1),
    c(1071, 2),
    c(70, 25),
    c(70, 104),
    ...body,
  ]);
const point = (x: number, y: number): Code[] => [c(10, x), c(20, y), c(30, 0)];
const representation = [
  coded(
    'C1',
    'C0',
    'DICTIONARY',
    [
      c(100, 'AcDbDictionary'),
      c(3, 'AcDbRepData'),
      c(360, 'C2'),
      c(3, 'AppDataCache'),
      c(360, 'C3'),
    ],
    'AcDbBlockRepresentation',
  ),
  coded('C2', 'C1', 'ACDB_BLOCKREPRESENTATION_DATA', [c(70, 1), c(340, '50')]),
  coded('C3', 'C1', 'DICTIONARY', [
    c(100, 'AcDbDictionary'),
    c(3, 'ACAD_ENHANCEDBLOCKDATA'),
    c(360, 'C4'),
  ]),
  coded('C4', 'C3', 'DICTIONARY', [
    c(100, 'AcDbDictionary'),
    ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((id) => [c(3, String(id)), c(360, `D${id}`)]),
  ]),
  xrecord('D1', [...point(0, 0), ...point(7.5, 0), ...point(0, 0)]),
  xrecord('D2', [...point(5, 5), c(1, 'Closed')]),
  xrecord('D3', [...point(0, 0), ...point(0, 7), ...point(0, 0), c(70, 1)]),
  xrecord('D4', [...point(0, 0), ...point(-3, -3), ...point(0, 0), ...point(5, 0)]),
  xrecord('D5', [...point(1, 1), ...point(1, 7), ...point(0, 0), ...point(2, 2)]),
  xrecord('D6', [...point(0, 10), ...point(8, 0), ...point(0, 0)]),
  xrecord('D7', [...point(4, -1)]),
  xrecord('D8', [...point(6, 1), c(1, 'Large')]),
];

const insertGeom = (block: string): EntityGeometry =>
  ({
    kind: 'INSERT',
    block,
    position: { x: 0, y: 0 },
    scale: { x: 2, y: 2, z: 1 },
    rotation: 0,
    attributes: [],
  }) as EntityGeometry;

function init(): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    tables: {
      ...base.tables,
      blockRecords: [
        ...(base.tables?.blockRecords ?? []),
        { ...blockRecord('50', 'DOOR'), extDict: 'A1' },
        blockRecord('51', '*U4'),
        blockRecord('52', 'BOLT'),
        blockRecord('53', 'WINDOW'),
      ],
    },
    blocks: [
      ...(base.blocks ?? []),
      { handle: '50', name: 'DOOR', basePoint: { x: 0, y: 0 }, dynamic: { name: 'DOOR' } },
      { handle: '51', name: '*U4', basePoint: { x: 0, y: 0 }, dynamicOf: '50' },
      { handle: '52', name: 'BOLT', basePoint: { x: 0, y: 0 } },
      // Dynamic, but its graph is not held: no custom properties.
      { handle: '53', name: 'WINDOW', basePoint: { x: 0, y: 0 }, dynamic: { name: 'WINDOW' } },
    ],
    objects: [...(base.objects ?? []), ...graph, ...representation] as never,
    entities: [
      ...(base.entities ?? []),
      entityInit('62', insertGeom('51'), { extDict: 'C0' }),
      entityInit('63', insertGeom('50')),
      entityInit('64', insertGeom('52')),
      entityInit('65', insertGeom('53')),
    ],
  };
}

const model = DocumentModel.create(init());
const entity = (h: string) => model.entityByHandle(h)!;
const ids = (...hs: string[]) => hs.map((h) => entity(h).id);
const custom = (sheet: PropertySheet) => sheet.sections.find((s) => s.title === 'Custom');

describe('dynamic block custom properties (M2-35 part 29)', () => {
  it('lists the values AutoCAD saved with the reference, in the graph order', () => {
    const props = dynamicProperties(model, entity('62'));
    expect(props.map((p) => [p.label, p.kind])).toEqual([
      ['Width', 'distance'],
      ['Visibility1', 'text'],
      ['Flip state1', 'text'],
      ['Angle1', 'angle'],
      ['Distance2', 'distance'],
      ['Angle2', 'angle'],
      ['X Distance1', 'distance'],
      ['Y Distance1', 'distance'],
      ['Position1 X', 'distance'],
      ['Position1 Y', 'distance'],
      ['Size', 'text'],
    ]);
    const value = (label: string) => props.find((p) => p.label === label)!.value;
    // In the block's units: the reference's scale of 2 does not change them.
    expect(value('Width')).toBeCloseTo(7.5);
    expect(value('Visibility1')).toBe('Closed');
    expect(value('Flip state1')).toBe('Flipped');
    expect(value('Angle1')).toBeCloseTo((225 * Math.PI) / 180);
    expect(value('Distance2')).toBeCloseTo(6);
    // From the saved base angle's line (1,1)→(2,2), at 45°, to the parameter's, at 90°.
    expect(value('Angle2')).toBeCloseTo(Math.PI / 4);
    expect(value('X Distance1')).toBeCloseTo(8);
    expect(value('Y Distance1')).toBeCloseTo(-10);
    expect(value('Position1 X')).toBeCloseTo(4);
    expect(value('Position1 Y')).toBeCloseTo(-1);
    expect(value('Size')).toBe('Large');
  });

  it('shows the definition’s own values for a reference AutoCAD saved none for', () => {
    const props = dynamicProperties(model, entity('63'));
    const value = (label: string) => props.find((p) => p.label === label)!.value;
    expect(value('Width')).toBeCloseTo(5);
    expect(value('Visibility1')).toBe('Open');
    expect(value('Flip state1')).toBe('Not flipped');
    expect(value('Angle1')).toBeCloseTo(Math.PI / 2);
    expect(value('Distance2')).toBeCloseTo(5);
    expect(value('Angle2')).toBeCloseTo(Math.atan2(4, 3));
    expect(value('X Distance1')).toBeCloseTo(5);
    expect(value('Y Distance1')).toBeCloseTo(-5);
    expect(value('Position1 X')).toBeCloseTo(2);
    expect(value('Size')).toBe('');
  });

  it('has none for a static block or a dynamic block whose graph is not held', () => {
    expect(dynamicProperties(model, entity('64'))).toEqual([]);
    expect(dynamicProperties(model, entity('65'))).toEqual([]);
  });

  it('shows them read-only in a Custom section after Misc, *VARIES* where references differ', () => {
    const one = custom(propertySheet(model, ids('62')))!;
    const titles = propertySheet(model, ids('62')).sections.map((s) => s.title);
    expect(titles.indexOf('Custom')).toBe(titles.indexOf('Misc') + 1);
    expect(one.rows.every((r) => r.readOnly)).toBe(true);
    expect(one.rows[0]).toMatchObject({ key: 'custom:1', label: 'Width', kind: 'distance' });
    expect(one.rows[0]!.value).toBeCloseTo(7.5);

    const both = custom(propertySheet(model, ids('62', '63')))!;
    expect(both.rows.find((r) => r.label === 'Width')).toMatchObject({ varies: true });
    expect(both.rows.find((r) => r.label === 'Position1 Y')).toMatchObject({ varies: true });
    // References to different blocks share no parameters.
    expect(custom(propertySheet(model, ids('62', '64')))).toBeUndefined();
    expect(custom(propertySheet(model, ids('64')))).toBeUndefined();
  });
});
