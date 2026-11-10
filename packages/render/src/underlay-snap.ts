// A PDF page's vector paths for running object snaps (M2-22): pdf.js parses the page in its own
// worker (`PDFPageProxy.getOperatorList`), and this walks the operator list it returns, keeping
// the current transformation matrix through save/restore, `cm` and form XObjects, and collects
// every painted path's segments and curves in page inches (the underlay's own space) through
// engine's `UnderlaySnapBuilder`. Paths only clipped with (`W n`, pdf.js `endPath`) show
// nothing and offer nothing; text, images, shadings and annotations' appearances are skipped,
// as AutoCAD snaps to a PDF's geometry, not its raster content.
//
// pdf.js itself is the app's (apps/web/src/underlay/pdfjs.ts), so this takes its `OPS` codes
// and runs in Node tests against the same operator lists.
import { UnderlaySnapBuilder, type UnderlaySnapPage } from '@triya/engine';

/** The pdf.js `OPS` codes this reads (pdfjs-dist 6.4 `OPS`). */
export interface PdfOperatorCodes {
  readonly save: number;
  readonly restore: number;
  readonly transform: number;
  readonly constructPath: number;
  readonly endPath: number;
  readonly paintFormXObjectBegin: number;
  readonly paintFormXObjectEnd: number;
  readonly beginAnnotation: number;
  readonly endAnnotation: number;
}

/** What `getOperatorList` resolves to. */
export interface PdfOperatorList {
  readonly fnArray: ArrayLike<number>;
  readonly argsArray: ArrayLike<unknown>;
}

/** The page's displayed size and its transform from PDF user space (pdf.js `getViewport`). */
export interface PdfPageViewport {
  /** [a, b, c, d, e, f], user space → viewport points (origin top-left, y down). */
  readonly transform: readonly number[];
  readonly height: number;
}

/** pdf.js 6.4 `DrawOPS`: the codes inside a `constructPath`'s path data. */
const MOVE_TO = 0;
const LINE_TO = 1;
const CURVE_TO = 2;
const QUAD_TO = 3;
const CLOSE = 4;

/** PDF points per inch. */
const POINTS = 72;

type M = readonly [number, number, number, number, number, number];

/** `m` then `n`. */
const then = (m: M, n: M): M => [
  n[0] * m[0] + n[2] * m[1],
  n[1] * m[0] + n[3] * m[1],
  n[0] * m[2] + n[2] * m[3],
  n[1] * m[2] + n[3] * m[3],
  n[0] * m[4] + n[2] * m[5] + n[4],
  n[1] * m[4] + n[3] * m[5] + n[5],
];

const IDENTITY: M = [1, 0, 0, 1, 0, 0];

const matrix = (v: unknown): M | undefined => {
  if (!v || typeof v !== 'object' || (v as ArrayLike<number>).length !== 6) return undefined;
  const a = Array.from(v as ArrayLike<number>);
  return a.every(Number.isFinite) ? (a as unknown as M) : undefined;
};

/** A page's painted paths as snap geometry, in page inches from its displayed lower-left. */
export function underlaySnapFromOperatorList(
  list: PdfOperatorList,
  ops: PdfOperatorCodes,
  viewport: PdfPageViewport,
): UnderlaySnapPage {
  const b = new UnderlaySnapBuilder();
  const view = matrix(viewport.transform) ?? IDENTITY;
  // Viewport points (y down from the top) → page inches (y up from the bottom).
  const inches: M = [1 / POINTS, 0, 0, -1 / POINTS, 0, viewport.height / POINTS];
  const toPage = then(view, inches);
  let ctm: M = IDENTITY;
  let full = then(ctm, toPage);
  const stack: M[] = [];
  let annotation = 0;
  const set = (m: M) => {
    ctm = m;
    full = then(ctm, toPage);
  };

  for (let i = 0; i < list.fnArray.length && !b.full; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as readonly unknown[] | null;
    if (fn === ops.beginAnnotation) annotation++;
    else if (fn === ops.endAnnotation) annotation = Math.max(0, annotation - 1);
    else if (fn === ops.save) stack.push(ctm);
    else if (fn === ops.restore) set(stack.pop() ?? IDENTITY);
    else if (fn === ops.transform) {
      const m = matrix(args);
      if (m) set(then(m, ctm));
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = matrix(args?.[0]);
      if (m) set(then(m, ctm));
    } else if (fn === ops.paintFormXObjectEnd) set(stack.pop() ?? IDENTITY);
    else if (fn === ops.constructPath && annotation === 0 && args) {
      if (args[0] === ops.endPath) continue;
      const data = (args[1] as readonly unknown[] | undefined)?.[0] as ArrayLike<number> | null;
      if (data) walk(data, full, b);
    }
  }
  return b.build();
}

/** One path's segments and curves, through `m`, into `b`. */
function walk(d: ArrayLike<number>, m: M, b: UnderlaySnapBuilder): void {
  const x = (px: number, py: number) => m[0] * px + m[2] * py + m[4];
  const y = (px: number, py: number) => m[1] * px + m[3] * py + m[5];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < d.length;) {
    const op = d[i++];
    if (op === MOVE_TO) {
      cx = sx = x(d[i]!, d[i + 1]!);
      cy = sy = y(d[i]!, d[i + 1]!);
      i += 2;
    } else if (op === LINE_TO) {
      const nx = x(d[i]!, d[i + 1]!);
      const ny = y(d[i]!, d[i + 1]!);
      b.line(cx, cy, nx, ny);
      [cx, cy] = [nx, ny];
      i += 2;
    } else if (op === CURVE_TO) {
      const p = [0, 2, 4].map((k) => [x(d[i + k]!, d[i + k + 1]!), y(d[i + k]!, d[i + k + 1]!)]);
      const [[x1, y1], [x2, y2], [x3, y3]] = p as [
        [number, number],
        [number, number],
        [number, number],
      ];
      b.cubic(cx, cy, x1, y1, x2, y2, x3, y3);
      [cx, cy] = [x3, y3];
      i += 6;
    } else if (op === QUAD_TO) {
      const x1 = x(d[i]!, d[i + 1]!);
      const y1 = y(d[i]!, d[i + 1]!);
      const x2 = x(d[i + 2]!, d[i + 3]!);
      const y2 = y(d[i + 2]!, d[i + 3]!);
      b.quadratic(cx, cy, x1, y1, x2, y2);
      [cx, cy] = [x2, y2];
      i += 4;
    } else if (op === CLOSE) {
      b.line(cx, cy, sx, sy);
      [cx, cy] = [sx, sy];
    } else {
      // A code this version does not know: the rest of the path cannot be read.
      return;
    }
  }
}
