// pdf.js behind `OpenPdf` (M1-20): loaded on the first PDF underlay a drawing needs, never
// before (ARCHITECTURE.md §12: lazy), with its worker from the app's own origin. Nothing is
// fetched: no standard-font, CMap, ICC or wasm URL is given, so a PDF naming a standard font it
// does not embed draws with the browser's own (the privacy rule, PRD G6), and wasm decoders
// stay off.
//
// Snap geometry (M2-22): pdf.js parses the page into its operator list in its worker, and the
// painted paths are read from that list (render's `underlaySnapFromOperatorList`).
import type { Box } from '@triya/engine';
import { underlaySnapFromOperatorList, type RasterPixels } from '@triya/render';
import type { OpenPdf, PdfFile } from './pages';

/** PDF points per inch, the underlay unit. */
const POINTS = 72;

async function pdfjs() {
  const [lib, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  return lib;
}

export const openPdf: OpenPdf = async (bytes) => {
  const lib = await pdfjs();
  // pdf.js takes ownership of the buffer it is given; the caller keeps its own.
  const doc = await lib.getDocument({
    data: bytes.slice(),
    useWasm: false,
  }).promise;
  const pages = new Map<number, ReturnType<typeof doc.getPage>>();
  const page = (n: number) => {
    let p = pages.get(n);
    if (!p) pages.set(n, (p = doc.getPage(n)));
    return p;
  };
  const file: PdfFile = {
    pageCount: doc.numPages,
    async pageSize(n) {
      const v = (await page(n)).getViewport({ scale: 1 });
      return { width: v.width / POINTS, height: v.height / POINTS };
    },
    async render(n: number, region: Box, width: number, height: number): Promise<RasterPixels> {
      const p = await page(n);
      const viewport = p.getViewport({ scale: 1 });
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      // Our own context, with alpha: given the canvas, pdf.js makes an opaque one (black
      // paper where the page is clear), and the paper must stay clear.
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      // The viewport is in points from the page's top-left corner, y down; the region is in
      // inches from its bottom-left, y up. Pixels per point along each axis, then the region's
      // top-left corner moved to the canvas origin.
      const sx = width / ((region.maxX - region.minX) * POINTS);
      const sy = height / ((region.maxY - region.minY) * POINTS);
      const top = viewport.height - region.maxY * POINTS;
      await p.render({
        canvas: null,
        canvasContext: ctx,
        viewport,
        transform: [sx, 0, 0, sy, -region.minX * POINTS * sx, -top * sy],
        background: 'rgba(0, 0, 0, 0)',
      }).promise;
      const data = ctx.getImageData(0, 0, width, height).data;
      return { width, height, data };
    },
    async snapGeometry(n) {
      const p = await page(n);
      const list = await p.getOperatorList();
      return underlaySnapFromOperatorList(list, lib.OPS, p.getViewport({ scale: 1 }));
    },
  };
  return file;
};
