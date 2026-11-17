// Center marks and centerlines Triya made (CENTERMARK, CENTERLINE; M4-08 part 2, DEC-066): the
// `TRIYA_CENTERMARK` XRECORD in a mark INSERT's extension dictionary, read into the mark's
// `CenterMark` record. Its groups:
//
//   70 the layout's version (1); 71 the kind (0 center mark, 1 centerline); 331 each object it
//   is made on (a center mark's circle or arc; a centerline's first and second line, in order);
//   a center mark's 1 cross size and 3 cross gap, as CENTERCROSSSIZE and CENTERCROSSGAP state
//   them (a length, or a factor of the diameter followed by `x`); 40, 41, 42, 43 the extension
//   lengths (a center mark's left, right, top, bottom; a centerline's 40 start and 41 end); a
//   center mark's 290 show extensions.
//
// A record of another version or kind, one missing a group, or one naming an object the drawing
// does not hold is not mapped: the mark stays a plain block reference and the record as read.
import {
  CadDictionary,
  CadObject,
  Insert,
  XRecord,
  type CadDocument,
} from '@node-projects/acad-ts';
import type { CenterMark } from '@triya/engine';
import { common, hex } from './common';

/** The extension dictionary entry a mark's record is filed under. */
export const TRIYA_CENTERMARK = 'TRIYA_CENTERMARK';
/** The record layout DEC-066 sets out. */
export const TRIYA_CENTERMARK_VERSION = 1;

/** 71: the kinds in order. */
export const CENTER_MARK_KINDS: readonly CenterMark['kind'][] = ['mark', 'line'];

type Entries = readonly { readonly code: number; readonly value: unknown }[];

const number = (v: unknown): number | undefined => {
  const n = typeof v === 'bigint' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/** The record's fields the groups state, or undefined when they are not a whole record. */
function fieldsOf(
  entries: Entries,
  doc: CadDocument,
):
  | Pick<
      CenterMark,
      'kind' | 'objects' | 'crossSize' | 'crossGap' | 'extensions' | 'showExtensions'
    >
  | undefined {
  const g = new Map<number, unknown>();
  const objects: string[] = [];
  for (const { code, value } of entries) {
    if (code === 331) {
      const n = number(value);
      const o =
        value instanceof CadObject ? value : n === undefined ? undefined : doc.getCadObject(n);
      // An object the drawing does not hold makes the record unreadable.
      if (!o) return undefined;
      objects.push(hex(o.handle));
    } else if (!g.has(code)) g.set(code, value);
  }
  const kind = CENTER_MARK_KINDS[number(g.get(71)) ?? -1];
  if (!kind || objects.length !== (kind === 'mark' ? 1 : 2)) return undefined;
  const extensions: number[] = [];
  for (const code of kind === 'mark' ? [40, 41, 42, 43] : [40, 41]) {
    const n = number(g.get(code));
    if (n === undefined) return undefined;
    extensions.push(n);
  }
  if (kind === 'line') return { kind, objects, extensions };
  const crossSize = g.get(1);
  const crossGap = g.get(3);
  const show = g.get(290);
  const showExtensions = typeof show === 'boolean' ? show : number(show);
  if (typeof crossSize !== 'string' || typeof crossGap !== 'string') return undefined;
  if (showExtensions === undefined) return undefined;
  return {
    kind,
    objects,
    crossSize,
    crossGap,
    extensions,
    showExtensions: showExtensions === true || showExtensions !== 0,
  };
}

/** The marks' records. */
export function mapTriyaCenterMarks(doc: CadDocument): CenterMark[] {
  const out: CenterMark[] = [];
  for (const o of doc.getCadObjects()) {
    if (!(o instanceof XRecord)) continue;
    const dict = o.owner;
    const insert = dict instanceof CadDictionary ? dict.owner : undefined;
    if (!(dict instanceof CadDictionary) || !(insert instanceof Insert)) continue;
    if (insert.xDictionary !== dict) continue;
    const key = dict.entryNames.find((k) => dict.getEntry(k) === o)?.toUpperCase();
    if (key !== TRIYA_CENTERMARK) continue;
    const entries = o.entries as Entries;
    if (number(entries.find((e) => e.code === 70)?.value) !== TRIYA_CENTERMARK_VERSION) continue;
    const fields = fieldsOf(entries, doc);
    if (!fields) continue;
    out.push({
      ...common(o),
      type: 'TRIYA_CENTERMARK',
      owner: hex(dict.handle),
      insert: hex(insert.handle),
      ...fields,
    });
  }
  return out;
}
