// The xref test drawings (M1-21) stay as fixture.ts authors them, and load as the app loads
// them: each xref's file mapped by the importer and handed to the host's engine as an
// `xref-load` edit. `TRIYA_UPDATE_FIXTURES=1` rewrites the files (a DXF's header carries its
// save time, so the files are compared by what they map to, not by bytes).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  SpatialIndex,
  toleranceForSize,
  unloadedXrefs,
  type DocumentInit,
  type DocumentModel,
} from '@triya/engine';
import { openDocument, readCadDocument, triyaToAcad } from '@triya/io';
import { describe, expect, it } from 'vitest';
import {
  CHILD_AT,
  XREF_CHILD,
  XREF_GRANDCHILD,
  XREF_MISSING_OVERLAY,
  XREF_PARENT,
  xrefChildDxf,
  xrefGrandchildDxf,
  xrefParentDxf,
} from './fixture';

const DIR = fileURLToPath(new URL('../../fixtures/xref/', import.meta.url));

if (process.env['TRIYA_UPDATE_FIXTURES'] === '1') {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(DIR + XREF_PARENT, xrefParentDxf());
  writeFileSync(DIR + XREF_CHILD, xrefChildDxf());
  writeFileSync(DIR + XREF_GRANDCHILD, xrefGrandchildDxf());
}

const bytesOf = (name: string) => new Uint8Array(readFileSync(DIR + name));
const initOf = (name: string): DocumentInit => openDocument(readCadDocument(bytesOf(name))).init;

/** The fixture's drawings as written now and as committed map to the same thing. */
const comparable = (init: DocumentInit) =>
  JSON.stringify({ ...init, header: undefined }, (_k, v: unknown) =>
    typeof v === 'bigint' ? v.toString() : v,
  );

const blockNamed = (model: DocumentModel, name: string) =>
  [...model.blocks.values()].find((b) => b.name === name)!;
const layerNamed = (model: DocumentModel, name: string) =>
  [...model.tables.layers.values()].find((l) => l.name === name);

/** The parent with its xrefs loaded, as the app loads them when their files are dropped. */
function loadedParent(): EngineSession {
  const session = new EngineSession(initOf(XREF_PARENT));
  const child = initOf(XREF_CHILD);
  for (const name of ['xref-child-tb', 'xref-child-ovl']) {
    const r = session.edit({
      kind: 'xref-load',
      block: blockNamed(session.model, name).handle,
      drawing: child,
    });
    expect(r).toMatchObject({ ok: true });
  }
  const r = session.edit({
    kind: 'xref-load',
    block: blockNamed(session.model, 'xref-grandchild').handle,
    drawing: initOf(XREF_GRANDCHILD),
  });
  expect(r).toMatchObject({ ok: true });
  return session;
}

describe('xref fixture (M1-21)', () => {
  it('commits the AC1032 DXFs the generator writes', () => {
    for (const [name, write] of [
      [XREF_PARENT, xrefParentDxf],
      [XREF_CHILD, xrefChildDxf],
      [XREF_GRANDCHILD, xrefGrandchildDxf],
    ] as const) {
      expect(existsSync(DIR + name)).toBe(true);
      const doc = readCadDocument(bytesOf(name));
      expect(doc.header?.versionString).toBe('AC1032');
      expect(comparable(openDocument(doc).init)).toBe(
        comparable(openDocument(readCadDocument(write())).init),
      );
    }
  });

  it('attaches and overlays the child, which attaches the grandchild and overlays a missing file', () => {
    const parent = initOf(XREF_PARENT);
    const xrefs = (init: DocumentInit) =>
      (init.blocks ?? [])
        .filter((b) => b.xrefPath !== undefined)
        .map((b) => [
          b.name,
          b.xrefPath,
          init.tables?.blockRecords?.find((r) => r.handle === b.handle)?.flags,
        ]);
    expect(xrefs(parent)).toEqual([
      ['xref-child-tb', `.\\${XREF_CHILD}`, 4],
      ['xref-child-ovl', `.\\${XREF_CHILD}`, 12],
    ]);
    expect(xrefs(initOf(XREF_CHILD))).toEqual([
      ['xref-grandchild', `.\\${XREF_GRANDCHILD}`, 4],
      ['xref-missing-overlay', `.\\${XREF_MISSING_OVERLAY}`, 12],
    ]);
  });

  it('loads the child twice and the grandchild once, never asking for the nested overlay', () => {
    const session = new EngineSession(initOf(XREF_PARENT));
    expect(unloadedXrefs(session.model).map((r) => r.name)).toEqual([
      'xref-child-tb',
      'xref-child-ovl',
    ]);
    const model = loadedParent().model;
    expect(unloadedXrefs(model)).toEqual([]);
    expect(blockNamed(model, 'xref-missing-overlay')).toBeUndefined();
    // Each reference's layers are its own: the attachment's and the overlay's.
    for (const name of ['xref-child-tb|TB-LINES', 'xref-child-ovl|TB-LINES'])
      expect(layerNamed(model, name)?.color).toEqual({ kind: 'aci', index: 3 });
    expect(layerNamed(model, 'xref-grandchild|GC')?.flags).toBe(48);
    expect(blockNamed(model, 'xref-child-tb|LOGO')).toBeDefined();
  });

  it('bounds each reference by its content', () => {
    const model = loadedParent().model;
    const index = SpatialIndex.build(model, { tol: toleranceForSize(420) });
    // The title block (the LOGO's circle and the grandchild's square stay inside its frame).
    const child = blockNamed(model, 'xref-child-tb').handle;
    expect(index.drawnExtents(child)).toEqual({ minX: 0, minY: 0, maxX: 180, maxY: 60 });
    const ref = model
      .blockEntities(blockNamed(model, '*Model_Space').handle)
      .map((id) => model.entity(id)!)
      .find((e) => e.geom.kind === 'INSERT' && e.geom.block === child)!;
    expect(index.bounds(ref.id)).toEqual({
      kind: 'box',
      box: { minX: CHILD_AT.x, minY: CHILD_AT.y, maxX: CHILD_AT.x + 180, maxY: CHILD_AT.y + 60 },
    });
    // The grandchild's square, inside the attached child.
    const gc = blockNamed(model, 'xref-grandchild').handle;
    expect(index.drawnExtents(gc)).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 40 });
  });

  it('saves the parent without its xrefs: nothing to write', () => {
    const model = loadedParent().model;
    const summary = triyaToAcad(readCadDocument(bytesOf(XREF_PARENT)), model, 'dxf');
    expect(summary).toMatchObject({ updated: 0, added: 0, removed: 0 });
  });
});
