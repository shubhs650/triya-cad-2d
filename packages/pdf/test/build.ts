// Test PDFs written by hand, so the reader meets each file structure a writer may choose: a
// cross-reference table, a cross-reference stream with object streams and a PNG predictor,
// incremental updates and hybrid files.
import { zlibSync } from 'fflate';

export type Body = string | { readonly dict: string; readonly data: Uint8Array | string };

export const bytesOf = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

export const textOf = (b: Uint8Array): string => {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return s;
};

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

function objectBytes(num: number, body: Body): Uint8Array {
  if (typeof body === 'string') return bytesOf(`${num} 0 obj\n${body}\nendobj\n`);
  const data = typeof body.data === 'string' ? bytesOf(body.data) : body.data;
  const dict = body.dict.includes('/Length')
    ? body.dict
    : body.dict.replace(/>>$/, `/Length ${data.length} >>`);
  return concat([
    bytesOf(`${num} 0 obj\n${dict}\nstream\n`),
    data,
    bytesOf('\nendstream\nendobj\n'),
  ]);
}

export interface BuildOptions {
  /** `table` (the default) or a cross-reference `stream`. */
  readonly xref?: 'table' | 'stream';
  /** Objects packed into one object stream (stream xref only). */
  readonly packed?: readonly number[];
  /** Extra trailer entries, e.g. `/Encrypt 9 0 R`. */
  readonly trailer?: string;
  /** Write each offset this much off (a damaged table). */
  readonly skew?: number;
}

/** A complete PDF of `objects` (by number), object 1 the catalog. */
export function buildPdf(
  objects: Readonly<Record<number, Body>>,
  o: BuildOptions = {},
): Uint8Array {
  const parts: Uint8Array[] = [bytesOf('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')];
  let offset = parts[0]!.length;
  const push = (b: Uint8Array) => {
    parts.push(b);
    offset += b.length;
  };
  const nums = Object.keys(objects).map(Number);
  const size = Math.max(...nums) + 1 + (o.xref === 'stream' ? 2 : 0);
  const offsets = new Map<number, number>();
  const packed = new Set(o.packed ?? []);
  for (const n of nums) {
    if (packed.has(n)) continue;
    offsets.set(n, offset);
    push(objectBytes(n, objects[n]!));
  }
  if (o.xref === 'stream') {
    const objstm = size - 2;
    const xrefNum = size - 1;
    const inStream = [...packed];
    if (inStream.length > 0) {
      let head = '';
      let body = '';
      for (const n of inStream) {
        head += `${n} ${body.length} `;
        body += `${objects[n] as string}\n`;
      }
      offsets.set(objstm, offset);
      const data = zlibSync(bytesOf(head + body));
      push(
        objectBytes(objstm, {
          dict: `<< /Type /ObjStm /N ${inStream.length} /First ${head.length} /Filter /FlateDecode >>`,
          data,
        }),
      );
    }
    const xrefAt = offset;
    // Rows of 1 + 4 + 2 bytes under the PNG Up predictor (Columns 7).
    const rows: number[][] = [];
    for (let n = 0; n < size; n++) {
      const i = inStream.indexOf(n);
      if (n === xrefNum) rows.push([1, ...be(xrefAt, 4), 0, 0]);
      else if (i >= 0) rows.push([2, ...be(objstm, 4), ...be(i, 2)]);
      else if (offsets.has(n)) rows.push([1, ...be(offsets.get(n)!, 4), 0, 0]);
      else rows.push([0, 0, 0, 0, 0, 255, 255]);
    }
    const raw: number[] = [];
    rows.forEach((r, k) => {
      raw.push(2);
      r.forEach((v, i) => raw.push((v - (k > 0 ? rows[k - 1]![i]! : 0)) & 0xff));
    });
    push(
      objectBytes(xrefNum, {
        dict: `<< /Type /XRef /Size ${size} /W [1 4 2] /Root 1 0 R${o.trailer ? ` ${o.trailer}` : ''} /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 7 >> >>`,
        data: zlibSync(Uint8Array.from(raw)),
      }),
    );
    push(bytesOf(`startxref\n${xrefAt}\n%%EOF\n`));
    return concat(parts);
  }
  const xrefAt = offset;
  let table = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++) {
    const off = offsets.get(n);
    table +=
      off === undefined
        ? '0000000000 00001 f \n'
        : `${String(off + (o.skew ?? 0)).padStart(10, '0')} 00000 n \n`;
  }
  table += `trailer\n<< /Size ${size} /Root 1 0 R${o.trailer ? ` ${o.trailer}` : ''} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  push(bytesOf(table));
  return concat(parts);
}

/** `file` with an incremental update replacing or adding `objects` (a table section). */
export function appendUpdate(
  file: Uint8Array,
  objects: Readonly<Record<number, Body | null>>,
  trailer = '',
): Uint8Array {
  const text = textOf(file);
  const prev = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)![1]);
  const size = Number(/\/Size (\d+)/.exec(text.slice(prev))![1]);
  const parts: Uint8Array[] = [file];
  let offset = file.length;
  let table = 'xref\n';
  const nums = Object.keys(objects).map(Number);
  for (const n of nums) {
    const body = objects[n];
    if (body === null) {
      table += `${n} 1\n0000000000 00001 f \n`;
      continue;
    }
    table += `${n} 1\n${String(offset).padStart(10, '0')} 00000 n \n`;
    const b = objectBytes(n, body!);
    parts.push(b);
    offset += b.length;
  }
  const newSize = Math.max(size, ...nums.map((n) => n + 1));
  parts.push(
    bytesOf(
      `${table}trailer\n<< /Size ${newSize} /Root 1 0 R /Prev ${prev}${trailer ? ` ${trailer}` : ''} >>\nstartxref\n${offset}\n%%EOF\n`,
    ),
  );
  return concat(parts);
}

const be = (v: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => (v >>> (8 * (n - 1 - i))) & 0xff);

/** A two-page document: page 1 inherits a 200 × 100 media box and its resources, page 2 turns. */
export const TWO_PAGES: Readonly<Record<number, Body>> = {
  1: '<< /Type /Catalog /Pages 2 0 R >>',
  2: '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> >>',
  3: '<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>',
  4: '<< /Type /Page /Parent 2 0 R /Rotate 90 /CropBox [10 10 190 90] /Contents [7 0 R 8 0 R] >>',
  5: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  6: { dict: '<< >>', data: '1 0 0 rg 10 10 50 50 re f\nBT /F1 12 Tf 70 20 Td (Hi) Tj ET' },
  7: { dict: '<< /Filter /ASCIIHexDecode >>', data: '3020302031207267>' },
  8: { dict: '<< /Filter /FlateDecode >>', data: zlibSync(bytesOf('20 20 100 40 re f')) },
};

/**
 * One page with PDF layers (optional content groups, M2-38 part 2): a red square in "Walls", a
 * blue one in "Notes" (its name written UTF-16BE), a green one in "Draft", which the document
 * shows off by default, and a form XObject in "Walls" by its own /OC.
 */
export const LAYERED: Readonly<Record<number, Body>> = {
  1: '<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R 6 0 R 7 0 R] /D << /Order [5 0 R 6 0 R 7 0 R] /OFF [7 0 R] >> >> >>',
  2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Properties << /W 5 0 R /N 6 0 R /D 7 0 R >> /XObject << /X 8 0 R >> >> /Contents 4 0 R >>',
  4: {
    dict: '<< >>',
    data: [
      '/OC /W BDC 1 0 0 rg 10 10 30 30 re f EMC',
      '/OC /N BDC 0 0 1 rg 50 10 30 30 re f EMC',
      '/OC /D BDC 0 1 0 rg 90 10 30 30 re f EMC',
      '/X Do',
    ].join('\n'),
  },
  5: '<< /Type /OCG /Name (Walls) >>',
  6: '<< /Type /OCG /Name <FEFF004E006F007400650073> >>',
  7: '<< /Type /OCG /Name (Draft) >>',
  8: {
    dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 200 100] /OC 5 0 R >>',
    data: '1 0 0 rg 130 10 30 30 re f',
  },
};

/**
 * One page with annotations (M2-56 part 2), each with a normal appearance unless said: a
 * printable square (/F 4, an appearance stream without /Subtype, drawn twice its size); a note
 * that does not print (/F 0); a printable one hidden (/F 6); a printable check box whose
 * appearance is its /AS state's, turned by its /Matrix; a printable one in the layer "Marks" by
 * its /OC; a printable popup with no appearance.
 */
export const ANNOTATED: Readonly<Record<number, Body>> = {
  1: '<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [12 0 R] /D << /Order [12 0 R] >> >> >>',
  2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Annots [5 0 R 6 0 R 7 0 R 8 0 R 9 0 R 13 0 R] >>',
  4: { dict: '<< >>', data: '0 0 1 rg 10 10 20 20 re f' },
  5: '<< /Type /Annot /Subtype /Square /Rect [140 70 100 50] /F 4 /AP << /N 10 0 R >> >>',
  6: '<< /Type /Annot /Subtype /Text /Rect [0 0 20 10] /AP << /N 10 0 R >> >>',
  7: '<< /Type /Annot /Subtype /Square /Rect [0 0 20 10] /F 6 /AP << /N 10 0 R >> >>',
  8: '<< /Type /Annot /Subtype /Widget /FT /Btn /Rect [20 60 30 70] /F 4 /AS /On /AP << /N << /On 11 0 R /Off 10 0 R >> >> >>',
  9: '<< /Type /Annot /Subtype /Square /Rect [150 10 170 30] /F 4 /OC 12 0 R /AP << /N 10 0 R >> >>',
  10: { dict: '<< /BBox [0 0 20 10] >>', data: '1 0 0 RG 0 0 20 10 re S' },
  11: {
    dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Matrix [0 1 -1 0 10 0] /Resources << /Font << /F1 14 0 R >> >> >>',
    data: 'BT /F1 8 Tf 1 1 Td (4) Tj ET',
  },
  12: '<< /Type /OCG /Name (Marks) >>',
  13: '<< /Type /Annot /Subtype /Popup /Rect [0 0 50 50] /F 4 >>',
  14: '<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats >>',
};
