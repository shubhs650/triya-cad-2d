// M4-02 part 4: DIMBREAK, DIMINSPECT and -DIMINSPECT on the PromptBus with AutoCAD 2024's
// prompts, writing DEC-064's TRIYA_DIMBREAK and TRIYA_DIMINSPECT records. The stand-in engine
// below draws a linear dimension's line, which is what Auto finds crossings with; the gaps and
// the frame themselves are drawn by `@triya/dims` (packages/dims/test/records.test.ts).
import { describe, expect, it } from 'vitest';
import {
  dimBreakOf,
  dimInspectOf,
  isDimBreak,
  isDimInspect,
  type DimensionGeometry,
  type DimensionRegenerator,
  type Entity,
} from '../../src/index';
import { regenerate, said, setup } from './dimension-harness';

/** Each regeneration, by dimension handle. */
const drawnCount = new Map<string, number>();

/** The stand-in engine, plus a linear dimension's line from extension line to extension line. */
const withLine: DimensionRegenerator = (e, model, measure) => {
  const r = regenerate(e, model, measure);
  const g = e.geom as DimensionGeometry;
  if (!r || g.dimType !== 'linear') return r;
  drawnCount.set(e.handle, (drawnCount.get(e.handle) ?? 0) + 1);
  const y = g.definitionPoint.y;
  return {
    ...r,
    parts: [
      ...r.parts,
      { geom: { kind: 'LINE', start: { x: g.first.x, y }, end: { x: g.second.x, y } } },
    ],
  };
};

/** A DIMLINEAR from (0,30) to (10,30) with its line at y = 35, and a line across it at x = 5. */
async function drawing() {
  const s = setup({ regenerate: withLine });
  await s.bus.script(['DIMLINEAR', '0,30', '10,30', '5,35']);
  await s.bus.script(['LINE', '5,28', '5,38', '']);
  const dim = s.dims()[0]!;
  const line = s.added().find((e) => e.geom.kind === 'LINE')!;
  const now = (): Entity => s.model.entity(dim.id)!;
  const breaks = () => dimBreakOf(s.model, now());
  return { ...s, dim, line, now, breaks };
}

describe('DIMBREAK', () => {
  it("asks AutoCAD 2024's prompts; Enter (Auto) breaks it at the objects crossing it", async () => {
    const s = await drawing();
    await s.bus.submit('DIMBREAK');
    expect(s.bus.promptText).toBe('Select dimension to add/remove break or [Multiple]:');
    await s.bus.pick({ x: 10, y: 35 });
    expect(s.bus.promptText).toBe(
      'Select object to break dimension or [Auto/Manual/Remove] <Auto>:',
    );
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
    expect(said(s.bus)).toContain('1 object modified');
    const r = s.breaks()!;
    expect(r).toMatchObject({ type: 'TRIYA_DIMBREAK', objects: [s.line.handle], manual: [] });
    // The record sits in the dimension's new extension dictionary.
    expect(s.now().extDict).toBe(r.owner);
    expect(r.dimension).toBe(s.dim.handle);
  });

  it('an object picked breaks it, then more until Enter; the dimension itself is left out', async () => {
    const s = await drawing();
    await s.bus.script(['LINE', '8,28', '8,38', '']);
    const other = s.added().filter((e) => e.geom.kind === 'LINE')[1]!;
    await s.bus.submit('DIMBREAK');
    await s.bus.pick({ x: 10, y: 35 });
    await s.bus.pick({ x: 5, y: 37 });
    expect(s.bus.promptText).toBe('Select object to break dimension:');
    expect(s.breaks()!.objects).toEqual([s.line.handle]);
    await s.bus.pick({ x: 8, y: 37 });
    await s.bus.pick({ x: 10, y: 35 });
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
    expect(s.breaks()!.objects).toEqual([s.line.handle, other.handle]);
    // One undo takes the whole command back.
    await s.bus.script(['U']);
    expect(s.breaks()).toBeUndefined();
  });

  it('Manual keeps two points put on the dimension line', async () => {
    const s = await drawing();
    await s.bus.submit('DIMBREAK');
    await s.bus.pick({ x: 10, y: 35 });
    await s.bus.submit('M');
    expect(s.bus.promptText).toBe('Specify first break point:');
    await s.bus.submit('2,35.3');
    expect(s.bus.promptText).toBe('Specify second break point:');
    await s.bus.submit('4,34.8');
    expect(s.bus.command).toBeUndefined();
    const [[a, b]] = s.breaks()!.manual as [[{ x: number; y: number }, { x: number; y: number }]];
    expect(a.x).toBeCloseTo(2, 12);
    expect(a.y).toBeCloseTo(35, 12);
    expect(b.x).toBeCloseTo(4, 12);
    expect(b.y).toBeCloseTo(35, 12);
    expect(s.breaks()!.objects).toEqual([]);
  });

  it('Remove takes the breaks off', async () => {
    const s = await drawing();
    await s.bus.submit('DIMBREAK');
    await s.bus.pick({ x: 10, y: 35 });
    await s.bus.submit('');
    await s.bus.submit('DIMBREAK');
    await s.bus.pick({ x: 10, y: 35 });
    await s.bus.submit('R');
    expect(s.bus.command).toBeUndefined();
    expect(s.breaks()).toBeUndefined();
    expect([...s.model.objects.values()].some(isDimBreak)).toBe(false);
  });

  it('Multiple breaks (or unbreaks) every dimension selected', async () => {
    const s = await drawing();
    await s.bus.script(['DIMLINEAR', '0,29', '10,29', '5,33']);
    await s.bus.submit('DIMBREAK');
    await s.bus.submit('M');
    expect(s.bus.promptText).toBe('Select dimensions:');
    await s.bus.pick({ x: 10, y: 35 });
    await s.bus.pick({ x: 10, y: 33 });
    await s.bus.submit('');
    expect(s.bus.promptText).toBe('Enter an option [Break/Remove] <Break>:');
    await s.bus.submit('');
    expect(said(s.bus)).toContain('2 objects modified');
    const records = [...s.model.objects.values()].filter(isDimBreak);
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.objects.includes(s.line.handle))).toBe(true);
    await s.bus.script(['DIMBREAK', 'M']);
    await s.bus.pick({ x: 10, y: 35 });
    await s.bus.pick({ x: 10, y: 33 });
    await s.bus.script(['', 'R']);
    expect([...s.model.objects.values()].some(isDimBreak)).toBe(false);
  });

  it('says so when the object picked is not a dimension', async () => {
    const s = await drawing();
    await s.bus.submit('DIMBREAK');
    await s.bus.pick({ x: 5, y: 37 });
    expect(said(s.bus)).toContain('Object selected is not a dimension.');
    expect(s.bus.promptText).toBe('Select dimension to add/remove break or [Multiple]:');
  });

  it('the gaps follow: moving a breaking object has the dimension drawn again', async () => {
    const s = await drawing();
    await s.bus.script(['DIMBREAK']);
    await s.bus.pick({ x: 10, y: 35 });
    await s.bus.submit('');
    const before = drawnCount.get(s.dim.handle)!;
    await s.bus.script(['MOVE']);
    await s.bus.pick({ x: 5, y: 37 });
    await s.bus.script(['', '0,0', '2,0']);
    expect(drawnCount.get(s.dim.handle)).toBe(before + 1);
    // Moving something else leaves it be.
    await s.bus.script(['MOVE']);
    await s.bus.pick({ x: 5, y: 20 });
    await s.bus.script(['', '0,0', '2,0']);
    expect(drawnCount.get(s.dim.handle)).toBe(before + 1);
  });

  it('MOVE carries manual breaks, COPY copies the records, ERASE takes them with it', async () => {
    const s = await drawing();
    await s.bus.script(['DIMBREAK']);
    await s.bus.pick({ x: 10, y: 35 });
    await s.bus.script(['M', '2,35', '4,35']);
    await s.bus.script(['MOVE']);
    await s.bus.pick({ x: 10, y: 35 });
    await s.bus.script(['', '0,0', '0,10']);
    expect(s.breaks()!.manual[0]![0]).toMatchObject({ x: 2, y: 45 });
    await s.bus.script(['COPY']);
    await s.bus.pick({ x: 10, y: 45 });
    await s.bus.script(['', '0,0', '0,10', '']);
    const copy = s.dims()[1]!;
    const copied = dimBreakOf(s.model, copy)!;
    expect(copied.owner).toBe(copy.extDict);
    expect(copied.owner).not.toBe(s.breaks()!.owner);
    expect(copied.manual[0]![0]).toMatchObject({ x: 2, y: 55 });
    await s.bus.script(['ERASE']);
    await s.bus.pick({ x: 10, y: 55 });
    await s.bus.submit('');
    expect([...s.model.objects.values()].filter(isDimBreak)).toHaveLength(1);
  });
});

describe('DIMINSPECT', () => {
  it("-DIMINSPECT asks AutoCAD 2024's prompts and makes an inspection dimension", async () => {
    const s = await drawing();
    await s.bus.submit('-DIMINSPECT');
    expect(s.bus.promptText).toBe('Add inspection data or [Add/Remove] <Add>:');
    await s.bus.submit('');
    expect(s.bus.promptText).toBe('Select dimensions:');
    await s.bus.pick({ x: 10, y: 35 });
    await s.bus.submit('');
    expect(s.bus.promptText).toBe('Enter shape option [Round/Angular/None] <Round>:');
    await s.bus.submit('A');
    expect(s.bus.promptText).toBe('Enter label value or [None] <None>:');
    await s.bus.submit('A1');
    expect(s.bus.promptText).toBe('Enter inspection rate or [None] <100%>:');
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
    expect(dimInspectOf(s.model, s.now())).toMatchObject({
      type: 'TRIYA_DIMINSPECT',
      shape: 'angular',
      label: 'A1',
      rate: '100%',
    });
    // None leaves the label and rate off; Remove takes the inspection data off.
    await s.bus.script(['-DIMINSPECT', '']);
    await s.bus.pick({ x: 10, y: 35 });
    await s.bus.script(['', 'N', '', 'N']);
    const r = dimInspectOf(s.model, s.now())!;
    expect(r.shape).toBe('none');
    expect(r.label).toBeUndefined();
    expect(r.rate).toBeUndefined();
    await s.bus.script(['-DIMINSPECT', 'R']);
    await s.bus.pick({ x: 10, y: 35 });
    await s.bus.submit('');
    expect([...s.model.objects.values()].some(isDimInspect)).toBe(false);
  });

  it('DIMINSPECT opens the dialog; Select dimensions, then OK applies its settings', async () => {
    const s = await drawing();
    await s.bus.submit('DIMINSPECT');
    expect(s.bus.prompt).toMatchObject({
      kind: 'dialog',
      dialog: { type: 'diminspect', settings: { shape: 'round', rate: '100%' }, selected: 0 },
    });
    await s.bus.answer({ kind: 'dialog', action: 'select' });
    expect(s.bus.promptText).toBe('Select dimensions:');
    await s.bus.pick({ x: 10, y: 35 });
    await s.bus.submit('');
    expect(s.bus.prompt).toMatchObject({ kind: 'dialog', dialog: { selected: 1 } });
    await s.bus.answer({
      kind: 'dialog',
      action: 'ok',
      inspection: { shape: 'round', label: 'B', rate: '25%' },
    });
    expect(s.bus.command).toBeUndefined();
    expect(dimInspectOf(s.model, s.now())).toMatchObject({
      shape: 'round',
      label: 'B',
      rate: '25%',
    });
    // The dialog opens on a selected inspection dimension's settings; Remove Inspection.
    await s.bus.pick({ x: 10, y: 35 });
    await s.bus.submit('DIMINSPECT');
    expect(s.bus.prompt).toMatchObject({
      dialog: { settings: { shape: 'round', label: 'B', rate: '25%' }, selected: 1 },
    });
    await s.bus.answer({ kind: 'dialog', action: 'remove' });
    expect(dimInspectOf(s.model, s.now())).toBeUndefined();
    // Breaks and inspection share the dimension's dictionary.
    await s.bus.script(['DIMBREAK']);
    await s.bus.pick({ x: 10, y: 35 });
    await s.bus.script(['', '-DIMINSPECT', '']);
    await s.bus.pick({ x: 10, y: 35 });
    await s.bus.script(['', '', '', '']);
    expect(dimInspectOf(s.model, s.now())!.owner).toBe(dimBreakOf(s.model, s.now())!.owner);
  });
});
