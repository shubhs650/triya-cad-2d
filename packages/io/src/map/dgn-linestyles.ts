// DGN linestyle data (M5-09 part 5): the components of the line styles AutoCAD imports from
// MicroStation, which PURGE's "Orphaned data" removes when no linetype uses them. AutoCAD files
// them as its own DGN purge tool reads them (Kean Walmsley, "Purging unwanted DGN linestyle data
// from an AutoCAD drawing using .NET", keanw.com, 2012, and its 2013 and 2014 updates):
//
//   - the components are the entries of the named-object dictionary's `ACAD_DGNLINESTYLECOMP`
//     dictionary (stroke patterns, internal line codes, compounds, point components, symbols);
//   - a linetype made from a DGN line style holds its line style definition under `DGNLSDEF` in
//     its extension dictionary;
//   - a definition refers to the component drawing it, a compound to its parts, a point component
//     to its stroke pattern and symbols, a symbol to the anonymous block drawing it: each a hard
//     pointer (DXF 340), which is all the tool follows.
//
// The objects are of classes acad-ts does not know, kept as read with their group codes (a DXF
// read, `UnknownNonGraphicalObject.rawDxfCodes`): their links are read from those. A drawing whose
// line style data shows no codes (a DWG read keeps an unknown object's bits, not its fields) maps
// none of it, so PURGE offers none and all of it stays as read.
import {
  BlockRecord,
  CadDictionary,
  UnknownNonGraphicalObject,
  XRecord,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import type { DgnLinestyleComponent, Handle } from '@triya/engine';
import { common, hex } from './common';

/** The named-object dictionary entry holding the components. */
export const DGN_COMPONENTS = 'ACAD_DGNLINESTYLECOMP';
/** A linetype's extension dictionary entry holding its line style definition. */
export const DGN_DEFINITION = 'DGNLSDEF';

/** DXF 340–349 (hard pointer) and 360–369 (hard owner). */
const isHardPointer = (code: number): boolean =>
  (code >= 340 && code <= 349) || (code >= 360 && code <= 369);

/** The objects `o` points to hard (DXF 340–349, 360–369), or undefined when its codes are not known. */
export function hardPointers(o: CadObject): number[] | undefined {
  if (o instanceof UnknownNonGraphicalObject) {
    if (!o.rawDxfCodes) return undefined;
    return o.rawDxfCodes
      .filter((c) => isHardPointer(c.code) && typeof c.value === 'number')
      .map((c) => c.value as number);
  }
  if (o instanceof XRecord)
    return o.entries
      .filter((e) => isHardPointer(e.code) && typeof e.value === 'number')
      .map((e) => e.value as number);
  return undefined;
}

/** `dict`'s entry `key`, matched without case, as AutoCAD matches dictionary keys. */
function entry(dict: CadDictionary | null | undefined, key: string): CadObject | undefined {
  const name = dict?.entryNames.find((n) => n.toUpperCase() === key);
  return name === undefined ? undefined : (dict!.getEntry(name) ?? undefined);
}

/** The drawing's `ACAD_DGNLINESTYLECOMP` dictionary, when it has one. */
export function dgnComponentsDictionary(doc: CadDocument): CadDictionary | undefined {
  const d = entry(doc.rootDictionary, DGN_COMPONENTS);
  return d instanceof CadDictionary ? d : undefined;
}

/** Each linetype's line style definition (`DGNLSDEF`), by the linetype. */
export function dgnDefinitions(doc: CadDocument): Map<CadObject, CadObject> {
  const out = new Map<CadObject, CadObject>();
  for (const lt of doc.lineTypes ?? []) {
    const d = entry(lt.xDictionary, DGN_DEFINITION);
    if (d) out.set(lt, d);
  }
  return out;
}

/** The drawing's DGN linestyle components, in their dictionary's order. */
export function mapDgnLinestyles(doc: CadDocument): DgnLinestyleComponent[] {
  const dict = dgnComponentsDictionary(doc);
  if (!dict) return [];
  const entries: { key: string; o: CadObject; to: number[] }[] = [];
  for (const key of dict.entryNames) {
    const o = dict.getEntry(key);
    if (!o) continue;
    const to = hardPointers(o);
    if (!to) return [];
    entries.push({ key, o, to });
  }
  const components = new Set(entries.map((e) => e.o.handle));
  const usedBy = new Map<number, Handle[]>();
  for (const [lt, d] of dgnDefinitions(doc)) {
    const to = hardPointers(d);
    if (!to) return [];
    for (const h of to) {
      if (!components.has(h)) continue;
      const by = usedBy.get(h) ?? [];
      if (!by.includes(hex(lt.handle))) by.push(hex(lt.handle));
      usedBy.set(h, by);
    }
  }
  const unique = (hs: number[]) => [...new Set(hs)].map(hex);
  return entries.map(({ key, o, to }) => ({
    ...common(o),
    type: 'DGN_LS_COMPONENT',
    owner: hex(dict.handle),
    name: key,
    className: o.getDxfClass()?.cppClassName ?? o.objectName,
    usedBy: usedBy.get(o.handle) ?? [],
    parts: unique(to.filter((h) => components.has(h))),
    symbolBlocks: unique(to.filter((h) => doc.getCadObject(h) instanceof BlockRecord)),
  }));
}
