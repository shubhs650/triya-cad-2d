// The xref test drawings (M1-21), authored here (Rule 0, DEC-047): three AC1032 DXFs that
// `pnpm fixtures:xref` writes to packages/testkit/fixtures/xref/, where the app spec
// (tests/e2e/ui/xref.spec.ts) and the golden-image harness (M1-24) read them; fixture.test.ts
// keeps the files in step and loads them as the app does.
//
// - xref-parent.dxf: an A3 sheet border (420 × 297) on BORDER. It attaches xref-child-tb.dxf
//   as `xref-child-tb` at (230, 10) and overlays the same file as `xref-child-ovl` at (20, 150).
//   (No VISRETAIN `xref|layer` record: acad-ts refuses to write a name with `|`, M1-107.)
// - xref-child-tb.dxf: a 180 × 60 title block: frame on TB-FRAME (red), dividers on TB-LINES
//   (green), a block LOGO (circle and cross on layer 0) inserted on TB-LOGO (blue). It attaches
//   xref-grandchild.dxf at (120, 10) and overlays xref-missing-overlay.dxf at (150, 10), a file
//   that does not exist: nested overlays are never loaded, so nobody is asked for it.
// - xref-grandchild.dxf: a 40 × 40 square with its diagonals on GC (magenta).
import {
  ACadVersion,
  BlockRecord,
  BlockTypeFlags,
  CadDocument,
  Circle,
  Color,
  Insert,
  Layer,
  Line,
  LwPolyline,
  XY,
  XYZ,
  type Entity,
} from '@node-projects/acad-ts';
import { writeCadDocument } from '@triya/io';

export const XREF_PARENT = 'xref-parent.dxf';
export const XREF_CHILD = 'xref-child-tb.dxf';
export const XREF_GRANDCHILD = 'xref-grandchild.dxf';
export const XREF_MISSING_OVERLAY = 'xref-missing-overlay.dxf';

/** Where the parent places the child's attachment and overlay. */
export const CHILD_AT = { x: 230, y: 10 };
export const CHILD_OVERLAY_AT = { x: 20, y: 150 };
/** Where the child places the grandchild. */
export const GRANDCHILD_AT = { x: 120, y: 10 };

function rectangle(x: number, y: number, w: number, h: number): LwPolyline {
  const p = new LwPolyline([
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ] as unknown as XY[]);
  p.isClosed = true;
  return p;
}

function newDocument(view: { x: number; y: number; w: number; h: number }): CadDocument {
  const doc = new CadDocument(ACadVersion.AC1032);
  doc.updateCollections(true, true);
  // Saved zoomed to the drawing, as a drafter leaves it: the app opens in this view.
  const active = [...doc.vPorts!].find((v) => v.name.toUpperCase() === '*ACTIVE')!;
  active.center = new XY(view.x + view.w / 2, view.y + view.h / 2);
  active.viewHeight = view.h * 1.1;
  active.aspectRatio = 1.6;
  return doc;
}

function layer(doc: CadDocument, name: string, aci: number): Layer {
  const l = new Layer(name);
  l.color = new Color(aci);
  doc.layers!.add(l);
  return doc.layers!.tryGetValue(name) ?? l;
}

function add(doc: CadDocument, on: Layer, ...entities: Entity[]): void {
  for (const e of entities) {
    doc.entities!.add(e);
    e.layer = on;
  }
}

/** An xref block record: attached, or overlaid (DXF 70 4 | 8, as AutoCAD writes it). */
function xref(doc: CadDocument, name: string, path: string, overlay = false): BlockRecord {
  const record = new BlockRecord(name, path, overlay);
  record.blockFlags |= BlockTypeFlags.XRef;
  doc.blockRecords!.add(record);
  return record;
}

function reference(block: BlockRecord, at: { x: number; y: number }): Insert {
  const i = new Insert(block);
  i.insertPoint = new XYZ(at.x, at.y, 0);
  return i;
}

export function xrefGrandchildDxf(): Uint8Array {
  const doc = newDocument({ x: 0, y: 0, w: 40, h: 40 });
  const gc = layer(doc, 'GC', 6);
  add(
    doc,
    gc,
    rectangle(0, 0, 40, 40),
    new Line(new XYZ(0, 0, 0), new XYZ(40, 40, 0)),
    new Line(new XYZ(0, 40, 0), new XYZ(40, 0, 0)),
  );
  return writeCadDocument(doc, { format: 'dxf' });
}

export function xrefChildDxf(): Uint8Array {
  const doc = newDocument({ x: 0, y: 0, w: 180, h: 60 });
  const frame = layer(doc, 'TB-FRAME', 1);
  const lines = layer(doc, 'TB-LINES', 3);
  const logoLayer = layer(doc, 'TB-LOGO', 5);
  add(doc, frame, rectangle(0, 0, 180, 60));
  add(
    doc,
    lines,
    new Line(new XYZ(40, 0, 0), new XYZ(40, 60, 0)),
    new Line(new XYZ(40, 30, 0), new XYZ(180, 30, 0)),
  );
  const logo = new BlockRecord('LOGO');
  logo.entities.add(new Circle(new XYZ(0, 0, 0), 12));
  logo.entities.add(new Line(new XYZ(-12, 0, 0), new XYZ(12, 0, 0)));
  logo.entities.add(new Line(new XYZ(0, -12, 0), new XYZ(0, 12, 0)));
  doc.blockRecords!.add(logo);
  add(doc, logoLayer, reference(logo, { x: 20, y: 30 }));
  const zero = doc.layers!.tryGetValue('0')!;
  add(
    doc,
    zero,
    reference(xref(doc, 'xref-grandchild', `.\\${XREF_GRANDCHILD}`), GRANDCHILD_AT),
    reference(xref(doc, 'xref-missing-overlay', `.\\${XREF_MISSING_OVERLAY}`, true), {
      x: 150,
      y: 10,
    }),
  );
  return writeCadDocument(doc, { format: 'dxf' });
}

export function xrefParentDxf(): Uint8Array {
  const doc = newDocument({ x: 0, y: 0, w: 420, h: 297 });
  const border = layer(doc, 'BORDER', 7);
  add(doc, border, rectangle(0, 0, 420, 297));
  const zero = doc.layers!.tryGetValue('0')!;
  add(
    doc,
    zero,
    reference(xref(doc, 'xref-child-tb', `.\\${XREF_CHILD}`), CHILD_AT),
    reference(xref(doc, 'xref-child-ovl', `.\\${XREF_CHILD}`, true), CHILD_OVERLAY_AT),
  );
  return writeCadDocument(doc, { format: 'dxf' });
}
