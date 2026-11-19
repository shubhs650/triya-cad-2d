// M5-04 part 15: -XREF Path and Pathtype on the thread-authored xref set (M1-21), run in an
// engine session whose app part is played here: the `xref` attach request after a path changes
// loads each waiting xref from the file its new path names, as the app's loads do. The save
// writes the new paths as each xref BLOCK's DXF 1, nothing else, and reads back with them; CI's
// ezdxf audit reads it (audit.py `FIXTURE_SAVES`, kind `xref-path`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  unloadedXrefs,
  type CommandOutput,
  type DocumentInit,
  type DocumentModel,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';
import { XREF_CHILD, XREF_GRANDCHILD, XREF_PARENT } from './fixture';

const AUDIT_PATH = 'fixtures/xref/xref-parent.dxf';
const DIR = fileURLToPath(new URL('../../fixtures/xref/', import.meta.url));
const bytesOf = (name: string) => new Uint8Array(readFileSync(DIR + name));
const initOf = (name: string): DocumentInit => openDocument(readCadDocument(bytesOf(name))).init;

/** The files the "app" has, by name. */
const FILES = new Map([XREF_CHILD, XREF_GRANDCHILD].map((f) => [f.toUpperCase(), f]));

const handleOf = (model: DocumentModel, name: string) =>
  [...model.tables.blockRecords.values()].find((r) => r.name === name)!.handle;
const pathOf = (model: DocumentModel, name: string) =>
  model.blocks.get(handleOf(model, name))?.xrefPath;

/** The parent with its xrefs loaded, in a session whose app loads what waits for a file. */
function session() {
  const s = new EngineSession(initOf(XREF_PARENT));
  const log: string[] = [];
  const loadWaiting = () => {
    const messages: string[] = [];
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
    return messages;
  };
  s.onCommand((o: CommandOutput) => {
    if (o.type === 'log') log.push(o.line);
    if (o.type !== 'view' || o.request.op !== 'xref' || o.request.action !== 'attach') return;
    void s.command({ kind: 'view', id: o.id, reply: { ok: true, messages: loadWaiting() } });
  });
  loadWaiting();
  const run = async (...lines: string[]) => {
    for (const text of lines) await s.command({ kind: 'submit', text });
  };
  return { s, model: s.model, log, run };
}

const resaved = (model: DocumentModel): DocumentInit =>
  openDocument(readCadDocument(saveAc1032Dxf(readCadDocument(bytesOf(XREF_PARENT)), model))).init;

describe('-XREF Path and Pathtype saves (M5-04 part 15)', () => {
  it('saves the paths -XREF Path and Pathtype give, and reads them back', async () => {
    const { model, log, run } = session();
    expect(pathOf(model, 'xref-child-tb')).toBe(`.\\${XREF_CHILD}`);
    await run('-XREF', 'P', 'xref-child-ovl', `"C:\\Sheets\\Title blocks\\${XREF_CHILD}"`);
    expect(log).toEqual(
      expect.arrayContaining([
        'Xref name: xref-child-ovl',
        `Old path: .\\${XREF_CHILD}`,
        '"xref-child-ovl" loaded.',
      ]),
    );
    expect(model.blocks.get(handleOf(model, 'xref-child-ovl'))?.xrefLoaded?.length).toBeGreaterThan(
      0,
    );
    await run('-XREF', 'T', 'xref-child-tb', 'N');
    expect(pathOf(model, 'xref-child-tb')).toBe(XREF_CHILD);
    // The grandchild the reloaded child brought in again, loaded again with it.
    expect(
      model.blocks.get(handleOf(model, 'xref-grandchild'))?.xrefLoaded?.length,
    ).toBeGreaterThan(0);
    // A nested xref's path is its parent file's.
    await run('-XREF', 'P', 'xref-grandchild');
    // (Both children bring it in; the first loaded holds it.)
    expect(log.at(-1)).toMatch(
      /^"xref-grandchild" is nested in "xref-child-(tb|ovl)": its path is saved in that file\.$/,
    );

    const out = saveAc1032Dxf(readCadDocument(bytesOf(XREF_PARENT)), model);
    writeAuditSave(AUDIT_PATH, 'xref-path', () => out);
    const back = new EngineSession(openDocument(readCadDocument(out)).init).model;
    expect(pathOf(back, 'xref-child-ovl')).toBe(`C:\\Sheets\\Title blocks\\${XREF_CHILD}`);
    expect(pathOf(back, 'xref-child-tb')).toBe(XREF_CHILD);
    // Nothing else of the xrefs changed: the same records and references.
    const before = new EngineSession(initOf(XREF_PARENT)).model;
    expect([...back.tables.blockRecords.values()].map((r) => [r.name, r.flags])).toEqual(
      [...before.tables.blockRecords.values()].map((r) => [r.name, r.flags]),
    );
    expect([...back.entities()].length).toBe([...before.entities()].length);
  });

  it('undone, the old paths are saved again', async () => {
    const { s, model, run } = session();
    await run('-XREF', 'T', '*', 'N');
    expect(pathOf(model, 'xref-child-ovl')).toBe(XREF_CHILD);
    expect(s.undoState.nextUndo).toBe('XREF');
    await run('U');
    const back = resaved(model);
    const paths = (back.blocks ?? []).map((b) => b.xrefPath).filter((p) => p !== undefined);
    expect(paths.sort()).toEqual([`.\\${XREF_CHILD}`, `.\\${XREF_CHILD}`]);
  });
});
