// M2-35 part 8: a polyline's vertex navigation in the Properties palette, as AutoCAD 2024's
// Geometry group shows it for one polyline: Vertex (a spinner, 1 to the vertex count), Vertex X
// and Vertex Y, and the Start and End segment width of the segment leaving it; and Misc's
// Linetype generation (PLINEGEN, DXF 70 bit 128).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  EngineSession,
  PromptBus,
  builtinCommands,
  propertySheet,
  type BusEvent,
  type CommandOutput,
  type DocumentInit,
  type Entity,
  type EntityGeometry,
  type PropertyRow,
  type PropertySheet,
} from '../../src/index';
import { entityInit, sampleInit } from '../model/fixtures';

type Polyline = Extract<EntityGeometry, { kind: 'LWPOLYLINE' }>;

const square = (over: Partial<Polyline> = {}): Polyline =>
  ({
    kind: 'LWPOLYLINE',
    closed: true,
    vertices: [
      { x: 0, y: 0, bulge: 0 },
      { x: 10, y: 0, bulge: 0 },
      { x: 10, y: 10, bulge: 0.5 },
      { x: 0, y: 10, bulge: 0 },
    ],
    ...over,
  }) as Polyline;

function init(extra: NonNullable<DocumentInit['entities']>): DocumentInit {
  const base = sampleInit();
  return { ...base, entities: extra };
}

function setup(i: DocumentInit) {
  const model = DocumentModel.create(i);
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: { request: () => Promise.resolve({ ok: true }) },
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const byHandle = (h: string): Entity => model.entityByHandle(h)!;
  const ids = (...hs: string[]) => hs.map((h) => byHandle(h).id);
  const geom = (h: string) => byHandle(h).geom as Polyline;
  return { model, bus, log, byHandle, ids, geom };
}

const rows = (sheet: PropertySheet): PropertyRow[] => sheet.sections.flatMap((s) => s.rows);
const rowOf = (sheet: PropertySheet, label: string): PropertyRow => {
  const r = rows(sheet).find((x) => x.label === label);
  if (!r) throw new Error(`no row ${label}`);
  return r;
};

describe('a polyline’s vertex rows (M2-35 part 8)', () => {
  it('shows one polyline’s current vertex, first by default', () => {
    const s = setup(init([entityInit('66', square())]));
    const sheet = propertySheet(s.model, s.ids('66'));
    const geometry = sheet.sections.find((x) => x.title === 'Geometry')!;
    // AutoCAD 2024's order: the vertex rows, then Global width, Elevation, Length, Area.
    expect(geometry.rows.map((r) => r.label)).toEqual([
      'Vertex',
      'Vertex X',
      'Vertex Y',
      'Start segment width',
      'End segment width',
      'Global width',
      'Elevation',
      'Length',
      'Area',
    ]);
    expect(rowOf(sheet, 'Vertex')).toMatchObject({
      key: 'vertex',
      kind: 'number',
      value: 1,
      spin: { min: 1, max: 4 },
    });
    expect(rowOf(sheet, 'Vertex X')).toMatchObject({ kind: 'distance', value: 0 });
    expect(rowOf(sheet, 'Start segment width')).toMatchObject({ kind: 'distance', value: 0 });
  });

  it('shows the vertex asked for, kept within the polyline', () => {
    const s = setup(
      init([
        entityInit(
          '66',
          square({
            vertices: [
              { x: 0, y: 0, bulge: 0 },
              { x: 10, y: 0, bulge: 0 },
              { x: 10, y: 10, bulge: 0, startWidth: 0.5, endWidth: 1 },
            ],
          }),
        ),
      ]),
    );
    const third = propertySheet(s.model, s.ids('66'), undefined, 2);
    expect(rowOf(third, 'Vertex').value).toBe(3);
    expect(rowOf(third, 'Vertex X').value).toBe(10);
    expect(rowOf(third, 'Vertex Y').value).toBe(10);
    expect(rowOf(third, 'Start segment width').value).toBe(0.5);
    expect(rowOf(third, 'End segment width').value).toBe(1);
    // Row keys name their vertex, so an edit reaches the vertex the sheet showed.
    expect(rowOf(third, 'Vertex X').key).toBe('vertex:2:x');
    expect(rowOf(propertySheet(s.model, s.ids('66'), undefined, 9), 'Vertex').value).toBe(3);
    expect(rowOf(propertySheet(s.model, s.ids('66'), undefined, -1), 'Vertex').value).toBe(1);
  });

  it('shows a constant-width polyline’s segments at that width', () => {
    const s = setup(init([entityInit('66', square({ constantWidth: 0.25 }))]));
    const sheet = propertySheet(s.model, s.ids('66'), undefined, 1);
    expect(rowOf(sheet, 'Start segment width').value).toBe(0.25);
    expect(rowOf(sheet, 'End segment width').value).toBe(0.25);
  });

  it('leaves the vertex rows out for several polylines', () => {
    // AutoCAD's help does not say what Vertex shows for several polylines; one vertex number
    // naming a different point on each is no use to a drafter, so the rows are left out.
    const s = setup(init([entityInit('66', square()), entityInit('67', square())]));
    const labels = rows(propertySheet(s.model, s.ids('66', '67'))).map((r) => r.label);
    expect(labels).not.toContain('Vertex');
    expect(labels).toContain('Global width');
  });

  it('moves the vertex shown, its bulge kept, as one undo step', async () => {
    const s = setup(init([entityInit('66', square())]));
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'vertex:2:x', value: '12' }, 'LWPOLYLINE');
    await s.bus.setProperty({ key: 'vertex:2:y', value: '14' }, 'LWPOLYLINE');
    expect(s.geom('66').vertices[2]).toEqual({ x: 12, y: 14, bulge: 0.5 });
    expect(s.geom('66').vertices[1]).toEqual({ x: 10, y: 0, bulge: 0 });
    await s.bus.submit('U');
    expect(s.geom('66').vertices[2]).toEqual({ x: 12, y: 10, bulge: 0.5 });
  });

  it('reads a vertex coordinate in the drawing’s units', async () => {
    const i = init([entityInit('66', square())]);
    const s = setup({ ...i, header: [...(i.header ?? []), ['$LUNITS', 4]] });
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'vertex:1:x', value: `1'6"` }, 'LWPOLYLINE');
    expect(s.geom('66').vertices[1]!.x).toBe(18);
  });

  it('sets the widths of the segment leaving the vertex shown', async () => {
    const s = setup(init([entityInit('66', square({ constantWidth: 0.25 }))]));
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'vertex:1:startWidth', value: '1' }, 'LWPOLYLINE');
    const g = s.geom('66');
    // The constant width becomes each vertex's own, the one segment changed.
    expect(g.constantWidth).toBeUndefined();
    expect(g.vertices.map((v) => [v.startWidth, v.endWidth])).toEqual([
      [0.25, 0.25],
      [1, 0.25],
      [0.25, 0.25],
      [0.25, 0.25],
    ]);
    await s.bus.setProperty({ key: 'vertex:1:endWidth', value: '0' }, 'LWPOLYLINE');
    expect(s.geom('66').vertices[1]).toMatchObject({ startWidth: 1, endWidth: 0 });
    expect(rowOf(propertySheet(s.model, s.ids('66')), 'Global width').varies).toBe(true);
  });

  it('refuses a negative width and a vertex the polyline no longer has', async () => {
    const s = setup(init([entityInit('66', square())]));
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'vertex:1:startWidth', value: '-1' }, 'LWPOLYLINE');
    expect(s.log.at(-1)).toBe('Invalid input.');
    await s.bus.setProperty({ key: 'vertex:7:x', value: '1' }, 'LWPOLYLINE');
    expect(s.log.at(-1)).toBe('Invalid input.');
    await s.bus.setProperty({ key: 'vertex:1:x', value: 'abc' }, 'LWPOLYLINE');
    expect(s.log.at(-1)).toBe('Invalid input.');
    expect(s.geom('66')).toEqual(square());
  });
});

describe('a polyline’s Linetype generation (M2-35 part 8)', () => {
  it('shows and sets PLINEGEN', async () => {
    const s = setup(
      init([entityInit('66', square()), entityInit('67', square({ plinegen: true }))]),
    );
    const gen = () => rowOf(propertySheet(s.model, s.ids('66', '67')), 'Linetype generation');
    expect(gen()).toMatchObject({ kind: 'choice', varies: true });
    expect(gen().options?.map((o) => o.label)).toEqual(['Enabled', 'Disabled']);
    expect(rowOf(propertySheet(s.model, s.ids('67')), 'Linetype generation').value).toBe('yes');
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'plinegen', value: 'yes' }, 'LWPOLYLINE');
    expect(s.geom('66').plinegen).toBe(true);
    await s.bus.setProperty({ key: 'plinegen', value: 'no' }, 'LWPOLYLINE');
    expect(s.geom('67').plinegen).toBe(false);
  });
});

describe('the session’s current vertex (M2-35 part 8)', () => {
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('steps the vertex shown, back to the first for another selection', async () => {
    const out: CommandOutput[] = [];
    const se = new EngineSession(init([entityInit('66', square())]));
    se.onCommand((o) => out.push(o));
    const sheets = () =>
      out.filter(
        (o): o is Extract<CommandOutput, { type: 'properties' }> => o.type === 'properties',
      );
    const last = () => sheets().at(-1)!.sheet;
    // Nothing is sent while the palette is closed.
    await se.command({ kind: 'property-vertex', vertex: 1 });
    expect(sheets()).toHaveLength(0);
    await se.command({ kind: 'properties', open: true });
    await se.command({ kind: 'select-all' });
    await flush();
    expect(last().count).toBe(1);
    expect(rowOf(last(), 'Vertex').value).toBe(1);
    await se.command({ kind: 'property-vertex', vertex: 2 });
    expect(rowOf(last(), 'Vertex').value).toBe(3);
    expect(rowOf(last(), 'Vertex Y').value).toBe(10);
    // An edit keeps the vertex shown.
    await se.command({ kind: 'property', edit: { key: 'vertex:2:y', value: '11' } });
    await flush();
    expect(rowOf(last(), 'Vertex').value).toBe(3);
    expect(rowOf(last(), 'Vertex Y').value).toBe(11);
    // Another selection starts at the first vertex again.
    await se.command({ kind: 'cancel' });
    await flush();
    await se.command({ kind: 'select-all' });
    await flush();
    expect(rowOf(last(), 'Vertex').value).toBe(1);
  });
});
