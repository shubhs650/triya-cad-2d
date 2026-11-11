// M2-38: an encrypted PDF underlay (the Standard security handler with an empty user password)
// plots as the unencrypted one. pdf.js reads every test file first, so the files are known to be
// encrypted correctly; then the plot of each must be byte for byte the plot of the plain file.
import type { PdfString } from '@triya/pdf';
import {
  PdfDocument,
  PdfName,
  PdfReadError,
  PdfSource,
  PdfStream,
  plotItems,
  type PdfDict,
  type PlotPathItem,
} from '@triya/pdf';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { CONTENT, LAYER_NAME, XMP, testPdf, type EncryptOptions } from './encrypt';

const VARIANTS: readonly (EncryptOptions & { readonly label: string })[] = [
  { label: 'RC4 40-bit (R2)', encryption: 'rc4-40' },
  { label: 'RC4 128-bit (R3)', encryption: 'rc4-128' },
  { label: 'RC4 crypt filter (R4)', encryption: 'rc4-128-v4' },
  { label: 'AES-128 (R4)', encryption: 'aes-128' },
  { label: 'AES-128, metadata plain', encryption: 'aes-128', encryptMetadata: false },
  { label: 'AES-256 (R5)', encryption: 'aes-256-r5' },
  { label: 'AES-256 (R6)', encryption: 'aes-256' },
  { label: 'AES-256 (R6), object streams', encryption: 'aes-256', xref: 'stream' },
  { label: 'RC4 128-bit, object streams', encryption: 'rc4-128', xref: 'stream' },
  {
    label: 'AES-256, content behind an Identity crypt filter',
    encryption: 'aes-256',
    identityContent: true,
  },
];

/** Bytes as ISO 8859-1, one character each (TextDecoder's 'latin1' is windows-1252). */
const text = (b: Uint8Array) => Buffer.from(b).toString('latin1');

async function seenByPdfJs(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice(), useWasm: false }).promise;
  const page = await pdf.getPage(1);
  const ops = await page.getOperatorList();
  const content = await page.getTextContent();
  const meta = await pdf.getMetadata();
  return {
    fns: ops.fnArray.filter((f) => f !== OPS.dependency),
    text: content.items.map((i) => ('str' in i ? i.str : '')).join(''),
    hasXmp: meta.metadata !== null,
  };
}

const PAINT = {
  color: [0, 0, 0] as const,
  lineweight: 0.25,
  linetype: { kind: 'object' as const },
  endStyle: 'round' as const,
  joinStyle: 'round' as const,
};

/** The file plotted as an underlay on an A4 page, mm → points. */
function plotOf(file: Uint8Array): Uint8Array {
  const doc = new PdfDocument();
  const page = doc.addPage(595, 842);
  const item: PlotPathItem = {
    kind: 'fill',
    path: [],
    paint: PAINT,
    underlay: {
      definition: 'D1',
      fileName: 'plan.pdf',
      page: '1',
      frame: { a: 25.4, b: 0, c: 0, d: 25.4, e: 10, f: 20 },
      clipped: false,
      contrast: 100,
      fade: 0,
      monochrome: false,
    },
  };
  plotItems(page, [item], {
    toPaper: { a: 72 / 25.4, b: 0, c: 0, d: 72 / 25.4, e: 0, f: 0 },
    underlays: () => file,
  });
  return doc.bytes();
}

describe('encrypted PDF underlays (M2-38)', () => {
  const plain = testPdf();
  const plainPlot = plotOf(plain);

  it('the plain test page plots its content as a form', () => {
    const src = PdfSource.open(plainPlot);
    const contents = src.resolve(src.pages[0]!.dict.get('Contents')) as PdfStream;
    expect(text(src.decode(contents))).toContain('/Fm1 Do');
  });

  for (const v of VARIANTS) {
    describe(v.label, () => {
      const file = testPdf(v);
      const plainOfSameShape = testPdf(v.xref ? { xref: v.xref } : {});

      it('is a file pdf.js decrypts to the plain page', async () => {
        expect(text(file)).toContain('/Encrypt');
        expect(text(file)).not.toContain(LAYER_NAME);
        const seen = await seenByPdfJs(file);
        const want = await seenByPdfJs(plainOfSameShape);
        expect(seen.fns).toEqual(want.fns);
        expect(seen.text).toBe('Encrypted');
        // pdf.js reads /EncryptMetadata as false below V4 and fetches the XMP undecrypted, so
        // it finds none there; the spec encrypts it (EncryptMetadata is a V4/V5 entry).
        if (v.encryption !== 'rc4-40' && v.encryption !== 'rc4-128') expect(seen.hasXmp).toBe(true);
      });

      it('reads with its strings and streams decrypted', () => {
        const src = PdfSource.open(file);
        const page = src.pages[0]!;
        const contents = src.resolve(page.dict.get('Contents'));
        expect(contents).toBeInstanceOf(PdfStream);
        expect(text(src.decode(contents as PdfStream))).toBe(CONTENT);
        const props = src.resolve((page.resources as PdfDict).get('Properties')) as PdfDict;
        const layer = src.resolve(props.get('L1')) as PdfDict;
        expect(text((layer.get('Name') as PdfString).bytes)).toBe(LAYER_NAME);
        const catalog = src.resolve(src.trailer.get('Root')) as PdfDict;
        const xmp = src.resolve(catalog.get('Metadata')) as PdfStream;
        expect(xmp.dict.get('Type')).toEqual(new PdfName('Metadata'));
        expect(text(src.decode(xmp))).toBe(XMP);
      });

      it('plots as the unencrypted file does', () => {
        expect(text(plotOf(file))).toBe(text(plotOf(plainOfSameShape)));
      });
    });
  }

  it('an object-stream file plots as the table file does', () => {
    expect(text(plotOf(testPdf({ xref: 'stream' })))).toBe(text(plainPlot));
  });

  it('refuses a file that needs a password, or another security handler, and plots its boundary', () => {
    for (const locked of [
      testPdf({ encryption: 'rc4-128', userPassword: 'secret' }),
      testPdf({ encryption: 'aes-128', userPassword: 'secret' }),
      testPdf({ encryption: 'aes-256', userPassword: 'secret' }),
    ]) {
      expect(() => PdfSource.open(locked)).toThrow(/password/);
      const src = PdfSource.open(plotOf(locked));
      const contents = src.resolve(src.pages[0]!.dict.get('Contents')) as PdfStream;
      expect(text(src.decode(contents))).not.toContain(' Do');
    }
    const other = text(testPdf({ encryption: 'aes-128' })).replace(
      '/Filter /Standard',
      '/Filter /PubSec00',
    );
    const bytes = Uint8Array.from(other, (c) => c.charCodeAt(0));
    expect(() => PdfSource.open(bytes)).toThrow(PdfReadError);
    expect(() => PdfSource.open(bytes)).toThrow(/PubSec00/);
  });

  it('reads an encrypted file whose cross-reference is damaged, by scanning for its objects', () => {
    for (const xref of ['table', 'stream'] as const) {
      const file = text(testPdf({ encryption: 'aes-256', xref }));
      // startxref points nowhere: the reader scans, finds the trailer (or the cross-reference
      // stream's dictionary) and its /Encrypt before the encrypted object stream.
      const broken = file.replace(/startxref\n\d+/, 'startxref\n7');
      const src = PdfSource.open(Uint8Array.from(broken, (c) => c.charCodeAt(0)));
      const page = src.pages[0]!;
      expect(text(src.decode(src.resolve(page.dict.get('Contents')) as PdfStream))).toBe(CONTENT);
      const props = src.resolve((page.resources as PdfDict).get('Properties')) as PdfDict;
      expect(text(((src.resolve(props.get('L1')) as PdfDict).get('Name') as PdfString).bytes)).toBe(
        LAYER_NAME,
      );
    }
  });
});
