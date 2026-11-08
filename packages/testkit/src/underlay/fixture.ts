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
  CadDictionary,
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
