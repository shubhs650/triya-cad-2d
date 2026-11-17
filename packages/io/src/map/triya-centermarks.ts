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
// Version 2 (M4-29, DEC-068, the owner's option A on #482) adds a 90 after each 331: the vertex a
// centerline's polyline segment starts at, -1 for a LINE. The save writes version 2 only for a
// record with a polyline segment, so a centerline between lines stays version 1, which a Triya
// build before version 2 reads.
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
/** DEC-068's layout: version 1 with a 90 segment index after each 331. */
export const TRIYA_CENTERMARK_SEGMENTS_VERSION = 2;

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
  version: number,
):
  | Pick<
      CenterMark,
      'kind' | 'objects' | 'segments' | 'crossSize' | 'crossGap' | 'extensions' | 'showExtensions'
    >
  | undefined {
  const g = new Map<number, unknown>();
  const objects: string[] = [];
  const segments: number[] = [];
  for (const [i, { code, value }] of entries.entries()) {
    if (code === 90 && version === TRIYA_CENTERMARK_SEGMENTS_VERSION) {
      // Only straight after a 331: one segment index per object.
      const n = number(value);
      if (entries[i - 1]?.code !== 331 || n === undefined || !Number.isInteger(n) || n < -1) {
        return undefined;
      }
      segments.push(n);
    } else if (code === 331) {
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
  if (version === TRIYA_CENTERMARK_SEGMENTS_VERSION) {
    // Every object has its index; a center mark's circle or arc has no segment.
    if (segments.length !== objects.length) return undefined;
    if (kind === 'mark' && segments.some((n) => n !== -1)) return undefined;
  }
  const extensions: number[] = [];
  for (const code of kind === 'mark' ? [40, 41, 42, 43] : [40, 41]) {
    const n = number(g.get(code));
    if (n === undefined) return undefined;
    extensions.push(n);
  }
  if (kind === 'line') {
    return segments.some((n) => n >= 0)
      ? { kind, objects, segments, extensions }
      : { kind, objects, extensions };
  }
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
    const version = number(entries.find((e) => e.code === 70)?.value);
    if (version !== TRIYA_CENTERMARK_VERSION && version !== TRIYA_CENTERMARK_SEGMENTS_VERSION) {
      continue;
    }
    const fields = fieldsOf(entries, doc, version);
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
