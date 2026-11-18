// M5-04 part 7: XBIND on the thread-authored xref set (M1-21), and the DXF it saves: the bound
// copies are the drawing's own records and blocks, read back without the xref files, and CI's
// ezdxf audit reads the save (`fixtures__xref__xref-parent.dxf.xbind.dxf`, audit.py
// `FIXTURE_SAVES`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type DocumentInit,
  type DocumentModel,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';
import { VISRETAIN_LAYER, XREF_CHILD, XREF_GRANDCHILD, XREF_PARENT } from './fixture';

const DIR = fileURLToPath(new URL('../../fixtures/xref/', import.meta.url));
const bytesOf = (name: string) => new Uint8Array(readFileSync(DIR + name));
const initOf = (name: string): DocumentInit => openDocument(readCadDocument(bytesOf(name))).init;

/** Where the audit gate finds the save (scripts/dxf-audit/audit.py `FIXTURE_SAVES`). */
const AUDIT_PATH = 'fixtures/xref/xref-parent.dxf';

const recordNamed = (model: DocumentModel, name: string) =>
  [...model.tables.blockRecords.values()].find((r) => r.name === name);
const layerNamed = (model: DocumentModel, name: string) =>
  [...model.tables.layers.values()].find((l) => l.name === name);

function load(session: EngineSession, name: string, file: string): void {
  const r = session.edit({
    kind: 'xref-load',
    block: recordNamed(session.model, name)!.handle,
    drawing: initOf(file),
  });
  expect(r).toMatchObject({ ok: true });
}

/** The parent with its xrefs loaded, and a bus on its session, as the app runs commands. */
function loadedParent() {
  const session = new EngineSession(initOf(XREF_PARENT));
  load(session, 'xref-child-tb', XREF_CHILD);
  load(session, 'xref-child-ovl', XREF_CHILD);
  load(session, 'xref-grandchild', XREF_GRANDCHILD);
  const log: string[] = [];
  const bus = new PromptBus({ model: session.model, registry: builtinCommands() });
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  return { session, model: session.model, bus, log };
}

const save = (model: DocumentModel): Uint8Array =>
  saveAc1032Dxf(readCadDocument(bytesOf(XREF_PARENT)), model);
const reopened = (bytes: Uint8Array): DocumentModel =>
  new EngineSession(openDocument(readCadDocument(bytes)).init).model;

describe('XBIND on the xref set (M5-04 part 7)', () => {
  it("binds the child's block, a layer the drawing retains and the grandchild's layer; the save keeps them", async () => {
    const t = loadedParent();
    await t.bus.script(['-XBIND', 'B', 'xref-child-tb|LOGO']);
    await t.bus.script(['-XBIND', 'LA', `${VISRETAIN_LAYER},xref-grandchild|GC`]);
    expect(t.log).toEqual(
      expect.arrayContaining([
        'Block "xref-child-tb|LOGO" bound as "xref-child-tb$0$LOGO".',
        `Layer "${VISRETAIN_LAYER}" bound as "xref-child-tb$0$TB-LINES".`,
        'Layer "xref-grandchild|GC" bound as "xref-grandchild$0$GC".',
      ]),
    );
    const logo = recordNamed(t.model, 'xref-child-tb$0$LOGO')!;
    const drawn = t.model.blockEntities(logo.handle).length;
    expect(drawn).toBe(
      t.model.blockEntities(recordNamed(t.model, 'xref-child-tb|LOGO')!.handle).length,
    );
    // The retained layer's copy keeps the drawing's colour for it (red, VISRETAIN).
    expect(layerNamed(t.model, 'xref-child-tb$0$TB-LINES')?.color).toEqual({
      kind: 'aci',
      index: 1,
    });

    const out = save(t.model);
    writeAuditSave(AUDIT_PATH, 'xbind', () => out);
    const back = reopened(out);
    // The xrefs wait for their files again; the bound copies are the drawing's.
    const backLogo = recordNamed(back, 'xref-child-tb$0$LOGO')!;
    expect(back.blocks.get(backLogo.handle)?.xrefPath).toBeUndefined();
    expect((backLogo.flags ?? 0) & (4 | 8 | 16 | 32)).toBe(0);
    expect(back.blockEntities(backLogo.handle)).toHaveLength(drawn);
    for (const n of ['xref-child-tb$0$TB-LINES', 'xref-grandchild$0$GC']) {
      expect((layerNamed(back, n)?.flags ?? 0) & (16 | 32), n).toBe(0);
    }
    expect(layerNamed(back, 'xref-child-tb$0$TB-LINES')?.color).toEqual({ kind: 'aci', index: 1 });
    expect(layerNamed(back, 'xref-grandchild$0$GC')?.color).toEqual({ kind: 'aci', index: 6 });
    // The drawing's retained record is still the xref's.
    expect(layerNamed(back, VISRETAIN_LAYER)).toBeDefined();
    expect(recordNamed(back, 'xref-child-tb|LOGO')).toBeUndefined();
  });

  it('is one undo step: U takes the bound copies back', async () => {
    const t = loadedParent();
    const layers = t.model.tables.layers.size;
    await t.bus.script(['-XBIND', 'LA', 'xref-child-tb|*']);
    expect(t.model.tables.layers.size).toBeGreaterThan(layers);
    expect(t.bus.undo.state.nextUndo).toBe('XBIND');
    await t.bus.script(['U']);
    expect(t.model.tables.layers.size).toBe(layers);
  });
});
