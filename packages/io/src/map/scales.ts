// AcadToTriya for the drawing's scale list (M6-02 part 21): the SCALE objects of the
// ACAD_SCALELIST dictionary in dictionary order, each with its entry key, which orders the list
// as AutoCAD keys it (A0, A1, …; engine `drawingScales`) (DXF 300 name,
// 140 paper units, 141 drawing units, 290 unit scale). SCALELISTEDIT adds, edits, reorders and
// deletes them (export/scales.ts writes it).
//
// A scale something Triya does not map points at is `referenced`: SCALELISTEDIT may not delete it
// or change its ratio, which would leave that object naming nothing or drawing at another scale.
// What points at a SCALE is an annotative object's context data (DXF 340): acad-ts reads the
// TEXT, MTEXT attribute, block reference and multileader kinds; the others (dimension, MTEXT,
// hatch, leader, …) it keeps as read, with their group codes in a DXF, whose pointers are
// searched. A DWG's object it cannot read keeps no group codes, so in a drawing with one such
// object filed as context data every scale counts as referenced.
import {
  AnnotScaleObjectContextData,
  CadDictionary,
  CadObject,
  Scale,
  UnknownNonGraphicalObject,
  XRecord,
  type CadDocument,
} from '@node-projects/acad-ts';
import type { DrawingScale, Handle } from '@triya/engine';
import { common, ref } from './common';
import { namedDictionary } from './header';

/** Group codes that hold a handle: soft and hard pointers and owners (DXF reference). */
const POINTER = (code: number): boolean =>
  (code >= 320 && code <= 369) || (code >= 390 && code <= 399) || (code >= 480 && code <= 481);

/** The context data dictionary of an annotative object, which holds one object per scale. */
const ANNOTATION_SCALES = 'ACDB_ANNOTATIONSCALES';

function inContextData(o: CadObject): boolean {
  const dict = o.owner;
  if (!(dict instanceof CadDictionary)) return false;
  const parent = dict.owner;
  return parent instanceof CadDictionary && parent.get(ANNOTATION_SCALES) === dict;
}

/** The SCALE handles the drawing's unmapped objects point at; `all` when it cannot be told. */
function referencedScales(doc: CadDocument, scales: ReadonlySet<number>): Set<number> | 'all' {
  const out = new Set<number>();
  // A pointer's value: the object itself once resolved, else its handle as read.
  const note = (v: unknown) => {
    const h =
      typeof v === 'string'
        ? Number.parseInt(v, 16)
        : typeof v === 'number' || typeof v === 'bigint'
          ? Number(v)
          : v instanceof CadObject
            ? v.handle
            : NaN;
    if (scales.has(h)) out.add(h);
  };
  for (const o of doc.getCadObjects()) {
    if (o instanceof AnnotScaleObjectContextData) {
      if (o.scale) out.add(o.scale.handle);
    } else if (o instanceof UnknownNonGraphicalObject) {
      if (o.rawDxfCodes) {
        for (const c of o.rawDxfCodes) if (POINTER(c.code)) note(c.value);
      } else if (inContextData(o)) return 'all';
    } else if (o instanceof XRecord) {
      for (const e of o.entries) if (POINTER(e.code)) note(e.value);
    }
  }
  return out;
}

export function mapScales(doc: CadDocument): DrawingScale[] {
  const dict = namedDictionary(doc, CadDictionary.acadScaleList);
  if (!dict) return [];
  const entries = [...dict];
  const handles = new Set(entries.flatMap((o) => (o instanceof Scale ? [o.handle] : [])));
  const referenced = handles.size > 0 ? referencedScales(doc, handles) : new Set<number>();
  const owner: Handle = ref(dict) ?? '0';
  const out: DrawingScale[] = [];
  dict.entryNames.forEach((key, i) => {
    const s = entries[i];
    if (!(s instanceof Scale) || s.handle === 0) return;
    out.push({
      ...common(s),
      type: 'SCALE',
      owner,
      key,
      name: s.name ?? '',
      paperUnits: s.paperUnits,
      drawingUnits: s.drawingUnits,
      unitScale: s.isUnitScale,
      ...(referenced === 'all' || referenced.has(s.handle) ? { referenced: true } : {}),
    });
  });
  return out;
}
