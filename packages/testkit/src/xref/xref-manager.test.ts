// M5-04 part 1: XREF Unload, Reload and Detach on the thread-authored xref set (M1-21), as the
// References palette and -XREF send them, and the DXF a detach saves.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  PromptBus,
  builtinCommands,
  unloadedXrefs,
  withoutXrefContent,
  type BusEvent,
  type DocumentInit,
  type DocumentModel,
  type LayerState,
  type ViewRequest,
} from '@triya/engine';
import { openDocument, readCadDocument, triyaToAcad } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf } from '../dxf-audit/saves';
import { VISRETAIN_LAYER, XREF_CHILD, XREF_GRANDCHILD, XREF_PARENT } from './fixture';

const DIR = fileURLToPath(new URL('../../fixtures/xref/', import.meta.url));
const bytesOf = (name: string) => new Uint8Array(readFileSync(DIR + name));
const initOf = (name: string): DocumentInit => openDocument(readCadDocument(bytesOf(name))).init;

const recordNamed = (model: DocumentModel, name: string) =>
  [...model.tables.blockRecords.values()].find((r) => r.name === name);
const handleOf = (model: DocumentModel, name: string) => recordNamed(model, name)!.handle;
const layerNames = (model: DocumentModel) =>
  [...model.tables.layers.values()].map((l) => l.name).sort();
const insertsOf = (model: DocumentModel, block: string) =>
  [...model.entities()].filter((e) => e.geom.kind === 'INSERT' && e.geom.block === block);

function load(session: EngineSession, name: string, file: string): void {
  const r = session.edit({
    kind: 'xref-load',
    block: handleOf(session.model, name),
    drawing: initOf(file),
  });
  expect(r).toMatchObject({ ok: true });
}

/** The parent with its xrefs loaded, as the app loads them when their files are dropped. */
function loadedParent(): EngineSession {
  const session = new EngineSession(initOf(XREF_PARENT));
  load(session, 'xref-child-tb', XREF_CHILD);
  load(session, 'xref-child-ovl', XREF_CHILD);
  load(session, 'xref-grandchild', XREF_GRANDCHILD);
  return session;
}

/** What the model draws and keeps, without handles: equal after an unload and reload. */
const shape = (model: DocumentModel) => ({
  layers: layerNames(model),
  blocks: [...model.blocks.values()].map((b) => b.name).sort(),
  entities: [...model.entities()].length,
  objects: [...model.objects.values()].map((o) => o.type).sort(),
});

/** The saved DXF of `model`, read back. */
const resaved = (model: DocumentModel): DocumentInit =>
  openDocument(readCadDocument(saveAc1032Dxf(readCadDocument(bytesOf(XREF_PARENT)), model))).init;

const resavedModel = (model: DocumentModel): DocumentModel =>
  new EngineSession(resaved(model)).model;

describe('XREF Unload and Reload (M5-04)', () => {
  it('unloads the attached child: its content goes, the grandchild stays with the overlay', () => {
    const session = loadedParent();
    const model = session.model;
    const child = handleOf(model, 'xref-child-tb');
    const ovl = handleOf(model, 'xref-child-ovl');
    const grandchild = handleOf(model, 'xref-grandchild');
    const r = session.edit({ kind: 'xref-unload', block: child });
    expect(r).toMatchObject({ ok: true });
    const def = model.blocks.get(child)!;
    expect(def.xrefLoaded).toBeUndefined();
    expect(def.xrefUnloaded).toBe(true);
    expect(model.blockEntities(child)).toEqual([]);
    expect(recordNamed(model, 'xref-child-tb|LOGO')).toBeUndefined();
    // The VISRETAIN record is the drawing's own: it stays. The loaded ones go.
    expect(layerNames(model).filter((n) => n.startsWith('xref-child-tb|'))).toEqual([
      VISRETAIN_LAYER,
    ]);
    expect(layerNames(model).some((n) => n.startsWith('xref-child-ovl|'))).toBe(true);
    // The grandchild was the attachment's load's, and the overlay still draws it: it is the
    // overlay's now, so the save still leaves it out.
    expect(model.blocks.get(grandchild)?.xrefLoaded?.length).toBeGreaterThan(0);
    expect(model.blocks.get(ovl)?.xrefLoaded).toContain(grandchild);
    // An unloaded xref waits for no file, and the references stay.
    expect(unloadedXrefs(model)).toEqual([]);
    expect(insertsOf(model, child)).toHaveLength(1);
    // Unloading changes what the drawing shows, not the drawing.
    const summary = triyaToAcad(readCadDocument(bytesOf(XREF_PARENT)), model, 'dxf');
    expect(summary).toMatchObject({ updated: 0, added: 0, removed: 0 });
    expect(withoutXrefContent(model).blocks.get(child)?.xrefUnloaded).toBeUndefined();
  });

  it('reloads the attached child: it waits for its file, then loads as it did', () => {
    const session = loadedParent();
    const model = session.model;
    const before = shape(model);
    const child = handleOf(model, 'xref-child-tb');
    expect(session.edit({ kind: 'xref-unload', block: child, reload: true })).toMatchObject({
      ok: true,
    });
    expect(model.blocks.get(child)?.xrefUnloaded).toBeUndefined();
    expect(unloadedXrefs(model).map((x) => x.name)).toEqual(['xref-child-tb']);
    load(session, 'xref-child-tb', XREF_CHILD);
    expect(shape(model)).toEqual(before);
  });

  it('unloads the overlay with its XCLIP kept, and an unloaded xref again', () => {
    const session = loadedParent();
    const model = session.model;
    const ovl = handleOf(model, 'xref-child-ovl');
    expect(session.edit({ kind: 'xref-unload', block: ovl })).toMatchObject({ ok: true });
    expect([...model.objects.values()].filter((o) => o.type === 'SPATIAL_FILTER')).toHaveLength(1);
    expect(layerNames(model).some((n) => n.startsWith('xref-child-ovl|'))).toBe(false);
    const again = session.edit({ kind: 'xref-unload', block: ovl });
    expect(again).toMatchObject({ ok: true, change: {} });
  });

  it('refuses to unload a nested xref, which reloads with its own file', () => {
    const session = loadedParent();
    const model = session.model;
    const grandchild = handleOf(model, 'xref-grandchild');
    expect(session.edit({ kind: 'xref-unload', block: grandchild })).toEqual({
      ok: false,
      message: 'xref-grandchild is nested in xref-child-tb: unload xref-child-tb instead.',
    });
    expect(session.edit({ kind: 'xref-unload', block: grandchild, reload: true })).toMatchObject({
      ok: true,
    });
    expect(model.blockEntities(grandchild)).toEqual([]);
    expect(layerNames(model).some((n) => n.startsWith('xref-grandchild|'))).toBe(false);
    load(session, 'xref-grandchild', XREF_GRANDCHILD);
    expect(shape(model)).toEqual(shape(loadedParent().model));
  });

  it('refuses what is no xref', () => {
    const session = loadedParent();
    const ms = handleOf(session.model, '*Model_Space');
    expect(session.edit({ kind: 'xref-unload', block: ms })).toEqual({
      ok: false,
      message: '*Model_Space is not an external reference.',
    });
    expect(session.edit({ kind: 'xref-detach', blocks: [ms] })).toEqual({
      ok: false,
      message: '*Model_Space is not an external reference.',
    });
    expect(session.edit({ kind: 'xref-unload', block: 'FFFFF' })).toEqual({
      ok: false,
      message: 'No block FFFFF.',
    });
  });
});

describe('XREF Detach (M5-04)', () => {
  it('detaches the overlay: its reference, XCLIP, block and content go, and the save writes it', () => {
    const session = loadedParent();
    const model = session.model;
    const ovl = handleOf(model, 'xref-child-ovl');
    const r = session.edit({ kind: 'xref-detach', blocks: [ovl] });
    expect(r).toMatchObject({ ok: true });
    expect(recordNamed(model, 'xref-child-ovl')).toBeUndefined();
    expect(model.blocks.has(ovl)).toBe(false);
    expect(insertsOf(model, ovl)).toEqual([]);
    expect([...model.objects.values()].some((o) => o.type === 'SPATIAL_FILTER')).toBe(false);
    expect(layerNames(model).some((n) => n.startsWith('xref-child-ovl|'))).toBe(false);
    expect(session.undoState.nextUndo).toBe('XREF');

    const saved = resaved(model);
    const names = (saved.tables?.blockRecords ?? []).map((b) => b.name);
    expect(names).toContain('xref-child-tb');
    expect(names).not.toContain('xref-child-ovl');
    expect((saved.objects ?? []).some((o) => o.type === 'SPATIAL_FILTER')).toBe(false);
    expect(
      (saved.entities ?? []).filter((e) => e.geom.kind === 'INSERT').map((e) => e.handle),
    ).toEqual(
      (initOf(XREF_PARENT).entities ?? [])
        .filter((e) => e.geom.kind === 'INSERT' && e.geom.block !== ovl)
        .map((e) => e.handle),
    );
  });

  it('detaches the attachment with the layer the drawing kept of it (VISRETAIN)', () => {
    const session = loadedParent();
    const model = session.model;
    const child = handleOf(model, 'xref-child-tb');
    const grandchild = handleOf(model, 'xref-grandchild');
    expect(session.edit({ kind: 'xref-detach', blocks: [child] })).toMatchObject({ ok: true });
    expect(layerNames(model).some((n) => n.startsWith('xref-child-tb|'))).toBe(false);
    // The overlay still draws the grandchild.
    expect(model.blocks.get(grandchild)?.xrefLoaded?.length).toBeGreaterThan(0);
    const saved = resaved(model);
    expect((saved.tables?.layers ?? []).map((l) => l.name)).not.toContain(VISRETAIN_LAYER);
    expect((saved.tables?.blockRecords ?? []).map((b) => b.name)).not.toContain('xref-child-tb');
  });

  it('detaches an xref that is not loaded, and both at once', () => {
    const session = new EngineSession(initOf(XREF_PARENT));
    const model = session.model;
    const blocks = ['xref-child-tb', 'xref-child-ovl'].map((n) => handleOf(model, n));
    expect(session.edit({ kind: 'xref-detach', blocks })).toMatchObject({ ok: true });
    expect(unloadedXrefs(model)).toEqual([]);
    const saved = resaved(model);
    expect((saved.blocks ?? []).some((b) => b.xrefPath !== undefined)).toBe(false);
    expect((saved.tables?.layers ?? []).some((l) => l.name.includes('|'))).toBe(false);
  });

  it('detaches both loaded children at once, the grandchild going with them', () => {
    const session = loadedParent();
    const model = session.model;
    const blocks = ['xref-child-tb', 'xref-child-ovl'].map((n) => handleOf(model, n));
    expect(session.edit({ kind: 'xref-detach', blocks })).toMatchObject({ ok: true });
    expect(recordNamed(model, 'xref-grandchild')).toBeUndefined();
    expect(layerNames(model).some((n) => n.includes('|'))).toBe(false);
    expect(shape(model)).toEqual(shape(resavedModel(model)));
  });

  it('takes the layers that go out of the layer states, and unloading keeps them by name', () => {
    const states = (model: DocumentModel) =>
      [...model.objects.values()].filter((o): o is LayerState => o.type === 'LAYER_STATE');
    const entry = (model: DocumentModel, name: string) =>
      states(model)[0]!.layers.find((e) => e.name === name);
    const unloaded = loadedParent();
    expect(unloaded.edit({ kind: 'layer-state-save', name: 'ALL' })).toMatchObject({ ok: true });
    const tb = handleOf(unloaded.model, 'xref-child-tb');
    expect(entry(unloaded.model, 'xref-child-tb|TB-FRAME')?.layer).toBeDefined();
    unloaded.edit({ kind: 'xref-unload', block: tb });
    expect(entry(unloaded.model, 'xref-child-tb|TB-FRAME')).toBeDefined();
    expect(entry(unloaded.model, 'xref-child-tb|TB-FRAME')?.layer).toBeUndefined();

    const detached = loadedParent();
    detached.edit({ kind: 'layer-state-save', name: 'ALL' });
    detached.edit({ kind: 'xref-detach', blocks: [handleOf(detached.model, 'xref-child-tb')] });
    expect(entry(detached.model, VISRETAIN_LAYER)).toBeUndefined();
    expect(entry(detached.model, 'xref-child-tb|TB-FRAME')).toBeUndefined();
    expect(entry(detached.model, 'xref-child-ovl|TB-FRAME')?.layer).toBeDefined();
  });

  it('refuses a nested xref', () => {
    const session = loadedParent();
    const grandchild = handleOf(session.model, 'xref-grandchild');
    expect(session.edit({ kind: 'xref-detach', blocks: [grandchild] })).toEqual({
      ok: false,
      message: 'xref-grandchild is nested in xref-child-tb and cannot be detached.',
    });
  });
});

describe('-XREF (M5-04)', () => {
  function bus(model: DocumentModel) {
    const requests: ViewRequest[] = [];
    const b = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r) => {
          requests.push(r);
          return Promise.resolve(
            r.op === 'xref'
              ? { ok: true, messages: [`${r.action} ${r.blocks.length}`] }
              : { ok: true },
          );
        },
      },
    });
    const log: string[] = [];
    b.on((e: BusEvent) => {
      if (e.type === 'log') log.push(e.line);
    });
    return { bus: b, log, requests };
  }

  it('lists the xrefs with their saved paths', async () => {
    const model = loadedParent().model;
    const t = bus(model);
    await t.bus.script(['-XREF']);
    expect(t.bus.promptText).toBe(
      'Enter an option [?/Bind/Detach/Unload/Reload/Overlay/Attach] <Attach>:',
    );
    await t.bus.script(['?', '']);
    const at = t.log.findIndex((l) => l.startsWith('Xref Name'));
    expect(t.log.slice(at + 2, at + 6)).toEqual([
      'xref-child-tb       .\\xref-child-tb.dxf',
      'xref-child-ovl      .\\xref-child-tb.dxf  (Overlay)',
      'xref-grandchild     .\\xref-grandchild.dxf',
      'Total Xref(s): 3',
    ]);
  });

  it('detaches by pattern as one undo step, leaving nested ones', async () => {
    const model = loadedParent().model;
    const t = bus(model);
    await t.bus.script(['-XREF', 'Detach', 'xref-*']);
    expect(t.log).toContain(
      'Xref "xref-grandchild" is nested in "xref-child-tb" and cannot be detached.',
    );
    expect(t.log).toContain('Detaching Xref "xref-child-tb".');
    expect(recordNamed(model, 'xref-child-tb')).toBeUndefined();
    expect(recordNamed(model, 'xref-child-ovl')).toBeUndefined();
    await t.bus.script(['U']);
    expect(recordNamed(model, 'xref-child-tb')).toBeDefined();
    expect(shape(model)).toEqual(shape(loadedParent().model));
  });

  it('asks the app to unload and reload, and says when nothing matches', async () => {
    const model = loadedParent().model;
    const t = bus(model);
    await t.bus.script(['-XREF', 'Unload', '*']);
    expect(t.requests.at(-1)).toEqual({
      op: 'xref',
      action: 'unload',
      blocks: ['xref-child-tb', 'xref-child-ovl'].map((n) => handleOf(model, n)),
    });
    expect(t.log).toContain('unload 2');
    await t.bus.script(['-XREF', 'Reload', 'xref-grand*']);
    expect(t.requests.at(-1)).toMatchObject({
      action: 'reload',
      blocks: [handleOf(model, 'xref-grandchild')],
    });
    await t.bus.script(['-XREF', 'Reload', 'nothing']);
    expect(t.log).toContain('No matching xref names found.');
  });

  it('XREF and EXTERNALREFERENCES open the References palette', async () => {
    const t = bus(loadedParent().model);
    await t.bus.script(['XREF']);
    await t.bus.script(['EXTERNALREFERENCESCLOSE']);
    expect(t.requests).toEqual([
      { op: 'palette', palette: 'references', open: true },
      { op: 'palette', palette: 'references', open: false },
    ]);
  });
});
