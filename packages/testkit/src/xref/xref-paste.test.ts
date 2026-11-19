// M5-04 part 19: COPYCLIP of the thread-authored xref set's references (M1-21: the parent's
// attachment `xref-child-tb` and its clipped overlay `xref-child-ovl` of the same file) and
// PASTECLIP into ezdxf's colors.dxf (no xrefs), the app's part played here: the `xref` attach
// request loads each waiting xref from the set's files, as the app's loads do, joining the paste's
// undo step. The save writes each new xref's BLOCK_RECORD and BLOCK (DXF 70 bit 4, overlay 4 + 8,
// DXF 1 the path) and the references with the overlay's clip, never the loaded content, and reads
// back with the xrefs waiting for their files; CI's ezdxf audit reads it (audit.py
// `FIXTURE_SAVES`, kind `xref-paste`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  PromptBus,
  builtinCommands,
  modelSpaceOf,
  unloadedXrefs,
  xrefLoadChange,
  type BusEvent,
  type Clipboard,
  type DocumentInit,
  type DocumentModel,
  type EntityId,
  type InsertGeometry,
  type ViewReply,
  type ViewRequest,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';
import { CHILD_AT, CHILD_OVERLAY_AT, XREF_CHILD, XREF_GRANDCHILD, XREF_PARENT } from './fixture';

const HOST = 'third-party/ezdxf/examples_dxf/colors.dxf';
const hostBytes = () =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../../corpus/public/${HOST}`, import.meta.url))),
  );
const DIR = fileURLToPath(new URL('../../fixtures/xref/', import.meta.url));
const initOf = (name: string): DocumentInit =>
  openDocument(readCadDocument(new Uint8Array(readFileSync(DIR + name)))).init;

/** The files the "app" has, by name. */
const FILES = new Map([XREF_CHILD, XREF_GRANDCHILD].map((f) => [f.toUpperCase(), f]));

const xrefNamed = (model: DocumentModel, name: string) =>
  [...model.tables.blockRecords.values()].find((r) => r.name === name);
const references = (model: DocumentModel) =>
  model
    .blockEntities(modelSpaceOf(model)!)
    .map((id) => model.entity(id)!)
    .filter((e) => e.geom.kind === 'INSERT');

/** Two drawings sharing the app's one Clipboard; the app loads each waiting xref it has a file for. */
function app() {
  let held: { from: number; content: Clipboard } | undefined;
  const drawing = (n: number, init: DocumentInit) => {
    const model = new EngineSession(init).model;
    const log: string[] = [];
    const loadWaiting = (join: boolean): string[] => {
      const messages: string[] = [];
      for (let again = true; again;) {
        again = false;
        for (const r of unloadedXrefs(model)) {
          const path = model.blocks.get(r.handle)!.xrefPath!;
          const file = FILES.get(path.split(/[\\/]/).pop()!.toUpperCase());
          if (!file) continue;
          const change = xrefLoadChange(model, r.handle, initOf(file));
          model.apply(change);
          if (join) expect(bus.joinLoad(change)).toBe(true);
          messages.push(`"${r.name}" loaded.`);
          again = true;
        }
      }
      return messages;
    };
    const answer = (r: ViewRequest): ViewReply => {
      if (r.op === 'clipboard') {
        if (r.content) {
          held = { from: n, content: structuredClone(r.content) };
          return { ok: true };
        }
        return held
          ? { ok: true, clipboard: structuredClone(held.content), sameDrawing: held.from === n }
          : { ok: true };
      }
      if (r.op === 'xref' && r.action === 'attach')
        return { ok: true, messages: loadWaiting(true) };
      return { ok: false, message: '' };
    };
    const bus: PromptBus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: { request: (r) => Promise.resolve(answer(r)) },
    });
    bus.on((e: BusEvent) => {
      if (e.type === 'log') log.push(e.line);
    });
    loadWaiting(false);
    return { model, bus, log };
  };
  return { drawing };
}

describe('PASTECLIP of xref references saves (M5-04 part 19)', () => {
  it('attaches the xrefs in another drawing, loaded; the save writes their records and the references, not their content', async () => {
    const a = app();
    const parent = a.drawing(1, initOf(XREF_PARENT));
    const ids: EntityId[] = references(parent.model)
      .filter((e) =>
        ['xref-child-tb', 'xref-child-ovl'].includes(
          parent.model.tables.blockRecords.get((e.geom as InsertGeometry).block)!.name,
        ),
      )
      .map((e) => e.id);
    expect(ids).toHaveLength(2);
    await parent.bus.script(['COPYCLIP']);
    await parent.bus.answer({ kind: 'selection', ids });
    expect(parent.bus.command).toBeUndefined();

    const bytes = hostBytes();
    const host = a.drawing(2, openDocument(readCadDocument(bytes)).init);
    // The parent is unitless and colors.dxf is not: Enter keeps the objects' size (M3-09).
    await host.bus.script(['PASTEORIG', '']);
    expect(host.bus.command).toBeUndefined();
    expect(host.log).toEqual(
      expect.arrayContaining([
        `Attach Xref "xref-child-tb": .\\${XREF_CHILD}`,
        `Overlay Xref "xref-child-ovl": .\\${XREF_CHILD}`,
        '"xref-child-tb" loaded.',
        '"xref-child-ovl" loaded.',
        // The grandchild the attached child brings in, nested.
        '"xref-grandchild" loaded.',
      ]),
    );
    const tb = xrefNamed(host.model, 'xref-child-tb')!;
    const ovl = xrefNamed(host.model, 'xref-child-ovl')!;
    expect(host.model.blocks.get(tb.handle)?.xrefLoaded?.length).toBeGreaterThan(0);
    expect(host.model.blocks.get(ovl.handle)?.xrefLoaded?.length).toBeGreaterThan(0);
    const xrefBlocks = [tb.handle, ovl.handle];
    const pasted = references(host.model).filter((e) =>
      xrefBlocks.includes((e.geom as InsertGeometry).block),
    );
    expect(pasted.map((e) => (e.geom as InsertGeometry).position)).toEqual([
      expect.objectContaining(CHILD_AT),
      expect.objectContaining(CHILD_OVERLAY_AT),
    ]);
    // The overlay's clip came with its reference (M5-17).
    const clips = [...host.model.objects.values()].filter((o) => o.type === 'SPATIAL_FILTER');
    expect(clips).toHaveLength(1);

    const out = saveAc1032Dxf(readCadDocument(bytes), host.model);
    writeAuditSave(HOST, 'xref-paste', () => out);
    const back = openDocument(readCadDocument(out)).init;
    const backModel = new EngineSession(back).model;
    const backTb = xrefNamed(backModel, 'xref-child-tb')!;
    const backOvl = xrefNamed(backModel, 'xref-child-ovl')!;
    expect((backTb.flags ?? 0) & 12).toBe(4);
    expect((backOvl.flags ?? 0) & 12).toBe(12);
    expect(backModel.blocks.get(backTb.handle)?.xrefPath).toBe(`.\\${XREF_CHILD}`);
    expect(backModel.blocks.get(backOvl.handle)?.xrefPath).toBe(`.\\${XREF_CHILD}`);
    // Waiting for their files: none of the content, the nested grandchild or its `|` layers.
    expect(backModel.blockEntities(backTb.handle)).toEqual([]);
    expect(xrefNamed(backModel, 'xref-grandchild')).toBeUndefined();
    expect([...backModel.tables.layers.values()].some((l) => l.name.includes('|'))).toBe(false);
    expect(
      references(backModel)
        .map((e) => (e.geom as InsertGeometry).block)
        .filter((h) => h === backTb.handle || h === backOvl.handle),
    ).toEqual([backTb.handle, backOvl.handle]);
    expect([...backModel.objects.values()].filter((o) => o.type === 'SPATIAL_FILTER')).toHaveLength(
      1,
    );
  });
});
