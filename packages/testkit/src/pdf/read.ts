// A plotted PDF as a reader sees it (M2-17's Plot dialog test): pdf.js reads the bytes in Node and
// reports the first page's size in millimetres, the page labels, how many paths and forms it
// draws, and its text.
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface PdfSummary {
  readonly pages: number;
  /** The first page, millimetres. */
  readonly width: number;
  readonly height: number;
  readonly labels: readonly string[] | null;
  /** Path constructions on the first page. */
  readonly paths: number;
  /** Form XObjects the first page paints (PDF underlays' pages, M2-16 part 5). */
  readonly forms: number;
  /** The first page's text, its items joined by spaces. */
  readonly text: string;
}

const PT_PER_MM = 72 / 25.4;

/** `at`: the page summarised, from 1 (the first page by default). */
export async function pdfSummary(bytes: Uint8Array, at = 1): Promise<PdfSummary> {
  const pdf = await getDocument({ data: bytes, useWasm: false }).promise;
  const page = await pdf.getPage(at);
  const [x0, y0, x1, y1] = page.view as number[];
  const ops = await page.getOperatorList();
  return {
    pages: pdf.numPages,
    width: (x1! - x0!) / PT_PER_MM,
    height: (y1! - y0!) / PT_PER_MM,
    labels: await pdf.getPageLabels(),
    paths: ops.fnArray.filter((f) => f === OPS.constructPath).length,
    forms: ops.fnArray.filter((f) => f === OPS.paintFormXObjectBegin).length,
    text: (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' '),
  };
}
