// What makes a block dynamic, as `CodedObject`s (M2-32 part 4): the extension dictionary entries
// AutoCAD keeps for a dynamic block definition (the `ACAD_ENHANCEDBLOCK` evaluation graph with its
// nodes, the round-trip purge preventer, the `AcDbBlockTableRecordData` of its parameters), for
// each anonymous `*U` state of one (its `AcDbBlockTableRecordData`) and for each reference to one
// (`AcDbBlockRepresentation`: the definition it shows and its parameter values), with every
// object below them. Triya never evaluates them (PRD non-goal 2); it holds them so that PASTECLIP
// can carry a dynamic block into another drawing, where export/coded-objects.ts writes them.
//
// The codes are those the DXF writer writes for each object (the save's own, so a DWG source
// gives what a save of it would), written as for an AC1032 save, which is what every save is
// (DEC-047). A tree is mapped only when every object it owns was written: one the writer leaves
// out would leave a hole a paste cannot fill, so its block pastes static, as before.

import type { BlockRecord } from '@node-projects/acad-ts';
import {
  ACadVersion,
  CadObjectHolder,
  DxfObjectsSectionWriter,
  DxfStreamWriterBase,
  DxfWriterConfiguration,
  Insert,
  type CadDictionary,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import { isHandleCode, type CodedObject, type DxfClassRecord, type DxfGroup } from '@triya/engine';
import { hex } from './common';

/** The extension dictionary entries of a dynamic block's record, by upper-case key. */
const RECORD_KEYS = new Set([
  'ACAD_ENHANCEDBLOCK',
  'ACDBDYNAMICBLOCKROUNDTRIPPURGEPREVENTER',
  'ACDBBLOCKTABLERECORDDATA',
]);
/** The extension dictionary entry of a dynamic block's reference. */
const REFERENCE_KEYS = new Set(['ACDBBLOCKREPRESENTATION']);

/** DXF 360: a hard owner reference, which names an object the tree must hold. */
const HARD_OWNER = 360;

/** Records the group codes a DXF writer writes, as `writeRaw` takes them back. */
class CodeRecorder extends DxfStreamWriterBase {
  readonly codes: { code: number; value: unknown }[] = [];
  close(): void {}
  dispose(): void {}
  flush(): void {}
  protected writeDxfCode(code: number): void {
    this.codes.push({ code, value: undefined });
  }
  protected writeValue(_code: number, value: unknown): void {
    this.codes[this.codes.length - 1]!.value = value;
  }
}

/** A writer's protected entry point, which writes every object queued in its holder. */
interface SectionWriter {
  writeSection(): void;
}

/** One written object: its type and codes, the handle and owner they state. */
interface Written {
  readonly dxfName: string;
  readonly handle: number;
  readonly owner: number;
  readonly codes: DxfGroup[];
}

function groupValue(code: number, value: unknown): DxfGroup['value'] | undefined {
  if (isHandleCode(code)) {
    if (typeof value === 'number' || typeof value === 'bigint') return hex(value);
    return undefined;
  }
  if (typeof value === 'bigint') return Number(value);
  // The file holds a flag as 0 or 1, whatever the object held it as (a DWG read gives booleans
  // where a DXF read gives numbers).
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' || typeof value === 'number' || value instanceof Uint8Array)
    return value;
  return undefined;
}

/** The written objects in `codes` (split at each DXF 0), or undefined for a value Triya cannot hold. */
function split(codes: readonly { code: number; value: unknown }[]): Written[] | undefined {
  const out: Written[] = [];
  let current: { dxfName: string; codes: DxfGroup[] } | undefined;
  const close = (): boolean => {
    if (!current) return true;
    // The handle is the first 5, the owner the first 330 before a subclass and outside a group.
    let handle: number | undefined;
    let owner: number | undefined;
    let inGroup = false;
    for (const { code, value } of current.codes) {
      if (code === 100) break;
      if (code === 102) inGroup = String(value).startsWith('{');
      else if (code === 5 && handle === undefined) handle = Number.parseInt(value as string, 16);
      else if (code === 330 && !inGroup && owner === undefined)
        owner = Number.parseInt(value as string, 16);
    }
    if (handle === undefined || owner === undefined) return false;
    out.push({ ...current, handle, owner });
    return true;
  };
  for (const { code, value } of codes) {
    if (code === 0) {
      if (!close()) return undefined;
      current = { dxfName: String(value), codes: [] };
      continue;
    }
    const v = groupValue(code, value);
    if (v === undefined || !current) return undefined;
    current.codes.push({ code, value: v });
  }
  return close() ? out : undefined;
}

/** The CLASSES entry of `dxfName` in `doc`, or the one acad-ts knows for an object of it. */
function dxfClassOf(doc: CadDocument, o: CadObject | undefined, dxfName: string) {
  const c =
    [...(doc.classes ?? [])].find((k) => k.dxfName.toUpperCase() === dxfName.toUpperCase()) ??
    o?.getDxfClass() ??
    null;
  if (!c) return undefined;
  const out: DxfClassRecord = {
    cppClassName: c.cppClassName,
    applicationName: c.applicationName,
    proxyFlags: c.proxyFlags as number,
    wasZombie: c.wasZombie,
  };
  return out;
}

/**
 * The coded trees of every dynamic block definition, state and reference in `doc`, in the order
 * written, each tree's top objects keyed by their extension dictionary entry name.
 */
export function mapCodedObjects(doc: CadDocument): CodedObject[] {
  const holders: { xdict: CadDictionary; keys: ReadonlySet<string> }[] = [];
  for (const r of doc.blockRecords ?? []) {
    const x = r.xDictionary;
    if (x && isDynamicRecord(r)) holders.push({ xdict: x, keys: RECORD_KEYS });
    for (const e of r.entities) {
      if (e instanceof Insert && e.xDictionary) {
        holders.push({ xdict: e.xDictionary, keys: REFERENCE_KEYS });
      }
    }
  }
  if (holders.length === 0) return [];

  const config = new DxfWriterConfiguration();
  config.writeDynamicBlockData = true;
  const recorder = new CodeRecorder();
  const holder = new CadObjectHolder();
  const writer = new DxfObjectsSectionWriter(recorder, doc, holder, config);
  const header = doc.header;
  const version = header?.version;
  // Setting the version sets the maintenance version too.
  const maintenance = header?.maintenanceVersion;
  // Written as every save writes them (DEC-047); the header is put back below.
  if (header) header.version = ACadVersion.AC1032;
  const out: CodedObject[] = [];
  try {
    for (const { xdict, keys } of holders) {
      for (const key of xdict.entryNames) {
        if (!keys.has(key.toUpperCase())) continue;
        const top = xdict.getEntry(key);
        if (!top) continue;
        recorder.codes.length = 0;
        holder.objects.push(top);
        (writer as unknown as SectionWriter).writeSection();
        const tree = split(recorder.codes);
        if (!tree || tree[0]?.handle !== top.handle || !complete(tree)) continue;
        for (const w of tree) {
          const o = doc.getCadObject(w.handle) ?? undefined;
          const dxfClass = dxfClassOf(doc, o, w.dxfName);
          out.push({
            handle: hex(w.handle),
            type: 'CODED_OBJECT',
            owner: hex(w.owner),
            dxfName: w.dxfName,
            ...(w.handle === top.handle ? { key } : {}),
            codes: w.codes,
            ...(dxfClass ? { dxfClass } : {}),
            raw: { handle: hex(w.handle) },
          });
        }
      }
    }
  } finally {
    if (header && version !== undefined) {
      header.version = version;
      if (maintenance !== undefined) header.maintenanceVersion = maintenance;
    }
    holder.objects.length = 0;
  }
  return out;
}

/** A dynamic block definition (its graph) or a state of one (AcDbBlockRepBTag xdata). */
function isDynamicRecord(r: BlockRecord): boolean {
  if (r.xDictionary?.entryNames.some((n) => n.toUpperCase() === 'ACAD_ENHANCEDBLOCK')) return true;
  for (const [app] of r.extendedData) if (app.name === 'AcDbBlockRepBTag') return true;
  return false;
}

/** Every object a tree's objects hard-own is in it, and each one's owner is in it or its top's. */
function complete(tree: readonly Written[]): boolean {
  const handles = new Set(tree.map((w) => w.handle));
  const top = tree[0]!;
  for (const w of tree) {
    if (w !== top && !handles.has(w.owner)) return false;
    for (const { code, value } of w.codes) {
      if (code !== HARD_OWNER || typeof value !== 'string') continue;
      const h = Number.parseInt(value, 16);
      if (h !== 0 && !handles.has(h)) return false;
    }
  }
  return true;
}
