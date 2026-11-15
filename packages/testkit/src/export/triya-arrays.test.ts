// Associative arrays Triya makes (M3-11, DEC-059). Acceptance: an array made, saved, reopened
// and edited with ARRAYEDIT. The array is saved as AutoCAD saves the visible part of one (an
// INSERT of an anonymous block of item INSERTs of an anonymous source block), with its definition
// in a TRIYA_ARRAY XRECORD in the INSERT's extension dictionary; a save of the reopened drawing
// that changes nothing has no structural difference. The drawing is authored here (DEC-047): a
// circle r 1 at the origin and a line (0,10)-(20,10), the path.
import {
  ACadVersion,
  CadDictionary,
  CadDocument,
  Circle,
  Insert,
  Line,
  XRecord,
  XYZ,
} from '@node-projects/acad-ts';
import {
  DocumentModel,
  PromptBus,
  assocArrayOf,
  builtinCommands,
  isAssocArray,
  type AssocArray,
  type Entity,
  type EntityId,
  type ViewHost,
  type ViewReply,
} from '@triya/engine';
import { documentInit, mapTriyaArrays, readCadDocument, writeCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { roundTrip } from '../roundtrip/roundtrip.ts';
import { assocArrayDrawing } from '../roundtrip/assoc-array-drawing.ts';

function authored(): { bytes: Uint8Array; circle: string; path: string } {
  const doc = new CadDocument(ACadVersion.AC1032);
  const circle = new Circle();
  circle.center = new XYZ(0, 0, 0);
  circle.radius = 1;
  doc.entities!.add(circle);
  const path = new Line(new XYZ(0, 10, 0), new XYZ(20, 10, 0));
  doc.entities!.add(path);
  const hex = (n: number) => n.toString(16).toUpperCase();
  return {
    bytes: writeCadDocument(doc, { format: 'dxf' }),
    circle: hex(circle.handle),
    path: hex(path.handle),
  };
}

const source = authored();

/** A drawing open in the engine, its command line driven as the tests type into it. */
function open(bytes: Uint8Array) {
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  let picks: EntityId[] = [];
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'pick') return Promise.resolve({ ok: true, ids: picks });
      if (r.op === 'sysvar') return Promise.resolve({ ok: true, value: 1 });
      return Promise.resolve({ ok: false, message: 'no' });
    },
  };
  const space = [...model.blocks.values()].find((b) => /^\*model_space$/i.test(b.name))!.handle;
  const bus = new PromptBus({ model, registry: builtinCommands(), view, space: () => space });
  const log: string[] = [];
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
  });
  const pick = (...handles: string[]) => {
    picks = handles.map((h) => model.entityByHandle(h)!.id);
  };
  const arrays = (): Entity[] =>
    model
      .blockEntities(space)
      .map((id) => model.entity(id)!)
      .filter((e) => assocArrayOf(model.objects.values(), e));
  const record = (): AssocArray => assocArrayOf(model.objects.values(), arrays()[0])!;
  const save = (): Uint8Array =>
    withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
  return { model, bus, log, pick, arrays, record, save };
}

/** The record's groups as the file holds them: code and value (handles as numbers). */
function groups(bytes: Uint8Array): [number, unknown][] {
  const doc = readCadDocument(bytes);
  const records = [...doc.getCadObjects()].filter((o) => o instanceof XRecord) as XRecord[];
  const x = records.find((o) => {
    const d = o.owner;
    return (
      d instanceof CadDictionary && d.owner instanceof Insert && d.getEntry('TRIYA_ARRAY') === o
    );
  })!;
  return x.entries.map((e) => {
    const v = e.value as { handle?: number; x?: number; y?: number } | number | boolean;
    if (typeof v === 'object' && v !== null && 'handle' in v) return [e.code, v.handle];
    if (typeof v === 'object' && v !== null && 'x' in v) return [e.code, [v.x, v.y]];
    return [e.code, v];
  });
}

describe('associative arrays Triya makes', () => {
  it('are made, saved, reopened and edited with ARRAYEDIT', async () => {
    const a = open(source.bytes);
    a.pick(source.circle);
    await a.bus.script(['ARRAYRECT', '0,0', '', '']);
    const made = a.record();
    const saved = a.save();

    // The record as DEC-059 lays it out: version, type, source block, the four parameters.
    expect(groups(saved)).toEqual([
      [70, 1],
      [71, 0],
      [340, Number.parseInt(made.source, 16)],
      [90, 4],
      [91, 3],
      [40, 3],
      [41, 3],
    ]);

    const b = open(saved);
    const [array] = b.arrays();
    expect(array).toBeDefined();
    expect(b.record()).toMatchObject({ params: made.params, source: made.source });
    expect(array!.handle).toBe(a.arrays()[0]!.handle);
    // Saved again unchanged, the drawing has no structural difference.
    const r = roundTrip(saved);
    expect(r.status, JSON.stringify(r.sample)).toBe('clean');

    b.pick(array!.handle);
    await b.bus.script(['ARRAYEDIT', '0,0', 'C', '2', '5', 'R', '1', '', '']);
    expect(b.bus.command).toBeUndefined();
    const edited = b.save();
    const c = open(edited);
    expect(c.record().params).toEqual({
      kind: 'rectangular',
      columns: 2,
      rows: 1,
      columnSpacing: 5,
      rowSpacing: 3,
    });
    const block = (c.arrays()[0]!.geom as { block: string }).block;
    expect(c.model.blockEntities(block)).toHaveLength(2);
    expect(groups(edited).slice(3)).toEqual([
      [90, 2],
      [91, 1],
      [40, 5],
      [41, 3],
    ]);
  });

  it('keep a polar and a path array through a save, and a copy is an array of its own', async () => {
    const a = open(source.bytes);
    a.pick(source.circle);
    await a.bus.script(['ARRAYPOLAR', '0,0', '', '0,-5', 'I', '4', 'F', '-180', 'ROT', 'N', '']);
    const polar = a.record();
    a.pick(a.arrays()[0]!.handle);
    await a.bus.script(['COPY', '0,0', '', '0,0', '50,0', '']);
    expect(a.arrays()).toHaveLength(2);
    const b = open(a.save());
    const kept = [...b.model.objects.values()].filter(isAssocArray);
    expect(kept.map((r) => r.params)).toEqual([polar.params, polar.params]);
    expect(new Set(kept.map((r) => r.source)).size).toBe(2);

    const p = open(source.bytes);
    p.pick(source.circle);
    await p.bus.script(['ARRAYPATH', '0,0', '']);
    p.pick(source.path);
    await p.bus.script(['20,10', 'B', '0,0', 'M', 'D', 'I', '3', 'A', 'N', '']);
    const path = p.record();
    const saved = p.save();
    expect(open(saved).record().params).toEqual(path.params);
    expect(groups(saved)).toContainEqual([331, Number.parseInt(source.path, 16)]);
    expect(groups(saved)).toContainEqual([291, true]);
  });

  it('take their record with them when erased, and stop following an erased path', async () => {
    const a = open(source.bytes);
    a.pick(source.circle);
    await a.bus.script(['ARRAYPATH', '0,0', '']);
    a.pick(source.path);
    await a.bus.script(['0,10', '']);
    a.pick(source.path);
    await a.bus.script(['ERASE', '0,0', '']);
    const b = open(a.save());
    expect(b.record().params).not.toHaveProperty('path');
    b.pick(b.arrays()[0]!.handle);
    await b.bus.script(['ERASE', '0,0', '']);
    const c = open(b.save());
    expect([...c.model.objects.values()].filter(isAssocArray)).toEqual([]);
    expect(mapTriyaArrays(readCadDocument(b.save()))).toEqual([]);
  });

  it('leave a record Triya cannot read a plain block reference, kept as read', async () => {
    const a = open(source.bytes);
    a.pick(source.circle);
    await a.bus.script(['ARRAYRECT', '0,0', '', '']);
    // The same record stating a layout version Triya does not know.
    const text = new TextDecoder().decode(a.save());
    const version2 = text.replace(/(AcDbXrecord\r?\n\s*280\r?\n\s*1\r?\n\s*70\r?\n\s*)1/, '$12');
    expect(version2).not.toBe(text);
    const bytes = new TextEncoder().encode(version2);
    const b = open(bytes);
    expect(b.arrays()).toEqual([]);
    const r = roundTrip(bytes);
    expect(r.status, JSON.stringify(r.sample)).toBe('clean');
  });

  it('ARRAYEDIT refuses an array made in AutoCAD, whose parameters are undocumented', async () => {
    const drawing = assocArrayDrawing();
    const a = open(drawing.bytes);
    a.pick(drawing.insert);
    await a.bus.script(['ARRAYEDIT', '0,0']);
    expect(a.log.at(-1)).toBe(
      'Triya cannot edit this array: it was not made in Triya, and its parameters are not documented.',
    );
  });
});
