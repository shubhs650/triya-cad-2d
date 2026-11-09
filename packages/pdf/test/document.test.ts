import { unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { PdfDocument, pdfDate, pdfString } from '../src/document';

const text = (b: Uint8Array) => {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return s;
};

/** Each object's body by number, checking the cross-reference table points at it. */
function objects(bytes: Uint8Array): Map<number, string> {
  const t = text(bytes);
  const xref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(t)![1]);
  expect(t.slice(xref, xref + 5)).toBe('xref\n');
  const rows = [...t.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  const size = Number(/\/Size (\d+)/.exec(t.slice(xref))![1]);
  expect(rows).toHaveLength(size - 1);
  const out = new Map<number, string>();
  rows.forEach((off, i) => {
    const head = `${i + 1} 0 obj\n`;
    expect(t.slice(off, off + head.length)).toBe(head);
    out.set(i + 1, t.slice(off + head.length, t.indexOf('\nendobj\n', off)));
  });
  return out;
}

/** The decompressed content stream of an object. */
function stream(bytes: Uint8Array, body: string): string {
  const length = Number(/\/Length (\d+)/.exec(body)![1]);
  const start = body.indexOf('stream\n') + 7;
  const raw = Uint8Array.from(body.slice(start, start + length), (c) => c.charCodeAt(0));
  return body.includes('/FlateDecode') ? text(unzlibSync(raw)) : text(raw);
}

describe('PdfDocument', () => {
  it('writes a PDF 1.7 file whose cross-reference table points at every object', () => {
    const doc = new PdfDocument();
    const page = doc.addPage(842, 595);
    page.content.moveTo(0, 0).lineTo(842, 595).stroke();
    const bytes = doc.bytes();
    expect(text(bytes.slice(0, 9))).toBe('%PDF-1.7\n');
    expect([...bytes.slice(10, 14)].every((b) => b > 127)).toBe(true);
    const objs = objects(bytes);
    const pageBody = [...objs.values()].find((b) => b.includes('/Type /Page '))!;
    expect(pageBody).toContain('/MediaBox [0 0 842 595]');
    const contents = Number(/\/Contents (\d+) 0 R/.exec(pageBody)![1]);
    expect(stream(bytes, objs.get(contents)!)).toBe('0 0 m\n842 595 l\nS\n');
    expect([...objs.values()].some((b) => b.includes('/Producer (Triya CAD 2D)'))).toBe(true);
  });

  it('writes the same bytes for the same plot, compressed or not', () => {
    const make = (compress: boolean) => {
      const doc = new PdfDocument({ compress, title: 'Sheet' });
      doc.addPage(100, 100).content.rect(0, 0, 10, 10).fill();
      return doc.bytes();
    };
    expect(make(true)).toEqual(make(true));
    const plain = make(false);
    const objs = objects(plain);
    const c = [...objs.values()].find((b) => b.includes('stream\n'))!;
    expect(c).not.toContain('/Filter');
    expect(stream(plain, c)).toBe('0 0 10 10 re\nf\n');
  });

  it('names opacities as ExtGState resources of their page', () => {
    const doc = new PdfDocument();
    const page = doc.addPage(100, 100);
    expect(page.alpha(0.5)).toBe('GSa500');
    expect(page.alpha(2)).toBe('GSa1000');
    const pageBody = [...objects(doc.bytes()).values()].find((b) => b.includes('/Type /Page '))!;
    expect(pageBody).toContain('/ExtGState << /GSa500 << /Type /ExtGState /CA 0.5 /ca 0.5 >>');
  });

  it('labels pages and bookmarks them, as PUBLISH does with layout names', () => {
    const doc = new PdfDocument();
    doc.addPage(100, 100, { label: 'Layout1', bookmark: 'Layout1' });
    doc.addPage(100, 100);
    doc.addPage(100, 100, { label: 'Détail', bookmark: 'Détail (A)' });
    const objs = objects(doc.bytes());
    const catalog = [...objs.values()].find((b) => b.includes('/Type /Catalog'))!;
    expect(catalog).toContain(
      `/PageLabels << /Nums [0 << /P (Layout1) >> 1 << /S /D /St 2 >> 2 << /P ${pdfString('Détail')} >>] >>`,
    );
    expect(catalog).toContain('/PageMode /UseOutlines');
    const outlines = Number(/\/Outlines (\d+) 0 R/.exec(catalog)![1]);
    expect(objs.get(outlines)).toMatch(
      /\/Type \/Outlines \/First \d+ 0 R \/Last \d+ 0 R \/Count 2/,
    );
    const items = [...objs.values()].filter((b) => b.includes('/Title') && b.includes('/Dest'));
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('/Title (Layout1)');
    expect(items[0]).toMatch(/\/Next \d+ 0 R/);
    expect(items[1]).toContain(`/Title ${pdfString('Détail (A)')}`);
    expect(items[1]).toMatch(/\/Prev \d+ 0 R/);
  });

  it('writes no labels or outline when no page asks for them', () => {
    const doc = new PdfDocument();
    doc.addPage(10, 10);
    const catalog = [...objects(doc.bytes()).values()].find((b) => b.includes('/Type /Catalog'))!;
    expect(catalog).toBe('<< /Type /Catalog /Pages 2 0 R >>');
  });

  it('writes the information dictionary, with a creation date only when given one', () => {
    const doc = new PdfDocument({
      title: 'A (1)',
      author: 'me',
      subject: 's',
      creator: 'Triya PLOT',
      producer: 'p',
      created: new Date(Date.UTC(2026, 10, 9, 8, 5, 3)),
    });
    doc.addPage(10, 10);
    const info = [...objects(doc.bytes()).values()].find((b) => b.includes('/Producer'))!;
    expect(info).toBe(
      '<< /Title (A \\(1\\)) /Author (me) /Subject (s) /Creator (Triya PLOT) /Producer (p) /CreationDate (D:20261109080503Z) >>',
    );
  });

  it('refuses an empty document, a bad page size and an unbalanced save', () => {
    expect(() => new PdfDocument().bytes()).toThrow('at least one page');
    expect(() => new PdfDocument().addPage(0, 10)).toThrow(RangeError);
    const doc = new PdfDocument();
    doc.addPage(10, 10).content.save();
    expect(() => doc.bytes()).toThrow('unbalanced');
    expect(doc.pageCount).toBe(1);
  });
});

describe('PDF strings and dates', () => {
  it('escapes literal strings and writes others as UTF-16BE', () => {
    expect(pdfString('a\\b(c)')).toBe('(a\\\\b\\(c\\))');
    expect(pdfString('é')).toBe('<FEFF00E9>');
    expect(pdfDate(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe('(D:20260102030405Z)');
  });
});
