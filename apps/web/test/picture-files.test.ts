// M2-72: a pasted picture's PNG travels with the drawing. A save naming kept pictures offers to
// write them beside the DXF (the drawing's folder, asked once), or to download them; the
// References palette saves one kept picture's file.
import { describe, expect, it, vi } from 'vitest';
import {
  PictureFiles,
  pastedPicturesOf,
  type FolderHandle,
  type PictureFilesEnv,
} from '../src/picture-files';
import type { SaveHandle } from '../src/save';
import type { ReferenceRow } from '../src/xrefs';

const A = 'pasted-0a1b2c3d.png';
const B = 'pasted-ffee0011.png';
const PNG_A = new Uint8Array([137, 80, 78, 71, 1]);
const PNG_B = new Uint8Array([137, 80, 78, 71, 2]);

const kept = new Map([
  [A, PNG_A],
  [B, PNG_B],
]);
const bytes = (name: string) => Promise.resolve(kept.get(name));

/** A file in a fake folder: what was written to it. */
function file(name: string, written?: Map<string, Uint8Array>): SaveHandle {
  return {
    kind: 'file',
    name,
    getFile: () => Promise.resolve(new Blob([])),
    createWritable: () => {
      const parts: Blob[] = [];
      return Promise.resolve({
        write: (b: Blob) => Promise.resolve(void parts.push(b)),
        close: async () => {
          written?.set(name, new Uint8Array(await new Blob(parts).arrayBuffer()));
        },
      });
    },
  };
}

/** A fake folder holding `files` (by object), recording what is written into it. */
function folder(
  name: string,
  holds: SaveHandle[] = [],
  permission: 'granted' | 'prompt' = 'granted',
) {
  const written = new Map<string, Uint8Array>();
  const handle: FolderHandle = {
    kind: 'directory',
    name,
    getFileHandle: (n) => Promise.resolve(file(n, written)),
    resolve: (h) => Promise.resolve(holds.includes(h) ? [h.name] : null),
    queryPermission: () => Promise.resolve(permission),
  };
  return { handle, written };
}

function env(picked?: FolderHandle | 'none', pickedFile?: SaveHandle) {
  const downloads: [string, Uint8Array][] = [];
  const e: PictureFilesEnv = {
    download: (n, b) => void downloads.push([n, b]),
    ...(picked !== 'none' && { pickFolder: vi.fn(() => Promise.resolve(picked)) }),
    ...(pickedFile && { pickFile: vi.fn(() => Promise.resolve(pickedFile)) }),
  };
  return { e, downloads };
}

const row = (path: string, depth = 0, kind: ReferenceRow['kind'] = 'image'): ReferenceRow => ({
  handle: path,
  kind,
  name: path,
  path,
  status: 'loaded',
  depth,
});

describe('pastedPicturesOf', () => {
  it("names the drawing's own pasted pictures once, not its xrefs' or other images", () => {
    expect(
      pastedPicturesOf([
        row(A),
        row(`.\\shots\\${B}`),
        row(A.toUpperCase()),
        row('site.png'),
        row('pasted-12345678.png', 1),
        row('pasted-87654321.png', 0, 'pdf'),
      ]),
    ).toEqual([A, B]);
  });
});

describe('PictureFiles after a save', () => {
  it('offers to save kept pictures beside the drawing, then writes them into the folder picked', async () => {
    const dxf = file('plan.dxf');
    const f = folder('Drawings', [dxf]);
    const { e } = env(f.handle);
    const pictures = new PictureFiles(bytes, () => e);
    expect(await pictures.saved(1, 'plan.dxf', dxf, [A, 'pasted-99999999.png'])).toBeUndefined();
    // Only the picture this device keeps.
    expect(pictures.get()).toEqual({
      doc: 1,
      drawing: 'plan.dxf',
      pictures: [A],
      way: 'folder',
      file: dxf,
    });
    expect(await pictures.accept()).toBe('Saved 1 pasted picture beside plan.dxf.');
    expect(e.pickFolder).toHaveBeenCalledWith(dxf);
    expect(f.written.get(A)).toEqual(PNG_A);
    expect(pictures.get()).toBeUndefined();

    // Asked once: the next save writes them unasked, the new one too.
    f.written.clear();
    expect(await pictures.saved(1, 'plan.dxf', dxf, [A, B])).toBe(
      'Saved plan.dxf and 2 pasted pictures beside it.',
    );
    expect([...f.written.keys()]).toEqual([A, B]);
    expect(e.pickFolder).toHaveBeenCalledTimes(1);
    expect(pictures.get()).toBeUndefined();
  });

  it('writes unasked into the folder for a Save As into the same folder, and asks for another', async () => {
    const dxf = file('plan.dxf');
    const copy = file('plan-2.dxf');
    const f = folder('Drawings', [dxf, copy]);
    const pictures = new PictureFiles(bytes, () => env(f.handle).e);
    await pictures.saved(1, 'plan.dxf', dxf, [A]);
    await pictures.accept();
    expect(await pictures.saved(1, 'plan-2.dxf', copy, [A])).toBe(
      'Saved plan-2.dxf and 1 pasted picture beside it.',
    );
    // Saved As elsewhere: asked again.
    expect(await pictures.saved(1, 'away.dxf', file('away.dxf'), [A])).toBeUndefined();
    expect(pictures.get()?.way).toBe('folder');
  });

  it('asks again when the folder may no longer be written', async () => {
    const dxf = file('plan.dxf');
    const f = folder('Drawings', [dxf], 'prompt');
    const pictures = new PictureFiles(bytes, () => env(f.handle).e);
    await pictures.saved(1, 'plan.dxf', dxf, [A]);
    await pictures.accept();
    expect(await pictures.saved(1, 'plan.dxf', dxf, [A])).toBeUndefined();
    expect(pictures.get()?.pictures).toEqual([A]);
  });

  it('says so when the folder picked does not hold the drawing, and asks again next time', async () => {
    const dxf = file('plan.dxf');
    const f = folder('Elsewhere');
    const pictures = new PictureFiles(bytes, () => env(f.handle).e);
    await pictures.saved(1, 'plan.dxf', dxf, [A]);
    expect(await pictures.accept()).toBe(
      'Saved 1 pasted picture in Elsewhere, which does not hold plan.dxf: the drawing finds them only beside it.',
    );
    expect(f.written.get(A)).toEqual(PNG_A);
    expect(await pictures.saved(1, 'plan.dxf', dxf, [A])).toBeUndefined();
    expect(pictures.get()).toBeDefined();
  });

  it('keeps the offer when the folder picker is cancelled', async () => {
    const dxf = file('plan.dxf');
    const pictures = new PictureFiles(bytes, () => env(undefined).e);
    await pictures.saved(1, 'plan.dxf', dxf, [A]);
    expect(await pictures.accept()).toBeUndefined();
    expect(pictures.get()?.pictures).toEqual([A]);

    const aborting = new PictureFiles(bytes, () => ({
      download: () => {},
      pickFolder: () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })),
    }));
    await aborting.saved(1, 'plan.dxf', dxf, [A]);
    expect(await aborting.accept()).toBeUndefined();
    expect(aborting.get()).toBeDefined();

    const failing = new PictureFiles(bytes, () => ({
      download: () => {},
      pickFolder: () => Promise.reject(new Error('blocked')),
    }));
    await failing.saved(1, 'plan.dxf', dxf, [A]);
    expect(await failing.accept()).toBe('The pasted pictures were not saved: blocked');
    expect(failing.get()).toBeUndefined();
  });

  it('downloads the pictures when the save downloaded, once each', async () => {
    const { e, downloads } = env('none');
    const pictures = new PictureFiles(bytes, () => e);
    await pictures.saved(1, 'plan.dxf', undefined, [A]);
    expect(pictures.get()?.way).toBe('download');
    expect(await pictures.accept()).toBe(
      'Downloaded 1 pasted picture: keep it in the folder of plan.dxf.',
    );
    expect(downloads).toEqual([[A, PNG_A]]);
    // A later download offers only the new picture.
    await pictures.saved(1, 'plan.dxf', undefined, [A, B]);
    expect(pictures.get()?.pictures).toEqual([B]);
    expect(await pictures.accept()).toBe(
      'Downloaded 1 pasted picture: keep it in the folder of plan.dxf.',
    );
    await pictures.saved(1, 'plan.dxf', undefined, [A, B]);
    expect(pictures.get()).toBeUndefined();
  });

  it('downloads when the save picker wrote the drawing but there is no folder picker', async () => {
    const { e, downloads } = env('none');
    const pictures = new PictureFiles(bytes, () => e);
    await pictures.saved(1, 'plan.dxf', file('plan.dxf'), [A, B]);
    expect(pictures.get()?.way).toBe('download');
    expect(await pictures.accept()).toBe(
      'Downloaded 2 pasted pictures: keep them in the folder of plan.dxf.',
    );
    expect(downloads.map(([n]) => n)).toEqual([A, B]);
  });

  it('does not offer again what was turned down, and forgets a closed drawing', async () => {
    const dxf = file('plan.dxf');
    const pictures = new PictureFiles(bytes, () => env(folder('D', [dxf]).handle).e);
    await pictures.saved(1, 'plan.dxf', dxf, [A]);
    pictures.decline();
    expect(pictures.get()).toBeUndefined();
    expect(await pictures.saved(1, 'plan.dxf', dxf, [A])).toBeUndefined();
    expect(pictures.get()).toBeUndefined();
    await pictures.saved(1, 'plan.dxf', dxf, [A, B]);
    expect(pictures.get()?.pictures).toEqual([B]);
    const seen = vi.fn();
    pictures.subscribe(seen);
    pictures.forget(1);
    expect(pictures.get()).toBeUndefined();
    expect(seen).toHaveBeenCalled();
    await pictures.saved(1, 'plan.dxf', dxf, [A]);
    expect(pictures.get()?.pictures).toEqual([A]);
  });

  it('offers nothing for a drawing naming no kept picture; a new save replaces the offer', async () => {
    const dxf = file('plan.dxf');
    const pictures = new PictureFiles(bytes, () => env(folder('D').handle).e);
    expect(await pictures.saved(1, 'plan.dxf', dxf, ['pasted-99999999.png'])).toBeUndefined();
    expect(pictures.get()).toBeUndefined();
    await pictures.saved(1, 'plan.dxf', dxf, [A]);
    await pictures.saved(1, 'plan.dxf', dxf, []);
    expect(pictures.get()).toBeUndefined();
    expect(await pictures.accept()).toBeUndefined();
    pictures.decline();
  });

  it('reports a folder it could not write', async () => {
    const dxf = file('plan.dxf');
    const f = folder('D', [dxf]);
    const broken: FolderHandle = {
      ...f.handle,
      getFileHandle: () => Promise.reject(new Error('gone')),
    };
    const pictures = new PictureFiles(bytes, () => env(broken).e);
    await pictures.saved(1, 'plan.dxf', dxf, [A]);
    expect(await pictures.accept()).toBe('The pasted pictures were not saved: gone');
  });

  it('asks again when the folder kept for the drawing cannot be written any more', async () => {
    const dxf = file('plan.dxf');
    const f = folder('D', [dxf]);
    let gone = false;
    const flaky: FolderHandle = {
      ...f.handle,
      getFileHandle: (n) =>
        gone ? Promise.reject(new Error('gone')) : f.handle.getFileHandle(n, { create: true }),
    };
    const pictures = new PictureFiles(bytes, () => env(flaky).e);
    await pictures.saved(1, 'plan.dxf', dxf, [A]);
    await pictures.accept();
    gone = true;
    expect(await pictures.saved(1, 'plan.dxf', dxf, [A])).toBeUndefined();
    expect(pictures.get()?.way).toBe('folder');
  });
});

describe('PictureFiles.saveOne (the References palette)', () => {
  it('saves a kept picture to the file picked, or downloads it', async () => {
    const written = new Map<string, Uint8Array>();
    const target = file('shot.png', written);
    const dxf = file('plan.dxf');
    const { e } = env('none', target);
    const pictures = new PictureFiles(bytes, () => e);
    expect(await pictures.saveOne(A, dxf)).toBe('Saved shot.png.');
    expect(e.pickFile).toHaveBeenCalledWith(A, dxf);
    expect(written.get('shot.png')).toEqual(PNG_A);

    const d = env('none');
    expect(await new PictureFiles(bytes, () => d.e).saveOne(B, undefined)).toBe(`Downloaded ${B}.`);
    expect(d.downloads).toEqual([[B, PNG_B]]);
  });

  it('says when nothing was saved', async () => {
    const pictures = new PictureFiles(bytes, () => ({
      download: () => {},
      pickFile: () => Promise.resolve(undefined),
    }));
    expect(await pictures.saveOne('pasted-99999999.png', undefined)).toBe(
      'pasted-99999999.png is not kept on this device.',
    );
    expect(await pictures.saveOne(A, undefined)).toBeUndefined();
    const abort = new PictureFiles(bytes, () => ({
      download: () => {},
      pickFile: () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })),
    }));
    expect(await abort.saveOne(A, undefined)).toBeUndefined();
    const fail = new PictureFiles(bytes, () => ({
      download: () => {},
      pickFile: () => Promise.reject(new Error('blocked')),
    }));
    expect(await fail.saveOne(A, undefined)).toBe(`${A} was not saved: blocked`);
    const readOnly = new PictureFiles(bytes, () => ({
      download: () => {},
      pickFile: () => {
        const { createWritable: _, ...readOnlyFile } = file('x.png');
        return Promise.resolve(readOnlyFile);
      },
    }));
    expect(await readOnly.saveOne(A, undefined)).toBe(
      'x.png was not saved: x.png cannot be written',
    );
  });
});
