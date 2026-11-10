import { describe, expect, it } from 'vitest';
import { PdfDocument } from '../src/document';
import { pageView, underlayPageIndex } from '../src/import';
import type { Affine } from '../src/path';
import { plotItems, type PlotPaint, type PlotPathItem, type PlotUnderlay } from '../src/plot';
import type { PdfStream } from '../src/reader';
import { PdfName, PdfSource, type PdfDict } from '../src/reader';
import { TWO_PAGES, buildPdf, textOf } from './build';

const at = (m: Affine, x: number, y: number) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];

describe('pageView', () => {
  const box = { mediaBox: [0, 0, 200, 100], cropBox: [10, 20, 190, 90] };
  it('shows the crop box, its lower-left corner at the origin, unturned', () => {
    const v = pageView({ ...box, rotate: null });
    expect(v).toMatchObject({ box: [10, 20, 190, 90], width: 180, height: 70 });
    expect(at(v.matrix, 10, 20)).toEqual([0, 0]);
    expect(at(v.matrix, 190, 90)).toEqual([180, 70]);
  });

  it('turns the page clockwise by /Rotate', () => {
    // The unturned lower-left corner ends top-left (90), top-right (180), bottom-right (270).
    const v90 = pageView({ ...box, rotate: 90 });
    expect([v90.width, v90.height]).toEqual([70, 180]);
    expect(at(v90.matrix, 10, 20)).toEqual([0, 180]);
    const v180 = pageView({ ...box, rotate: 180 });
    expect(at(v180.matrix, 10, 20)).toEqual([180, 70]);
    const v270 = pageView({ ...box, rotate: -90 });
    expect(at(v270.matrix, 10, 20)).toEqual([70, 0]);
    expect(pageView({ ...box, rotate: 45 }).width).toBe(180);
  });

  it('keeps the crop box within the media box, and US Letter for a page with none', () => {
    expect(
      pageView({ mediaBox: [0, 0, 200, 100], cropBox: [-10, 50, 300, 400], rotate: null }).box,
    ).toEqual([0, 50, 200, 100]);
    expect(
      pageView({ mediaBox: [0, 0, 200, 100], cropBox: [300, 300, 400, 400], rotate: null }).box,
    ).toEqual([0, 0, 200, 100]);
    expect(pageView({ mediaBox: null, cropBox: null, rotate: null }).box).toEqual([0, 0, 612, 792]);
  });

  it('takes DXF 2 as a page number from 1, anything else the first page', () => {
    expect(underlayPageIndex('2', 3)).toBe(1);
    expect(underlayPageIndex('4', 3)).toBe(0);
    expect(underlayPageIndex('Cover', 3)).toBe(0);
  });
});

const PAINT: PlotPaint = {
  color: [0, 0, 0],
  lineweight: 0.25,
  linetype: { kind: 'object' },
  endStyle: 'round',
  joinStyle: 'round',
};

/** Underlay inches → world millimetres, at 1:1, moved by (10, 20) mm. */
const MM: Affine = { a: 25.4, b: 0, c: 0, d: 25.4, e: 10, f: 20 };

const underlay = (o: Partial<PlotUnderlay> = {}): PlotUnderlay => ({
  definition: 'D1',
  fileName: '..\\plans\\two.pdf',
  page: '1',
  frame: MM,
  clipped: false,
  contrast: 100,
  fade: 0,
  monochrome: false,
  ...o,
});

const item = (u: PlotUnderlay, path: number[] = []): PlotPathItem => ({
  kind: 'fill',
  path,
  paint: PAINT,
  underlay: u,
});

/** A plot of `items` on an A4 page, mm → points, read back. */
function plot(items: PlotPathItem[], file: Uint8Array | undefined = buildPdf(TWO_PAGES)) {
  const doc = new PdfDocument();
  const page = doc.addPage(595, 842);
  plotItems(page, items, {
    toPaper: { a: 72 / 25.4, b: 0, c: 0, d: 72 / 25.4, e: 0, f: 0 },
    underlays: (u) => (u.fileName.endsWith('two.pdf') ? file : undefined),
  });
  const bytes = doc.bytes();
  const src = PdfSource.open(bytes);
  const p = src.pages[0]!;
  const content = textOf(src.decode(src.resolve(p.dict.get('Contents')) as PdfStream));
  const xobjects = (src.resolve((p.resources as PdfDict).get('XObject')) ?? new Map()) as PdfDict;
  const form = (name: string) => src.resolve(xobjects.get(name)) as PdfStream;
  return { bytes, src, content, xobjects, form };
}

describe('plotting a PDF underlay', () => {
  it("copies the page's content and resources into a form XObject drawn at the underlay's place", () => {
    const { content, form, src, bytes } = plot([item(underlay())]);
    // Displayed points → inches → mm → points: scale 1, moved by (10, 20) mm.
    expect(content).toContain('1 0 0 1 28.3464566929 56.6929133858 cm\n/Fm1 Do');
    const f = form('Fm1');
    expect(f.dict.get('Subtype')).toEqual(new PdfName('Form'));
    expect(f.dict.get('BBox')).toEqual([0, 0, 200, 100]);
    expect(f.dict.get('Matrix')).toEqual([1, 0, 0, 1, 0, 0]);
    const group = f.dict.get('Group') as PdfDict;
    expect(group.get('S')).toEqual(new PdfName('Transparency'));
    expect(group.get('I')).toBe(true);
    expect(textOf(src.decode(f))).toBe(
      '1 0 0 rg 10 10 50 50 re f\nBT /F1 12 Tf 70 20 Td (Hi) Tj ET',
    );
    const font = src.resolve(
      ((f.dict.get('Resources') as PdfDict).get('Font') as PdfDict).get('F1'),
    ) as PdfDict;
    expect(font.get('BaseFont')).toEqual(new PdfName('Helvetica'));
    // Only the plot's own page: the source's page tree is not copied.
    expect(src.pages).toHaveLength(1);
    expect(textOf(bytes).match(/\/Type \/Page\b/g)).toHaveLength(1);
  });

  it('joins a page of several content streams, turned by its /Rotate, and shares fonts between pages', () => {
    const { content, form, src, bytes } = plot([
      item(underlay({ page: '2' })),
      item(underlay()),
      item(underlay({ page: '1', frame: { ...MM, e: 100 } })),
    ]);
    expect(content.match(/\/Fm1 Do/g)).toHaveLength(1);
    expect(content.match(/\/Fm2 Do/g)).toHaveLength(2);
    const f = form('Fm1');
    expect(textOf(src.decode(f))).toBe('0 0 1 rg\n20 20 100 40 re f\n');
    expect(f.dict.get('BBox')).toEqual([10, 10, 190, 90]);
    expect(f.dict.get('Matrix')).toEqual([0, -1, 1, 0, -10, 190]);
    expect(textOf(bytes).match(/\/BaseFont/g)).toHaveLength(1);
  });

  it('clips to the boundary and fades, contrasts and greys the page as the screen does', () => {
    const ring = [0, 10, 20, 1, 60, 20, 1, 60, 60, 4];
    const { content, form, src } = plot([
      item(underlay({ clipped: true, fade: 25, contrast: 50, monochrome: true }), ring),
    ]);
    expect(content).toMatch(/28\.3465 56\.6929 m\n(.*\n)+h\nW n\n\/GSa750 gs\n.* cm\n\/Fm1 Do\nQ/);
    // The form shown masks the adjusted page to where the page paints.
    const masked = form('Fm1');
    expect(masked.dict.get('BBox')).toEqual([0, 0, 200, 100]);
    expect(textOf(src.decode(masked))).toBe('/M gs\n/A Do\n');
    const res = masked.dict.get('Resources') as PdfDict;
    const mask = ((res.get('ExtGState') as PdfDict).get('M') as PdfDict).get('SMask') as PdfDict;
    expect(mask.get('S')).toEqual(new PdfName('Alpha'));
    // The adjusted page: mid grey, the page at opacity 0.5 over it, then its luminance.
    const adjusted = src.resolve((res.get('XObject') as PdfDict).get('A')) as PdfStream;
    expect((adjusted.dict.get('Group') as PdfDict).get('I')).toBe(true);
    expect(textOf(src.decode(adjusted))).toBe(
      '0.5019607843 g 0 0 200 100 re f\n/K gs\n/P Do\n/S gs 0.5 g 0 0 200 100 re f\n',
    );
    const ares = adjusted.dict.get('Resources') as PdfDict;
    const page = src.resolve((ares.get('XObject') as PdfDict).get('P')) as PdfStream;
    expect(page.dict.get('Subtype')).toEqual(new PdfName('Form'));
    expect(src.resolve(mask.get('G'))).toBe(page);
    const gs = ares.get('ExtGState') as PdfDict;
    expect((gs.get('K') as PdfDict).get('ca')).toBe(0.5);
    expect((gs.get('S') as PdfDict).get('BM')).toEqual(new PdfName('Saturation'));
  });

  it('plots the boundary of a clipped underlay whose file it does not have or cannot read', () => {
    const ring = [0, 10, 20, 1, 60, 20, 1, 60, 60, 4];
    const missing = plot([
      item(underlay({ clipped: true, fileName: 'gone.pdf' }), ring),
      item(underlay({ fileName: 'gone.pdf' })),
    ]);
    expect(missing.content).toMatch(/h\nS\n/);
    expect(missing.content).not.toContain('Do');
    expect(missing.xobjects.size).toBe(0);
    const encrypted = buildPdf(
      { ...TWO_PAGES, 9: '<< /Filter /Standard >>' },
      { trailer: '/Encrypt 9 0 R' },
    );
    const refused = plot([item(underlay())], encrypted);
    expect(refused.content).not.toContain('Do');
    expect(refused.xobjects.size).toBe(0);
  });
});
