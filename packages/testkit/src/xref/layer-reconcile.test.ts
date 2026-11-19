// M5-19: unreconciled new layers on the thread-authored xref set (M1-21). With LAYEREVAL 1 the
// parent's own record of one of its child's layers (VISRETAIN) is the layer list last evaluated,
// so the child's other layers come in unreconciled; a reload flags only what the child gained.
// Its nested xref's layers, of which it has no record, come in as they are. XREF Bind makes them the drawing's own layers, which the save writes with AutoCAD's
// ADSK_XREC_LAYER_RECONCILED records (CI's ezdxf audit reads the save,
// `fixtures__xref__xref-parent.dxf.layer-reconcile.dxf`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  PromptBus,
  builtinCommands,
  type DocumentInit,
  type DocumentModel,
  type HeaderValue,
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
const CHILD = 'xref-child-tb';

const handleOf = (model: DocumentModel, name: string) =>
  [...model.tables.blockRecords.values()].find((r) => r.name === name)!.handle;
const unreconciled = (model: DocumentModel) =>
  [...model.tables.layers.values()]
    .filter((l) => l.unreconciled)
    .map((l) => l.name)
    .sort();
const childLayers = (model: DocumentModel) =>
  [...model.tables.layers.values()]
    .map((l) => l.name)
    .filter((n) => n.startsWith(`${CHILD}|`))
    .sort();

/** The parent with LAYEREVAL 1 and its title block loaded, as the app loads a dropped file. */
function parent(): EngineSession {
  const init = initOf(XREF_PARENT);
  const session = new EngineSession({
    ...init,
    header: new Map<string, HeaderValue>([...(init.header ?? []), ['LAYEREVAL', '1']]),
  });
  load(session, initOf(XREF_CHILD));
  // Its nested xref too, which a bind needs loaded; the parent has no record of its layers.
  load(session, initOf(XREF_GRANDCHILD), 'xref-grandchild');
  return session;
}

function load(session: EngineSession, drawing: DocumentInit, name = CHILD): void {
  const block = handleOf(session.model, name);
  expect(session.edit({ kind: 'xref-load', block, drawing })).toMatchObject({ ok: true });
}

/** The child's file with one more layer, GLASS. */
function grownChild(): DocumentInit {
  const child = initOf(XREF_CHILD);
  const zero = child.tables!.layers!.find((l) => l.name === '0')!;
  const handle = (Number.parseInt(child.handSeed, 16) + 1).toString(16).toUpperCase();
  return {
    ...child,
    handSeed: (Number.parseInt(handle, 16) + 1).toString(16).toUpperCase(),
    tables: {
      ...child.tables,
      layers: [...child.tables!.layers!, { ...zero, handle, name: 'GLASS' }],
    },
  };
}

describe('unreconciled new xref layers on the xref set (M5-19)', () => {
  it('flags the layers new to the drawing’s own record of the xref’s layers', () => {
    const model = parent().model;
    const all = childLayers(model);
    expect(all).toContain(VISRETAIN_LAYER);
    expect(unreconciled(model)).toEqual(all.filter((n) => n !== VISRETAIN_LAYER));
  });

  it('flags what a reload brings that the last load did not, and -LAYER rEconcile clears it', async () => {
    const session = parent();
    const model = session.model;
    const bus = new PromptBus({ model, registry: builtinCommands() });
    await bus.script(['-LAYER', 'E', `${CHILD}|*`, '']);
    expect(unreconciled(model)).toEqual([]);
    const block = handleOf(model, CHILD);
    expect(session.edit({ kind: 'xref-unload', block, reload: true })).toMatchObject({ ok: true });
    load(session, grownChild());
    expect(unreconciled(model)).toEqual([`${CHILD}|GLASS`]);
  });

  it('saves the bound layers’ states as AutoCAD files them, and reads them back', async () => {
    const session = parent();
    const model = session.model;
    const flagged = unreconciled(model);
    expect(flagged.length).toBeGreaterThan(1);
    // One reconciled before the bind, the others still new.
    const bus = new PromptBus({ model, registry: builtinCommands() });
    await bus.script(['-LAYER', 'E', flagged[0]!, '']);
    const bindResult = session.edit({ kind: 'xref-bind', blocks: [handleOf(model, CHILD)] });
    expect(bindResult).toMatchObject({ ok: true });
    const bound = unreconciled(model);
    expect(bound).toEqual(flagged.slice(1).map((n) => n.replace('|', '$0$')));

    const out = saveAc1032Dxf(readCadDocument(bytesOf(XREF_PARENT)), model);
    writeAuditSave(AUDIT_PATH, 'layer-reconcile', () => out);
    const back = new EngineSession(openDocument(readCadDocument(out)).init).model;
    expect(unreconciled(back)).toEqual(bound);
    // The one reconciled was never flagged in the file: it has no record, as nothing new.
    const doc = readCadDocument(out);
    const reconciledName = flagged[0]!.replace('|', '$0$');
    const layer = [...doc.layers!].find((l) => l.name === reconciledName)!;
    expect(layer.xDictionary).toBeNull();
  });
});
