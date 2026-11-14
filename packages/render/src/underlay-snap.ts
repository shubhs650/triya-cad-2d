// A PDF page's vector paths for running object snaps (M2-22): pdf.js parses the page in its own
// worker (`PDFPageProxy.getOperatorList`), and this walks the operator list it returns, keeping
// the current transformation matrix through save/restore, `cm` and form XObjects, and collects
// every painted path's segments and curves in page inches (the underlay's own space) through
// engine's `UnderlaySnapBuilder`. Paths only clipped with (`W n`, pdf.js `endPath`) show
// nothing and offer nothing; text, images, shadings and annotations' appearances are skipped,
// as AutoCAD snaps to a PDF's geometry, not its raster content.
//
// Each path keeps the optional content it is drawn in (M2-56 part 3): pdf.js brackets content
// under /OC (a `BDC` in the content stream, a form XObject's or image's /OC entry) with
// `beginMarkedContentProps('OC', properties)` … `endMarkedContent`, other marked content with
// `beginMarkedContent(Props)` too, so a stack of those gives every path its levels, judged
// against the document's groups (its `OptionalContentConfig`) when osnap runs.
//
// pdf.js itself is the app's (apps/web/src/underlay/pdfjs.ts), so this takes its `OPS` codes
// and runs in Node tests against the same operator lists.
import {
  UnderlaySnapBuilder,
  type UnderlayContent,
  type UnderlaySnapGroup,
  type UnderlaySnapPage,
  type UnderlayVisibility,
} from '@triya/engine';

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
  readonly beginMarkedContent: number;
  readonly beginMarkedContentProps: number;
  readonly endMarkedContent: number;
}

/**
 * The document's optional content groups as pdf.js's `OptionalContentConfig` iterates them
 * (`getOptionalContentConfig()`): id, then the group with its name and default visibility.
 */
export type PdfOptionalContent = Iterable<
  readonly [string, { readonly name: unknown; readonly visible: boolean }]
>;

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

/**
 * pdf.js's marked-content properties for `OC` as engine content, or undefined for none or
 * properties it could not read (which pdf.js shows).
 */
function content(v: unknown): UnderlayContent | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === 'string' ? x : undefined);
  if (o['type'] === 'OCG') {
    const id = str(o['id']);
    return id === undefined ? undefined : { type: 'OCG', id };
  }
  if (o['type'] !== 'OCMD') return undefined;
  const id = str(o['id']);
  const ids = Array.isArray(o['ids']) ? o['ids'].filter((x) => typeof x === 'string') : undefined;
  const expression = Array.isArray(o['expression']) ? visibility(o['expression']) : undefined;
  const policy = str(o['policy']);
  return {
    type: 'OCMD',
    ...(id !== undefined && { id }),
    ...(ids && { ids }),
    ...(policy !== undefined && { policy }),
    ...(expression && { expression }),
  };
}

function visibility(e: readonly unknown[]): UnderlayVisibility {
  const out: (string | UnderlayVisibility)[] = [];
  for (const x of e) {
    if (typeof x === 'string') out.push(x);
    else if (Array.isArray(x)) out.push(visibility(x as unknown[]));
  }
  return out;
}

/** The document's groups as engine groups. */
function groupsOf(config: PdfOptionalContent): UnderlaySnapGroup[] {
  const out: UnderlaySnapGroup[] = [];
  for (const [id, g] of config)
    out.push({ id, name: typeof g.name === 'string' ? g.name : null, on: g.visible !== false });
  return out;
}

/**
 * A page's painted paths as snap geometry, in page inches from its displayed lower-left; with
 * the document's optional content, each path keeps the layers it is drawn in.
 */
export function underlaySnapFromOperatorList(
  list: PdfOperatorList,
  ops: PdfOperatorCodes,
  viewport: PdfPageViewport,
  optionalContent?: PdfOptionalContent,
): UnderlaySnapPage {
  const b = new UnderlaySnapBuilder();
  if (optionalContent) b.groups(groupsOf(optionalContent));
  // Marked content open around the current operator: the `OC` levels, undefined for others.
  const marked: (UnderlayContent | undefined)[] = [];
  const within = () => b.within(marked.filter((c): c is UnderlayContent => c !== undefined));
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
    else if (fn === ops.beginMarkedContent) marked.push(undefined);
    else if (fn === ops.beginMarkedContentProps) {
      marked.push(args?.[0] === 'OC' ? content(args[1]) : undefined);
      within();
    } else if (fn === ops.endMarkedContent) {
      marked.pop();
      within();
    } else if (fn === ops.save) stack.push(ctm);
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
