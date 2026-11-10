// M2-30 part 2: a dimension regenerates when what it is drawn by changes without its points
// moving: its dimension style (another one chosen, or the DIMSTYLE record itself changed), its
// DIMVAR overrides (the `DSTYLE` xdata) or its text override, as AutoCAD redraws every
// dimension of a style it modifies (AutoCAD 2024 Help, "Dimension Style Manager": "Changes are
// reflected immediately in the dimensions that use that style"). The Properties palette's
// dimension rows (Dim style, Text override and the DIMVAR rows) are the first way in. And a
// dimension without a block gets one in the saved file only (`blocklessDimensionBlocks`).
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  applyToReplica,
  PromptBus,
  builtinCommands,
  dimVars,
  propertySheet,
  regenerateDimensions,
  type BusEvent,
  type CommandDef,
  type DimStyleRecord,
  type DimensionGeometry,
  type DimensionRegenerator,
  type DocumentInit,
  type Entity,
  type MTextGeometry,
  type PropertyRow,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { blockRecord, entityInit, lineGeom, record, sampleInit, snapshot } from '../model/fixtures';

const DIM = '30';
const BLOCKLESS = '31';
const BLOCK = '50';
const STANDARD = '27';
const ISO = '28';
const ACAD = '12';

const style = (handle: string, name: string, vars: DimStyleRecord['vars']): DimStyleRecord => ({
  handle,
  name,
  vars,
});

const dimension = (extra: Partial<DimensionGeometry> = {}): DimensionGeometry =>
  ({
    kind: 'DIMENSION',
    dimType: 'linear',
    style: STANDARD,
    block: BLOCK,
    first: { x: 0, y: 0 },
    second: { x: 10, y: 0 },
    definitionPoint: { x: 10, y: 5 },
    textPosition: { x: 5, y: 5 },
    textUserPositioned: false,
    text: '',
    textRotation: 0,
    horizontalDirection: 0,
    attachment: 5,
    lineSpacingStyle: 1,
    lineSpacing: 1,
    rotation: 0,
    ...extra,
  }) as DimensionGeometry;

function init(): DocumentInit {
  const base = sampleInit();
  const { block: _b, ...blockless } = dimension({
    first: { x: 0, y: 20 },
    second: { x: 4, y: 20 },
    definitionPoint: { x: 4, y: 25 },
  });
  return {
    ...base,
    tables: {
      ...base.tables,
      appIds: [record(ACAD, 'ACAD')],
      dimStyles: [
        style(STANDARD, 'Standard', { DIMTXT: 0.18, DIMASZ: 0.18 }),
        style(ISO, 'ISO-25', { DIMTXT: 2.5, DIMASZ: 2.5 }),
      ],
      blockRecords: [...(base.tables?.blockRecords ?? []), blockRecord(BLOCK, '*D1')],
    },
    blocks: [...(base.blocks ?? []), { handle: BLOCK, name: '*D1', basePoint: { x: 0, y: 0 } }],
    entities: [
      entityInit(DIM, dimension()),
      entityInit('51', lineGeom(0, 5, 10, 5), { owner: BLOCK }),
      entityInit(BLOCKLESS, blockless as DimensionGeometry),
    ],
  };
}

const mtext = (contents: string, height: number): MTextGeometry => ({
  kind: 'MTEXT',
  contents,
  style: '',
  position: { x: 0, y: 0 },
  height,
  width: 0,
  rotation: 0,
  attachment: 5,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
});

/**
 * The stand-in dimension engine: the dimension line, and its text (the override, or the
 * measurement) at the DIMTXT its style and overrides give.
 */
const regenerate: DimensionRegenerator = (e, model, measure) => {
  const g = e.geom;
  if (g.kind !== 'DIMENSION' || g.dimType !== 'linear') return undefined;
  const vars = dimVars(g.style, e.xdata, model);
  const height = typeof vars.DIMTXT === 'number' ? vars.DIMTXT : 0.18;
  const label = g.text === '' ? String(Math.abs(g.second.x - g.first.x)) : g.text;
  const text = { ...mtext(label, height), position: { x: g.second.x / 2, y: 6 } };
  if (measure(text) === undefined) return undefined;
  const y = g.definitionPoint.y;
  return {
    parts: [{ geom: lineGeom(g.first.x, y, g.second.x, y) }, { geom: text }],
    geom: { ...g, textPosition: text.position },
  };
};

function setup(o: { dimensions?: boolean; measures?: boolean; extra?: CommandDef[] } = {}) {
  const model = DocumentModel.create(init());
  const registry = builtinCommands();
  for (const def of o.extra ?? []) registry.register(def);
  const asked: string[][] = [];
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'pick') {
        // A dimension is found by its definition point.
        const ids = model.blockEntities(model.entityByHandle(DIM)!.owner).filter((id) => {
          const g = model.entity(id)!.geom;
          return g.kind === 'DIMENSION' && dist(g.definitionPoint, r.point) < 0.5;
        });
        return Promise.resolve({ ok: true, ids });
      }
      if (r.op !== 'textWidths') return Promise.resolve({ ok: false, message: 'no canvas' });
      asked.push(r.texts.map((t) => t.contents));
      const measures = o.measures ?? true;
      return Promise.resolve({
        ok: true,
        widths: r.texts.map((t) => (measures ? t.contents.length : null)),
      });
    },
  };
  const bus = new PromptBus({
    model,
    registry,
    view,
    ...(o.dimensions !== false && { dimensions: regenerate }),
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const byHandle = (h: string): Entity => model.entityByHandle(h)!;
  const geom = (h = DIM) => byHandle(h).geom as DimensionGeometry;
  /** The text the dimension's block holds now. */
  const text = (h = DIM): MTextGeometry | undefined => {
    const block = geom(h).block;
    if (block === undefined) return undefined;
    const found = model
      .blockEntities(block)
      .map((id) => model.entity(id)!.geom)
      .find((g) => g.kind === 'MTEXT');
    return found as MTextGeometry | undefined;
  };
  return { model, bus, log, byHandle, geom, text, asked };
}

/** Selects the dimensions as the canvas's picks would, at `Command:`. */
async function selectDims(s: ReturnType<typeof setup>, h: string) {
  await s.bus.pick(s.geom(h).definitionPoint);
  expect(s.bus.selection).toEqual([s.byHandle(h).id]);
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

const rowOf = (s: ReturnType<typeof setup>, label: string): PropertyRow => {
  const sheet = propertySheet(s.model, s.bus.selection);
  for (const section of sheet.sections) {
    const r = section.rows.find((x) => x.label === label);
    if (r) return r;
  }
  throw new Error(`no row ${label}`);
};

describe('the Properties palette regenerates the dimensions it restyles (M2-30 part 2)', () => {
  it('lists the drawing’s dimension styles under Dim style', async () => {
    const s = setup();
    await selectDims(s, DIM);
    const row = rowOf(s, 'Dim style');
    expect(row.readOnly).toBeUndefined();
    expect(row.kind).toBe('choice');
    expect(row.value).toBe(STANDARD);
    expect(row.options).toEqual([
      { value: ISO, label: 'ISO-25' },
      { value: STANDARD, label: 'Standard' },
    ]);
  });

  it('another Dim style redraws the dimension in it, as one undo step', async () => {
    const s = setup();
    const before = snapshot(s.model);
    await selectDims(s, DIM);
    await s.bus.setProperty({ key: 'dimStyle', value: ISO });
    expect(s.geom().style).toBe(ISO);
    // The stored line went: the block holds what the engine draws, at ISO-25's DIMTXT.
    expect(s.text()).toMatchObject({ contents: '10', height: 2.5 });
    expect(s.model.entityByHandle('51')).toBeUndefined();
    expect(s.geom().block).toBe(BLOCK);
    expect(s.bus.undo.state.undoable).toBe(1);
    expect(s.log).toEqual([]);
    await s.bus.submit('U');
    expect(snapshot(s.model)).toEqual(before);
  });

  it('refuses a dimension style the drawing does not have', async () => {
    const s = setup();
    await selectDims(s, DIM);
    await s.bus.setProperty({ key: 'dimStyle', value: 'FF' });
    expect(s.log).toEqual(['Invalid input.']);
    expect(s.geom().style).toBe(STANDARD);
  });

  it('writes a DIMVAR row as a DSTYLE override, and drops it when set back to the style’s', async () => {
    const s = setup();
    await selectDims(s, DIM);
    expect(rowOf(s, 'Text height')).toMatchObject({ kind: 'distance', value: 0.18 });
    await s.bus.setProperty({ key: 'dimvar:DIMTXT', value: '0.5' });
    expect(s.byHandle(DIM).xdata).toEqual([
      {
        appId: ACAD,
        values: [
          { code: 1000, value: 'DSTYLE' },
          { code: 1002, value: '{' },
          { code: 1070, value: 140 },
          { code: 1040, value: 0.5 },
          { code: 1002, value: '}' },
        ],
      },
    ]);
    expect(rowOf(s, 'Text height').value).toBe(0.5);
    expect(s.text()).toMatchObject({ height: 0.5 });
    // A second override joins the list; Precision is an integer (1070).
    await s.bus.setProperty({ key: 'dimvar:DIMDEC', value: '2' });
    expect(s.byHandle(DIM).xdata![0]!.values.slice(4, 6)).toEqual([
      { code: 1070, value: 271 },
      { code: 1070, value: 2 },
    ]);
    // Back to the style's value: no override left, and no empty DSTYLE list.
    await s.bus.setProperty({ key: 'dimvar:DIMTXT', value: '0.18' });
    await s.bus.setProperty({ key: 'dimvar:DIMDEC', value: '4' });
    expect(s.byHandle(DIM).xdata).toBeUndefined();
    expect(s.text()).toMatchObject({ height: 0.18 });
  });

  it('keeps the entity’s other ACAD xdata when it writes an override', async () => {
    const s = setup();
    const id = s.byHandle(DIM).id;
    // Another ACAD list before it (AutoCAD keeps e.g. DIMJAG and HATCH xdata under ACAD).
    const b = new ChangeSetBuilder(s.model);
    b.updateEntity(id, {
      xdata: [
        {
          appId: ACAD,
          values: [
            { code: 1000, value: 'OTHER' },
            { code: 1070, value: 1 },
          ],
        },
      ],
    });
    s.model.apply(b.build());
    await selectDims(s, DIM);
    await s.bus.setProperty({ key: 'dimvar:DIMASZ', value: '1' });
    expect(s.byHandle(DIM).xdata![0]!.values).toEqual([
      { code: 1000, value: 'OTHER' },
      { code: 1070, value: 1 },
      { code: 1000, value: 'DSTYLE' },
      { code: 1002, value: '{' },
      { code: 1070, value: 41 },
      { code: 1040, value: 1 },
      { code: 1002, value: '}' },
    ]);
  });

  it('refuses a DIMVAR value the variable cannot take', async () => {
    const s = setup();
    await selectDims(s, DIM);
    await s.bus.setProperty({ key: 'dimvar:DIMTXT', value: '-1' });
    await s.bus.setProperty({ key: 'dimvar:DIMDEC', value: '9' });
    expect(s.log).toEqual(['Invalid input.', 'Invalid input.']);
    expect(s.byHandle(DIM).xdata).toBeUndefined();
  });

  it('redraws a dimension whose text override changed', async () => {
    const s = setup();
    await selectDims(s, DIM);
    expect(rowOf(s, 'Text override').readOnly).toBeUndefined();
    await s.bus.setProperty({ key: 'textOverride', value: '<> TYP' });
    expect(s.geom().text).toBe('<> TYP');
    expect(s.text()?.contents).toBe('<> TYP');
  });

  it('gives a dimension without a block one when it is restyled', async () => {
    const s = setup();
    await selectDims(s, BLOCKLESS);
    await s.bus.setProperty({ key: 'dimStyle', value: ISO });
    expect(s.text(BLOCKLESS)).toMatchObject({ contents: '4', height: 2.5 });
  });

  it('carries the dimension whole without a dimension engine, saying nothing', async () => {
    const s = setup({ dimensions: false });
    await selectDims(s, DIM);
    await s.bus.setProperty({ key: 'dimStyle', value: ISO });
    expect(s.geom().style).toBe(ISO);
    expect(s.model.entityByHandle('51')).toBeDefined();
    expect(s.log).toEqual([]);
  });

  it('says so when the text cannot be measured', async () => {
    const s = setup({ measures: false });
    await selectDims(s, DIM);
    await s.bus.setProperty({ key: 'dimStyle', value: ISO });
    expect(s.model.entityByHandle('51')).toBeDefined();
    expect(s.log).toEqual(['1 dimension was not regenerated (its text cannot be measured).']);
  });
});

describe('a changed DIMSTYLE regenerates its dimensions (M2-30 part 2)', () => {
  /** A command that changes a DIMSTYLE record, as the Dimension Style Manager (M4-03) will. */
  const restyle = (vars: DimStyleRecord['vars']): CommandDef => ({
    name: 'TESTRESTYLE',
    // eslint-disable-next-line require-yield -- no prompts
    async *run(ctx) {
      ctx.edit((b) => {
        const r = ctx.model.tables.dimStyles.get(STANDARD)!;
        b.updateTableRecord('dimStyles', STANDARD, { vars: { ...r.vars, ...vars } });
      });
    },
  });

  it('redraws every dimension of the style once the command ends', async () => {
    const s = setup({ extra: [restyle({ DIMTXT: 1 })] });
    await s.bus.submit('TESTRESTYLE');
    expect(s.text(DIM)).toMatchObject({ height: 1 });
    expect(s.text(BLOCKLESS)).toMatchObject({ height: 1 });
    expect(s.bus.undo.state.undoable).toBe(1);
  });

  it('leaves the dimensions of other styles and unchanged styles alone', async () => {
    const s = setup({ extra: [restyle({})] });
    await s.bus.submit('TESTRESTYLE');
    expect(s.asked).toEqual([]);
    expect(s.model.entityByHandle('51')).toBeDefined();
  });

  it('does not redraw a dimension the command already regenerated', async () => {
    const own: CommandDef = {
      name: 'TESTOWN',
      async *run(ctx) {
        const id = ctx.model.entityByHandle(DIM)!.id;
        ctx.edit((b) => b.updateEntity(id, { geom: { ...dimension(), text: 'X' } }));
        await regenerateDimensions(ctx, [id]);
        yield* [];
      },
    };
    const s = setup({ extra: [own] });
    await s.bus.submit('TESTOWN');
    expect(s.text()?.contents).toBe('X');
    expect(s.asked).toEqual([['X']]);
  });
});

describe('blocklessDimensionBlocks: a block in the saved file only (M2-30 part 2)', () => {
  it('draws each dimension without a block into a new *D block, leaving the drawing as it is', async () => {
    const s = setup();
    const before = snapshot(s.model);
    const change = await s.bus.blocklessDimensionBlocks();
    expect(snapshot(s.model)).toEqual(before);
    expect(change).toBeDefined();
    const updated = change!.entities!.updated!;
    expect(updated.map((u) => u.after.handle)).toEqual([BLOCKLESS]);
    const block = (updated[0]!.after.geom as DimensionGeometry).block!;
    expect(change!.blocks!.added!.map((b) => [b.handle, b.name])).toEqual([[block, '*D2']]);
    const parts = change!.entities!.added!.map((p) => p.entity);
    expect(parts.every((e) => e.owner === block)).toBe(true);
    expect(parts.map((e) => e.geom.kind)).toEqual(['LINE', 'MTEXT']);
    // Applied after the drawing's own edits, the change fits it.
    const copy = DocumentModel.create(init());
    applyToReplica(copy, change!);
    expect((copy.entityByHandle(BLOCKLESS)!.geom as DimensionGeometry).block).toBe(block);
  });

  it('takes handles a later edit never reuses', async () => {
    const s = setup();
    const change = await s.bus.blocklessDimensionBlocks();
    const taken = new Set(change!.entities!.added!.map((p) => p.entity.handle));
    await s.bus.script(['LINE', '0,0', '1,1', '']);
    const line = s.model.blockEntities(s.model.entityByHandle(DIM)!.owner).at(-1)!;
    expect(taken.has(s.model.entity(line)!.handle)).toBe(false);
  });

  it('is undefined when every dimension has its block, or without a dimension engine', async () => {
    const s = setup({ dimensions: false });
    expect(await s.bus.blocklessDimensionBlocks()).toBeUndefined();
    const t = setup();
    await selectDims(t, BLOCKLESS);
    await t.bus.setProperty({ key: 'dimStyle', value: ISO });
    expect(await t.bus.blocklessDimensionBlocks()).toBeUndefined();
  });

  it('leaves out a dimension whose text cannot be measured', async () => {
    const s = setup({ measures: false });
    expect(await s.bus.blocklessDimensionBlocks()).toBeUndefined();
  });
});
