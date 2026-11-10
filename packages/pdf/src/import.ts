// A page of another PDF placed in a plot (M2-16 part 5, PDF underlays): the page's own content
// stream and resources copied into the plot as a Form XObject (PDF 32000-1:2008 §8.10), so its
// paths, text and images plot as the PDF draws them, not as a raster. Every object the page
// uses is copied once per plot document and file (fonts shared by two pages of one file are
// written once); links back into the source's page tree are cut.
//
// The form shows the page as displayed: its crop box (within its media box, as pdf.js shows it)
// turned by its /Rotate, in points from the displayed page's lower-left corner, which is the
// underlay's own space (inches) at 72 points each (render's `underlayFrame`).
//
// The underlay's display settings plot as the screen shows them on white paper (render's
// `adjustUnderlayPixels`): monochrome takes each colour's luminance; contrast k (0–100 %) maps
// each channel c to 128 + (c − 128)·k, which is the page painted at opacity k over mid grey,
// masked to where the page paints; fade is opacity at the underlay's `Do`. The page form and the
// adjusted form are isolated transparency groups, so fade fades the page as a whole, as the
// screen fades its raster, and the monochrome blend (/Saturation with a grey: the luminance of
// what is beneath, §11.3.5.3) reaches only the page. "Adjust colours for background" never
// applies on white paper. No DOM here.

import { zlibSync } from 'fflate';
import type { Affine } from './path';
import type { PdfRef } from './reader';
import {
  PdfName,
  PdfReadError,
  PdfSource,
  PdfStream,
  pdfReal,
  writeValue,
  type PdfDict,
  type PdfPageEntry,
  type PdfValue,
} from './reader';

/** An object body as the document writes it. */
export type ObjectBody = string | { readonly dict: string; readonly data: Uint8Array };

/** How an imported form writes its objects into the plot document. */
export interface ObjectWriter {
  /** A new object number, its body set later. */
  reserve(): number;
  set(id: number, body: ObjectBody): void;
}

/** A page as displayed, in its own user space. */
export interface PageView {
  /** The displayed box, user space (crop box within media box). */
  readonly box: readonly [number, number, number, number];
  /** Displayed width and height, points (rotation applied). */
  readonly width: number;
  readonly height: number;
  /** User space → points from the displayed page's lower-left corner. */
  readonly matrix: Affine;
}

const LETTER: readonly [number, number, number, number] = [0, 0, 612, 792];

function rectOf(v: PdfValue): [number, number, number, number] | undefined {
  if (!Array.isArray(v) || v.length < 4 || !v.slice(0, 4).every((x) => typeof x === 'number'))
    return undefined;
  const [a, b, c, d] = v as number[];
  const r: [number, number, number, number] = [
    Math.min(a!, c!),
    Math.min(b!, d!),
    Math.max(a!, c!),
    Math.max(b!, d!),
  ];
  return r[2] > r[0] && r[3] > r[1] ? r : undefined;
}

/**
 * The displayed page as pdf.js shows it: the crop box clipped to the media box (the media box
 * when they do not overlap; US Letter when it has none) and /Rotate, a multiple of 90 turning
 * the page clockwise (anything else is 0).
 */
export function pageView(page: Pick<PdfPageEntry, 'mediaBox' | 'cropBox' | 'rotate'>): PageView {
  const media = rectOf(page.mediaBox) ?? LETTER;
  const crop = rectOf(page.cropBox);
  let box = media;
  if (crop) {
    const x0 = Math.max(crop[0], media[0]);
    const y0 = Math.max(crop[1], media[1]);
    const x1 = Math.min(crop[2], media[2]);
    const y1 = Math.min(crop[3], media[3]);
    if (x1 > x0 && y1 > y0) box = [x0, y0, x1, y1];
  }
  let rotate = typeof page.rotate === 'number' && page.rotate % 90 === 0 ? page.rotate : 0;
  rotate = ((rotate % 360) + 360) % 360;
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0;
  const h = y1 - y0;
  // Where each corner goes once the page turns clockwise, origin at the lower-left.
  const matrix: Affine =
    rotate === 90
      ? { a: 0, b: -1, c: 1, d: 0, e: -y0, f: x1 }
      : rotate === 180
        ? { a: -1, b: 0, c: 0, d: -1, e: x1, f: y1 }
        : rotate === 270
          ? { a: 0, b: 1, c: -1, d: 0, e: y1, f: -x0 }
          : { a: 1, b: 0, c: 0, d: 1, e: -x0, f: -y0 };
  const turned = rotate === 90 || rotate === 270;
  return { box, width: turned ? h : w, height: turned ? w : h, matrix };
}

/** DXF 2 is the page number from 1; anything else (a page label) shows the first page. */
export function underlayPageIndex(page: string, count: number): number {
  const n = Number.parseInt(page, 10);
  return Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : 0;
}

/** A page of a file, adjusted, ready to paint with `Do` into the displayed page's points. */
export interface ImportedForm {
  /** Its name in a page's /XObject resources. */
  readonly name: string;
  readonly view: PageView;
  write(id: number, w: ObjectWriter): void;
}

/** The underlay settings a form carries; fade is the opacity it is painted with. */
export interface UnderlayLook {
  /** 0–100. */
  readonly contrast: number;
  readonly monochrome: boolean;
}

const real = pdfReal;

const latin1 = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

/** One source file's objects as copied into the document. */
class SourceCopy {
  readonly ids = new Map<number, number>();
  readonly pageIds = new Map<number, number>();
  readonly #queue: [PdfRef, number][] = [];

  constructor(readonly source: PdfSource) {}

  /** A reference to the copy of `r`; null for what is not copied (missing, page tree). */
  ref(r: PdfRef, w: ObjectWriter): string {
    const target = this.source.get(r);
    if (target === null) return 'null';
    if (target instanceof Map) {
      const type = target.get('Type');
      if (type instanceof PdfName && ['Page', 'Pages', 'Catalog'].includes(type.name))
        return 'null';
    }
    let id = this.ids.get(r.num);
    if (id === undefined) {
      id = w.reserve();
      this.ids.set(r.num, id);
      this.#queue.push([r, id]);
    }
    return `${id} 0 R`;
  }

  value(v: PdfValue, w: ObjectWriter): string {
    return writeValue(v, (r) => this.ref(r, w));
  }

  streamBody(dict: PdfDict, data: Uint8Array, w: ObjectWriter): ObjectBody {
    const d = new Map(dict);
    d.delete('Length');
    d.set('Length', data.length);
    return { dict: this.value(d, w), data };
  }

  /** Writes every object referenced so far, and what those reference. */
  drain(w: ObjectWriter): void {
    for (let next = this.#queue.shift(); next; next = this.#queue.shift()) {
      const [r, id] = next;
      const v = this.source.get(r);
      w.set(id, v instanceof PdfStream ? this.streamBody(v.dict, v.data, w) : this.value(v, w));
    }
  }
}

/** The page's content as one stream: its own bytes and filters when it has one stream. */
function pageContent(
  source: PdfSource,
  page: PdfPageEntry,
): { readonly data: Uint8Array; readonly filter: PdfDict } {
  const contents = source.resolve(page.dict.get('Contents'));
  if (contents instanceof PdfStream) {
    const filter: PdfDict = new Map();
    for (const k of ['Filter', 'DecodeParms'])
      if (contents.dict.has(k)) filter.set(k, contents.dict.get(k)!);
    return { data: contents.data, filter };
  }
  const parts: Uint8Array[] = [];
  if (Array.isArray(contents))
    for (const c of contents) {
      const s = source.resolve(c);
      if (s instanceof PdfStream) parts.push(source.decode(s), latin1('\n'));
    }
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    joined.set(p, at);
    at += p.length;
  }
  return {
    data: zlibSync(joined, { level: 6 }),
    filter: new Map([['Filter', new PdfName('FlateDecode')]]),
  };
}

/** The document's imported pages, shared by its plot pages. */
export class PdfImports {
  readonly #sources = new WeakMap<Uint8Array, PdfSource | null>();
  readonly #copies = new Map<PdfSource, SourceCopy>();
  readonly #forms = new Map<string, ImportedForm>();
  readonly #keys = new WeakMap<PdfSource, number>();

  /**
   * The form showing `page` (DXF 2) of the PDF file `bytes` with `look`; undefined when the
   * file cannot be read (not a PDF, encrypted, no pages) or its content cannot be decoded.
   */
  form(bytes: Uint8Array, page: string, look: UnderlayLook): ImportedForm | undefined {
    let source = this.#sources.get(bytes);
    if (source === undefined) {
      try {
        source = PdfSource.open(bytes);
        if (source.pages.length === 0) source = null;
      } catch (e) {
        if (!(e instanceof PdfReadError)) throw e;
        source = null;
      }
      this.#sources.set(bytes, source);
    }
    if (!source) return undefined;
    let n = this.#keys.get(source);
    if (n === undefined) this.#keys.set(source, (n = this.#copies.size + 1));
    let copy = this.#copies.get(source);
    if (!copy) this.#copies.set(source, (copy = new SourceCopy(source)));
    const index = underlayPageIndex(page, source.pages.length);
    const contrast = Math.min(100, Math.max(0, look.contrast));
    const adjusted = contrast < 100 || look.monochrome;
    const key = `${n}|${index}|${adjusted ? `${contrast}|${look.monochrome}` : ''}`;
    let form = this.#forms.get(key);
    if (form) return form;
    const entry = source.pages[index]!;
    let content: ReturnType<typeof pageContent>;
    try {
      content = pageContent(source, entry);
    } catch (e) {
      if (!(e instanceof PdfReadError)) throw e;
      return undefined;
    }
    const view = pageView(entry);
    const name = `Fm${this.#forms.size + 1}`;
    const c = copy;
    const writePage = (id: number, w: ObjectWriter) => {
      c.pageIds.set(index, id);
      const dict: PdfDict = new Map<string, PdfValue>([
        ['Type', new PdfName('XObject')],
        ['Subtype', new PdfName('Form')],
        ['FormType', 1],
        ['BBox', [...view.box]],
        [
          'Matrix',
          [
            view.matrix.a,
            view.matrix.b,
            view.matrix.c,
            view.matrix.d,
            view.matrix.e,
            view.matrix.f,
          ],
        ],
        ['Resources', entry.resources ?? new Map()],
      ]);
      const group: PdfDict = new Map<string, PdfValue>([
        ['S', new PdfName('Transparency')],
        ['I', true],
      ]);
      const pageGroup = source.resolve(entry.dict.get('Group'));
      if (pageGroup instanceof Map && pageGroup.has('CS')) group.set('CS', pageGroup.get('CS')!);
      dict.set('Group', group);
      for (const [k, v] of content.filter) dict.set(k, v);
      w.set(id, c.streamBody(dict, content.data, w));
      c.drain(w);
    };
    const pageId = (w: ObjectWriter) => {
      let id = c.pageIds.get(index);
      if (id === undefined) {
        id = w.reserve();
        writePage(id, w);
      }
      return id;
    };
    form = {
      name,
      view,
      write: adjusted
        ? (id, w) => {
            const p = pageId(w);
            const { width: W, height: H } = view;
            const k = real(contrast / 100);
            const rect = `0 0 ${real(W)} ${real(H)} re f`;
            const ops = ['/M gs'];
            if (contrast < 100) ops.push(`${real(128 / 255)} g ${rect}`, '/K gs');
            ops.push('/P Do');
            if (look.monochrome) ops.push(`/S gs 0.5 g ${rect}`);
            const data = zlibSync(latin1(`${ops.join('\n')}\n`), { level: 6 });
            w.set(id, {
              dict: `<< /Type /XObject /Subtype /Form /FormType 1 /BBox [0 0 ${real(W)} ${real(H)}] /Group << /S /Transparency /I true >> /Resources << /XObject << /P ${p} 0 R >> /ExtGState << /M << /SMask << /S /Alpha /G ${p} 0 R >> >> /K << /ca ${k} /CA ${k} >> /S << /BM /Saturation /ca 1 /CA 1 >> >> >> /Filter /FlateDecode /Length ${data.length} >>`,
              data,
            });
          }
        : (id, w) => {
            // Painted straight: the page form itself, in the displayed page's points.
            writePage(id, w);
          },
    };
    this.#forms.set(key, form);
    return form;
  }
}
