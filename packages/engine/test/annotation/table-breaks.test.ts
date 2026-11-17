// M4-16 part 10: table breaks. A table whose breaks are enabled is drawn in parts no higher than
// the break height, laid out right, left or down `spacing` apart, its labels repeated when asked;
// its cells are found and boxed in the part they are drawn in; the breaking grip sets the break
// height; the Properties palette's Table Breaks rows set the rest.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  defaultTableBreaks,
  movedTableGrip,
  propertySheet,
  standardTableStyle,
  tableCellAt,
  tableCellBox,
  tableGrips,
  tableParts,
  tablePieces,
  tableTextScaled,
  type DocumentInit,
  type TableBreaks,
  type TableCell,
  type TableGeometry,
  type TablePart,
  type TableStyleRecord,
} from '../../src/index';
import { entityInit, sampleInit } from '../model/fixtures';

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
const STYLE: TableStyleRecord = { handle: 'S', ...standardTableStyle(false, 'T1') };
const UP: TableStyleRecord = { ...STYLE, flowDirection: 1 };

const cell = (text: string, more: Partial<TableCell> = {}): TableCell => ({
  type: 'text',
  text,
  rowSpan: 1,
  columnSpan: 1,
  merged: false,
  rotation: 0,
  ...more,
});

/** A title, a header and six data rows (1 high each) in two columns 2 and 3 wide. */
const table = (breaks?: Partial<TableBreaks>, more: Partial<TableGeometry> = {}): TableGeometry => {
  const g: TableGeometry = {
    kind: 'ACAD_TABLE',
    style: 'S',
    position: { x: 0, y: 0 },
    direction: { x: 1, y: 0 },
    rowHeights: [1, 1, 1, 1, 1, 1, 1, 1],
    columnWidths: [2, 3],
    cells: [
      [cell('Schedule', { columnSpan: 2 }), cell('', { merged: true })],
      [cell('Tag'), cell('Size')],
      ...[1, 2, 3, 4, 5, 6].map((n) => [cell(`N${n}`), cell(`${n}`)]),
    ],
    ...more,
  };
  return breaks
    ? {
        ...g,
        breaks: { ...defaultTableBreaks(g), enabled: true, height: 4, spacing: 0.5, ...breaks },
      }
    : g;
};

const pieces = (g: TableGeometry, style = STYLE) =>
  tablePieces(g, style).map((p) => ({ rows: p.rows, offset: [r4(p.offset.x), r4(p.offset.y)] }));

const textsAt = (parts: readonly TablePart[]) =>
  parts.flatMap((p) =>
    p.geom.kind === 'MTEXT'
      ? [[p.geom.contents, r4(p.geom.position.x), r4(p.geom.position.y)] as const]
      : [],
  );

describe('table breaks (M4-16 part 10)', () => {
  it('is drawn whole while its breaks are off', () => {
    expect(pieces(table())).toEqual([{ rows: [0, 1, 2, 3, 4, 5, 6, 7], offset: [0, 0] }]);
    expect(pieces(table({ enabled: false }))).toEqual([
      { rows: [0, 1, 2, 3, 4, 5, 6, 7], offset: [0, 0] },
    ]);
    expect(tableParts(table({ enabled: false }), STYLE, { textStyle: 'T' })).toEqual(
      tableParts(table(), STYLE, { textStyle: 'T' }),
    );
  });

  it('breaks into parts no higher than the break height, to the right, spacing apart', () => {
    expect(pieces(table())).toHaveLength(1);
    expect(pieces(table({}))).toEqual([
      { rows: [0, 1, 2, 3], offset: [0, 0] },
      { rows: [4, 5, 6, 7], offset: [5.5, 0] },
    ]);
    expect(pieces(table({ height: 3 }))).toEqual([
      { rows: [0, 1, 2], offset: [0, 0] },
      { rows: [3, 4, 5], offset: [5.5, 0] },
      { rows: [6, 7], offset: [11, 0] },
    ]);
  });

  it('repeats the title and header rows at the top of each part', () => {
    expect(pieces(table({ repeatTop: true }))).toEqual([
      { rows: [0, 1, 2, 3], offset: [0, 0] },
      { rows: [0, 1, 4, 5], offset: [5.5, 0] },
      { rows: [0, 1, 6, 7], offset: [11, 0] },
    ]);
    // Repeat bottom labels is for a table that flows up, whose labels are at the bottom.
    expect(pieces(table({ repeatBottom: true }))).toHaveLength(2);
    expect(pieces(table({ repeatBottom: true }), UP)).toHaveLength(3);
  });

  it('holds a row besides the labels however low the break height', () => {
    expect(pieces(table({ repeatTop: true, height: 0.5 })).map((p) => p.rows)).toEqual(
      [2, 3, 4, 5, 6, 7].map((r) => [0, 1, r]),
    );
  });

  it('keeps a merged cell whole in one part', () => {
    const g = table({ height: 3 });
    const cells = g.cells.map((row) => [...row]);
    cells[2]![0] = cell('N1', { rowSpan: 2 });
    cells[3]![0] = cell('', { merged: true });
    expect(pieces({ ...g, cells }).map((p) => p.rows)).toEqual([
      [0, 1],
      [2, 3, 4],
      [5, 6, 7],
    ]);
  });

  it('lays parts out to the left or down', () => {
    expect(pieces(table({ direction: 'left' }))[1]!.offset).toEqual([-5.5, 0]);
    expect(pieces(table({ direction: 'down', height: 3 })).map((p) => p.offset)).toEqual([
      [0, 0],
      [0, -3.5],
      [0, -7],
    ]);
    // Flowing up, a part's origin is its bottom: the next part lies below the first.
    expect(pieces(table({ direction: 'down', height: 3 }), UP).map((p) => p.offset)).toEqual([
      [0, 0],
      [0, -3.5],
      [0, -6],
    ]);
  });

  it('takes each part’s own height and place when manual', () => {
    const parts = [null, { height: 2, offset: { x: 1, y: -20 } }];
    expect(pieces(table({ parts }))[1]).toEqual({ rows: [4, 5, 6, 7], offset: [5.5, 0] });
    expect(pieces(table({ parts, manualHeights: true })).map((p) => p.rows)).toEqual([
      [0, 1, 2, 3],
      [4, 5],
      [6, 7],
    ]);
    expect(pieces(table({ parts, manualPositions: true }))[1]!.offset).toEqual([1, -20]);
  });

  it('draws each part’s rows at its place, its labels repeated', () => {
    const parts = tableParts(table({ repeatTop: true }), STYLE, { textStyle: 'T' });
    const texts = textsAt(parts);
    expect(texts.filter(([t]) => t === 'Schedule').map(([, x]) => x)).toEqual([2.5, 8, 13.5]);
    const n3 = texts.find(([t]) => t === 'N3')!;
    const n1 = texts.find(([t]) => t === 'N1')!;
    expect([n3[1] - n1[1], n3[2]]).toEqual([5.5, n1[2]]);
    expect(parts.filter((p) => p.defpoint)).toHaveLength(1);
    // Every part is framed: the second's left edge at x 5.5.
    expect(
      parts.some(
        (p) => p.geom.kind === 'LINE' && r4(p.geom.start.x) === 5.5 && r4(p.geom.end.x) === 5.5,
      ),
    ).toBe(true);
  });

  it('finds and boxes a cell in the part it is drawn in', () => {
    const g = table({ repeatTop: true });
    expect(tableCellAt(g, STYLE, { x: 6, y: -2.5 })).toEqual([4, 0]);
    expect(tableCellAt(g, STYLE, { x: 6, y: -0.5 })).toEqual([0, 0]);
    expect(tableCellAt(g, STYLE, { x: 5.2, y: -2.5 })).toBeUndefined();
    expect(tableCellBox(g, STYLE, { r0: 4, c0: 0, r1: 5, c1: 1 })).toEqual({
      minX: 5.5,
      maxX: 10.5,
      minY: -4,
      maxY: -2,
    });
  });

  it('shows a breaking grip at the foot of each part, and none for the height', () => {
    const whole = tableGrips(table(), STYLE).map((g) => g.role.kind);
    expect(whole).toEqual(['width', 'height', 'size', 'break', 'column']);
    const grips = tableGrips(table({ repeatTop: true, manualPositions: true }), STYLE);
    expect(grips.map((g) => g.role)).toEqual([
      { kind: 'width' },
      { kind: 'break', part: 0 },
      { kind: 'break', part: 1 },
      { kind: 'part', part: 1 },
      { kind: 'break', part: 2 },
      { kind: 'part', part: 2 },
      { kind: 'column', k: 1 },
    ]);
    expect(grips[2]!.point).toEqual({ x: 8, y: -4 });
    expect(grips[2]!.towards).toEqual({ x: 0, y: -1 });
  });

  it('the breaking grip enables breaks at the height it is dragged to', () => {
    const moved = movedTableGrip(table(), STYLE, { kind: 'break', part: 0 }, { x: 0, y: 4.2 })!;
    expect(moved.breaks).toMatchObject({ enabled: true, height: 3.8 });
    expect(pieces(moved).map((p) => p.rows)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7],
    ]);
    // Never lower than a row.
    const low = movedTableGrip(table(), STYLE, { kind: 'break', part: 0 }, { x: 0, y: 20 })!;
    expect(low.breaks?.height).toBe(1);
  });

  it('a part’s grips set its own height and place when manual', () => {
    const g = table({ manualHeights: true, manualPositions: true });
    const h = movedTableGrip(g, STYLE, { kind: 'break', part: 1 }, { x: 0, y: 2 })!;
    expect(h.breaks?.height).toBe(4);
    expect(h.breaks?.parts?.[1]).toEqual({ height: 2 });
    const p = movedTableGrip(g, STYLE, { kind: 'part', part: 1 }, { x: 1, y: 1 })!;
    expect(p.breaks?.parts?.[1]).toEqual({ offset: { x: 6.5, y: 1 } });
  });

  it('scales its break height, spacing and parts with the table', () => {
    const g = table({ parts: [null, { height: 2, offset: { x: 1, y: 2 } }] });
    expect(tableTextScaled(g, STYLE, 2).breaks).toMatchObject({
      height: 8,
      spacing: 1,
      parts: [null, { height: 4, offset: { x: 2, y: 4 } }],
    });
  });
});

describe('Table Breaks rows in the Properties palette (M4-16 part 10)', () => {
  const setup = () => {
    const base = sampleInit();
    const init: DocumentInit = {
      ...base,
      tables: { ...base.tables, tableStyles: [{ ...STYLE, handle: '7D0' }] },
      entities: [entityInit('7D1', table(undefined, { style: '7D0' }))],
    };
    const model = DocumentModel.create(init);
    const bus = new PromptBus({ model, registry: builtinCommands() });
    const geom = () => model.entityByHandle('7D1')!.geom as TableGeometry;
    const rows = () =>
      propertySheet(model, [model.entityByHandle('7D1')!.id]).sections.find(
        (x) => x.title === 'Table Breaks',
      )?.rows ?? [];
    const set = async (key: string, value: string) => {
      await bus.selectAll();
      return bus.setProperty({ key, value });
    };
    return { model, geom, rows, set };
  };

  it('shows AutoCAD’s rows, from the grip’s defaults for a table without breaks', () => {
    const s = setup();
    expect(s.rows().map((r) => [r.label, r.value])).toEqual([
      ['Enabled', 'no'],
      ['Direction', 'right'],
      ['Repeat top labels', 'no'],
      ['Repeat bottom labels', 'no'],
      ['Manual positions', 'no'],
      ['Manual heights', 'no'],
      ['Break height', 8],
      ['Spacing', 1],
    ]);
  });

  it('sets the breaks and draws the table again in parts', async () => {
    const s = setup();
    await s.set('breaksHeight', '0');
    await s.set('breaksSpacing', '-1');
    expect(s.geom().breaks).toBeUndefined();
    await s.set('breaksEnabled', 'yes');
    await s.set('breaksHeight', '4');
    await s.set('breaksRepeatTop', 'yes');
    await s.set('breaksDirection', 'down');
    const g = s.geom();
    expect(g.breaks).toMatchObject({
      enabled: true,
      height: 4,
      repeatTop: true,
      direction: 'down',
    });
    expect(tablePieces(g, STYLE)).toHaveLength(3);
    // The block draws all three parts: the title three times.
    const titles = s.model
      .blockEntities(g.block!)
      .map((id) => s.model.entity(id)!.geom)
      .filter((x) => x.kind === 'MTEXT' && x.contents === 'Schedule');
    expect(titles).toHaveLength(3);
  });
});
