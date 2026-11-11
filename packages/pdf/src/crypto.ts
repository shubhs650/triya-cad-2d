// The primitives PDF's Standard security handler needs to read an encrypted file (M2-38): MD5
// (RFC 1321), SHA-256/384/512 (FIPS 180-4), RC4 and AES in CBC mode (FIPS 197). Written here
// rather than taken from WebCrypto because the reader is synchronous and runs in Node and in a
// worker alike; they only read files, so they guard no secret and need no constant-time care.
// The SHA-2 constants are derived (the fractional parts of the primes' square and cube roots,
// FIPS 180-4 §4.2, §5.3) instead of typed out. No DOM here.

const PRIMES = (() => {
  const out: number[] = [];
  for (let n = 2; out.length < 80; n++) if (out.every((p) => n % p !== 0)) out.push(n);
  return out;
})();

/** ⌊n^(1/k)⌋, by Newton's method from above. */
function iroot(n: bigint, k: bigint): bigint {
  let x = 1n << (BigInt(n.toString(2).length) / k + 1n);
  for (;;) {
    const y = ((k - 1n) * x + n / x ** (k - 1n)) / k;
    if (y >= x) return x;
    x = y;
  }
}

/** The first `bits` bits of the fractional part of each prime's k-th root. */
const rootBits = (primes: readonly number[], k: bigint, bits: bigint): bigint[] =>
  primes.map((p) => iroot(BigInt(p) << (bits * k), k) & ((1n << bits) - 1n));

const words32 = (v: bigint[]) => Uint32Array.from(v, Number);
/** 64-bit values as high, low word pairs. */
const words64 = (v: bigint[]) => {
  const out = new Uint32Array(v.length * 2);
  v.forEach((x, i) => {
    out[2 * i] = Number(x >> 32n);
    out[2 * i + 1] = Number(x & 0xffffffffn);
  });
  return out;
};

const K256 = words32(rootBits(PRIMES.slice(0, 64), 3n, 32n));
const H256 = words32(rootBits(PRIMES.slice(0, 8), 2n, 32n));
const K512 = words64(rootBits(PRIMES, 3n, 64n));
const H512 = words64(rootBits(PRIMES.slice(0, 8), 2n, 64n));
const H384 = words64(rootBits(PRIMES.slice(8, 16), 2n, 64n));

/** `data` padded to whole blocks of `block` bytes, its bit length at the end (§5.1). */
function padded(data: Uint8Array, block: number, lengthBytes: number, littleEndian: boolean) {
  const n = data.length;
  const out = new Uint8Array(Math.floor((n + lengthBytes) / block + 1) * block);
  out.set(data);
  out[n] = 0x80;
  const lo = (n * 8) >>> 0;
  const hi = Math.floor(n / 0x20000000);
  const at = out.length - 8;
  for (let i = 0; i < 4; i++) {
    if (littleEndian) {
      out[at + i] = (lo >>> (8 * i)) & 0xff;
      out[at + 4 + i] = (hi >>> (8 * i)) & 0xff;
    } else {
      out[at + 7 - i] = (lo >>> (8 * i)) & 0xff;
      out[at + 3 - i] = (hi >>> (8 * i)) & 0xff;
    }
  }
  return out;
}

const be32 = (b: Uint8Array, at: number) =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

function bigEndian(words: Uint32Array, bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = (words[i >> 2]! >>> (24 - 8 * (i & 3))) & 0xff;
  return out;
}

const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Uint32Array.from({ length: 64 }, (_, i) =>
  Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32),
);

export function md5(data: Uint8Array): Uint8Array {
  const b = padded(data, 64, 8, true);
  const h = Uint32Array.of(0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476);
  const m = new Uint32Array(16);
  for (let off = 0; off < b.length; off += 64) {
    for (let i = 0; i < 16; i++)
      m[i] =
        b[off + 4 * i]! |
        (b[off + 4 * i + 1]! << 8) |
        (b[off + 4 * i + 2]! << 16) |
        (b[off + 4 * i + 3]! << 24);
    let [a, bb, c, d] = [h[0]!, h[1]!, h[2]!, h[3]!];
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (bb & c) | (~bb & d);
        g = i;
      } else if (i < 32) {
        f = (d & bb) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = bb ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (bb | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + MD5_K[i]! + m[g]!) | 0;
      const s = MD5_S[(i >> 4) * 4 + (i & 3)]!;
      a = d;
      d = c;
      c = bb;
      bb = (bb + ((f << s) | (f >>> (32 - s)))) | 0;
    }
    h[0] = h[0]! + a;
    h[1] = h[1]! + bb;
    h[2] = h[2]! + c;
    h[3] = h[3]! + d;
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = (h[i >> 2]! >>> (8 * (i & 3))) & 0xff;
  return out;
}

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256(data: Uint8Array): Uint8Array {
  const b = padded(data, 64, 8, false);
  const h = Uint32Array.from(H256);
  const w = new Uint32Array(64);
  for (let off = 0; off < b.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = be32(b, off + 4 * i);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = w[i - 16]! + s0 + w[i - 7]! + s1;
    }
    let [a, bb, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (hh! +
          (rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25)) +
          ((e! & f!) ^ (~e! & g!)) +
          K256[i]! +
          w[i]!) |
        0;
      const t2 =
        ((rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22)) + ((a! & bb!) ^ (a! & c!) ^ (bb! & c!))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d! + t1) | 0;
      d = c;
      c = bb;
      bb = a;
      a = (t1 + t2) | 0;
    }
    [a, bb, c, d, e, f, g, hh].forEach((v, i) => (h[i] = h[i]! + v!));
  }
  return bigEndian(h, 32);
}

// SHA-512 on pairs of 32-bit words (high, low): rotations and shifts of the 64-bit value.
const rHi = (h: number, l: number, n: number) =>
  n < 32 ? (h >>> n) | (l << (32 - n)) : (l >>> (n - 32)) | (h << (64 - n));
const rLo = (h: number, l: number, n: number) =>
  n < 32 ? (l >>> n) | (h << (32 - n)) : (h >>> (n - 32)) | (l << (64 - n));
const TWO32 = 0x100000000;

function sha512Family(data: Uint8Array, init: Uint32Array, bytes: number): Uint8Array {
  const b = padded(data, 128, 16, false);
  const h = Uint32Array.from(init);
  const w = new Uint32Array(160);
  const s = new Uint32Array(16);
  for (let off = 0; off < b.length; off += 128) {
    for (let i = 0; i < 32; i++) w[i] = be32(b, off + 4 * i);
    for (let i = 16; i < 80; i++) {
      const xh = w[2 * (i - 15)]!;
      const xl = w[2 * (i - 15) + 1]!;
      const yh = w[2 * (i - 2)]!;
      const yl = w[2 * (i - 2) + 1]!;
      const s0h = rHi(xh, xl, 1) ^ rHi(xh, xl, 8) ^ (xh >>> 7);
      const s0l = rLo(xh, xl, 1) ^ rLo(xh, xl, 8) ^ ((xl >>> 7) | (xh << 25));
      const s1h = rHi(yh, yl, 19) ^ rHi(yh, yl, 61) ^ (yh >>> 6);
      const s1l = rLo(yh, yl, 19) ^ rLo(yh, yl, 61) ^ ((yl >>> 6) | (yh << 26));
      const lo = (s0l >>> 0) + (s1l >>> 0) + w[2 * (i - 7) + 1]! + w[2 * (i - 16) + 1]!;
      w[2 * i] =
        (s0h >>> 0) + (s1h >>> 0) + w[2 * (i - 7)]! + w[2 * (i - 16)]! + Math.floor(lo / TWO32);
      w[2 * i + 1] = lo;
    }
    s.set(h);
    for (let i = 0; i < 80; i++) {
      // s holds a…h as pairs: a = s[0], s[1]; e = s[8], s[9].
      const [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl] = s;
      const S1h = rHi(eh!, el!, 14) ^ rHi(eh!, el!, 18) ^ rHi(eh!, el!, 41);
      const S1l = rLo(eh!, el!, 14) ^ rLo(eh!, el!, 18) ^ rLo(eh!, el!, 41);
      const chh = (eh! & fh!) ^ (~eh! & gh!);
      const chl = (el! & fl!) ^ (~el! & gl!);
      const t1l = hl! + (S1l >>> 0) + (chl >>> 0) + K512[2 * i + 1]! + w[2 * i + 1]!;
      const t1h =
        hh! + (S1h >>> 0) + (chh >>> 0) + K512[2 * i]! + w[2 * i]! + Math.floor(t1l / TWO32);
      const S0h = rHi(ah!, al!, 28) ^ rHi(ah!, al!, 34) ^ rHi(ah!, al!, 39);
      const S0l = rLo(ah!, al!, 28) ^ rLo(ah!, al!, 34) ^ rLo(ah!, al!, 39);
      const mjh = (ah! & bh!) ^ (ah! & ch!) ^ (bh! & ch!);
      const mjl = (al! & bl!) ^ (al! & cl!) ^ (bl! & cl!);
      const t2l = (S0l >>> 0) + (mjl >>> 0);
      const t2h = (S0h >>> 0) + (mjh >>> 0) + Math.floor(t2l / TWO32);
      s.copyWithin(2, 0, 14);
      const el2 = dl! + (t1l >>> 0);
      s[8] = dh! + (t1h >>> 0) + Math.floor(el2 / TWO32);
      s[9] = el2;
      const al2 = (t1l >>> 0) + (t2l >>> 0);
      s[0] = (t1h >>> 0) + (t2h >>> 0) + Math.floor(al2 / TWO32);
      s[1] = al2;
    }
    for (let i = 0; i < 16; i += 2) {
      const lo = h[i + 1]! + s[i + 1]!;
      h[i] = h[i]! + s[i]! + Math.floor(lo / TWO32);
      h[i + 1] = lo;
    }
  }
  return bigEndian(h, bytes);
}

export const sha512 = (data: Uint8Array): Uint8Array => sha512Family(data, H512, 64);
export const sha384 = (data: Uint8Array): Uint8Array => sha512Family(data, H384, 48);

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    const t = s[i]!;
    s[i] = s[j]!;
    s[j] = t;
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    const t = s[i]!;
    s[i] = s[j]!;
    s[j] = t;
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}

// AES (FIPS 197): the S-box from the multiplicative inverse and the affine map, and products in
// GF(2^8) tabled for (Inv)MixColumns.
const xtime = (a: number) => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
function gmul(a: number, b: number): number {
  let p = 0;
  for (; b; b >>= 1, a = xtime(a)) if (b & 1) p ^= a;
  return p;
}
const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
for (let x = 0; x < 256; x++) {
  let inv = 0;
  if (x) for (inv = 1; gmul(x, inv) !== 1; inv++);
  let s = inv;
  for (let k = 1; k < 5; k++) s ^= ((inv << k) | (inv >> (8 - k))) & 0xff;
  SBOX[x] = s ^ 0x63;
  INV_SBOX[s ^ 0x63] = x;
}
const MUL = [2, 3, 9, 11, 13, 14].map((k) =>
  Uint8Array.from({ length: 256 }, (_, i) => gmul(i, k)),
);
const [M2, M3, M9, M11, M13, M14] = MUL as [
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
];

/** The round keys of a 16- or 32-byte key, 16 bytes per round. */
function expandKey(key: Uint8Array): Uint8Array {
  const nk = key.length / 4;
  const rounds = nk + 6;
  const w = new Uint8Array(16 * (rounds + 1));
  w.set(key);
  let rcon = 1;
  for (let i = nk; i < 4 * (rounds + 1); i++) {
    let t = [w[4 * i - 4]!, w[4 * i - 3]!, w[4 * i - 2]!, w[4 * i - 1]!];
    if (i % nk === 0) {
      t = [SBOX[t[1]!]! ^ rcon, SBOX[t[2]!]!, SBOX[t[3]!]!, SBOX[t[0]!]!];
      rcon = xtime(rcon);
    } else if (nk > 6 && i % nk === 4) t = t.map((v) => SBOX[v]!);
    for (let j = 0; j < 4; j++) w[4 * i + j] = w[4 * (i - nk) + j]! ^ t[j]!;
  }
  return w;
}

function encryptBlock(s: Uint8Array, w: Uint8Array): void {
  const rounds = w.length / 16 - 1;
  const t = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i] = s[i]! ^ w[i]!;
  for (let r = 1; r <= rounds; r++) {
    // SubBytes and ShiftRows: row j of column c comes from column c + j.
    for (let c = 0; c < 4; c++)
      for (let j = 0; j < 4; j++) t[4 * c + j] = SBOX[s[4 * ((c + j) % 4) + j]!]!;
    for (let c = 0; c < 4; c++) {
      const [a0, a1, a2, a3] = [t[4 * c]!, t[4 * c + 1]!, t[4 * c + 2]!, t[4 * c + 3]!];
      if (r < rounds) {
        s[4 * c] = M2[a0]! ^ M3[a1]! ^ a2 ^ a3;
        s[4 * c + 1] = a0 ^ M2[a1]! ^ M3[a2]! ^ a3;
        s[4 * c + 2] = a0 ^ a1 ^ M2[a2]! ^ M3[a3]!;
        s[4 * c + 3] = M3[a0]! ^ a1 ^ a2 ^ M2[a3]!;
      } else s.set([a0, a1, a2, a3], 4 * c);
    }
    for (let i = 0; i < 16; i++) s[i] = s[i]! ^ w[16 * r + i]!;
  }
}

function decryptBlock(s: Uint8Array, w: Uint8Array): void {
  const rounds = w.length / 16 - 1;
  const t = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i] = s[i]! ^ w[16 * rounds + i]!;
  for (let r = rounds - 1; r >= 0; r--) {
    // InvShiftRows and InvSubBytes, then the round key.
    for (let c = 0; c < 4; c++)
      for (let j = 0; j < 4; j++) t[4 * ((c + j) % 4) + j] = INV_SBOX[s[4 * c + j]!]!;
    for (let i = 0; i < 16; i++) t[i] = t[i]! ^ w[16 * r + i]!;
    for (let c = 0; c < 4; c++) {
      const [a0, a1, a2, a3] = [t[4 * c]!, t[4 * c + 1]!, t[4 * c + 2]!, t[4 * c + 3]!];
      if (r > 0) {
        s[4 * c] = M14[a0]! ^ M11[a1]! ^ M13[a2]! ^ M9[a3]!;
        s[4 * c + 1] = M9[a0]! ^ M14[a1]! ^ M11[a2]! ^ M13[a3]!;
        s[4 * c + 2] = M13[a0]! ^ M9[a1]! ^ M14[a2]! ^ M11[a3]!;
        s[4 * c + 3] = M11[a0]! ^ M13[a1]! ^ M9[a2]! ^ M14[a3]!;
      } else s.set([a0, a1, a2, a3], 4 * c);
    }
  }
}

/** AES-CBC decryption of the whole blocks of `data`, padding left in place. */
export function aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const w = expandKey(key);
  const n = data.length - (data.length % 16);
  const out = new Uint8Array(n);
  const block = new Uint8Array(16);
  let prev = iv;
  for (let at = 0; at < n; at += 16) {
    const cipher = data.subarray(at, at + 16);
    block.set(cipher);
    decryptBlock(block, w);
    for (let i = 0; i < 16; i++) out[at + i] = block[i]! ^ prev[i]!;
    prev = cipher;
  }
  return out;
}

/** AES-CBC encryption of `data`, a whole number of blocks, without padding. */
export function aesCbcEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const w = expandKey(key);
  const out = new Uint8Array(data.length - (data.length % 16));
  let prev: Uint8Array = iv;
  for (let at = 0; at < out.length; at += 16) {
    const block = out.subarray(at, at + 16);
    for (let i = 0; i < 16; i++) block[i] = data[at + i]! ^ prev[i]!;
    encryptBlock(block, w);
    prev = block;
  }
  return out;
}
