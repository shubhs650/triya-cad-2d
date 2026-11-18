// M5-02 part 6: REFEDIT of an xref on the thread-authored xref set (M1-21), saved back to the
// xref's own file. The parent's attachment of the title block is edited in place (an object
// erased, one moved, a line drawn) and REFCLOSE Save writes the change the engine makes to the
// title block's file, as the app does (`saveSession`: the file's own bytes and the change). The
// file written keeps every object the edit did not touch exactly as it was (the nested xref, the
// overlay the load never brought, the image), reads back with the edits, loads into the parent
// again, and CI's ezdxf audit reads it (`fixtures__xref__xref-child-tb.dxf.refedit-xref.dxf`,
// audit.py `FIXTURE_SAVES`). The parent's own save holds none of it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type ChangeSet,
  type DocumentInit,
  type DocumentModel,
  type Entity,
  type EntityId,
  type ViewReply,
  type ViewRequest,
} from '@triya/engine';
import { openDocument, readCadDocument, saveSession } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { withPinnedClock } from '../roundtrip/clock';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';
import { CHILD_AT, XREF_CHILD, XREF_GRANDCHILD, XREF_PARENT } from './fixture';

const DIR = fileURLToPath(new URL('../../fixtures/xref/', import.meta.url));
const bytesOf = (name: string) => new Uint8Array(readFileSync(DIR + name));
const initOf = (bytes: Uint8Array): DocumentInit => openDocument(readCadDocument(bytes)).init;
const modelOf = (bytes: Uint8Array): DocumentModel => new EngineSession(initOf(bytes)).model;

/** Where the audit gate finds the save (scripts/dxf-audit/audit.py `FIXTURE_SAVES`). */
const AUDIT_PATH = 'fixtures/xref/xref-child-tb.dxf';

const recordNamed = (model: DocumentModel, name: string) =>
  [...model.tables.blockRecords.values()].find((r) => r.name === name);

function load(session: EngineSession, name: string, bytes: Uint8Array): void {
  const r = session.edit({
    kind: 'xref-load',
    block: recordNamed(session.model, name)!.handle,
    drawing: initOf(bytes),
  });
  expect(r).toMatchObject({ ok: true });
}

/**
 * The parent with its xrefs loaded and a bus whose app holds the title block's file: it answers
 * `xrefDrawing` with the file as it is and writes `writeXref`'s change to it as Save writes.
 */
function loadedParent() {
  const session = new EngineSession(initOf(bytesOf(XREF_PARENT)));
  let child: Uint8Array = bytesOf(XREF_CHILD);
  load(session, 'xref-child-tb', child);
  load(session, 'xref-child-ovl', child);
  load(session, 'xref-grandchild', bytesOf(XREF_GRANDCHILD));
  const writes: { file: string; changes: readonly ChangeSet[] }[] = [];
  /** What the `nested` request answers: the references a pick goes through. */
  let path: readonly EntityId[] = [];
  const request = (r: ViewRequest): Promise<ViewReply> => {
    if (r.op === 'nested') {
      return Promise.resolve({ ok: true, nested: { path: [...path] } });
    }
    if (r.op === 'xrefDrawing')
      return Promise.resolve({ ok: true, xrefDrawing: { name: XREF_CHILD, init: initOf(child) } });
    if (r.op === 'writeXref') {
      writes.push({ file: r.file, changes: r.changes });
      child = withPinnedClock(() => saveSession(child, r.changes));
      return Promise.resolve({ ok: true, written: { file: XREF_CHILD, downloaded: false } });
    }
    return Promise.resolve({ ok: false, message: 'no view' });
  };
  const log: string[] = [];
  const bus = new PromptBus({
    model: session.model,
    registry: builtinCommands(),
    view: { request },
  });
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const nestedPath = (ids: readonly EntityId[]) => {
    path = ids;
  };
  return {
    session,
    model: session.model,
    bus,
    log,
    writes,
    child: () => child,
    nestedPath,
  };
}

/** An entity's data without its id, which only the drawing open gives. */
const data = (e: Entity) => {
  const { id: _id, ...rest } = e;
  return rest;
};

describe('REFEDIT of an xref on the xref set (M5-02 part 6)', () => {
  it("writes the edits to the title block's file, which reads back and loads again", async () => {
    const t = loadedParent();
    const tb = recordNamed(t.model, 'xref-child-tb')!.handle;
    const ms = recordNamed(t.model, '*Model_Space')!.handle;
    const reference = t.model
      .blockEntities(ms)
      .map((id) => t.model.entity(id)!)
      .find((e) => e.geom.kind === 'INSERT' && e.geom.block === tb)!;
    // The host's handles of the title block's objects, with the file's for each.
    const fileOf = new Map(t.model.blocks.get(tb)!.xrefHandles);
    const content = t.model.blockEntities(tb).map((id) => t.model.entity(id)!);
    const lines = content.filter((e) => e.geom.kind === 'LINE');
    const [erased, moved] = [lines[0]!, lines[1]!];

    await t.bus.submit('-REFEDIT');
    await t.bus.answer({ kind: 'selection', ids: [reference.id] });
    await t.bus.script(['', '']);
    expect(t.bus.promptText).toBe('Command:');
    await t.bus.submit('ERASE');
    await t.bus.answer({ kind: 'selection', ids: [erased.id] });
    await t.bus.submit('MOVE');
    await t.bus.answer({ kind: 'selection', ids: [moved.id] });
    await t.bus.script(['0,0', '0,5']);
    // In the parent's coordinates: the title block's (10,10)-(20,20).
    const at = (x: number, y: number) => `${CHILD_AT.x + x},${CHILD_AT.y + y}`;
    await t.bus.script(['LINE', at(10, 10), at(20, 20), '', 'REFCLOSE', 'S']);
    expect(t.log.at(-1)).toBe(
      `Xref "xref-child-tb" saved: reference edits written to ${XREF_CHILD}.`,
    );
    expect(t.writes).toHaveLength(1);

    const written = t.child();
    writeAuditSave(AUDIT_PATH, 'refedit-xref', () => written);
    const was = modelOf(bytesOf(XREF_CHILD));
    const now = modelOf(written);
    const fileMs = recordNamed(now, '*Model_Space')!.handle;
    const wasMs = recordNamed(was, '*Model_Space')!.handle;
    const nowContent = now.blockEntities(fileMs).map((id) => now.entity(id)!);
    const wasContent = was.blockEntities(wasMs).map((id) => was.entity(id)!);

    // The erased line is gone; the moved one keeps its handle, 5 up.
    const erasedInFile = fileOf.get(erased.handle)!;
    const movedInFile = fileOf.get(moved.handle)!;
    expect(nowContent.map((e) => e.handle)).not.toContain(erasedInFile);
    const m = now.entityByHandle(movedInFile)!.geom as Extract<Entity['geom'], { kind: 'LINE' }>;
    const m0 = was.entityByHandle(movedInFile)!.geom as typeof m;
    expect(m.start.y).toBeCloseTo(m0.start.y + 5, 9);
    expect(m.end.x).toBeCloseTo(m0.end.x, 9);
    // Every other object as the file had it: the nested xref, the overlay never loaded, the image.
    const others = wasContent.filter((e) => e.handle !== erasedInFile && e.handle !== movedInFile);
    expect(others.map((e) => e.geom.kind)).toEqual(expect.arrayContaining(['INSERT', 'IMAGE']));
    for (const e of others) expect(data(now.entityByHandle(e.handle)!)).toEqual(data(e));
    // The new line, under a handle the file never had, in the title block's coordinates.
    const drawn = nowContent.at(-1)!;
    expect(was.entityByHandle(drawn.handle)).toBeUndefined();
    expect(drawn.geom).toMatchObject({
      kind: 'LINE',
      start: { x: 10, y: 10 },
      end: { x: 20, y: 20 },
    });
    expect(nowContent).toHaveLength(wasContent.length);

    // The parent's save holds none of the xref's content.
    const parent = modelOf(
      withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytesOf(XREF_PARENT)), t.model)),
    );
    expect(parent.blockEntities(recordNamed(parent, 'xref-child-tb')!.handle)).toEqual([]);

    // The parent loads the title block's new file with the edits.
    const again = new EngineSession(initOf(bytesOf(XREF_PARENT)));
    load(again, 'xref-child-tb', written);
    const loaded = again.model
      .blockEntities(recordNamed(again.model, 'xref-child-tb')!.handle)
      .map((id) => again.model.entity(id)!.geom.kind);
    expect(loaded).toEqual(t.model.blockEntities(tb).map((id) => t.model.entity(id)!.geom.kind));
  });
});

// M5-02 part 7: the title block's LOGO, which the attachment brought in as
// `xref-child-tb|LOGO`, edited in place through the attachment and written to the LOGO block of
// the title block's file (`fixtures__xref__xref-child-tb.dxf.refedit-xref-block.dxf`).
describe('REFEDIT of a block the xref set brought in (M5-02 part 7)', () => {
  it("writes the edits to LOGO in the title block's file, which reads back and loads again", async () => {
    const t = loadedParent();
    const tb = recordNamed(t.model, 'xref-child-tb')!.handle;
    const logo = recordNamed(t.model, 'xref-child-tb|LOGO')!.handle;
    const ms = recordNamed(t.model, '*Model_Space')!.handle;
    const reference = t.model
      .blockEntities(ms)
      .map((id) => t.model.entity(id)!)
      .find((e) => e.geom.kind === 'INSERT' && e.geom.block === tb)!;
    const logoReference = t.model
      .blockEntities(tb)
      .map((id) => t.model.entity(id)!)
      .find((e) => e.geom.kind === 'INSERT' && e.geom.block === logo)!;
    const fileOf = new Map(t.model.blocks.get(tb)!.xrefHandles);
    const content = t.model.blockEntities(logo).map((id) => t.model.entity(id)!);
    const [erased, moved] = content.filter((e) => e.geom.kind === 'LINE');

    // A pick on the logo goes through the attachment and its reference to LOGO.
    t.nestedPath([reference.id, logoReference.id]);
    // The logo's centre in the parent: the title block's (20, 30).
    const at = (x: number, y: number) => `${CHILD_AT.x + 20 + x},${CHILD_AT.y + 30 + y}`;
    await t.bus.submit('-REFEDIT');
    await t.bus.answer({
      kind: 'selection',
      ids: [reference.id],
      pick: { x: CHILD_AT.x + 20, y: CHILD_AT.y + 30 },
    });
    await t.bus.script(['N', 'O', '', '']);
    expect(t.log).toContain('3 objects in the working set.');
    await t.bus.submit('ERASE');
    await t.bus.answer({ kind: 'selection', ids: [erased!.id] });
    await t.bus.submit('MOVE');
    await t.bus.answer({ kind: 'selection', ids: [moved!.id] });
    await t.bus.script(['0,0', '2,0']);
    await t.bus.script(['LINE', at(-12, -12), at(12, 12), '', 'REFCLOSE', 'S']);
    expect(t.log.at(-1)).toBe(
      `Xref "xref-child-tb" saved: reference edits to "xref-child-tb|LOGO" written to ${XREF_CHILD}.`,
    );
    expect(t.writes).toHaveLength(1);

    const written = t.child();
    writeAuditSave(AUDIT_PATH, 'refedit-xref-block', () => written);
    const was = modelOf(bytesOf(XREF_CHILD));
    const now = modelOf(written);
    const block = (m: DocumentModel, name: string) =>
      m.blockEntities(recordNamed(m, name)!.handle).map((id) => m.entity(id)!);

    // LOGO: the erased line gone, the moved one 2 to the right, the new line last.
    const erasedInFile = fileOf.get(erased!.handle)!;
    const movedInFile = fileOf.get(moved!.handle)!;
    const nowLogo = block(now, 'LOGO');
    const wasLogo = block(was, 'LOGO');
    expect(nowLogo.map((e) => e.handle)).not.toContain(erasedInFile);
    const m = now.entityByHandle(movedInFile)!.geom as Extract<Entity['geom'], { kind: 'LINE' }>;
    const m0 = was.entityByHandle(movedInFile)!.geom as typeof m;
    expect(m.start.x).toBeCloseTo(m0.start.x + 2, 9);
    expect(m.end.y).toBeCloseTo(m0.end.y, 9);
    const circle = wasLogo.find((e) => e.geom.kind === 'CIRCLE')!;
    expect(data(now.entityByHandle(circle.handle)!)).toEqual(data(circle));
    const drawn = nowLogo.at(-1)!;
    expect(was.entityByHandle(drawn.handle)).toBeUndefined();
    expect(drawn.geom).toMatchObject({
      kind: 'LINE',
      start: { x: -12, y: -12 },
      end: { x: 12, y: 12 },
    });
    expect(nowLogo).toHaveLength(wasLogo.length);
    // Model space as the file had it.
    const wasMs = block(was, '*Model_Space');
    expect(block(now, '*Model_Space').map(data)).toEqual(wasMs.map(data));

    // The parent's save holds none of it.
    const parent = modelOf(
      withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytesOf(XREF_PARENT)), t.model)),
    );
    expect(recordNamed(parent, 'xref-child-tb|LOGO')).toBeUndefined();

    // The parent loads the title block's new file with the edited LOGO.
    const again = new EngineSession(initOf(bytesOf(XREF_PARENT)));
    load(again, 'xref-child-tb', written);
    const kinds = (m: DocumentModel) =>
      m
        .blockEntities(recordNamed(m, 'xref-child-tb|LOGO')!.handle)
        .map((id) => m.entity(id)!.geom.kind);
    expect(kinds(again.model)).toEqual(kinds(t.model));
  });
});
