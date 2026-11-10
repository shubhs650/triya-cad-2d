// Reading a PDF file (PDF 32000-1:2008 §7.2–7.5) far enough to copy a page into a plot (M2-16
// part 5, PDF underlays): the objects (§7.3), the cross-reference table or stream with every
// update's section (§7.5.4, §7.5.8, hybrid files' /XRefStm), object streams (§7.5.7) and the
// page tree with its inherited attributes (§7.7.3.4). A file whose cross-reference data is
// damaged is read by scanning for its objects, as viewers do. Streams keep their encoded bytes;
// only cross-reference streams, object streams and content streams are decoded (Flate with PNG
// or TIFF predictors, LZW, ASCIIHex, ASCII85, RunLength). Encrypted files are refused
// (`PdfReadError`): the plot cannot copy what it cannot decrypt. No DOM here.

import { inflateSync, unzlibSync } from 'fflate';

export class PdfName {
  constructor(readonly name: string) {}
}

export class PdfRef {
  constructor(
    readonly num: number,
    readonly gen: number,
  ) {}
}

/** A string's bytes, as written (literal escapes and hex resolved). */
export class PdfString {
  constructor(readonly bytes: Uint8Array) {}
}

export type PdfDict = Map<string, PdfValue>;

/** A stream: its dictionary and its data still encoded with its filters. */
export class PdfStream {
  constructor(
    readonly dict: PdfDict,
    readonly data: Uint8Array,
  ) {}
}

export type PdfValue =
  null | boolean | number | PdfName | PdfString | PdfRef | PdfDict | PdfStream | PdfValue[];

export class PdfReadError extends Error {}

/** A page with the attributes it inherits from the page tree resolved. */
export interface PdfPageEntry {
  readonly dict: PdfDict;
  readonly resources: PdfValue;
  readonly mediaBox: PdfValue;
  readonly cropBox: PdfValue;
  readonly rotate: PdfValue;
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

const latin1 = (b: Uint8Array, from = 0, to = b.length): string => {
  let s = '';
  for (let i = from; i < to; i += 8192)
    s += String.fromCharCode(...b.subarray(i, Math.min(to, i + 8192)));
  return s;
};

/** A keyword or a token the parser met where it expected a value. */
class Keyword {
  constructor(readonly word: string) {}
}

class Lexer {
  pos: number;
  constructor(
    readonly b: Uint8Array,
    pos = 0,
  ) {
    this.pos = pos;
  }

  skip(): void {
    const b = this.b;
    for (;;) {
      while (this.pos < b.length && WS.has(b[this.pos]!)) this.pos++;
      if (b[this.pos] !== 0x25) return;
      while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13) this.pos++;
    }
  }

  /** A run of regular characters. */
  word(): string {
    const b = this.b;
    const start = this.pos;
    while (this.pos < b.length && !WS.has(b[this.pos]!) && !DELIM.has(b[this.pos]!)) this.pos++;
    return latin1(b, start, this.pos);
  }

  /** The next value, or a keyword (`obj`, `stream`, `R`, `endobj`, …). */
  next(): PdfValue | Keyword {
    this.skip();
    const b = this.b;
    if (this.pos >= b.length) throw new PdfReadError('unexpected end of file');
    const c = b[this.pos]!;
    if (c === 0x2f) {
      this.pos++;
      return new PdfName(
        this.word().replace(/#([0-9a-fA-F]{2})/g, (_, h: string) =>
          String.fromCharCode(Number.parseInt(h, 16)),
        ),
      );
    }
    if (c === 0x28) return this.literal();
    if (c === 0x3c) {
      if (b[this.pos + 1] === 0x3c) {
        this.pos += 2;
        return this.dict();
      }
      return this.hex();
    }
    if (c === 0x5b) {
      this.pos++;
      const out: PdfValue[] = [];
      for (;;) {
        this.skip();
        if (b[this.pos] === 0x5d) {
          this.pos++;
          return out;
        }
        out.push(this.value());
      }
    }
    if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7b || c === 0x7d) {
      this.pos++;
      return new Keyword(String.fromCharCode(c));
    }
    const w = this.word();
    if (w === '') {
      this.pos++;
      return new Keyword(String.fromCharCode(c));
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) {
      const n = Number(w);
      // `num gen R`: an integer may start an indirect reference.
      if (/^\d+$/.test(w)) {
        const save = this.pos;
        this.skip();
        const g = this.word();
        if (/^\d+$/.test(g)) {
          this.skip();
          if (this.b[this.pos] === 0x52) {
            const after = this.b[this.pos + 1];
            if (after === undefined || WS.has(after) || DELIM.has(after)) {
              this.pos++;
              return new PdfRef(n, Number(g));
            }
          }
        }
        this.pos = save;
      }
      return n;
    }
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    return new Keyword(w);
  }

  value(): PdfValue {
    const v = this.next();
    if (v instanceof Keyword) throw new PdfReadError(`unexpected "${v.word}" at ${this.pos}`);
    return v;
  }

  dict(): PdfDict {
    const out: PdfDict = new Map();
    for (;;) {
      this.skip();
      if (this.b[this.pos] === 0x3e && this.b[this.pos + 1] === 0x3e) {
        this.pos += 2;
        return out;
      }
      const k = this.next();
      if (!(k instanceof PdfName)) throw new PdfReadError(`dictionary key expected at ${this.pos}`);
      out.set(k.name, this.value());
    }
  }

  literal(): PdfString {
    const b = this.b;
    const out: number[] = [];
    let depth = 1;
    this.pos++;
    while (this.pos < b.length) {
      const c = b[this.pos++]!;
      if (c === 0x5c) {
        const e = b[this.pos++]!;
        const simple: Record<number, number> = {
          0x6e: 10,
          0x72: 13,
          0x74: 9,
          0x62: 8,
          0x66: 12,
          0x28: 0x28,
          0x29: 0x29,
          0x5c: 0x5c,
        };
        if (simple[e] !== undefined) out.push(simple[e]!);
        else if (e >= 0x30 && e <= 0x37) {
          let v = e - 0x30;
          for (let k = 0; k < 2 && b[this.pos]! >= 0x30 && b[this.pos]! <= 0x37; k++)
            v = v * 8 + (b[this.pos++]! - 0x30);
          out.push(v & 0xff);
        } else if (e === 13) {
          if (b[this.pos] === 10) this.pos++;
        } else if (e !== 10) out.push(e);
        continue;
      }
      if (c === 0x28) depth++;
      else if (c === 0x29 && --depth === 0) break;
      out.push(c);
    }
    return new PdfString(Uint8Array.from(out));
  }

  hex(): PdfString {
    const b = this.b;
    this.pos++;
    const digits: number[] = [];
    while (this.pos < b.length && b[this.pos] !== 0x3e) {
      const c = b[this.pos++]!;
      const v = hexValue(c);
      if (v >= 0) digits.push(v);
    }
    this.pos++;
    if (digits.length % 2) digits.push(0);
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = digits[2 * i]! * 16 + digits[2 * i + 1]!;
    return new PdfString(out);
  }
}

function hexValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x37;
  if (c >= 0x61 && c <= 0x66) return c - 0x57;
  return -1;
}

type XrefEntry =
  | { readonly kind: 'file'; readonly offset: number; readonly gen: number }
  | { readonly kind: 'packed'; readonly stream: number; readonly index: number };

const name = (v: PdfValue | undefined): string | undefined =>
  v instanceof PdfName ? v.name : undefined;

export class PdfSource {
  readonly #b: Uint8Array;
  readonly #xref = new Map<number, XrefEntry>();
  readonly #cache = new Map<number, PdfValue>();
  readonly #packed = new Map<
    number,
    { readonly first: number; readonly offsets: Map<number, number>; readonly data: Uint8Array }
  >();
  #trailer: PdfDict = new Map();
  #pages: PdfPageEntry[] | undefined;

  private constructor(bytes: Uint8Array) {
    this.#b = bytes;
  }

  /** Reads `bytes`; throws `PdfReadError` for a file that is not a PDF or is encrypted. */
  static open(bytes: Uint8Array): PdfSource {
    const s = new PdfSource(bytes);
    let ok = false;
    try {
      ok = s.#readXref();
    } catch (e) {
      if (!(e instanceof PdfReadError)) throw e;
    }
    if (!ok) s.#reconstruct();
    if (s.#trailer.has('Encrypt')) throw new PdfReadError('the PDF is encrypted');
    if (!(s.resolve(s.#trailer.get('Root')) instanceof Map)) {
      // A table that reads but points nowhere useful: scan instead.
      if (ok) s.#reconstruct();
      if (!(s.resolve(s.#trailer.get('Root')) instanceof Map))
        throw new PdfReadError('no document catalog');
    }
    return s;
  }

  get trailer(): PdfDict {
    return this.#trailer;
  }

  /** The object `ref` names; null for one the file lacks (§7.3.10). */
  get(ref: PdfRef): PdfValue {
    if (this.#cache.has(ref.num)) return this.#cache.get(ref.num)!;
    // Marked first, so a stream whose /Length names itself cannot loop.
    this.#cache.set(ref.num, null);
    let v: PdfValue = null;
    const e = this.#xref.get(ref.num);
    try {
      if (e?.kind === 'file') v = this.#objectAt(e.offset, ref.num);
      else if (e?.kind === 'packed') v = this.#packedObject(e.stream, e.index, ref.num);
    } catch (err) {
      if (!(err instanceof PdfReadError)) throw err;
      v = null;
    }
    this.#cache.set(ref.num, v);
    return v;
  }

  /** `v`, or the object it refers to. */
  resolve(v: PdfValue | undefined): PdfValue {
    let at = v ?? null;
    for (let i = 0; i < 32 && at instanceof PdfRef; i++) at = this.get(at);
    return at instanceof PdfRef ? null : at;
  }

  /** The pages in order, with what they inherit. */
  get pages(): readonly PdfPageEntry[] {
    if (this.#pages) return this.#pages;
    const out: PdfPageEntry[] = [];
    const seen = new Set<PdfValue>();
    const root = this.resolve(this.#trailer.get('Root'));
    const walk = (node: PdfValue, inherited: Omit<PdfPageEntry, 'dict'>, depth: number) => {
      if (!(node instanceof Map) || seen.has(node) || depth > 64) return;
      seen.add(node);
      const own = (k: 'Resources' | 'MediaBox' | 'CropBox' | 'Rotate', was: PdfValue) =>
        node.has(k) ? this.resolve(node.get(k)) : was;
      const here = {
        resources: own('Resources', inherited.resources),
        mediaBox: own('MediaBox', inherited.mediaBox),
        cropBox: own('CropBox', inherited.cropBox),
        rotate: own('Rotate', inherited.rotate),
      };
      const kids = this.resolve(node.get('Kids'));
      if (name(node.get('Type')) === 'Pages' || (Array.isArray(kids) && !node.has('Contents'))) {
        if (Array.isArray(kids)) for (const k of kids) walk(this.resolve(k), here, depth + 1);
        return;
      }
      out.push({ dict: node, ...here });
    };
    if (root instanceof Map)
      walk(
        this.resolve(root.get('Pages')),
        { resources: null, mediaBox: null, cropBox: null, rotate: null },
        0,
      );
    this.#pages = out;
    return out;
  }

  /** A stream's data with its filters undone; throws `PdfReadError` for one it cannot decode. */
  decode(s: PdfStream): Uint8Array {
    const filters = this.resolve(s.dict.get('Filter'));
    const parms = this.resolve(s.dict.get('DecodeParms'));
    const list = Array.isArray(filters) ? filters : filters === null ? [] : [filters];
    let data = s.data;
    list.forEach((f, i) => {
      const p = this.resolve(Array.isArray(parms) ? parms[i] : parms);
      data = decodeFilter(
        name(this.resolve(f)) ?? '',
        data,
        p instanceof Map ? p : undefined,
        (v) => this.resolve(v),
      );
    });
    return data;
  }

  #readXref(): boolean {
    const b = this.#b;
    const tail = latin1(b, Math.max(0, b.length - 2048));
    const at = tail.lastIndexOf('startxref');
    if (at < 0) return false;
    const m = /startxref\s+(\d+)/.exec(tail.slice(at));
    if (!m) return false;
    let offset: number | undefined = Number(m[1]);
    const seen = new Set<number>();
    let first = true;
    while (offset !== undefined && !seen.has(offset) && offset < b.length) {
      seen.add(offset);
      const trailer = this.#section(offset);
      if (first) {
        this.#trailer = trailer;
        first = false;
      }
      const prev = trailer.get('Prev');
      offset = typeof prev === 'number' ? prev : undefined;
    }
    return !first && this.#xref.size > 0;
  }

  /** One cross-reference section, table or stream; entries already read (newer) win. */
  #section(offset: number): PdfDict {
    const lx = new Lexer(this.#b, offset);
    lx.skip();
    const set = (num: number, e: XrefEntry) => {
      if (!this.#xref.has(num)) this.#xref.set(num, e);
    };
    if (lx.word() === 'xref') {
      const entries: [number, XrefEntry][] = [];
      for (;;) {
        lx.skip();
        const start = lx.word();
        if (start === 'trailer') break;
        lx.skip();
        const count = Number(lx.word());
        if (!/^\d+$/.test(start) || !Number.isInteger(count))
          throw new PdfReadError('bad cross-reference table');
        for (let i = 0; i < count; i++) {
          lx.skip();
          const off = Number(lx.word());
          lx.skip();
          const gen = Number(lx.word());
          lx.skip();
          const kind = lx.word();
          const num = Number(start) + i;
          // Some writers number the first subsection from 1 though it lists object 0.
          if (kind === 'n' && off > 0) entries.push([num, { kind: 'file', offset: off, gen }]);
          else if (kind === 'f') entries.push([num, { kind: 'file', offset: 0, gen }]);
        }
      }
      lx.skip();
      const v = lx.value();
      if (!(v instanceof Map)) throw new PdfReadError('bad trailer');
      // A hybrid file (§7.5.8.4): its cross-reference stream lists the objects the table marks
      // free (those in object streams), so it is read first and wins.
      const stm = v.get('XRefStm');
      if (typeof stm === 'number' && stm !== offset) {
        try {
          this.#section(stm);
        } catch (e) {
          if (!(e instanceof PdfReadError)) throw e;
        }
      }
      // A free entry stays free: an older section cannot revive the object.
      for (const [num, e] of entries) set(num, e);
      return v;
    }
    const s = this.#objectAt(offset, undefined);
    if (!(s instanceof PdfStream) || name(s.dict.get('Type')) !== 'XRef')
      throw new PdfReadError('no cross-reference at startxref');
    const w = s.dict.get('W');
    if (!Array.isArray(w) || w.length < 3 || !w.every((x) => typeof x === 'number'))
      throw new PdfReadError('bad /W');
    const [w0, w1, w2] = w as number[];
    const size = s.dict.get('Size');
    const index = s.dict.get('Index');
    const ranges = Array.isArray(index)
      ? (index as number[])
      : [0, typeof size === 'number' ? size : 0];
    const data = this.decode(s);
    const field = (at: number, n: number) => {
      let v = 0;
      for (let i = 0; i < n; i++) v = v * 256 + data[at + i]!;
      return v;
    };
    const row = w0! + w1! + w2!;
    let at = 0;
    for (let r = 0; r + 1 < ranges.length; r += 2) {
      for (let i = 0; i < ranges[r + 1]!; i++, at += row) {
        if (at + row > data.length) break;
        const type = w0 === 0 ? 1 : field(at, w0!);
        const f1 = field(at + w0!, w1!);
        const f2 = field(at + w0! + w1!, w2!);
        const num = ranges[r]! + i;
        if (type === 1 && f1 > 0) set(num, { kind: 'file', offset: f1, gen: f2 });
        else if (type === 2) set(num, { kind: 'packed', stream: f1, index: f2 });
        else if (type === 0) set(num, { kind: 'file', offset: 0, gen: f2 });
      }
    }
    return s.dict;
  }

  /** The object at `offset` (`num gen obj … endobj`); `num` checks it is the one wanted. */
  #objectAt(offset: number, num: number | undefined): PdfValue {
    if (offset <= 0) return null;
    const lx = new Lexer(this.#b, offset);
    const n = lx.next();
    const g = lx.next();
    const kw = lx.next();
    if (
      typeof n !== 'number' ||
      typeof g !== 'number' ||
      !(kw instanceof Keyword) ||
      kw.word !== 'obj'
    )
      throw new PdfReadError(`no object at ${offset}`);
    if (num !== undefined && n !== num) throw new PdfReadError(`object ${num} is not at ${offset}`);
    const v = lx.value();
    lx.skip();
    if (!(v instanceof Map) || latin1(this.#b, lx.pos, lx.pos + 6) !== 'stream') return v;
    return this.#stream(v, lx.pos + 6);
  }

  /** A stream's data from just after `stream`. */
  #stream(dict: PdfDict, from: number): PdfStream {
    const b = this.#b;
    let start = from;
    if (b[start] === 13) start++;
    if (b[start] === 10) start++;
    const length = this.resolve(dict.get('Length'));
    if (typeof length === 'number' && length >= 0 && start + length <= b.length) {
      const lx = new Lexer(b, start + length);
      lx.skip();
      if (latin1(b, lx.pos, lx.pos + 9) === 'endstream')
        return new PdfStream(dict, b.subarray(start, start + length));
    }
    // A wrong or missing /Length: the data runs to `endstream`, less the end of line before it.
    let end = indexOf(b, 'endstream', start);
    if (end < 0) throw new PdfReadError('stream without endstream');
    if (b[end - 1] === 10) end--;
    if (b[end - 1] === 13) end--;
    return new PdfStream(dict, b.subarray(start, end));
  }

  #packedObject(stream: number, index: number, num: number): PdfValue {
    let p = this.#packed.get(stream);
    if (!p) {
      const s = this.get(new PdfRef(stream, 0));
      if (!(s instanceof PdfStream)) throw new PdfReadError(`object stream ${stream} missing`);
      const data = this.decode(s);
      const n = this.resolve(s.dict.get('N'));
      const first = this.resolve(s.dict.get('First'));
      if (typeof n !== 'number' || typeof first !== 'number')
        throw new PdfReadError('bad object stream');
      const lx = new Lexer(data);
      const offsets = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        const k = lx.next();
        const o = lx.next();
        if (typeof k !== 'number' || typeof o !== 'number') break;
        offsets.set(k, o);
      }
      p = { first, offsets, data };
      this.#packed.set(stream, p);
    }
    const off = p.offsets.get(num);
    if (off === undefined)
      throw new PdfReadError(`object ${num} not in stream ${stream} (${index})`);
    return new Lexer(p.data, p.first + off).value();
  }

  /** Damaged cross-reference data: every `n g obj` in the file, the last of a number winning. */
  #reconstruct(): void {
    const b = this.#b;
    this.#xref.clear();
    this.#cache.clear();
    this.#packed.clear();
    const text = latin1(b);
    const re = /(?:^|[\s>\]])(\d+)\s+(\d+)\s+obj\b/g;
    let m: RegExpExecArray | null;
    const streams: number[] = [];
    let catalog: number | undefined;
    while ((m = re.exec(text))) {
      const offset = m.index + m[0].indexOf(m[1]!);
      const num = Number(m[1]);
      this.#xref.set(num, { kind: 'file', offset, gen: Number(m[2]) });
      const head = text.slice(offset, offset + 200);
      if (/\/Type\s*\/ObjStm/.test(head)) streams.push(num);
      if (/\/Type\s*\/Catalog/.test(head)) catalog = num;
    }
    for (const s of streams) {
      try {
        const v = this.get(new PdfRef(s, 0));
        if (!(v instanceof PdfStream)) continue;
        const data = this.decode(v);
        const n = this.resolve(v.dict.get('N'));
        const lx = new Lexer(data);
        for (let i = 0; typeof n === 'number' && i < n; i++) {
          const k = lx.next();
          lx.next();
          if (typeof k !== 'number') break;
          if (!this.#xref.has(k)) this.#xref.set(k, { kind: 'packed', stream: s, index: i });
        }
      } catch (e) {
        if (!(e instanceof PdfReadError)) throw e;
      }
    }
    this.#trailer = new Map();
    const t = text.lastIndexOf('trailer');
    if (t >= 0) {
      try {
        const lx = new Lexer(b, t + 7);
        const v = lx.value();
        if (v instanceof Map) this.#trailer = v;
      } catch (e) {
        if (!(e instanceof PdfReadError)) throw e;
      }
    }
    if (!(this.resolve(this.#trailer.get('Root')) instanceof Map)) {
      if (catalog === undefined)
        for (const [num] of this.#xref) {
          const v = this.get(new PdfRef(num, 0));
          if (v instanceof Map && name(v.get('Type')) === 'Catalog') catalog = num;
        }
      if (catalog !== undefined) this.#trailer.set('Root', new PdfRef(catalog, 0));
    }
  }
}

function indexOf(b: Uint8Array, word: string, from: number): number {
  const first = word.charCodeAt(0);
  outer: for (let i = from; i <= b.length - word.length; i++) {
    if (b[i] !== first) continue;
    for (let k = 1; k < word.length; k++) if (b[i + k] !== word.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
}

function decodeFilter(
  filter: string,
  data: Uint8Array,
  parms: PdfDict | undefined,
  resolve: (v: PdfValue | undefined) => PdfValue,
): Uint8Array {
  const num = (k: string, d: number) => {
    const v = resolve(parms?.get(k));
    return typeof v === 'number' ? v : d;
  };
  switch (filter) {
    case 'FlateDecode':
    case 'Fl':
      return predict(
        inflate(data),
        num('Predictor', 1),
        num('Colors', 1),
        num('BitsPerComponent', 8),
        num('Columns', 1),
      );
    case 'LZWDecode':
    case 'LZW':
      return predict(
        lzw(data, num('EarlyChange', 1)),
        num('Predictor', 1),
        num('Colors', 1),
        num('BitsPerComponent', 8),
        num('Columns', 1),
      );
    case 'ASCIIHexDecode':
    case 'AHx':
      return asciiHex(data);
    case 'ASCII85Decode':
    case 'A85':
      return ascii85(data);
    case 'RunLengthDecode':
    case 'RL':
      return runLength(data);
    default:
      throw new PdfReadError(`cannot decode ${filter || 'an unnamed filter'}`);
  }
}

function inflate(data: Uint8Array): Uint8Array {
  try {
    return unzlibSync(data);
  } catch {
    try {
      // No zlib header or a bad checksum: the deflate data alone, as viewers accept it.
      return inflateSync(data.subarray((data[0]! & 0x0f) === 8 ? 2 : 0));
    } catch {
      throw new PdfReadError('bad Flate data');
    }
  }
}

/** §7.4.4.4: undoes a TIFF (2) or PNG (10–15) predictor. */
function predict(
  data: Uint8Array,
  predictor: number,
  colors: number,
  bpc: number,
  columns: number,
): Uint8Array {
  if (predictor <= 1) return data;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowBytes = Math.ceil((colors * bpc * columns) / 8);
  if (predictor === 2) {
    if (bpc !== 8) throw new PdfReadError('TIFF predictor below 8 bits');
    const out = Uint8Array.from(data);
    for (let r = 0; r < out.length; r += rowBytes)
      for (let i = bpp; i < rowBytes && r + i < out.length; i++)
        out[r + i] = (out[r + i]! + out[r + i - bpp]!) & 0xff;
    return out;
  }
  const rows = Math.floor(data.length / (rowBytes + 1));
  const out = new Uint8Array(rows * rowBytes);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowBytes + 1)]!;
    const src = r * (rowBytes + 1) + 1;
    const at = r * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const x = data[src + i]!;
      const a = i >= bpp ? out[at + i - bpp]! : 0;
      const up = r > 0 ? out[at - rowBytes + i]! : 0;
      const c = r > 0 && i >= bpp ? out[at - rowBytes + i - bpp]! : 0;
      let v: number;
      if (type === 1) v = x + a;
      else if (type === 2) v = x + up;
      else if (type === 3) v = x + ((a + up) >> 1);
      else if (type === 4) {
        const p = a + up - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
      } else v = x;
      out[at + i] = v & 0xff;
    }
  }
  return out;
}

function lzw(data: Uint8Array, earlyChange: number): Uint8Array {
  const out: number[] = [];
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < 256; i++) dict.push([i]);
    dict.push([], []);
  };
  reset();
  let width = 9;
  let bits = 0;
  let acc = 0;
  let prev: number[] | undefined;
  for (const byte of data) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= width) {
      const code = (acc >> (bits - width)) & ((1 << width) - 1);
      bits -= width;
      acc &= (1 << bits) - 1;
      if (code === 256) {
        reset();
        width = 9;
        prev = undefined;
        continue;
      }
      if (code === 257) return Uint8Array.from(out);
      let entry: number[];
      if (code < dict.length) entry = dict[code]!;
      else if (prev) entry = [...prev, prev[0]!];
      else throw new PdfReadError('bad LZW data');
      out.push(...entry);
      if (prev) dict.push([...prev, entry[0]!]);
      prev = entry;
      if (dict.length + earlyChange >= 1 << width && width < 12) width++;
    }
  }
  return Uint8Array.from(out);
}

function asciiHex(data: Uint8Array): Uint8Array {
  const digits: number[] = [];
  for (const c of data) {
    if (c === 0x3e) break;
    const v = hexValue(c);
    if (v >= 0) digits.push(v);
  }
  if (digits.length % 2) digits.push(0);
  const out = new Uint8Array(digits.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = digits[2 * i]! * 16 + digits[2 * i + 1]!;
  return out;
}

function ascii85(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let group: number[] = [];
  const flush = (n: number) => {
    let v = 0;
    for (let i = 0; i < 5; i++) v = v * 85 + (group[i] ?? 84);
    for (let i = 0; i < n - 1; i++) out.push((v >>> (24 - 8 * i)) & 0xff);
    group = [];
  };
  let i = 0;
  if (data[0] === 0x3c && data[1] === 0x7e) i = 2;
  for (; i < data.length; i++) {
    const c = data[i]!;
    if (c === 0x7e) break;
    if (WS.has(c)) continue;
    if (c === 0x7a && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (c < 0x21 || c > 0x75) throw new PdfReadError('bad ASCII85 data');
    group.push(c - 0x21);
    if (group.length === 5) flush(5);
  }
  if (group.length > 0) flush(group.length);
  return Uint8Array.from(out);
}

function runLength(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length;) {
    const n = data[i++]!;
    if (n === 128) break;
    if (n < 128) {
      for (let k = 0; k <= n && i < data.length; k++) out.push(data[i++]!);
    } else {
      const v = data[i++]!;
      for (let k = 0; k < 257 - n; k++) out.push(v);
    }
  }
  return Uint8Array.from(out);
}

const isRegular = (c: number) => c > 0x20 && c < 0x7f && !DELIM.has(c) && c !== 0x23;

/** A real as PDF writes one: no exponent, up to ten decimals. */
export function pdfReal(v: number): string {
  if (!Number.isFinite(v)) return '0';
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/** `v` written back as PDF syntax, references through `ref`. */
export function writeValue(v: PdfValue, ref: (r: PdfRef) => string): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return pdfReal(v);
  if (v instanceof PdfName) {
    let s = '/';
    for (let i = 0; i < v.name.length; i++) {
      const c = v.name.charCodeAt(i);
      s += isRegular(c) ? v.name[i] : `#${c.toString(16).padStart(2, '0')}`;
    }
    return s;
  }
  if (v instanceof PdfString) {
    let s = '<';
    for (const c of v.bytes) s += c.toString(16).padStart(2, '0');
    return `${s}>`;
  }
  if (v instanceof PdfRef) return ref(v);
  if (Array.isArray(v)) return `[${v.map((x) => writeValue(x, ref)).join(' ')}]`;
  if (v instanceof PdfStream) throw new Error('a stream is written as an object of its own');
  const parts: string[] = [];
  for (const [k, x] of v) parts.push(`${writeValue(new PdfName(k), ref)} ${writeValue(x, ref)}`);
  return `<< ${parts.join(' ')} >>`;
}
