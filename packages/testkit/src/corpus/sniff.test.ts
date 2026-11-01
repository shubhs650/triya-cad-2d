import { describe, expect, it } from 'vitest';
import { sniffCadFile } from './sniff.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const cat = (...parts: (Uint8Array | number[])[]): Uint8Array => {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};
const BINARY_SENTINEL = cat(enc('AutoCAD Binary DXF\r\n'), [0x1a, 0x00]);

describe('sniffCadFile', () => {
  it('reads the version string at the start of a DWG', () => {
    const dwg = cat(enc('AC1032'), [0, 0, 0, 0, 0, 0x0f, 0x01]);
    expect(sniffCadFile(dwg)).toEqual({ format: 'dwg', version: 'AC1032' });
  });

  it('reads $ACADVER from an ASCII DXF header with CRLF and padded group codes', () => {
    const dxf = enc('  0\r\nSECTION\r\n  2\r\nHEADER\r\n  9\r\n$ACADVER\r\n  1\r\nAC1015\r\n  0\r\nENDSEC\r\n  0\r\nEOF\r\n');
    expect(sniffCadFile(dxf)).toEqual({ format: 'dxf-ascii', version: 'AC1015' });
  });

  it('does not pick up an $ACADVER-looking string outside the HEADER section', () => {
    const dxf = enc('0\nSECTION\n2\nENTITIES\n0\nTEXT\n1\n$ACADVER\n1\nAC1032\n0\nENDSEC\n0\nEOF\n');
    expect(sniffCadFile(dxf)).toEqual({ format: 'dxf-ascii', version: null });
  });

  it('returns a null version for a header-less ASCII DXF', () => {
    const dxf = enc('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n');
    expect(sniffCadFile(dxf)).toEqual({ format: 'dxf-ascii', version: null });
  });

  it('reads $ACADVER from an R12 binary DXF (1-byte group codes)', () => {
    const dxf = cat(BINARY_SENTINEL, [0], enc('SECTION\0'), [2], enc('HEADER\0'), [9], enc('$ACADVER\0'), [1], enc('AC1009\0'));
    expect(sniffCadFile(dxf)).toEqual({ format: 'dxf-binary', version: 'AC1009' });
  });

  it('reads $ACADVER from an R13+ binary DXF (2-byte group codes)', () => {
    const dxf = cat(BINARY_SENTINEL, [0, 0], enc('SECTION\0'), [2, 0], enc('HEADER\0'), [9, 0], enc('$ACADVER\0'), [1, 0], enc('AC1027\0'));
    expect(sniffCadFile(dxf)).toEqual({ format: 'dxf-binary', version: 'AC1027' });
  });

  it('reports unknown for bytes that are neither DWG nor DXF', () => {
    expect(sniffCadFile(enc('%PDF-1.7\n'))).toEqual({ format: 'unknown', version: null });
    expect(sniffCadFile(new Uint8Array())).toEqual({ format: 'unknown', version: null });
  });
});
