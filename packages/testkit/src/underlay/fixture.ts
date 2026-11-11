// The PDF underlay test drawing (M1-20), authored here (Rule 0, DEC-047): a two-page PDF written
// byte by byte, and an AC1032 DXF attaching both pages. `pnpm fixtures:underlay` writes them to
// packages/testkit/fixtures/underlay/, where the app spec (tests/e2e/ui/pdf-underlay.spec.ts)
// and the golden-image harness (M1-24) read them; fixture.test.ts keeps the files in step.
//
// Page 1 (8.5 × 11 in, portrait): a red filled square (1, 1)–(3, 3) in, a thick blue line, the
// word TRIYA in Helvetica (not embedded: the viewer's own sans-serif), and a 2 × 2 raster
// (green, yellow, magenta, cyan) at (5, 1)–(7, 3) in. Page 2 (11 × 8.5 in, landscape): a green
// filled triangle and a black grid at 1 in.
//
// The DXF shows page 1 at the origin, scale 1 (one drawing unit per inch), and page 2 at
// (12, 0), scale 0.5, turned 30°, clipped by a pentagon; both adjust colours for the background.
import {
  ACadVersion,
  AppId,
  CadDictionary,
  ExtendedData,
  ExtendedDataString,
  CadDocument,
  Line,
  PdfUnderlay,
  PdfUnderlayDefinition,
  XY,
  XYZ,
} from '@node-projects/acad-ts';
import { writeCadDocument } from '@triya/io';

export const UNDERLAY_PDF_NAME = 'pdf-underlay.pdf';
export const UNDERLAY_DXF_NAME = 'pdf-underlay.dxf';

/** Page 2's clip boundary, in its own (unscaled, unturned) inches. */
export const PAGE2_CLIP: readonly { x: number; y: number }[] = [
  { x: 1, y: 1 },
  { x: 10, y: 1 },
  { x: 10, y: 6 },
  { x: 5.5, y: 7.5 },
  { x: 1, y: 6 },
];

const PAGE1 = [
  '1 0 0 rg 72 72 144 144 re f',
  '0 0 1 RG 6 w 72 600 m 540 700 l S',
  'BT 0 0 0 rg /F1 48 Tf 72 400 Td (TRIYA) Tj ET',
  // 2 × 2 RGB, rows top first, ASCII hex (no binary in the file), scaled to 2 × 2 in.
  'q 144 0 0 144 360 72 cm',
  'BI /W 2 /H 2 /CS /RGB /BPC 8 /F /AHx ID',
  '00FF00 FFFF00 FF00FF 00FFFF>',
  'EI Q',
].join('\n');

const PAGE2 = [
  '0 0.6 0 rg 144 144 m 648 144 l 396 504 l h f',
  '0 0 0 RG 1 w',
  ...Array.from({ length: 10 }, (_, i) => `${72 * (i + 1)} 0 m ${72 * (i + 1)} 612 l S`),
  ...Array.from({ length: 7 }, (_, i) => `0 ${72 * (i + 1)} m 792 ${72 * (i + 1)} l S`),
].join('\n');

/** The two-page PDF, deterministic to the byte. */
export function underlayPdf(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${PAGE1.length} >>\nstream\n${PAGE1}\nendstream`,
    `<< /Length ${PAGE2.length} >>\nstream\n${PAGE2}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** The AC1032 DXF attaching pages 1 and 2 of `pdf-underlay.pdf`. */
export function underlayDxf(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  const root = doc.rootDictionary!;
  let defs = root.getEntry<CadDictionary>(CadDictionary.acadPdfDefinitions);
  if (!defs) {
    defs = new CadDictionary(CadDictionary.acadPdfDefinitions);
    root.add(defs);
  }
  const attach = (page: string): PdfUnderlayDefinition => {
    const def = new PdfUnderlayDefinition(`pdf-underlay - ${page}`);
    def.file = `.\\${UNDERLAY_PDF_NAME}`;
    def.page = page;
    defs.add(def);
    return def;
  };
  const one = new PdfUnderlay(attach('1'));
  doc.entities!.add(one);
  one.insertPoint = new XYZ(0, 0, 0);
  one.flags = (2 | 8) as never;
  one.contrast = 100;
  one.fade = 0;

  const two = new PdfUnderlay(attach('2'));
  doc.entities!.add(two);
  two.insertPoint = new XYZ(12, 0, 0);
  two.xScale = two.yScale = two.zScale = 0.5;
  two.rotation = Math.PI / 6;
  two.flags = (1 | 2 | 8) as never;
  two.contrast = 100;
  two.fade = 0;
  two.clipBoundaryVertices = PAGE2_CLIP.map((p) => new XY(p.x, p.y));

  // A reference line along the X axis under both pages.
  doc.entities!.add(new Line(new XYZ(0, -1, 0), new XYZ(20, -1, 0)));
  return writeCadDocument(doc, { format: 'dxf' });
}

// The PDF layers test drawing (M2-38 part 2, ULAYERS): a one-page PDF (4 × 3 in) with three
// optional content groups, a red square (0.25, 1)–(1.25, 2) in "Walls", a blue one (1.5, 1)–
// (2.5, 2) in "Notes" (its name UTF-16BE) and a green one (2.75, 1)–(3.75, 2) in "Draft", which
// the document shows off by default; and an AC1032 DXF attaching the page twice at scale 1,
// at the origin with every layer as the PDF shows it, and at (0, −4) with "Walls" turned off
// by its `AdeskUnderlayLayerOverrideData` xdata, as ULAYERS keeps it.

export const LAYERS_PDF_NAME = 'pdf-underlay-layers.pdf';
export const LAYERS_DXF_NAME = 'pdf-underlay-layers.dxf';
/** Where each square's centre is on the page, inches. */
export const LAYER_SQUARES = {
  Walls: { x: 0.75, y: 1.5 },
  Notes: { x: 2, y: 1.5 },
  Draft: { x: 3.25, y: 1.5 },
} as const;
/** The second underlay's insertion point. */
export const LAYERS_OFF_AT = { x: 0, y: -4 } as const;

const LAYERED_PAGE = [
  '/OC /W BDC 1 0 0 rg 18 72 72 72 re f EMC',
  '/OC /N BDC 0 0 1 rg 108 72 72 72 re f EMC',
  '/OC /D BDC 0 1 0 rg 198 72 72 72 re f EMC',
].join('\n');

/** The layered page, deterministic to the byte. */
export function underlayLayersPdf(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R 6 0 R 7 0 R] /D << /Order [5 0 R 6 0 R 7 0 R] /OFF [7 0 R] >> >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 288 216] /Resources << /Properties << /W 5 0 R /N 6 0 R /D 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${LAYERED_PAGE.length} >>\nstream\n${LAYERED_PAGE}\nendstream`,
    '<< /Type /OCG /Name (Walls) >>',
    '<< /Type /OCG /Name <FEFF004E006F007400650073> >>',
    '<< /Type /OCG /Name (Draft) >>',
  ];
  let out = '%PDF-1.5\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** The AC1032 DXF attaching the layered page twice, the second with "Walls" turned off. */
export function underlayLayersDxf(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  const root = doc.rootDictionary!;
  let defs = root.getEntry<CadDictionary>(CadDictionary.acadPdfDefinitions);
  if (!defs) {
    defs = new CadDictionary(CadDictionary.acadPdfDefinitions);
    root.add(defs);
  }
  const def = new PdfUnderlayDefinition('pdf-underlay-layers - 1');
  def.file = `.\\${LAYERS_PDF_NAME}`;
  def.page = '1';
  defs.add(def);
  const place = (x: number, y: number): PdfUnderlay => {
    const u = new PdfUnderlay(def);
    doc.entities!.add(u);
    u.insertPoint = new XYZ(x, y, 0);
    u.flags = 2 as never;
    u.contrast = 100;
    u.fade = 0;
    return u;
  };
  place(0, 0);
  const off = place(LAYERS_OFF_AT.x, LAYERS_OFF_AT.y);
  const app = new AppId('AdeskUnderlayLayerOverrideData');
  doc.appIds!.add(app);
  off.extendedData.set(app, new ExtendedData([new ExtendedDataString('Walls')]));
  return writeCadDocument(doc, { format: 'dxf' });
}
