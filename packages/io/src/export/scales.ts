// TriyaToAcad for the drawing's scale list (M6-02 part 21), the inverse of map/scales.ts: each
// scale is a SCALE in the `ACAD_SCALELIST` dictionary under its key (A0, A1, …), which orders
// the list. SCALELISTEDIT's edits: a deleted scale leaves the dictionary; a kept one takes its
// new key in place (keys may swap, as Move Up and Move Down do), its new name (DXF 300) and ratio
// (140, 141); a new one joins under its key, listing the dictionary as its reactor as AutoCAD
// files one, with DXF 290 as the engine gives it. Entries keep the places they had in the file
// and new ones follow: AutoCAD's dictionary is sorted by key, so it lists them by key as Triya
// does.
//
// Refused, before anything changes: a version before AutoCAD 2007's (the save writes AC1032,
// DEC-047), a scale moving to another dictionary or filed in one other than ACAD_SCALELIST, a
// new scale's handle in use, a key two scales share, or one an entry Triya keeps as read holds,
// two scales of one name (without regard to case), a ratio not positive, deleting a scale or
// changing the ratio of one that an object Triya keeps as read names (`referenced`), and
// reactor, extension dictionary and xdata changes.
import {
  ACadVersion,
  CadDictionary,
  Scale,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import {
  isDrawingScale,
  type DocumentInit,
  type DocumentModel,
  type DrawingScale,
  type Handle,
} from '@triya/engine';
import { namedDictionary } from '../map/header';
import { entryKey, entryTakenProblems, renameEntries } from './dictionary-entries';
import { resolve, same, type Resolver } from './entities';

export interface ScalesPlan {
  readonly updated: {
    readonly acad: Scale;
    readonly before: DrawingScale;
    readonly after: DrawingScale;
  }[];
  readonly added: DrawingScale[];
  readonly removed: Scale[];
}

/** Fields no writer handles (a scale's own xdata, reactors and extension dictionary). */
const UNSUPPORTED = ['xdata', 'reactors', 'extDict'] as const;

const handle = (h: Handle): number => Number.parseInt(h, 16);

const ratioOk = (s: DrawingScale): boolean =>
  s.paperUnits > 0 && s.drawingUnits > 0 && Number.isFinite(s.paperUnits / s.drawingUnits);

export function planScales(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
): { plan: ScalesPlan; problems: string[] } {
  const plan: ScalesPlan = { updated: [], added: [], removed: [] };
  const problems: string[] = [];
  const before = new Map((base.objects ?? []).filter(isDrawingScale).map((o) => [o.handle, o]));
  const after = [...model.objects.values()].filter(isDrawingScale);
  const dict = namedDictionary(doc, CadDictionary.acadScaleList);
  const version = r.version;
  const old =
    version !== undefined && version !== ACadVersion.Unknown && version < ACadVersion.AC1021
      ? `${ACadVersion[version]} has no scale list (AutoCAD 2007's format added it)`
      : undefined;

  for (const [h, b] of before) {
    if (isDrawingScale(model.objects.get(h))) continue;
    const acad = resolve(r, h, Scale);
    if (!acad) problems.push(`SCALE ${h}: the original is not a SCALE`);
    else if (b.referenced)
      problems.push(`SCALE ${b.name} (${h}): an object the drawing keeps names it`);
    else if (old) problems.push(`SCALE ${b.name} (${h}): ${old}`);
    else plan.removed.push(acad);
  }
  const count = (key: (s: DrawingScale) => string) => {
    const out = new Map<string, number>();
    for (const a of after) out.set(key(a), (out.get(key(a)) ?? 0) + 1);
    return out;
  };
  const names = count((s) => String(s.name).toUpperCase());
  const keys = count((s) => String(s.key).toUpperCase());
  const mapped = new Set([...before.keys()]);
  const isMapped = (o: { handle: number }) => mapped.has(o.handle.toString(16).toUpperCase());
  for (const a of after) {
    const b = before.get(a.handle);
    if (b && same(b, a)) continue;
    const out: string[] = [];
    if (old) out.push(old);
    if (typeof a.name !== 'string' || a.name.trim() === '') out.push('a scale needs a name');
    else if ((names.get(a.name.toUpperCase()) ?? 0) > 1)
      out.push(`another scale is named ${a.name}`);
    if (typeof a.key !== 'string' || !/^[A-Z0-9]+$/i.test(a.key)) out.push('a scale needs a key');
    else if ((keys.get(a.key.toUpperCase()) ?? 0) > 1)
      out.push(`another scale has the key ${a.key}`);
    if (!ratioOk(a)) out.push('paper units and drawing units must be positive');
    if (typeof a.unitScale !== 'boolean') out.push('unitScale: DXF 290 is a yes or a no');
    if (b) {
      const acad = resolve(r, a.handle, Scale);
      if (!acad) out.push('the original is not a SCALE');
      if (b.owner !== a.owner) out.push('its dictionary changes');
      for (const k of UNSUPPORTED) if (!same(b[k], a[k])) out.push(`${k} changes`);
      if (b.referenced && (b.paperUnits !== a.paperUnits || b.drawingUnits !== a.drawingUnits))
        out.push('an object the drawing keeps names it, at its paper and drawing units');
      if (!same(b.referenced, a.referenced)) out.push('referenced: it is what the drawing holds');
      if (acad && typeof a.key === 'string' && b.key !== a.key)
        out.push(...entryTakenProblems(dict, a.key, isMapped));
      if (out.length === 0) plan.updated.push({ acad: acad!, before: b, after: a });
    } else {
      if (doc.getCadObject(handle(a.handle))) out.push('the handle is already used');
      if (!dict)
        out.push(`the drawing has no ${CadDictionary.acadScaleList} dictionary to list it in`);
      else if (dict.handle !== handle(a.owner))
        out.push(`it is not filed in ${CadDictionary.acadScaleList}`);
      // A new scale lists its dictionary as its reactor, as AutoCAD files one.
      if (a.reactors !== undefined && !same(a.reactors, [a.owner])) out.push('reactors changes');
      if (a.xdata !== undefined) out.push('xdata changes');
      if (a.extDict !== undefined) out.push('extDict changes');
      if (a.referenced !== undefined) out.push('referenced: a new scale is named by nothing kept');
      if (typeof a.key === 'string') out.push(...entryTakenProblems(dict, a.key, isMapped));
      if (out.length === 0) plan.added.push(a);
    }
    problems.push(...out.map((p) => `SCALE ${String(a.name)} (${a.handle}): ${p}`));
  }
  return { plan, problems };
}

/**
 * Writes the plan, before the entities (a copied annotative object's context data names its
 * scale): deleted scales leave the dictionary first, keys change next, as they may swap or pass
 * to a new scale, then names and ratios, and new scales join last.
 */
export function writeScales(
  doc: CadDocument,
  r: Resolver & { readonly created: Map<Handle, CadObject> },
  plan: ScalesPlan,
): void {
  for (const acad of plan.removed) {
    const dict = acad.owner;
    if (!(dict instanceof CadDictionary)) continue;
    const key = entryKey(dict, acad);
    if (key !== undefined) dict.remove(key);
  }
  const rekeyed = plan.updated.filter(({ before, after }) => before.key !== after.key);
  // A rename gives the object the entry's name: its own name is set again below.
  renameEntries(rekeyed.map(({ acad, after }) => ({ acad, name: after.key })));
  for (const { acad, before: b, after: a } of plan.updated) {
    if (b.key !== a.key || b.name !== a.name) acad.name = a.name;
    if (b.paperUnits !== a.paperUnits) acad.paperUnits = a.paperUnits;
    if (b.drawingUnits !== a.drawingUnits) acad.drawingUnits = a.drawingUnits;
    if (b.unitScale !== a.unitScale) acad.isUnitScale = a.unitScale;
  }
  if (plan.added.length === 0) return;
  // planScales refuses a new scale where ACAD_SCALELIST is missing.
  const dict = namedDictionary(doc, CadDictionary.acadScaleList)!;
  for (const a of plan.added) {
    const acad = new Scale(a.name);
    // acad-ts keeps a non-zero handle it has not seen, so the scale keeps Triya's handle.
    acad.handle = handle(a.handle);
    acad.paperUnits = a.paperUnits;
    acad.drawingUnits = a.drawingUnits;
    acad.isUnitScale = a.unitScale;
    dict.addByKey(a.key, acad);
    acad.addReactor(dict);
    r.created.set(a.handle, acad);
  }
}
