// Dimension breaks and inspection data (M4-02 part 4, DEC-064). Acceptance: DIMBREAK and
// DIMINSPECT on a dimension, saved, reopened and edited again. Each is a XRECORD in the
// dimension's extension dictionary (TRIYA_DIMBREAK, TRIYA_DIMINSPECT), the dimension's `*D` block
// holding the gaps and the frame as drawn; a save of the reopened drawing that changes nothing has
// no structural difference. The drawing is authored here (DEC-047): a line (50,-10)-(50,40)
// that a dimension from (0,0) to (100,0), its line at y = 20, is drawn across.
import {
  ACadVersion,
  CadDictionary,
  CadDocument,
  Dimension,
  Line,
  XRecord,
  XYZ,
} from '@node-projects/acad-ts';
import { regenerateDimension } from '@triya/dims';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  dimBreakOf,
  dimInspectOf,
  isDimBreak,
  isDimInspect,
  type Entity,
  type EntityId,
  type ViewHost,
  type ViewReply,
} from '@triya/engine';
import { documentInit, mapTriyaDims, readCadDocument, writeCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { roundTrip } from '../roundtrip/roundtrip.ts';

function authored(): { bytes: Uint8Array; line: string } {
  const doc = new CadDocument(ACadVersion.AC1032);
  const line = new Line(new XYZ(50, -10, 0), new XYZ(50, 40, 0));
  doc.entities!.add(line);
  return {
    bytes: writeCadDocument(doc, { format: 'dxf' }),
    line: line.handle.toString(16).toUpperCase(),
  };
}

const source = authored();

/** A drawing open in the engine with the dimension engine, every character as wide as high. */
function open(bytes: Uint8Array) {
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  let picks: EntityId[] = [];
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'pick') return Promise.resolve({ ok: true, ids: picks });
      if (r.op === 'textWidths') {
        return Promise.resolve({
          ok: true,
          widths: r.texts.map((t) => t.contents.replace(/\\[A-Za-z][^;]*;/g, '').length * t.height),
        });
      }
      if (r.op === 'sysvar') return Promise.resolve({ ok: true, value: 1 });
      return Promise.resolve({ ok: false, message: 'no' });
    },
  };
  const space = [...model.blocks.values()].find((b) => /^\*model_space$/i.test(b.name))!.handle;
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view,
    space: () => space,
    dimensions: regenerateDimension,
  });
  const pick = (...handles: string[]) => {
    picks = handles.map((h) => model.entityByHandle(h)!.id);
  };
  const dim = (): Entity =>
    model
      .blockEntities(space)
      .map((id) => model.entity(id)!)
      .find((e) => e.geom.kind === 'DIMENSION')!;
  /** The dimension line's pieces in its block, as x ranges. */
  const dimLine = (): number[][] => {
    const block = (dim().geom as { block: string }).block;
    return model
      .blockEntities(block)
      .map((id) => model.entity(id)!.geom)
      .filter(
        (g): g is Extract<typeof g, { kind: 'LINE' }> =>
          g.kind === 'LINE' && Math.abs(g.start.y - 20) < 1e-9 && Math.abs(g.end.y - 20) < 1e-9,
      )
      .map((g) => [g.start.x, g.end.x].sort((a, b) => a - b));
  };
  const save = (): Uint8Array =>
    withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
  return { model, bus, pick, dim, dimLine, save };
}

/** The dimension's records as the file holds them: key → groups (handles as numbers). */
function records(bytes: Uint8Array): Record<string, [number, unknown][]> {
  const doc = readCadDocument(bytes);
  const out: Record<string, [number, unknown][]> = {};
  for (const o of doc.getCadObjects()) {
    if (!(o instanceof XRecord)) continue;
    const d = o.owner;
    if (!(d instanceof CadDictionary) || !(d.owner instanceof Dimension)) continue;
    const key = d.entryNames.find((k) => d.getEntry(k) === o)!;
    out[key] = o.entries.map((e) => {
      const v = e.value as { handle?: number; x?: number; y?: number } | number | string;
      if (typeof v === 'object' && v !== null && 'handle' in v) return [e.code, v.handle];
      if (typeof v === 'object' && v !== null && 'x' in v) return [e.code, [v.x, v.y]];
      return [e.code, v];
    });
  }
  return out;
}

/** A dimension across the line, broken where the line crosses it and made an inspection one. */
async function made() {
  const a = open(source.bytes);
  await a.bus.script(['DIMLINEAR', '0,0', '100,0', '50,20']);
  const handle = a.dim().handle;
  a.pick(handle);
  await a.bus.script(['DIMBREAK', '0,0', '']);
  await a.bus.script(['-DIMINSPECT', '', '0,0', '', 'R', 'B2', '50%']);
  expect(a.bus.command).toBeUndefined();
  return { a, handle };
}

describe('dimension breaks and inspection data', () => {
  it('are saved as DEC-064 records, reopened and drawn as they were', async () => {
    const { a, handle } = await made();
    const gaps = a.dimLine();
    // The line breaks the dimension line around x = 50 (a gap of the Break size, 0.125).
    expect(gaps.some(([, end]) => Math.abs(end! - 49.9375) < 1e-9)).toBe(true);
    const saved = a.save();
    expect(records(saved)).toEqual({
      TRIYA_DIMBREAK: [
        [70, 1],
        [331, Number.parseInt(source.line, 16)],
      ],
      TRIYA_DIMINSPECT: [
        [70, 1],
        [71, 0],
        [1, 'B2'],
        [3, '50%'],
      ],
    });
    const b = open(saved);
    expect(b.dim().handle).toBe(handle);
    expect(dimBreakOf(b.model, b.dim())).toMatchObject({ objects: [source.line], manual: [] });
    expect(dimInspectOf(b.model, b.dim())).toMatchObject({
      shape: 'round',
      label: 'B2',
      rate: '50%',
    });
    expect(b.dimLine()).toEqual(gaps);
    // Saved again unchanged, the drawing has no structural difference.
    const r = roundTrip(saved);
    expect(r.status, JSON.stringify(r.sample)).toBe('clean');
  });

  it('follow the breaking object after reopening, and come off with Remove', async () => {
    const { a } = await made();
    const b = open(a.save());
    b.pick(source.line);
    await b.bus.script(['MOVE', '0,0', '', '0,0', '20,0']);
    expect(b.dimLine().some(([, end]) => Math.abs(end! - 69.9375) < 1e-9)).toBe(true);
    b.pick(b.dim().handle);
    await b.bus.script(['DIMBREAK', '0,0', 'R', '-DIMINSPECT', 'R', '0,0', '']);
    const c = b.save();
    // The dimension keeps its dictionary, empty now.
    expect(records(c)).toEqual({});
    expect(mapTriyaDims(readCadDocument(c))).toEqual([]);
    // A record added to the dictionary it was read with.
    const d = open(c);
    d.pick(d.dim().handle);
    await d.bus.script(['DIMBREAK', '0,0', 'M', '10,20', '20,20']);
    expect(records(d.save())).toEqual({
      TRIYA_DIMBREAK: [
        [70, 1],
        [10, [10, 20]],
        [11, [20, 20]],
      ],
    });
  });

  it('leave out an erased breaking object and go with an erased dimension', async () => {
    const { a, handle } = await made();
    a.pick(source.line);
    await a.bus.script(['ERASE', '0,0', '']);
    expect(records(a.save()).TRIYA_DIMBREAK).toEqual([[70, 1]]);
    // Drawn again whole (the other piece is the inspection frame's bottom, on the line).
    expect(a.dimLine()[0]).toEqual([0.18, 99.82]);
    a.pick(handle);
    await a.bus.script(['ERASE', '0,0', '']);
    const objects = [...a.model.objects.values()];
    expect(objects.filter((o) => isDimBreak(o) || isDimInspect(o))).toEqual([]);
    expect(records(a.save())).toEqual({});
  });

  it('leave a record of a version Triya does not know as read', async () => {
    const { a } = await made();
    const text = new TextDecoder().decode(a.save());
    const version2 = text.replace(/(AcDbXrecord\r?\n\s*280\r?\n\s*1\r?\n\s*70\r?\n\s*)1/g, '$12');
    expect(version2).not.toBe(text);
    const bytes = new TextEncoder().encode(version2);
    expect(mapTriyaDims(readCadDocument(bytes))).toEqual([]);
    const r = roundTrip(bytes);
    expect(r.status, JSON.stringify(r.sample)).toBe('clean');
  });
});
