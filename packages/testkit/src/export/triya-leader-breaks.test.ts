// DIMBREAK on multileaders and leaders (M4-15, DEC-065). Acceptance: the break saved with
// DEC-064's record on the multileader or leader and read back. Each is a `TRIYA_DIMBREAK` XRECORD
// in the leader's extension dictionary; the gaps are cut as the leader is drawn, so the saved
// leader itself is unchanged. A save of the reopened drawing that changes nothing has no
// structural difference. The drawing is authored here (DEC-047): a line (50,-10)-(50,40), a
// LEADER (40,0)-(60,20)-(70,20) across it, and a multileader drawn across it with MLEADER.
import {
  ACadVersion,
  CadDictionary,
  CadDocument,
  Leader,
  Line,
  MultiLeader,
  XRecord,
  XYZ,
} from '@node-projects/acad-ts';
import {
  annotationParts,
  dimBreakOf,
  DocumentModel,
  PromptBus,
  builtinCommands,
  isDimBreak,
  withLeaderBreaks,
  type Entity,
  type EntityId,
  type LwPolylineGeometry,
  type ViewHost,
  type ViewReply,
} from '@triya/engine';
import { documentInit, mapTriyaDims, readCadDocument, writeCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { roundTrip } from '../roundtrip/roundtrip.ts';

function authored(): { bytes: Uint8Array; line: string; leader: string } {
  const doc = new CadDocument(ACadVersion.AC1032);
  const line = new Line(new XYZ(50, -10, 0), new XYZ(50, 40, 0));
  doc.entities!.add(line);
  const leader = new Leader();
  leader.vertices = [new XYZ(40, 0, 0), new XYZ(60, 20, 0), new XYZ(70, 20, 0)];
  leader.arrowHeadEnabled = true;
  doc.entities!.add(leader);
  const hex = (h: number | bigint) => h.toString(16).toUpperCase();
  return {
    bytes: writeCadDocument(doc, { format: 'dxf' }),
    line: hex(line.handle),
    leader: hex(leader.handle),
  };
}

const source = authored();

/** A drawing open in the engine; picks answer with the handles given to `pick`. */
function open(bytes: Uint8Array) {
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  let picks: EntityId[] = [];
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'pick') return Promise.resolve({ ok: true, ids: picks });
      if (r.op === 'textWidths') {
        return Promise.resolve({ ok: true, widths: r.texts.map((t) => t.contents.length) });
      }
      if (r.op === 'sysvar') return Promise.resolve({ ok: true, value: 1 });
      return Promise.resolve({ ok: false, message: 'no' });
    },
  };
  const space = [...model.blocks.values()].find((b) => /^\*model_space$/i.test(b.name))!.handle;
  const bus = new PromptBus({ model, registry: builtinCommands(), view, space: () => space });
  const pick = (...handles: string[]) => {
    picks = handles.map((h) => model.entityByHandle(h)!.id);
  };
  const of = (kind: string): Entity =>
    model
      .blockEntities(space)
      .map((id) => model.entity(id)!)
      .find((e) => e.geom.kind === kind)!;
  /** The leader's straight lines as drawn, rounded. */
  const lines = (kind: string): number[][][] => {
    const e = of(kind);
    return withLeaderBreaks(model, e, annotationParts(e.geom, model, e.xdata)!)
      .filter((p) => p.geom.kind === 'LWPOLYLINE')
      .map((p) =>
        (p.geom as LwPolylineGeometry).vertices.map((v) => [
          Math.round(v.x * 1e6) / 1e6,
          Math.round(v.y * 1e6) / 1e6,
        ]),
      );
  };
  const save = (): Uint8Array =>
    withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
  return { model, bus, pick, of, lines, save };
}

/** The records the file holds on leaders: holder type → groups (handles as numbers). */
function records(bytes: Uint8Array): Record<string, [number, unknown][]> {
  const doc = readCadDocument(bytes);
  const out: Record<string, [number, unknown][]> = {};
  for (const o of doc.getCadObjects()) {
    if (!(o instanceof XRecord)) continue;
    const d = o.owner;
    if (!(d instanceof CadDictionary)) continue;
    const holder =
      d.owner instanceof Leader
        ? 'LEADER'
        : d.owner instanceof MultiLeader
          ? 'MULTILEADER'
          : undefined;
    if (!holder) continue;
    const key = d.entryNames.find((k) => d.getEntry(k) === o)!;
    out[`${holder} ${key}`] = o.entries.map((e) => {
      const v = e.value as { handle?: number; x?: number; y?: number } | number | string;
      if (typeof v === 'object' && v !== null && 'handle' in v) return [e.code, v.handle];
      if (typeof v === 'object' && v !== null && 'x' in v) return [e.code, [v.x, v.y]];
      return [e.code, v];
    });
  }
  return out;
}

/** The leader and a multileader across the line, each broken by it with DIMBREAK's Auto. */
async function made() {
  const a = open(source.bytes);
  await a.bus.script(['MLEADER', '40,-5', '60,5', 'NOTE', '']);
  const mleader = a.of('MULTILEADER').handle;
  a.pick(mleader);
  await a.bus.script(['DIMBREAK', '0,0', '']);
  a.pick(source.leader);
  await a.bus.script(['DIMBREAK', '0,0', '']);
  expect(a.bus.command).toBeUndefined();
  return { a, mleader };
}

const lineHandle = Number.parseInt(source.line, 16);

describe('leader and multileader breaks', () => {
  it('are saved as DEC-064 records on the leaders, reopened and drawn as they were', async () => {
    const { a, mleader } = await made();
    const leaderLines = a.lines('LEADER');
    const mleaderLines = a.lines('MULTILEADER');
    // The line breaks the leader at (50,10) and the multileader's leader line at (50,0).
    expect(leaderLines).toHaveLength(2);
    expect(mleaderLines.length).toBeGreaterThan(2);
    const saved = a.save();
    expect(records(saved)).toEqual({
      'LEADER TRIYA_DIMBREAK': [
        [70, 1],
        [331, lineHandle],
      ],
      'MULTILEADER TRIYA_DIMBREAK': [
        [70, 1],
        [331, lineHandle],
      ],
    });
    const b = open(saved);
    expect(b.of('MULTILEADER').handle).toBe(mleader);
    expect(dimBreakOf(b.model, b.of('LEADER'))).toMatchObject({
      dimension: source.leader,
      objects: [source.line],
      manual: [],
    });
    expect(dimBreakOf(b.model, b.of('MULTILEADER'))).toMatchObject({ objects: [source.line] });
    expect(b.lines('LEADER')).toEqual(leaderLines);
    expect(b.lines('MULTILEADER')).toEqual(mleaderLines);
    // Saved again unchanged, the drawing has no structural difference.
    const r = roundTrip(saved);
    expect(r.status, JSON.stringify(r.sample)).toBe('clean');
  });

  it('follow the breaking object after reopening, take manual breaks, and come off with Remove', async () => {
    const { a } = await made();
    const b = open(a.save());
    b.pick(source.line);
    await b.bus.script(['MOVE', '0,0', '', '0,0', '5,0']);
    // The gap follows the line to x = 55, on the leader's first segment (y = x - 40).
    expect(b.lines('LEADER')[0]!.at(-1)![0]).toBeCloseTo(55 - 0.125 / 2 / Math.SQRT2, 6);
    b.pick(source.leader);
    await b.bus.script(['DIMBREAK', '0,0', 'R']);
    b.pick(b.of('MULTILEADER').handle);
    await b.bus.script(['DIMBREAK', '0,0', 'R']);
    const c = b.save();
    expect(records(c)).toEqual({});
    expect(mapTriyaDims(readCadDocument(c))).toEqual([]);
    // A manual break added to the dictionary the leader was read with.
    const d = open(c);
    d.pick(source.leader);
    await d.bus.script(['DIMBREAK', '0,0', 'M', '62,20', '64,20']);
    expect(records(d.save())).toEqual({
      'LEADER TRIYA_DIMBREAK': [
        [70, 1],
        [10, [62, 20]],
        [11, [64, 20]],
      ],
    });
    expect(d.lines('LEADER')).toHaveLength(2);
  });

  it('go with an erased leader and leave out an erased breaking object', async () => {
    const { a, mleader } = await made();
    a.pick(source.line);
    await a.bus.script(['ERASE', '0,0', '']);
    expect(records(a.save())['LEADER TRIYA_DIMBREAK']).toEqual([[70, 1]]);
    expect(a.lines('LEADER')).toHaveLength(1);
    a.pick(source.leader);
    await a.bus.script(['ERASE', '0,0']);
    a.pick(mleader);
    await a.bus.script(['0,0', '']);
    expect([...a.model.objects.values()].filter(isDimBreak)).toEqual([]);
    expect(records(a.save())).toEqual({});
  });
});
