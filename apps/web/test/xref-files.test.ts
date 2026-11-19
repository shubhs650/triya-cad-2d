// M5-02 part 6: REFCLOSE Save of an xref, the app's side. The xref's file is read for the engine
// (`xrefDrawing`) and written with the engine's change as Save writes a drawing: in place where
// the browser lets the app write its handle, else downloaded under its name; later reads of the
// xref read what was written.
// M5-04 part 12: -XREF Attach and Overlay's file named at the command line (`xrefFile`), found by
// name among the places the app holds drawings, in order, with its INSUNITS.
import type { ChangeSet, DocumentInit } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { writeXrefFile, xrefDrawingReply, xrefFileReply, type XrefSource } from '../src/xref-files';

const CHANGES: readonly ChangeSet[] = [{ header: [] }];
const INIT = { handSeed: '60' } as unknown as DocumentInit;

/** Save's writer: the bytes with a marker per change set. */
const env = () => {
  const downloads: [string, string][] = [];
  return {
    downloads,
    write: (bytes: Uint8Array, changes: readonly ChangeSet[]) =>
      Promise.resolve(
        new TextEncoder().encode(`${new TextDecoder().decode(bytes)}+${changes.length}`),
      ),
    download: (name: string, bytes: Uint8Array) =>
      downloads.push([name, new TextDecoder().decode(bytes)]),
  };
};

const text = async (s: XrefSource) => (await s.getFile()).text();

function fileHandle(permission: 'granted' | 'denied') {
  const writes: string[] = [];
  const handle = {
    kind: 'file' as const,
    name: 'plan.dxf',
    getFile: () => Promise.resolve(new File(['old'], 'plan.dxf')),
    queryPermission: () => Promise.resolve('prompt' as const),
    requestPermission: () => Promise.resolve(permission),
    createWritable: () =>
      Promise.resolve({
        write: async (b: Blob) => void writes.push(await b.text()),
        close: () => Promise.resolve(),
      }),
  };
  return { handle, writes };
}

describe('xrefDrawingReply', () => {
  it('answers the file opened, or no drawing without a file', async () => {
    const source: XrefSource = {
      name: 'plan.dxf',
      getFile: () => Promise.resolve(new Blob(['x'])),
    };
    expect(await xrefDrawingReply(source, () => Promise.resolve({ init: INIT }))).toEqual({
      ok: true,
      xrefDrawing: { name: 'plan.dxf', init: INIT },
    });
    expect(await xrefDrawingReply(undefined, () => Promise.resolve({ init: INIT }))).toEqual({
      ok: true,
    });
    expect(
      await xrefDrawingReply(source, () => Promise.reject(new Error('not a drawing'))),
    ).toEqual({ ok: false, message: 'plan.dxf could not be read: not a drawing' });
  });
});

describe('writeXrefFile', () => {
  it('writes in place through a file handle the user lets the app write', async () => {
    const { handle, writes } = fileHandle('granted');
    const e = env();
    const r = await writeXrefFile(
      { name: 'plan.dxf', getFile: handle.getFile, handle },
      CHANGES,
      e,
    );
    expect(r.reply).toEqual({ ok: true, written: { file: 'plan.dxf', downloaded: false } });
    expect(writes).toEqual(['old+1']);
    expect(e.downloads).toEqual([]);
    expect(await text(r.source)).toBe('old+1');
  });

  it('downloads the file when it has no handle, or writing it is refused', async () => {
    const e = env();
    const dropped: XrefSource = {
      name: 'plan.dxf',
      getFile: () => Promise.resolve(new Blob(['old'])),
    };
    const r = await writeXrefFile(dropped, CHANGES, e);
    expect(r.reply).toEqual({ ok: true, written: { file: 'plan.dxf', downloaded: true } });
    expect(await text(r.source)).toBe('old+1');
    const { handle, writes } = fileHandle('denied');
    await writeXrefFile({ name: 'plan.dxf', getFile: handle.getFile, handle }, CHANGES, e);
    expect(writes).toEqual([]);
    expect(e.downloads).toEqual([
      ['plan.dxf', 'old+1'],
      ['plan.dxf', 'old+1'],
    ]);
  });

  it('says why when the file cannot be written', async () => {
    const r = await writeXrefFile(
      { name: 'plan.dxf', getFile: () => Promise.reject(new Error('gone')) },
      CHANGES,
      env(),
    );
    expect(r.reply).toEqual({ ok: false, message: 'plan.dxf was not written: gone' });
  });
});

describe('xrefFileReply', () => {
  const source = (name: string, text = name): XrefSource => ({
    name,
    getFile: () => Promise.resolve(new Blob([text])),
  });
  /** INSUNITS: the file's length, as a stand-in for reading its header. */
  const lookup = (file: string, places: XrefSource[][], self?: string) => {
    const found: string[] = [];
    const read: number[] = [];
    const reply = xrefFileReply(
      file,
      places.map((p, i) => () => {
        read.push(i);
        return Promise.resolve(p);
      }),
      {
        units: async (blob) => (await blob.text()).length,
        found: (s) => found.push(s.name),
        ...(self !== undefined && { self }),
      },
    );
    return { reply, found, read };
  };

  it('finds a drawing by name, folders, case and the extension aside, in the first place holding it', async () => {
    const t = lookup('C:\\work\\PLAN', [[source('plan.png')], [source('plan.dxf', 'abc')], []]);
    expect(await t.reply).toEqual({ ok: true, xrefFile: { fileName: 'plan.dxf', units: 3 } });
    expect(t.found).toEqual(['plan.dxf']);
    // Places after the one that held it are not read.
    expect(t.read).toEqual([0, 1]);
  });

  it('takes the extension typed: plan.dwg is not plan.dxf', async () => {
    const places = [[source('plan.dxf')], [source('plan.dwg', 'x')]];
    expect(await lookup('plan.dwg', places).reply).toEqual({
      ok: true,
      xrefFile: { fileName: 'plan.dwg', units: 1 },
    });
    expect(await lookup('"plan.dxf"', places).reply).toMatchObject({ ok: true });
  });

  it('answers no file when none is held, and why one cannot be read', async () => {
    const none = lookup('elevation', [[source('plan.dxf')], [source('elevation.pdf')]]);
    expect(await none.reply).toEqual({ ok: true });
    expect(none.found).toEqual([]);
    const broken = xrefFileReply('plan', [() => [source('plan.dxf')]], {
      units: () => Promise.reject(new Error('not a drawing')),
      found: () => {},
    });
    expect(await broken).toEqual({
      ok: false,
      message: 'plan.dxf could not be read: not a drawing',
    });
  });

  it('refuses the drawing itself', async () => {
    expect(await lookup('host', [[source('Host.dxf')]], 'host.dxf').reply).toEqual({
      ok: false,
      message: 'Host.dxf is this drawing: a drawing cannot reference itself.',
    });
  });
});
