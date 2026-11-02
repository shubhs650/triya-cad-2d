// Drawing health report v1 (M1-25, PRD FR-Z4): the file's version and units, the fonts drawn
// with a stand-in, the references it names, the pattern hatches nothing can draw, and what
// Triya keeps without understanding (unknown and proxy objects, entities it does not map).
//
// Two steps, so the expensive half runs where the document is:
// - `drawingFacts` reads what only the file knows. It runs in the I/O worker beside the
//   mapping (`openDocument` returns it) and is plain data, so it crosses postMessage.
// - `healthReport` sets those facts against what the app has loaded: its `FontBook` (the
//   user's fonts and the bundled Hershey fonts, M1-09) and its `PatternLibrary` (the bundled
//   set and the user's .pat files, M1-50). It is cheap and is run again when either changes.
//
// This file is the first step and report.ts the second. The complete report (unused tables,
// OVERKILL candidates, units sanity, fixes) is M8-07.

import {
  BlockTypeFlags,
  ImageDefinition,
  PdfUnderlayDefinition,
  ProxyEntity,
  ProxyObject,
  UnknownEntity,
  UnknownNonGraphicalObject,
  type CadDocument,
} from '@node-projects/acad-ts';
import type { DocumentInit, EntityInit, TextStyleRecord } from '@triya/engine';
import type { UnmappedEntity } from '../map/entities';

/** A file another file names: an xref's drawing, an image's bitmap, an underlay's PDF. */
export interface DrawingReference {
  readonly kind: 'xref' | 'image' | 'pdf';
  /** The xref's block name, or the image or underlay definition's name. */
  readonly name: string;
  /** As the file stores it (relative, absolute or bare). */
  readonly path: string;
}

/** What the health report needs from the file itself (structured-clone safe). */
export interface DrawingFacts {
  /** `$ACADVER`, e.g. `AC1032`. */
  readonly version: string;
  /** `$INSUNITS`. */
  readonly insUnits: number;
  readonly measurement: 'imperial' | 'metric';
  readonly textStyles: readonly {
    readonly name: string;
    readonly font: string;
    readonly bigFont?: string;
    readonly trueTypeFlags: number;
    /** DXF 70 bit 1: a shape file (complex linetype shapes), not a text font. */
    readonly shapeFile: boolean;
  }[];
  /**
   * Predefined and custom pattern hatches stored without their pattern lines, by pattern
   * name (case as first seen) with how many there are: they draw only if a loaded pattern
   * file defines the name.
   */
  readonly patternHatches: readonly { readonly pattern: string; readonly count: number }[];
  readonly references: readonly DrawingReference[];
  /** Objects read but not understood, by type: unknown classes and proxies. */
  readonly unknownObjects: readonly { readonly type: string; readonly count: number }[];
  /** Entities Triya does not draw, by type and reason. */
  readonly unmappedEntities: readonly {
    readonly type: string;
    readonly reason: UnmappedEntity['reason'];
    readonly count: number;
  }[];
}

export function drawingFacts(
  doc: CadDocument,
  init: Pick<DocumentInit, 'meta' | 'tables' | 'entities'>,
  unmapped: readonly UnmappedEntity[],
): DrawingFacts {
  const meta = init.meta;
  return {
    version: meta?.sourceVersion ?? '',
    insUnits: meta?.insUnits ?? 0,
    measurement: meta?.measurement ?? 'metric',
    textStyles: (init.tables?.textStyles ?? []).map(textStyleFacts),
    patternHatches: patternHatches(init.entities ?? []),
    references: references(doc),
    unknownObjects: unknownObjects(doc),
    unmappedEntities: tally(
      unmapped,
      (u) => `${u.type}\u0000${u.reason}`,
      (u, count) => ({ type: u.type, reason: u.reason, count }),
    ),
  };
}

function textStyleFacts(s: TextStyleRecord): DrawingFacts['textStyles'][number] {
  return {
    name: s.name,
    font: s.font,
    ...(s.bigFont ? { bigFont: s.bigFont } : {}),
    trueTypeFlags: s.trueTypeFlags,
    shapeFile: ((s.flags ?? 0) & 1) !== 0,
  };
}

function patternHatches(entities: readonly EntityInit[]): DrawingFacts['patternHatches'] {
  const stored: string[] = [];
  for (const e of entities) {
    const g = e.geom;
    // DXF 76: 0 user-defined (drawn from its angle and spacing), 1 predefined, 2 custom.
    if (g.kind === 'HATCH' && !g.solid && g.patternType !== 0 && g.patternLines.length === 0) {
      stored.push(g.pattern);
    }
  }
  // AutoCAD matches pattern names without regard to case.
  return tally(
    stored,
    (p) => p.toUpperCase(),
    (pattern, count) => ({ pattern, count }),
  );
}

function references(doc: CadDocument): DrawingReference[] {
  const out: DrawingReference[] = [];
  for (const b of doc.blockRecords ?? []) {
    const xref = (b.blockFlags & (BlockTypeFlags.XRef | BlockTypeFlags.XRefOverlay)) !== 0;
    if (xref) out.push({ kind: 'xref', name: b.name, path: b.blockEntity?.xRefPath ?? '' });
  }
  for (const o of doc.getCadObjects()) {
    if (o instanceof ImageDefinition) {
      out.push({ kind: 'image', name: o.name || baseName(o.fileName), path: o.fileName });
    } else if (o instanceof PdfUnderlayDefinition) {
      // AutoCAD names the definition after the file and page ("plan - 1").
      const name = o.name || `${baseName(o.file)}${o.page ? ` - ${o.page}` : ''}`;
      out.push({ kind: 'pdf', name, path: o.file });
    }
  }
  return out;
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

function unknownObjects(doc: CadDocument): DrawingFacts['unknownObjects'] {
  const types: string[] = [];
  for (const o of doc.getCadObjects()) {
    if (
      o instanceof UnknownEntity ||
      o instanceof UnknownNonGraphicalObject ||
      o instanceof ProxyEntity ||
      o instanceof ProxyObject
    ) {
      types.push(o.objectName || '(unnamed)');
    }
  }
  return tally(
    types,
    (t) => t,
    (type, count) => ({ type, count }),
  );
}

/** Counts items by key, sorted by key, keeping the first item of each. */
function tally<T, R>(items: readonly T[], key: (t: T) => string, make: (first: T, n: number) => R) {
  const groups = new Map<string, { first: T; count: number }>();
  for (const t of items) {
    const k = key(t);
    const g = groups.get(k);
    if (g) g.count++;
    else groups.set(k, { first: t, count: 1 });
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, g]) => make(g.first, g.count));
}
