// M1-21: the files and folders kept for references, read again without asking only when the
// browser allows it.
import { describe, expect, it } from 'vitest';
import {
  ReferenceFiles,
  filesInFolder,
  type DirectoryHandle,
  type FileHandle,
  type HandlePersistence,
  type ReferenceHandle,
  type StoredHandle,
} from '../src/reference-files';

type Permission = 'granted' | 'denied' | 'prompt';

function fileHandle(name: string, permission: { state: Permission } = { state: 'granted' }) {
  const h: FileHandle = {
    kind: 'file',
    name,
    getFile: async () => new File([name], name),
    queryPermission: async () => permission.state,
    requestPermission: async () => {
      permission.state = 'granted';
      return 'granted';
    },
  };
  return h;
}

function folder(
  name: string,
  children: ReferenceHandle[],
  permission: { state: Permission } = { state: 'granted' },
): DirectoryHandle {
  const h: DirectoryHandle = {
    kind: 'directory',
    name,
    values: async function* () {
      yield* children;
    },
    queryPermission: async () => permission.state,
    requestPermission: async () => {
      permission.state = 'granted';
      return 'granted';
    },
    isSameEntry: async (other) => other === h,
  };
  return h;
}

function memory(): HandlePersistence & { rows: Map<string, StoredHandle> } {
  const rows = new Map<string, StoredHandle>();
  return {
    rows,
    load: async () => [...rows.values()],
    put: async (r) => void rows.set(r.key, r),
    remove: async (k) => void rows.delete(k),
  };
}

const names = async (files: Promise<{ name: string }[]>) => (await files).map((f) => f.name);

describe('filesInFolder (M1-21)', () => {
  it('lists files three folders deep, no further', async () => {
    const deep = folder('d4', [fileHandle('too-deep.dxf')]);
    const dir = folder('sheets', [
      fileHandle('tb.dxf'),
      folder('xrefs', [fileHandle('grid.dxf'), folder('d3', [fileHandle('logo.png'), deep])]),
    ]);
    expect(await names(filesInFolder(dir))).toEqual(['tb.dxf', 'grid.dxf', 'logo.png']);
  });
});

describe('ReferenceFiles (M1-21)', () => {
  it('gives the files of kept files and folders, and keeps them for the next session', async () => {
    const store = memory();
    const refs = new ReferenceFiles(store);
    const dir = folder('sheets', [fileHandle('tb.dxf'), fileHandle('grid.dxf')]);
    await refs.remember([fileHandle('logo.png'), dir]);
    // The same folder dropped again is kept once.
    await refs.remember([dir]);
    expect(store.rows.size).toBe(2);
    expect(await names(refs.files())).toEqual(['logo.png', 'tb.dxf', 'grid.dxf']);
    const next = new ReferenceFiles(store);
    expect(await names(next.files())).toEqual(['logo.png', 'tb.dxf', 'grid.dxf']);
  });

  it('reads a handle the browser would ask about only after Reconnect asks', async () => {
    const permission = { state: 'prompt' as Permission };
    const store = memory();
    await new ReferenceFiles(store).remember([
      folder('sheets', [fileHandle('tb.dxf')], permission),
    ]);
    const refs = new ReferenceFiles(store);
    let told = 0;
    refs.subscribe(() => told++);
    expect(await names(refs.files())).toEqual([]);
    expect([refs.waiting(), told]).toEqual([1, 1]);
    expect(await names(refs.files(true))).toEqual(['tb.dxf']);
    expect([refs.waiting(), told]).toEqual([0, 2]);
  });

  it('skips a denied handle and a folder that is gone', async () => {
    const gone: DirectoryHandle = {
      ...folder('gone', []),
      // eslint-disable-next-line require-yield
      values: async function* () {
        throw new Error('NotFoundError');
      },
    };
    const refs = new ReferenceFiles(memory());
    await refs.remember([fileHandle('a.dxf', { state: 'denied' }), gone, fileHandle('b.dxf')]);
    expect(await names(refs.files(true))).toEqual(['b.dxf']);
  });

  it('works without IndexedDB, for this session', async () => {
    const refs = new ReferenceFiles({
      load: () => Promise.reject(new Error('no IndexedDB')),
      put: () => Promise.reject(new Error('no IndexedDB')),
      remove: () => Promise.reject(new Error('no IndexedDB')),
    });
    await refs.remember([fileHandle('tb.dxf')]);
    expect(await names(refs.files())).toEqual(['tb.dxf']);
  });
});
