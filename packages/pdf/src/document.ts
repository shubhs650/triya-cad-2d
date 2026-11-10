// The PDF file (PDF 32000-1:2008 §7.5, "File structure"): header, numbered indirect objects,
// a cross-reference table giving each one's byte offset, and the trailer. Pages carry their
// exact paper size as the MediaBox (FR-P1), their content as a Flate-compressed stream and
// their transparency as ExtGState resources. A document gets page labels (§12.4.2: PUBLISH
// labels each page with its layout's name, FR-P2) and an outline of bookmarks (§12.3.3), one
// per page that names one. Output is deterministic to the byte: no time, no random file
// identifier unless the caller passes them. No DOM here.

import { zlibSync } from 'fflate';
import { ContentStream, pdfNumber } from './content';
import { PdfFonts, type EmbeddedFont, type PlotFont } from './fonts';
import { PdfImports, type ImportedForm, type UnderlayLook } from './import';
import {
  encodeImage,
  FILL_CELL,
  FILL_STYLES,
  gradientFunction,
  type EncodedImage,
  type FillStyle,
  type GradientStop,
  type PlotPixels,
} from './fills';

export interface PdfDocumentOptions {
  /** The document information dictionary's Title, Author, Subject and Creator. */
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  readonly creator?: string;
  /** Producer; "Triya CAD 2D" when absent. */
  readonly producer?: string;
  /** CreationDate; absent writes none, so the same plot gives the same bytes. */
  readonly created?: Date;
  /** Flate-compress content streams; on when absent. Off reads better in a text editor. */
  readonly compress?: boolean;
}

export interface PdfPageOptions {
  /** The page label shown instead of its number (PUBLISH: the layout name). */
  readonly label?: string;
  /** A bookmark to the page with this title. */
  readonly bookmark?: string;
}

export class PdfPage {
  readonly content = new ContentStream();
  /** Opacities in use, by ExtGState name. */
  readonly alphas = new Map<string, number>();
  /** Fill style patterns in use (M2-16 part 2), each named `P<style>`. */
  readonly patterns = new Set<FillStyle>();
  /** Pattern colour spaces in use: `CsPg` over DeviceGray, `CsPrgb` over DeviceRGB. */
  readonly patternSpaces = new Set<'CsPg' | 'CsPrgb'>();
  /** Shading dictionaries, `Sh1`, `Sh2`, … in order. */
  readonly shadings: string[] = [];
  /** Images, `Im1`, `Im2`, …, by the bitmap they were made from, so one is written once. */
  readonly images = new Map<PlotPixels, { readonly name: string; readonly image: EncodedImage }>();
  /** TrueType fonts the page shows text in (M2-16 part 3), embedded once per document. */
  readonly fonts = new Set<EmbeddedFont>();
  /** Pages of other PDFs shown on the page (M2-16 part 5, PDF underlays). */
  readonly forms = new Set<ImportedForm>();

  constructor(
    /** Points. */
    readonly width: number,
    readonly height: number,
    readonly options: PdfPageOptions = {},
    /** The document's fonts, shared by its pages. */
    private readonly documentFonts: PdfFonts = new PdfFonts(),
    /** The document's imported pages, shared by its pages. */
    private readonly documentImports: PdfImports = new PdfImports(),
  ) {
    if (!(width > 0 && height > 0)) throw new RangeError(`page size ${width} × ${height}`);
  }

  /**
   * The embedded font showing text in `font`, named for the page's resources; undefined when
   * the font cannot be embedded (not TrueType, or its licence forbids it): plot outlines then.
   */
  font(font: PlotFont): EmbeddedFont | undefined {
    const e = this.documentFonts.embed(font);
    if (e) this.fonts.add(e);
    return e;
  }

  /**
   * Page `page` (DXF 2: its number from 1) of the PDF file `bytes` as a form XObject drawn into
   * the displayed page's points, named for the page's resources; undefined when the file cannot
   * be read (not a PDF, encrypted) or its page's content cannot be decoded.
   */
  underlay(bytes: Uint8Array, page: string, look: UnderlayLook): ImportedForm | undefined {
    const f = this.documentImports.form(bytes, page, look);
    if (f) this.forms.add(f);
    return f;
  }

  /**
   * The ExtGState drawing strokes and fills at opacity `alpha` (0–1), named for the page's
   * resources; 1 is fully opaque.
   */
  alpha(alpha: number): string {
    const a = Math.min(1, Math.max(0, alpha));
    const name = `GSa${Math.round(a * 1000)}`;
    if (!this.alphas.has(name)) this.alphas.set(name, Math.round(a * 1000) / 1000);
    return name;
  }

  /** The tiling pattern of a fill style, named for the page's resources. */
  pattern(style: FillStyle): string {
    this.patterns.add(style);
    return `P${style}`;
  }

  /** The uncoloured pattern colour space whose colours are grey or RGB. */
  patternSpace(gray: boolean): 'CsPg' | 'CsPrgb' {
    const name = gray ? 'CsPg' : 'CsPrgb';
    this.patternSpaces.add(name);
    return name;
  }

  /**
   * An axial shading along x from 0 to 1 (`linear`) or a radial one from the origin out to
   * radius 1 (`radial`), extended past both ends; the content maps that unit frame with `cm`.
   */
  shading(kind: 'linear' | 'radial', stops: readonly GradientStop[]): string {
    const { colorSpace, fn } = gradientFunction(stops);
    const dict =
      kind === 'linear'
        ? `<< /ShadingType 2 /ColorSpace ${colorSpace} /Coords [0 0 1 0] /Function ${fn} /Extend [true true] >>`
        : `<< /ShadingType 3 /ColorSpace ${colorSpace} /Coords [0 0 0 0 0 1] /Function ${fn} /Extend [true true] >>`;
    let at = this.shadings.indexOf(dict);
    if (at < 0) at = this.shadings.push(dict) - 1;
    return `Sh${at + 1}`;
  }

  /** The image XObject of a bitmap, drawn into the unit square by `Do`. */
  image(pixels: PlotPixels): string {
    let entry = this.images.get(pixels);
    if (!entry) {
      entry = { name: `Im${this.images.size + 1}`, image: encodeImage(pixels) };
      this.images.set(pixels, entry);
    }
    return entry.name;
  }
}

/**
 * A PDF string: literal for printable ASCII (backslash, parentheses escaped), else UTF-16BE
 * with its byte order mark as hex, as §7.9.2.2 has text strings.
 */
export function pdfString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex.toUpperCase()}>`;
}

/** A date as §7.9.4 writes one, in UTC. */
export function pdfDate(d: Date): string {
  const p = (v: number, w = 2) => String(v).padStart(w, '0');
  return `(D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(
    d.getUTCHours(),
  )}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
}

const latin1 = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

export class PdfDocument {
  private readonly pages: PdfPage[] = [];
  private readonly fonts = new PdfFonts();
  private readonly imports = new PdfImports();

  constructor(readonly options: PdfDocumentOptions = {}) {}

  /** A new page at the end, `width` × `height` points. */
  addPage(width: number, height: number, options: PdfPageOptions = {}): PdfPage {
    const page = new PdfPage(width, height, options, this.fonts, this.imports);
    this.pages.push(page);
    return page;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** The file. */
  bytes(): Uint8Array {
    if (this.pages.length === 0) throw new Error('a PDF needs at least one page');
    const o = this.options;
    const compress = o.compress ?? true;
    const bodies: (string | { dict: string; data: Uint8Array })[] = [];
    const add = (body: string | { dict: string; data: Uint8Array }) => {
      bodies.push(body);
      return bodies.length;
    };
    const ref = (id: number) => `${id} 0 R`;

    const catalog = add('');
    const pagesId = add('');
    const pageIds: number[] = [];
    // Each font's Type 0 dictionary, numbered when a page first names it, written at the end.
    const fontIds = new Map<EmbeddedFont, number>();
    // Each imported page's form, numbered when a page first shows it, written at the end.
    const formIds = new Map<ImportedForm, number>();
    for (const page of this.pages) {
      if (page.content.depth !== 0) throw new Error('a page ends with an unbalanced save');
      const text = page.content.toString();
      const raw = latin1(text);
      const data = compress ? zlibSync(raw, { level: 6 }) : raw;
      const contents = add({
        dict: `<< /Length ${data.length}${compress ? ' /Filter /FlateDecode' : ''} >>`,
        data,
      });
      const gs = [...page.alphas]
        .map(
          ([name, a]) => `/${name} << /Type /ExtGState /CA ${pdfNumber(a)} /ca ${pdfNumber(a)} >>`,
        )
        .join(' ');
      const stream = (dict: string, text: string) => {
        const bytes = latin1(text);
        const body = compress ? zlibSync(bytes, { level: 6 }) : bytes;
        return add({
          dict: `<< ${dict} /Length ${body.length}${compress ? ' /Filter /FlateDecode' : ''} >>`,
          data: body,
        });
      };
      const patterns = [...page.patterns].map(
        (style) =>
          `/P${style} ${ref(
            stream(
              `/Type /Pattern /PatternType 1 /PaintType 2 /TilingType 1 /BBox [0 0 ${FILL_CELL} ${FILL_CELL}] /XStep ${FILL_CELL} /YStep ${FILL_CELL} /Resources << >>`,
              `${FILL_STYLES[style]}\n`,
            ),
          )}`,
      );
      const spaces = [...page.patternSpaces].map(
        (name) => `/${name} [/Pattern ${name === 'CsPg' ? '/DeviceGray' : '/DeviceRGB'}]`,
      );
      const shadings = page.shadings.map((dict, i) => `/Sh${i + 1} ${ref(add(dict))}`);
      const xobjects = [...page.images.values()].map(({ name, image }) => {
        const head = `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height}`;
        // The colour image first, its mask after: the image's number is reserved for it.
        const id = add('');
        const mask = image.alpha
          ? add({
              dict: `<< ${head} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.alpha.length} >>`,
              data: image.alpha,
            })
          : undefined;
        bodies[id - 1] = {
          dict: `<< ${head} /ColorSpace /Device${image.gray ? 'Gray' : 'RGB'} /BitsPerComponent 8 /Filter /FlateDecode${
            mask ? ` /SMask ${ref(mask)}` : ''
          } /Length ${image.color.length} >>`,
          data: image.color,
        };
        return `/${name} ${ref(id)}`;
      });
      for (const f of page.forms) {
        let id = formIds.get(f);
        if (id === undefined) formIds.set(f, (id = add('')));
        xobjects.push(`/${f.name} ${ref(id)}`);
      }
      const fonts = [...page.fonts].map((f) => {
        let id = fontIds.get(f);
        if (id === undefined) fontIds.set(f, (id = add('')));
        return `/${f.name} ${ref(id)}`;
      });
      const entries = [
        gs ? `/ExtGState << ${gs} >>` : '',
        fonts.length > 0 ? `/Font << ${fonts.join(' ')} >>` : '',
        spaces.length > 0 ? `/ColorSpace << ${spaces.join(' ')} >>` : '',
        patterns.length > 0 ? `/Pattern << ${patterns.join(' ')} >>` : '',
        shadings.length > 0 ? `/Shading << ${shadings.join(' ')} >>` : '',
        xobjects.length > 0 ? `/XObject << ${xobjects.join(' ')} >>` : '',
      ].filter(Boolean);
      const resources = entries.length > 0 ? `<< ${entries.join(' ')} >>` : '<< >>';
      pageIds.push(
        add(
          `<< /Type /Page /Parent ${ref(pagesId)} /MediaBox [0 0 ${pdfNumber(page.width)} ${pdfNumber(
            page.height,
          )}] /Resources ${resources} /Contents ${ref(contents)} >>`,
        ),
      );
    }
    for (const [font, id] of fontIds) {
      font.write(
        id,
        (at, body) => (bodies[at - 1] = body),
        add,
        (dict, data) => {
          const body = compress ? zlibSync(data, { level: 6 }) : data;
          return add({
            dict: `<< ${dict ? `${dict} ` : ''}/Length ${body.length}${compress ? ' /Filter /FlateDecode' : ''} >>`,
            data: body,
          });
        },
      );
    }
    for (const [form, id] of formIds)
      form.write(id, { reserve: () => add(''), set: (at, body) => (bodies[at - 1] = body) });
    bodies[pagesId - 1] =
      `<< /Type /Pages /Kids [${pageIds.map(ref).join(' ')}] /Count ${pageIds.length} >>`;

    // Bookmarks: a flat outline, one item per page that asks for one, in page order.
    const marked = this.pages
      .map((p, i) => ({ title: p.options.bookmark, page: pageIds[i]! }))
      .filter((m): m is { title: string; page: number } => m.title !== undefined);
    let outlines: number | undefined;
    if (marked.length > 0) {
      outlines = add('');
      const items = marked.map(() => add(''));
      marked.forEach((m, i) => {
        const links = [
          i > 0 ? `/Prev ${ref(items[i - 1]!)}` : '',
          i < items.length - 1 ? `/Next ${ref(items[i + 1]!)}` : '',
        ]
          .filter(Boolean)
          .join(' ');
        bodies[items[i]! - 1] =
          `<< /Title ${pdfString(m.title)} /Parent ${ref(outlines!)}${links ? ` ${links}` : ''} /Dest [${ref(
            m.page,
          )} /Fit] >>`;
      });
      bodies[outlines - 1] =
        `<< /Type /Outlines /First ${ref(items[0]!)} /Last ${ref(items[items.length - 1]!)} /Count ${items.length} >>`;
    }

    // Page labels: a labelled page shows its label alone; a page without one shows its number.
    let labels = '';
    if (this.pages.some((p) => p.options.label !== undefined)) {
      const nums = this.pages.map((p, i) =>
        p.options.label !== undefined
          ? `${i} << /P ${pdfString(p.options.label)} >>`
          : `${i} << /S /D /St ${i + 1} >>`,
      );
      labels = ` /PageLabels << /Nums [${nums.join(' ')}] >>`;
    }
    bodies[catalog - 1] = `<< /Type /Catalog /Pages ${ref(pagesId)}${labels}${
      outlines ? ` /Outlines ${ref(outlines)} /PageMode /UseOutlines` : ''
    } >>`;

    const info = [
      ['Title', o.title],
      ['Author', o.author],
      ['Subject', o.subject],
      ['Creator', o.creator],
      ['Producer', o.producer ?? 'Triya CAD 2D'],
    ]
      .filter((e): e is [string, string] => e[1] !== undefined)
      .map(([k, v]) => `/${k} ${pdfString(v)}`);
    if (o.created) info.push(`/CreationDate ${pdfDate(o.created)}`);
    const infoId = add(`<< ${info.join(' ')} >>`);

    // Header with a comment of four bytes over 127, so transfer tools treat the file as binary.
    const chunks: Uint8Array[] = [latin1('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')];
    let offset = chunks[0]!.length;
    const offsets: number[] = [];
    const push = (c: Uint8Array) => {
      chunks.push(c);
      offset += c.length;
    };
    bodies.forEach((body, i) => {
      offsets.push(offset);
      if (typeof body === 'string') push(latin1(`${i + 1} 0 obj\n${body}\nendobj\n`));
      else {
        push(latin1(`${i + 1} 0 obj\n${body.dict}\nstream\n`));
        push(body.data);
        push(latin1('\nendstream\nendobj\n'));
      }
    });
    const xref = offset;
    let table = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) table += `${String(off).padStart(10, '0')} 00000 n \n`;
    table += `trailer\n<< /Size ${bodies.length + 1} /Root ${ref(catalog)} /Info ${ref(
      infoId,
    )} >>\nstartxref\n${xref}\n%%EOF\n`;
    push(latin1(table));

    const out = new Uint8Array(offset);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}
