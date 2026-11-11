// The Standard security handler (PDF 32000-1:2008 §7.6.3–7.6.5; ISO 32000-2 §7.6.4.3.3–4 for
// revision 6), as far as reading needs it (M2-38): an encrypted PDF underlay opens with the empty
// user password, as most "protected" drawings are written (they restrict printing or copying
// but open without a password; pdf.js shows them so), and its strings and streams are
// decrypted with RC4 (V1, V2, V4 /V2) or AES (V4 /AESV2, V5 /AESV3). A file that needs a
// password, or another security handler (public-key /Adobe.PubSec and the like), is refused
// with the reason. Permissions are not enforced: the plot draws the page the screen shows.
// No DOM here.

import { aesCbcDecrypt, aesCbcEncrypt, md5, rc4, sha256, sha384, sha512 } from './crypto';

/** The Encrypt dictionary's entries, read by the reader. */
export interface EncryptEntries {
  readonly filter: string;
  readonly v: number;
  readonly r: number;
  /** /Length, bits; undefined when absent. */
  readonly length: number | undefined;
  readonly o: Uint8Array;
  readonly u: Uint8Array;
  readonly oe: Uint8Array | undefined;
  readonly ue: Uint8Array | undefined;
  readonly p: number;
  readonly encryptMetadata: boolean;
  /** V4/V5 crypt filters by name: their /CFM and /Length. */
  readonly cryptFilters: ReadonlyMap<string, { readonly cfm: string; readonly length?: number }>;
  readonly stmF: string;
  readonly strF: string;
  /** The first string of the trailer's /ID; empty when it has none. */
  readonly id: Uint8Array;
}

type Method = 'none' | 'rc4' | 'aes';

const PAD = Uint8Array.of(
  0x28,
  0xbf,
  0x4e,
  0x5e,
  0x4e,
  0x75,
  0x8a,
  0x41,
  0x64,
  0x00,
  0x4e,
  0x56,
  0xff,
  0xfa,
  0x01,
  0x08,
  0x2e,
  0x2e,
  0x00,
  0xb6,
  0xd0,
  0x68,
  0x3e,
  0x80,
  0x2f,
  0x0c,
  0xa9,
  0xfe,
  0x64,
  0x53,
  0x69,
  0x7a,
);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const le32 = (v: number) => Uint8Array.of(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, v >>> 24);

/** ISO 32000-2 Algorithm 2.B: revision 6's hash of a password; SHA-256 alone for revision 5. */
function hash2B(r: number, password: Uint8Array, salt: Uint8Array, udata: Uint8Array) {
  let k = sha256(concat(password, salt, udata));
  if (r === 5) return k;
  for (let round = 0; ; round++) {
    const one = concat(password, k, udata);
    const k1 = new Uint8Array(one.length * 64);
    for (let i = 0; i < 64; i++) k1.set(one, i * one.length);
    const e = aesCbcEncrypt(k.subarray(0, 16), k.subarray(16, 32), k1);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i]!;
    k = [sha256, sha384, sha512][sum % 3]!(e);
    // At least 64 rounds, then until the last byte of E is at most the round count − 32.
    if (round >= 63 && e[e.length - 1]! <= round - 31) return k.subarray(0, 32);
  }
}

export class StandardDecryption {
  readonly #key: Uint8Array;
  readonly #v: number;
  readonly #string: Method;
  readonly #stream: Method;
  readonly #filters: EncryptEntries['cryptFilters'];
  readonly encryptMetadata: boolean;

  private constructor(e: EncryptEntries, key: Uint8Array) {
    this.#key = key;
    this.#v = e.v;
    this.#filters = e.cryptFilters;
    this.encryptMetadata = e.encryptMetadata;
    this.#string = this.#method(e.strF);
    this.#stream = this.#method(e.stmF);
  }

  /**
   * The decryption for `e` with the empty user password; a string saying why when there is
   * none (another handler, a revision it does not know, a password needed).
   */
  static open(e: EncryptEntries): StandardDecryption | string {
    if (e.filter !== 'Standard')
      return `the PDF is encrypted with the ${e.filter} security handler`;
    if (e.v === 5 && (e.r === 5 || e.r === 6)) {
      if (e.u.length < 48 || !e.ue || e.ue.length < 32)
        return 'the PDF has a damaged Encrypt dictionary';
      const none = new Uint8Array(0);
      if (!equal(hash2B(e.r, none, e.u.subarray(32, 40), none), e.u.subarray(0, 32)))
        return 'the PDF needs a password to open';
      const key = aesCbcDecrypt(
        hash2B(e.r, none, e.u.subarray(40, 48), none),
        new Uint8Array(16),
        e.ue.subarray(0, 32),
      );
      return new StandardDecryption(e, key);
    }
    if (![1, 2, 4].includes(e.v) || e.r < 2 || e.r > 4)
      return `the PDF uses security handler revision ${e.r} (V ${e.v}), which Triya cannot read`;
    // V4's key length is its crypt filter's (in bytes, as Acrobat writes it, or bits).
    let bits = e.v === 1 ? 40 : (e.length ?? 40);
    if (e.v === 4) {
      const cf = e.cryptFilters.get(e.stmF)?.length;
      bits =
        e.length !== undefined && e.length >= 40
          ? e.length
          : cf === undefined
            ? 128
            : cf < 40
              ? cf * 8
              : cf;
    }
    const n = e.r === 2 ? 5 : Math.min(16, Math.max(5, Math.floor(bits / 8)));
    // Algorithm 2: the file key from the (empty) user password.
    let key = md5(
      concat(
        PAD,
        e.o.subarray(0, 32),
        le32(e.p),
        e.id,
        e.r >= 4 && !e.encryptMetadata ? Uint8Array.of(255, 255, 255, 255) : new Uint8Array(0),
      ),
    );
    if (e.r >= 3) for (let i = 0; i < 50; i++) key = md5(key.subarray(0, n));
    key = key.subarray(0, n);
    // Algorithms 4 and 6 (R2), 5 and 6 (R3, R4): the user entry it makes must match.
    let ok: boolean;
    if (e.r === 2) ok = equal(rc4(key, PAD), e.u.subarray(0, 32));
    else {
      let x = rc4(key, md5(concat(PAD, e.id)));
      for (let i = 1; i <= 19; i++)
        x = rc4(
          key.map((b) => b ^ i),
          x,
        );
      ok = equal(x, e.u.subarray(0, 16));
    }
    return ok ? new StandardDecryption(e, key) : 'the PDF needs a password to open';
  }

  #method(name: string): Method {
    if (this.#v < 4) return 'rc4';
    if (name === 'Identity') return 'none';
    const cfm = this.#filters.get(name)?.cfm;
    return cfm === 'V2' ? 'rc4' : cfm === 'AESV2' || cfm === 'AESV3' ? 'aes' : 'none';
  }

  /** A string of object `num` `gen` decrypted. */
  string(num: number, gen: number, data: Uint8Array): Uint8Array {
    return this.#decrypt(this.#string, num, gen, data);
  }

  /** A stream's data decrypted; `filter` names a /Crypt filter the stream gives itself. */
  stream(num: number, gen: number, data: Uint8Array, filter?: string): Uint8Array {
    return this.#decrypt(
      filter === undefined ? this.#stream : this.#method(filter),
      num,
      gen,
      data,
    );
  }

  #decrypt(method: Method, num: number, gen: number, data: Uint8Array): Uint8Array {
    if (method === 'none') return data;
    // Algorithm 1: each object's own key (V5 uses the file key itself).
    let key = this.#key;
    if (this.#v < 5) {
      const salt = method === 'aes' ? Uint8Array.of(0x73, 0x41, 0x6c, 0x54) : new Uint8Array(0);
      const id = Uint8Array.of(
        num & 255,
        (num >> 8) & 255,
        (num >> 16) & 255,
        gen & 255,
        (gen >> 8) & 255,
      );
      key = md5(concat(key, id, salt)).subarray(0, Math.min(key.length + 5, 16));
    }
    if (method === 'rc4') return rc4(key, data);
    // AES: a 16-byte IV first, then the blocks, PKCS #5 padded (a bad pad is kept, as pdf.js does).
    if (data.length < 32) return new Uint8Array(0);
    const out = aesCbcDecrypt(key, data.subarray(0, 16), data.subarray(16));
    const pad = out[out.length - 1]!;
    if (pad >= 1 && pad <= 16 && out.subarray(out.length - pad).every((b) => b === pad))
      return out.subarray(0, out.length - pad);
    return out;
  }
}
