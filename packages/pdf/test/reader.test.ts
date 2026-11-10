import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  PdfName,
  PdfReadError,
  PdfRef,
  PdfSource,
  PdfStream,
  PdfString,
  pdfReal,
  writeValue,
  type PdfDict,
} from '../src/reader';
import { TWO_PAGES, appendUpdate, buildPdf, bytesOf, textOf } from './build';

const dict = (v: unknown): PdfDict => {
  expect(v).toBeInstanceOf(Map);
  return v as PdfDict;
};

const decodedText = (src: PdfSource, v: unknown) => {
  expect(v).toBeInstanceOf(PdfStream);
  return textOf(src.decode(v as PdfStream));
};

describe('PdfSource', () => {
  it('reads a cross-reference table, its objects and the page tree with inherited attributes', () => {
    const src = PdfSource.open(buildPdf(TWO_PAGES));
    expect(src.pages).toHaveLength(2);
    const [one, two] = src.pages;
    expect(one!.mediaBox).toEqual([0, 0, 200, 100]);
    expect(dict(dict(one!.resources).get('Font')).get('F1')).toEqual(new PdfRef(5, 0));
    expect(one!.rotate).toBeNull();
    expect(two!.rotate).toBe(90);
    expect(two!.cropBox).toEqual([10, 10, 190, 90]);
    const font = dict(src.get(new PdfRef(5, 0)));
    expect((font.get('BaseFont') as PdfName).name).toBe('Helvetica');
    expect(decodedText(src, src.resolve(one!.dict.get('Contents')))).toContain('(Hi) Tj');
    // An object the table marks free, or one past its end, is null.
    expect(src.get(new PdfRef(42, 0))).toBeNull();
  });

  it('reads a cross-reference stream with a PNG predictor and objects packed in an object stream', () => {
    const bytes = buildPdf(TWO_PAGES, { xref: 'stream', packed: [1, 2, 3, 4, 5] });
    expect(textOf(bytes)).not.toContain('/Type /Catalog');
    const src = PdfSource.open(bytes);
    expect(src.pages).toHaveLength(2);
    expect(dict(src.get(new PdfRef(5, 0))).get('BaseFont')).toEqual(new PdfName('Helvetica'));
    const contents = src.pages[1]!.dict.get('Contents') as PdfRef[];
    expect(contents.map((r) => decodedText(src, src.get(r)))).toEqual([
      '0 0 1 rg',
      '20 20 100 40 re f',
    ]);
  });

  it('takes the newest object of an incremental update and keeps an object it frees free', () => {
    const base = buildPdf(TWO_PAGES);
    const updated = appendUpdate(base, {
      5: '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
      9: '<< /Kept true >>',
    });
    const freed = appendUpdate(updated, { 9: null });
    const src = PdfSource.open(updated);
    expect(dict(src.get(new PdfRef(5, 0))).get('BaseFont')).toEqual(new PdfName('Courier'));
    expect(dict(src.get(new PdfRef(9, 0))).get('Kept')).toBe(true);
    expect(PdfSource.open(freed).get(new PdfRef(9, 0))).toBeNull();
  });

  it('reads a hybrid file: the table marks free what its /XRefStm lists', () => {
    // A stream-only section saved after the table, then a table naming it.
    const base = buildPdf({ ...TWO_PAGES, 9: '<< /Hidden 1 >>' }, { xref: 'stream', packed: [9] });
    const text = textOf(base);
    const stm = Number(/startxref\n(\d+)/.exec(text)![1]);
    const tableAt = base.length;
    const offsets = [...text.matchAll(/(\d+) 0 obj\n/g)].map((m) => [Number(m[1]), m.index!]);
    let table = 'xref\n0 10\n0000000000 65535 f \n';
    for (let n = 1; n < 10; n++) {
      const off = offsets.find(([k]) => k === n)?.[1];
      table +=
        off === undefined ? '0000000000 00001 f \n' : `${String(off).padStart(10, '0')} 00000 n \n`;
    }
    const hybrid = new Uint8Array([
      ...base,
      ...bytesOf(
        `${table}trailer\n<< /Size 10 /Root 1 0 R /XRefStm ${stm} >>\nstartxref\n${tableAt}\n%%EOF\n`,
      ),
    ]);
    const src = PdfSource.open(hybrid);
    expect(dict(src.get(new PdfRef(9, 0))).get('Hidden')).toBe(1);
  });

  it('scans a file whose cross-reference offsets are wrong for its objects', () => {
    const src = PdfSource.open(buildPdf(TWO_PAGES, { skew: 7 }));
    expect(src.pages).toHaveLength(2);
    expect(dict(src.get(new PdfRef(5, 0))).get('BaseFont')).toEqual(new PdfName('Helvetica'));
    // No startxref at all.
    const cut = textOf(buildPdf(TWO_PAGES)).replace(/startxref[\s\S]*$/, '');
    expect(PdfSource.open(bytesOf(cut)).pages).toHaveLength(2);
  });

  it('reads a stream whose /Length is wrong or indirect', () => {
    const src = PdfSource.open(
      buildPdf({
        1: '<< /Type /Catalog /Pages 2 0 R >>',
        2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        3: '<< /Type /Page /Parent 2 0 R /Contents [4 0 R 5 0 R] >>',
        4: { dict: '<< /Length 999 >>', data: '0 g' },
        5: { dict: '<< /Length 6 0 R >>', data: '1 w' },
        6: '3',
      }),
    );
    const [a, b] = src.pages[0]!.dict.get('Contents') as PdfRef[];
    expect(decodedText(src, src.get(a!))).toBe('0 g');
    expect(decodedText(src, src.get(b!))).toBe('1 w');
  });

  it('refuses an encrypted file and what is not a PDF', () => {
    expect(() =>
      PdfSource.open(
        buildPdf(
          { ...TWO_PAGES, 9: '<< /Filter /Standard /V 1 /R 2 >>' },
          { trailer: '/Encrypt 9 0 R' },
        ),
      ),
    ).toThrow(PdfReadError);
    expect(() => PdfSource.open(bytesOf('hello'))).toThrow(PdfReadError);
  });

  it('parses strings, names, numbers and references as §7.3 writes them', () => {
    const src = PdfSource.open(
      buildPdf({
        1: '<< /Type /Catalog /Pages 2 0 R /V [(a\\(b\\)\\\\c\\n\\101\\\r\nd) <48 69 7> /A#20B -.5 +3 4 0 R 12 true false null] >>',
        2: '<< /Type /Pages /Kids [] /Count 0 >>',
      }),
    );
    const v = dict(src.resolve(src.trailer.get('Root'))).get('V') as unknown[];
    expect(textOf((v[0] as PdfString).bytes)).toBe('a(b)\\c\nAd');
    expect(textOf((v[1] as PdfString).bytes)).toBe('Hip');
    expect(v.slice(2)).toEqual([
      new PdfName('A B'),
      -0.5,
      3,
      new PdfRef(4, 0),
      12,
      true,
      false,
      null,
    ]);
  });

  it('decodes LZW, ASCII85, ASCIIHex, RunLength and Flate behind a TIFF predictor', () => {
    const page = (filter: string, data: Uint8Array | string) =>
      buildPdf({
        1: '<< /Type /Catalog /Pages 2 0 R >>',
        2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        3: '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
        4: { dict: `<< ${filter} >>`, data },
      });
    const contents = (bytes: Uint8Array) => {
      const src = PdfSource.open(bytes);
      return textOf(src.decode(src.resolve(src.pages[0]!.dict.get('Contents')) as PdfStream));
    };
    // "-----A---B" with EarlyChange 1, from the PDF reference's LZW example (§7.4.4.2).
    const lzw = Uint8Array.from([0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0c, 0x85, 0x01]);
    expect(contents(page('/Filter /LZWDecode', lzw))).toBe('-----A---B');
    expect(contents(page('/Filter /ASCII85Decode', '87cURD]i,"Ebo80~>'))).toBe('Hello World!');
    expect(contents(page('/Filter [/ASCIIHexDecode]', '4 8 6 9>'))).toBe('Hi');
    expect(
      contents(page('/Filter /RunLengthDecode', Uint8Array.from([1, 0x61, 0x62, 254, 0x63, 128]))),
    ).toBe('abccc');
    // TIFF predictor 2: each byte after the first a difference from the one before.
    const tiff = zlibSync(Uint8Array.from([0x61, 1, 1]));
    expect(
      contents(page('/Filter /FlateDecode /DecodeParms << /Predictor 2 /Columns 3 >>', tiff)),
    ).toBe('abc');
    expect(() => contents(page('/Filter /JBIG2Decode', 'x'))).toThrow(PdfReadError);
  });
});

describe('writeValue', () => {
  it('writes values back as PDF syntax, strings as hex and references renumbered', () => {
    const v = new Map<string, unknown>([
      ['N', new PdfName('A B#')],
      ['S', new PdfString(Uint8Array.from([0, 0x28, 0xff]))],
      ['R', new PdfRef(4, 0)],
      ['A', [1, 0.25, -1e-12, true, null]],
    ]) as PdfDict;
    expect(writeValue(v, (r) => `${r.num + 10} 0 R`)).toBe(
      '<< /N /A#20B#23 /S <0028ff> /R 14 0 R /A [1 0.25 0 true null] >>',
    );
    expect(pdfReal(1 / 3)).toBe('0.3333333333');
    expect(pdfReal(1e-7)).toBe('0.0000001');
  });
});
