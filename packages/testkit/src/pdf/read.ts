// A plotted PDF as a reader sees it (M2-17's Plot dialog test): pdf.js reads the bytes in Node and
// reports the first page's size in millimetres, the page labels, how many paths and forms it
// draws, and its text; M2-60 adds the PDF layers, the bookmarks and whether fonts are embedded;
// M2-74 the page's links; M8-04 the colours the page strokes outside its forms.
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
  /** The PDF layers (optional content groups) in the viewer's order, with their visibility. */
  readonly layers: readonly { readonly name: string; readonly visible: boolean }[];
  /** The outline's top-level bookmarks. */
  readonly bookmarks: readonly string[];
  /** Whether the file embeds a font program (none when all text is geometry). */
  readonly fonts: boolean;
  /** The page's link annotations: a URI's address, or the page (from 1) a jump goes to. */
  readonly links: readonly PdfLinkSummary[];
}

export interface PdfLinkSummary {
  /** The URI as pdf.js reads it (`url`, or `unsafeUrl` for a relative or unusual one). */
  readonly url?: string;
  /** The page a GoTo link shows, from 1. */
  readonly page?: number;
  /** [x0, y0, x1, y1], points. */
  readonly rect: readonly number[];
}

const PT_PER_MM = 72 / 25.4;

/** `at`: the page summarised, from 1 (the first page by default). */
export async function pdfSummary(bytes: Uint8Array, at = 1): Promise<PdfSummary> {
  // Before pdf.js takes the buffer: a font program is a FontFile, FontFile2 or FontFile3 stream.
  const fonts = new TextDecoder('latin1').decode(bytes).includes('/FontFile');
  const pdf = await getDocument({ data: bytes.slice(), useWasm: false }).promise;
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
    layers: [...(await pdf.getOptionalContentConfig())].map(([, g]) => ({
      name: g.name ?? '',
      visible: g.visible,
    })),
    bookmarks: ((await pdf.getOutline()) ?? []).map((o) => o.title),
    fonts,
    links: await linksOf(pdf, page),
  };
}

/**
 * The stroke colours (`RG`, as `#rrggbb`) the first page sets outside its forms, in order: what
 * the plot itself draws, not the PDF underlays' pages it paints (M8-04's red-line markup).
 */
export async function pdfStrokeColors(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: bytes.slice(), useWasm: false }).promise;
  const ops = await (await pdf.getPage(1)).getOperatorList();
  const hex = (v: number) => v.toString(16).padStart(2, '0');
  const out: string[] = [];
  let depth = 0;
  ops.fnArray.forEach((fn, i) => {
    if (fn === OPS.paintFormXObjectBegin) depth++;
    else if (fn === OPS.paintFormXObjectEnd) depth--;
    else if (depth === 0 && fn === OPS.setStrokeRGBColor) {
      // pdf.js hands the colour on as a hex string, or as its three components.
      const [c] = ops.argsArray[i] as [string | ArrayLike<number>];
      out.push(typeof c === 'string' ? c.toLowerCase() : `#${Array.from(c, hex).join('')}`);
    }
  });
  return out;
}

type Loaded = Awaited<ReturnType<typeof getDocument>['promise']>;

async function linksOf(
  pdf: Loaded,
  page: Awaited<ReturnType<Loaded['getPage']>>,
): Promise<PdfLinkSummary[]> {
  const out: PdfLinkSummary[] = [];
  for (const a of await page.getAnnotations()) {
    if (a.subtype !== 'Link') continue;
    const url = (a.url ?? a.unsafeUrl) as string | undefined;
    const dest = a.dest as unknown[] | undefined;
    const target = Array.isArray(dest) ? (dest[0] as { num: number; gen: number }) : undefined;
    out.push({
      ...(url !== undefined && { url }),
      ...(target && { page: (await pdf.getPageIndex(target)) + 1 }),
      rect: a.rect as number[],
    });
  }
  return out;
}
