// M5-16: COPY, MIRROR and ARRAY of clipped references on ezdxf's xclip.dxf, saved as AC1032 DXF
// and read back. Each copy's clip is a filter of its own, filed where AutoCAD keeps one (the
// SPATIAL entry of an ACAD_FILTER dictionary in the copy's extension dictionary, io
// export/xclips.ts), the inverted ones with their ACAD_XREC_ROUNDTRIP records, and an associative
// array's source keeps its clip inside the array's block. CI's ezdxf audit reads the save
// (audit.py `FIXTURE_SAVES`, `third-party__ezdxf__examples_dxf__xclip.dxf.xclip-copy.dxf`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  PromptBus,
  builtinCommands,
  clipBoundary,
  modelSpaceOf,
  type DocumentModel,
  type EntityId,
  type SpatialFilter,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
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
/** What a save must keep of a clip: what it hides, in its block's coordinates, and its state. */
const clipState = (f: SpatialFilter | undefined) =>
  f && {
    region: rounded(clipBoundary(f)),
    inverted: rounded(f.inverted),
    enabled: f.enabled,
    inverseInsert: f.inverseInsert.map(r6),
  };

describe('XCLIP carried by COPY, MIRROR and ARRAY saves (M5-16)', () => {
  it('writes each copy its own clip, inverted, turned off or in an array block, and reads it back', async () => {
    const model = new EngineSession(openDocument(readCadDocument(bytes())).init).model;
    const space = modelSpaceOf(model);
    let target: EntityId[] = [];
    const variables = new Map<string, number>([['ARRAYASSOCIATIVITY', 1]]);
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r) =>
          Promise.resolve(
            r.op === 'pick'
              ? { ok: true, ids: target }
              : r.op === 'sysvar' && variables.has(r.name)
                ? { ok: true, value: variables.get(r.name)! }
                : { ok: false, message: '' },
          ),
      },
    });
    /** `command` on the reference `handle`, then `steps`. */
    const run = async (handle: string, command: string, steps: string[]) => {
      target = [model.ids.idOf(handle)!];
      await bus.submit(command);
      await bus.pick({ x: 0, y: 0 });
      await bus.submit('');
      await bus.script(steps);
      expect(bus.command).toBeUndefined();
    };
    const before = new Set(filters(model).map((f) => f.handle));

    // 822 (AutoCAD's inverted clip, its record in the filter's extension dictionary) turned off,
    // then copied with 819 (an ordinary concave clip); 809 (inverted) mirrored, kept; 819 arrayed
    // as separate objects and as an associative array.
    await run('822', 'XCLIP', ['OFF']);
    await run('819', 'COPY', ['0,0', '0,100', '']);
    await run('822', 'COPY', ['0,0', '0,100', '']);
    await run('809', 'MIRROR', ['0,-50', '0,-60', 'N']);
    variables.set('ARRAYASSOCIATIVITY', 0);
    await run('819', 'ARRAYRECT', ['COU', '3', '1', 'S', '100', '100', '']);
    variables.set('ARRAYASSOCIATIVITY', 1);
    await run('819', 'ARRAYRECT', ['COU', '2', '1', 'S', '100', '100', '']);

    const made = filters(model).filter((f) => !before.has(f.handle));
    // Two copies, one mirror, two array items, and 819's own in the associative array's block.
    expect(made).toHaveLength(6);
    expect(clipOf(model, '819')).toBeUndefined();
    const inner = model.entityByHandle(made.at(-1)!.insert)!;
    expect(inner.owner).not.toBe(space);
    expect(made.filter((f) => f.inverted)).toHaveLength(2);
    expect(made.filter((f) => !f.enabled)).toHaveLength(1);
    const expected = new Map(made.map((f) => [f.insert, clipState(f)]));

    const out = saveAc1032Dxf(readCadDocument(bytes()), model);
    writeAuditSave(AUDIT_PATH, 'xclip-copy', () => out);
    const back = new EngineSession(openDocument(readCadDocument(out)).init).model;
    for (const [insert, want] of expected) {
      const f = clipOf(back, insert);
      expect(clipState(f), insert).toEqual(want);
      expect(back.entityByHandle(insert)!.extDict, insert).toBeDefined();
      // An inverted copy's inner boundary came back from its own ACAD_XREC_ROUNDTRIP record.
      if (want!.inverted) expect(f!.extDict, insert).toBeDefined();
    }
  });
});
