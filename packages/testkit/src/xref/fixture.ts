// The xref test drawings (M1-21), authored here (Rule 0, DEC-047): three AC1032 DXFs and a PNG
// that `pnpm fixtures:xref` writes to packages/testkit/fixtures/xref/, where the app specs
// (tests/e2e/ui/xref.spec.ts, references.spec.ts) and the fixture golden images
// (tests/e2e/fidelity/fixtures.spec.ts) read them; fixture.test.ts keeps the files in step and
// loads them as the app does.
//
// - xref-parent.dxf: an A3 sheet border (420 × 297) on BORDER. It attaches xref-child-tb.dxf
//   as `xref-child-tb` at (230, 10) and overlays the same file as `xref-child-ovl` at (20, 150).
//   VISRETAIN is on, and the parent keeps its own `xref-child-tb|TB-LINES` record (xref-dependent
//   and resolved, DXF 70 48), turned red where the child has it green: the attachment's dividers
//   draw red and the overlay's stay green (M1-107). The overlay is XCLIPped to the title
//   block's left part, (-5, -5)–(100, 65) of the block: its logo and stamp show, its frame's
//   right end and the grandchild do not.
// - xref-child-tb.dxf: a 180 × 60 title block: frame on TB-FRAME (red), dividers on TB-LINES
//   (green), a block LOGO (circle and cross on layer 0) inserted on TB-LOGO (blue), and the
//   PNG image xref-stamp.png (12 × 6 pixels, 3 units each) at (46, 36). It attaches
//   xref-grandchild.dxf at (140, 30) and overlays xref-missing-overlay.dxf at (150, 10), a file
//   that does not exist: nested overlays are never loaded, so nobody is asked for it. The child
//   stores (0, 0) as the grandchild's base point, as a stale host file does.
// - xref-grandchild.dxf: a 40 × 40 square with its diagonals on GC (magenta), INSBASE (20, 20):
//   the load takes the base point from it, so the square sits at (120, 10)–(160, 50) of the
//   title block.
// - xref-stamp.png: four vertical bands, orange, white, teal, white.
import {
  ACadVersion,
  BlockRecord,
  BlockTypeFlags,
  CadDictionary,
  CadDocument,
  Circle,
  Color,
  ImageDefinition,
  Insert,
  Layer,
  Line,
  LwPolyline,
  Matrix4,
  RasterImage,
  SpatialFilter,
  StandardFlags,
  XY,
  XYZ,
  type Entity,
} from '@node-projects/acad-ts';
import { writeCadDocument } from '@triya/io';
import { encodePng } from '../fidelity/compare';

export const XREF_PARENT = 'xref-parent.dxf';
export const XREF_CHILD = 'xref-child-tb.dxf';
export const XREF_GRANDCHILD = 'xref-grandchild.dxf';
export const XREF_MISSING_OVERLAY = 'xref-missing-overlay.dxf';
export const XREF_STAMP = 'xref-stamp.png';
/** The parent's own record of a layer of its attached child (VISRETAIN). */
export const VISRETAIN_LAYER = 'xref-child-tb|TB-LINES';

/** Where the parent places the child's attachment and overlay. */
export const CHILD_AT = { x: 230, y: 10 };
export const CHILD_OVERLAY_AT = { x: 20, y: 150 };
/** Where the child places the grandchild, and the grandchild's INSBASE. */
export const GRANDCHILD_AT = { x: 140, y: 30 };
export const GRANDCHILD_INSBASE = { x: 20, y: 20 };
/** The overlay's XCLIP boundary, in the title block's coordinates. */
export const OVERLAY_CLIP = { min: { x: -5, y: -5 }, max: { x: 100, y: 65 } };

/** The stamp's bands, left to right, three pixels each. */
export const STAMP_BANDS: readonly (readonly [number, number, number])[] = [
  [255, 128, 0],
  [255, 255, 255],
  [0, 128, 128],
  [255, 255, 255],
];

export function xrefStampPng(): Uint8Array {
  const w = 12;
  const h = 6;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set([...STAMP_BANDS[x >> 2]!, 255], (y * w + x) * 4);
  }
  return encodePng({ width: w, height: h, data });
}

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
  doc.header!.modelSpaceInsertionBase = new XYZ(GRANDCHILD_INSBASE.x, GRANDCHILD_INSBASE.y, 0);
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
  // The stamp: 3 units a pixel, its file beside the drawing.
  const def = new ImageDefinition('xref-stamp');
  def.fileName = `.\\${XREF_STAMP}`;
  def.size = new XY(12, 6);
  def.defaultSize = new XY(1, 1);
  doc.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadImageDict)!.add(def);
  const stamp = new RasterImage();
  add(doc, logoLayer, stamp);
  stamp.definition = def;
  stamp.insertPoint = new XYZ(46, 36, 0);
  stamp.uVector = new XYZ(3, 0, 0);
  stamp.vVector = new XYZ(0, 3, 0);
  stamp.size = new XY(12, 6);
  // DXF 70: show the image, and when not aligned with the screen.
  stamp.flags = (1 | 2) as never;
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
  // What AutoCAD keeps of an xref layer the user recoloured in the host (VISRETAIN 1).
  doc.header!.retainXRefDependentVisibilitySettings = true;
  const kept = new Layer(VISRETAIN_LAYER);
  kept.flags = StandardFlags.XrefDependent | StandardFlags.XrefResolved;
  kept.color = new Color(1);
  doc.layers!.add(kept);
  const zero = doc.layers!.tryGetValue('0')!;
  add(doc, zero, reference(xref(doc, 'xref-child-tb', `.\\${XREF_CHILD}`), CHILD_AT));
  const overlay = reference(
    xref(doc, 'xref-child-ovl', `.\\${XREF_CHILD}`, true),
    CHILD_OVERLAY_AT,
  );
  add(doc, zero, overlay);
  xclip(overlay, CHILD_OVERLAY_AT);
  return writeCadDocument(doc, { format: 'dxf' });
}

/**
 * The XCLIP AutoCAD stores for a rectangle picked on a reference at `at` (scale 1, no turn): the
 * boundary's corners in the drawing, the inverse of the reference's transform, an identity
 * boundary transform, clipping on (M1-103).
 */
function xclip(insert: Insert, at: { x: number; y: number }): void {
  const { min, max } = OVERLAY_CLIP;
  const filter = new SpatialFilter();
  filter.boundaryPoints = [new XY(at.x + min.x, at.y + min.y), new XY(at.x + max.x, at.y + max.y)];
  filter.displayBoundary = true;
  filter.inverseInsertTransform = new Matrix4([
    1,
    0,
    0,
    -at.x,
    0,
    1,
    0,
    -at.y,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
  ]);
  filter.insertTransform = Matrix4.identity();
  const dict = new CadDictionary('ACAD_FILTER');
  insert.createExtendedDictionary().addByKey('ACAD_FILTER', dict);
  dict.addByKey('SPATIAL', filter);
  filter.addReactor(dict);
}
