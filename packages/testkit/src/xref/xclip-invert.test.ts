// M5-04 part 11: XCLIP's Invert clip on ezdxf's xclip.dxf, saved as AC1032 DXF and read back. An
// inverted clip's inner boundary goes where AutoCAD 2015 and later keep it: the
// ACAD_INVERTEDCLIP_ROUNDTRIP section of an ACAD_XREC_ROUNDTRIP XRECORD in the SPATIAL_FILTER's
// extension dictionary, with ACAD_INVERTEDCLIP_ROUNDTRIP_COMPARE holding the boundary it was
// written with (as xclip.dxf's 809 and 822 hold them). CI's ezdxf audit reads the save (audit.py
// `FIXTURE_SAVES`, `third-party__ezdxf__examples_dxf__xclip.dxf.xclip-invert.dxf`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  EngineSession,
  PromptBus,
  builtinCommands,
  clipBoundary,
  clipFrame,
  modelSpaceOf,
  type DocumentModel,
  type EntityId,
  type SpatialFilter,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import {
  CadDictionary,
  SpatialFilter as AcadSpatialFilter,
  XRecord,
  type CadDocument,
} from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';

const AUDIT_PATH = 'third-party/ezdxf/examples_dxf/xclip.dxf';
const FILE = fileURLToPath(new URL(`../../../../corpus/public/${AUDIT_PATH}`, import.meta.url));
const bytes = () => new Uint8Array(readFileSync(FILE));

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const filters = (model: DocumentModel) =>
  [...model.objects.values()].filter((o): o is SpatialFilter => o.type === 'SPATIAL_FILTER');
const clipOf = (model: DocumentModel, insert: string) =>
  filters(model).find((f) => f.insert === insert);
const rounded = (points: readonly { x: number; y: number }[] | undefined) =>
  points?.map((p) => [r6(p.x), r6(p.y)]);

/** The ACAD_XREC_ROUNDTRIP record of the save's filter on `insert`, as acad-ts reads it. */
function roundtrip(doc: CadDocument, insert: string) {
  for (const o of doc.getCadObjects()) {
    if (!(o instanceof AcadSpatialFilter)) continue;
    const xdict = (o.owner as CadDictionary | null)?.owner as CadDictionary | null;
    if (xdict?.owner?.handle.toString(16).toUpperCase() !== insert) continue;
    const own = o.xDictionary;
    const record = own?.getEntry('ACAD_XREC_ROUNDTRIP');
    return { filter: o, own, record: record instanceof XRecord ? record : undefined };
  }
  return undefined;
}

describe('XCLIP Invert clip saves (M5-04 part 11)', () => {
  it('writes the inner boundary to an ACAD_XREC_ROUNDTRIP record AutoCAD reads, and reads it back', async () => {
    const model = new EngineSession(openDocument(readCadDocument(bytes())).init).model;
    const space = modelSpaceOf(model);
    const base = [...model.tables.blockRecords.values()].find((r) => r.name === 'BaseBlock')!;
    // A reference of BaseBlock (0–7 × 0–7) at 50,0 with no extension dictionary.
    const b = new ChangeSetBuilder(model);
    const fresh = b.addEntity({
      owner: space,
      layer: [...model.tables.layers.values()].find((l) => l.name === '0')!.handle,
      geom: {
        kind: 'INSERT',
        block: base.handle,
        position: { x: 50, y: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
        attributes: [],
      },
    });
    model.apply(b.build());

    let target: EntityId[] = [];
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r) =>
          Promise.resolve(r.op === 'pick' ? { ok: true, ids: target } : { ok: false, message: '' }),
      },
    });
    const run = async (handle: string, command: string, steps: string[]) => {
      target = [model.ids.idOf(handle)!];
      await bus.submit(command);
      await bus.pick({ x: 0, y: 0 });
      await bus.submit('');
      await bus.script(steps);
      expect(bus.command).toBeUndefined();
    };

    // A first clip, inverted: the reference gets its extension dictionary, the filter one too.
    await run(fresh.handle, 'XCLIP', ['', 'I', '', '52,2', '55,4']);
    // 819's ordinary concave clip replaced by an inverted polygon.
    await run('819', 'XCLIP', ['', 'Y', 'I', 'P', '36,8', '40,8', '38,11', '']);
    // 822 (AutoCAD's inverted clip) turned off: its record stays as read.
    await run('822', 'XCLIP', ['OFF']);
    const expected = Object.fromEntries(
      [fresh.handle, '819', '822', '809'].map((h) => [
        h,
        {
          inverted: rounded(clipOf(model, h)!.inverted),
          boundary: rounded(clipOf(model, h)!.boundary),
          region: rounded(clipBoundary(clipOf(model, h)!)),
          frame: rounded(clipFrame(clipOf(model, h)!)),
        },
      ]),
    );
    expect(expected[fresh.handle]!.inverted).toEqual([
      [52, 2],
      [55, 4],
    ]);
    expect(expected['819']!.inverted).toHaveLength(3);

    const out = saveAc1032Dxf(readCadDocument(bytes()), model);
    writeAuditSave(AUDIT_PATH, 'xclip-invert', () => out);
    const doc = readCadDocument(out);
    const back = new EngineSession(openDocument(doc).init).model;

    for (const [h, want] of Object.entries(expected)) {
      const f = clipOf(back, h)!;
      expect(rounded(f.inverted), h).toEqual(want.inverted);
      expect(rounded(f.boundary), h).toEqual(want.boundary);
      expect(rounded(clipBoundary(f)), h).toEqual(want.region);
      expect(rounded(clipFrame(f)), h).toEqual(want.frame);
      expect(f.extDict, h).toBeDefined();
    }
    expect(clipOf(back, '822')!.enabled).toBe(false);
    expect(clipOf(back, '822')!.extDict).toBe(clipOf(model, '822')!.extDict);

    // The new records as AutoCAD writes them: the filter's extension dictionary hard-owns the
    // XRECORD (280 = 1, 281 = 1), which lists it as its reactor and keeps existing on clone.
    for (const h of [fresh.handle, '819']) {
      const found = roundtrip(doc, h)!;
      expect(found.own, h).toBeInstanceOf(CadDictionary);
      expect(found.own!.hardOwnerFlag, h).toBe(true);
      const rec = found.record!;
      expect(rec.cloningFlags, h).toBe(1);
      expect(
        rec.reactors.map((r) => r.handle),
        h,
      ).toEqual([found.own!.handle]);
      const codes = rec.entries.map((e) => (e.code === 102 ? (e.value as string) : e.code));
      const n = expected[h]!.inverted!.length;
      const m = expected[h]!.boundary!.length;
      expect(codes, h).toEqual([
        'ACAD_INVERTEDCLIP_ROUNDTRIP',
        ...Array<number>(n).fill(10),
        'ACAD_INVERTEDCLIP_ROUNDTRIP_COMPARE',
        ...Array<number>(m).fill(10),
      ]);
    }
    // The fresh reference's bounds: BaseBlock's 50–57 × 0–7, grown by 0.35, the rectangle cut
    // out through a slit from its lowest vertex.
    expect(expected[fresh.handle]!.boundary).toEqual([
      [55, -0.35],
      [57.35, -0.35],
      [57.35, 7.35],
      [49.65, 7.35],
      [49.65, -0.35],
      [55, -0.35],
      [55, 2],
      [52, 2],
      [52, 4],
      [55, 4],
      [55, 2],
    ]);
  });
});
