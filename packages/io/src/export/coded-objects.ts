// TriyaToAcad for `CodedObject`s (M2-32 part 4), the inverse of map/coded.ts: what makes a block
// dynamic, which PASTECLIP brings into a drawing with a dynamic block's records and references.
// Each tree goes into a new extension dictionary of the record or reference it came with (the
// holder's new `extDict`, which this writer makes, as xclips.ts makes a clipped reference's),
// under its key; the objects below hang from the coded object that owns them. They are written
// as unknown objects holding the codes the source's save wrote for them, with their CLASSES
// entry, so the file states them as the source did and a reader (Triya's or AutoCAD's) maps
// them as it maps the source's.
//
// Refused, before anything changes: a coded object of the original that changes or goes (Triya
// never edits a dynamic block), a tree under a record or reference the drawing has already (a
// paste only brings new ones), a child whose owner is not a new coded object, a handle in use,
// and a save to DWG or to a version other than AC1032, which the codes were written for (every
// save is AC1032, DEC-047). A tree whose record or reference is gone (erased after the paste)
// went with it: nothing is written for it, as AutoCAD erases an object's extension dictionary.

import {
  ACadVersion,
  BlockRecord,
  CadDictionary,
  DictionaryCloningFlags,
  DxfClass,
  Entity as AcadEntity,
  UnknownNonGraphicalObject,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import {
  isCodedObject,
  isHandleCode,
  type CodedObject,
  type DocumentInit,
  type DocumentModel,
  type Handle,
} from '@triya/engine';
import type { CadFormat } from '../read';
import { resolve, same, type Resolver } from './entities';

/** A new extension dictionary and the trees it holds, on a record or reference the save adds. */
interface NewDictionary {
  readonly holder: Handle;
  readonly handle: Handle;
  /** Its entries, then every object below them, parents first. */
  readonly objects: readonly CodedObject[];
}

export interface CodedObjectsPlan {
  readonly dictionaries: readonly NewDictionary[];
}

/** The objects' owners: the new dictionaries the plan makes, by holder (record or entity). */
export function newCodedDictionaries(plan: CodedObjectsPlan): Map<Handle, Handle> {
  return new Map(plan.dictionaries.map((d) => [d.holder, d.handle]));
}

/** The records whose new dictionary holds a dynamic block's evaluation graph. */
export function newGraphs(plan: CodedObjectsPlan): Set<Handle> {
  return new Set(
    plan.dictionaries
      .filter((d) => d.objects.some((o) => o.key?.toUpperCase() === 'ACAD_ENHANCEDBLOCK'))
      .map((d) => d.holder),
  );
}

/** The model's coded objects against the original's mapping, and why any cannot be written. */
export function planCodedObjects(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
  format: CadFormat | undefined,
): { plan: CodedObjectsPlan; problems: string[] } {
  const problems: string[] = [];
  const before = new Map(
    (base.objects ?? []).filter(isCodedObject).map((o) => [o.handle, o] as const),
  );
  const added: CodedObject[] = [];
  for (const o of model.objects.values()) {
    if (!isCodedObject(o)) continue;
    const b = before.get(o.handle);
    if (!b) added.push(o);
    else if (!same(b, o)) problems.push(`${o.dxfName} ${o.handle}: a coded object changes`);
  }
  for (const [h, b] of before) {
    if (!model.objects.has(h)) problems.push(`${b.dxfName} ${h}: removing a coded object`);
  }
  const plan: CodedObjectsPlan = { dictionaries: [] };
  if (added.length === 0) return { plan, problems };

  // Who holds each new top object's dictionary: a record or an entity whose `extDict` it is.
  const holders = new Map<Handle, { handle: Handle; new: boolean }>();
  const baseRecords = new Set((base.tables?.blockRecords ?? []).map((b) => b.handle));
  const baseEntities = new Set((base.entities ?? []).map((e) => e.handle));
  for (const rec of model.tables.blockRecords.values()) {
    if (rec.extDict !== undefined) {
      holders.set(rec.extDict, { handle: rec.handle, new: !baseRecords.has(rec.handle) });
    }
  }
  for (const e of model.entities()) {
    if (e.extDict !== undefined) {
      holders.set(e.extDict, { handle: e.handle, new: !baseEntities.has(e.handle) });
    }
  }
  const children = new Map<Handle, CodedObject[]>();
  for (const o of added) {
    let list = children.get(o.owner);
    if (!list) children.set(o.owner, (list = []));
    list.push(o);
  }
  const placed = new Set<Handle>();
  const dictionaries = new Map<Handle, NewDictionary & { objects: CodedObject[] }>();
  const where = (o: CodedObject) => `${o.dxfName} ${o.handle}`;
  for (const o of added) {
    if (o.key === undefined) continue;
    const holder = holders.get(o.owner);
    if (!holder) {
      // Its record or reference is gone: its dictionary went with it.
      markPlaced(o, children, placed);
      continue;
    }
    if (!holder.new) {
      problems.push(`${where(o)}: ${holder.handle} has an extension dictionary of its own already`);
      continue;
    }
    let d = dictionaries.get(o.owner);
    if (!d)
      dictionaries.set(o.owner, (d = { holder: holder.handle, handle: o.owner, objects: [] }));
    for (const x of tree(o, children)) {
      d.objects.push(x);
      placed.add(x.handle);
    }
  }
  for (const o of added) {
    if (!placed.has(o.handle))
      problems.push(`${where(o)}: its owner ${o.owner} is not a new coded object`);
  }
  if (format === 'dwg') {
    problems.push(
      ...added.slice(0, 1).map((o) => `${where(o)}: a coded object is written to DXF only`),
    );
  }
  const version = r.version;
  if (version !== undefined && version !== ACadVersion.AC1032) {
    problems.push(
      ...added
        .slice(0, 1)
        .map((o) => `${where(o)}: its codes are AC1032's, not ${ACadVersion[version]}'s`),
    );
  }
  for (const d of dictionaries.values()) {
    for (const h of [d.handle, ...d.objects.map((o) => o.handle)]) {
      if (doc.getCadObject(Number.parseInt(h, 16)))
        problems.push(`coded object ${h}: the handle is already used`);
    }
  }
  return { plan: { dictionaries: [...dictionaries.values()] }, problems };
}

/** `top` and every object below it, parents first. */
function tree(top: CodedObject, children: ReadonlyMap<Handle, CodedObject[]>): CodedObject[] {
  const out = [top];
  for (let i = 0; i < out.length; i++) out.push(...(children.get(out[i]!.handle) ?? []));
  return out;
}

function markPlaced(
  top: CodedObject,
  children: ReadonlyMap<Handle, CodedObject[]>,
  placed: Set<Handle>,
): void {
  for (const o of tree(top, children)) placed.add(o.handle);
}

/** `o` as the unknown object the DXF writer writes from its codes. */
function unknownObject(o: CodedObject): UnknownNonGraphicalObject {
  let dxfClass: DxfClass | null = null;
  if (o.dxfClass) {
    dxfClass = new DxfClass();
    dxfClass.dxfName = o.dxfName;
    dxfClass.cppClassName = o.dxfClass.cppClassName;
    dxfClass.applicationName = o.dxfClass.applicationName;
    dxfClass.proxyFlags = o.dxfClass.proxyFlags as never;
    dxfClass.wasZombie = o.dxfClass.wasZombie;
    dxfClass.isAnEntity = false;
  }
  const acad = new UnknownNonGraphicalObject(dxfClass);
  acad.handle = Number.parseInt(o.handle, 16);
  acad.rawDxfName = o.dxfName;
  acad.rawDxfCodes = o.codes.map(({ code, value }) => ({
    code,
    value: isHandleCode(code) && typeof value === 'string' ? Number.parseInt(value, 16) : value,
  }));
  return acad;
}

/**
 * Writes the plan, after the records and entities that hold the new dictionaries. Each tree is
 * put together before its dictionary joins the drawing, which then registers all of it.
 */
export function writeCodedObjects(r: Resolver, plan: CodedObjectsPlan): void {
  for (const d of plan.dictionaries) {
    const holder: CadObject | undefined =
      resolve(r, d.holder, BlockRecord) ?? resolve(r, d.holder, AcadEntity);
    if (!holder) continue; // planned only for a holder the save adds
    const made = new Map<Handle, UnknownNonGraphicalObject>();
    const dict = new CadDictionary();
    dict.handle = Number.parseInt(d.handle, 16);
    dict.hardOwnerFlag = true;
    dict.clonningFlags = DictionaryCloningFlags.KeepExisting;
    for (const o of d.objects) {
      const acad = unknownObject(o);
      made.set(o.handle, acad);
      if (o.key !== undefined) {
        dict.addByKey(o.key, acad);
        continue;
      }
      const parent = made.get(o.owner)!;
      acad.owner = parent;
      parent.rawOwnedObjects.push(acad);
    }
    holder.xDictionary = dict;
  }
}
