// A table's break settings (M4-16 part 10), read and written. AcDbTable keeps them as its break
// data: option flags (1 enabled, 2 repeat top labels, 4 repeat bottom labels, 8 manual
// positions, 16 manual heights), flow direction (1 right, 2 down, 4 left), spacing, and a list of
// break heights, one per part, each with a position, a height and flags (1 the position is the
// part's own, 2 the height); then the break row ranges, each part's position and its first and
// last row (Open Design Specification, TABLE R2010+; acad-ts `BreakData`, `BreakRowRange`).
//
// A DWG from R2010 states them in the table. A DXF states them in the table's round-trip XRECORD
// (`ACAD_ROUNDTRIP_2008_TABLE_ENTITY`, table-content.ts), laid out as AutoCAD 2007 to 2024 write
// it (DEC-071, read from AutoCAD-made DXF files of broken tables; no published reference):
//
//   102 ACAD_ROUNDTRIP_2008_TABLE_ENTITY, 360 the TABLECONTENT,
//   70 2 (no break data) | 70 1 then 90 flags, 90 flow direction, 40 spacing, 90 (the label
//     rows a part repeats, inferred), 90 0, 90 n heights, n × (10/20/30 position, 40 height,
//     90 flags),
//   90 m ranges, m × (10/20/30 position, 90 first row, 90 last row),
//   with 70 1: 90 k, k × 330 the ACAD_TABLE of each part after the first,
//   then 361 the TABLEGEOMETRY when there is one.
//
// AutoCAD writes each part after the first of a broken table as an ACAD_TABLE of its own (330),
// the first's legacy codes holding its own rows only; Triya writes the table as one ACAD_TABLE
// whose `*T` block draws every part, and names no others (k = 0). A range's rows leave out the
// labels a part repeats.
import {
  BreakFlowDirection,
  BreakOptionFlags,
  XYZ,
  type BreakData,
  type TableEntity,
} from '@node-projects/acad-ts';
import type { TableBreakPart, TableBreaks, TablePiece } from '@triya/engine';

type Entry = { readonly code: number; readonly value: unknown };

const DIRECTIONS: Readonly<Record<TableBreaks['direction'], number>> = {
  right: BreakFlowDirection.Right,
  down: BreakFlowDirection.Vertical,
  left: BreakFlowDirection.Left,
};

/** Break heights flags: the entry's position, its height, is the part's own. */
const OWN_POSITION = 1;
const OWN_HEIGHT = 2;

interface Height {
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly flags: number;
}

/** A table's break settings from break data as AcDbTable states it. */
function breaksOf(
  flags: number,
  flow: number,
  spacing: number,
  heights: readonly Height[],
  tableHeight: number,
): TableBreaks {
  const first = heights[0];
  const parts = heights.map((h, k): TableBreakPart | null => {
    if (k === 0) return null;
    const p: { offset?: { x: number; y: number }; height?: number } = {};
    if (h.flags & OWN_POSITION) p.offset = { x: h.x, y: h.y };
    if (h.flags & OWN_HEIGHT && h.height > 0) p.height = h.height;
    return p.offset || p.height !== undefined ? p : null;
  });
  return {
    enabled: (flags & BreakOptionFlags.EnableBreaks) !== 0,
    direction:
      flow === BreakFlowDirection.Left
        ? 'left'
        : flow === BreakFlowDirection.Vertical
          ? 'down'
          : 'right',
    repeatTop: (flags & BreakOptionFlags.RepeatTopLabels) !== 0,
    repeatBottom: (flags & BreakOptionFlags.RepeatBottomLabels) !== 0,
    manualPositions: (flags & BreakOptionFlags.AllowManualPositions) !== 0,
    manualHeights: (flags & BreakOptionFlags.AllowManualHeights) !== 0,
    height: first && first.height > 0 ? first.height : tableHeight,
    spacing,
    ...(parts.some((p) => p) && { parts }),
  };
}

/** The break settings of a DWG table from R2010 (acad-ts's break data); undefined when none. */
export function dwgTableBreaks(t: TableEntity, tableHeight: number): TableBreaks | undefined {
  if (!t.hasBreakData) return undefined;
  const d: BreakData = t.tableBreakData;
  const heights = d.heights.map((h) => ({
    x: h.position.x,
    y: h.position.y,
    height: h.height,
    // acad-ts reads no per-height flags: a position other than the origin, a height, are own.
    flags: (h.position.x !== 0 || h.position.y !== 0 ? OWN_POSITION : 0) | OWN_HEIGHT,
  }));
  return breaksOf(d.flags, d.flowDirection, d.breakSpacing, heights, tableHeight);
}

/** A DXF table's round-trip record read: its break settings and what follows them. */
export interface RecordBreaks {
  /** Undefined for a record stating no break data (70 2). */
  readonly breaks: TableBreaks | undefined;
  /** The break row ranges' count. */
  readonly ranges: number;
  /** The first and last row of the only range, when there is one. */
  readonly onlyRange?: readonly [number, number];
  /** The ACAD_TABLEs of the parts after the first that the record names (AutoCAD's). */
  readonly continued: number;
  /** Where the entries after the break data start (a 361, or the end). */
  readonly end: number;
}

/**
 * The break settings a table's round-trip record states after its 102 and 360 (`entries`),
 * `tableHeight` the table's; undefined for a record laid out otherwise.
 */
export function recordBreaks(
  entries: readonly Entry[],
  tableHeight: number,
): RecordBreaks | undefined {
  let k = 2;
  const next = (code: number): unknown => {
    const e = entries[k];
    if (e?.code !== code) throw new Error('layout');
    k++;
    return e.value;
  };
  const num = (code: number): number => {
    const v = next(code);
    if (typeof v !== 'number') throw new Error('layout');
    return v;
  };
  const point = (): { x: number; y: number } => {
    const v = next(10) as { x?: unknown; y?: unknown } | null;
    if (typeof v?.x !== 'number' || typeof v.y !== 'number') throw new Error('layout');
    return { x: v.x, y: v.y };
  };
  try {
    const layout = num(70);
    if (layout !== 1 && layout !== 2) return undefined;
    let breaks: TableBreaks | undefined;
    if (layout === 1) {
      const flags = num(90);
      const flow = num(90);
      const spacing = num(40);
      num(90);
      num(90);
      const heights: Height[] = [];
      for (let n = num(90); n > 0; n--) {
        const p = point();
        heights.push({ ...p, height: num(40), flags: num(90) });
      }
      breaks = breaksOf(flags, flow, spacing, heights, tableHeight);
    }
    const ranges = num(90);
    let onlyRange: [number, number] | undefined;
    for (let n = 0; n < ranges; n++) {
      point();
      const range: [number, number] = [num(90), num(90)];
      if (ranges === 1) onlyRange = range;
    }
    let continued = 0;
    if (layout === 1) {
      continued = num(90);
      for (let n = 0; n < continued; n++) next(330);
    }
    if (k < entries.length && (entries[k]!.code !== 361 || k + 1 !== entries.length)) {
      return undefined;
    }
    return { breaks, ranges, ...(onlyRange && { onlyRange }), continued, end: k };
  } catch {
    return undefined;
  }
}

/**
 * The record entries after the 102 and 360 that state `breaks` (none: 70 2) and the ranges of
 * `pieces`, the parts the table is drawn in (`tablePieces`), as AutoCAD lays them out.
 */
export function breakRecordEntries(
  breaks: TableBreaks | undefined,
  pieces: readonly TablePiece[],
): [number, unknown][] {
  const out: [number, unknown][] = [];
  if (breaks) {
    const flags =
      (breaks.enabled ? BreakOptionFlags.EnableBreaks : 0) |
      (breaks.repeatTop ? BreakOptionFlags.RepeatTopLabels : 0) |
      (breaks.repeatBottom ? BreakOptionFlags.RepeatBottomLabels : 0) |
      (breaks.manualPositions ? BreakOptionFlags.AllowManualPositions : 0) |
      (breaks.manualHeights ? BreakOptionFlags.AllowManualHeights : 0);
    const own = breaks.parts ?? [];
    let last = 0;
    own.forEach((p, k) => {
      if (k > 0 && p) last = k;
    });
    out.push([70, 1], [90, flags], [90, DIRECTIONS[breaks.direction]], [40, breaks.spacing]);
    // AutoCAD's samples state 2, the title and header rows its parts repeat, with breaks on, 0
    // with them off; the meaning is inferred (DEC-071).
    out.push([90, breaks.enabled ? (pieces[0]?.labels ?? 0) : 0], [90, 0], [90, last + 1]);
    out.push([10, new XYZ(0, 0, 0)], [40, breaks.height], [90, OWN_HEIGHT]);
    for (let k = 1; k <= last; k++) {
      const p = own[k];
      const at = p?.offset ?? { x: 0, y: 0 };
      out.push([10, new XYZ(at.x, at.y, 0)], [40, p?.height ?? 0]);
      out.push([90, (p?.offset ? OWN_POSITION : 0) | (p?.height !== undefined ? OWN_HEIGHT : 0)]);
    }
  } else {
    out.push([70, 2]);
  }
  out.push([90, pieces.length]);
  for (const p of pieces) {
    const rows = p.rows.slice(p.labels);
    out.push([10, new XYZ(p.offset.x, p.offset.y, 0)]);
    out.push([90, rows[0] ?? 0], [90, rows[rows.length - 1] ?? 0]);
  }
  // The ACAD_TABLEs of the parts after the first: none, the table being one (see the head).
  if (breaks) out.push([90, 0]);
  return out;
}
