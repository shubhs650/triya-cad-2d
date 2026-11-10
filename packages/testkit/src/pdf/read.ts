// A plotted PDF as a reader sees it (M2-17's Plot dialog test): pdf.js reads the bytes in Node and
// reports the first page's size in millimetres, the page labels and how many paths it draws.
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface PdfSummary {
  readonly pages: number;
  /** The first page, millimetres. */
  readonly width: number;
  readonly height: number;
  readonly labels: readonly string[] | null;
  /** Path constructions on the first page. */
  readonly paths: number;
}

const PT_PER_MM = 72 / 25.4;

export async function pdfSummary(bytes: Uint8Array): Promise<PdfSummary> {
  const pdf = await getDocument({ data: bytes, useWasm: false }).promise;
  const page = await pdf.getPage(1);
  const [x0, y0, x1, y1] = page.view as number[];
  const ops = await page.getOperatorList();
  return {
    pages: pdf.numPages,
    width: (x1! - x0!) / PT_PER_MM,
    height: (y1! - y0!) / PT_PER_MM,
    labels: await pdf.getPageLabels(),
    paths: ops.fnArray.filter((f) => f === OPS.constructPath).length,
  };
}
