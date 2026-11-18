// M5-02 part 6: REFCLOSE Save of an xref, the app's side. The xref's file is read for the engine
// (`xrefDrawing`) and written with the engine's change as Save writes a drawing: in place where
// the browser lets the app write its handle, else downloaded under its name; later reads of the
// xref read what was written.
import type { ChangeSet, DocumentInit } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { writeXrefFile, xrefDrawingReply, type XrefSource } from '../src/xref-files';

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
