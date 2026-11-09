// M2-16: the plot sheet's PDF stays what sheet.ts writes (`TRIYA_UPDATE_FIXTURES=1` rewrites
// it, and the golden images in tests/e2e/fidelity/pdf.spec.ts are of the committed file), and an
// independent reader, pdf.js, finds its pages, labels, bookmarks and drawing operators. CI
// also runs `qpdf --check` on it (.github/workflows/ci.yml).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as pdf from '@triya/pdf';
import * as render from '@triya/render';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { SHEET_DIR, SHEET_PAGES, SHEET_PDF, sheetPdf } from './sheet';

let bytes: Uint8Array;
beforeAll(() => {
  bytes = sheetPdf();
  if (process.env['TRIYA_UPDATE_FIXTURES'] === '1') {
    mkdirSync(SHEET_DIR, { recursive: true });
    writeFileSync(SHEET_DIR + SHEET_PDF, bytes);
  }
});

/** Each page's content stream, inflated, in page order. */
function contents(file: Uint8Array): string[] {
  const latin = Buffer.from(file).toString('latin1');
  const out: string[] = [];
  for (const m of latin.matchAll(/\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g)) {
    const start = m.index + m[0].length;
    out.push(
      inflateSync(Buffer.from(file.subarray(start, start + Number(m[1])))).toString('latin1'),
    );
  }
  return out;
}

describe('the plot sheet PDF (M2-16)', () => {
  it('commits the PDF the plot writes', () => {
    expect(existsSync(SHEET_DIR + SHEET_PDF)).toBe(true);
    expect(new Uint8Array(readFileSync(SHEET_DIR + SHEET_PDF))).toEqual(bytes);
  });

  it('opens in pdf.js with three A4 landscape pages, their labels and bookmarks', async () => {
    const task = getDocument({ data: bytes.slice() });
    const doc = await task.promise;
    try {
      expect(doc.numPages).toBe(3);
      expect(await doc.getPageLabels()).toEqual(SHEET_PAGES.map((p) => p.label));
      const outline = await doc.getOutline();
      expect(outline.map((o) => o.title)).toEqual(SHEET_PAGES.map((p) => p.bookmark));
      for (let n = 1; n <= 3; n++) {
        const page = await doc.getPage(n);
        const [x0, y0, x1, y1] = page.view;
        expect([x0, y0]).toEqual([0, 0]);
        expect(x1).toBeCloseTo((297 * 72) / 25.4, 3);
        expect(y1).toBeCloseTo((210 * 72) / 25.4, 3);
        const ops = await page.getOperatorList();
        // Paths only: stroke-font text plots as paths, no text object.
        expect(ops.fnArray).toContain(OPS.constructPath);
        expect(ops.fnArray).not.toContain(OPS.beginText);
        expect(ops.fnArray).not.toContain(OPS.dependency);
      }
      const meta = await doc.getMetadata();
      expect((meta.info as { Producer?: string }).Producer).toBe('Triya CAD 2D');
    } finally {
      await task.destroy();
    }
  });

  it('plots page 1 in colour, page 2 in grey alone, page 3 with plot style linetypes', () => {
    const [colour, mono, linetypes] = contents(bytes);
    expect(colour).toMatch(/^1 0 0 RG$/m);
    // The 50 % transparent hatch (alpha 128 of 255), the thinnest and thickest lineweights.
    expect(colour).toMatch(/^\/GSa502 gs$/m);
    expect(colour).toMatch(/^0 w$/m);
    expect(colour).toMatch(new RegExp(`^${pdf.pdfNumber(2 * pdf.POINTS_PER_MM)} w$`, 'm'));
    expect(colour).toMatch(/^f\*$/m);
    expect(mono).not.toMatch(/ (RG|rg)$/m);
    expect(mono).toMatch(/^0 G$/m);
    // Thirty distinct dash patterns, one per plot style linetype.
    const dashes = new Set([...linetypes!.matchAll(/^\[([^\]]+)\] [\d.]+ d$/gm)].map((m) => m[1]));
    expect(dashes.size).toBeGreaterThanOrEqual(30);
    // Colour 150 screened to 40 %.
    const aci150 = render.aciRgb(150);
    const screened = aci150.map((v) => Math.round(255 - (255 - v) * 0.4) / 255);
    expect(linetypes).toContain(`${screened.map(pdf.pdfNumber).join(' ')} rg`);
  });

  it('shares the renderer’s path opcodes', () => {
    expect([
      pdf.PATH_M,
      pdf.PATH_L,
      pdf.PATH_A,
      pdf.PATH_E,
      pdf.PATH_Z,
      pdf.PATH_Q,
      pdf.PATH_C,
    ]).toEqual([
      render.PATH_M,
      render.PATH_L,
      render.PATH_A,
      render.PATH_E,
      render.PATH_Z,
      render.PATH_Q,
      render.PATH_C,
    ]);
  });
});
