// The primitives the Standard security handler needs (M2-38), checked against Node's own
// implementations on inputs of every length around their block sizes, and RC4 (which OpenSSL 3
// no longer offers by default) against its published test vectors.
import { createCipheriv, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { aesCbcDecrypt, aesCbcEncrypt, md5, rc4, sha256, sha384, sha512 } from '../src/crypto';

/** Deterministic test bytes. */
const bytes = (n: number, seed = 1): Uint8Array => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
};

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const node = (alg: string, b: Uint8Array) => createHash(alg).update(b).digest('hex');

describe('hashes', () => {
  it('match the published digests of the empty string and "abc"', () => {
    const abc = new TextEncoder().encode('abc');
    expect(hex(md5(new Uint8Array(0)))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(hex(sha256(abc))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hex(sha512(abc))).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
        '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    );
    expect(hex(sha384(abc))).toBe(
      'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed' +
        '8086072ba1e7cc2358baeca134c825a7',
    );
  });

  it('match Node for every length across the padding boundaries', () => {
    for (let n = 0; n < 300; n++) {
      const b = bytes(n, n + 7);
      expect(hex(md5(b)), `md5 ${n}`).toBe(node('md5', b));
      expect(hex(sha256(b)), `sha256 ${n}`).toBe(node('sha256', b));
      expect(hex(sha384(b)), `sha384 ${n}`).toBe(node('sha384', b));
      expect(hex(sha512(b)), `sha512 ${n}`).toBe(node('sha512', b));
    }
    const big = bytes(70_000, 3);
    expect(hex(sha512(big))).toBe(node('sha512', big));
    expect(hex(md5(big))).toBe(node('md5', big));
  });
});

describe('rc4', () => {
  it('gives the published keystream test vectors and undoes itself', () => {
    const t = (k: string, p: string) =>
      hex(rc4(new TextEncoder().encode(k), new TextEncoder().encode(p)));
    expect(t('Key', 'Plaintext')).toBe('bbf316e8d940af0ad3');
    expect(t('Wiki', 'pedia')).toBe('1021bf0420');
    expect(t('Secret', 'Attack at dawn')).toBe('45a01f645fc35b383552544b9bf5');
    const k = bytes(16, 9);
    const p = bytes(1000, 10);
    expect(rc4(k, rc4(k, p))).toEqual(p);
  });
});

describe('AES-CBC', () => {
  it('matches the FIPS-197 example blocks', () => {
    const plain = Uint8Array.from(Buffer.from('00112233445566778899aabbccddeeff', 'hex'));
    const iv = new Uint8Array(16);
    const k128 = Uint8Array.from(Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'));
    const k256 = Uint8Array.from(
      Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex'),
    );
    expect(hex(aesCbcEncrypt(k128, iv, plain))).toBe('69c4e0d86a7b0430d8cdb78070b4c55a');
    expect(
      hex(
        aesCbcDecrypt(
          k256,
          iv,
          Uint8Array.from(Buffer.from('8ea2b7ca516745bfeafc49904b496089', 'hex')),
        ),
      ),
    ).toBe(hex(plain));
  });

  it('matches Node for 128- and 256-bit keys over many blocks', () => {
    for (const size of [16, 32]) {
      const key = bytes(size, size);
      const iv = bytes(16, 5);
      const plain = bytes(16 * 37, 11);
      const c = createCipheriv(`aes-${size * 8}-cbc`, key, iv).setAutoPadding(false);
      const enc = Uint8Array.from(Buffer.concat([c.update(plain), c.final()]));
      expect(aesCbcDecrypt(key, iv, enc)).toEqual(plain);
      if (size === 16) expect(aesCbcEncrypt(key, iv, plain)).toEqual(enc);
    }
  });

  it('decrypts whole blocks only, leaving a trailing partial block out', () => {
    const key = bytes(16, 1);
    const iv = bytes(16, 2);
    const plain = bytes(48, 3);
    const enc = aesCbcEncrypt(key, iv, plain);
    const extra = new Uint8Array(enc.length + 5);
    extra.set(enc);
    expect(aesCbcDecrypt(key, iv, extra)).toEqual(plain);
  });
});
