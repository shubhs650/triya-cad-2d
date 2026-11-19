// M5-17: COPYCLIP, CUTCLIP and PASTECLIP of clipped references on ezdxf's xclip.dxf, pasted into
// the same drawing and into the self-authored traces.dxf (millimetres, so the paste scales the
// metre references by 1000), both saved as AC1032 DXF and read back. Each pasted reference's clip
// is a filter of its own, filed where AutoCAD keeps one (io export/xclips.ts), the inverted ones
// with their ACAD_XREC_ROUNDTRIP records, and a clipped reference inside a pasted block keeps
// its clip there. CI's ezdxf audit reads both saves (audit.py `FIXTURE_SAVES`, kind
// `xclip-paste`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  PromptBus,
  builtinCommands,
  clipBoundary,
  modelSpaceOf,
  type Clipboard,
  type DocumentModel,
  type EntityId,
  type SpatialFilter,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';

const SOURCE = 'third-party/ezdxf/examples_dxf/xclip.dxf';
const TARGET = 'self-authored/traces.dxf';
const corpus = (path: string) =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../../corpus/public/${path}`, import.meta.url))),
  );

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

/** Two drawings sharing the app's one Clipboard, each with a bus. */
function app() {
  let held: { from: number; content: Clipboard } | undefined;
  const drawing = (n: number, bytes: Uint8Array) => {
    const model = new EngineSession(openDocument(readCadDocument(bytes)).init).model;
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r) => {
          if (r.op !== 'clipboard') return Promise.resolve({ ok: false, message: '' });
          if (r.content) held = { from: n, content: structuredClone(r.content) };
          else if (held) {
            const clipboard = structuredClone(held.content);
            return Promise.resolve({ ok: true, clipboard, sameDrawing: held.from === n });
          }
          return Promise.resolve({ ok: true });
        },
      },
    });
    /** `command` on the references `handles`, then `steps`. */
    const run = async (handles: string[], command: string, steps: string[] = []) => {
      const target: EntityId[] = handles.map((h) => model.ids.idOf(h)!);
      await bus.submit(command);
      await bus.answer({ kind: 'selection', ids: target });
      await bus.script(steps);
      expect(bus.command).toBeUndefined();
    };
    return { model, bus, run };
  };
  return { drawing };
}

/** What a save of `model` (read from `bytes`) keeps of the clips made since `before`. */
function saveAndCheck(path: string, bytes: Uint8Array, model: DocumentModel, before: Set<string>) {
  const made = filters(model).filter((f) => !before.has(f.handle));
  const expected = new Map(made.map((f) => [f.insert, clipState(f)]));
  const out = saveAc1032Dxf(readCadDocument(bytes), model);
  writeAuditSave(path, 'xclip-paste', () => out);
  const back = new EngineSession(openDocument(readCadDocument(out)).init).model;
  for (const [insert, want] of expected) {
    const f = clipOf(back, insert);
    expect(clipState(f), insert).toEqual(want);
    expect(back.entityByHandle(insert)!.extDict, insert).toBeDefined();
    // An inverted reference's inner boundary came back from its own ACAD_XREC_ROUNDTRIP record.
    if (want!.inverted) expect(f!.extDict, insert).toBeDefined();
  }
  return made;
}

describe('XCLIP carried by COPYCLIP, CUTCLIP and PASTECLIP saves (M5-17)', () => {
  it('writes each pasted reference its own clip, in the same drawing and another, and reads it back', async () => {
    const a = app();
    const sourceBytes = corpus(SOURCE);
    const source = a.drawing(1, sourceBytes);
    const sourceBefore = new Set(filters(source.model).map((f) => f.handle));

    // 822 (AutoCAD's inverted clip) turned off; 819 (a concave clip), 822 and 809 (inverted)
    // copied and pasted 100 above in their own drawing.
    await source.run(['822'], 'XCLIP', ['OFF']);
    await source.run(['819', '822', '809'], 'COPYCLIP');
    await source.bus.script(['PASTECLIP', '0,100']);
    expect(source.bus.command).toBeUndefined();
    const own = filters(source.model).filter((f) => !sourceBefore.has(f.handle));
    expect(own).toHaveLength(3);
    expect(own.filter((f) => f.inverted)).toHaveLength(2);
    expect(own.filter((f) => !f.enabled)).toHaveLength(1);

    // 819 made into block CLIPPED (its clip kept in the block), a reference to it and 822 cut
    // and pasted into traces.dxf: the block comes with its clipped reference.
    const targetBytes = corpus(TARGET);
    const target = a.drawing(2, targetBytes);
    const targetBefore = new Set(filters(target.model).map((f) => f.handle));
    await source.bus.script(['-BLOCK', 'CLIPPED', '0,0']);
    await source.bus.answer({ kind: 'selection', ids: [source.model.ids.idOf('819')!] });
    await source.bus.script(['-INSERT', 'CLIPPED', '0,-300', '1', '', '0']);
    const inserted = [...source.model.blockEntities(modelSpaceOf(source.model)!)].at(-1)!;
    await source.run([source.model.entity(inserted)!.handle, '822'], 'CUTCLIP');
    await target.bus.script(['PASTECLIP', '0,0']);
    expect(target.bus.command).toBeUndefined();
    const pasted = filters(target.model).filter((f) => !targetBefore.has(f.handle));
    expect(pasted).toHaveLength(2);
    const nested = pasted.find((f) => !f.inverted)!;
    const clipped = [...target.model.tables.blockRecords.values()].find(
      (r) => r.name === 'CLIPPED',
    )!;
    expect(target.model.entityByHandle(nested.insert)!.owner).toBe(clipped.handle);

    saveAndCheck(SOURCE, sourceBytes, source.model, sourceBefore);
    saveAndCheck(TARGET, targetBytes, target.model, targetBefore);
  });
});
