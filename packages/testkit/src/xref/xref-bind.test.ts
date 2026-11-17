// M5-04 part 2: XREF Bind, both bind types, on the thread-authored xref set (M1-21), as the
// References palette and -XREF send it, and the self-contained DXF a bind saves (the task's
// acceptance: it round-trips, and CI's ezdxf audit reads the save, `fixtures__xref__…bind.dxf`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type DocumentInit,
  type DocumentModel,
  type LayerRecord,
  type LayerState,
  type NonGraphicalObject,
  type ViewRequest,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';
import { VISRETAIN_LAYER, XREF_CHILD, XREF_GRANDCHILD, XREF_PARENT } from './fixture';

const DIR = fileURLToPath(new URL('../../fixtures/xref/', import.meta.url));
const bytesOf = (name: string) => new Uint8Array(readFileSync(DIR + name));
const initOf = (name: string): DocumentInit => openDocument(readCadDocument(bytesOf(name))).init;

/** Where the audit gate finds the bind saves (scripts/dxf-audit/audit.py `FIXTURE_SAVES`). */
const AUDIT_PATH = 'fixtures/xref/xref-parent.dxf';

const recordNamed = (model: DocumentModel, name: string) =>
  [...model.tables.blockRecords.values()].find((r) => r.name === name);
const handleOf = (model: DocumentModel, name: string) => recordNamed(model, name)!.handle;
const layerNamed = (model: DocumentModel, name: string): LayerRecord | undefined =>
  [...model.tables.layers.values()].find((l) => l.name === name);
const layerNames = (model: DocumentModel) =>
  [...model.tables.layers.values()].map((l) => l.name).sort();
const blockNames = (model: DocumentModel) => [...model.blocks.values()].map((b) => b.name).sort();

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

/** What the model draws and keeps, without handles. */
const shape = (model: DocumentModel) => ({
  layers: layerNames(model),
  blocks: blockNames(model),
  entities: [...model.entities()].length,
  objects: [...model.objects.values()].map((o) => o.type).sort(),
});

/** Each block's entity count, by name. */
const contents = (model: DocumentModel, names: readonly string[]) =>
  Object.fromEntries(names.map((n) => [n, model.blockEntities(handleOf(model, n)).length]));

const save = (model: DocumentModel): Uint8Array =>
  saveAc1032Dxf(readCadDocument(bytesOf(XREF_PARENT)), model);
const reopened = (bytes: Uint8Array): DocumentModel =>
  new EngineSession(openDocument(readCadDocument(bytes)).init).model;

const XREF_BITS = 4 | 8;
const DEPENDENT_BITS = 16 | 32;

describe('XREF Bind (M5-04 part 2)', () => {
  it('binds the attached child as a block: its symbols become xref$0$name', () => {
    const session = loadedParent();
    const model = session.model;
    const before = shape(model);
    const child = handleOf(model, 'xref-child-tb');
    const ovl = handleOf(model, 'xref-child-ovl');
    const grandchild = handleOf(model, 'xref-grandchild');
    const drawn = model.blockEntities(child).length;
    expect(session.edit({ kind: 'xref-bind', blocks: [child] })).toMatchObject({ ok: true });

    // The xref is an ordinary block now, its content the drawing's.
    const record = model.tables.blockRecords.get(child)!;
    expect((record.flags ?? 0) & (XREF_BITS | DEPENDENT_BITS)).toBe(0);
    const def = model.blocks.get(child)!;
    expect(def.xrefPath).toBeUndefined();
    expect(def.xrefLoaded).toBeUndefined();
    expect(model.blockEntities(child)).toHaveLength(drawn);
    // Bind: `xref|name` is `xref$0$name`, the VISRETAIN layer keeping the host's red.
    const bound = layerNames(model).filter((n) => n.startsWith('xref-child-tb'));
    expect(bound).toEqual([
      'xref-child-tb$0$TB-FRAME',
      'xref-child-tb$0$TB-LINES',
      'xref-child-tb$0$TB-LOGO',
    ]);
    expect(layerNamed(model, 'xref-child-tb$0$TB-LINES')?.color).toEqual({ kind: 'aci', index: 1 });
    for (const n of [...bound, 'xref-grandchild$0$GC'])
      expect((layerNamed(model, n)!.flags ?? 0) & DEPENDENT_BITS, n).toBe(0);
    expect(recordNamed(model, 'xref-child-tb$0$LOGO')).toBeDefined();
    // The nested xref is bound with it, as a block of its own name.
    expect((model.tables.blockRecords.get(grandchild)!.flags ?? 0) & XREF_BITS).toBe(0);
    expect(model.blocks.get(grandchild)?.xrefPath).toBeUndefined();
    expect(model.blocks.get(grandchild)?.xrefLoaded).toBeUndefined();
    expect(layerNamed(model, 'xref-grandchild|GC')).toBeUndefined();
    // The overlay is still an xref, drawing the grandchild that is a block now.
    expect(model.blocks.get(ovl)?.xrefLoaded).not.toContain(grandchild);
    expect(layerNamed(model, 'xref-child-ovl|TB-FRAME')).toBeDefined();
    expect([...model.entities()]).toHaveLength(before.entities);

    // One undo step (-XREF Bind's test below undoes it).
    expect(session.undoState.nextUndo).toBe('XREF');
  });

  it('saves the bound child in the DXF, which opens without the xref files', () => {
    const session = loadedParent();
    const model = session.model;
    const child = handleOf(model, 'xref-child-tb');
    session.edit({ kind: 'xref-bind', blocks: [child] });
    const out = save(model);
    writeAuditSave(AUDIT_PATH, 'bind', () => out);
    const back = reopened(out);
    const names = ['xref-child-tb', 'xref-child-tb$0$LOGO', 'xref-grandchild'];
    expect(contents(back, names)).toEqual(contents(model, names));
    for (const n of names) {
      expect(back.blocks.get(handleOf(back, n))?.xrefPath, n).toBeUndefined();
      expect((recordNamed(back, n)!.flags ?? 0) & XREF_BITS, n).toBe(0);
    }
    expect(layerNames(back).filter((n) => n.includes('$0$'))).toEqual([
      'xref-child-tb$0$TB-FRAME',
      'xref-child-tb$0$TB-LINES',
      'xref-child-tb$0$TB-LOGO',
      'xref-grandchild$0$GC',
    ]);
    expect(layerNamed(back, VISRETAIN_LAYER)).toBeUndefined();
    const defs = [...back.objects.values()].filter((o) => o.type === 'IMAGEDEF');
    expect(defs.map((d) => (d as unknown as { name: string }).name)).toEqual(['xref-stamp']);
    // The overlay is still an xref, waiting for its file; its XCLIP stays.
    expect(back.blocks.get(handleOf(back, 'xref-child-ovl'))?.xrefPath).toBe(
      '.\\xref-child-tb.dxf',
    );
    expect([...back.objects.values()].filter((o) => o.type === 'SPATIAL_FILTER')).toHaveLength(1);
    // Saved again as opened: nothing changes.
    expect(shape(reopened(saveAc1032Dxf(readCadDocument(out), back)))).toEqual(shape(back));
  });

  it('binds as Insert: symbols take their own names, and the drawing’s own win', () => {
    const session = loadedParent();
    const model = session.model;
    expect(session.edit({ kind: 'layer-new', name: 'TB-FRAME' })).toMatchObject({ ok: true });
    const hostFrame = layerNamed(model, 'TB-FRAME')!.handle;
    const child = handleOf(model, 'xref-child-tb');
    const childFrame = layerNamed(model, 'xref-child-tb|TB-FRAME')!.handle;
    const onChildFrame = [...model.entities()].filter((e) => e.layer === childFrame).length;
    expect(onChildFrame).toBeGreaterThan(0);
    expect(session.edit({ kind: 'xref-bind', blocks: [child], insert: true })).toMatchObject({
      ok: true,
    });
    expect(layerNames(model).filter((n) => n.startsWith('xref-child-tb'))).toEqual([]);
    expect(layerNames(model)).toEqual(
      expect.arrayContaining(['TB-FRAME', 'TB-LINES', 'TB-LOGO', 'GC']),
    );
    expect(layerNames(model).filter((n) => n === 'TB-FRAME')).toHaveLength(1);
    expect(model.tables.layers.has(childFrame)).toBe(false);
    expect([...model.entities()].filter((e) => e.layer === hostFrame)).toHaveLength(onChildFrame);
    // The VISRETAIN layer is the drawing's TB-LINES now, red as the host kept it.
    expect(layerNamed(model, 'TB-LINES')?.color).toEqual({ kind: 'aci', index: 1 });
    expect(recordNamed(model, 'LOGO')).toBeDefined();
    const out = save(model);
    writeAuditSave(AUDIT_PATH, 'bind-insert', () => out);
    const back = reopened(out);
    expect(contents(back, ['xref-child-tb', 'LOGO', 'xref-grandchild'])).toEqual(
      contents(model, ['xref-child-tb', 'LOGO', 'xref-grandchild']),
    );
    expect(
      layerNames(back).filter((n) => n.includes('|') && !n.startsWith('xref-child-ovl')),
    ).toEqual([]);
  });

  it('numbers a bound name past those the drawing has', () => {
    const session = loadedParent();
    const model = session.model;
    session.edit({ kind: 'layer-new', name: 'xref-child-tb$0$TB-FRAME' });
    session.edit({ kind: 'xref-bind', blocks: [handleOf(model, 'xref-child-tb')] });
    expect(layerNamed(model, 'xref-child-tb$1$TB-FRAME')).toBeDefined();
    expect(layerNamed(model, 'xref-child-tb$0$TB-LINES')).toBeDefined();
  });

  it('binds the overlay, taking the grandchild the attachment brought in', () => {
    const session = loadedParent();
    const model = session.model;
    const child = handleOf(model, 'xref-child-tb');
    const ovl = handleOf(model, 'xref-child-ovl');
    const grandchild = handleOf(model, 'xref-grandchild');
    expect(model.blocks.get(child)?.xrefLoaded).toContain(grandchild);
    expect(session.edit({ kind: 'xref-bind', blocks: [ovl] })).toMatchObject({ ok: true });
    expect(model.blocks.get(child)?.xrefLoaded).not.toContain(grandchild);
    expect(model.blocks.get(grandchild)?.xrefPath).toBeUndefined();
    expect(layerNamed(model, 'xref-child-ovl$0$TB-FRAME')).toBeDefined();
    // The overlay's XCLIP stays on its reference.
    expect([...model.objects.values()].filter((o) => o.type === 'SPATIAL_FILTER')).toHaveLength(1);
    // The attachment unloads without the grandchild, a block of the drawing now.
    expect(session.edit({ kind: 'xref-unload', block: child })).toMatchObject({ ok: true });
    expect(model.blockEntities(grandchild).length).toBeGreaterThan(0);
    const back = reopened(save(model));
    expect(contents(back, ['xref-child-ovl', 'xref-grandchild'])).toEqual(
      contents(model, ['xref-child-ovl', 'xref-grandchild']),
    );
    expect(back.blocks.get(handleOf(back, 'xref-child-tb'))?.xrefPath).toBe('.\\xref-child-tb.dxf');
  });

  it('binds both children at once, and the layer states follow the new names', () => {
    const session = loadedParent();
    const model = session.model;
    session.edit({ kind: 'layer-state-save', name: 'ALL' });
    const blocks = ['xref-child-tb', 'xref-child-ovl'].map((n) => handleOf(model, n));
    expect(session.edit({ kind: 'xref-bind', blocks })).toMatchObject({ ok: true });
    expect(layerNames(model).some((n) => n.includes('|'))).toBe(false);
    const state = [...model.objects.values()].find(
      (o): o is LayerState => o.type === 'LAYER_STATE',
    )!;
    const entry = state.layers.find((e) => e.name === 'xref-child-tb$0$TB-FRAME');
    expect(entry?.layer).toBe(layerNamed(model, 'xref-child-tb$0$TB-FRAME')!.handle);
    expect(shape(reopened(save(model)))).toEqual(shape(model));
  });

  it('files what a load gives no dictionary: draw order, an XCLIP, image and PDF definitions', () => {
    // The child as a drafter may have left it: two dividers in another draw order, its logo
    // XCLIPped, a PDF underlay's definition; the overlay's load finds another stamp file.
    const child = initOf(XREF_CHILD);
    const entities = child.entities ?? [];
    const space = (child.tables?.blockRecords ?? []).find((r) => r.name === '*Model_Space')!;
    const lines = entities.filter((e) => e.owner === space.handle && e.geom.kind === 'LINE');
    const logo = entities.find((e) => e.geom.kind === 'INSERT' && e.owner === space.handle)!;
    const clip = (initOf(XREF_PARENT).objects ?? []).find((o) => o.type === 'SPATIAL_FILTER')!;
    const objects = [
      ...(child.objects ?? []),
      {
        type: 'SORTENTSTABLE',
        handle: 'FF00',
        owner: 'FF01',
        block: space.handle,
        entries: [
          { entity: lines[0]!.handle, sort: lines[1]!.handle },
          { entity: lines[1]!.handle, sort: lines[0]!.handle },
        ],
      },
      { ...clip, handle: 'FF02', owner: 'FF03', reactors: ['FF03'], insert: logo.handle },
      {
        type: 'PDFDEFINITION',
        handle: 'FF04',
        owner: 'FF05',
        name: 'sheet',
        fileName: '.\\sheet.pdf',
        page: '1',
      },
    ] as NonGraphicalObject[];
    const drafted: DocumentInit = { ...child, handSeed: 'FF10', objects };
    const otherStamp: DocumentInit = {
      ...drafted,
      objects: objects.map((o) =>
        o.type === 'IMAGEDEF' ? ({ ...o, fileName: '.\\other.png' } as NonGraphicalObject) : o,
      ),
    };
    const session = new EngineSession(initOf(XREF_PARENT));
    const model = session.model;
    for (const [name, drawing] of [
      ['xref-child-tb', drafted],
      ['xref-child-ovl', otherStamp],
      ['xref-grandchild', initOf(XREF_GRANDCHILD)],
    ] as const) {
      expect(
        session.edit({ kind: 'xref-load', block: handleOf(model, name), drawing }),
      ).toMatchObject({ ok: true });
    }
    const blocks = ['xref-child-tb', 'xref-child-ovl'].map((n) => handleOf(model, n));
    expect(session.edit({ kind: 'xref-bind', blocks, insert: true })).toMatchObject({ ok: true });
    const of = (type: string) => [...model.objects.values()].filter((o) => o.type === type);
    // One stamp definition per file: the overlay's is renamed, as Bind names one.
    expect(
      of('IMAGEDEF')
        .map((d) => (d as unknown as { name: string }).name)
        .sort(),
    ).toEqual(['xref-child-ovl$0$xref-stamp', 'xref-stamp']);
    // The two loads' PDF definitions are one file: the first stays, the images of the other show it.
    expect(of('PDFDEFINITION')).toHaveLength(1);
    // Insert: the overlay's LOGO is the attachment's, which is the drawing's LOGO now.
    expect(blockNames(model).filter((n) => n.includes('LOGO'))).toEqual(['LOGO']);
    const logoBlock = handleOf(model, 'LOGO');
    const refs = [...model.entities()].filter(
      (e) => e.geom.kind === 'INSERT' && e.geom.block === logoBlock,
    );
    expect(refs).toHaveLength(2);
    // Each reference's XCLIP sits in its new extension dictionary's ACAD_FILTER.
    const filters = of('SPATIAL_FILTER') as unknown as {
      insert: string;
      owner: string;
      reactors: string[];
    }[];
    expect(filters).toHaveLength(3);
    for (const r of refs) {
      const f = filters.find((x) => x.insert === r.handle)!;
      expect(r.extDict).toBeDefined();
      expect(f.reactors).toEqual([f.owner]);
    }
    // Each block's draw order table sits in its block's new extension dictionary.
    for (const t of of('SORTENTSTABLE') as unknown as { block: string; owner: string }[])
      expect(model.tables.blockRecords.get(t.block)?.extDict).toBe(t.owner);
    expect(of('SORTENTSTABLE')).toHaveLength(2);

    const out = save(model);
    writeAuditSave(AUDIT_PATH, 'bind-objects', () => out);
    const back = reopened(out);
    expect(shape(back)).toEqual(shape(model));
    expect(contents(back, ['xref-child-tb', 'xref-child-ovl', 'LOGO'])).toEqual(
      contents(model, ['xref-child-tb', 'xref-child-ovl', 'LOGO']),
    );
  });

  it('refuses a nested xref, an unloaded one and a block that is no xref', () => {
    const session = loadedParent();
    const model = session.model;
    const grandchild = handleOf(model, 'xref-grandchild');
    expect(session.edit({ kind: 'xref-bind', blocks: [grandchild] })).toEqual({
      ok: false,
      message: 'xref-grandchild is nested in xref-child-tb and cannot be bound.',
    });
    const child = handleOf(model, 'xref-child-tb');
    session.edit({ kind: 'xref-unload', block: child });
    expect(session.edit({ kind: 'xref-bind', blocks: [child] })).toEqual({
      ok: false,
      message: 'xref-child-tb is not loaded: reload it to bind it.',
    });
    const space = handleOf(model, '*Model_Space');
    expect(session.edit({ kind: 'xref-bind', blocks: [space] })).toEqual({
      ok: false,
      message: '*Model_Space is not an external reference.',
    });
    expect(session.edit({ kind: 'xref-bind', blocks: ['FFFFFF'] })).toEqual({
      ok: false,
      message: 'No block FFFFFF.',
    });
  });

  it('refuses an xref whose nested xref was not found', () => {
    const session = new EngineSession(initOf(XREF_PARENT));
    load(session, 'xref-child-tb', XREF_CHILD);
    const child = handleOf(session.model, 'xref-child-tb');
    expect(session.edit({ kind: 'xref-bind', blocks: [child] })).toEqual({
      ok: false,
      message: 'xref-child-tb cannot be bound: its nested xref xref-grandchild is not loaded.',
    });
  });
});

describe('-XREF Bind (M5-04 part 2)', () => {
  function bus(model: DocumentModel, bindType?: number) {
    const requests: ViewRequest[] = [];
    const b = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r) => {
          requests.push(r);
          if (r.op === 'sysvar' && r.name === 'BINDTYPE' && r.value === undefined)
            return Promise.resolve(
              bindType === undefined ? { ok: false, message: 'no' } : { ok: true, value: bindType },
            );
          return Promise.resolve({ ok: true });
        },
      },
    });
    const log: string[] = [];
    b.on((e: BusEvent) => {
      if (e.type === 'log') log.push(e.line);
    });
    return { bus: b, log, requests };
  }

  it('binds the xrefs named, with BINDTYPE 0, as one undo step', async () => {
    const model = loadedParent().model;
    const t = bus(model, 0);
    await t.bus.script(['-XREF']);
    expect(t.bus.promptText).toBe('Enter an option [?/Bind/Detach/Unload/Reload]:');
    await t.bus.script(['Bind', 'xref-*']);
    expect(t.bus.promptText).toBe('Command:');
    expect(t.log).toContain(
      'Xref "xref-grandchild" is nested in "xref-child-tb" and cannot be bound.',
    );
    expect(t.log).toContain('Binding Xref "xref-child-tb".');
    expect(t.log).toContain('Binding Xref "xref-child-ovl".');
    expect(layerNamed(model, 'xref-child-tb$0$TB-FRAME')).toBeDefined();
    await t.bus.script(['U']);
    expect(shape(model)).toEqual(shape(loadedParent().model));
  });

  it('binds as Insert with BINDTYPE 1, and refuses an unloaded xref', async () => {
    const session = loadedParent();
    const model = session.model;
    const t = bus(model, 1);
    await t.bus.script(['-XREF', 'Bind', 'xref-child-tb']);
    expect(layerNamed(model, 'TB-FRAME')).toBeDefined();
    session.edit({ kind: 'xref-unload', block: handleOf(model, 'xref-child-ovl') });
    await t.bus.script(['-XREF', 'Bind', 'xref-child-ovl']);
    expect(t.log).toContain('xref-child-ovl is not loaded: reload it to bind it.');
    expect(recordNamed(model, 'xref-child-ovl')?.flags).toBe(4 | 8);
  });

  it('binds with BINDTYPE 0 when the app keeps none, and says when nothing matches', async () => {
    const model = loadedParent().model;
    const t = bus(model);
    await t.bus.script(['-XREF', 'Bind', 'xref-child-tb']);
    expect(layerNamed(model, 'xref-child-tb$0$TB-FRAME')).toBeDefined();
    await t.bus.script(['-XREF', 'Bind', 'nothing']);
    expect(t.log).toContain('No matching xref names found.');
    await t.bus.script(['-XREF', 'Bind', '']);
    expect(t.bus.promptText).toBe('Command:');
  });
});
