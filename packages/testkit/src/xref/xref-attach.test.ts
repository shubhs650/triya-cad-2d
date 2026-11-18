// M5-04 part 6: XATTACH run in an engine session on ezdxf's colors.dxf (no xrefs), the app's
// part played here: each `xref` attach request loads the thread-authored xref files (M1-21) into
// the new xref and the xrefs it brings in, as the app's loads do (session `xref-load`). The save
// writes each new xref's BLOCK_RECORD and BLOCK (DXF 70 bit 4, overlay 4 + 8, DXF 1 the path) and
// the references, never the loaded content, and reads back with the xrefs waiting for their
// files; CI's ezdxf audit reads it (audit.py `FIXTURE_SAVES`, kind `xattach`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  modelSpaceOf,
  unloadedXrefs,
  type CommandOutput,
  type DocumentInit,
  type DocumentModel,
  type InsertGeometry,
  type PromptAnswer,
  type XrefAttachSettings,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';
import { XREF_CHILD, XREF_GRANDCHILD } from './fixture';

const HOST = 'third-party/ezdxf/examples_dxf/colors.dxf';
const host = () =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../../corpus/public/${HOST}`, import.meta.url))),
  );
const DIR = fileURLToPath(new URL('../../fixtures/xref/', import.meta.url));
const initOf = (name: string): DocumentInit =>
  openDocument(readCadDocument(new Uint8Array(readFileSync(DIR + name)))).init;

/** The files the "app" has, by name, as the dialog's Browse... and drops supply them. */
const FILES = new Map([XREF_CHILD, XREF_GRANDCHILD].map((f) => [f.toUpperCase(), f]));

const FIXED: XrefAttachSettings = {
  overlay: false,
  pointOnScreen: false,
  point: { x: 0, y: 0 },
  scaleOnScreen: false,
  scale: { x: 1, y: 1, z: 1 },
  uniformScale: false,
  rotationOnScreen: false,
  rotation: 0,
};

/** colors.dxf in a session whose app loads the xrefs it attaches, and those they bring in. */
function session() {
  const s = new EngineSession(openDocument(readCadDocument(host())).init);
  const log: string[] = [];
  s.onCommand((o: CommandOutput) => {
    if (o.type === 'log') log.push(o.line);
    if (o.type !== 'view' || o.request.op !== 'xref' || o.request.action !== 'attach') return;
    const messages: string[] = [];
    // Each waiting xref whose file the app has, until none is left: nested ones come in loaded.
    for (let again = true; again;) {
      again = false;
      for (const r of unloadedXrefs(s.model)) {
        const path = s.model.blocks.get(r.handle)!.xrefPath!;
        const file = FILES.get(path.split(/[\\/]/).pop()!.toUpperCase());
        if (!file) continue;
        expect(s.edit({ kind: 'xref-load', block: r.handle, drawing: initOf(file) })).toMatchObject(
          { ok: true },
        );
        messages.push(`"${r.name}" loaded.`);
        again = true;
      }
    }
    void s.command({ kind: 'view', id: o.id, reply: { ok: true, messages } });
  });
  const attach = async (fileName: string, units: number, settings: Partial<XrefAttachSettings>) => {
    await s.command({ kind: 'submit', text: 'XATTACH' });
    await s.command({
      kind: 'answer',
      answer: {
        kind: 'dialog',
        action: 'ok',
        xrefAttach: { file: { fileName, units }, settings: { ...FIXED, ...settings } },
      } as PromptAnswer,
    });
  };
  return { s, model: s.model, log, attach };
}

const recordNamed = (model: DocumentModel, name: string) =>
  [...model.tables.blockRecords.values()].find((r) => r.name === name);
/** The model space's references to xrefs (colors.dxf has block references of its own). */
const inserts = (model: DocumentModel) =>
  model
    .blockEntities(modelSpaceOf(model))
    .map((id) => model.entity(id)!.geom)
    .filter(
      (g): g is InsertGeometry =>
        g.kind === 'INSERT' && model.blocks.get(g.block)?.xrefPath !== undefined,
    );
const layerNames = (model: DocumentModel) =>
  [...model.tables.layers.values()].map((l) => l.name).sort();
const shape = (model: DocumentModel) => ({
  layers: layerNames(model),
  blocks: [...model.blocks.values()].map((b) => b.name).sort(),
  entities: [...model.entities()].length,
});

const reopened = (bytes: Uint8Array): DocumentModel =>
  new EngineSession(openDocument(readCadDocument(bytes)).init).model;

describe('XATTACH saves (M5-04 part 6)', () => {
  it('attaches and overlays drawing files, loaded with what they bring in', async () => {
    const { model, log, attach } = session();
    await attach(XREF_CHILD, 0, { point: { x: 100, y: 50 }, scale: { x: 2, y: 2, z: 2 } });
    const child = recordNamed(model, 'xref-child-tb')!;
    expect(child.flags).toBe(4);
    expect(model.blocks.get(child.handle)?.xrefPath).toBe(XREF_CHILD);
    expect(model.blockEntities(child.handle).length).toBeGreaterThan(0);
    // The grandchild the child attaches came in and was loaded; the child's overlay did not.
    const grandchild = recordNamed(model, 'xref-grandchild')!;
    expect(model.blocks.get(grandchild.handle)?.xrefLoaded?.length).toBeGreaterThan(0);
    expect(layerNames(model)).toEqual(expect.arrayContaining(['xref-child-tb|TB-FRAME']));
    expect(log).toEqual(
      expect.arrayContaining([
        `Attach Xref "xref-child-tb": ${XREF_CHILD}`,
        '"xref-child-tb" loaded.',
        '"xref-grandchild" loaded.',
      ]),
    );
    expect(inserts(model)).toEqual([
      expect.objectContaining({ block: child.handle, position: { x: 100, y: 50 } }),
    ]);
  });

  it('saves the new xrefs and their references, never their content, and reads them back', async () => {
    const { s, model, attach } = session();
    const before = shape(model);
    await attach(XREF_CHILD, 0, { point: { x: 100, y: 50 }, scale: { x: 2, y: 2, z: 2 } });
    // The grandchild's file overlaid on its own, turned 30°.
    await attach(XREF_GRANDCHILD, 0, { overlay: true, rotation: Math.PI / 6 });
    expect(s.undoState.nextUndo).toBe('XATTACH');
    const out = saveAc1032Dxf(readCadDocument(host()), model);
    writeAuditSave(HOST, 'xattach', () => out);
    const back = reopened(out);

    const child = recordNamed(back, 'xref-child-tb')!;
    expect(child.flags).toBe(4);
    expect(back.blocks.get(child.handle)?.xrefPath).toBe(XREF_CHILD);
    // The child brought the grandchild in, and the overlay names its file: AutoCAD's rule is one
    // xref per file, so the second XATTACH referenced the loaded grandchild, which is the
    // drawing's own now (saved, an attachment still).
    const grandchild = recordNamed(back, 'xref-grandchild')!;
    expect(back.blocks.get(grandchild.handle)?.xrefPath).toBe(`.\\${XREF_GRANDCHILD}`);
    // Nothing loaded is saved: the xrefs are empty and wait for their files.
    for (const r of [child, grandchild]) expect(back.blockEntities(r.handle)).toEqual([]);
    expect(layerNames(back)).toEqual(before.layers);
    expect(
      unloadedXrefs(back)
        .map((r) => r.name)
        .sort(),
    ).toEqual(['xref-child-tb', 'xref-grandchild']);
    const refs = inserts(back);
    expect(refs.map((g) => g.block)).toEqual([child.handle, grandchild.handle]);
    expect(refs[0]).toMatchObject({ position: { x: 100, y: 50 }, scale: { x: 2, y: 2, z: 2 } });
    expect(refs[1]!.rotation).toBeCloseTo(Math.PI / 6, 12);
    // The grandchild's base point is its INSBASE, which the load took.
    expect(back.blocks.get(grandchild.handle)?.basePoint).toEqual({ x: 20, y: 20 });
    // Saved again as opened: nothing changes.
    expect(shape(reopened(saveAc1032Dxf(readCadDocument(out), back)))).toEqual(shape(back));
  });

  it('overlays a file of its own: DXF 70 bits 4 and 8 saved', async () => {
    const { model, attach } = session();
    await attach(XREF_GRANDCHILD, 4, { overlay: true });
    const back = reopened(saveAc1032Dxf(readCadDocument(host()), model));
    const r = recordNamed(back, 'xref-grandchild')!;
    expect(r.flags).toBe(4 | 8);
    expect(r.units).toBe(4);
  });

  it('undoes the attachment with its loaded content in one step, and redoes it loaded', async () => {
    const { s, model, attach } = session();
    const before = shape(model);
    await attach(XREF_CHILD, 0, {});
    const after = shape(model);
    await s.command({ kind: 'submit', text: 'U' });
    expect(shape(model)).toEqual(before);
    await s.command({ kind: 'submit', text: 'REDO' });
    expect(shape(model)).toEqual(after);
    const child = recordNamed(model, 'xref-child-tb')!;
    expect(model.blocks.get(child.handle)?.xrefLoaded?.length).toBeGreaterThan(0);
  });
});
