// Encrypted test PDFs for M2-38 (no file committed): one small page written plain or under the
// Standard security handler (PDF 32000-1:2008 §7.6.3–7.6.4; ISO 32000-2 §7.6.4.3.3–4 for
// revision 6) with RC4 or AES, a cross-reference table or a cross-reference stream with object
// streams. Encryption here is Node's (MD5, SHA-2, AES) plus a few lines of RC4, which OpenSSL 3
// no longer offers by default, written apart from @triya/pdf's own so the reader is checked
// against an independent writer; pdf.js reading these files checks the writer.
import { createCipheriv, createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

export type Encryption =
  /** V1 R2, 40-bit RC4. */
  | 'rc4-40'
  /** V2 R3, 128-bit RC4. */
  | 'rc4-128'
  /** V4 R4 with a crypt filter of RC4 (CFM V2). */
  | 'rc4-128-v4'
  /** V4 R4, AES-128 (AESV2). */
  | 'aes-128'
  /** V5 R5 (Adobe's extension level 3), AES-256. */
  | 'aes-256-r5'
  /** V5 R6 (PDF 2.0), AES-256. */
  | 'aes-256';

export interface EncryptOptions {
  readonly encryption?: Encryption;
  readonly userPassword?: string;
  readonly ownerPassword?: string;
  /** /EncryptMetadata (V4, V5); false leaves the catalog's XMP stream plain. */
  readonly encryptMetadata?: boolean;
  /** A cross-reference `stream` with objects 2–5 packed in an object stream. */
  readonly xref?: 'table' | 'stream';
  /** The content stream left plain behind an Identity /Crypt filter (V4, V5; §7.4.10). */
  readonly identityContent?: boolean;
}

/** A string written by an object: the hex string, encrypted for that object. */
type Str = (text: string) => string;
type Body = ((s: Str) => string) | { readonly dict: string; readonly data: Uint8Array };

const enc = new TextEncoder();
const bytesOf = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};
const hex = (b: Uint8Array) => `<${Buffer.from(b).toString('hex')}>`;
const concat = (...parts: Uint8Array[]) => Uint8Array.from(Buffer.concat(parts));
const zlib = (b: Uint8Array) => Uint8Array.from(deflateSync(b));

/** The page's content: shapes, text and a marked layer, as it plots. */
export const CONTENT =
  '1 0 0 rg 10 10 50 50 re f\n/OC /L1 BDC 0 0 1 RG 2 w 20 80 m 180 80 l S EMC\n' +
  'BT /F1 12 Tf 70 20 Td (Encrypted) Tj ET\n';

/** XMP for the catalog's /Metadata. */
export const XMP = '<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"/><?xpacket end="r"?>';

/** The layer's name, a string the plot copies (with a parenthesis to escape). */
export const LAYER_NAME = 'Walls (old)';

const OBJECTS: Readonly<Record<number, Body>> = {
  1: () => '<< /Type /Catalog /Pages 2 0 R /Metadata 8 0 R >>',
  2: () => '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  3: () =>
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 6 0 R /Resources 4 0 R >>',
  4: () => '<< /Font << /F1 5 0 R >> /Properties << /L1 7 0 R >> >>',
  5: (s) =>
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /X ${s('ignored')} >>`,
  6: { dict: '<< /Filter /FlateDecode >>', data: zlib(bytesOf(CONTENT)) },
  7: (s) => `<< /Type /OCG /Name ${s(LAYER_NAME)} >>`,
  8: { dict: '<< /Type /Metadata /Subtype /XML >>', data: enc.encode(XMP) },
};

const PAD = Uint8Array.from(
  Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex'),
);
const ID = Uint8Array.from(Buffer.from('5472697961204d322d333820746573742e', 'hex')).subarray(
  0,
  16,
);
/** Permissions: everything allowed but the top bits as written by Acrobat. */
const P = -3904;

const md5 = (...b: Uint8Array[]) =>
  Uint8Array.from(
    createHash('md5')
      .update(concat(...b))
      .digest(),
  );
const sha = (alg: string, b: Uint8Array) => Uint8Array.from(createHash(alg).update(b).digest());

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 255]!;
  }
  return out;
}

const aes = (
  mode: string,
  key: Uint8Array,
  iv: Uint8Array | null,
  data: Uint8Array,
  pad: boolean,
) => {
  const c = createCipheriv(mode, key, iv).setAutoPadding(pad);
  return Uint8Array.from(Buffer.concat([c.update(data), c.final()]));
};

const le32 = (v: number) =>
  Uint8Array.of(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
const padded = (pw: string) => concat(enc.encode(pw), PAD).subarray(0, 32);
const xorKey = (key: Uint8Array, i: number) => key.map((b) => b ^ i);

/** ISO 32000-2 Algorithm 2.B (revision 6), or SHA-256 alone for revision 5. */
function hash2B(r: number, pw: Uint8Array, salt: Uint8Array, udata: Uint8Array): Uint8Array {
  let k = sha('sha256', concat(pw, salt, udata));
  if (r === 5) return k;
  for (let round = 0; ; round++) {
    const k1 = concat(...Array.from({ length: 64 }, () => concat(pw, k, udata)));
    const e = aes('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32), k1, false);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i]!;
    k = sha(['sha256', 'sha384', 'sha512'][sum % 3]!, e);
    if (round >= 63 && e[e.length - 1]! <= round - 31) return k.subarray(0, 32);
  }
}

interface Security {
  readonly dict: string;
  string(num: number, data: Uint8Array): Uint8Array;
  stream(num: number, data: Uint8Array): Uint8Array;
}

function security(e: Encryption, o: EncryptOptions): Security {
  const user = o.userPassword ?? '';
  const owner = o.ownerPassword ?? 'owner';
  const meta = o.encryptMetadata ?? true;
  const iv = (num: number) => md5(enc.encode(`iv ${num}`));
  if (e === 'aes-256' || e === 'aes-256-r5') {
    const r = e === 'aes-256' ? 6 : 5;
    const fileKey = sha('sha256', enc.encode('Triya file key'));
    const salts = sha('sha256', enc.encode('salts'));
    const up = enc.encode(user);
    const op = enc.encode(owner);
    const u = concat(hash2B(r, up, salts.subarray(0, 8), new Uint8Array(0)), salts.subarray(0, 16));
    const ue = aes(
      'aes-256-cbc',
      hash2B(r, up, salts.subarray(8, 16), new Uint8Array(0)),
      new Uint8Array(16),
      fileKey,
      false,
    );
    const os = salts.subarray(16, 32);
    const ov = concat(hash2B(r, op, os.subarray(0, 8), u), os);
    const oe = aes(
      'aes-256-cbc',
      hash2B(r, op, os.subarray(8, 16), u),
      new Uint8Array(16),
      fileKey,
      false,
    );
    const perms = aes(
      'aes-256-ecb',
      fileKey,
      null,
      concat(
        le32(P),
        Uint8Array.of(255, 255, 255, 255),
        enc.encode(meta ? 'Tadb' : 'Fadb'),
        Uint8Array.of(1, 2, 3, 4),
      ),
      false,
    );
    const cipher = (num: number, data: Uint8Array) =>
      concat(iv(num), aes('aes-256-cbc', fileKey, iv(num), data, true));
    return {
      dict: `<< /Filter /Standard /V 5 /R ${r} /Length 256 /CF << /StdCF << /AuthEvent /DocOpen /CFM /AESV3 /Length 32 >> >> /StmF /StdCF /StrF /StdCF /O ${hex(ov)} /U ${hex(u)} /OE ${hex(oe)} /UE ${hex(ue)} /P ${P} /Perms ${hex(perms)}${meta ? '' : ' /EncryptMetadata false'} >>`,
      string: cipher,
      stream: cipher,
    };
  }
  const r = e === 'rc4-40' ? 2 : e === 'rc4-128' ? 3 : 4;
  const n = r === 2 ? 5 : 16;
  // Algorithm 3: the owner entry.
  let ok = md5(padded(owner));
  if (r >= 3) for (let i = 0; i < 50; i++) ok = md5(ok);
  ok = ok.subarray(0, n);
  let oEntry = rc4(ok, padded(user));
  if (r >= 3) for (let i = 1; i <= 19; i++) oEntry = rc4(xorKey(ok, i), oEntry);
  // Algorithm 2: the file key.
  let key = md5(
    padded(user),
    oEntry,
    le32(P),
    ID,
    r >= 4 && !meta ? Uint8Array.of(255, 255, 255, 255) : new Uint8Array(0),
  );
  if (r >= 3) for (let i = 0; i < 50; i++) key = md5(key.subarray(0, n));
  key = key.subarray(0, n);
  // Algorithms 4 and 5: the user entry.
  let uEntry: Uint8Array;
  if (r === 2) uEntry = rc4(key, PAD);
  else {
    let x = rc4(key, md5(PAD, ID));
    for (let i = 1; i <= 19; i++) x = rc4(xorKey(key, i), x);
    uEntry = concat(x, new Uint8Array(16));
  }
  const useAes = e === 'aes-128';
  // Algorithm 1: each object's key.
  const objectKey = (num: number) =>
    md5(
      key,
      Uint8Array.of(num & 255, (num >> 8) & 255, num >> 16, 0, 0),
      useAes ? enc.encode('sAlT') : new Uint8Array(0),
    ).subarray(0, Math.min(n + 5, 16));
  const cipher = (num: number, data: Uint8Array) =>
    useAes
      ? concat(iv(num), aes('aes-128-cbc', objectKey(num), iv(num), data, true))
      : rc4(objectKey(num), data);
  const v = r === 2 ? 1 : r === 3 ? 2 : 4;
  const cf =
    r === 4
      ? ` /CF << /StdCF << /AuthEvent /DocOpen /CFM /${useAes ? 'AESV2' : 'V2'} /Length 16 >> >> /StmF /StdCF /StrF /StdCF${meta ? '' : ' /EncryptMetadata false'}`
      : '';
  return {
    dict: `<< /Filter /Standard /V ${v} /R ${r} /Length ${n * 8}${cf} /O ${hex(oEntry)} /U ${hex(uEntry)} /P ${P} >>`,
    string: cipher,
    stream: cipher,
  };
}

const PACKED = [2, 3, 4, 5];

/** The test page as a PDF, plain or encrypted. */
export function testPdf(o: EncryptOptions = {}): Uint8Array {
  const sec = o.encryption ? security(o.encryption, o) : undefined;
  const meta = o.encryptMetadata ?? true;
  const packed = new Set(o.xref === 'stream' ? PACKED : []);
  const parts: Uint8Array[] = [bytesOf('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')];
  let offset = parts[0]!.length;
  const offsets = new Map<number, number>();
  const push = (num: number, b: Uint8Array) => {
    offsets.set(num, offset);
    parts.push(b);
    offset += b.length;
  };
  const stream = (num: number, dict: string, data: Uint8Array) =>
    concat(
      bytesOf(`${num} 0 obj\n${dict.replace(/>>$/, `/Length ${data.length} >>`)}\nstream\n`),
      data,
      bytesOf('\nendstream\nendobj\n'),
    );
  // Strings inside an object stream are not encrypted: the stream is (§7.6.2).
  const text =
    (num: number, inStream: boolean): Str =>
    (t) =>
      hex(sec && !inStream ? sec.string(num, enc.encode(t)) : enc.encode(t));
  const encDict = 9;
  for (const [k, body] of Object.entries(OBJECTS)) {
    const num = Number(k);
    if (packed.has(num)) continue;
    if (typeof body === 'function')
      push(num, bytesOf(`${num} 0 obj\n${body(text(num, false))}\nendobj\n`));
    else if (num === 6 && sec && o.identityContent)
      push(
        num,
        stream(
          num,
          '<< /Filter [/Crypt /FlateDecode] /DecodeParms [<< /Type /CryptFilterDecodeParms /Name /Identity >> null] >>',
          body.data,
        ),
      );
    else {
      const plainMeta = body.dict.includes('/Metadata') && !meta;
      push(num, stream(num, body.dict, sec && !plainMeta ? sec.stream(num, body.data) : body.data));
    }
  }
  if (sec) push(encDict, bytesOf(`${encDict} 0 obj\n${sec.dict}\nendobj\n`));
  const trailer = `/Root 1 0 R${sec ? ` /Encrypt ${encDict} 0 R` : ''} /ID [${hex(ID)} ${hex(ID)}]`;
  if (o.xref === 'stream') {
    const objstm = 10;
    let head = '';
    let body = '';
    for (const num of PACKED) {
      head += `${num} ${body.length} `;
      body += `${(OBJECTS[num] as (s: Str) => string)(text(num, true))}\n`;
    }
    const data = zlib(bytesOf(head + body));
    push(
      objstm,
      stream(
        objstm,
        `<< /Type /ObjStm /N ${PACKED.length} /First ${head.length} /Filter /FlateDecode >>`,
        sec ? sec.stream(objstm, data) : data,
      ),
    );
    const xref = 11;
    const xrefAt = offset;
    const rows: number[] = [];
    for (let num = 0; num <= xref; num++) {
      const i = PACKED.indexOf(num);
      const off = num === xref ? xrefAt : offsets.get(num);
      if (packed.has(num)) rows.push(2, 0, 0, objstm, i);
      else if (off !== undefined) rows.push(1, (off >> 16) & 255, (off >> 8) & 255, off & 255, 0);
      else rows.push(0, 0, 0, 0, 0);
    }
    // The cross-reference stream is never encrypted (§7.5.8.2).
    push(
      xref,
      stream(
        xref,
        `<< /Type /XRef /Size ${xref + 1} /W [1 3 1] ${trailer} >>`,
        Uint8Array.from(rows),
      ),
    );
    parts.push(bytesOf(`startxref\n${xrefAt}\n%%EOF\n`));
    return concat(...parts);
  }
  const size = Math.max(...offsets.keys()) + 1;
  let table = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let num = 1; num < size; num++) {
    const off = offsets.get(num);
    table +=
      off === undefined ? '0000000000 00001 f \n' : `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  parts.push(
    bytesOf(`${table}trailer\n<< /Size ${size} ${trailer} >>\nstartxref\n${offset}\n%%EOF\n`),
  );
  return concat(...parts);
}
