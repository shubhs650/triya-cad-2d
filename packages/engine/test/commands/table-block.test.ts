// M4-16 part 1: TINSERT and the Table Cell menu's Insert Block put a block in a table cell through
// the Insert a Block in a Table Cell dialog (Name, Scale, AutoFit, Rotation angle, Overall cell
// alignment), as AutoCAD 2024's "TINSERT (Command)" does.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  blockCellScale,
  standardTableStyle,
  withCellText,
  type BusEvent,
  type DialogPrompt,
  type DocumentInit,
  type Entity,
  type EntityId,
  type TableBlockSettings,
  type TableGeometry,
  type TableStyleRecord,
} from '../../src/index';
import { blockRecord, circleGeom, entityInit, lineGeom, sampleInit } from '../model/fixtures';

const ACADISO: TableStyleRecord = { handle: '90', ...standardTableStyle(true, '16') };
const VALVE = '30';
const TAG = '32';

function setup(options: { blocks?: boolean } = {}) {
  const init = sampleInit();
  const blocks = options.blocks !== false;
  const withStyles: DocumentInit = {
    ...init,
    meta: { ...init.meta, measurement: 'metric' },
    tables: {
      ...init.tables,
      blockRecords: [
        ...(init.tables?.blockRecords ?? []),
        ...(blocks ? [blockRecord(VALVE, 'VALVE'), blockRecord(TAG, 'Tag')] : []),
      ],
      textStyles: [
        {
          handle: '16',
          name: 'Standard',
          font: 'txt',
          height: 0,
          widthFactor: 1,
          obliqueAngle: 0,
          lastHeight: 2.5,
          generation: 0,
          trueTypeFlags: 0,
        },
      ],
      tableStyles: [ACADISO],
    },
    blocks: [
      ...(init.blocks ?? []),
      ...(blocks
        ? [
            { handle: VALVE, name: 'VALVE', basePoint: { x: 0, y: 0 } },
            { handle: TAG, name: 'Tag', basePoint: { x: 0, y: 0 } },
          ]
        : []),
    ],
    entities: [
      ...(init.entities ?? []),
      // VALVE: a circle 10 across about its base point; Tag: a line 4 long and 2 high.
      ...(blocks
        ? [
            entityInit('31', circleGeom(0, 0, 5), { owner: VALVE }),
            entityInit('33', lineGeom(0, 0, 4, 2), { owner: TAG }),
          ]
        : []),
    ],
  };
  const model = DocumentModel.create(withStyles);
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    // A pick takes the table, as a click inside one does.
    view: {
      request: (r) =>
        Promise.resolve(
          r.op === 'pick' ? { ok: true, ids: [table().id] } : { ok: false, message: 'no' },
        ),
    },
  });
  const messages: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') messages.push(e.line);
  });
  const table = () =>
    [...model.entities()].find(
      (e): e is Entity & { geom: TableGeometry } =>
        !before.has(e.id) && e.geom.kind === 'ACAD_TABLE',
    )!;
  const dialog = () => (bus.prompt as DialogPrompt | undefined)?.dialog;
  /** What the table's `*T` block holds. */
  const inserts = () => {
    const g = table().geom;
    return model
      .blockEntities(g.block!)
      .map((id: EntityId) => model.entity(id)!.geom)
      .filter((x) => x.kind === 'INSERT');
  };
  return { model, bus, messages, table, dialog, inserts };
}

/** -TABLE at 0,0: two columns 63.5 wide, a title, a header and three data rows 9 high. */
async function table(s: ReturnType<typeof setup>) {
  await s.bus.script(['-TABLE', '2', '3', '0,0']);
  await s.bus.answer({ kind: 'string', value: 'VALVES', editor: true });
  expect(s.bus.promptText).toBe('Command:');
}

/** A cell's centre: row `i` (0 title, 1 header, 2… data), column `j`. */
const at = (i: number, j: number) => ({
  x: 31.75 + 63.5 * j,
  y: i === 0 ? -5.5 : i === 1 ? -15.5 : -24.5 - 9 * (i - 2),
});

const ok = (tableBlock: TableBlockSettings) =>
  ({ kind: 'dialog', action: 'ok', tableBlock }) as const;

describe('TINSERT', () => {
  it('asks for a cell and opens Insert a Block in a Table Cell on it', async () => {
    const s = setup();
    await table(s);
    await s.bus.script(['TINSERT']);
    expect(s.bus.promptText).toBe('Pick a table cell:');
    await s.bus.pick(at(2, 1));
    expect(s.dialog()).toEqual({
      type: 'tinsert',
      // By name, whatever the case.
      blocks: [
        { handle: TAG, name: 'Tag' },
        { handle: VALVE, name: 'VALVE' },
      ],
      settings: { block: TAG, scale: 1, autoFit: true, rotation: 0, alignment: 2 },
    });
  });

  it('puts the block in the cell, fitted to it with AutoFit', async () => {
    const s = setup();
    await table(s);
    const rows = s.table().geom.rowHeights;
    await s.bus.script(['TINSERT']);
    await s.bus.pick(at(2, 1));
    await s.bus.answer(ok({ block: VALVE, scale: 1, autoFit: true, rotation: 0, alignment: 5 }));
    expect(s.bus.promptText).toBe('Command:');
    const g = s.table().geom;
    // The data row (9 high, margins 1.5) holds 6 of the circle's 10.
    expect(g.cells[2]![1]).toEqual({
      type: 'block',
      text: '',
      block: VALVE,
      blockScale: 0.6,
      autoFit: true,
      rowSpan: 1,
      columnSpan: 1,
      merged: false,
      rotation: 0,
      format: { alignment: 5 },
    });
    expect(g.rowHeights).toEqual(rows);
    // The table's block draws it, middle centre in the cell.
    expect(s.inserts()).toEqual([
      expect.objectContaining({
        block: VALVE,
        position: { x: 95.25, y: -24.5 },
        scale: { x: 0.6, y: 0.6, z: 0.6 },
      }),
    ]);
    // One undo step.
    await s.bus.script(['U']);
    expect(s.table().geom.cells[2]![1]!.type).toBe('text');
  });

  it('inserts at the scale and rotation given without AutoFit, the row grown to hold it', async () => {
    const s = setup();
    await table(s);
    await s.bus.script(['TINSERT']);
    await s.bus.pick(at(3, 0));
    await s.bus.answer(
      ok({ block: TAG, scale: 5, autoFit: false, rotation: Math.PI / 2, alignment: 2 }),
    );
    const g = s.table().geom;
    expect(g.cells[3]![0]).toMatchObject({
      type: 'block',
      block: TAG,
      blockScale: 5,
      autoFit: false,
      rotation: Math.PI / 2,
    });
    // Its row style's alignment (top centre) is no override.
    expect(g.cells[3]![0]!.format).toBeUndefined();
    // Turned, the Tag's 4 across stand 20 high, with a 1.5 margin above and below.
    expect(g.rowHeights[3]).toBeCloseTo(23);
    expect(g.rowHeights.filter((_, k) => k !== 3).every((h) => h <= 11)).toBe(true);
  });

  it('keeps a row tall enough for the block at its scale', async () => {
    const s = setup();
    await table(s);
    await s.bus.script(['TINSERT']);
    await s.bus.pick(at(2, 0));
    await s.bus.answer(ok({ block: TAG, scale: 1, autoFit: false, rotation: 0, alignment: 2 }));
    expect(s.table().geom.rowHeights[2]).toBe(9);
  });

  it('opens on what a block cell holds, and the cell takes text typed in it', async () => {
    const s = setup();
    await table(s);
    await s.bus.script(['TINSERT']);
    await s.bus.pick(at(2, 1));
    await s.bus.answer(ok({ block: VALVE, scale: 1, autoFit: false, rotation: 0, alignment: 8 }));
    await s.bus.script(['TINSERT']);
    await s.bus.pick(at(2, 1));
    expect(s.dialog()).toMatchObject({
      settings: { block: VALVE, scale: 1, autoFit: false, rotation: 0, alignment: 8 },
    });
    await s.bus.answer({ kind: 'dialog', action: 'ok' });
    expect(s.bus.promptText).toBe('Command:');

    const g = withCellText(s.table().geom, 2, 1, 'Ball valve');
    expect(g.cells[2]![1]).toEqual({
      type: 'text',
      text: 'Ball valve',
      rowSpan: 1,
      columnSpan: 1,
      merged: false,
      rotation: 0,
      format: { alignment: 8 },
    });
  });

  it('changes nothing on Cancel, or on a block no longer in the drawing', async () => {
    const s = setup();
    await table(s);
    const version = s.model.version;
    await s.bus.script(['TINSERT']);
    await s.bus.pick(at(2, 1));
    await s.bus.cancel();
    await s.bus.script(['TINSERT']);
    await s.bus.pick(at(2, 1));
    await s.bus.answer(ok({ block: 'FFF', scale: 1, autoFit: true, rotation: 0, alignment: 1 }));
    await s.bus.script(['TINSERT']);
    await s.bus.pick(at(2, 1));
    await s.bus.answer(ok({ scale: 1, autoFit: true, rotation: 0, alignment: 1 }));
    expect(s.bus.promptText).toBe('Command:');
    expect(s.model.version).toBe(version);
  });

  it('refuses a scale of 0 without AutoFit', async () => {
    const s = setup();
    await table(s);
    await s.bus.script(['TINSERT']);
    await s.bus.pick(at(2, 1));
    await s.bus.answer(ok({ block: TAG, scale: 0, autoFit: false, rotation: 0, alignment: 1 }));
    expect(s.messages).toContain('The scale must be greater than 0.');
    expect(s.table().geom.cells[2]![1]!.type).toBe('text');
  });

  it('says when the drawing has no block to insert', async () => {
    const s = setup({ blocks: false });
    await table(s);
    await s.bus.script(['TINSERT']);
    await s.bus.pick(at(2, 1));
    expect(s.messages).toContain('The drawing has no blocks to insert in a table cell.');
    expect(s.bus.promptText).toBe('Command:');
  });

  it('is the Table Cell menu Insert Block on the cell selected', async () => {
    const s = setup();
    await table(s);
    await s.bus.pick(at(4, 1), { grip: 1 });
    expect(s.bus.command).toBe('TABLECELL');
    await s.bus.answer({ kind: 'keyword', keyword: 'BLock' });
    expect(s.dialog()).toMatchObject({ type: 'tinsert', settings: { block: TAG } });
    await s.bus.answer(ok({ block: VALVE, scale: 1, autoFit: true, rotation: 0, alignment: 2 }));
    expect(s.bus.promptText).toBe('Command:');
    expect(s.table().geom.cells[4]![1]).toMatchObject({ type: 'block', block: VALVE });
  });
});

describe('blockCellScale', () => {
  const box = { minX: -5, minY: -5, maxX: 5, maxY: 5 };
  const cell = {
    type: 'block',
    text: '',
    rowSpan: 1,
    columnSpan: 1,
    merged: false,
    rotation: 0,
  } as const;
  it('fits the block unless AutoFit is off', () => {
    expect(blockCellScale(cell, box, { x: 20, y: 5 })).toBe(0.5);
    expect(blockCellScale({ ...cell, autoFit: true, blockScale: 3 }, box, { x: 20, y: 5 })).toBe(
      0.5,
    );
    expect(blockCellScale(cell, { minX: 0, minY: 0, maxX: 0, maxY: 0 }, { x: 1, y: 1 })).toBe(1);
  });
  it('takes the block scale with AutoFit off, 1 when it states none', () => {
    expect(blockCellScale({ ...cell, autoFit: false, blockScale: 3 }, box, { x: 1, y: 1 })).toBe(3);
    expect(blockCellScale({ ...cell, autoFit: false }, box, { x: 1, y: 1 })).toBe(1);
  });
});
