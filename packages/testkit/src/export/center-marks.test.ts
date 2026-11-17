// Center marks and centerlines (M4-08). Each is saved as AutoCAD saves the visible part of one:
// an INSERT of an anonymous block of lines, which every reader draws. The record that keeps it
// associative is a `TRIYA_CENTERMARK` XRECORD in the INSERT's extension dictionary (part 2,
// DEC-066, the owner's option A on #451), so a reopened mark still follows its objects.
// The drawing is authored here (DEC-047): a circle r 10 at (50,50) and two parallel lines.
import type { BlockRecord } from '@node-projects/acad-ts';
import {
  ACadVersion,
  CadDictionary,
  CadDocument,
  Circle,
  Insert,
  Line,
  LwPolyline,
  LwPolylineVertex,
  XRecord,
  XY,
  XYZ,
} from '@node-projects/acad-ts';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  centerMarkOf,
  isCenterMark,
  type Entity,
  type EntityId,
  type ViewHost,
  type ViewReply,
} from '@triya/engine';
import { documentInit, readCadDocument, writeCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { roundTrip } from '../roundtrip/roundtrip.ts';

function authored(): { bytes: Uint8Array; circle: string; lines: [string, string] } {
  const doc = new CadDocument(ACadVersion.AC1032);
  const circle = new Circle();
  circle.center = new XYZ(50, 50, 0);
  circle.radius = 10;
  const a = new Line(new XYZ(0, 100, 0), new XYZ(20, 100, 0));
  const b = new Line(new XYZ(0, 110, 0), new XYZ(20, 110, 0));
  for (const e of [circle, a, b]) doc.entities!.add(e);
  const hex = (h: number) => h.toString(16).toUpperCase();
  return {
    bytes: writeCadDocument(doc, { format: 'dxf' }),
    circle: hex(circle.handle),
    lines: [hex(a.handle), hex(b.handle)],
  };
}

const source = authored();

/**
 * M4-29: a polyline (0,300)-(20,300), an arc out to (25,305) back to (20,310), then to (0,310),
 * and the line (0,100)-(20,100).
 */
function authoredPolyline(): { bytes: Uint8Array; polyline: string; line: string } {
  const doc = new CadDocument(ACadVersion.AC1032);
  const vertex = (x: number, y: number, bulge = 0) => {
    const v = new LwPolylineVertex(new XY(x, y));
    v.bulge = bulge;
    return v;
  };
  const pl = new LwPolyline([vertex(0, 300), vertex(20, 300, 1), vertex(20, 310), vertex(0, 310)]);
  const line = new Line(new XYZ(0, 100, 0), new XYZ(20, 100, 0));
  for (const e of [pl, line]) doc.entities!.add(e);
  const hex = (h: number) => h.toString(16).toUpperCase();
  return {
    bytes: writeCadDocument(doc, { format: 'dxf' }),
    polyline: hex(pl.handle),
    line: hex(line.handle),
  };
}

function open(bytes: Uint8Array) {
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  let picks: EntityId[][] = [];
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'pick') return Promise.resolve({ ok: true, ids: picks.shift() ?? [] });
      return Promise.resolve({ ok: false, message: 'no' });
    },
  };
  const space = [...model.blocks.values()].find((b) => /^\*model_space$/i.test(b.name))!.handle;
  const bus = new PromptBus({ model, registry: builtinCommands(), view, space: () => space });
  const pickIds = (...ids: EntityId[]) => {
    picks = ids.map((id) => [id]);
  };
  /** The next picks, one object each. */
  const pick = (...handles: string[]) => {
    picks = handles.map((h) => [model.entityByHandle(h)!.id]);
  };
  const inserts = (): Entity[] =>
    model
      .blockEntities(space)
      .map((id) => model.entity(id)!)
      .filter((e) => e.geom.kind === 'INSERT');
  const save = (): Uint8Array =>
    withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
  return { model, bus, pick, pickIds, inserts, save };
}

/** The center-mark record in `insert`'s extension dictionary, as its groups. */
function recordGroups(insert: Insert): { code: number; value: unknown }[] | undefined {
  const dict = insert.xDictionary;
  if (!(dict instanceof CadDictionary)) return undefined;
  const x = dict.getEntry('TRIYA_CENTERMARK');
  return x instanceof XRecord
    ? x.entries.map((e) => ({ code: e.code, value: e.value }))
    : undefined;
}

const savedInserts = (bytes: Uint8Array): Insert[] =>
  [...readCadDocument(bytes).getCadObjects()].filter((o): o is Insert => o instanceof Insert);

/** A handle group's value as a hex handle. */
const handleOf = (v: unknown): string =>
  (typeof v === 'number' ? v : (v as { handle: number }).handle).toString(16).toUpperCase();

async function marked() {
  const a = open(source.bytes);
  a.pick(source.circle);
  await a.bus.script(['CENTERMARK', '0,0', '']);
  a.pick(...source.lines);
  await a.bus.script(['CENTERLINE', '0,0', '0,0']);
  expect(a.bus.command).toBeUndefined();
  return a;
}

describe('center marks and centerlines', () => {
  it('save as block references of anonymous blocks of lines with a TRIYA_CENTERMARK record', async () => {
    const a = await marked();
    const made = a.inserts();
    expect(made).toHaveLength(2);
    expect(made.every((e) => centerMarkOf(a.model, e) !== undefined)).toBe(true);
    const saved = a.save();

    const inserts = savedInserts(saved);
    expect(inserts).toHaveLength(2);
    const lineCounts = inserts.map((i) => {
      const block = i.block as BlockRecord;
      expect(block.name).toMatch(/^\*U\d+$/);
      return [...block.entities].filter((e) => e instanceof Line).length;
    });
    expect(lineCounts.sort()).toEqual([1, 6]);
    expect(inserts.map((i) => [i.insertPoint.x, i.insertPoint.y]).sort()).toEqual([
      [10, 105],
      [50, 50],
    ]);
    const mark = inserts.find((i) => i.insertPoint.x === 50)!;
    const line = inserts.find((i) => i.insertPoint.x === 10)!;
    // DEC-066: 70 version, 71 kind, 331 the objects, 1/3 cross size and gap, 40-43 extensions,
    // 290 show extensions.
    const m = recordGroups(mark)!;
    expect(m.map((g) => g.code)).toEqual([70, 71, 331, 1, 3, 40, 41, 42, 43, 290]);
    expect(m[0]!.value).toBe(1);
    expect(m[1]!.value).toBe(0);
    expect(handleOf(m[2]!.value)).toBe(source.circle);
    expect(m.slice(3).map((g) => g.value)).toEqual(['0.1x', '0.05x', 3.5, 3.5, 3.5, 3.5, true]);
    const l = recordGroups(line)!;
    expect(l.map((g) => g.code)).toEqual([70, 71, 331, 331, 40, 41]);
    expect(l[1]!.value).toBe(1);
    expect([handleOf(l[2]!.value), handleOf(l[3]!.value)]).toEqual(source.lines);
    // The dictionary is the INSERT's own, hard owner as AutoCAD makes one.
    expect((mark.xDictionary as CadDictionary).hardOwnerFlag).toBe(true);

    // Reopened, they are associative still; saved again unchanged, no structural difference.
    const b = open(saved);
    expect(b.inserts()).toHaveLength(2);
    const records = [...b.model.objects.values()].filter(isCenterMark);
    expect(records.map((r) => r.kind).sort()).toEqual(['line', 'mark']);
    const reopened = records.find((r) => r.kind === 'mark')!;
    expect(reopened).toMatchObject({
      objects: [source.circle],
      crossSize: '0.1x',
      crossGap: '0.05x',
      extensions: [3.5, 3.5, 3.5, 3.5],
      showExtensions: true,
    });
    expect(records.find((r) => r.kind === 'line')).toMatchObject({
      objects: source.lines,
      extensions: [3.5, 3.5],
    });
    const r = roundTrip(saved);
    expect(r.status, JSON.stringify(r.sample)).toBe('clean');
  });

  it('follow their objects after a reopen, and save where they moved to', async () => {
    const saved = (await marked()).save();
    const b = open(saved);
    b.pick(source.circle);
    await b.bus.script(['MOVE', '0,0', '', '0,0', '5,5']);
    b.pick(source.lines[0]);
    await b.bus.script(['MOVE', '0,0', '', '0,0', '0,-10']);
    const again = savedInserts(b.save());
    expect(again.map((i) => [i.insertPoint.x, i.insertPoint.y]).sort()).toEqual([
      [10, 100],
      [55, 55],
    ]);
    expect(again.every((i) => recordGroups(i) !== undefined)).toBe(true);
  });

  it('save where the circle moved them to', async () => {
    const a = open(source.bytes);
    a.pick(source.circle);
    await a.bus.script(['CENTERMARK', '0,0', '']);
    a.pick(source.circle);
    await a.bus.script(['MOVE', '0,0', '', '0,0', '5,5']);
    const [mark] = savedInserts(a.save());
    expect([mark!.insertPoint.x, mark!.insertPoint.y]).toEqual([55, 55]);
  });

  it('a mark moved on its own saves as a plain block reference, its record left out', async () => {
    // Made and let go in one session: the mark keeps an empty extension dictionary.
    const a = await marked();
    const mark = a.inserts().find((e) => e.geom.kind === 'INSERT' && e.geom.position.x === 50)!;
    a.pickIds(mark.id);
    await a.bus.script(['MOVE', '0,0', '', '0,0', '0,30']);
    const saved = a.save();
    const fresh = savedInserts(saved).find((i) => i.insertPoint.x === 50)!;
    expect(fresh.insertPoint.y).toBe(80);
    expect(recordGroups(fresh)).toBeUndefined();
    expect(roundTrip(saved).status).toBe('clean');
    // Saved, reopened and let go: the record leaves the dictionary.
    const b = open((await marked()).save());
    const old = b.inserts().find((e) => e.geom.kind === 'INSERT' && e.geom.position.x === 50)!;
    b.pickIds(old.id);
    await b.bus.script(['MOVE', '0,0', '', '0,0', '0,30']);
    const after = savedInserts(b.save());
    expect(after.filter((i) => recordGroups(i) !== undefined)).toHaveLength(1);
  });

  it('an erased mark takes its record with it; a copy saves a record of its own', async () => {
    const b = open((await marked()).save());
    const mark = b.inserts().find((e) => e.geom.kind === 'INSERT' && e.geom.position.x === 50)!;
    b.pickIds(b.model.entityByHandle(source.circle)!.id, mark.id);
    await b.bus.script(['COPY', '0,0', '0,0', '', '0,0', '0,-100', '']);
    b.pick(...source.lines);
    await b.bus.script(['ERASE', '0,0', '0,0', '']);
    const doc = readCadDocument(b.save());
    const inserts = [...doc.getCadObjects()].filter((o): o is Insert => o instanceof Insert);
    expect(inserts.map((i) => [i.insertPoint.x, i.insertPoint.y]).sort()).toEqual([
      [50, -50],
      [50, 50],
    ]);
    expect(inserts.every((i) => recordGroups(i) !== undefined)).toBe(true);
    expect(inserts[0]!.xDictionary).not.toBe(inserts[1]!.xDictionary);
    const records = [...doc.getCadObjects()].filter((o) => o instanceof XRecord);
    expect(records).toHaveLength(2);
  });

  it('CENTERDISASSOCIATE and a copy made alone save as a mark let go; CENTERREASSOCIATE saves the record again (M4-08 part 3)', async () => {
    // Made and disassociated in one session, and a copy of it made alone: each keeps an empty
    // extension dictionary, as DEC-066 item 3 saves a mark let go of.
    const a = await marked();
    const mark = a.inserts().find((e) => e.geom.kind === 'INSERT' && e.geom.position.x === 50)!;
    a.pickIds(mark.id);
    await a.bus.script(['CENTERDISASSOCIATE', '0,0', '']);
    a.pickIds(mark.id);
    await a.bus.script(['COPY', '0,0', '', '0,0', '0,-100', '']);
    const saved = a.save();
    const doc = readCadDocument(saved);
    const plain = savedInserts(saved).filter((i) => i.insertPoint.x === 50);
    expect(plain.map((i) => i.insertPoint.y).sort()).toEqual([-50, 50]);
    for (const i of plain) {
      expect(recordGroups(i)).toBeUndefined();
      expect(i.xDictionary).toBeInstanceOf(CadDictionary);
    }
    expect([...doc.getCadObjects()].filter((o) => o instanceof XRecord)).toHaveLength(1);
    expect(roundTrip(saved).status).toBe('clean');
    // Saved, reopened and disassociated: the record leaves the dictionary; reassociated, it is
    // written again, naming the circle.
    const b = open((await marked()).save());
    const old = b.inserts().find((e) => e.geom.kind === 'INSERT' && e.geom.position.x === 50)!;
    b.pickIds(old.id);
    await b.bus.script(['CENTERDISASSOCIATE', '0,0', '']);
    expect(savedInserts(b.save()).filter((i) => recordGroups(i) !== undefined)).toHaveLength(1);
    b.pickIds(old.id, b.model.entityByHandle(source.circle)!.id);
    await b.bus.script(['CENTERREASSOCIATE', '0,0', '0,0']);
    expect(b.bus.command).toBeUndefined();
    const again = savedInserts(b.save()).find((i) => i.insertPoint.x === 50)!;
    const groups = recordGroups(again)!;
    expect(handleOf(groups.find((g) => g.code === 331)!.value)).toBe(source.circle);
  });

  it('a centerline on polyline segments saves version 2, a 90 segment index after each 331, and follows the segment after a reopen (M4-29, DEC-068)', async () => {
    const src = authoredPolyline();
    const a = open(src.bytes);
    a.pick(src.polyline, src.polyline);
    await a.bus.script(['CENTERLINE', '10,300', '10,310']);
    a.pick(src.line, src.polyline);
    await a.bus.script(['CENTERLINE', '10,100', '10,310']);
    expect(a.bus.command).toBeUndefined();
    const saved = a.save();
    const inserts = savedInserts(saved);
    expect(inserts.map((i) => [i.insertPoint.x, i.insertPoint.y]).sort()).toEqual([
      [10, 205],
      [10, 305],
    ]);
    const groups = inserts.map((i) => recordGroups(i)!);
    for (const g of groups) {
      expect(g.map((x) => x.code)).toEqual([70, 71, 331, 90, 331, 90, 40, 41]);
      expect(g[0]!.value).toBe(2);
    }
    const two = groups.find((g) => g[5]!.value === 2 && g[3]!.value === 0)!;
    expect([handleOf(two[2]!.value), handleOf(two[4]!.value)]).toEqual([
      src.polyline,
      src.polyline,
    ]);
    const mixed = groups.find((g) => g[3]!.value === -1)!;
    expect([handleOf(mixed[2]!.value), handleOf(mixed[4]!.value), mixed[5]!.value]).toEqual([
      src.line,
      src.polyline,
      2,
    ]);
    expect(roundTrip(saved).status).toBe('clean');

    // Reopened, they still follow their segments: the polyline moved up 10 takes the centerline
    // on two of its segments up 10, the one between it and the line up 5.
    const b = open(saved);
    const records = [...b.model.objects.values()].filter(isCenterMark);
    expect(records.map((r) => r.segments).sort()).toEqual([
      [-1, 2],
      [0, 2],
    ]);
    b.pick(src.polyline);
    await b.bus.script(['MOVE', '10,300', '', '0,0', '0,10']);
    const moved = savedInserts(b.save());
    expect(moved.map((i) => [i.insertPoint.x, i.insertPoint.y]).sort()).toEqual([
      [10, 210],
      [10, 315],
    ]);
  });

  it('a version 2 record without a segment index for each object stays as read', async () => {
    const doc = readCadDocument((await marked()).save());
    for (const o of [...doc.getCadObjects()]) {
      if (!(o instanceof XRecord)) continue;
      o.entries.find((e) => e.code === 70)!.value = 2;
    }
    const bytes = writeCadDocument(doc, { format: 'dxf' });
    const b = open(bytes);
    expect([...b.model.objects.values()].filter(isCenterMark)).toEqual([]);
    expect(roundTrip(bytes).status).toBe('clean');
  });

  it('a record of another version stays as read, and its mark is a plain block reference', async () => {
    const doc = readCadDocument((await marked()).save());
    for (const o of [...doc.getCadObjects()]) {
      if (!(o instanceof XRecord)) continue;
      const v = o.entries.find((e) => e.code === 70)!;
      v.value = 3;
    }
    const bytes = writeCadDocument(doc, { format: 'dxf' });
    const b = open(bytes);
    expect([...b.model.objects.values()].filter(isCenterMark)).toEqual([]);
    expect(roundTrip(bytes).status).toBe('clean');
  });
});
