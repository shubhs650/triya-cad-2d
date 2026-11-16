// M4-02 part 3: DIMREASSOCIATE (definition points re-picked, DIMASSOC 1) and DIMDISASSOCIATE on
// the PromptBus with AutoCAD 2024's prompts, on the stand-in dimension engine of
// dimension-harness.ts. The sample drawing has lines (0,0)-(10,0), (0,0)-(0,10) and
// (0,20)-(10,20), a circle at (5,5) radius 2 and an arc centred on (50,0), radius 10, 0° to 60°.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  type DimAssoc,
  type DimAssocPoint,
  type DimensionGeometry,
  type Entity,
} from '../../src/index';
import { entityInit, snapshot } from '../model/fixtures';
import { said, setup } from './dimension-harness';

const close = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
};

const assocs = (s: ReturnType<typeof setup>): DimAssoc[] =>
  [...s.model.objects.values()].filter((o): o is DimAssoc => o.type === 'DIMASSOC');

/** Associates the dimension `dim` with the line `line`'s start, as a drawing read in would. */
function associate(s: ReturnType<typeof setup>, dim: Entity, line: Entity): string {
  const b = new ChangeSetBuilder(s.model);
  const dict = s.model.handles.allocate();
  const p: DimAssocPoint = {
    osnap: 13,
    geometry: [line.handle],
    subentType: 2,
    gsMarker: 0,
    xrefPaths: [],
    parameter: 0,
    point: { x: 0, y: 0, z: 0 },
  };
  const o = b.addObject({
    type: 'DIMASSOC',
    owner: dict,
    reactors: [dict],
    dimension: dim.handle,
    transSpace: false,
    rotatedType: 0,
    points: [p, null, null, null],
  } as Omit<DimAssoc, 'handle'>);
  b.updateEntity(dim.id, { extDict: dict, reactors: [o.handle] });
  b.updateEntity(line.id, { reactors: [o.handle] });
  s.model.apply(b.build());
  return o.handle;
}

/** Picks the dimensions at `indices` by their text, and ends the selection. */
async function pickDims(s: ReturnType<typeof setup>, ...indices: number[]): Promise<void> {
  for (const i of indices)
    await s.bus.pick((s.dims().at(i)!.geom as DimensionGeometry).textPosition);
  await s.bus.submit('');
}

const entity = (s: ReturnType<typeof setup>, handle: string) =>
  s.model.entity(s.model.ids.idOf(handle)!)!;

describe('DIMREASSOCIATE', () => {
  it('asks AutoCAD 2024 prompts; a linear dimension takes the origins re-picked', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5']);
    const before = snapshot(s.model);
    await s.bus.submit('DIMREASSOCIATE');
    expect(s.bus.promptText).toBe('Select dimensions to reassociate:');
    await pickDims(s, 0);
    expect(s.bus.promptText).toBe('Specify first extension line origin or [Select object] <next>:');
    await s.bus.submit('2,0');
    expect(s.bus.promptText).toBe('Specify second extension line origin <next>:');
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
    const g = s.dim<'linear'>();
    expect(g.first).toEqual({ x: 2, y: 0 });
    expect(g.second).toEqual({ x: 10, y: 0 });
    // The dimension line stays where it was; the engine measured it again.
    expect(g.definitionPoint.y).toBe(5);
    expect(said(s.bus)).not.toContain('Object selected');
    await s.bus.script(['U']);
    expect(snapshot(s.model)).toEqual(before);
  });

  it('Select object takes a line’s ends; Enter at every prompt changes nothing', async () => {
    const s = setup();
    await s.bus.script(['DIMALIGNED', '0,0', '10,0', '5,5']);
    await s.bus.script(['DRE']);
    await pickDims(s, 0);
    await s.bus.submit('S');
    expect(s.bus.promptText).toBe('Select object:');
    // The circle has no ends: asked again.
    await s.bus.pick({ x: 7, y: 5 });
    expect(said(s.bus)).toContain('Object selected is not a line, arc or polyline segment.');
    expect(s.bus.promptText).toBe('Specify first extension line origin or [Select object] <next>:');
    await s.bus.submit('S');
    await s.bus.pick({ x: 5, y: 20 });
    expect(s.bus.command).toBeUndefined();
    expect(s.dim<'aligned'>()).toMatchObject({ first: { x: 0, y: 20 }, second: { x: 10, y: 20 } });

    const changes = s.bus.history.length;
    const now = snapshot(s.model);
    await s.bus.script(['DIMREASSOCIATE']);
    await pickDims(s, 0);
    await s.bus.script(['', '']);
    expect(s.bus.command).toBeUndefined();
    expect(snapshot(s.model)).toEqual(now);
    expect(s.bus.history.length).toBeGreaterThan(changes);
  });

  it('a radius or diameter dimension moves onto the circle picked, the same way round', async () => {
    const s = setup();
    await s.bus.script(['DIMRADIUS']);
    await s.bus.pick({ x: 60, y: 0 });
    await s.bus.submit('65,0');
    await s.bus.script(['DIMDIAMETER']);
    await s.bus.pick({ x: 50, y: 10 });
    await s.bus.submit('50,15');
    const before = snapshot(s.model);
    await s.bus.submit('DIMREASSOCIATE');
    await pickDims(s, 0, 1);
    expect(s.bus.promptText).toBe('Select arc or circle <next>:');
    // A line is not a circle.
    await s.bus.pick({ x: 5, y: 20 });
    expect(said(s.bus)).toContain('Object selected is not a circle or arc.');
    await s.bus.pick({ x: 7, y: 5 });
    expect(s.bus.promptText).toBe('Select arc or circle <next>:');
    await s.bus.pick({ x: 5, y: 7 });
    expect(s.bus.command).toBeUndefined();
    const [radius, diameter] = s.dims().map((e) => e.geom as DimensionGeometry);
    expect(radius).toMatchObject({ dimType: 'radius', definitionPoint: { x: 5, y: 5 } });
    close((radius as { chordPoint: { x: number; y: number } }).chordPoint, 7, 5);
    expect(diameter?.dimType).toBe('diameter');
    close((diameter as { chordPoint: { x: number; y: number } }).chordPoint, 5, 7);
    close(diameter!.definitionPoint, 5, 3);
    // Both in one undo step.
    await s.bus.script(['U']);
    expect(snapshot(s.model)).toEqual(before);
  });

  it('a 3-point angular dimension: points, or an arc’s centre and ends', async () => {
    const s = setup();
    await s.bus.script(['DIMANGULAR', '', '0,0', '10,0', '0,10', '7,7']);
    await s.bus.script(['DIMREASSOCIATE']);
    await pickDims(s, 0);
    expect(s.bus.promptText).toBe('Specify angle vertex or [Select arc] <next>:');
    await s.bus.submit('');
    expect(s.bus.promptText).toBe('Specify first angle endpoint <next>:');
    await s.bus.submit('5,0');
    expect(s.bus.promptText).toBe('Specify second angle endpoint <next>:');
    await s.bus.submit('');
    expect(s.dim<'angular3pt'>()).toMatchObject({
      vertex: { x: 0, y: 0 },
      first: { x: 5, y: 0 },
      second: { x: 0, y: 10 },
    });
    await s.bus.script(['DIMREASSOCIATE']);
    await pickDims(s, 0);
    await s.bus.submit('S');
    expect(s.bus.promptText).toBe('Select arc:');
    await s.bus.pick({ x: 7, y: 5 });
    expect(said(s.bus)).toContain('Object selected is not an arc.');
    await s.bus.submit('S');
    await s.bus.pick({ x: 60, y: 0 });
    expect(s.bus.command).toBeUndefined();
    const g = s.dim<'angular3pt'>();
    expect(g.vertex).toEqual({ x: 50, y: 0 });
    close(g.first, 60, 0);
    close(g.second, 55, 10 * Math.sin(Math.PI / 3));
  });

  it('a 2-line angular dimension takes the lines picked; parallel lines are refused', async () => {
    const s = setup({
      entities: [entityInit('42', { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 8, y: 8 } })],
    });
    await s.bus.script(['DIMANGULAR']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 0, y: 5 });
    await s.bus.submit('3,3');
    await s.bus.script(['DIMREASSOCIATE']);
    await pickDims(s, 0);
    expect(s.bus.promptText).toBe('Select first line <next>:');
    await s.bus.submit('');
    expect(s.bus.promptText).toBe('Select second line <next>:');
    // Parallel to the first line.
    await s.bus.pick({ x: 5, y: 20 });
    expect(said(s.bus)).toContain('Lines are parallel.');
    await s.bus.pick({ x: 7, y: 5 });
    expect(said(s.bus)).toContain('Object selected is not a line.');
    await s.bus.pick({ x: 6, y: 6 });
    expect(s.bus.command).toBeUndefined();
    expect(s.dim<'angular'>()).toMatchObject({
      line1Start: { x: 0, y: 0 },
      line1End: { x: 10, y: 0 },
      line2Start: { x: 0, y: 0 },
      definitionPoint: { x: 8, y: 8 },
      arcPoint: { x: 3, y: 3 },
    });
  });

  it('ordinate and jogged dimensions, several in turn; Esc keeps what was re-picked', async () => {
    const s = setup();
    await s.bus.script(['DIMORDINATE', '10,5', '20,6']);
    await s.bus.script(['DIMJOGGED']);
    await s.bus.pick({ x: 60, y: 0 });
    await s.bus.script(['50,-20', '65,0', '55,-2']);
    await s.bus.script(['DIMREASSOCIATE']);
    // The ordinate by its leader end: its text is on the line (0,0)-(0,10) here.
    await s.bus.pick({ x: 20, y: 6 });
    await pickDims(s, 1);
    expect(s.bus.promptText).toBe('Specify feature location <next>:');
    await s.bus.submit('12,5');
    expect(s.bus.promptText).toBe('Select arc or circle <next>:');
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
    const [ordinate, jogged] = s.dims().map((e) => e.geom);
    expect(ordinate).toMatchObject({ dimType: 'ordinate', feature: { x: 12, y: 5 } });
    expect(jogged).toMatchObject({ dimType: 'jogged', definitionPoint: { x: 50, y: 0 } });

    await s.bus.script(['DIMREASSOCIATE']);
    await pickDims(s, 1);
    await s.bus.pick({ x: 7, y: 5 });
    const g = s.dim<'jogged'>();
    expect(g.definitionPoint).toEqual({ x: 5, y: 5 });
    // The chord point the same way from the new centre as from the old.
    close(g.chordPoint, 7, 5);
  });

  it('an arc length dimension moves onto the arc picked, as far outside it', async () => {
    const s = setup({
      entities: [
        entityInit('42', {
          kind: 'ARC',
          center: { x: 0, y: -50 },
          radius: 5,
          startAngle: 0,
          endAngle: Math.PI / 2,
        }),
      ],
    });
    await s.bus.script(['DIMARC']);
    await s.bus.pick({ x: 0, y: -45 });
    const at = 7 * Math.SQRT1_2;
    await s.bus.submit(`${at},${-50 + at}`);
    await s.bus.script(['DIMREASSOCIATE']);
    await pickDims(s, 0);
    expect(s.bus.promptText).toBe('Select arc or polyline arc segment <next>:');
    await s.bus.pick({ x: 5, y: 20 });
    expect(said(s.bus)).toContain('Object selected is not an arc or polyline arc segment.');
    await s.bus.pick({ x: 60, y: 0 });
    expect(s.bus.command).toBeUndefined();
    const g = s.dim<'arc'>();
    expect(g.center).toEqual({ x: 50, y: 0 });
    close(g.first, 60, 0);
    close(g.second, 55, 10 * Math.sin(Math.PI / 3));
    // 2 outside the arc, at its middle.
    close(g.definitionPoint, 50 + 12 * Math.cos(Math.PI / 6), 12 * Math.sin(Math.PI / 6));
    expect(g.partial).toBe(false);
  });

  it('a dimension re-picked lets go of the association it was read with', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5']);
    const dim = s.dims()[0]!;
    const line = entity(s, '20');
    const h = associate(s, dim, line);
    await s.bus.script(['DIMREASSOCIATE']);
    await pickDims(s, 0);
    await s.bus.script(['1,0', '']);
    expect(assocs(s)).toEqual([]);
    expect(entity(s, '20').reactors).toBeUndefined();
    expect(s.model.entity(dim.id)!.reactors).toBeUndefined();
    await s.bus.script(['U']);
    expect(assocs(s).map((a) => a.handle)).toEqual([h]);
  });
});

describe('DIMREASSOCIATE ends', () => {
  const ARC_42 = entityInit('42', {
    kind: 'ARC',
    center: { x: 0, y: -50 },
    radius: 5,
    startAngle: 0,
    endAngle: Math.PI / 2,
  });
  // Each dimension, made, then the answers given before Esc.
  const cases: [string, (s: ReturnType<typeof setup>) => Promise<void>, string[]][] = [
    ['linear, first origin', (s) => s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5']), []],
    ['linear, object', (s) => s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5']), ['S']],
    ['linear, second origin', (s) => s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5']), ['2,0']],
    ['angular, vertex', (s) => s.bus.script(['DIMANGULAR', '', '0,0', '10,0', '0,10', '7,7']), []],
    ['angular, arc', (s) => s.bus.script(['DIMANGULAR', '', '0,0', '10,0', '0,10', '7,7']), ['S']],
    [
      'angular, first end',
      (s) => s.bus.script(['DIMANGULAR', '', '0,0', '10,0', '0,10', '7,7']),
      [''],
    ],
    [
      'angular, second end',
      (s) => s.bus.script(['DIMANGULAR', '', '0,0', '10,0', '0,10', '7,7']),
      ['', ''],
    ],
    [
      'two lines',
      async (s) => {
        await s.bus.script(['DIMANGULAR']);
        await s.bus.pick({ x: 5, y: 0 });
        await s.bus.pick({ x: 0, y: 5 });
        await s.bus.submit('3,3');
      },
      [],
    ],
    [
      'radius',
      async (s) => {
        await s.bus.script(['DIMRADIUS']);
        await s.bus.pick({ x: 60, y: 0 });
        await s.bus.submit('65,0');
      },
      [],
    ],
    ['ordinate', (s) => s.bus.script(['DIMORDINATE', '10,5', '20,6']), []],
    [
      'arc length',
      async (s) => {
        await s.bus.script(['DIMARC']);
        await s.bus.pick({ x: 0, y: -45 });
        await s.bus.submit(`${7 * Math.SQRT1_2},${-50 + 7 * Math.SQRT1_2}`);
      },
      [],
    ],
  ];

  it.each(cases)('Esc ends it and changes nothing (%s)', async (_name, make, answers) => {
    const s = setup({ entities: [ARC_42] });
    await make(s);
    const before = snapshot(s.model);
    await s.bus.script(['DIMREASSOCIATE']);
    const g = s.dims()[0]!.geom as DimensionGeometry;
    await s.bus.pick(g.dimType === 'ordinate' ? g.leaderEnd : g.textPosition);
    await s.bus.submit('');
    for (const a of answers) await s.bus.submit(a);
    expect(s.bus.command).toBe('DIMREASSOCIATE');
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
    expect(snapshot(s.model)).toEqual(before);
  });

  it('selecting no dimension, or Esc at the selection, does nothing', async () => {
    const s = setup();
    const before = snapshot(s.model);
    await s.bus.script(['DIMREASSOCIATE']);
    await s.bus.pick({ x: 5, y: 20 });
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
    await s.bus.script(['DIMDISASSOCIATE']);
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
    expect(snapshot(s.model)).toEqual(before);
  });
});

describe('DIMDISASSOCIATE', () => {
  it('removes the associations of the dimensions selected, in one undo step', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5']);
    await s.bus.script(['DIMLINEAR', '0,0', '0,10', '-5,5']);
    const [a, b] = s.dims();
    associate(s, a!, entity(s, '20'));
    const before = snapshot(s.model);
    await s.bus.submit('DIMDISASSOCIATE');
    expect(s.bus.promptText).toBe('Select dimensions to disassociate:');
    await s.bus.pick((a!.geom as DimensionGeometry).textPosition);
    await s.bus.pick((b!.geom as DimensionGeometry).textPosition);
    await s.bus.pick({ x: 5, y: 20 });
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
    expect(s.bus.history.at(-1)).toBe('1 disassociated.');
    expect(assocs(s)).toEqual([]);
    expect(entity(s, '20').reactors).toBeUndefined();
    expect(s.model.entity(a!.id)!.reactors).toBeUndefined();
    expect(s.model.entity(b!.id)!.geom).toEqual(b!.geom);
    await s.bus.script(['U']);
    expect(snapshot(s.model)).toEqual(before);
    // None associated: nothing changes.
    await s.bus.script(['DIMDISASSOCIATE']);
    await pickDims(s, 1);
    expect(s.bus.history.at(-1)).toBe('0 disassociated.');
    expect(snapshot(s.model)).toEqual(before);
  });
});
