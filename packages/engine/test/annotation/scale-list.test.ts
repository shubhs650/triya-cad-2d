// M6-02 part 21: the drawing's scale list (its ACAD_SCALELIST SCALEs) as SCALELISTEDIT edits it.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DEFAULT_SCALE_LIST,
  DocumentModel,
  annotationScales,
  compareScaleKeys,
  drawingScales,
  parseScaleRatio,
  resetScaleList,
  scaleKey,
  scaleListOf,
  scaleListProblem,
  scaleUses,
  writeScaleList,
  type DrawingScale,
  type EntityInit,
  type ScaleListEntry,
} from '../../src/index';
import { entityInit, lineGeom, sampleInit } from '../model/fixtures';

const DICT = '9F0';

const scale = (handle: string, key: string, name: string, paper: number, drawing: number) =>
  ({
    type: 'SCALE',
    handle,
    owner: DICT,
    reactors: [DICT],
    key,
    name,
    paperUnits: paper,
    drawingUnits: drawing,
    unitScale: name === '1:1',
  }) satisfies DrawingScale;

const SCALES = [
  scale('A00', 'A0', '1:1', 1, 1),
  scale('A01', 'A1', '1:50', 1, 50),
  scale('A02', 'A2', '1:100', 1, 100),
];

function drawing(
  o: { scales?: DrawingScale[]; cannoscale?: string; entities?: EntityInit[] } = {},
) {
  const init = sampleInit();
  return DocumentModel.create({
    ...init,
    handSeed: 'B00',
    meta: { ...init.meta!, scaleListDictionary: DICT },
    header: new Map([
      ...(init.header ?? []),
      ...((o.cannoscale ? [['CANNOSCALE', o.cannoscale]] : []) as [string, string][]),
    ]),
    objects: [...(init.objects ?? []), ...(o.scales ?? SCALES)],
    entities: [...(init.entities ?? []), ...(o.entities ?? [])],
  });
}

/** Makes the list `list` in one change, after checking it. */
function edit(model: DocumentModel, list: readonly ScaleListEntry[]) {
  expect(scaleListProblem(model, list)).toBeUndefined();
  const b = new ChangeSetBuilder(model);
  writeScaleList(model, b, list);
  const cs = b.build();
  model.apply(cs);
  return cs;
}

const names = (model: DocumentModel) => drawingScales(model).map((s) => `${s.key} ${s.name}`);

describe('scale list keys', () => {
  it('numbers entries A0 … A9, B0 …, then two letters after Z9', () => {
    expect([0, 9, 10, 33, 259, 260, 261].map(scaleKey)).toEqual([
      'A0',
      'A9',
      'B0',
      'D3',
      'Z9',
      'AA0',
      'AA1',
    ]);
    expect(['B0', 'AA0', 'A9', 'Z9'].sort(compareScaleKeys)).toEqual(['A9', 'B0', 'Z9', 'AA0']);
  });

  it('lists the scales in key order, whatever order the drawing holds them in', () => {
    const model = drawing({ scales: [SCALES[2]!, SCALES[0]!, SCALES[1]!] });
    expect(annotationScales(model).map((s) => s.name)).toEqual(['1:1', '1:50', '1:100']);
  });
});

describe('scale ratios', () => {
  it('reads n:m and n=m as paper units to drawing units, and n as n:1', () => {
    expect(parseScaleRatio('1:50')).toEqual({ paperUnits: 1, drawingUnits: 50 });
    expect(parseScaleRatio(' 0.25 = 12 ')).toEqual({ paperUnits: 0.25, drawingUnits: 12 });
    expect(parseScaleRatio('2')).toEqual({ paperUnits: 2, drawingUnits: 1 });
    for (const bad of ['', '1:0', '0:1', 'a:b', '1:2:3', '-1:2'])
      expect(parseScaleRatio(bad)).toBeUndefined();
  });
});

describe('scale list edits', () => {
  it('adds a scale at the end under the next key, filed in ACAD_SCALELIST', () => {
    const model = drawing();
    const list = scaleListOf(model, []);
    const cs = edit(model, [...list, { name: '1:20', paperUnits: 1, drawingUnits: 20 }]);
    expect(names(model)).toEqual(['A0 1:1', 'A1 1:50', 'A2 1:100', 'A3 1:20']);
    const added = cs.objects!.added![0] as DrawingScale;
    expect(added).toMatchObject({
      type: 'SCALE',
      owner: DICT,
      reactors: [DICT],
      key: 'A3',
      unitScale: false,
    });
    expect(cs.objects!.updated ?? []).toEqual([]);
  });

  it('moving a scale up numbers the list again from A0; renames and ratios change in place', () => {
    const model = drawing();
    const [one, fifty, hundred] = scaleListOf(model, []);
    edit(model, [one!, { ...hundred!, name: '1:200', drawingUnits: 200 }, fifty!]);
    expect(names(model)).toEqual(['A0 1:1', 'A1 1:200', 'A2 1:50']);
    expect(model.objects.get('A02')).toMatchObject({ key: 'A1', name: '1:200', drawingUnits: 200 });
  });

  it('keeps the current scale and one an annotative object names', () => {
    const line = entityInit('300', lineGeom(0, 0, 1, 0), {
      annotative: { representations: [{ handle: '301', scale: 'A02', isDefault: true }] },
    });
    const model = drawing({ cannoscale: '1:50', entities: [line] });
    expect(scaleUses(model)).toEqual(
      new Map([
        ['A01', 'current'],
        ['A02', 'object'],
      ]),
    );
    const [one, fifty, hundred] = scaleListOf(model, []);
    expect(scaleListProblem(model, [one!, hundred!])).toBe(
      'Scale "1:50" is the current annotation scale and cannot be deleted.',
    );
    expect(scaleListProblem(model, [one!, fifty!])).toBe(
      'Scale "1:100" is used by an annotative object and cannot be deleted.',
    );
    expect(scaleListProblem(model, [one!, fifty!, { ...hundred!, drawingUnits: 90 }])).toBe(
      'Scale "1:100" is used by an annotative object: its paper and drawing units cannot change.',
    );
    // A scale an object the drawing keeps as read names counts too.
    const kept = drawing({ scales: [SCALES[0]!, { ...SCALES[1]!, referenced: true }] });
    expect(scaleListProblem(kept, scaleListOf(kept, []).slice(0, 1))).toBe(
      'Scale "1:50" is used by an annotative object and cannot be deleted.',
    );
    // Its name may change.
    expect(
      scaleListProblem(model, [one!, fifty!, { ...hundred!, name: 'Detail' }]),
    ).toBeUndefined();
  });

  it('refuses a duplicate name (any case), an empty one, a bad ratio and an empty list', () => {
    const model = drawing();
    const list = scaleListOf(model, []);
    expect(
      scaleListProblem(model, [...list, { name: '1:50', paperUnits: 1, drawingUnits: 5 }]),
    ).toBe('A scale named "1:50" already exists.');
    expect(scaleListProblem(model, [...list, { name: ' ', paperUnits: 1, drawingUnits: 5 }])).toBe(
      'Invalid scale name.',
    );
    expect(scaleListProblem(model, [...list, { name: 'x', paperUnits: 0, drawingUnits: 5 }])).toBe(
      'Invalid scale.',
    );
    expect(scaleListProblem(model, [])).toBe('The scale list needs at least one scale.');
  });

  it('CANNOSCALE and CANNOSCALEVALUE follow the current scale renamed or rescaled', () => {
    const model = drawing({ cannoscale: '1:50' });
    const [one, fifty, hundred] = scaleListOf(model, []);
    edit(model, [one!, { ...fifty!, name: '1:25', drawingUnits: 25 }, hundred!]);
    expect(model.header.get('CANNOSCALE')).toBe('1:25');
    expect(model.header.get('CANNOSCALEVALUE')).toBe(0.04);
  });

  it('a drawing without a scale list writes the whole list with its first change', () => {
    const model = drawing({ scales: [] });
    const list = scaleListOf(model, DEFAULT_SCALE_LIST.slice(0, 2));
    edit(model, [...list, { name: 'Site', paperUnits: 1, drawingUnits: 500 }]);
    expect(names(model)).toEqual(['A0 1:1', 'A1 1:2', 'A2 Site']);
    expect(drawingScales(model)[0]!.unitScale).toBe(true);
  });

  it('Reset restores the default list, keeping scales in use and reusing those of its names', () => {
    const custom = scale('A03', 'A3', 'Site', 1, 500);
    const used = scale('A04', 'A4', 'Detail', 5, 1);
    const line = entityInit('300', lineGeom(0, 0, 1, 0), {
      annotative: { representations: [{ handle: '301', scale: 'A04', isDefault: true }] },
    });
    const odd = { ...SCALES[2]!, drawingUnits: 99 };
    const model = drawing({
      scales: [SCALES[0]!, SCALES[1]!, odd, custom, used],
      entities: [line],
    });
    const reset = resetScaleList(model, scaleListOf(model, []));
    expect(reset.map((s) => s.name)).toEqual([...DEFAULT_SCALE_LIST.map((s) => s.name), 'Detail']);
    expect(reset.find((s) => s.name === '1:100')).toMatchObject({
      handle: 'A02',
      drawingUnits: 100,
    });
    edit(model, reset);
    expect(drawingScales(model)).toHaveLength(34);
    expect(model.objects.has('A03')).toBe(false);
    expect(drawingScales(model).at(-1)).toMatchObject({ handle: 'A04', key: 'D3' });
  });
});
