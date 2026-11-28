// The Library palette's user library folders (M8-03 part 2): the drafter's own drawing files,
// dropped on the palette or added by Add Drawings..., kept on the device in folders they name
// (user-library.ts). Each file's named blocks are listed under it, as AutoCAD 2024's Blocks
// palette lists a Libraries folder's drawings ("Blocks Palette": "Libraries tab ... access
// blocks from a folder of drawing files"); one picked is previewed and inserted as the
// catalogue's items are, at scale 1, INSERT converting its units into the drawing's.
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { DocumentModel } from '@triya/engine';
import { libraryDrawingBlock, libraryDrawingBlocks, type LibraryBlock } from '@triya/library';
import { drawingFileModel } from './dimstyle-import';
import {
  userBlockMatches,
  userLibrary,
  type DroppedDrawing,
  type LibraryFileRef,
  type UserLibraryState,
} from './user-library';

/** A block of a library file, picked. */
export interface UserPick {
  readonly folder: string;
  readonly file: string;
  /** The file's key when picked: a replaced file's block is read again. */
  readonly key: string;
  readonly block: string;
}

/** What the palette has read of a file: its blocks, or why it could not. */
export type FileBlocks =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly blocks: readonly string[] }
  | { readonly state: 'error'; readonly error: string };

/** Each file read once, as Open reads it, by its key (a replaced file is read again). */
const models = new Map<string, Promise<DocumentModel>>();

function fileModel(ref: { folder: string; name: string; key: string }): Promise<DocumentModel> {
  let model = models.get(ref.key);
  if (!model) {
    const bytes = userLibrary.bytes(ref.folder, ref.name);
    model = bytes
      ? drawingFileModel(new File([bytes as Uint8Array<ArrayBuffer>], ref.name))
      : Promise.reject(new Error(`${ref.name} is no longer in ${ref.folder}`));
    models.set(ref.key, model);
    model.catch(() => undefined);
  }
  return model;
}

/** Dropped or picked files' names and bytes. */
export async function droppedDrawings(files: Iterable<File>): Promise<DroppedDrawing[]> {
  return Promise.all(
    [...files].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
  );
}

/** The library folders, read back from the device once, and the blocks of each file. */
export function useUserLibrary(): {
  readonly state: UserLibraryState;
  readonly blocks: ReadonlyMap<string, FileBlocks>;
} {
  const state = useSyncExternalStore(userLibrary.subscribe, userLibrary.getSnapshot);
  useEffect(() => {
    void userLibrary.load();
  }, []);
  const [blocks, setBlocks] = useState<ReadonlyMap<string, FileBlocks>>(new Map());
  const files = state.folders.flatMap((f) => f.files);
  const keys = files.map((f) => f.key).join('\n');
  useEffect(() => {
    let live = true;
    const current = new Set(files.map((f) => f.key));
    // Files removed or replaced are not looked at again.
    for (const k of models.keys()) if (!current.has(k)) models.delete(k);
    for (const ref of files) {
      if (blocks.get(ref.key)?.state === 'ready') continue;
      void fileModel(ref).then(
        (model) => {
          const listed: FileBlocks = { state: 'ready', blocks: libraryDrawingBlocks(model) };
          if (live) setBlocks((m) => new Map(m).set(ref.key, listed));
        },
        (e: unknown) => {
          const why = e instanceof Error ? e.message : String(e);
          if (live) setBlocks((m) => new Map(m).set(ref.key, { state: 'error', error: why }));
        },
      );
    }
    return () => {
      live = false;
    };
    // `keys` stands for the files listed.
  }, [keys]);
  return { state, blocks };
}

/** The picked block of its library file, copied out in its units; undefined while it is read. */
export function useUserBlock(pick: UserPick | undefined): LibraryBlock | undefined {
  const [block, setBlock] = useState<{ key: string; value: LibraryBlock }>();
  const key = pick ? `${pick.key}:${pick.block}` : '';
  useEffect(() => {
    if (!pick) return;
    let live = true;
    void fileModel({ folder: pick.folder, name: pick.file, key: pick.key }).then(
      (model) => live && setBlock({ key, value: libraryDrawingBlock(model, pick.block) }),
      (e: unknown) =>
        live &&
        setBlock({ key, value: { name: '', error: e instanceof Error ? e.message : String(e) } }),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return block?.key === key ? block.value : undefined;
}

/** The files and blocks `query` finds: every word in a block's name, its file's or its folder's. */
export function userMatches(
  state: UserLibraryState,
  blocks: ReadonlyMap<string, FileBlocks>,
  query: string,
): number {
  let n = 0;
  for (const folder of state.folders) {
    for (const file of folder.files) {
      const b = blocks.get(file.key);
      if (b?.state !== 'ready') continue;
      n += b.blocks.filter((block) =>
        userBlockMatches(query, { folder: folder.name, file: file.name, block }),
      ).length;
    }
  }
  return n;
}

/** Folder `name`'s heading id: `library-folder-my-library`. */
const folderId = (prefix: string, name: string) =>
  `${prefix}-folder-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

function FileEntry({
  file,
  blocks,
  query,
  picked,
  onPick,
}: {
  file: LibraryFileRef;
  blocks: FileBlocks | undefined;
  query: string;
  picked: UserPick | undefined;
  onPick: (p: UserPick) => void;
}) {
  const id = useId();
  const listed =
    blocks?.state === 'ready'
      ? blocks.blocks.filter((block) =>
          userBlockMatches(query, { folder: file.folder, file: file.name, block }),
        )
      : [];
  if (query !== '' && listed.length === 0) return null;
  const pick = (block: string) =>
    onPick({ folder: file.folder, file: file.name, key: file.key, block });
  return (
    <li className="library-file">
      <div className="library-file-head">
        <span id={id}>{file.name}</span>
        <button
          type="button"
          className="library-remove"
          aria-label={`Remove ${file.name} from ${file.folder}`}
          title="Remove from the library"
          onClick={() => void userLibrary.remove(file.folder, file.name)}
        >
          ×
        </button>
      </div>
      {blocks === undefined || blocks.state === 'loading' ? (
        <p className="hint">Reading…</p>
      ) : blocks.state === 'error' ? (
        <p className="message error">Could not be read: {blocks.error}</p>
      ) : listed.length === 0 ? (
        <p className="hint">No blocks.</p>
      ) : (
        <ul className="library-list" role="listbox" aria-labelledby={id}>
          {listed.map((block) => (
            <li
              key={block}
              role="option"
              tabIndex={0}
              aria-selected={
                picked?.key === file.key && picked.block.toUpperCase() === block.toUpperCase()
              }
              onClick={() => pick(block)}
              onKeyDown={(k) => {
                if (k.key === 'Enter' || k.key === ' ') {
                  k.preventDefault();
                  pick(block);
                }
              }}
            >
              {block}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The folders, their files and blocks; New Folder... and Add Drawings...; files dropped on a
 * folder join it (on the rest of the palette, the folder `target`).
 */
export function UserLibrary({
  state,
  blocks,
  query,
  target,
  onTarget,
  picked,
  onPick,
}: {
  state: UserLibraryState;
  blocks: ReadonlyMap<string, FileBlocks>;
  query: string;
  /** The folder Add Drawings... and drops on the palette add to. */
  target: string | undefined;
  onTarget: (folder: string) => void;
  picked: UserPick | undefined;
  onPick: (p: UserPick) => void;
}) {
  const prefix = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [naming, setNaming] = useState<string>();
  const [over, setOver] = useState<string>();
  const picker = useRef<HTMLInputElement>(null);
  const folders = state.folders.filter(
    (f) =>
      query === '' ||
      f.files.some((file) => {
        const b = blocks.get(file.key);
        return (
          b?.state === 'ready' &&
          b.blocks.some((block) =>
            userBlockMatches(query, { folder: f.name, file: file.name, block }),
          )
        );
      }),
  );
  const chosen = state.folders.find((f) => f.name === target)?.name ?? state.folders[0]?.name;
  const make = async () => {
    if (naming === undefined) return;
    if (await userLibrary.addFolder(naming)) {
      onTarget(naming.trim());
      setNaming(undefined);
    }
  };

  return (
    <section className="library-user" aria-label="My library folders">
      <div className="library-group library-user-head">
        <span>My Library</span>
        <button type="button" onClick={() => setNaming('')}>
          New Folder...
        </button>
        <button type="button" onClick={() => picker.current?.click()}>
          Add Drawings...
        </button>
        <input
          ref={picker}
          type="file"
          accept=".dxf,.dwg"
          multiple
          hidden
          aria-label="Drawing files to add to the library"
          onChange={(e) => {
            const files = [...(e.currentTarget.files ?? [])];
            e.currentTarget.value = '';
            void droppedDrawings(files).then((d) => userLibrary.add(chosen, d));
          }}
        />
      </div>
      {naming !== undefined && (
        <div className="library-new-folder">
          <input
            type="text"
            aria-label="New folder name"
            autoFocus
            value={naming}
            onChange={(e) => setNaming(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void make();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setNaming(undefined);
                userLibrary.dismiss();
              }
            }}
          />
          <button type="button" onClick={() => void make()}>
            OK
          </button>
          <button
            type="button"
            onClick={() => {
              setNaming(undefined);
              userLibrary.dismiss();
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {state.error !== undefined && (
        <p className="message error" role="alert">
          {state.error}
        </p>
      )}
      {state.notice !== undefined && (
        <p className="message" role="status">
          {state.notice}
        </p>
      )}
      {state.folders.length === 0 ? (
        <p className="hint">Drop drawing files here to keep their blocks in your library.</p>
      ) : (
        <ul className="library-folders">
          {folders.map((f) => (
            <li
              key={f.name}
              className={over === f.name ? 'library-folder dropping' : 'library-folder'}
              aria-labelledby={folderId(prefix, f.name)}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('Files')) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
                setOver(f.name);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setOver(undefined);
              }}
              onDrop={(e) => {
                if (!e.dataTransfer.types.includes('Files')) return;
                e.preventDefault();
                e.stopPropagation();
                setOver(undefined);
                onTarget(f.name);
                void droppedDrawings(e.dataTransfer.files).then((d) => userLibrary.add(f.name, d));
              }}
            >
              <div className="library-folder-head">
                <button
                  type="button"
                  id={folderId(prefix, f.name)}
                  aria-pressed={f.name === chosen}
                  title="Add Drawings... and drops on the palette add to this folder"
                  onClick={() => onTarget(f.name)}
                >
                  {f.name}
                </button>
                <button
                  type="button"
                  className="library-remove"
                  aria-label={`Remove folder ${f.name}`}
                  title="Remove the folder and its drawings"
                  onClick={() => void userLibrary.removeFolder(f.name)}
                >
                  ×
                </button>
              </div>
              {f.files.length === 0 ? (
                <p className="hint">Drop drawing files here.</p>
              ) : (
                <ul className="library-files">
                  {f.files.map((file) => (
                    <FileEntry
                      key={file.key}
                      file={file}
                      blocks={blocks.get(file.key)}
                      query={query}
                      picked={picked}
                      onPick={onPick}
                    />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
