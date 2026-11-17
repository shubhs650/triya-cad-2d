// Dimension breaks and inspection data Triya made (M4-02 part 4, DEC-064): the `TRIYA_DIMBREAK`
// and `TRIYA_DIMINSPECT` XRECORDs in a dimension's extension dictionary, read into `DimBreak`
// and `DimInspect` records. Their groups:
//
//   TRIYA_DIMBREAK    70 the layout's version (1); 331 each object breaking the dimension; 10
//                     and 11 each manual break's two points (pairs in order).
//   TRIYA_DIMINSPECT  70 the version (1); 71 the shape (0 round, 1 angular, 2 none); 1 the
//                     label, absent when the label is off; 3 the inspection rate, absent when
//                     the rate is off.
//
// A leader's and a multileader's breaks (M4-15, DEC-065) are the same `TRIYA_DIMBREAK` record in
// the leader's extension dictionary; inspection data is a dimension's only.
//
// A record of another version, a shape Triya does not know, or one not in a dimension's (or for
// breaks, a leader's) extension dictionary is not mapped: it stays as read, and the dimension
// draws its stored block. A breaking object that is not in the drawing is left out.
import {
  CadDictionary,
  CadObject,
  Dimension,
  Leader,
  MultiLeader,
  XRecord,
  type CadDocument,
} from '@node-projects/acad-ts';
import type { DimBreak, DimInspect, InspectionShape, Vec2 } from '@triya/engine';
import { common, hex } from './common';

export const TRIYA_DIMBREAK = 'TRIYA_DIMBREAK';
export const TRIYA_DIMINSPECT = 'TRIYA_DIMINSPECT';
/** The record layouts DEC-064 sets out. */
export const TRIYA_DIMS_VERSION = 1;

export const INSPECTION_SHAPES: readonly InspectionShape[] = ['round', 'angular', 'none'];

const number = (v: unknown): number | undefined => {
  const n = typeof v === 'bigint' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const point = (v: unknown): Vec2 | undefined => {
  const p = v as { x?: unknown; y?: unknown } | undefined;
  return typeof p?.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : undefined;
};

type Entries = readonly { readonly code: number; readonly value: unknown }[];

function breakOf(entries: Entries, doc: CadDocument): Pick<DimBreak, 'objects' | 'manual'> {
  const objects: string[] = [];
  const manual: [Vec2, Vec2][] = [];
  let first: Vec2 | undefined;
  for (const { code, value } of entries) {
    if (code === 331) {
      const n = number(value);
      const o =
        value instanceof CadObject ? value : n === undefined ? undefined : doc.getCadObject(n);
      if (o) objects.push(hex(o.handle));
    } else if (code === 10) first = point(value);
    else if (code === 11) {
      const second = point(value);
      if (first && second) manual.push([first, second]);
      first = undefined;
    }
  }
  return { objects, manual };
}

function inspectOf(entries: Entries): Pick<DimInspect, 'shape' | 'label' | 'rate'> | undefined {
  const g = new Map<number, unknown>();
  for (const e of entries) if (!g.has(e.code)) g.set(e.code, e.value);
  const shape = INSPECTION_SHAPES[number(g.get(71)) ?? -1];
  if (!shape) return undefined;
  const label = g.get(1);
  const rate = g.get(3);
  return {
    shape,
    ...(typeof label === 'string' && { label }),
    ...(typeof rate === 'string' && { rate }),
  };
}

/** The dimensions' break and inspection records. */
export function mapTriyaDims(doc: CadDocument): (DimBreak | DimInspect)[] {
  const out: (DimBreak | DimInspect)[] = [];
  for (const o of doc.getCadObjects()) {
    if (!(o instanceof XRecord)) continue;
    const dict = o.owner;
    const dim = dict instanceof CadDictionary ? dict.owner : undefined;
    const leader = dim instanceof Leader || dim instanceof MultiLeader;
    if (!(dict instanceof CadDictionary) || !(dim instanceof Dimension || leader)) continue;
    if (dim.xDictionary !== dict) continue;
    const key = dict.entryNames.find((k) => dict.getEntry(k) === o)?.toUpperCase();
    if (key !== TRIYA_DIMBREAK && (key !== TRIYA_DIMINSPECT || leader)) continue;
    const entries = o.entries as Entries;
    if (number(entries.find((e) => e.code === 70)?.value) !== TRIYA_DIMS_VERSION) continue;
    const base = { ...common(o), owner: hex(dict.handle), dimension: hex(dim.handle) };
    if (key === TRIYA_DIMBREAK) {
      out.push({ ...base, type: 'TRIYA_DIMBREAK', ...breakOf(entries, doc) });
      continue;
    }
    const inspect = inspectOf(entries);
    if (inspect) out.push({ ...base, type: 'TRIYA_DIMINSPECT', ...inspect });
  }
  return out;
}
