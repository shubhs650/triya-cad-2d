// Associative arrays Triya made (M3-11, DEC-059): the `TRIYA_ARRAY` XRECORD in an array INSERT's
// extension dictionary, read into the array's `AssocArray` record. Its groups:
//
//   70 the layout's version (1), 71 the type (0 rectangular, 1 polar, 2 path), 340 the source
//   block's BLOCK_RECORD;
//   rectangular: 90 columns, 91 rows, 40 column spacing, 41 row spacing;
//   polar: 10 centre, 11 base point, 90 items, 91 rows, 50 fill angle (degrees, + ccw), 41 row
//   spacing, 290 rotate items;
//   path: 331 the path object (absent once it is erased), 72 method (0 divide, 1 measure), 11
//   base point, 12 tangent direction, 40 item spacing, 90 items, 91 rows, 41 row spacing, 290
//   align items, 291 from the curve's end.
//
// A record of another version or type, one missing a group, or one whose source block is gone
// is not mapped: the array stays a plain block reference and the record is kept as read.
import {
  BlockRecord,
  CadDictionary,
  CadObject,
  Insert,
  XRecord,
  type CadDocument,
} from '@node-projects/acad-ts';
import type { AssocArray, AssocArrayParams, Vec2 } from '@triya/engine';
import { common, hex } from './common';

/** The extension dictionary entry an array's record is filed under. */
export const TRIYA_ARRAY = 'TRIYA_ARRAY';
/** The record layout DEC-059 sets out. */
export const TRIYA_ARRAY_VERSION = 1;

const RECT = 0;
const POLAR = 1;
const PATH = 2;

type Groups = ReadonlyMap<number, unknown>;

const num = (g: Groups, code: number): number | undefined => {
  const v = g.get(code);
  const n = typeof v === 'bigint' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const flag = (g: Groups, code: number): boolean | undefined => {
  const v = g.get(code);
  if (typeof v === 'boolean') return v;
  const n = num(g, code);
  return n === undefined ? undefined : n !== 0;
};
const point = (g: Groups, code: number): Vec2 | undefined => {
  const v = g.get(code) as { x?: unknown; y?: unknown } | undefined;
  return typeof v?.x === 'number' && typeof v.y === 'number' ? { x: v.x, y: v.y } : undefined;
};
const handle = (g: Groups, code: number): CadObject | number | undefined => {
  const v = g.get(code);
  return v instanceof CadObject || typeof v === 'number' ? v : undefined;
};
const count = (g: Groups, code: number): number | undefined => {
  const n = num(g, code);
  return n !== undefined && Number.isInteger(n) && n >= 1 ? n : undefined;
};

/** The parameters the groups state, or undefined when they are not a whole record. */
function params(g: Groups, doc: CadDocument): AssocArrayParams | undefined {
  const rows = count(g, 91);
  const rowSpacing = num(g, 41);
  if (rows === undefined || rowSpacing === undefined) return undefined;
  switch (num(g, 71)) {
    case RECT: {
      const columns = count(g, 90);
      const columnSpacing = num(g, 40);
      if (columns === undefined || columnSpacing === undefined) return undefined;
      return { kind: 'rectangular', columns, rows, columnSpacing, rowSpacing };
    }
    case POLAR: {
      const center = point(g, 10);
      const base = point(g, 11);
      const items = count(g, 90);
      const fill = num(g, 50);
      const rotateItems = flag(g, 290);
      if (!center || !base || items === undefined || fill === undefined) return undefined;
      if (rotateItems === undefined) return undefined;
      const fillAngle = (fill * Math.PI) / 180;
      return { kind: 'polar', center, base, items, fillAngle, rows, rowSpacing, rotateItems };
    }
    case PATH: {
      const method = num(g, 72);
      const base = point(g, 11);
      const tangent = point(g, 12);
      const spacing = num(g, 40);
      const items = count(g, 90);
      const align = flag(g, 290);
      const reversed = flag(g, 291);
      if (method !== 0 && method !== 1) return undefined;
      if (!base || !tangent || spacing === undefined || items === undefined) return undefined;
      if (align === undefined || reversed === undefined) return undefined;
      const p = handle(g, 331);
      const path = p instanceof CadObject ? p : p === undefined ? undefined : doc.getCadObject(p);
      return {
        kind: 'path',
        ...(path ? { path: hex(path.handle) } : {}),
        method: method === 0 ? 'divide' : 'measure',
        base,
        tangent,
        spacing,
        items,
        rows,
        rowSpacing,
        align,
        reversed,
      };
    }
    default:
      return undefined;
  }
}

/** The arrays' records, by handle. */
export function mapTriyaArrays(doc: CadDocument): AssocArray[] {
  const out: AssocArray[] = [];
  for (const o of doc.getCadObjects()) {
    if (!(o instanceof XRecord)) continue;
    const dict = o.owner;
    const insert = dict instanceof CadDictionary ? dict.owner : undefined;
    if (!(dict instanceof CadDictionary) || !(insert instanceof Insert)) continue;
    if (insert.xDictionary !== dict) continue;
    if (dict.entryNames.find((k) => dict.getEntry(k) === o)?.toUpperCase() !== TRIYA_ARRAY) {
      continue;
    }
    const g = new Map<number, unknown>();
    for (const e of o.entries) if (!g.has(e.code)) g.set(e.code, e.value);
    if (num(g, 70) !== TRIYA_ARRAY_VERSION) continue;
    const s = handle(g, 340);
    const source = s instanceof CadObject ? s : s === undefined ? undefined : doc.getCadObject(s);
    if (!(source instanceof BlockRecord)) continue;
    const p = params(g, doc);
    if (!p) continue;
    out.push({
      ...common(o),
      type: 'TRIYA_ARRAY',
      owner: hex(dict.handle),
      insert: hex(insert.handle),
      source: hex(source.handle),
      params: p,
    });
  }
  return out;
}
