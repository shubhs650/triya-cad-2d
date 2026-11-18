// REFCLOSE's Save of an xref edited in place (M5-02 part 6): the edits written back to the xref's
// own file, as AutoCAD 2024 saves them (AutoCAD Help, "REFCLOSE (Command)": "When you save
// changes to an xref, the changes are saved back to the referenced drawing"; "About Editing
// Referenced Drawings in Place").
//
// The host holds the xref's model space as the content of the xref's block (model/xref.ts), under
// handles of its own. What the write makes is a change of the file's drawing, as the app reads it
// again now, in the file's handles, which the app saves as Save saves a drawing (from the file's
// own bytes, DEC-047):
//
// - an object the xref had keeps its handle there; only an object whose data changed is written,
//   so what the edit did not touch stays exactly as the file has it;
// - an object the edit erased goes from the file;
// - an object new to the xref (drawn during the edit, or added to the working set from the host)
//   gets the file's next handle, above its $HANDSEED, with the records and blocks it uses: the
//   xref's own where the file has one of that name (`xref|name` is the file's `name`), else a
//   copy of the host's, as PASTECLIP brings another drawing's in.
//
// The host keeps the objects as the xref's content: nothing of it is saved with the host.
import { ChangeSetBuilder } from '../model/builder';
import { isEmptyChangeSet, type ChangeSet } from '../model/changeset';
import { DocumentModel, type DocumentInit } from '../model/document';
import type { Handle } from '../model/handle';
import type { Entity, SymbolTableRecord, TableName } from '../model/types';
import { insUnitsOf } from '../model/units';
import { HANDLE_KEYS, renumber } from '../model/xref';
import { copyToClipboard, pasteKnown, type Clipboard } from './clipboard';
import { patchBack } from './edit';

/** The tables an xref's load brings in, whose records the xref's objects use. */
const TABLES: readonly TableName[] = [
  'layers',
  'linetypes',
  'textStyles',
  'dimStyles',
  'mleaderStyles',
  'tableStyles',
  'mlineStyles',
  'blockRecords',
];

/** DXF 70: xref-dependent (16) and resolved (32), which no record of the xref's own file has. */
const DEPENDENT_BITS = 16 | 32;

export interface XrefWrite {
  /** The change to the xref's drawing, in its handles; none when the edit changed nothing. */
  readonly changes: readonly ChangeSet[];
  /** The objects new to the file: `[host, file]` handles (an INSERT's attributes too). */
  readonly added: readonly (readonly [Handle, Handle])[];
  /** Objects of the xref's content that could not be written to the file. */
  readonly refused: number;
}

/** Whether two plain values hold the same data. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * The Clipboard as the xref's file names its definitions: `xref|name` is the file's `name`, and
 * a record copied in is the file's own (not xref-dependent). Only `fresh` objects are pasted.
 */
function forFile(
  clip: Clipboard,
  prefix: string,
  insUnits: number,
  fresh: ReadonlySet<Handle>,
): Clipboard {
  const own = (name: string) =>
    name.toUpperCase().startsWith(prefix) ? name.slice(prefix.length) : name;
  const tables = Object.fromEntries(
    Object.entries(clip.tables).map(([t, list]) => [
      t,
      (list as readonly SymbolTableRecord[]).map((r) => {
        const { flags, ...rest } = r;
        const kept = (flags ?? 0) & ~DEPENDENT_BITS;
        return { ...rest, name: own(r.name), ...(kept ? { flags: kept } : {}) };
      }),
    ]),
  ) as Clipboard['tables'];
  return {
    ...clip,
    tables,
    blocks: clip.blocks.map((d) => ({ ...d, name: own(d.name) })),
    entities: clip.entities.filter((e) => fresh.has(e.handle)),
    groups: [],
    insUnits,
  };
}

/**
 * The write of xref `block`'s content in `host` (the working set carried back) to the xref's
 * file, whose drawing is `drawing` as it is now. `written` adds what earlier writes of this
 * session added to the file (`[host, file]`), which the block's own list may have lost to U.
 */
export function xrefWrite(
  host: DocumentModel,
  block: Handle,
  drawing: DocumentInit,
  written: Iterable<readonly [Handle, Handle]> = [],
): XrefWrite {
  const record = host.tables.blockRecords.get(block);
  const def = host.blocks.get(block);
  if (!record || !def) throw new Error(`No block ${block}.`);
  const prefix = `${record.name}|`.toUpperCase();
  const file = DocumentModel.create(drawing);
  const space = [...file.tables.blockRecords.values()].find(
    (r) => r.name.toUpperCase() === '*MODEL_SPACE',
  );
  if (!space) throw new Error(`${record.name}: the drawing has no model space.`);
  const ms = space.handle;

  // ── What the host's handles stand for in the file ─────────────────────────────────────────
  const exists = (h: Handle) =>
    file.ids.idOf(h) !== undefined ||
    file.objects.has(h) ||
    file.blocks.has(h) ||
    TABLES.some((t) => file.tables[t].has(h));
  const known = new Map<Handle, Handle>();
  for (const [h, x] of [...(def.xrefHandles ?? []), ...written]) if (exists(x)) known.set(h, x);
  // A record the load mapped onto one the host had (a VISRETAIN layer, layer 0, a nested xref
  // another load brought) is the file's of that name. Anonymous blocks are matched by handle only.
  for (const t of TABLES) {
    const byName = new Map<string, Handle>();
    for (const r of file.tables[t].values())
      byName.set((r as SymbolTableRecord).name.toUpperCase(), r.handle);
    for (const r of host.tables[t].values() as IterableIterator<SymbolTableRecord>) {
      if (known.has(r.handle) || r.name.startsWith('*')) continue;
      const upper = r.name.toUpperCase();
      const x = byName.get(upper.startsWith(prefix) ? upper.slice(prefix.length) : upper);
      if (x !== undefined) known.set(r.handle, x);
    }
  }
  const inFile = (h: Handle) => {
    const x = known.get(h);
    const id = x === undefined ? undefined : file.ids.idOf(x);
    return id !== undefined && file.entity(id)?.owner === ms ? id : undefined;
  };

  // ── The content: what the file had, and what is new to it ─────────────────────────────────
  const content = host.blockEntities(block).map((id) => host.entity(id)!);
  const fresh = new Set(content.filter((e) => inFile(e.handle) === undefined).map((e) => e.handle));
  const copied = copyToClipboard(
    host,
    content.map((e) => e.id),
    { x: 0, y: 0 },
  ).clipboard;
  const clip = forFile(copied, prefix, insUnitsOf(file), fresh);
  const b = new ChangeSetBuilder(file);
  const { report, map } = pasteKnown(b, file, clip, ms, known);

  const all = new Map(known);
  for (const [h, x] of map) all.set(h, x);
  for (const e of content) {
    const xid = inFile(e.handle);
    if (xid === undefined) continue;
    const x = b.entity(xid)!;
    const { id: _id, raw: _raw, ...init } = e;
    const want: Record<string, unknown> = { ...renumber(init, all), id: xid, owner: ms };
    // What the load left out of the host (the file's raw data, a reactor or dictionary of an
    // object the host never had) stays as the file has it.
    for (const [k, v] of Object.entries(x)) {
      if (!(k in want) && (k === 'raw' || HANDLE_KEYS.has(k))) want[k] = v;
    }
    if (!same(want, x)) b.updateEntity(xid, patchBack(want, x) as never);
  }

  // An object of the file the host had (the host's ids keep every handle they ever held), gone
  // from the content: erased in the edit. One the load left out (on a layer it did not bring, a
  // reference to an overlay) the host never had, and stays.
  const here = new Set(content.map((e) => e.handle));
  const hostOf = new Map<Handle, Handle>();
  for (const [h, x] of known) if (!hostOf.has(x)) hostOf.set(x, h);
  for (const id of file.blockEntities(ms)) {
    const h = hostOf.get(file.entity(id)!.handle);
    if (h !== undefined && host.ids.idOf(h) !== undefined && !here.has(h)) b.removeEntity(id);
  }

  const added: [Handle, Handle][] = [];
  report.ids.forEach((id, i) => {
    const from = clip.entities[i]!;
    const to = b.entity(id)!;
    added.push([from.handle, to.handle]);
    if (from.geom.kind === 'INSERT' && to.geom.kind === 'INSERT') {
      from.geom.attributes.forEach((a, j) => {
        const t = (to.geom as typeof from.geom).attributes[j];
        if (t) added.push([a.handle, t.handle]);
      });
    }
  });
  const cs = b.build();
  return {
    changes: isEmptyChangeSet(cs) ? [] : [cs],
    added,
    refused: fresh.size - clip.entities.length,
  };
}

/** Every handle an object of the content holds: its own, and its attributes'. */
export function contentHandles(e: Entity): Handle[] {
  return e.geom.kind === 'INSERT'
    ? [e.handle, ...e.geom.attributes.map((a) => a.handle)]
    : [e.handle];
}
