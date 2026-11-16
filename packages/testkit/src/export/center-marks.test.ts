// Center marks and centerlines (M4-08 part 1). Each is saved as AutoCAD saves the visible part
// of one: an INSERT of an anonymous block of lines, which every reader draws. The record that
// keeps it associative stays in the open drawing until needs-human #451 says how a save writes
// it, so the file holds no Triya object for it and a reopened mark is a plain block reference.
// The drawing is authored here (DEC-047): a circle r 10 at (50,50) and two parallel lines.
import type { BlockRecord } from '@node-projects/acad-ts';
import {
  ACadVersion,
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
  return { model, bus, pick, inserts, save };
}

describe('center marks and centerlines', () => {
  it('save as block references of anonymous blocks of lines, without the record', async () => {
    const a = open(source.bytes);
    a.pick(source.circle);
    await a.bus.script(['CENTERMARK', '0,0', '']);
    a.pick(...source.lines);
    await a.bus.script(['CENTERLINE', '0,0', '0,0']);
    expect(a.bus.command).toBeUndefined();
    const made = a.inserts();
    expect(made).toHaveLength(2);
    expect(made.every((e) => centerMarkOf(a.model, e) !== undefined)).toBe(true);
    const saved = a.save();

    const doc = readCadDocument(saved);
    const inserts = [...doc.getCadObjects()].filter((o): o is Insert => o instanceof Insert);
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
    // No Triya record, and no extension dictionary on the marks.
    expect([...doc.getCadObjects()].filter((o) => o instanceof XRecord)).toEqual([]);
    expect(inserts.every((i) => !i.xDictionary)).toBe(true);

    // Reopened, they are plain block references; saved again unchanged, no structural difference.
    const b = open(saved);
    expect(b.inserts()).toHaveLength(2);
    expect([...b.model.objects.values()].filter(isCenterMark)).toEqual([]);
    const r = roundTrip(saved);
    expect(r.status, JSON.stringify(r.sample)).toBe('clean');
  });

  it('save where the circle moved them to', async () => {
    const a = open(source.bytes);
    a.pick(source.circle);
    await a.bus.script(['CENTERMARK', '0,0', '']);
    a.pick(source.circle);
    await a.bus.script(['MOVE', '0,0', '', '0,0', '5,5']);
    const doc = readCadDocument(a.save());
    const [mark] = [...doc.getCadObjects()].filter((o): o is Insert => o instanceof Insert);
    expect([mark!.insertPoint.x, mark!.insertPoint.y]).toEqual([55, 55]);
  });
});
